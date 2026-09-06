/**
 * Android redacted diagnostics export bundle — plan.md §13 Phase 7
 * ("exportable redacted logs"), T42A3.
 *
 * **This is a re-implementation, not a shared module.**
 * `apps/web/src/features/diagnostics/diagnostics-export.ts` (T41B2/T41B3)
 * lives only under `apps/web/src` — not in `@picompanion/frontend-core`
 * — and `apps/web`/`apps/android` never import each other's `src` (see
 * `diagnostics-model.ts`'s header comment for the same boundary). T42A3's
 * own brief anticipated exactly this: "If they currently live only under
 * apps/web/src, say so plainly in your report and mirror the behaviour
 * with tests that assert each forbidden category independently — do not
 * quietly copy the file." This module mirrors that file's REDACTION
 * GUARANTEE and BOUNDING BEHAVIOUR deliberately — same two independent
 * layers, same per-field/whole-bundle byte caps, same "throw, never warn
 * and ship" policy — written fresh against Android's own
 * `DiagnosticsSection[]` shape, with its own independent test file
 * (`diagnostics-export.test.ts`) proving each forbidden category
 * (password, key, prompt text, file content) rather than importing web's
 * tests or fixtures. See this task's report for the exact seam a future
 * task could close by promoting this logic (it depends on nothing
 * Android- or web-specific — only on `DiagnosticsSection`'s plain-string
 * field shape) into `@picompanion/frontend-core`, where both apps could
 * import ONE implementation instead of two independently-tested ones.
 *
 * ## Where secrets actually enter (Android's version of web's analysis)
 *
 * - `connection/endpoint` (`diagnostics-model.ts`'s
 *   `endpointForCurrentConnection`) renders `HostProfileRecord.endpoint`
 *   VERBATIM (`features/connect/credential-store.ts`). That field is
 *   typed as a plain string with no runtime shape guarantee beyond
 *   `features/connect/connect-form-model.ts`'s own input parsing for a
 *   value typed into THIS app's connect form — not every way a
 *   `HostProfileRecord` can come to exist (a relay pairing offer, a
 *   future import, or a hand-constructed profile all produce the same
 *   plain-string field with no re-validation here). A `host:port`/URL
 *   string can carry credentials in userinfo or a token in a query
 *   string or fragment. This is the one live, reachable vector in
 *   today's Android snapshot, and `redactEndpointLikeValue` below is
 *   written directly against it — byte-for-byte the same shape rule
 *   web's own `redactEndpointLikeValue` uses, because the vector
 *   (an endpoint-shaped string) is identical on both platforms.
 * - `HostProfileRecord` otherwise carries no secrets by that module's
 *   own design doc: passwords and the relay E2EE pin are addressed by
 *   profile id through `SecureStorage` instead and never reach this
 *   object, so no other `HostProfileRecord`-sourced field (label,
 *   connection kind) needs a redaction rule.
 * - `ServerInfoStatusPayload` (`packages/protocol/src/messages.ts`) is
 *   read field-by-field by `diagnostics-model.ts`, never spread — same
 *   analysis as web's file, since both models read the identical shared
 *   protocol type the identical way.
 * - **Prompts and file content are not in this bundle.** Nothing
 *   `buildDiagnosticsSnapshot` reads today carries either — see that
 *   module's own header comment for the exhaustive list of its four real
 *   sources. Said explicitly via `DIAGNOSTICS_EXPORT_NOT_COLLECTED`
 *   rather than tested by an assertion with nothing to find in its
 *   input.
 *
 * ## Redaction failures fail the build, not just warn
 *
 * Two independent layers, both required to pass for a bundle to exist —
 * identical structure to web's module:
 *
 * 1. **Per-field rules** (`FIELD_REDACTORS`): `redactEndpointLikeValue`
 *    parses the known vector and rewrites it, then `applyFieldRedaction`
 *    immediately checks that every substring it extracted as secret
 *    material is actually gone — if not, that is treated as "the rule
 *    could not be applied" and throws immediately.
 * 2. **A bundle-wide scan** (`assertNoResidualSecret`), run over every
 *    field's FINAL value regardless of whether a per-field rule touched
 *    it — catches a field nobody registered a rule for at all.
 *
 * Either layer throws `DiagnosticsExportRedactionError`. This function
 * never catches it and downgrades it to a logged warning with a partial
 * bundle returned.
 *
 * ## Bounding: redact first, decide size second
 *
 * Same two-step shape as web's module: per-field shortening
 * (`DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES`) runs first, then
 * whole-bundle dropping (`DIAGNOSTICS_EXPORT_MAX_BYTES`), last-to-first,
 * with one aggregated note per affected section rather than one note per
 * dropped field (see `summarizeDrops`'s own comment for why an
 * unaggregated version can make the bounding loop fail to converge).
 * Only the field/section id, label, and count are ever named in a note —
 * never the value that was removed.
 */
import type { DiagnosticsField, DiagnosticsSection } from "./diagnostics-model.js";

export interface DiagnosticsExportField {
  id: string;
  label: string;
  value: string;
  /** True when this field's value was rewritten by a redaction rule before being included. */
  redacted: boolean;
}

export interface DiagnosticsExportSection {
  id: string;
  title: string;
  fields: DiagnosticsExportField[];
}

export interface DiagnosticsExportMeta {
  appVersion: string;
  clientId: string;
  /** ISO-8601 timestamp. Caller-supplied rather than this module calling `Date.now()` itself, so tests fully control it. */
  exportedAt: string;
}

export const DIAGNOSTICS_EXPORT_KIND = "picompanion-diagnostics-export";
export const DIAGNOSTICS_EXPORT_FORMAT_VERSION = 1;

/**
 * Categories T42A3's acceptance criterion names ("no passwords, keys,
 * prompt text or file content") that today's Android snapshot never
 * carries in the first place — see this module's header comment.
 * Carried inside the bundle itself so a reader of the exported JSON sees
 * the disclosure without needing this source file.
 */
export const DIAGNOSTICS_EXPORT_NOT_COLLECTED: readonly string[] = [
  "Prompt text — no source `buildDiagnosticsSnapshot` reads carries prompt content",
  "File content — no source `buildDiagnosticsSnapshot` reads carries file bytes or paths",
];

/** Per-field byte cap, checked BEFORE the whole-bundle cap below. Matches web's own constant value — every field this app's own snapshot produces today is a version string, a status word, a hostname, or a short sentence. */
export const DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES = 4 * 1024;

/** Whole-bundle byte cap on the final serialized JSON. Matches web's own constant value — three sections, a few dozen fields, each far under the per-field cap. */
export const DIAGNOSTICS_EXPORT_MAX_BYTES = 64 * 1024;

export interface DiagnosticsExportTruncation {
  truncated: boolean;
  notes: string[];
}

export interface DiagnosticsExportBundle {
  kind: typeof DIAGNOSTICS_EXPORT_KIND;
  formatVersion: typeof DIAGNOSTICS_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  appVersion: string;
  clientId: string;
  notCollected: readonly string[];
  truncation: DiagnosticsExportTruncation;
  sections: DiagnosticsExportSection[];
}

/**
 * Thrown by `buildDiagnosticsExportBundle` instead of shipping a field a
 * redaction rule could not fully clean, or that no rule was registered
 * for despite carrying secret-shaped content. Never caught internally
 * and downgraded to a warning.
 */
export class DiagnosticsExportRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosticsExportRedactionError";
  }
}

interface EndpointRedactionResult {
  value: string;
  removed: string[];
}

/** Same shape rule as web's `ENDPOINT_SHAPE` — see that module's own comment for why each group is optional and why a value with spaces (every "Not connected" sentence this model renders) never matches. */
const ENDPOINT_SHAPE =
  /^(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(?:(?<userinfo>[^@/?#\s]+)@)?(?<hostport>[^/?#\s]*)(?<pathPart>\/[^?#]*)?(?<queryPart>\?[^#]*)?(?<fragmentPart>#.*)?$/;

/** Actively rewrites userinfo, the query string, and the fragment of an endpoint-shaped value. The host/port/scheme/path — the part actually useful for diagnosis — is preserved verbatim. */
function redactEndpointLikeValue(raw: string): EndpointRedactionResult {
  const match = ENDPOINT_SHAPE.exec(raw);
  if (!match?.groups) return { value: raw, removed: [] };
  const {
    scheme = "",
    userinfo,
    hostport = "",
    pathPart = "",
    queryPart,
    fragmentPart,
  } = match.groups;
  const removed: string[] = [];
  let rebuilt = scheme;
  if (userinfo) {
    removed.push(userinfo);
    rebuilt += "[redacted]@";
  }
  rebuilt += hostport + pathPart;
  if (queryPart) {
    removed.push(queryPart.slice(1));
    rebuilt += "?[redacted]";
  }
  if (fragmentPart) {
    removed.push(fragmentPart.slice(1));
    rebuilt += "#[redacted]";
  }
  return { value: rebuilt, removed };
}

type FieldRedactor = (value: string) => EndpointRedactionResult;

/** Keyed by `${sectionId}/${fieldId}` — `diagnostics-model.ts`'s stable ids, never a display label. */
const FIELD_REDACTORS: Readonly<Record<string, FieldRedactor>> = {
  "connection/endpoint": redactEndpointLikeValue,
};

/** Applies a field's registered redactor (if any) and immediately verifies every secret substring it claims to have removed is actually gone from the result. */
function applyFieldRedaction(sectionId: string, field: DiagnosticsField): DiagnosticsExportField {
  const redactor = FIELD_REDACTORS[`${sectionId}/${field.id}`];
  if (!redactor) {
    return { ...field, redacted: false };
  }
  const { value, removed } = redactor(field.value);
  for (const secret of removed) {
    if (secret.length > 0 && value.includes(secret)) {
      throw new DiagnosticsExportRedactionError(
        `Redaction rule for "${sectionId}/${field.id}" did not remove its own extracted secret ` +
          "material — refusing to export rather than shipping it unredacted.",
      );
    }
  }
  return { ...field, value, redacted: value !== field.value };
}

// Second, independent layer — same three patterns as web's module.
const RESIDUAL_CREDENTIALED_URL = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?#@]+:[^\s/?#@]+@/;
const RESIDUAL_BARE_USERINFO = /(?:^|\s)[^\s/?#@:]+:[^\s/?#@]+@[^\s/?#@]/;
const RESIDUAL_QUERY_SECRET =
  /[?&](?:token|password|pwd|secret|key|auth|api[-_]?key|access[-_]?token)=/i;

function assertNoResidualSecret(section: DiagnosticsExportSection): void {
  for (const field of section.fields) {
    if (
      RESIDUAL_CREDENTIALED_URL.test(field.value) ||
      RESIDUAL_BARE_USERINFO.test(field.value) ||
      RESIDUAL_QUERY_SECRET.test(field.value)
    ) {
      throw new DiagnosticsExportRedactionError(
        `Field "${section.id}/${field.id}" still carries secret-shaped content after redaction ` +
          "— refusing to export rather than shipping it with a warning.",
      );
    }
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  const sliced = bytes.slice(0, Math.max(0, maxBytes));
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced).replace(/�+$/u, "");
}

function shortenOversizedField(
  sectionId: string,
  field: DiagnosticsExportField,
): { field: DiagnosticsExportField; note: string | null } {
  const bytes = byteLength(field.value);
  if (bytes <= DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES) {
    return { field, note: null };
  }
  const marker = ` …[truncated: ${bytes} bytes shown as ${DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES}]`;
  const keptBudget = Math.max(0, DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES - byteLength(marker));
  const value = truncateUtf8(field.value, keptBudget) + marker;
  return {
    field: { ...field, value },
    note:
      `Shortened "${sectionId}/${field.id}" (${field.label}): ${bytes} bytes exceeded the ` +
      `${DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES}-byte per-field limit.`,
  };
}

function dropLastField(sections: DiagnosticsExportSection[]): {
  sections: DiagnosticsExportSection[];
  sectionId: string;
  sectionTitle: string;
  field: DiagnosticsExportField;
} | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]!;
    if (section.fields.length === 0) continue;
    const field = section.fields[section.fields.length - 1]!;
    const nextSections = sections.slice();
    nextSections[i] = { ...section, fields: section.fields.slice(0, -1) };
    return { sections: nextSections, sectionId: section.id, sectionTitle: section.title, field };
  }
  return null;
}

interface SectionDropRecord {
  sectionTitle: string;
  droppedIds: string[];
}

/** One note per affected SECTION, never one note per dropped field — otherwise a pathological many-field input can make the notes list itself grow faster than dropping fields shrinks the bundle, so the loop never converges (the exact bug web's T41B3 found and named in its own comment). */
function summarizeDrops(records: Map<string, SectionDropRecord>): string[] {
  const notes: string[] = [];
  for (const [sectionId, record] of records) {
    if (record.droppedIds.length === 0) continue;
    const firstDropped = record.droppedIds[0]!;
    const lastDropped = record.droppedIds[record.droppedIds.length - 1]!;
    notes.push(
      `Dropped ${record.droppedIds.length} field(s) from section "${sectionId}" (${record.sectionTitle}), ` +
        `spanning "${sectionId}/${lastDropped}" through "${sectionId}/${firstDropped}", to fit the ` +
        `${DIAGNOSTICS_EXPORT_MAX_BYTES}-byte bundle limit.`,
    );
  }
  return notes;
}

function assembleBundle(
  sections: DiagnosticsExportSection[],
  notes: string[],
  meta: DiagnosticsExportMeta,
): DiagnosticsExportBundle {
  return {
    kind: DIAGNOSTICS_EXPORT_KIND,
    formatVersion: DIAGNOSTICS_EXPORT_FORMAT_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    clientId: meta.clientId,
    notCollected: DIAGNOSTICS_EXPORT_NOT_COLLECTED,
    truncation: { truncated: notes.length > 0, notes },
    sections,
  };
}

function boundExportSections(
  sections: DiagnosticsExportSection[],
  meta: DiagnosticsExportMeta,
): { sections: DiagnosticsExportSection[]; truncation: DiagnosticsExportTruncation } {
  const fieldNotes: string[] = [];

  let working = sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const { field: shortened, note } = shortenOversizedField(section.id, field);
      if (note) fieldNotes.push(note);
      return shortened;
    }),
  }));

  const dropRecords = new Map<string, SectionDropRecord>();
  const currentNotes = (): string[] => [...fieldNotes, ...summarizeDrops(dropRecords)];
  const currentBundleBytes = (): number =>
    byteLength(JSON.stringify(assembleBundle(working, currentNotes(), meta), null, 2));

  while (currentBundleBytes() > DIAGNOSTICS_EXPORT_MAX_BYTES) {
    const dropped = dropLastField(working);
    if (!dropped) break;
    working = dropped.sections;
    const record = dropRecords.get(dropped.sectionId) ?? {
      sectionTitle: dropped.sectionTitle,
      droppedIds: [],
    };
    record.droppedIds.push(dropped.field.id);
    dropRecords.set(dropped.sectionId, record);
  }

  const notes = currentNotes();
  return { sections: working, truncation: { truncated: notes.length > 0, notes } };
}

/**
 * Builds the redacted, bounded export bundle from the same sections
 * `DiagnosticsScreen` renders. Throws `DiagnosticsExportRedactionError`
 * — never returns a bundle with an unredacted field — the moment either
 * redaction layer above finds secret-shaped content it cannot account
 * for.
 */
export function buildDiagnosticsExportBundle(
  sections: DiagnosticsSection[],
  meta: DiagnosticsExportMeta,
): DiagnosticsExportBundle {
  const exportSections = sections.map((section) => {
    const fields = section.fields.map((field) => applyFieldRedaction(section.id, field));
    const exportSection: DiagnosticsExportSection = {
      id: section.id,
      title: section.title,
      fields,
    };
    assertNoResidualSecret(exportSection);
    return exportSection;
  });

  const { sections: boundedSections, truncation } = boundExportSections(exportSections, meta);

  return assembleBundle(boundedSections, truncation.notes, meta);
}

/** Serializes a bundle to pretty-printed JSON — the text `use-diagnostics-export.ts` hands to `Sharing.shareText`. */
export function serializeDiagnosticsExportBundle(bundle: DiagnosticsExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}
