// T180: CI guard — does every `.dockerignore` pattern that is MEANT to
// exclude a same-named path at every depth actually carry the `**/` prefix
// Docker's ignore matcher requires for that?
//
// `grep -rn 'dockerignore'` across every `.mjs`/`.ts`/`.yml`/`.js` outside
// `node_modules` returned zero hits before this task — nothing in the
// repository read this file. T177 (immediately preceding commit) fixed four
// patterns that had silently stayed root-only since T43A3 first wrote the
// file: `node_modules/`, `dist/`, `*.log`, `*.tsbuildinfo`, plus three more
// found auditing it (`test-results/`, `playwright-report/`, `blob-report/`,
// `.metro-health-check*`). Nothing would have caught a future edit dropping
// any of those `**/` prefixes again. This guard is that catch.
//
// --- The design question (this task's brief calls it "the real work") -----
//
// How does the guard know WHICH bare patterns are meant to be depth-agnostic,
// without two flawed shortcuts?
//   (a) A hardcoded list of pattern strings has exactly the staleness problem
//       `REQUIRED_WORKSPACE_BUILD_STEPS` has (that array's own provenance
//       claim was found false at the P6-W20 gate) — it protects only the
//       patterns someone remembered to enumerate, and silently stops
//       protecting anything renamed or added later.
//   (b) A heuristic that flags every pattern lacking `**/` is worse: this
//       file has several DELIBERATELY root-only bare patterns (`.git/`,
//       `.github/`, `.dev/`, `.tmp/`, `.pi/`, `HANDOFF.md`,
//       `claude-code-handoff.md`, `memory.md` — see this file's own header
//       in ../../.dockerignore, "Confirmed unaffected" in T177's commit
//       message) that must NOT trip a guard, or the guard gets disabled the
//       first time it fires on a correct file (T178's Nix comment-strip
//       lesson: "a guard that reddens on valid input gets disabled").
//
// DECISION: derive "this bare name recurs at more than one depth" from the
// repository's OWN structure instead of either shortcut — specifically, from
// which build/tooling CONFIG FILES exist and where, which is real evidence
// that is committed (so present on ANY checkout, clean or already-built,
// unlike relying on `node_modules`/`dist` actually existing on disk — this
// guard's own CI job runs on a bare `actions/checkout`, no `npm ci`, so an
// approach that only trusted already-built output would be vacuously blind
// on every real CI run). Four families, each tied to one tool's own,
// externally-documented, non-project-specific convention (matching this
// directory's own precedent for encoding stable platform facts rather than
// project facts — see guard-packaging-entrypoints.mjs's `DOCKER_INTERPRETERS`
// constant):
//   - `node_modules` — npm's own contract: a `node_modules` directory is
//     created next to EVERY `package.json` once dependencies are installed,
//     unconditionally, not something a workspace can opt out of. Evidence:
//     more than one `package.json` in the repository (this one is an
//     npm-workspaces monorepo, so there always will be).
//   - `dist`, `*.tsbuildinfo` — TypeScript's own incremental-build contract:
//     a project with `outDir` set writes both, per `tsconfig*.json`, in that
//     tsconfig's own directory. Evidence: a `tsconfig*.json` file exists
//     somewhere other than the repository root.
//   - `test-results`, `playwright-report`, `blob-report` — Playwright's own
//     fixed default output directory names, written relative to wherever
//     its OWN config file lives (not the repo root) unless overridden.
//     Evidence: a `playwright.config.*` file exists somewhere other than the
//     repository root.
//   - `.metro-health-check*` — Metro's own health-check file, written into
//     the Expo/React-Native project root it is invoked from. Evidence: a
//     `metro.config.js` file exists somewhere other than the repository
//     root.
// A pattern whose name matches none of these four families, or whose
// matching family's config files exist ONLY at the repository root, is left
// alone — this is what keeps `.git/`, `.dev/`, `.tmp/`, `.pi/`, `HANDOFF.md`
// and friends from tripping the guard (none of the four families' example
// strings match those names, so no family evidence is even consulted).
//
// DISCLOSED GAP: `*.log` is not tied to any single tool's config file (any
// workspace's own `npm test`/build tooling can write one under any name), so
// it is covered by REAL on-disk evidence only (see
// `findRealNestedOccurrences` in run-guard-dockerignore-depth.mjs) — which is
// empty on a pristine checkout, same as every other guard's disclosed
// build-state gap in this directory. Concretely: if `**/*.log` in the real
// `.dockerignore` lost its prefix today, on a checkout with no nested `.log`
// file already present this guard would NOT catch it. This is the
// documented trade-off, not a defect the mutation proof below hides — see
// this task's report for the exact input where the guard's coverage stops.
//
// A pattern containing an internal path separator (`apps/android/.expo/`) is
// already anchored to one specific, unambiguous location by design — adding
// `**/` to it would broaden its meaning to match that suffix at ANY depth,
// which is a different, larger behavior change than what this guard checks
// for. Such patterns are out of this guard's scope entirely (see
// `bareTargetName` below, which returns `null` for them).
//
// Pure, dependency-free functions only, matching every other guard in this
// directory — `run-guard-dockerignore-depth.mjs` is the CLI entry point that
// reads the real `.dockerignore` and the real repository's tracked file list.

/**
 * Extracts the non-comment, non-blank pattern lines from a `.dockerignore`
 * file's content, trimmed.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function parseDockerignoreLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Returns the bare target name a pattern would match at whatever depth it
 * is anchored to (stripping a leading double-star-slash prefix and a
 * trailing directory-marker slash), or `null` when the pattern is out of
 * this guard's scope: a negation (`!pattern`), or a pattern naming a
 * SPECIFIC nested path (any `/` other than a single trailing one) rather
 * than a bare, potentially recurring name.
 *
 * @param {string} pattern
 * @returns {string | null}
 */
export function bareTargetName(pattern) {
  if (pattern.startsWith("!")) return null;
  const withoutDoubleStarPrefix = pattern.startsWith("**/") ? pattern.slice(3) : pattern;
  const withoutTrailingSlash = withoutDoubleStarPrefix.endsWith("/")
    ? withoutDoubleStarPrefix.slice(0, -1)
    : withoutDoubleStarPrefix;
  if (withoutTrailingSlash.length === 0) return null;
  if (withoutTrailingSlash.includes("/")) return null;
  return withoutTrailingSlash;
}

/**
 * Compiles a single-level `.dockerignore`/gitignore-style glob (only `*`,
 * matching within one path segment — sufficient for every bare name in this
 * file today) into a fully-anchored RegExp.
 *
 * @param {string} name
 * @returns {RegExp}
 */
export function nameGlobToRegExp(name) {
  const escaped = name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * The four tool-convention families this guard knows about (see header
 * comment for the reasoning behind each). `example` is a representative
 * literal name real enough that a bare pattern's compiled glob either does
 * or does not match it; `evidenceKey` names which field of the evidence
 * object (see `bareNameNeedsDepthAgnostic`) holds the directories where that
 * family's own config file was found.
 *
 * @type {{ name: string, example: string, evidenceKey: string }[]}
 */
export const RECURRING_ARTIFACT_FAMILIES = [
  { name: "npm-install", example: "node_modules", evidenceKey: "packageJsonDirs" },
  { name: "typescript-build-output", example: "dist", evidenceKey: "tsconfigDirs" },
  { name: "typescript-build-info", example: "x.tsbuildinfo", evidenceKey: "tsconfigDirs" },
  { name: "playwright-test-results", example: "test-results", evidenceKey: "playwrightConfigDirs" },
  {
    name: "playwright-html-report",
    example: "playwright-report",
    evidenceKey: "playwrightConfigDirs",
  },
  { name: "playwright-blob-report", example: "blob-report", evidenceKey: "playwrightConfigDirs" },
  {
    name: "metro-health-check",
    example: ".metro-health-check-1700000000000",
    evidenceKey: "expoConfigDirs",
  },
];

/**
 * Given the repository's full tracked-file list (e.g. `git ls-files`
 * output, posix or Windows separators either way) and the bare names this
 * `.dockerignore` mentions, returns the subset of those names that occur as
 * a path SEGMENT of some tracked file strictly below the repository root
 * (index 0 of the split path is the root level; a match there does not
 * count). This is a fifth, fully generic evidence source alongside the four
 * named families above — unlike those, it needs no per-tool knowledge at
 * all, because it works directly off what git already tracks. It is what
 * catches a bare name that recurs by being COMMITTED at more than one
 * depth rather than produced by a build/tool — e.g.
 * `packages/expo-two-way-audio/.github/workflows/*.yml`, a real, tracked,
 * nested `.github` directory (leftover CI config from the AGPL-ported
 * upstream package) that none of the four families' example strings would
 * ever match, since `.github` is not an npm/tsc/Playwright/Metro artifact
 * name at all. It is deliberately blind to anything gitignored
 * (`node_modules`, `dist`, ...) — those never appear in a tracked-file
 * list regardless of how many copies exist on disk, which is exactly why
 * the four families above exist for them.
 *
 * @param {string[]} trackedFiles
 * @param {string[]} bareNames
 * @returns {Set<string>}
 */
export function findTrackedNestedNames(trackedFiles, bareNames) {
  const patterns = bareNames.map((name) => ({ name, regExp: nameGlobToRegExp(name) }));
  const found = new Set();
  for (const file of trackedFiles) {
    const segments = file.replace(/\\/g, "/").split("/");
    for (let i = 1; i < segments.length; i++) {
      for (const p of patterns) {
        if (p.regExp.test(segments[i])) found.add(p.name);
      }
    }
  }
  return found;
}

/**
 * @typedef {{
 *   packageJsonDirs: string[],
 *   tsconfigDirs: string[],
 *   playwrightConfigDirs: string[],
 *   expoConfigDirs: string[],
 *   realNestedNames?: Set<string>,
 * }} DockerignoreEvidence
 * Every `*Dirs` array holds repository-relative directories (posix
 * separators, `"."` for the repository root) containing at least one
 * tracked file of that family's kind. `realNestedNames` (optional, may be
 * omitted or empty) is the UNION of `findTrackedNestedNames` above (always
 * available, any checkout) and `findRealNestedOccurrences` in
 * run-guard-dockerignore-depth.mjs (best-effort, build-state dependent) —
 * bare names actually found at a depth greater than zero; when present for
 * a given name it settles the question regardless of the family tables
 * above (strongest possible evidence; see the "DISCLOSED GAP" header
 * comment for why `*.log` depends on the disk-only half of this alone).
 */

/**
 * Does this bare target name recur at more than one depth in this
 * repository, per the evidence gathered? See this file's header for the
 * full reasoning; this is the single decision point everything else feeds.
 *
 * @param {string} target
 * @param {DockerignoreEvidence} evidence
 * @returns {boolean}
 */
export function bareNameNeedsDepthAgnostic(target, evidence) {
  if (evidence.realNestedNames?.has(target)) return true;
  const regExp = nameGlobToRegExp(target);
  for (const family of RECURRING_ARTIFACT_FAMILIES) {
    if (!regExp.test(family.example)) continue;
    const dirs = /** @type {string[] | undefined} */ (evidence[family.evidenceKey]) ?? [];
    if (dirs.some((dir) => dir !== ".")) return true;
  }
  return false;
}

/**
 * @param {{ dockerignoreContent: string, evidence: DockerignoreEvidence }} args
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function findDockerignoreDepthViolations({ dockerignoreContent, evidence }) {
  const violations = [];
  for (const pattern of parseDockerignoreLines(dockerignoreContent)) {
    const target = bareTargetName(pattern);
    if (target === null) continue; // out of scope: negation, or a specific scoped path
    if (pattern.startsWith("**/")) continue; // already depth-agnostic

    if (bareNameNeedsDepthAgnostic(target, evidence)) {
      violations.push(
        `"${pattern}" names "${target}", which recurs at more than one depth in this repository ` +
          `(see the matching family's evidence) but has no "**/" prefix — Docker's ignore matcher ` +
          `anchors it to the build context root only, so nested occurrences are never excluded`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}
