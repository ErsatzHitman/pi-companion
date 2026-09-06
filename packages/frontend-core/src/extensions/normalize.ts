// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
//
// Client-side canonical-payload normalization (plan.md §4.2 steps 1-6; T21B).
//
// The daemon boundary (`packages/server/.../pi/ui-bridge/payload-compat.ts`)
// normalizes inbound helper input into a canonical `payload` and, on the way
// out, projects either the canonical payload or the legacy v1 top-level
// projection depending on what the receiving client negotiated. A client that
// predates `piUiPayloadV2`, or a daemon that has not rolled the capability out
// yet, still emits the pre-`payload` shape: `text`, `lines`, `rows`,
// `sections`, `value`, `fields`, and the per-kind extras below, sitting
// directly on the element instead of inside `payload`.
//
// This module is the client-side mirror of that inbound normalization step:
// given any element this client receives — one with a canonical `payload`
// already attached, one with only the legacy top-level fields, or one with
// both — it derives a canonical `payload` so every downstream consumer
// (renderers, view models) only ever has to read one shape. It never throws:
// an element whose payload cannot be derived is returned unchanged rather
// than dropped, because losing helper data is the exact bug plan.md §4.2
// exists to fix.
//
// frontend-core cannot depend on `@picompanion/server`, so this table is
// re-expressed here rather than imported. It is kept in lockstep with the
// daemon's `V1_PAYLOAD_FIELDS`/`V1_FIELD_ALIASES` by the shared recorded
// fixtures in `@picompanion/protocol` and
// `packages/server/.../pi/ui-bridge/fixtures/payload-compat/`, which this
// package's tests replay directly.

import {
  PI_UI_PAYLOAD_KINDS,
  PiUiLeafPayloadSchema,
  piUiPayloadSchemaForKind,
  type PiUiElement,
  type PiUiKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

type Rec = Record<string, unknown>;

/**
 * Top-level v1 fields that belong in each kind's canonical payload. Only the
 * fields the frozen v1 vocabulary actually used (plan.md §11.3) are listed;
 * unlisted extras stay on the envelope untouched, since the wire schema is
 * passthrough and this normalizer never deletes anything from its input.
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
  // The v1 helper (and old daemons) used `diff` as a synonym for the
  // canonical `unifiedDiff`.
  diff: { diff: "unifiedDiff" },
};

const KNOWN_KINDS = new Set<string>(PI_UI_PAYLOAD_KINDS);

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elementKind(raw: Rec): PiUiKind | undefined {
  const kind = raw.kind;
  return typeof kind === "string" && KNOWN_KINDS.has(kind) ? (kind as PiUiKind) : undefined;
}

/**
 * Collects the v1 top-level fields of `raw` into a candidate payload object.
 * Fields already present on `base` (a canonical payload a new helper/daemon
 * already sent) win, so normalization never overwrites what was explicit.
 */
function liftV1Fields(raw: Rec, kind: PiUiKind, base: Rec): Rec {
  const aliases = V1_FIELD_ALIASES[kind] ?? {};
  const candidate: Rec = { ...base, kind };
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
 * Normalizes one raw `panel` section. A `panel` composes leaf kinds
 * (plan.md §11.3); v1 sections described those leaves with top-level payload
 * fields, so each section is normalized the same way as a top-level element.
 */
function normalizeSection(rawSection: unknown): unknown {
  if (!isRecord(rawSection)) return rawSection;
  const kind = elementKind(rawSection);
  if (!kind || kind === "panel") return rawSection;

  const existing = isRecord(rawSection.payload) ? rawSection.payload : {};
  const candidate = liftV1Fields(rawSection, kind, existing);
  const parsed = PiUiLeafPayloadSchema.safeParse(candidate);
  if (!parsed.success) return rawSection;
  return { ...rawSection, payload: parsed.data };
}

/**
 * Attaches a canonical `payload` to a raw Pi UI element for local use.
 *
 * Returns the input unchanged when it is not a recognizable element (unknown
 * `kind`) or when the derived candidate does not satisfy its typed payload
 * schema — an incomplete element must still reach the renderer registry
 * (which has its own unknown-shape fallback per plan.md §11.4) rather than be
 * silently dropped here.
 */
export function normalizePiUiElement(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const kind = elementKind(raw);
  if (!kind) return raw;

  const existing = isRecord(raw.payload) ? raw.payload : {};
  // A payload whose discriminator disagrees with the element kind is treated
  // as untyped extra data: keep its fields, but re-derive under the
  // authoritative envelope kind.
  const base: Rec = { ...existing };
  delete base.kind;

  let candidate = liftV1Fields(raw, kind, base);
  if (kind === "panel" && Array.isArray(candidate.sections)) {
    candidate = { ...candidate, sections: candidate.sections.map(normalizeSection) };
  }

  const parsed = piUiPayloadSchemaForKind(kind).safeParse(candidate);
  if (!parsed.success) return raw;
  return { ...raw, payload: parsed.data };
}

/** Normalizes every element of a `sync`/`reset` op or full state, in order. */
export function normalizePiUiElements(raw: readonly unknown[]): unknown[] {
  return raw.map(normalizePiUiElement);
}

/**
 * Typed convenience wrapper: normalizes and casts to `PiUiElement`.
 *
 * The wire envelope (`PiUiElementSchema`) is a permissive passthrough object
 * (plan.md §4.2), so any object already shaped like a `PiUiElement` — with or
 * without a canonical `payload` — round-trips through `normalizePiUiElement`
 * as a `PiUiElement`; this only narrows the type for callers that already
 * validated the envelope (e.g. via `PiUiElementSchema` upstream, as the wire
 * decoder does).
 */
export function normalizePiUiElementTyped(element: PiUiElement): PiUiElement {
  return normalizePiUiElement(element) as PiUiElement;
}
