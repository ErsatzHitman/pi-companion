/**
 * `PiUiElementView` — the per-element rendering entry point for the web Pi
 * UI Bridge renderer registry (plan.md §11.4; T29A1).
 *
 * ```text
 * kind -> validate canonical payload -> build platform component -> dispatch action
 * ```
 *
 * This component is that whole pipeline for one element:
 *
 * 1. caps oversized payloads before they ever reach a renderer or the DOM;
 * 2. falls back to one visible diagnostic for an unrecognized kind, a kind
 *    with no renderer registered yet, or a payload that failed canonical
 *    validation (`normalizePiUiElement` in `@picompanion/frontend-core`
 *    returns the element unchanged, i.e. without a typed `payload`, when it
 *    cannot derive one — see `extensions/normalize.ts`);
 * 3. otherwise renders the registered kind component inside a per-element
 *    `ExtensionElementBoundary`, with a bound `dispatchAction`/
 *    `getActionState` pair and a namespace-aware logger;
 * 4. in development, overlays a small revision badge so a stale element is
 *    visibly distinguishable while debugging.
 *
 * Individual kinds (`status`, `widget`, `progress`, ...) render through
 * here once T29A2/T29A3/T29B1-T29B4 register them; until then every
 * element renders through step 2's fallback, which is the same fallback a
 * genuinely-unknown kind hits.
 */
import { Suspense, useCallback, useMemo, useRef, useState } from "react";

import { extensions } from "@picompanion/frontend-core";
import type { Logger } from "@picompanion/frontend-core";
import {
  PI_UI_PAYLOAD_KINDS,
  type PiUiAction,
  type PiUiElement,
  type PiUiKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import { Banner, CodeBlock, LoadingState, Popover } from "../../ui/primitives/index.js";
import { DangerousActionConfirmDialog } from "./dangerous-action-confirm.js";
import { ExtensionElementBoundary } from "./registry-boundary.js";
import "./registry.css";
import {
  PI_UI_MAX_PAYLOAD_BYTES,
  estimatePiUiPayloadBytes,
  isPiUiPayloadOversized,
  piUiActionTarget,
  piUiRendererRegistry,
  type PiUiDispatchAction,
  type PiUiDispatchActionOptions,
} from "./registry.js";
import { createConsoleLogger } from "../../platform/logging.js";

const KNOWN_KINDS = new Set<string>(PI_UI_PAYLOAD_KINDS);

/** A safe, size-bounded preview of an element's raw wire shape for diagnostics. */
function safeRawPreview(element: PiUiElement, limit = 2000): string {
  try {
    const json = JSON.stringify(element, null, 2) ?? String(element);
    return json.length > limit ? `${json.slice(0, limit)}\n… (truncated)` : json;
  } catch {
    return "(raw element could not be serialized)";
  }
}

interface DiagnosticProps {
  title: string;
  message: string;
  element: PiUiElement;
  testId?: string;
}

/**
 * One visible diagnostic — plan.md §11.2's "Unknown input becomes a visible
 * diagnostic with source and safe raw details", applied to the registry
 * (§11.4's "unknown-kind fallback"). This is a single, non-alarming banner,
 * never raw transcript text.
 */
function ExtensionDiagnostic({ title, message, element, testId }: DiagnosticProps) {
  return (
    <div className="pc-extension-diagnostic" data-testid={testId}>
      <Banner tone="warning" message={`${title} — ${message}`} />
      <p className="pc-extension-diagnostic__source">
        source: {element.ns}:{element.id} ({element.kind})
      </p>
      <Popover triggerLabel="Show raw details">
        <CodeBlock code={safeRawPreview(element)} language="json" />
      </Popover>
    </div>
  );
}

export interface PiUiElementViewProps {
  element: PiUiElement;
  agentId: string;
  /** Dispatches and tracks this element's actions (T21C `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode badge. */
  revision?: number;
  logger?: Logger;
  maxPayloadBytes?: number;
  testId?: string;
}

const defaultLogger = createConsoleLogger({ source: "pi-ui-registry" });

/** Renders exactly one live Pi UI Bridge element through the registry pipeline. */
export function PiUiElementView({
  element,
  agentId,
  actionController,
  revision,
  logger = defaultLogger,
  maxPayloadBytes = PI_UI_MAX_PAYLOAD_BYTES,
  testId,
}: PiUiElementViewProps) {
  const elementLogger = useMemo(
    () => logger.child({ ns: element.ns, kind: element.kind, elementId: element.id }),
    [logger, element.ns, element.kind, element.id],
  );

  const dispatchNow: PiUiDispatchAction = useCallback(
    (actionId, options) =>
      actionController.dispatch({
        agentId,
        namespace: element.ns,
        elementId: options?.elementId ?? element.id,
        actionId,
        payload: options?.payload,
        action: options?.action,
        confirmed: options?.confirmed,
      }),
    [actionController, agentId, element.ns, element.id],
  );

  // The "platform confirmation if required" step (plan.md §12.3), gating
  // every dispatch this element's tree can make — including a `roster`
  // row's or a `panel` section's, since both forward to this same bound
  // callback rather than calling `actionController` themselves (T29B5).
  // One pending confirmation at a time is sufficient: a user can only be
  // mid-click on one button when the resulting modal (which covers the
  // whole viewport and traps focus, `Dialog`/`useModalBehavior`) opens.
  const pendingConfirmationRef = useRef<{
    actionId: string;
    options: PiUiDispatchActionOptions | undefined;
    resolve: (result: extensions.SettledExtensionAction) => void;
  } | null>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<PiUiAction | undefined>(
    undefined,
  );

  const dispatchAction: PiUiDispatchAction = useCallback(
    (actionId, options) => {
      if (extensions.requiresConfirmation(options?.action) && options?.confirmed !== true) {
        return new Promise<extensions.SettledExtensionAction>((resolve) => {
          pendingConfirmationRef.current = { actionId, options, resolve };
          setPendingConfirmAction(options!.action);
        });
      }
      return dispatchNow(actionId, options);
    },
    [dispatchNow],
  );

  const confirmPendingAction = useCallback(() => {
    const pending = pendingConfirmationRef.current;
    pendingConfirmationRef.current = null;
    setPendingConfirmAction(undefined);
    if (!pending) return;
    void dispatchNow(pending.actionId, { ...pending.options, confirmed: true }).then(
      pending.resolve,
    );
  }, [dispatchNow]);

  const cancelPendingAction = useCallback(() => {
    const pending = pendingConfirmationRef.current;
    pendingConfirmationRef.current = null;
    setPendingConfirmAction(undefined);
    if (!pending) return;
    // Declining confirmation never reaches `actionController` — nothing was
    // ever sent, so there is nothing to cancel there either. The action's
    // globally-tracked state (`actionController.getActionState`) is
    // unaffected and stays exactly what it was before the click; this
    // synthetic outcome only settles the promise `dispatchAction` returned
    // to this one caller.
    pending.resolve({
      target: piUiActionTarget(
        agentId,
        { ns: element.ns, id: pending.options?.elementId ?? element.id },
        pending.actionId,
      ),
      requestId: "unconfirmed",
      status: "cancelled",
      staleRevision: false,
      source: "cancel",
      settledAt: Date.now(),
    } satisfies extensions.SettledExtensionAction);
  }, [agentId, element.ns, element.id]);

  const getActionState = useCallback(
    (actionId: string, elementId?: string) =>
      actionController.getActionState(
        piUiActionTarget(agentId, { ns: element.ns, id: elementId ?? element.id }, actionId),
      ),
    [actionController, agentId, element.ns, element.id],
  );

  const kindIsKnown = KNOWN_KINDS.has(element.kind);
  const payload = element.payload;

  if (!kindIsKnown) {
    elementLogger.warn("Pi UI element has an unrecognized kind", { kind: element.kind });
    return (
      <ExtensionDiagnostic
        title="Unrecognized element kind"
        message={`"${element.kind}" is not one of the known Pi UI Bridge kinds.`}
        element={element}
        testId={testId}
      />
    );
  }

  if (isPiUiPayloadOversized(payload, maxPayloadBytes)) {
    const bytes = estimatePiUiPayloadBytes(payload);
    elementLogger.warn("Pi UI element payload exceeds the size cap", {
      bytes,
      maxPayloadBytes,
    });
    return (
      <ExtensionDiagnostic
        title="Element payload too large to render"
        message={`${bytes.toLocaleString()} bytes exceeds the ${maxPayloadBytes.toLocaleString()}-byte limit.`}
        element={{ ...element, payload: undefined } as PiUiElement}
        testId={testId}
      />
    );
  }

  const Renderer = piUiRendererRegistry.get(element.kind as PiUiKind);
  if (!Renderer || payload === undefined) {
    elementLogger.warn(
      !Renderer
        ? "No renderer registered for this kind yet"
        : "Element payload failed canonical validation",
    );
    return (
      <ExtensionDiagnostic
        title={!Renderer ? "No renderer available yet" : "Element payload could not be validated"}
        message={
          !Renderer
            ? `"${element.kind}" has no registered web renderer.`
            : `This "${element.kind}" element's payload does not match its kind's shape.`
        }
        element={element}
        testId={testId}
      />
    );
  }

  return (
    <div className="pc-extension-element" data-testid={testId}>
      <ExtensionElementBoundary
        ns={element.ns}
        elementId={element.id}
        kind={element.kind}
        logger={elementLogger}
        resetKey={revision}
      >
        {/*
         * T58: covers `renderers/index.js`'s `diff` kind, the one
         * registration that is `React.lazy`-wrapped so its
         * `@lezer/*`-backed dependency loads on demand instead of on
         * every route. Every other kind's module is already loaded
         * (`renderers/index.js`'s own static imports), so this boundary
         * never visibly activates for them — a component that never
         * suspends renders straight through a `<Suspense>` ancestor.
         */}
        <Suspense
          fallback={
            <LoadingState
              title="Loading"
              description={`Loading the "${element.kind}" renderer…`}
              testId={testId ? `${testId}-renderer-loading` : undefined}
            />
          }
        >
          <Renderer
            element={element}
            payload={payload}
            revision={revision}
            dispatchAction={dispatchAction}
            getActionState={getActionState}
            logger={elementLogger}
          />
        </Suspense>
      </ExtensionElementBoundary>
      {import.meta.env.DEV ? (
        <span
          className="pc-extension-element__rev"
          title={`${element.ns}:${element.id} rev ${revision ?? "?"}`}
        >
          rev {revision ?? "?"}
        </span>
      ) : null}
      <DangerousActionConfirmDialog
        action={pendingConfirmAction}
        elementLabel={element.title ?? element.id}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
        testId={testId ? `${testId}-confirm` : undefined}
      />
    </div>
  );
}
