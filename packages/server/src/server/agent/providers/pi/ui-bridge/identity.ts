/**
 * Pi UI element identity and action routing identity (plan.md §4.2).
 *
 * Two rules drive this module:
 *
 * 1. **`ns:id` identity is preserved everywhere.** `ns` is mandatory on the
 *    wire precisely because two extensions may both use `id: "main"`; the
 *    daemon therefore keys state, deltas, and removals on the composite
 *    `ns:id` key and never on a bare element id.
 * 2. **Action routing uses composite element identity.** A tap is addressed by
 *    `ns`, `id`, an optional roster `rowId`, and the `actionId`. The daemon
 *    resolves that composite against its own state before it prompts Pi, so a
 *    bare id can never dispatch into another namespace.
 *
 * Wire form of a composite element id: `ns:id`, optionally suffixed with
 * `#rowId` for a per-row roster action. A value with no `:` is a legacy bare
 * id; it is accepted at the boundary but must be resolved against the state
 * store (and rejected when ambiguous) before it is used for routing.
 */

/** Separates `ns` from `id` in a composite element id. */
export const PIUI_NS_SEPARATOR = ":";

/** Separates the element part from a roster `rowId` in a composite id. */
export const PIUI_ROW_SEPARATOR = "#";

/** A parsed composite element id. `ns` is absent for a legacy bare id. */
export type PiUiCompositeId = {
  ns?: string;
  id: string;
  rowId?: string;
};

/** A fully resolved routing target: never a bare element id. */
export type PiUiActionTarget = {
  ns: string;
  id: string;
  /** `ns:id` — the state-store key for this element. */
  elementKey: string;
  kind: string;
  rowId?: string;
  actionId: string;
  /** `ns:id[#rowId]:actionId` — stable identity of one dispatchable action. */
  actionKey: string;
};

/** Builds the state-store key for an element. */
export function elementKeyOf(ns: string, id: string): string {
  return `${ns}${PIUI_NS_SEPARATOR}${id}`;
}

/**
 * Parses a wire element id into its parts.
 *
 * `ns` is the segment before the first `:` — element ids may themselves
 * contain `:`, namespaces may not. Returns `null` when the input is empty or
 * has an empty component.
 */
export function parseCompositeElementId(raw: string): PiUiCompositeId | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let elementPart = trimmed;
  let rowId: string | undefined;
  const rowAt = trimmed.indexOf(PIUI_ROW_SEPARATOR);
  if (rowAt !== -1) {
    elementPart = trimmed.slice(0, rowAt);
    rowId = trimmed.slice(rowAt + 1);
    if (rowId.length === 0) return null;
  }
  if (elementPart.length === 0) return null;

  const nsAt = elementPart.indexOf(PIUI_NS_SEPARATOR);
  if (nsAt === -1) {
    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    // Legacy bare element id from a client that predates composite identity.
    return { id: elementPart, ...(rowId ? { rowId } : {}) };
  }
  const ns = elementPart.slice(0, nsAt);
  const id = elementPart.slice(nsAt + 1);
  if (ns.length === 0 || id.length === 0) return null;
  return { ns, id, ...(rowId ? { rowId } : {}) };
}

/** Formats a composite element id for the wire. */
export function formatCompositeElementId(parts: {
  ns: string;
  id: string;
  rowId?: string;
}): string {
  const base = elementKeyOf(parts.ns, parts.id);
  return parts.rowId ? `${base}${PIUI_ROW_SEPARATOR}${parts.rowId}` : base;
}

/** Formats the composite identity of one dispatchable action. */
export function formatActionKey(parts: {
  ns: string;
  id: string;
  rowId?: string;
  actionId: string;
}): string {
  return `${formatCompositeElementId(parts)}${PIUI_NS_SEPARATOR}${parts.actionId}`;
}

/**
 * Builds the `/pi_ui_event` envelope for a resolved action target.
 *
 * The envelope always carries the composite identity (`ns`, `id`,
 * `elementKey`, optional `rowId`, `actionKey`). `elementId` stays the bare id
 * for helpers written against the v1 payload shape.
 */
export function buildPiUiActionEnvelope(input: {
  target: PiUiActionTarget;
  value?: unknown;
  requestId: string;
}): Record<string, unknown> {
  const { target } = input;
  return {
    v: 1,
    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    // Old helpers read the bare `elementId`; new helpers read `ns`/`id`.
    elementId: target.id,
    ns: target.ns,
    id: target.id,
    elementKey: target.elementKey,
    ...(target.rowId ? { rowId: target.rowId } : {}),
    actionId: target.actionId,
    actionKey: target.actionKey,
    value: input.value,
    requestId: input.requestId,
  };
}
