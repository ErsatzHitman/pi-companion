// T102: packages/server/tsconfig.server.json (and the "typecheck" script's
// tsconfig.server.typecheck.json) exclude src/**/*.test.ts, so roughly 260
// test files in the largest workspace in this repository were never
// typechecked by CI. That is what made T97's interface change unfalsifiable:
// deleting a parameter that only a test file passed left the production
// typecheck at exit 0 and every server test green.
//
// packages/server/tsconfig.server.tests.json includes those test files
// (excluding src/server/agent/providers/pi/ui-bridge/*.test.ts, which T109
// owns this wave — see that tsconfig's own exclude list and comment).
// Typechecking them today reports many pre-existing errors: too many to fix
// in one pass (see docs/issues-from-plan.md's T102 section), so this guard
// enforces a CEILING instead of a hard "must be zero" gate. The ceiling can
// only ever be lowered by hand as errors are fixed — this script fails the
// build the moment the real count exceeds it, so it can never silently grow.
//
// T119: a ceiling alone cannot detect its own defeat. Two probes proved
// that at the P6-W5 review:
//   1. Re-adding "src/**/*.test.ts" to tsconfig.server.tests.json's exclude
//      (undoing T102 entirely) takes the real count from 1051 to 75 —
//      comfortably UNDER the ceiling, so `evaluateTypecheckCeiling` alone
//      reports OK.
//   2. If tsgo can't be spawned at all (resolveTsgoBinary's throw, caught
//      by the runner's blanket try/catch), a plain Error carries no
//      `.stdout`/`.stderr`, so the measured output is "", which counts as
//      zero errors — again OK.
// `evaluateTypecheckRun` below closes both: an error-count FLOOR (a count
// that collapses far below the ceiling without an explicit ceiling change
// fails, exactly like probe 1) and a resolved-test-file-count floor read
// from tsgo's own `--listFiles` output (a shrinking resolved set fails even
// if the error count it produces happens to still look plausible, and a
// spawn that never ran resolves zero files). The runner
// (run-guard-server-test-typecheck-ceiling.mjs) is responsible for telling
// this module explicitly when tsgo could not be run at all (`spawnError`),
// rather than letting an empty string masquerade as a clean compile.
//
// Pure, dependency-free check functions only. `run-guard-server-test-typecheck-ceiling.mjs`
// is the CLI entry point that actually spawns tsgo; this module stays
// import-safe so `guard-server-test-typecheck-ceiling.test.mjs` can exercise
// it with synthetic tsgo-shaped output instead of a real compiler run.

// Real count at last measurement (2026-09-05, tsgo 7.0.0-dev via
// @typescript/native-preview): 1051. Lower this number by hand whenever a
// pass fixes errors — never raise it to make a red build green.
//
// T111 lowered this from 1054 to 1051: its new permission-response.test.ts
// coverage for `answeredBy` added two more call sites constructing
// `FakePermissionAgentManager`, which already mis-typed `getAgent()` as
// returning `undefined` instead of `AgentManager["getAgent"]`'s real
// `ManagedAgent | null` — a pre-existing bug, unrelated to `answeredBy`,
// that the ceiling had been silently absorbing at its original 3 call
// sites. Fixing the fake's return type (`null`, not `undefined`) resolved
// all 5 occurrences (3 pre-existing + T111's 2 new), so the true count
// dropped by more than T111 added.
//
// T120 re-included the seven src/server/agent/providers/pi/ui-bridge/
// *.test.ts files tsconfig.server.tests.json had excluded since T102. At
// HEAD b92ee10 with only tsconfig.server.tests.json changed (those seven
// files still unfixed), the real count was 1055 — four `TS7006` implicit-
// any errors, all in decoder.test.ts's `warnSpy.mock.calls.filter((call) =>
// ...)` callbacks. Annotating each as `(call: unknown[])` (no `any`, no
// suppression) fixed all four, so the real count with the seven files
// truly included is 1051 again: net zero change, and the ceiling stays at
// 1051 — this is a fix landing beside the re-inclusion, not room being
// carved out for the re-inclusion itself.
//
// T296 (commit 8352bd2) lowered this from 1051 (measured 1048 in use at
// that commit's parent) to 1045: `provider-registry-wrap.test.ts` carried
// its own type-level exhaustiveness check for `wrapSessionProvider`'s
// optional-method forwarding, and that check was already reporting a real
// `TS2322` at HEAD — correctly naming six missing methods — silently
// absorbed by this ceiling's slack the whole time. Fixing the underlying
// forwarding gap resolved that error; fixing `FakeSession.run()`'s
// pre-existing `AgentRunResult` shape drift (needed so a new fixture in
// the same file could satisfy `AgentSession`) resolved two more (`TS2416`
// and one `TS2345`). Net drop: 3, well under `TYPECHECK_ERROR_MAX_DROP`.
//
// T304 lowered this from 1045 to 1044: T296's production fix
// (`provider-registry.ts`'s `SESSION_OPTIONAL_METHOD_KEYS`) left a second,
// now-inert copy of the same exhaustiveness check behind in
// `provider-registry-wrap.test.ts` — a `TS6133` "declared but never read"
// on `_allOptionalAgentSessionMethodsAreCovered`, tolerated by this ceiling
// with zero headroom to spare. Deleting that duplicate (nothing else in the
// file read it) resolved exactly that one error; the production check in
// `provider-registry.ts` is unaffected and still proven able to fail in
// both directions (see that file's own T296 doc comment).
export const TYPECHECK_ERROR_CEILING = 1044;

// T119: how far the measured error count is allowed to fall below the
// ceiling in one run without an explicit ceiling update. A real fix lowers
// the count by a handful and lowers TYPECHECK_ERROR_CEILING to match in the
// same commit (see the T111 comment above) — a bigger drop than this, with
// the ceiling left untouched, is what "exclude the failing files instead of
// fixing them" and the one-line revert probe (1051 -> 75) both look like
// from here, not an uncredited fix. Raise this only when a single
// deliberate commit legitimately fixes more errors than this in one pass —
// and that commit must also lower TYPECHECK_ERROR_CEILING to the new real
// count, never leave the ceiling stale to "absorb" the drop.
export const TYPECHECK_ERROR_MAX_DROP = 100;

// T119: floor for how many packages/server `*.test.ts` files tsgo itself
// must report resolving (via `--listFiles`), independent of the error
// count. This is the second, independent check the design calls for: the
// error-count floor above catches the count collapsing; this one catches
// files being quietly dropped from `include`/added to `exclude` even in a
// change whose resulting error count still happens to land inside
// [floor, ceiling] — and it also catches tsgo never having run at all
// (zero files resolved). Raise this by hand as test files are added under
// packages/server/src; lower it only when files are deliberately removed
// or merged on purpose, never to hide files silently falling out of the
// compiled set.
//
// Real count at last measurement (2026-09-05, HEAD b92ee10 plus this
// task's tsconfig.server.tests.json change): 315. T120 re-included the
// seven ui-bridge test files this project's `include` had excluded since
// T102 (real count was 308 with them excluded — confirmed by re-running
// this guard with the old `exclude` list restored), raising this floor
// from 300 to 307 to match: same eight-file margin below the real count
// as before, now measured against 315 instead of 308.
export const TYPECHECK_TEST_FILE_COUNT_FLOOR = 307;

const ERROR_LINE_PATTERN = /error TS\d+:/;

// Matches one resolved-file line from tsgo's own `--listFiles` output
// against this package's own test files specifically — tsgo's resolved
// closure also includes lib.*.d.ts and every non-test source file it
// type-checks, so this is deliberately narrow, not a bare ".test.ts$"
// check that other packages' fixtures could also satisfy.
const RESOLVED_SERVER_TEST_FILE_PATTERN = /packages\/server\/src\/.*\.test\.ts$/;

/**
 * Counts the `error TSxxxx:` diagnostic lines in tsgo/tsc `--noEmit` output.
 * One line per reported error, so this is a direct error count, not a
 * line count of the (possibly multi-line, wrapped) diagnostic text.
 *
 * @param {string} output combined tsgo/tsc stdout
 * @returns {number}
 */
export function countTypecheckErrors(output) {
  if (!output) return 0;
  let count = 0;
  for (const line of output.split("\n")) {
    if (ERROR_LINE_PATTERN.test(line)) count += 1;
  }
  return count;
}

/**
 * Counts resolved packages/server test files from tsgo's own `--listFiles`
 * output — the compiler's own view of what it actually compiled, not a
 * glob this script writes and could get out of sync with tsconfig's real
 * `include`/`exclude`.
 *
 * @param {string} output combined tsgo/tsc stdout (with `--listFiles`)
 * @param {RegExp} pattern override for testing; defaults to this package's
 *   own resolved-test-file pattern
 * @returns {number}
 */
export function countResolvedTestFiles(output, pattern = RESOLVED_SERVER_TEST_FILE_PATTERN) {
  if (!output) return 0;
  let count = 0;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim().replace(/\\/g, "/");
    if (line && pattern.test(line)) count += 1;
  }
  return count;
}

/**
 * @param {number} errorCount real error count just measured
 * @param {number} ceiling the enforced ceiling (defaults to TYPECHECK_ERROR_CEILING)
 * @returns {{ ok: boolean, errorCount: number, ceiling: number }}
 * @deprecated superseded by evaluateTypecheckRun, which adds the floor and
 *   resolved-file-set checks T119 requires; kept only because deleting a
 *   narrowly-scoped, still-correct pure function buys nothing.
 */
export function evaluateTypecheckCeiling(errorCount, ceiling = TYPECHECK_ERROR_CEILING) {
  return { ok: errorCount <= ceiling, errorCount, ceiling };
}

/**
 * The full T119 verdict: ceiling, floor, resolved-file-set floor, and an
 * explicit "the compiler never really ran" signal, combined so none of the
 * three can silently defeat the other two.
 *
 * @param {{ errorCount: number, resolvedTestFileCount: number, spawnError?: string | null }} measurement
 * @param {{ ceiling?: number, maxDrop?: number, fileCountFloor?: number }} [options]
 * @returns {{
 *   ok: boolean,
 *   errorCount: number,
 *   resolvedTestFileCount: number,
 *   ceiling: number,
 *   errorFloor: number,
 *   fileCountFloor: number,
 *   reasons: string[],
 * }}
 */
export function evaluateTypecheckRun(measurement, options = {}) {
  const { errorCount, resolvedTestFileCount, spawnError = null } = measurement;
  const {
    ceiling = TYPECHECK_ERROR_CEILING,
    maxDrop = TYPECHECK_ERROR_MAX_DROP,
    fileCountFloor = TYPECHECK_TEST_FILE_COUNT_FLOOR,
  } = options;
  const errorFloor = ceiling - maxDrop;
  const reasons = [];

  if (spawnError) {
    reasons.push(`tsgo could not be run, so no real diagnostics exist to measure: ${spawnError}`);
  }
  if (errorCount > ceiling) {
    reasons.push(`${errorCount} error(s) exceeds the enforced ceiling of ${ceiling}`);
  }
  if (errorCount < errorFloor) {
    reasons.push(
      `${errorCount} error(s) is more than ${maxDrop} below the ceiling of ${ceiling} ` +
        `(floor ${errorFloor}) with no ceiling change recorded here — that is what excluding ` +
        `files instead of fixing them, or tsgo not really running, looks like from here, not ` +
        `an uncredited fix`,
    );
  }
  if (resolvedTestFileCount < fileCountFloor) {
    reasons.push(
      `tsgo resolved only ${resolvedTestFileCount} packages/server test file(s) (via ` +
        `--listFiles), below the floor of ${fileCountFloor} — a file was excluded rather than ` +
        `fixed, or tsgo did not really run`,
    );
  }

  return {
    ok: reasons.length === 0,
    errorCount,
    resolvedTestFileCount,
    ceiling,
    errorFloor,
    fileCountFloor,
    reasons,
  };
}
