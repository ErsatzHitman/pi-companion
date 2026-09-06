/**
 * `panel` kind render model (plan.md §11.3, §11.4; T34B4) — "Composed
 * focused view", the last link in the T34 chain. A panel introduces no
 * visual language of its own: each of its `sections` carries its own leaf
 * `kind` (`status`, `widget`, `progress`, `roster`, `log`, `markdown`,
 * `diff`, `form`, or `composer`) and this module resolves that kind
 * through the exact same `PiUiRendererRegistry`/`resolvePiUiElementRenderDecision`
 * pipeline (`../registry.ts`, `../registry-plan.ts`; T34A1) every
 * top-level element uses — so a section renders identically to that kind
 * rendered standalone, never a second copy of nine renderers (plan.md
 * §10.1's "one approved treatment per component"). This is the Android
 * counterpart to `apps/web/src/features/extensions/renderers/panel.tsx`
 * (T29B4) — same semantics, factored so the decision logic (this file) is
 * unit testable in this workspace and `panel.tsx` is left a thin native
 * mapping, matching every other kind in this directory (see
 * `status-model.ts`'s doc comment for why: this workspace's `vitest`
 * cannot import anything reaching `react-native`).
 *
 * **Bounded nesting, "guard against a cyclic or self-referential
 * element"**: `PiUiPanelSectionSchema.kind` is typed `PiUiLeafKind`, which
 * *excludes* `"panel"` (`packages/protocol/src/pi-ui-bridge/primitives.ts`)
 * — the wire schema is deliberately non-recursive, so panels do not nest
 * on a normally validated element (`normalizePiUiElement`'s
 * `normalizeSection` step, and the daemon's own `payload-compat.ts`,
 * both refuse to attach a typed payload to a `kind: "panel"` section).
 * `resolvePanelChildDecision` below still checks for it explicitly, as a
 * *runtime* string comparison rather than a type-narrowed one (TypeScript
 * would reject `section.kind === "panel"` outright as a no-overlap
 * comparison against the real `PiUiLeafKind` type — this widens to
 * `string` first specifically so the check compiles as the defensive
 * runtime guard it is) — because looking such a section's `kind` up in
 * the shared registry would resolve to `PanelRenderer` itself once this
 * task registers it, and rendering that would recurse with **no bound at
 * all**: not a deep tree, an actually infinite one, since nothing stops a
 * hand-built or malformed payload from making a section's own `payload`
 * reference the very structure that contains it.
 *
 * The guard closes that off completely, not just boundedly: a
 * `kind: "panel"` section is turned into one `"nesting-limit"` diagnostic
 * decision *before* its `payload` is ever inspected — so even a section
 * whose `payload.sections` array is built to contain a genuine circular
 * JS object reference back to an ancestor (the concrete way "an unbounded
 * recursion actually arrives from a wire payload" — a wire payload could
 * never encode a real object cycle, but a daemon-adjacent bug or a
 * hand-built fixture object graph could) is inert: that field is never
 * read, so there is nothing to walk and no depth counter is needed to
 * make termination provable. The maximum panel nesting depth this
 * renderer ever mounts is therefore exactly **one level** (the top
 * element itself; no section may be a second one) — tested at that exact
 * boundary in `panel-model.test.ts`: a genuine leaf-kind section (depth
 * 0, allowed) renders normally, and a section attempting one more level
 * (depth 1, `kind: "panel"`) is refused with a named diagnostic, sibling
 * sections unaffected, and a cyclic `payload.sections` reference proven
 * never to be traversed. This mirrors the web renderer's identical,
 * already-reviewed guard (T29B4) exactly, rather than inventing a
 * separate numeric-depth walk the wire protocol has no shape for.
 *
 * **Fault isolation, "a failing child does not take down the panel"**:
 * this module's decisions never throw for a malformed section — every
 * branch below returns a decision object, proven in
 * `panel-model.test.ts` against sections missing required fields, with
 * mismatched payload kinds, and with the cyclic case above. The other
 * half of isolation — a *rendering* throw inside one section's own kind
 * component — is `panel.tsx`'s job: it wraps each `"ok"` child in its own
 * `ExtensionElementBoundary` instance, the exact per-element error
 * boundary `registry-view.tsx` already wraps every top-level element in
 * (proven there; RN error boundaries cannot be render-tested under this
 * workspace's `vitest`, so that half stays a disclosed gap for T37/T59
 * per this directory's standing note).
 *
 * Action identity for a section's own actions (plan.md §12.3): mirrors
 * `roster.tsx`'s row-scoped binding — each section's actions route
 * through the composite `${element.id}#${section.id}` id, exactly like a
 * `roster` row's `${element.id}#${row.id}` (`roster-model.ts`).
 */
import type {
  PiUiElement,
  PiUiKind,
  PiUiPanelSection,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  PI_UI_MAX_PAYLOAD_BYTES,
  type PiUiKindRenderer,
  type PiUiPayloadForKind,
} from "../registry";
import type { PiUiRendererRegistry } from "../registry";
import { resolvePiUiElementRenderDecision, type RegistryDiagnostic } from "../registry-plan";
import { humanizeNamespace } from "./tone";

/** Every status a panel child decision can resolve to. */
export type PiUiPanelChildStatus =
  | "ok"
  | "unknown-kind"
  | "oversized"
  | "no-renderer"
  | "invalid-payload"
  | "nesting-limit";

interface PiUiPanelChildDecisionCommon {
  sectionId: string;
  /**
   * The section's wire `kind`, widened to `string` — see module doc
   * comment. For every status but `"nesting-limit"` this is one of the
   * nine leaf kinds; for `"nesting-limit"` it is the literal `"panel"`
   * that triggered the guard.
   */
  kind: string;
  /** Composite `${parentElementId}#${sectionId}` id this section's own actions route through. */
  elementId: string;
  title: string | undefined;
}

export type PiUiPanelChildDecision =
  | (PiUiPanelChildDecisionCommon & {
      status: "ok";
      /** Synthetic per-section element built from `PiUiElement`'s common envelope fields, for `Renderer`'s `element` prop. */
      element: PiUiElement;
      Renderer: PiUiKindRenderer;
      payload: PiUiPayloadForKind<PiUiKind>;
    })
  | (PiUiPanelChildDecisionCommon & {
      status: Exclude<PiUiPanelChildStatus, "ok">;
      diagnostic: RegistryDiagnostic;
    });

/** The non-`"ok"` half of `PiUiPanelChildDecision` — every status that carries a `diagnostic` instead of a `Renderer`. */
export type PiUiPanelChildDiagnosticDecision = Exclude<PiUiPanelChildDecision, { status: "ok" }>;

/**
 * Resolves one panel section to a render decision, reusing
 * `resolvePiUiElementRenderDecision` (`../registry-plan.ts`) for every
 * check that decision already makes correctly for a top-level element
 * (unknown kind, oversized payload, no renderer yet, invalid payload) —
 * the only check unique to a panel child is the nesting guard, applied
 * first and unconditionally.
 */
export function resolvePanelChildDecision(
  parent: Pick<PiUiElement, "id" | "ns">,
  section: PiUiPanelSection,
  registry: PiUiRendererRegistry,
  maxPayloadBytes: number = PI_UI_MAX_PAYLOAD_BYTES,
): PiUiPanelChildDecision {
  const elementId = `${parent.id}#${section.id}`;
  // Deliberately widened to `string` before comparing — see module doc
  // comment on why this is a runtime guard, not a type-narrowed dead branch.
  const runtimeKind: string = section.kind;

  if (runtimeKind === "panel") {
    return {
      status: "nesting-limit",
      sectionId: section.id,
      kind: runtimeKind,
      elementId,
      title: section.title,
      diagnostic: {
        title: "Nested panels are not supported",
        message: `Section "${section.id}" is itself a panel — a panel section may not contain another panel.`,
      },
    };
  }

  const syntheticElement = {
    id: section.id,
    ns: section.ns ?? parent.ns,
    kind: section.kind,
    placement: "inline",
    title: section.title,
    actions: section.actions,
    payload: section.payload,
  } as PiUiElement;

  const decision = resolvePiUiElementRenderDecision(syntheticElement, registry, maxPayloadBytes);

  if (decision.status === "ok") {
    return {
      status: "ok",
      sectionId: section.id,
      kind: runtimeKind,
      elementId,
      title: section.title,
      element: syntheticElement,
      Renderer: decision.Renderer,
      payload: decision.payload,
    };
  }

  return {
    status: decision.status,
    sectionId: section.id,
    kind: runtimeKind,
    elementId,
    title: section.title,
    diagnostic: decision.diagnostic,
  };
}

export interface PiUiPanelRenderModel {
  title: string;
  /** The payload's own free-text `text`, shown above the sections when present. */
  text: string | undefined;
  children: PiUiPanelChildDecision[];
  /** Shown instead of the section list when the panel carries no sections at all. */
  emptyText: string | undefined;
  actionsAccessibilityLabel: string;
}

/**
 * Builds the full render model for one `panel` element: its title/text and
 * every section's resolved child decision, in wire order. Never throws —
 * every section, however malformed, resolves to a decision object via
 * `resolvePanelChildDecision` above.
 */
export function buildPanelRenderModel(
  element: Pick<PiUiElement, "id" | "ns" | "title">,
  payload: PiUiPayloadForKind<"panel">,
  registry: PiUiRendererRegistry,
  maxPayloadBytes: number = PI_UI_MAX_PAYLOAD_BYTES,
): PiUiPanelRenderModel {
  const title = element.title ?? humanizeNamespace(element.ns);
  const children = payload.sections.map((section) =>
    resolvePanelChildDecision(element, section, registry, maxPayloadBytes),
  );
  return {
    title,
    text: payload.text,
    children,
    emptyText: children.length === 0 ? "No sections to show." : undefined,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
