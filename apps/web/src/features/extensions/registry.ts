/**
 * Web Pi UI Bridge renderer registry (plan.md §11.4; T29A1).
 *
 * `kind -> validate canonical payload -> build platform component -> dispatch
 * action`. This module owns the *lookup* half of that pipeline — a typed map
 * from `PiUiKind` to the React component that renders it — plus the small
 * pieces of shared plumbing every per-kind renderer needs:
 *
 * - a bound `dispatchAction`/`getActionState` pair, closing over one
 *   element's `(agentId, namespace, elementId)` identity so a renderer never
 *   has to reassemble the composite Pi UI action target itself;
 * - a namespace-aware `Logger` (plan.md §7.3) pre-tagged with `ns`/`kind`/
 *   `elementId` fields;
 * - the payload size cap (plan.md §11.4 "payload size limits").
 *
 * Individual kind renderers (`status`, `widget`, `progress`, ... — T29A2,
 * T29A3, T29B1-T29B4) live under `./renderers/` and call
 * `piUiRendererRegistry.register(kind, Component)` to populate this map.
 * This module never imports from `./renderers/` — a kind with nothing
 * registered yet renders through `registry-view.tsx`'s unknown-kind
 * fallback, which is exactly how a genuinely unrecognized kind (one outside
 * plan.md §11.3's frozen ten) behaves too.
 */

import type { ComponentType } from "react";

import type { Logger, extensions } from "@picompanion/frontend-core";
import type {
  PiUiAction,
  PiUiElement,
  PiUiElementPayload,
  PiUiKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

type ExtensionActionState = extensions.ExtensionActionState;
type ExtensionActionTarget = extensions.ExtensionActionTarget;
type SettledExtensionAction = extensions.SettledExtensionAction;

/** The typed payload for one specific `PiUiKind`, narrowed from the union. */
export type PiUiPayloadForKind<K extends PiUiKind> = Extract<PiUiElementPayload, { kind: K }>;

/** Extra input a renderer may pass through when dispatching one of its actions. */
export interface PiUiDispatchActionOptions {
  /** The `PiUiAction` being dispatched, when known (drives the confirmation gate). */
  action?: PiUiAction;
  payload?: Record<string, unknown>;
  /** Must be `true` when `action.confirm` is set; see `ExtensionActionController.dispatch`. */
  confirmed?: boolean;
  /**
   * Overrides the wire `elementId` this one dispatch targets, e.g.
   * `${element.id}#${rowId}` for a `roster` row action (T29B1; plan.md
   * §4.2/§12.3 "composite `ns:id[#rowId]:actionId` identity"). Defaults to
   * the bound element's own bare id, which is every other kind's whole
   * story — only `roster` currently has sub-element action targets.
   */
  elementId?: string;
}

/**
 * Dispatches one action for the element a renderer was given, already bound
 * to that element's composite `(agentId, namespace, elementId)` identity.
 */
export type PiUiDispatchAction = (
  actionId: string,
  options?: PiUiDispatchActionOptions,
) => Promise<SettledExtensionAction>;

/** Props every registered kind renderer receives. */
export interface PiUiElementRendererProps<K extends PiUiKind = PiUiKind> {
  /** The full element envelope, e.g. for `title`/`actions`/`placement`. */
  element: PiUiElement;
  /** The validated canonical payload for this element's kind. */
  payload: PiUiPayloadForKind<K>;
  /** Current known Pi UI Bridge revision for this element's agent, if available. */
  revision: number | undefined;
  dispatchAction: PiUiDispatchAction;
  /**
   * Current pending/settled state of one of this element's actions. The
   * optional second argument mirrors `PiUiDispatchActionOptions.elementId`
   * above — pass the same override used to dispatch a row-scoped action to
   * read back that row's own pending/settled state, distinct from another
   * row's use of the same `actionId` (T29B1).
   */
  getActionState: (actionId: string, elementId?: string) => ExtensionActionState;
  /** Pre-tagged with `ns`, `kind`, and `elementId` fields. */
  logger: Logger;
}

/** A registered renderer component for one `PiUiKind`. */
export type PiUiKindRenderer<K extends PiUiKind = PiUiKind> = ComponentType<
  PiUiElementRendererProps<K>
>;

/**
 * `kind -> component` lookup table (plan.md §11.4). One renderer per known
 * kind; `register` overwrites any prior registration for that kind so a
 * conformance/replacement pass never has to touch this file.
 */
export class PiUiRendererRegistry {
  private readonly renderers = new Map<PiUiKind, PiUiKindRenderer<PiUiKind>>();

  register<K extends PiUiKind>(kind: K, renderer: PiUiKindRenderer<K>): void {
    this.renderers.set(kind, renderer as unknown as PiUiKindRenderer<PiUiKind>);
  }

  get<K extends PiUiKind>(kind: K): PiUiKindRenderer<K> | undefined {
    return this.renderers.get(kind) as PiUiKindRenderer<K> | undefined;
  }

  has(kind: PiUiKind): boolean {
    return this.renderers.has(kind);
  }

  /** Every kind currently registered, in registration order. */
  kinds(): PiUiKind[] {
    return [...this.renderers.keys()];
  }

  /** Removes every registration. Test-only escape hatch. */
  clear(): void {
    this.renderers.clear();
  }
}

/**
 * Process-wide registry singleton. `apps/web`'s per-kind renderer modules
 * import this and register themselves at module load; `registry-view.tsx`
 * reads from it when rendering one live element.
 */
export const piUiRendererRegistry = new PiUiRendererRegistry();

/**
 * Payload size cap (plan.md §11.4). 64 KiB comfortably covers every
 * canonical-payload fixture in `@picompanion/protocol` (the largest is a few
 * hundred bytes) while still catching a runaway `log`/`markdown`/`roster`
 * payload before it reaches the DOM.
 */
export const PI_UI_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Approximate on-the-wire byte size of a payload. `TextEncoder` measures
 * UTF-8 bytes (matching how the daemon would have sized the JSON it sent)
 * rather than UTF-16 code units, so a payload of mostly non-Latin text is
 * not undercounted relative to the wire.
 */
export function estimatePiUiPayloadBytes(payload: unknown): number {
  if (payload === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    // Circular or otherwise unstringifiable payload: treat as oversized
    // rather than throwing out of a size check.
    return Number.POSITIVE_INFINITY;
  }
}

export function isPiUiPayloadOversized(
  payload: unknown,
  maxBytes: number = PI_UI_MAX_PAYLOAD_BYTES,
): boolean {
  return estimatePiUiPayloadBytes(payload) > maxBytes;
}

/** Composes an `ExtensionActionTarget` for one element's action. */
export function piUiActionTarget(
  agentId: string,
  element: Pick<PiUiElement, "ns" | "id">,
  actionId: string,
): ExtensionActionTarget {
  return { agentId, namespace: element.ns, elementId: element.id, actionId };
}
