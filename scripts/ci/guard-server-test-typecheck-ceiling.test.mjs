import assert from "node:assert/strict";
import test from "node:test";
import {
  countResolvedTestFiles,
  countTypecheckErrors,
  evaluateTypecheckCeiling,
  evaluateTypecheckRun,
  TYPECHECK_ERROR_CEILING,
  TYPECHECK_TEST_FILE_COUNT_FLOOR,
} from "./guard-server-test-typecheck-ceiling.mjs";
import { isSpawnFailure } from "./run-guard-server-test-typecheck-ceiling.mjs";

test("counts zero errors on empty output", () => {
  assert.equal(countTypecheckErrors(""), 0);
});

test("counts one error line", () => {
  const output = `src/foo.test.ts(1,1): error TS2345: Argument of type 'string' is not assignable.\n`;
  assert.equal(countTypecheckErrors(output), 1);
});

test("counts each error line once, ignoring wrapped continuation lines that don't start a new diagnostic", () => {
  const output = [
    "src/foo.test.ts(1,1): error TS2345: Argument of type 'string' is not assignable.",
    "  Types of parameters 'a' and 'b' are incompatible.",
    "    Type 'X' is not assignable to type 'Y'.",
    "src/bar.test.ts(9,9): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    "",
  ].join("\n");
  assert.equal(countTypecheckErrors(output), 2);
});

test("does not count a line that merely mentions 'error' without a TSxxxx diagnostic code", () => {
  const output = "This build had an error somewhere.\n";
  assert.equal(countTypecheckErrors(output), 0);
});

test("does not count a doc comment or error string that only mentions 'error TS' as prose", () => {
  // Guards against the exact defect class CLAUDE.md calls out: a lazy match
  // that a comment or string literal mentioning the diagnostic shape could
  // satisfy without a real compiler diagnostic. The pattern requires the
  // `TSxxxx:` shape immediately after "error", which prose describing it
  // without a trailing colon-and-code will not produce here — but the real
  // defense is that this function only ever receives tsgo's own stdout, not
  // source text; this test documents that the regex is anchored to the
  // literal compiler format, not to the bare word "error".
  const output = "// see error TS-style diagnostics in the tsgo docs\n";
  assert.equal(countTypecheckErrors(output), 0);
});

test("evaluateTypecheckCeiling passes when the count is at or under the ceiling", () => {
  assert.deepEqual(evaluateTypecheckCeiling(10, 10), { ok: true, errorCount: 10, ceiling: 10 });
  assert.deepEqual(evaluateTypecheckCeiling(9, 10), { ok: true, errorCount: 9, ceiling: 10 });
});

test("evaluateTypecheckCeiling fails when the count exceeds the ceiling", () => {
  assert.deepEqual(evaluateTypecheckCeiling(11, 10), { ok: false, errorCount: 11, ceiling: 10 });
});

test("evaluateTypecheckCeiling defaults to the committed TYPECHECK_ERROR_CEILING", () => {
  const result = evaluateTypecheckCeiling(TYPECHECK_ERROR_CEILING);
  assert.equal(result.ok, true);
  const oneMore = evaluateTypecheckCeiling(TYPECHECK_ERROR_CEILING + 1);
  assert.equal(oneMore.ok, false);
});

// --- countResolvedTestFiles ---------------------------------------------

test("countResolvedTestFiles counts zero on empty output", () => {
  assert.equal(countResolvedTestFiles(""), 0);
});

test("countResolvedTestFiles counts only packages/server/src *.test.ts lines from a --listFiles dump", () => {
  const output = [
    "D:/pi-companion/node_modules/@typescript/native-preview-win32-x64/lib/lib.es5.d.ts",
    "D:/pi-companion/packages/server/src/utils/tree-kill.ts",
    "D:/pi-companion/packages/server/src/utils/tree-kill.test.ts",
    "D:/pi-companion/packages/server/src/utils/worktree.test.ts",
    "D:/pi-companion/packages/client/src/other.test.ts",
    "",
  ].join("\n");
  assert.equal(countResolvedTestFiles(output), 2);
});

test("countResolvedTestFiles normalizes backslashes so a Windows-style path still matches", () => {
  const output = "D:\\pi-companion\\packages\\server\\src\\utils\\tree-kill.test.ts\n";
  assert.equal(countResolvedTestFiles(output), 1);
});

test("countResolvedTestFiles does not count a non-test source file merely living alongside tests", () => {
  const output = "D:/pi-companion/packages/server/src/utils/tree-kill.ts\n";
  assert.equal(countResolvedTestFiles(output), 0);
});

// --- evaluateTypecheckRun: the T119 combined verdict --------------------

const REAL = {
  errorCount: TYPECHECK_ERROR_CEILING,
  resolvedTestFileCount: TYPECHECK_TEST_FILE_COUNT_FLOOR + 8,
};

test("evaluateTypecheckRun passes on today's real measured numbers", () => {
  const result = evaluateTypecheckRun(REAL);
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test("evaluateTypecheckRun fails when the error count exceeds the ceiling", () => {
  const result = evaluateTypecheckRun({ ...REAL, errorCount: TYPECHECK_ERROR_CEILING + 1 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("exceeds the enforced ceiling")));
});

test("evaluateTypecheckRun T119 probe 1: a count that collapses far below the ceiling with no ceiling change FAILS", () => {
  // The exact probe from docs/issues-from-plan.md: re-excluding
  // src/**/*.test.ts took the real count from 1054 (now 1051) to 75,
  // reported here with the real, unmoved TYPECHECK_ERROR_CEILING.
  const result = evaluateTypecheckRun({ errorCount: 75, resolvedTestFileCount: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("below the ceiling")));
});

test("evaluateTypecheckRun does not trip the floor on a small, legitimate improvement", () => {
  // A single task fixing a handful of errors without touching the ceiling
  // (which is the normal, expected state between "fix errors" and "lower
  // the ceiling" in the same commit) must not be treated as the collapse
  // probe.
  const result = evaluateTypecheckRun({
    errorCount: TYPECHECK_ERROR_CEILING - 5,
    resolvedTestFileCount: TYPECHECK_TEST_FILE_COUNT_FLOOR + 8,
  });
  assert.equal(result.ok, true);
});

test("evaluateTypecheckRun respects an explicitly lowered ceiling — a real, credited fix passes", () => {
  const result = evaluateTypecheckRun(
    { errorCount: 900, resolvedTestFileCount: TYPECHECK_TEST_FILE_COUNT_FLOOR + 8 },
    { ceiling: 900 },
  );
  assert.equal(result.ok, true);
});

test("evaluateTypecheckRun T119 probe 2: a resolved file count of zero FAILS even if errorCount were (wrongly) reported as in-range", () => {
  // This is the shape a swallowed spawn failure used to produce: an empty
  // string counts as zero errors AND zero resolved files. Zero resolved
  // files must fail on its own, independent of whatever errorCount ends up
  // being computed from the same empty output.
  const result = evaluateTypecheckRun({ errorCount: 0, resolvedTestFileCount: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("resolved only 0")));
});

test("evaluateTypecheckRun fails when the resolved test-file count shrinks even though the error count still looks plausible", () => {
  // Design note: the file-count floor is a SEPARATE check from the
  // error-count floor — a change that excludes a few files could still
  // land an error count comfortably inside [floor, ceiling] while quietly
  // resolving fewer test files than before.
  const result = evaluateTypecheckRun({
    errorCount: TYPECHECK_ERROR_CEILING - 10,
    resolvedTestFileCount: TYPECHECK_TEST_FILE_COUNT_FLOOR - 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("below the floor")));
  assert.equal(
    result.reasons.some((r) => r.includes("below the ceiling")),
    false,
    "the error-count floor reason must not fire here — only the file-count floor should",
  );
});

test("evaluateTypecheckRun T119 probe 3: an explicit spawnError FAILS regardless of a zero error count", () => {
  const result = evaluateTypecheckRun({
    errorCount: 0,
    resolvedTestFileCount: 0,
    spawnError: "tsgo entry not found at .../tsgo.js",
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("tsgo could not be run")));
});

test("evaluateTypecheckRun reports every failing reason at once, not just the first", () => {
  const result = evaluateTypecheckRun({
    errorCount: TYPECHECK_ERROR_CEILING + 1,
    resolvedTestFileCount: TYPECHECK_TEST_FILE_COUNT_FLOOR - 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasons.length, 2);
});

test("evaluateTypecheckRun honors a custom maxDrop and fileCountFloor passed in options", () => {
  const passing = evaluateTypecheckRun(
    { errorCount: 50, resolvedTestFileCount: 5 },
    { ceiling: 60, maxDrop: 40, fileCountFloor: 5 },
  );
  assert.equal(passing.ok, true);

  const failingOnDrop = evaluateTypecheckRun(
    { errorCount: 10, resolvedTestFileCount: 5 },
    { ceiling: 60, maxDrop: 40, fileCountFloor: 5 },
  );
  assert.equal(failingOnDrop.ok, false);
});

// --- isSpawnFailure: the runner's "did tsgo actually run" classifier ----

test("isSpawnFailure treats resolveTsgoBinary's plain Error (no .status) as a spawn failure", () => {
  const error = new Error("run-guard-server-test-typecheck-ceiling: tsgo entry not found at X");
  assert.equal(isSpawnFailure(error), true);
});

test("isSpawnFailure treats a real tsgo exit (numeric .status, diagnostics reported) as NOT a spawn failure", () => {
  const error = Object.assign(new Error("Command failed"), {
    status: 2,
    stdout: "src/foo.test.ts(1,1): error TS2345: nope\n",
    stderr: "",
  });
  assert.equal(isSpawnFailure(error), false);
});

test("isSpawnFailure treats a real tsgo exit with status 0 as NOT a spawn failure", () => {
  const error = Object.assign(new Error("unused"), { status: 0, stdout: "", stderr: "" });
  assert.equal(isSpawnFailure(error), false);
});

test("isSpawnFailure treats an ENOENT-shaped spawn error (no numeric .status) as a spawn failure", () => {
  const error = Object.assign(new Error("spawn tsgo.js ENOENT"), { code: "ENOENT" });
  assert.equal(isSpawnFailure(error), true);
});
