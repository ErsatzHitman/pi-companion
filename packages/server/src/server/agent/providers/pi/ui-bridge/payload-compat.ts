// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
//
// Daemon-boundary normalization and dual emission for Pi UI element payloads
// (plan.md §4.2, steps 4-6).
//
// The shared wire schema in `@picompanion/protocol/pi-ui-bridge/schema` stays a
// plain, transform-free, permissive envelope on purpose: `payload` is optional
// there and nothing rewrites it. All translation between the v1 top-level
// projection (`text`, `lines`, `rows`, `sections`, `value`, `fields`, ...) and
// the canonical typed `payload` happens here, at the daemon boundary:
//
//   inbound  (helper -> daemon): `normalizePiUiElementInput` runs in
//            `PiUiDecoder` *before* protocol validation, so both old helper
//            messages and canonical payload messages are accepted and stored
//            with a canonical `payload` attached.
//   outbound (daemon -> client): `projectPiUiElementForClient` emits the
//            canonical `payload` to clients that negotiated
//            `CLIENT_CAPS.piUiPayloadV2` and the legacy top-level projection to
//            everyone else.
//
// Nothing here throws: a shape the daemon does not recognise is passed through
// untouched rather than dropped, because losing helper data is the exact bug
// this module exists to fix.

import type { PiUiKind } from "@picompanion/protocol/pi-ui-bridge/schema";
import {
  PI_UI_PAYLOAD_KINDS,
  PiUiLeafPayloadSchema,
  piUiPayloadSchemaForKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

type Record_ = Record<string, unknown>;

/** Envelope keys that never move into or out of a payload. */
const ENVELOPE_KEYS = new Set([
  "id",
  "ns",
  "kind",
  "placement",
  "title",
  "actions",
  "ttl",
  "durable",
  "payload",
]);

/**
 * Top-level v1 fields that belong in each kind's canonical payload.
 *
 * Only the fields the frozen v1 vocabulary actually used (plan.md §11.3 and the
 * reference `packages/pi-bridge` helper) are listed. Unlisted extras stay on the
 * envelope: the wire schema is passthrough, so they still reach the client.
 */
const V1_PAYLOAD_FIELDS: Record<PiUiKind, readonly string[]> = {
  status: ["text", "detail", "tone", "icon"],
  widget: ["text", "lines", "rows"],
  panel: ["sections", "text"],
  progress: ["label", "detail", "value", "max", "indeterminate"],
  roster: ["rows"],
  log: ["lines", "tail", "mono"],
  markdown: ["text"],
  diff: ["unifiedDiff", "diff", "filePath", "language"],
  form: ["fields", "description", "submitLabel"],
  composer: ["text", "hint", "mode", "previousText"],
};

/** Per-kind renames applied when lifting v1 top-level fields into a payload. */
const V1_FIELD_ALIASES: Partial<Record<PiUiKind, Readonly<Record<string, string>>>> = {
  // The v1 helper accepted `diff` as a synonym for the canonical `unifiedDiff`.
  diff: { diff: "unifiedDiff" },
};

const KNOWN_KINDS = new Set<string>(PI_UI_PAYLOAD_KINDS);

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elementKind(raw: Record_): PiUiKind | undefined {
  const kind = raw.kind;
  return typeof kind === "string" && KNOWN_KINDS.has(kind) ? (kind as PiUiKind) : undefined;
}

/* -------------------------------------------------------------------------- */
/* inbound: v1 top-level -> canonical payload                                 */
/* -------------------------------------------------------------------------- */

/**
 * Collects the v1 top-level fields of `raw` into a candidate payload object.
 * Fields already present on `base` (a canonical payload sent by a new helper)
 * win, so normalization never overwrites what the helper explicitly said.
 */
function liftV1Fields(raw: Record_, kind: PiUiKind, base: Record_): Record_ {
  const aliases = V1_FIELD_ALIASES[kind] ?? {};
  const candidate: Record_ = { ...base, kind };
  for (const field of V1_PAYLOAD_FIELDS[kind]) {
    const value = raw[field];
    if (value === undefined) continue;
    const target = aliases[field] ?? field;
    if (candidate[target] !== undefined) continue;
    candidate[target] = value;
  }
  return candidate;
}

/**
 * Normalizes one raw panel section. v1 helpers described sections as full
 * elements with top-level payload fields; the canonical form is a section that
 * carries its own leaf `payload`.
 */
function normalizeSection(rawSection: unknown): unknown {
  if (!isRecord(rawSection)) return rawSection;
  const kind = elementKind(rawSection);
  // Panels do not nest (plan.md §11.3): a section kind of `panel` is not a leaf.
  if (!kind || kind === "panel") return rawSection;

  const existing = isRecord(rawSection.payload) ? rawSection.payload : {};
  const candidate = liftV1Fields(rawSection, kind, existing);
  const parsed = PiUiLeafPayloadSchema.safeParse(candidate);
  if (!parsed.success) return rawSection;
  return { ...rawSection, payload: parsed.data };
}

/**
 * Attaches a canonical `payload` to a raw Pi UI element, in place of nothing —
 * the v1 top-level fields are deliberately left where they are so the legacy
 * projection survives until `projectPiUiElementForClient` decides which shape a
 * given client should see.
 *
 * Returns the input unchanged when it is not a recognisable element or when the
 * derived payload does not satisfy its typed schema (an incomplete helper
 * element must still reach the client rather than be rejected).
 */
export function normalizePiUiElementInput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const kind = elementKind(raw);
  if (!kind) return raw;

  const existing = isRecord(raw.payload) ? raw.payload : {};
  // A payload whose discriminator disagrees with the element kind is treated as
  // untyped extra data: keep its fields, but re-stamp the authoritative kind.
  const base: Record_ = { ...existing };
  delete base.kind;

  let candidate = liftV1Fields(raw, kind, base);
  if (kind === "panel" && Array.isArray(candidate.sections)) {
    candidate = { ...candidate, sections: candidate.sections.map(normalizeSection) };
  }

  const parsed = piUiPayloadSchemaForKind(kind).safeParse(candidate);
  if (!parsed.success) return raw;
  return { ...raw, payload: parsed.data };
}

/** Normalizes every element of a `sync` op, preserving order. */
export function normalizePiUiElementInputs(raw: unknown[]): unknown[] {
  return raw.map(normalizePiUiElementInput);
}

/* -------------------------------------------------------------------------- */
/* outbound: canonical payload <-> v1 top-level projection                    */
/* -------------------------------------------------------------------------- */

function stripLegacyFields(element: Record_, kind: PiUiKind): Record_ {
  const out: Record_ = { ...element };
  const aliases = V1_FIELD_ALIASES[kind] ?? {};
  for (const field of V1_PAYLOAD_FIELDS[kind]) {
    if (ENVELOPE_KEYS.has(field)) continue;
    delete out[field];
    const alias = aliases[field];
    if (alias && !ENVELOPE_KEYS.has(alias)) delete out[alias];
  }
  return out;
}

/** Spreads a payload's fields back onto an element/section as v1 top-level keys. */
function applyLegacyProjection(target: Record_, payload: Record_): Record_ {
  const out: Record_ = { ...target };
  for (const [key, value] of Object.entries(payload)) {
    if (key === "kind" || ENVELOPE_KEYS.has(key)) continue;
    if (out[key] === undefined) out[key] = value;
  }
  return out;
}

function downgradeSection(section: unknown): unknown {
  if (!isRecord(section)) return section;
  const payload = section.payload;
  if (!isRecord(payload)) return section;
  const out = applyLegacyProjection(section, payload);
  delete out.payload;
  return out;
}

/**
 * Projects one element for a single client.
 *
 * - `supportsPayloadV2 === true`: the canonical `payload` is authoritative and
 *   the duplicated v1 top-level fields are dropped.
 * - `supportsPayloadV2 === false`: `payload` is removed and its fields are
 *   projected back to the top level, so a client that predates
 *   `piUiPayloadV2` sees exactly the v1 shape it already understands — even
 *   when the element came from a new, payload-only helper.
 */
export function projectPiUiElementForClient<T>(element: T, supportsPayloadV2: boolean): T {
  if (!isRecord(element)) return element;
  const kind = elementKind(element);
  if (!kind) return element;

  if (supportsPayloadV2) {
    const normalized = normalizePiUiElementInput(element);
    if (!isRecord(normalized) || !isRecord(normalized.payload)) return element;
    return stripLegacyFields(normalized, kind) as T;
  }

  const payload = element.payload;
  if (!isRecord(payload)) return element;
  let out = applyLegacyProjection(element, payload);
  delete out.payload;
  if (kind === "panel" && Array.isArray(out.sections)) {
    out = { ...out, sections: out.sections.map(downgradeSection) };
  }
  if (kind === "diff" && out.unifiedDiff !== undefined && out.diff === undefined) {
    // v1 helpers and clients also used the shorter `diff` key.
    out.diff = out.unifiedDiff;
  }
  return out as T;
}

function projectElements(elements: unknown, supportsPayloadV2: boolean): unknown {
  if (!Array.isArray(elements)) return elements;
  return elements.map((element) => projectPiUiElementForClient(element, supportsPayloadV2));
}

/**
 * Projects a `pi_ui_state`/`pi_ui_snapshot` state object for one client.
 * Returns the same reference when nothing changed.
 */
export function projectPiUiStateForClient<T>(state: T, supportsPayloadV2: boolean): T {
  if (!isRecord(state) || !Array.isArray(state.elements)) return state;
  return { ...state, elements: projectElements(state.elements, supportsPayloadV2) } as T;
}

/** Projects a `pi_ui_delta` delta for one client. */
export function projectPiUiDeltaForClient<T>(delta: T, supportsPayloadV2: boolean): T {
  if (!isRecord(delta)) return delta;
  switch (delta.op) {
    case "upsert":
      return {
        ...delta,
        element: projectPiUiElementForClient(delta.element, supportsPayloadV2),
      } as T;
    case "reset":
      return { ...delta, elements: projectElements(delta.elements, supportsPayloadV2) } as T;
    default:
      return delta;
  }
}
