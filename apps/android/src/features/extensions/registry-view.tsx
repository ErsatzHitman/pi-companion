/**
 * `PiUiElementView` — the per-element rendering entry point for the
 * Android Pi UI Bridge renderer registry (plan.md §11.4; T34A1).
 *
 * ```text
 * kind -> validate canonical payload -> build platform component -> dispatch action
 * ```
 *
 * This component is that whole pipeline for one element:
 *
 * 1. resolves `registry-plan.ts`'s pure render decision for this element
 *    (unknown kind, oversized payload, no renderer yet, invalid payload,
 *    or ok);
 * 2. for anything but "ok", renders exactly one `ExtensionDiagnostic` —
 *    never raw transcript text, never one diagnostic per malformed field;
 * 3. otherwise renders the registered kind component inside a per-element
 *    `ExtensionElementBoundary`, with a bound `dispatchAction`/
 *    `getActionState` pair and a namespace-aware logger;
 * 4. gates any action whose `PiUiAction.confirm` is set behind
 *    `DangerousActionConfirmDialog` before it ever reaches
 *    `ExtensionActionController.dispatch`;
 * 5. in development (`__DEV__`), shows a small revision badge so a stale
 *    element is visibly distinguishable while debugging.
 *
 * Individual kinds (`status`, `widget`, `progress`, ...) render through
 * here once T34A2 onward register them; until then every element renders
 * through step 2's fallback, which is the same fallback a genuinely-
 * unknown kind hits. This is the Android counterpart to
 * `apps/web/src/features/extensions/registry-view.tsx` — same pipeline,
 * separate native components (plan.md §18.3).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { extensions } from "@picompanion/frontend-core";
import type { Logger, LogFields } from "@picompanion/frontend-core";
import type { PiUiAction, PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { useTheme } from "../../ui/theme/theme-context";
import { DangerousActionConfirmDialog } from "./registry-confirm";
import { ExtensionDiagnostic } from "./registry-diagnostic";
import { describePiUiRenderDiagnosticLog } from "./registry-diagnostic-log";
import { resolvePiUiElementRenderDecision } from "./registry-plan";
import {
  PI_UI_MAX_PAYLOAD_BYTES,
  piUiActionTarget,
  piUiRendererRegistry,
  type PiUiDispatchAction,
  type PiUiDispatchActionOptions,
} from "./registry";
import { ExtensionElementBoundary } from "./registry-boundary";

/** `Logger` backed by `console`, used only when a caller doesn't supply its own. */
function createConsoleLogger(baseFields: LogFields = {}): Logger {
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: LogFields,
  ) => {
    const merged = { ...baseFields, ...fields };
    const hasFields = Object.keys(merged).length > 0;
    // eslint-disable-next-line no-console
    console[level](message, ...(hasFields ? [merged] : []));
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createConsoleLogger({ ...baseFields, ...fields }),
  };
}

const defaultLogger = createConsoleLogger({ source: "pi-ui-registry" });

export interface PiUiElementViewProps {
  element: PiUiElement;
  agentId: string;
  /** Dispatches and tracks this element's actions (frontend-core's `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode badge. */
  revision?: number;
  logger?: Logger;
  maxPayloadBytes?: number;
  testId?: string;
}

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
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  // callback rather than calling `actionController` themselves. One
  // pending confirmation at a time is sufficient: a user can only be
  // mid-tap on one button when the resulting modal (which covers the
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
    // unaffected and stays exactly what it was before the tap; this
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

  const decision = resolvePiUiElementRenderDecision(element, piUiRendererRegistry, maxPayloadBytes);

  if (decision.status !== "ok") {
    // Exactly one diagnostic, from exactly one call site, for any element
    // this component ever renders — proven with a real counting-fake
    // `Logger` against this exact function in
    // `registry-diagnostic-log.test.ts` (T40B1). `undefined` here would
    // mean `decision.status === "ok"`, which this branch has already
    // excluded, so `diagnosticLog` is always defined in practice; the
    // `if` still guards the call rather than asserting it, so this
    // function can never itself throw on an unexpected decision shape.
    const diagnosticLog = describePiUiRenderDiagnosticLog(decision, element);
    if (diagnosticLog) elementLogger.warn(diagnosticLog.message, diagnosticLog.fields);
    return (
      <ExtensionDiagnostic
        diagnostic={decision.diagnostic}
        // An oversized element's own payload never reaches even the
        // diagnostic's raw-details disclosure — only the capped
        // explanation does.
        element={decision.status === "oversized" ? { ...element, payload: undefined } : element}
        testId={testId}
      />
    );
  }

  const Renderer = decision.Renderer;

  return (
    <View style={styles.wrapper} testID={testId}>
      <ExtensionElementBoundary
        ns={element.ns}
        elementId={element.id}
        kind={element.kind}
        logger={elementLogger}
        resetKey={revision}
        testId={testId ? `${testId}-error` : undefined}
      >
        <Renderer
          element={element}
          payload={decision.payload}
          revision={revision}
          dispatchAction={dispatchAction}
          getActionState={getActionState}
          logger={elementLogger}
        />
      </ExtensionElementBoundary>
      {__DEV__ ? (
        <Text
          style={styles.revBadge}
          accessibilityLabel={`${element.ns}:${element.id} revision ${revision ?? "unknown"}`}
        >
          rev {revision ?? "?"}
        </Text>
      ) : null}
      <DangerousActionConfirmDialog
        action={pendingConfirmAction}
        elementLabel={element.title ?? element.id}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
        testId={testId ? `${testId}-confirm` : undefined}
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    revBadge: {
      alignSelf: "flex-end",
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
