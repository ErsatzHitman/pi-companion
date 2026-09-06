// T93: guard — a wave (or any verification run) must not end with a
// non-empty `git status --porcelain`. Fails on ANY uncommitted change:
// modified tracked files, staged-but-uncommitted files, and untracked
// files that are not covered by `.gitignore`.
//
// This closes the exact hole that concealed the real state of `main` in
// two consecutive waves:
//
//   - P5-W22: `9ac1184` silently reverted `acacff2`'s (T75) fix inside a
//     shared contract test. The revert survived only because an
//     UNCOMMITTED copy of the reverted fix sat in the working tree — the
//     verifier's own tree looked green because it was testing content no
//     commit contained. T89's guard-no-wave-self-revert now catches the
//     revert itself; this guard is the other half — it would have failed
//     the wave the moment that orphaned fix was still sitting uncommitted,
//     before any test ran at all.
//
//   - P5-W23: `main` was RED at `f4446ff` — T86's `25f15e1` committed
//     `expect(code).not.toMatch(/webview=/)` under a test name asserting
//     "no webview prop" is the honest current state; three commits later
//     T80's `632f372` committed BOTH `webview={core.terminalWebview}` on
//     the real route AND its own `toMatch(/<TerminalScreen[\s\S]{0,300}
//     webview=\{core\.terminalWebview\}/)` assertion pinning the opposite.
//     There was no tree state at HEAD where both could pass. The verifier
//     nonetheless reported `2141 passed` — a number that exists ONLY with
//     `apps/android/e2e/flows/files-and-terminal.contract.test.ts` and
//     `apps/android/maestro/files-and-terminal.yaml` patched in, uncommitted
//     (the fix `ae7c09d` later committed on top). Every gate that verifier
//     ran — the whole suite, the T86 mutation, T80's "typecheck clean" —
//     tested a working tree no commit contained. See this guard's test file
//     for the reproduction against the real `f4446ff` tree with those two
//     files' `ae7c09d` diff re-applied, uncommitted.
//
// What this guard deliberately does NOT flag: anything `.gitignore`
// already excludes. `git status --porcelain` (WITHOUT the `--ignored`
// flag, which this guard's CLI entry point never passes) never reports
// ignored paths at all — untracked scratch output the repository already
// declares disposable (`node_modules/`, `dist/`, `.tmp/`, `*.log`,
// `*.tsbuildinfo`, `test-results/`, `playwright-report/`, `blob-report/`,
// `apps/android/.expo/`, `apps/android/android/`, `apps/android/ios/`,
// `.metro-health-check*`, the workflow-agent scratch under `.pi/` — see
// `.gitignore`) is invisible to this guard by construction, not by a
// suppression list this guard maintains itself. A file that is untracked
// but NOT covered by `.gitignore` (a stray note, a forgotten new file) DOES
// still get flagged — that is exactly the shape of the P5-W22/P5-W23
// failure (a real, unignored, uncommitted change to a real source file),
// and flagging it is the entire point of this guard.
//
// Pure, dependency-free check function only. `run-guard-clean-working-
// tree.mjs` is the CLI entry point that shells out to `git status
// --porcelain` and calls this; this module stays import-safe so
// `guard-clean-working-tree.test.mjs` can seed synthetic porcelain output
// (including the real f4446ff/ae7c09d reproduction) without touching the
// real working tree or spawning git.

/**
 * @typedef {{ status: string, path: string, raw: string }} WorkingTreeEntry
 */

/**
 * Parses one line of `git status --porcelain` (v1 short format) output.
 * Each line is a 2-character status code, a space, then a path — or, for a
 * rename/copy (`R `/`C `), `old/path -> new/path`, in which case `path`
 * resolves to the NEW path (the one that actually needs committing).
 *
 * @param {string} line one non-empty porcelain line, no trailing newline
 * @returns {WorkingTreeEntry}
 */
export function parsePorcelainLine(line) {
  const status = line.slice(0, 2);
  const rest = line.slice(3);
  const arrowIndex = rest.indexOf(" -> ");
  const path = arrowIndex === -1 ? rest : rest.slice(arrowIndex + " -> ".length);
  return { status, path, raw: line };
}

/**
 * @param {string} porcelainOutput the raw stdout of `git status --porcelain`
 *   (any `--untracked-files` mode; never pass `--ignored` output to this —
 *   see the module header comment on why ignored paths must stay excluded)
 * @returns {WorkingTreeEntry[]} every entry found, in the order `git`
 *   printed them; empty when the working tree is clean
 */
export function findDirtyWorkingTreeEntries(porcelainOutput) {
  return porcelainOutput
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map(parsePorcelainLine);
}

/**
 * @param {string} porcelainOutput see {@link findDirtyWorkingTreeEntries}
 * @returns {boolean} true only when the working tree has zero uncommitted,
 *   non-ignored changes
 */
export function isWorkingTreeClean(porcelainOutput) {
  return findDirtyWorkingTreeEntries(porcelainOutput).length === 0;
}
