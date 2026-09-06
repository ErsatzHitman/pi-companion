// T206: CI guard — no legacy versioned-JSON schema reader, envelope
// parser, or `hosts`/`drafts`/`attachments` deserializer keyed to
// `docs/frontend-data-migration.md` §3's synthetic export envelope may
// exist anywhere under `apps/android/src` or `packages/frontend-core/src`
// (`run-guard-no-legacy-schema-reader.mjs`'s `isScannedPath` is the exact
// scope check).
//
// The prohibition this enforces is written down in
// `apps/android/src/platform/offline/versioned-import.test.ts`'s own doc
// comment (T42B2) and in `docs/frontend-data-migration.md` §2/§3: Phase 0
// decided RESET/RE-PAIR — no export utility is created, and if one is ever
// built later it "would live in the legacy checkout ... never in
// `D:\pi-companion`", with T42 adding an import test against it only at
// that time. Until then, no code in this repository may read the §3
// envelope shape and turn it into live hosts, drafts, or attachments.
//
// The P8-W7 merge gate established exactly where that written-down claim
// stopped being enforced: `versioned-import.test.ts`'s own suite
// discriminates only within its own directory's storage class (injecting
// an envelope-recognising branch into `SqliteStructuredStorage.get` fails
// it), and is completely blind to a working importer added in any OTHER
// file — that leaves the whole suite green. The repo-wide half of the
// claim rested on a grep run once, by a human, when the test was written.
// This module is the check that replaces that grep.
//
// ## What signature actually identifies a "reader"
//
// A prose ban on the WORDS "hosts", "drafts", "attachments", "envelope", or
// "version" would be hopeless: all five are ordinary, load-bearing
// identifiers used throughout this codebase for reasons that have nothing
// to do with legacy import (`DraftStore`'s own `Draft.attachments` field,
// `HostProfileStore`, protocol/extension "envelope" framing, package
// `version` fields, and so on — see this module's own test file for the
// measured false-positive rate a naive scan would produce). Per T124/T172's
// established lesson ("a shipped-gate token must disappear when the
// capability does" / "an AND-group is only as narrow as its narrowest
// member"), a bare-name scan here would either never fire (each name alone
// is too common) or fire constantly (disabled within two waves, exactly
// the failure mode this task's brief warns against).
//
// What a REAL reader must actually DO, that ordinary code never
// incidentally does, is two things at once, in the same file:
//
//   1. Discriminate on the envelope's version tag with a literal equality
//      check against the one concrete version number §3's format defines
//      today (`"version": 1`) — `hasVersionDiscriminant` below. This is
//      the "keyed to §3's envelope shape" half: recognizing "this blob is
//      a §3 envelope" requires comparing its `version` field against the
//      literal `1`, in either operand order, loose or strict equality.
//   2. Actually READ at least one of `hosts`/`drafts`/`attachments` back
//      out of a parsed value — via real property access (`envelope.hosts`)
//      or destructuring (`const { hosts } = envelope`) — turning it into
//      something usable rather than leaving it as opaque JSON. This is
//      the "deserializer" half, and it is what distinguishes a READ from
//      merely constructing or storing the envelope shape as an opaque
//      value (which `versioned-import.test.ts` itself does, on purpose,
//      to prove nothing recognizes it): an object LITERAL's `hosts: []`
//      key has no leading dot and is never the left-hand side of an
//      assignment, so it satisfies neither `dotAccessPattern` nor
//      `destructurePattern` below.
//
// Both conditions are required, in the SAME file (not the same variable —
// like `guard-capability-prose.mjs`'s file-level AND-groups, this is a
// co-occurrence check, not a data-flow proof; see this module's own test
// file for the measured false-positive count that co-occurrence bound
// produces against this repository's real, committed tree today: zero).
// Neither condition alone is a safe signal — `git log`-measured today,
// `version === 1` never occurs anywhere in either scanned directory,  and
// `.attachments`/`.drafts` dot-access occurs in ordinary, unrelated
// composer/draft code (`DraftStore.save`'s `input.attachments`,
// `Composer.tsx`) — but the two together, in one file, is exactly the
// shape "recognize the §3 envelope, then read a field out of it" and
// nothing else plausibly produces both at once.
//
// ## What this deliberately does NOT catch
//
// Per this task's own brief ("narrow beats clever" / "a guard that cannot
// fail is the failure mode this task exists to fix" — the two are opposite
// failure directions, and this guard is written to avoid both, not to
// catch every conceivable obfuscation):
//
//   - A version check split across variables in a way that never spells
//     the literal comparison out as `version === 1` / `1 === version` in
//     this file's own text — e.g. a constant `const LEGACY_VERSION = 1;`
//     compared as `parsed.version === LEGACY_VERSION`. A real importer
//     would still need *some* discriminant; this only catches the literal
//     form, which is what every plausible "is this a v1 envelope" check
//     actually writes.
//   - Bracket-notation field access (`envelope["hosts"]`) — `dotAccessPattern`
//     only matches the dotted form. Real code overwhelmingly uses dot
//     access for a known, static field name; bracket notation here would
//     be an unusual way to write an ordinary property read.
//   - A version check and a field read that land in two DIFFERENT files
//     (e.g. version-sniffing in one module, `hosts`/`drafts` deserializing
//     in another it calls into). This guard is file-scoped co-occurrence,
//     not a cross-file data-flow prover — the same boundary
//     `guard-capability-prose.mjs`'s file-level AND-groups accept (see
//     that module's T168/T169 notes) rather than build a real type-flow
//     analyzer for a narrow CI check.
//   - A reader added under a directory this guard does not scan (neither
//     `apps/android/src` nor `packages/frontend-core/src`) — out of this
//     task's stated scope; `apps/web/src` and `packages/*` other than
//     `frontend-core` are not part of the prohibition
//     `versioned-import.test.ts` states.
//
// These are disclosed limits, not oversights: closing every one of them
// would require a real TypeScript type-flow analysis, which is the
// generic-linter mistake this task's brief explicitly warns against
// building.
//
// Pure, dependency-free check function only. `run-guard-no-legacy-schema-
// reader.mjs` is the CLI entry point CI actually runs; this module stays
// import-safe so `guard-no-legacy-schema-reader.test.mjs` can seed
// fixtures without touching the real working tree.

/** The three fields a §3 envelope carries besides `version`/`exportedAt`/`meta`. */
export const ENVELOPE_FIELD_NAMES = ["hosts", "drafts", "attachments"];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Mirrors guard-capability-prose.mjs's STRING_LITERAL_TO_ERASE: a denying
// (or, here, a merely-descriptive) SENTENCE can live inside a string
// literal — a test title, a template-literal doc example — not only a
// comment, and a bare property-shaped substring inside one must never be
// mistaken for real code. Single-line only, replaced with an empty literal
// (never deleted outright) so surrounding tokens can't weld into a new,
// accidental match.
const STRING_LITERAL_TO_ERASE = /(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g;

function stripStringLiterals(source) {
  return source.replace(STRING_LITERAL_TO_ERASE, '""');
}

function stripCommentsAndStrings(source) {
  return stripStringLiterals(stripComments(source));
}

/**
 * Real member access via dot notation (`envelope.hosts`), never an object
 * literal's `hosts: []` key (no leading dot) and never a spread's third
 * dot (`...drafts` contains the literal substring ".drafts" starting at
 * its own last dot — the negative lookbehind refuses to match when the
 * character immediately before the matched dot is itself a dot, which is
 * exactly the case `[...drafts]` produces and a real `x.drafts` never
 * does).
 */
function dotAccessPattern(name) {
  return new RegExp(`(?<!\\.)\\.${name}\\b`);
}

/**
 * Destructuring bind (`const { hosts } = envelope;`, `const { version,
 * hosts, drafts } = parsed;`): the field name inside a brace pair that is
 * itself the left-hand side of an assignment (`}` followed by `=`, not
 * `==`). Bounded to 300 characters inside the braces so this can never run
 * away scanning across an unrelated, unbalanced `{` elsewhere in a large
 * file. Deliberately does NOT match an object LITERAL used as a value
 * (`const envelope = { hosts: [] };`) — there the `{` sits on the RIGHT of
 * `=`, and the closing `}` is followed by `;`, not `=`.
 */
function destructurePattern(name) {
  return new RegExp(`\\{[^{}]{0,300}\\b${name}\\b[^{}]{0,300}\\}\\s*=(?!=)`);
}

const FIELD_PATTERNS = ENVELOPE_FIELD_NAMES.map((name) => ({
  name,
  dot: dotAccessPattern(name),
  destructure: destructurePattern(name),
}));

// A literal equality comparison against the version number §3's envelope
// defines today, in either operand order, loose or strict. See this
// module's header for why a literal comparison — not a bare `.version`
// mention — is the discriminant: recognizing "this is a v1 envelope"
// requires comparing the tag against the concrete number, and nothing
// else in this repository's real, committed source does that today
// (measured: zero occurrences of either form under either scanned
// directory).
const VERSION_EQ_ONE = /\bversion\s*={2,3}\s*1\b/;
const ONE_EQ_VERSION = /\b1\s*={2,3}\s*(?:[\w$]+\.)*version\b/;

function hasVersionDiscriminant(code) {
  return VERSION_EQ_ONE.test(code) || ONE_EQ_VERSION.test(code);
}

function fieldsReadFrom(code) {
  return FIELD_PATTERNS.filter(
    ({ dot, destructure }) => dot.test(code) || destructure.test(code),
  ).map(({ name }) => name);
}

/**
 * @param {{ path: string, content: string }[]} files
 * @returns {{ path: string, fields: string[] }[]} one entry per file that
 *   both discriminates on `version === 1` (or `1 === version`) AND reads
 *   at least one of `hosts`/`drafts`/`attachments` back out of a value —
 *   the co-occurring signature of a legacy-envelope reader. `fields` lists
 *   which of the three were actually read, for the failure message.
 */
export function findLegacySchemaReaderViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    const code = stripCommentsAndStrings(content);
    if (!hasVersionDiscriminant(code)) continue;
    const fields = fieldsReadFrom(code);
    if (fields.length === 0) continue;
    violations.push({ path, fields });
  }
  return violations;
}
