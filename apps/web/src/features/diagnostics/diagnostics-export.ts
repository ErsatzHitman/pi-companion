/**
 * Redacted diagnostics export bundle — plan.md §13 Phase 7 ("exportable
 * redacted logs"), T41B2.
 *
 * Turns the same `DiagnosticsSection[]` `DiagnosticsScreen` already
 * renders (`diagnostics-model.ts`'s `buildDiagnosticsSnapshot`) into one
 * JSON-serializable bundle with every known secret-shaped vector
 * actively rewritten, then runs a SECOND, independent scan across every
 * field the bundle actually ships. A redaction rule that only partly
 * cleaned its field, or a field nobody registered a rule for, cannot
 * ship unredacted with a warning — `buildDiagnosticsExportBundle` throws
 * `DiagnosticsExportRedactionError` instead, and the whole export
 * refuses. See "Redaction failures fail the build" below.
 *
 * Framework-neutral like `diagnostics-model.ts` (no React, DOM, or
 * `@picompanion/client` runtime import) for the same reason: Android's
 * mirror (T42A3) can share this exact bundle shape. The download
 * mechanics (Blob, object URL, anchor click) live one layer up, in
 * `use-diagnostics-export.ts` — this module only builds and serializes
 * plain data.
 *
 * ## Where secrets actually enter (and where they provably do not)
 *
 * - `connection/endpoint` (`diagnostics-model.ts`'s
 *   `endpointForCurrentConnection`) renders `HostProfile.direct.endpoint`
 *   or `.relay.endpoint` VERBATIM. Both are typed as plain strings
 *   (`packages/frontend-core/src/hosts/types.ts`) with no runtime shape
 *   guarantee beyond `apps/web/src/features/connect/validate-connect-form.ts`'s
 *   own input parsing — and that parsing only covers addresses typed
 *   into THIS app's connect form, not every way a `HostProfile` can come
 *   to exist (a relay pairing offer, a future import, or a
 *   hand-constructed profile all produce the same plain-string field
 *   with no re-validation here). A `host:port`/URL string can carry
 *   credentials in its userinfo (`wss://user:secret@host/path`) or a
 *   token in its query string or fragment. This is the one live,
 *   reachable vector in today's snapshot, and `redactEndpointLikeValue`
 *   below is written directly against it.
 * - `HostProfile` otherwise carries no secrets by the type's own design
 *   doc (`hosts/types.ts`'s header comment): passwords and relay-
 *   authenticating material are addressed by profile id through
 *   `SecureStorage` instead and never reach this object, so no other
 *   `HostProfile`-sourced field (label, connection kind, timestamps)
 *   needs a redaction rule.
 * - `ServerInfoStatusPayload` (`packages/protocol/src/messages.ts`) is
 *   read field-by-field by `diagnostics-model.ts`, never spread: only
 *   `serverId`, `hostname`, `version`, `desktopManaged`,
 *   `features.<flag>` (booleans) and
 *   `capabilities.voice.{dictation,voice}.{enabled,reason}` (also plain
 *   booleans/strings) ever reach a `DiagnosticsField`. The wire schema
 *   declares `capabilities` `.passthrough()` — the daemon really can
 *   send extra, unvalidated keys there — but nothing in this app ever
 *   reads or forwards `capabilities` as a whole object, only those two
 *   named leaves, so that passthrough risk never reaches a rendered
 *   field or this export. If a future change ever does spread
 *   `capabilities` wholesale, the residual-secret scan below is the
 *   backstop, not the primary defence — the primary fix would be to not
 *   spread it.
 * - **Prompts and file content are not in this bundle.** Nothing
 *   `buildDiagnosticsSnapshot` reads today carries either — see
 *   `diagnostics-model.ts`'s own header comment for the exhaustive list
 *   of its four real sources (this app's own `hello` declaration,
 *   `HostControllerConnectionInfo`, `HostProfile`, `server_info`). This
 *   is said explicitly via `DIAGNOSTICS_EXPORT_NOT_COLLECTED` rather
 *   than tested by an assertion with nothing to find in its input.
 *
 * ## Redaction failures fail the build, not just warn
 *
 * Two independent layers, both required to pass for a bundle to exist:
 *
 * 1. **Per-field rules** (`FIELD_REDACTORS`, keyed by
 *    `${sectionId}/${fieldId}`): `redactEndpointLikeValue` parses the
 *    known vector and rewrites it, then `applyFieldRedaction`
 *    immediately checks that every substring it extracted as secret
 *    material is actually gone from the rewritten value — if the rule
 *    ran but left its own extracted secret in place, that is treated as
 *    "the rule could not be applied" and throws immediately, before any
 *    other field is even processed.
 * 2. **A bundle-wide scan** (`assertNoResidualSecret`), run over every
 *    field's FINAL value regardless of whether a per-field rule
 *    touched it. This is what catches a field nobody registered a rule
 *    for at all (a new section added later, or a rule that silently
 *    failed to run) — not just a rule that ran and failed.
 *
 * Either layer throws `DiagnosticsExportRedactionError`.
 * `buildDiagnosticsExportBundle` never catches it and downgrades it to
 * a logged warning with a partial bundle returned; callers
 * (`use-diagnostics-export.ts`) surface the throw as a visible failure
 * state, matching this repository's "a silent no-op is worse than a
 * visible failure" rule.
 *
 * ## Bounding (T41B3): redact first, decide size second
 *
 * `applyFieldRedaction`/`assertNoResidualSecret` above run over every
 * field's FULL, untruncated value — bounding never runs first and never
 * changes what gets redacted. Only once a field's final, safe value is
 * known does `boundExportSections` below decide whether it fits:
 *
 * 1. **Per-field shortening** (`DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES`):
 *    any single field value over the per-field byte cap is cut down and
 *    marked, so one runaway value (a long hostname, a verbose reason
 *    string) cannot silently consume the whole bundle's budget.
 * 2. **Whole-bundle dropping** (`DIAGNOSTICS_EXPORT_MAX_BYTES`): if the
 *    serialized bundle is still over budget after step 1 (e.g. a section
 *    with many small fields), whole fields are dropped, last-to-first in
 *    a fixed, input-derived order, until it fits.
 *
 * Every shortened field is named individually; every section that had
 * fields dropped gets ONE aggregated note (id count and range) rather
 * than one note per dropped field — a per-drop note would make the
 * disclosure itself grow without bound for a pathological many-field
 * input, which can make the bounding loop never converge (T41B3 hit this
 * directly; see `summarizeDrops`'s comment). Either way, only the
 * field/section id, label, and count are named — NEVER the value that
 * was removed — in `DiagnosticsExportBundle.truncation.notes`, which
 * ships INSIDE the bundle so a reader of the exported JSON sees the
 * disclosure without this source file, the same reasoning that put
 * `DIAGNOSTICS_EXPORT_NOT_COLLECTED` in the bundle rather than only in a
 * doc comment. Bounding always shortens/drops the in-memory CONTENT and
 * then calls `JSON.stringify` on the result — it never slices the
 * already-serialized string — so a truncated bundle is still valid JSON
 * and still carries `kind`, `formatVersion`, and the disclosure.
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
  /**
   * ISO-8601 timestamp. Caller-supplied rather than this module calling
   * `Date.now()`/`new Date()` itself, so tests (and T41B3's
   * reproducibility work) fully control it.
   */
  exportedAt: string;
}

export const DIAGNOSTICS_EXPORT_KIND = "picompanion-diagnostics-export";
export const DIAGNOSTICS_EXPORT_FORMAT_VERSION = 1;

/**
 * Categories T41B2's acceptance criterion names ("no passwords, keys,
 * prompts or file content") that today's snapshot never carries in the
 * first place — see this module's header comment. Carried inside the
 * bundle itself so a reader of the exported JSON sees the disclosure
 * without needing this source file.
 */
export const DIAGNOSTICS_EXPORT_NOT_COLLECTED: readonly string[] = [
  "Prompt text — no source `buildDiagnosticsSnapshot` reads carries prompt content",
  "File content — no source `buildDiagnosticsSnapshot` reads carries file bytes or paths",
];

/**
 * Per-field byte cap, checked BEFORE the whole-bundle cap below. 4 KiB is
 * far larger than any value this app's own snapshot ever produces today
 * (every field in `diagnostics-model.ts` is a version string, a status
 * word, a hostname, or a short sentence — all well under 200 bytes) while
 * still bounding the one kind of field this module cannot fully predict
 * the length of: a daemon-supplied string (`hostname`, a voice-capability
 * `reason`) or a user-chosen profile label, either of which a future
 * daemon or a pasted value could make arbitrarily long.
 */
export const DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES = 4 * 1024;

/**
 * Whole-bundle byte cap on the final serialized JSON. 64 KiB comfortably
 * fits every section `diagnostics-model.ts` builds today — three
 * sections, a few dozen fields, each far under the per-field cap above —
 * with roughly a 30x margin, while still being small enough to paste into
 * a chat message or an issue comment, which is this export's actual
 * delivery path (there is no server-side upload for it). A bundle this
 * size limit forces to drop fields is, by construction, one carrying far
 * more sections or capability flags than the app emits today.
 */
export const DIAGNOSTICS_EXPORT_MAX_BYTES = 64 * 1024;

export interface DiagnosticsExportTruncation {
  /** True the moment any field's value was shortened or any field was dropped entirely to fit a size bound. */
  truncated: boolean;
  /**
   * One human-readable entry per shortened or dropped field, naming only
   * its `${sectionId}/${fieldId}` and label — NEVER the value that was
   * removed, so the disclosure itself can never leak the content being
   * bounded.
   */
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
  /** Every secret substring this rule extracted, for `applyFieldRedaction`'s immediate self-check. */
  removed: string[];
}

/**
 * Matches an endpoint-shaped string in any of the forms this app or a
 * `HostProfile` can carry: bare `host:port`, `[ipv6]:port`, or a full
 * `scheme://user:pass@host:port/path?query#fragment` URL — with every
 * part after the host optional. A value with spaces in it (every
 * "Not connected"/"...not configured on this profile" sentence
 * `diagnostics-model.ts` renders) cannot satisfy `hostport`'s
 * whitespace-excluding character class followed by end-of-string, so
 * `.exec()` returns `null` for those and they pass through untouched —
 * correct, since they carry no host or credential material to redact.
 */
const ENDPOINT_SHAPE =
  /^(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(?:(?<userinfo>[^@/?#\s]+)@)?(?<hostport>[^/?#\s]*)(?<pathPart>\/[^?#]*)?(?<queryPart>\?[^#]*)?(?<fragmentPart>#.*)?$/;

/**
 * Actively rewrites the one live vector named in this module's header
 * comment: userinfo, the query string, and the fragment of an
 * endpoint-shaped value. The host/port/scheme/path — the part actually
 * useful for diagnosis — is preserved verbatim.
 */
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

/**
 * Keyed by `${sectionId}/${fieldId}` — `diagnostics-model.ts`'s stable
 * ids, never a display label, so relabelling a field in the UI can
 * never silently drop its redaction coverage.
 */
const FIELD_REDACTORS: Readonly<Record<string, FieldRedactor>> = {
  "connection/endpoint": redactEndpointLikeValue,
};

/**
 * Applies a field's registered redactor (if any) and immediately
 * verifies every secret substring it claims to have removed is actually
 * gone from the result. A rule that ran but left its own extracted
 * secret in the output is exactly the "redaction rule cannot be
 * applied" case this task's acceptance criterion names — it throws
 * rather than returning the unredacted value with a flag.
 */
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

// Second, independent layer: scans every field's FINAL value for
// secret-shaped content regardless of whether a per-field rule ran.
const RESIDUAL_CREDENTIALED_URL = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?#@]+:[^\s/?#@]+@/;
const RESIDUAL_BARE_USERINFO = /(?:^|\s)[^\s/?#@:]+:[^\s/?#@]+@[^\s/?#@]/;
/**
 * T154: broadens the bare-word list below (`token`, `password`, … ) to also
 * catch the two-word, compound-name style a real secret-carrying query
 * parameter commonly uses — `apikey`/`api_key`/`api-key` and
 * `access_token`/`access-token`/`accesstoken` — which the bare-word
 * alternation below can never match: none of its words is a SUBSTRING
 * match, each one must be the query parameter's ENTIRE name (anchored by
 * `[?&]` on the left and `=` on the right), so `apikey=` never matched
 * `key=` and `access_token=` never matched `token=`.
 *
 * That same anchoring is exactly what keeps this broadened pattern from
 * creating a new false positive. Two real shapes were considered and
 * rejected as substring matches rather than added as new alternatives:
 * - a legitimate, unrelated query parameter that merely CONTAINS one of
 *   these words, e.g. `?sortkey=name` or `?keyword=test` — neither is the
 *   literal name `key`/`apikey`, so the full-name anchor lets both pass;
 * - a path segment or hostname spelling one of these words, e.g.
 *   `/apikeys/123` or `https://apikey.example.com/` — neither is ever
 *   preceded by `[?&]`, so this pattern (which only ever looks inside a
 *   query string) cannot see it at all.
 * Both cases would only turn a REFUSAL into a false refusal, never the
 * reverse (a real secret slipping past), so getting either wrong here is
 * safe in the direction that matters, but getting them right is still
 * required by this task — a refusal on an innocent value is still a
 * regression a user would hit.
 */
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

/**
 * Cuts `value` down to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte character in half: any partial trailing sequence a raw byte
 * slice can produce decodes to U+FFFD replacement characters (via
 * `TextDecoder`'s non-fatal mode), which are then stripped.
 */
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  const sliced = bytes.slice(0, Math.max(0, maxBytes));
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced).replace(/�+$/u, "");
}

/**
 * Step 1 of bounding: shortens one field's value if it alone exceeds
 * `DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES`, appending a marker that
 * states the original size rather than silently dropping the excess.
 * Runs on the field's already-redacted value — see this module's header
 * comment on bounding running after redaction, never instead of it.
 */
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

/**
 * Step 2 of bounding: removes exactly one field — the last field of the
 * last section that still has any fields — so repeated calls drop fields
 * in a fixed, input-derived order (last-to-first) rather than an
 * arbitrary or size-based one, which is what keeps the result
 * reproducible for equal inputs. Returns `null` once nothing is left to
 * drop.
 */
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

/** Per-section bookkeeping for `summarizeDrops`: every field id dropped from that section, in drop order. */
interface SectionDropRecord {
  sectionTitle: string;
  /** Dropped field ids, oldest-drop-first is NOT how these are pushed — see `summarizeDrops`'s comment. */
  droppedIds: string[];
}

/**
 * Turns per-section drop records into ONE note per affected section —
 * never one note per dropped field. This is what keeps the disclosure
 * itself bounded: a pathological input with thousands of small fields
 * would otherwise need thousands of notes to name every drop, and that
 * notes list would itself grow without bound and defeat the size cap it
 * exists to explain (T41B3 found this exact bug: dropping fields one at
 * a time while appending one note per drop can make the notes list grow
 * faster than dropping fields shrinks the bundle, so the loop never
 * converges). Each summary names the section, how many fields were
 * dropped, and the id range dropped — since `dropLastField` always drops
 * last-to-first, that range is contiguous and its two ends are enough to
 * identify exactly what is missing, without listing every id and without
 * ever reproducing a value.
 */
function summarizeDrops(records: Map<string, SectionDropRecord>): string[] {
  const notes: string[] = [];
  for (const [sectionId, record] of records) {
    if (record.droppedIds.length === 0) continue;
    const firstDropped = record.droppedIds[0]!; // chronologically first drop = the original last field
    const lastDropped = record.droppedIds[record.droppedIds.length - 1]!;
    notes.push(
      `Dropped ${record.droppedIds.length} field(s) from section "${sectionId}" (${record.sectionTitle}), ` +
        `spanning "${sectionId}/${lastDropped}" through "${sectionId}/${firstDropped}", to fit the ` +
        `${DIAGNOSTICS_EXPORT_MAX_BYTES}-byte bundle limit.`,
    );
  }
  return notes;
}

/**
 * Assembles the final bundle shape from bounded sections, a truncation
 * note list, and meta. `boundExportSections` also calls this while
 * searching for a fit — measuring `byteLength(JSON.stringify(...))` of
 * this EXACT shape — so the byte count checked against
 * `DIAGNOSTICS_EXPORT_MAX_BYTES` during that search is the real
 * serialized size a caller will see, not an estimate of it.
 */
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

/**
 * Bounds already-redacted sections to fit `DIAGNOSTICS_EXPORT_MAX_BYTES`,
 * shortening any single oversized field first and then, if the bundle is
 * still over budget, dropping whole fields (last-to-first) until it
 * fits. Every shortened field gets its own note; every affected section's
 * drops are named in ONE aggregated note (`summarizeDrops`) rather than
 * one note per dropped field, so the disclosure itself cannot grow
 * without bound. Always bounds the in-memory sections and only then lets
 * the caller serialize the result, so a truncated bundle is exactly as
 * valid JSON as an untruncated one.
 */
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
  // Measured with the SAME `JSON.stringify(bundle, null, 2)` shape
  // `serializeDiagnosticsExportBundle` actually ships — a compact-JSON
  // measurement here would under-count relative to the real, pretty-
  // printed export and let a bundle through well over budget.
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
 * for. See this module's header comment for both the redaction layers
 * and the bounding pass that runs only after they succeed.
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

/** Serializes a bundle to pretty-printed JSON — the text `use-diagnostics-export.ts` hands to a Blob for download. */
export function serializeDiagnosticsExportBundle(bundle: DiagnosticsExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}
