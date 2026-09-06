// T180: unit tests for guard-dockerignore-depth.mjs's pure functions, plus
// mutation proofs against the REAL committed `.dockerignore` and the real
// repository's own tracked-file structure.
//
// "Real file" fixtures read the committed HEAD content via `git show`, not
// the live working tree — matching guard-packaging-entrypoints.test.mjs's
// own precedent, since this wave has multiple agents editing files
// concurrently and `git show HEAD:<path>` is immune to that (this
// repository's own T93 principle: test committed content).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  bareNameNeedsDepthAgnostic,
  bareTargetName,
  findDockerignoreDepthViolations,
  findTrackedNestedNames,
  nameGlobToRegExp,
  parseDockerignoreLines,
  RECURRING_ARTIFACT_FAMILIES,
} from "./guard-dockerignore-depth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function gitShowHead(relativePath) {
  return execFileSync("git", ["show", `HEAD:${relativePath.replace(/\\/g, "/")}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function gitLsFilesHead() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

function dirOf(repoRelativeFilePath) {
  const dir = path.posix.dirname(repoRelativeFilePath.replace(/\\/g, "/"));
  return dir === "" ? "." : dir;
}

function dirsContaining(trackedFiles, basenamePattern) {
  const dirs = new Set();
  for (const file of trackedFiles) {
    if (basenamePattern.test(path.posix.basename(file.replace(/\\/g, "/")))) {
      dirs.add(dirOf(file));
    }
  }
  return [...dirs];
}

/** Real structural evidence computed from HEAD's own tracked file list —
 * no build state, no install, and no disk walk involved, matching what
 * this guard's CI job (bare `actions/checkout`, no `npm ci`) actually
 * sees. `dockerignoreContent` supplies the bare names to look for via
 * `findTrackedNestedNames` (e.g. `.github`, real and tracked at
 * `packages/expo-two-way-audio/.github/`) — deliberately excludes
 * `findRealNestedOccurrences`'s disk-walk half (run-guard-dockerignore-
 * depth.mjs only), which these hermetic tests do not need. */
function realStructuralEvidence(dockerignoreContent) {
  const trackedFiles = gitLsFilesHead();
  const bareNames = [
    ...new Set(
      parseDockerignoreLines(dockerignoreContent)
        .map((pattern) => bareTargetName(pattern))
        .filter((name) => name !== null),
    ),
  ];
  return {
    packageJsonDirs: dirsContaining(trackedFiles, /^package\.json$/),
    tsconfigDirs: dirsContaining(trackedFiles, /^tsconfig[^/]*\.json$/),
    playwrightConfigDirs: dirsContaining(trackedFiles, /^playwright\.config\.(ts|js|mjs|cjs)$/),
    expoConfigDirs: dirsContaining(trackedFiles, /^metro\.config\.js$/),
    realNestedNames: findTrackedNestedNames(trackedFiles, bareNames),
  };
}

function noEvidence() {
  return {
    packageJsonDirs: ["."],
    tsconfigDirs: ["."],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
}

// --- parseDockerignoreLines --------------------------------------------

test("parseDockerignoreLines strips comments and blank lines", () => {
  const content = ["# a comment", "", "node_modules/", "  ", "*.log  ", "# another"].join("\n");
  assert.deepEqual(parseDockerignoreLines(content), ["node_modules/", "*.log"]);
});

// --- bareTargetName ------------------------------------------------------

test("bareTargetName strips a leading **/ and trailing /", () => {
  assert.equal(bareTargetName("**/node_modules/"), "node_modules");
});

test("bareTargetName strips a trailing / with no **/ prefix", () => {
  assert.equal(bareTargetName(".github/"), ".github");
});

test("bareTargetName passes through a bare file pattern unchanged", () => {
  assert.equal(bareTargetName("*.tsbuildinfo"), "*.tsbuildinfo");
});

test("bareTargetName returns null for a negation", () => {
  assert.equal(bareTargetName("!important.log"), null);
});

test("bareTargetName returns null for a pattern naming a specific nested path", () => {
  assert.equal(bareTargetName("apps/android/.expo/"), null);
});

// --- nameGlobToRegExp ------------------------------------------------------

test("nameGlobToRegExp matches a literal name exactly", () => {
  const re = nameGlobToRegExp("node_modules");
  assert.equal(re.test("node_modules"), true);
  assert.equal(re.test("node_modules2"), false);
  assert.equal(re.test("xnode_modules"), false);
});

test("nameGlobToRegExp handles a * wildcard", () => {
  // Single-level glob, applied only to basenames by every real caller in
  // this file (never to a full path) — so whether "*" could theoretically
  // cross a "/" is moot in practice; not asserted here.
  const re = nameGlobToRegExp("*.tsbuildinfo");
  assert.equal(re.test("x.tsbuildinfo"), true);
  assert.equal(re.test("x.tsbuildinfo.bak"), false);
  assert.equal(re.test("x.tsbuildinf"), false);
});

test("nameGlobToRegExp handles the .metro-health-check* trailing wildcard", () => {
  const re = nameGlobToRegExp(".metro-health-check*");
  assert.equal(re.test(".metro-health-check-1700000000000"), true);
  assert.equal(re.test(".metro-health-check"), true);
  assert.equal(re.test(".metro-health"), false);
});

// --- bareNameNeedsDepthAgnostic (synthetic evidence) -----------------------

test("bareNameNeedsDepthAgnostic: node_modules needs **/ when >1 package.json dir exists", () => {
  const evidence = {
    packageJsonDirs: [".", "apps/web"],
    tsconfigDirs: ["."],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  assert.equal(bareNameNeedsDepthAgnostic("node_modules", evidence), true);
});

test("bareNameNeedsDepthAgnostic: node_modules does NOT need **/ when only the root has a package.json", () => {
  assert.equal(bareNameNeedsDepthAgnostic("node_modules", noEvidence()), false);
});

test("bareNameNeedsDepthAgnostic: dist needs **/ when a tsconfig exists outside the root", () => {
  const evidence = {
    packageJsonDirs: ["."],
    tsconfigDirs: [".", "packages/server"],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  assert.equal(bareNameNeedsDepthAgnostic("dist", evidence), true);
});

test("bareNameNeedsDepthAgnostic: *.tsbuildinfo needs **/ under the same tsconfig evidence as dist", () => {
  const evidence = {
    packageJsonDirs: ["."],
    tsconfigDirs: [".", "packages/server"],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  assert.equal(bareNameNeedsDepthAgnostic("*.tsbuildinfo", evidence), true);
});

test("bareNameNeedsDepthAgnostic: playwright output names need **/ only when a non-root playwright config exists", () => {
  const withNonRootConfig = {
    packageJsonDirs: ["."],
    tsconfigDirs: ["."],
    playwrightConfigDirs: ["apps/web/e2e"],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  assert.equal(bareNameNeedsDepthAgnostic("test-results", withNonRootConfig), true);
  assert.equal(bareNameNeedsDepthAgnostic("playwright-report", withNonRootConfig), true);
  assert.equal(bareNameNeedsDepthAgnostic("blob-report", withNonRootConfig), true);
  assert.equal(bareNameNeedsDepthAgnostic("test-results", noEvidence()), false);
});

test("bareNameNeedsDepthAgnostic: .metro-health-check* needs **/ only when a non-root metro config exists", () => {
  const withMetro = {
    packageJsonDirs: ["."],
    tsconfigDirs: ["."],
    playwrightConfigDirs: [],
    expoConfigDirs: ["apps/android"],
    realNestedNames: new Set(),
  };
  assert.equal(bareNameNeedsDepthAgnostic(".metro-health-check*", withMetro), true);
  assert.equal(bareNameNeedsDepthAgnostic(".metro-health-check*", noEvidence()), false);
});

// --- COUNTER-MUTATION: genuinely root-only patterns must NOT trip the guard

test("COUNTER-MUTATION: none of this file's four families match .git, .github, .dev, .tmp, .pi, or scratch filenames", () => {
  // This is the false-positive case the task brief warns about directly:
  // "A pattern that SHOULD be root-only ... must not trip your guard." None
  // of these names match ANY family's representative example string, so no
  // amount of evidence (even granting every family maximal non-root
  // evidence) can make them violations.
  const maximalEvidence = {
    packageJsonDirs: [".", "apps/web", "apps/android"],
    tsconfigDirs: [".", "apps/web", "apps/android"],
    playwrightConfigDirs: [".", "apps/web/e2e"],
    expoConfigDirs: [".", "apps/android"],
    realNestedNames: new Set(),
  };
  for (const name of [
    ".git",
    ".github",
    ".dev",
    ".tmp",
    ".pi",
    "HANDOFF.md",
    "claude-code-handoff.md",
    "memory.md",
  ]) {
    assert.equal(
      bareNameNeedsDepthAgnostic(name, maximalEvidence),
      false,
      `${name} incorrectly matched a recurring-artifact family`,
    );
  }
});

test("COUNTER-MUTATION: a brand-new, genuinely unique bare pattern does not trip the guard even with maximal evidence", () => {
  const content = ["node_modules/", "some-brand-new-scratch-dir/"].join("\n");
  const maximalEvidence = {
    packageJsonDirs: [".", "apps/web"],
    tsconfigDirs: [".", "apps/web"],
    playwrightConfigDirs: [".", "apps/web/e2e"],
    expoConfigDirs: [".", "apps/android"],
    realNestedNames: new Set(), // real walk never found this name anywhere
  };
  const result = findDockerignoreDepthViolations({
    dockerignoreContent: content,
    evidence: maximalEvidence,
  });
  // node_modules/ (no **/) DOES need it under this evidence — the new
  // scratch dir must not, proving the guard discriminates rather than
  // flagging everything indiscriminately (the flawed heuristic this task's
  // brief warns against).
  assert.equal(
    result.violations.some((v) => v.includes("some-brand-new-scratch-dir")),
    false,
  );
  assert.equal(
    result.violations.some((v) => v.includes("node_modules")),
    true,
  );
});

// --- findDockerignoreDepthViolations (synthetic) ---------------------------

test("findDockerignoreDepthViolations passes a fully **/-prefixed file", () => {
  const content = ["**/node_modules/", "**/dist/", ".git/"].join("\n");
  const evidence = {
    packageJsonDirs: [".", "apps/web"],
    tsconfigDirs: [".", "apps/web"],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  const result = findDockerignoreDepthViolations({ dockerignoreContent: content, evidence });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("findDockerignoreDepthViolations flags a bare node_modules/ when the evidence says it recurs", () => {
  const content = ["node_modules/"].join("\n");
  const evidence = {
    packageJsonDirs: [".", "apps/web"],
    tsconfigDirs: ["."],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  const result = findDockerignoreDepthViolations({ dockerignoreContent: content, evidence });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("node_modules")));
});

test("findDockerignoreDepthViolations ignores a negation line", () => {
  const content = ["**/node_modules/", "!node_modules/keep-me"].join("\n");
  const evidence = {
    packageJsonDirs: [".", "apps/web"],
    tsconfigDirs: ["."],
    playwrightConfigDirs: [],
    expoConfigDirs: [],
    realNestedNames: new Set(),
  };
  const result = findDockerignoreDepthViolations({ dockerignoreContent: content, evidence });
  assert.equal(result.ok, true);
});

// --- REAL FILE: the committed .dockerignore against the real repo tree -----

test("REAL FILE: the committed .dockerignore passes against the repository's own real structural evidence", () => {
  const content = gitShowHead(".dockerignore");
  const evidence = realStructuralEvidence(content);
  const result = findDockerignoreDepthViolations({ dockerignoreContent: content, evidence });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

/**
 * Replaces the exact, standalone double-star-slash-prefixed PATTERN LINE
 * for `name` (a whole line, nothing else on it) with its bare form,
 * ignoring any other occurrence of that same text elsewhere in the file.
 * The REAL `.dockerignore`'s own header comment quotes several of its
 * patterns verbatim inside backticks (T177's own prose, e.g. "still
 * excludes" right after a quoted copy of the node_modules pattern) — a
 * plain whole-string `.replace()` hits THAT mention first, since it
 * appears earlier in the file than the real pattern line, and silently
 * mutates nothing that matters (catalogue class: "a comment quoting the
 * code satisfies a source-text mutation aimed at the code"). Anchoring to a
 * whole line, via the multiline flag, is what a real edit to the pattern
 * line itself would produce.
 *
 * @param {string} content
 * @param {string} name
 * @returns {string}
 */
function stripDoubleStarPrefixFromPatternLine(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRe = new RegExp(`^\\*\\*/${escaped}$`, "m");
  assert.ok(
    lineRe.test(content),
    `fixture assumption: a standalone "**/${name}" pattern line exists`,
  );
  return content.replace(lineRe, name);
}

test("MUTATION: stripping **/ from the real .dockerignore's node_modules line fails the guard", () => {
  const original = gitShowHead(".dockerignore");
  const mutated = stripDoubleStarPrefixFromPatternLine(original, "node_modules/");
  assert.notEqual(
    mutated,
    original,
    "the pattern LINE itself must have changed, not just prose about it",
  );
  const evidence = realStructuralEvidence(original);
  const result = findDockerignoreDepthViolations({ dockerignoreContent: mutated, evidence });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("node_modules")));
});

test("MUTATION: stripping **/ from the real .dockerignore's .github line fails the guard", () => {
  const original = gitShowHead(".dockerignore");
  const mutated = stripDoubleStarPrefixFromPatternLine(original, ".github/");
  assert.notEqual(
    mutated,
    original,
    "the pattern LINE itself must have changed, not just prose about it",
  );
  const evidence = realStructuralEvidence(original);
  const result = findDockerignoreDepthViolations({ dockerignoreContent: mutated, evidence });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes(".github")));
});

test("RESTORED: the real .dockerignore (unmutated) passes again", () => {
  const original = gitShowHead(".dockerignore");
  const evidence = realStructuralEvidence(original);
  const result = findDockerignoreDepthViolations({ dockerignoreContent: original, evidence });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("COUNTER-MUTATION on the real file: adding a genuinely root-only new pattern does not trip the guard", () => {
  const original = gitShowHead(".dockerignore");
  const withNewRootOnlyLine = `${original}\nsome-brand-new-root-only-scratch-file.md\n`;
  const evidence = realStructuralEvidence(withNewRootOnlyLine);
  const result = findDockerignoreDepthViolations({
    dockerignoreContent: withNewRootOnlyLine,
    evidence,
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

// --- Sanity: the family table itself is well-formed -------------------------

test("RECURRING_ARTIFACT_FAMILIES: every evidenceKey is one this guard's evidence object actually has", () => {
  const knownKeys = new Set([
    "packageJsonDirs",
    "tsconfigDirs",
    "playwrightConfigDirs",
    "expoConfigDirs",
  ]);
  for (const family of RECURRING_ARTIFACT_FAMILIES) {
    assert.ok(
      knownKeys.has(family.evidenceKey),
      `unknown evidenceKey "${family.evidenceKey}" in family "${family.name}"`,
    );
  }
});
