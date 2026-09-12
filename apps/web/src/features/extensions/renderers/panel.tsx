/**
 * `panel` kind renderer (plan.md §11.3, §11.4; T29B4) — "Composed focused
 * view", presented as web's documented "rail, popover, or inline panel"
 * (plan.md §11.3's kind table). A panel does not introduce a new visual
 * language of its own: each of its `sections` carries its own leaf `kind`
 * (`status`, `widget`, `progress`, `roster`, `log`, `markdown`, `diff`,
 * `form`, or `composer`) and this renderer looks that kind up in the exact
 * same `piUiRendererRegistry` every top-level element uses (`../registry.js`)
 * so a section renders identically to that kind rendered standalone — no
 * second copy of nine renderers, per plan.md §10.1's "one approved
 * treatment per component".
 *
 * Bounded nesting (T29B4's "nesting depth is bounded with a visible
 * diagnostic beyond the limit" acceptance criterion): the wire schema
 * already makes a section's `kind` a `PiUiLeafKind`, which excludes
 * `"panel"` (`PiUiLeafKindSchema` in `@picompanion/protocol`), so a
 * genuinely nested panel cannot reach this renderer through a normally
 * validated element — `normalizePiUiElement`'s `normalizeSection` step
 * refuses to attach a typed payload to a `kind: "panel"` section, and the
 * daemon's own `payload-compat.ts` mirrors that refusal. This renderer
 * still checks for it explicitly (as a plain string comparison, not a
 * type-narrowed one) as defense in depth against a section that reaches
 * here with an unvalidated/hand-built `panel` kind — e.g. a future wire
 * relaxation, or a test fixture built by hand — because looking such a
 * section up in the shared registry would recurse into another
 * `PanelRenderer` with no depth limit at all. Rather than recursing, that
 * case renders one visible diagnostic in the section's place; every other
 * section keeps rendering normally.
 *
 * Fault isolation (T29B4's "a failing child does not take down the panel"):
 * each section mounts inside its own `ExtensionElementBoundary` (the same
 * per-element error boundary `registry-view.tsx` wraps every top-level
 * element in), so one section's renderer throwing replaces only that
 * section with `ErrorState`, not the whole panel.
 *
 * Action identity for a section's own actions (plan.md §12.3): the daemon
 * resolves a panel section exactly like a roster row, via the same
 * `ns:id#childId` composite (`packages/server/.../pi-ui-bridge/state.ts`
 * `findChild`, which reads a `panel`'s `payload.sections` the same way it
 * reads a `roster`'s `payload.rows`). This renderer therefore binds each
 * section's `dispatchAction`/`getActionState` to `${element.id}#${section.id}`
 * by default, mirroring `roster.tsx`'s own row-scoped binding, rather than
 * inventing a different identity scheme for panel sections.
 *
 * Nested child identity: a section renderer may itself scope one hop
 * deeper for its own children — `roster.tsx` composes a row as
 * `${section.id}#${row.id}`. This renderer prefixes any such local id with
 * this section's own `${parent.id}#` scope, so the identity handed to the
 * bound dispatch pair is `panel#section#row`, never the bare
 * `section#row` that would silently drop the panel. This is what keeps two
 * nested roster rows' pending/settled action state distinct in
 * `ExtensionActionController` (they share the section's element id
 * otherwise) and composes the whole chain in the one place that knows the
 * parent, rather than leaving every nested renderer to reassemble it. The
 * wire identity is sent unchanged; resolving a multi-hop chain against
 * daemon state is `packages/server/.../pi-ui-bridge/identity.ts`
 * `parseCompositeElementId`'s concern, outside this file.
 */
import type { PiUiElement, PiUiPanelSection } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Banner } from "../../../ui/primitives/index.js";
import { ExtensionElementBoundary } from "../registry-boundary.js";
import {
  piUiRendererRegistry,
  type PiUiDispatchAction,
  type PiUiElementRendererProps,
} from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

interface PanelSectionViewProps {
  section: PiUiPanelSection;
  parent: PiUiElement;
  parentTestId: string;
  revision: number | undefined;
  dispatchAction: PiUiDispatchAction;
  getActionState: PiUiElementRendererProps<"panel">["getActionState"];
  logger: PiUiElementRendererProps<"panel">["logger"];
}

function PanelSectionDiagnostic({ message, testId }: { message: string; testId: string }) {
  return (
    <div className="pc-pi-panel__section pc-pi-panel__section--diagnostic" data-testid={testId}>
      <Banner tone="warning" message={message} />
    </div>
  );
}

function PanelSectionView({
  section,
  parent,
  parentTestId,
  revision,
  dispatchAction,
  getActionState,
  logger,
}: PanelSectionViewProps) {
  const sectionTestId = `${parentTestId}-section-${section.id}`;

  // Defense in depth: a section's declared TS type (`PiUiLeafKind`) already
  // excludes `"panel"`, but the runtime value backing it may not — see the
  // module doc comment. Widening to `string` before comparing keeps this an
  // intentional runtime check rather than a type error.
  const runtimeKind: string = section.kind;
  if (runtimeKind === "panel") {
    logger.warn("Panel section exceeds the supported nesting depth", {
      sectionId: section.id,
    });
    return (
      <PanelSectionDiagnostic
        message={`Section "${section.id}" is itself a panel — nested panels are not supported.`}
        testId={`${sectionTestId}-nesting-limit`}
      />
    );
  }

  const Renderer = piUiRendererRegistry.get(section.kind);
  if (!Renderer || section.payload === undefined) {
    logger.warn(
      !Renderer
        ? "No renderer registered for this section kind yet"
        : "Panel section payload could not be validated",
      { sectionId: section.id, kind: section.kind },
    );
    return (
      <PanelSectionDiagnostic
        message={
          !Renderer
            ? `"${section.kind}" has no registered web renderer.`
            : `Section "${section.id}" payload does not match its "${section.kind}" shape.`
        }
        testId={sectionTestId}
      />
    );
  }

  const sectionElementId = `${parent.id}#${section.id}`;
  // Prefixes any deeper local id a section renderer composed for its own
  // child (e.g. `roster.tsx`'s `${section.id}#${row.id}`) with this
  // section's scope, producing `panel#section#row` rather than the bare
  // `section#row`. See this module's header comment.
  const scopeChildElementId = (childElementId: string) => `${parent.id}#${childElementId}`;
  const sectionElement: PiUiElement = {
    id: section.id,
    ns: section.ns ?? parent.ns,
    kind: section.kind,
    placement: "inline",
    title: section.title,
    actions: section.actions,
  } as PiUiElement;

  const sectionDispatch: PiUiDispatchAction = (actionId, options) =>
    dispatchAction(actionId, {
      ...options,
      elementId:
        options?.elementId !== undefined
          ? scopeChildElementId(options.elementId)
          : sectionElementId,
    });
  const sectionGetActionState: PiUiElementRendererProps<"panel">["getActionState"] = (
    actionId,
    elementIdOverride,
  ) =>
    getActionState(
      actionId,
      elementIdOverride !== undefined ? scopeChildElementId(elementIdOverride) : sectionElementId,
    );
  const sectionLogger = logger.child({
    ns: sectionElement.ns,
    kind: sectionElement.kind,
    elementId: sectionElement.id,
  });

  return (
    <div className="pc-pi-panel__section" data-testid={sectionTestId}>
      <ExtensionElementBoundary
        ns={sectionElement.ns}
        elementId={sectionElement.id}
        kind={sectionElement.kind}
        logger={sectionLogger}
        resetKey={revision}
        testId={`${sectionTestId}-error`}
      >
        <Renderer
          element={sectionElement}
          payload={section.payload}
          revision={revision}
          dispatchAction={sectionDispatch}
          getActionState={sectionGetActionState}
          logger={sectionLogger}
        />
      </ExtensionElementBoundary>
    </div>
  );
}

export function PanelRenderer({
  element,
  payload,
  revision,
  dispatchAction,
  getActionState,
  logger,
}: PiUiElementRendererProps<"panel">) {
  const title = element.title ?? "Panel";
  const testId = `pi-panel-${element.ns}-${element.id}`;

  return (
    <div className="pc-pi-panel" data-testid={testId}>
      <h3 className="pc-pi-panel__title">{title}</h3>
      {payload.text ? <p className="pc-pi-panel__text">{payload.text}</p> : null}
      {payload.sections.length > 0 ? (
        <div className="pc-pi-panel__sections">
          {payload.sections.map((section) => (
            <PanelSectionView
              key={section.id}
              section={section}
              parent={element}
              parentTestId={testId}
              revision={revision}
              dispatchAction={dispatchAction}
              getActionState={getActionState}
              logger={logger}
            />
          ))}
        </div>
      ) : (
        <p className="pc-pi-panel__empty">No sections to show.</p>
      )}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${title} actions`}
      />
    </div>
  );
}
