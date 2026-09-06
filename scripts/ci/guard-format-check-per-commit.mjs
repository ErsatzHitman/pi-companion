// T137: CI guard — over a commit range, flag any commit that ITSELF makes a
// file format-red, even when the range's final commit (the tip) is green.
//
// This closes the exact hole a tip-only `npm run format:check` cannot see.
// At P6-W10, `main` was red on `format:check` at `4a23d89` (T130, which
// committed a three-line `.replace()` chain in
// `apps/android/src/ui/theme/fonts.test.ts` that oxfmt collapses to one
// 99-character line — under its configured `printWidth: 100`) and green
// again by the wave tip `d89058c`, only because `9b01176` (T132) touched
// that same file for an unrelated reason and, in passing, reformatted it
// back to the collapsed form — without mentioning it in that commit's
// message. Every wave-end gate that ran `format:check` at the tip passed
// throughout; nobody could have known `main` had ever been red. See
// `run-guard-format-check-per-commit.mjs`'s module header for how this
// module's output is produced (real `git`/oxfmt calls) and this file's own
// test for the synthetic reproduction of the `4a23d89`/`9b01176` shape.
//
// T148: T137's first shape flagged any commit whose tree contained a
// format-red file it had touched, whether or not that commit was the one
// that made it red — which, at P6-W13, named `20062c3` an offender for a
// break `docs/issues-from-plan.md` had already carried since the wave base
// two commits earlier. `classifyFormatRedCommits` below now compares each
// touched path's content against its own immediate parent's blob of the
// same path and fails a commit only on a green(or-absent)->red transition;
// a path that was already red at the parent is reported as a non-failing
// NOTE instead (see that function's doc comment for the full rationale and
// `run-guard-format-check-per-commit.mjs`'s header for how the parent
// comparison is computed).
//
// T150: T148's green(or-absent)->red transition is a BOOLEAN, and a boolean
// cannot tell "this commit merely carried an already-red file forward"
// apart from "this commit made an already-red file WORSE by adding a
// brand-new, distinct break to it". Both report `redAtParent: true` at the
// path level, and T148 alone always turned that into a non-failing NOTE.
// The P6-W14 merge gate proved this with a real four-commit chain: green
// file -> red (fails, correct), an unrelated edit to that red file (NOTE,
// correct — this is T148's own fix working), then a SECOND, independent
// break added to the same already-red file — reported as just another NOTE,
// which is the gap this task closes. `pathWasWorsened` below turns that
// boolean into a magnitude comparison (a count of oxfmt correction-diff
// hunks — see its doc comment for why a count and not a threshold, and for
// the two narrower cases even this still cannot see) so a commit that
// widens the damage fails, while a commit that only touches an unrelated
// part of an already-red file still gets T148's NOTE treatment.
//
// **Why "format only each commit's changed files" (the cheapest of the
// three options CLAUDE.md's T137 section names), not a full checkout per
// commit or `git rebase --exec`:** a commit can only make a FILE format-red
// by touching that file — oxfmt's formatting of a file X is a pure function
// of X's own content (and the repository-wide `.oxfmtrc.json`, which this
// guard also reads as of each commit, in case it ever changes over a
// range), never of any OTHER file's content. So checking every file a
// commit's diff touches, using that file's post-commit blob content, is
// exactly as complete as formatting a full checkout of that commit would
// be — it just skips re-checking the thousands of unrelated files a full
// `git checkout` would force back through oxfmt on every single commit for
// no reason.
//
// **What this approach CANNOT catch, as of T150:** a commit that makes some
// OTHER, untouched file format-red only in combination with a
// `.oxfmtrc.json` change in a DIFFERENT commit of the same range in a way
// that depends on cross-file state oxfmt does not have (oxfmt has none —
// each file is formatted independently) — so in practice there is no missed
// case there, only unnecessary work avoided. Separately, `pathWasWorsened`'s
// diff-hunk-count comparison (see its doc comment) is a real but imperfect
// proxy for "did this commit make an already-red file WORSE": two distinct
// violations close enough together that oxfmt's `-U0` correction diff merges
// them into a single hunk at both the parent and the commit will under-count
// — a commit that swaps one violation for a different one at the same
// line, holding the hunk count exactly steady, is also invisible to it. Both
// gaps are narrow (they need an already-red file, a same-hunk collision or a
// same-spot swap, AND no cross-file signal to notice either), disclosed
// rather than fixed, and left to a future task if they ever prove real
// rather than theoretical.
//
// CORRECTED (T150): this paragraph previously ended with "so in practice
// there is no missed case, only unnecessary work avoided" as a claim about
// the WHOLE approach. That was true of T137's original tip-vs-parent
// green/red boolean but stopped being true once T148 introduced a
// PARENT-relative comparison: a commit that adds a brand-new, distinct
// break to a file already red at its parent used to be reported as a
// non-failing inherited NOTE instead of a failure — the exact P6-W14 gap
// `pathWasWorsened` below now closes. See that function's doc comment for
// the fix and the two narrower gaps quoted above that remain after it.
//
// **The range bound**: this module places no limit on how many commits it
// is handed — the CLI wrapper is what bounds the range, and it does so by
// construction rather than by a hardcoded cutoff: `.github/workflows/ci.yml`
// invokes it (see the `guard-format-check-per-commit` job, added alongside
// the pre-existing `guard-no-wave-self-revert` job it is modeled on) with
// `merge-base(<this run's base>, HEAD)..HEAD` — i.e. only the commits THIS
// push/PR/merge-queue-entry itself introduces, never full repository
// history. That is inherently a handful of commits for this repository's
// wave-based workflow (the real reproduction range below is 6), so the
// per-commit-changed-files approach stays cheap indefinitely: cost scales
// with the size of a wave's own diff, not with repository history length.
// Measured wall-clock for the real `68f899f..d89058c` range (6 commits, 50
// non-binary changed-file instances across them, one `git show`/`git
// diff-tree` call per file/commit plus one oxfmt `--list-different`
// invocation per commit): ~4.1s end-to-end on this development machine
// (Windows, Git Bash) — see this task's report for the exact command and
// repeated timing. A bare CLI arg (or the whole-history default
// documented on the wrapper) can still be pointed at an arbitrarily long
// range for a manual dry run; that is deliberately NOT how the wired CI job
// calls it, exactly mirroring `guard-no-wave-self-revert`'s own
// dry-run-vs-wired-job split. T148 roughly doubles the per-commit cost (one
// more oxfmt invocation per commit, against the parent's blobs of the same
// changed paths) — see this task's report for the re-measured wall-clock.
//
// Pure, dependency-free functions only (no `git`, no `child_process`, no
// filesystem). `run-guard-format-check-per-commit.mjs` is the CLI entry
// point that shells out to `git` and the pinned oxfmt binary and calls
// these; this module stays import-safe so
// `guard-format-check-per-commit.test.mjs` can seed synthetic numstat/
// oxfmt output and commit lists without touching the real repository,
// spawning git, or running oxfmt.

/**
 * Parses `git diff-tree --numstat -z`'s NUL-terminated output into one
 * record per changed file. `-z` is what makes this parse-safe: WITHOUT it,
 * git quotes unusual filenames (and some real paths in this repository —
 * Expo Router's `[serverId]`/`[agentId]` segments are ordinary characters
 * so they don't trigger it, but this guard must not assume every future
 * path is that innocuous) inside `"..."` with C-style escapes, and `-z`
 * sidesteps that entirely by using NUL both as the record terminator and
 * by disabling path quoting.
 *
 * @param {string} rawOutput
 * @returns {{ adds: string, dels: string, path: string }[]} `adds`/`dels`
 *   are left as the raw numstat tokens (usually a decimal string, but `-`
 *   for a binary file — see `isBinaryNumstatRecord`) rather than parsed to
 *   numbers, since this guard never needs their numeric value.
 */
export function parseNumstatRecords(rawOutput) {
  return rawOutput
    .split("\0")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const firstTab = record.indexOf("\t");
      const secondTab = record.indexOf("\t", firstTab + 1);
      return {
        adds: record.slice(0, firstTab),
        dels: record.slice(firstTab + 1, secondTab),
        path: record.slice(secondTab + 1),
      };
    });
}

/**
 * A numstat record for a binary file reports `-` for both the added and
 * deleted line counts (there is no meaningful line count for binary
 * content). oxfmt has no defined behavior for arbitrary binary bytes piped
 * through a text formatter, and this repository already declares its own
 * binary asset extensions in `.gitattributes` (images, fonts) — this check
 * is the general form of that same fact, read from git's own diff
 * classification instead of a hardcoded extension list, so it stays
 * correct if a new binary extension is added to `.gitattributes` without
 * anyone updating this guard.
 *
 * @param {{ adds: string, dels: string }} record
 * @returns {boolean}
 */
export function isBinaryNumstatRecord(record) {
  return record.adds === "-" && record.dels === "-";
}

/**
 * oxfmt's `--list-different` prints one absolute path per file that is not
 * already correctly formatted (nothing at all when every file it checked is
 * clean — confirmed against the real pinned binary, see this task's
 * report). It prints paths with forward slashes even on Windows (confirmed
 * against the real pinned binary: `C:/Users/.../t137test/...`, not
 * backslashes), so this function normalizes the supplied root directory the
 * same way before stripping it, rather than assuming either platform's
 * native separator.
 *
 * @param {string} rawOutput stdout from `oxfmt --list-different <rootDir>`
 * @param {string} rootDirAbsPath the absolute directory oxfmt was pointed
 *   at (a per-commit temp directory mirroring the repository's relative
 *   file layout — see the CLI wrapper)
 * @returns {string[]} relative, forward-slash paths (e.g.
 *   `apps/android/src/ui/theme/fonts.test.ts`), one per line oxfmt printed,
 *   in the order oxfmt printed them
 */
export function relativizeOxfmtListDifferentOutput(rawOutput, rootDirAbsPath) {
  const normalizedRoot = rootDirAbsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, "/"))
    .map((line) =>
      line.startsWith(`${normalizedRoot}/`) ? line.slice(normalizedRoot.length + 1) : line,
    );
}

/**
 * T148: a commit can only make a FILE format-red by touching that file --
 * but "this commit's tree contains a format-red file it touched" is NOT the
 * same claim as "this commit made it red". At P6-W13,
 * `docs/issues-from-plan.md` went red at the wave base `cedf76a` (a missing
 * semicolon inside a ```js fence -- oxfmt formats embedded JS in Markdown)
 * and STAYED red, unrelated-edit after unrelated-edit, until `e5c48a2`
 * happened to fix it in passing. `20062c3`, which only edited a different
 * section of that already-red file, was named an offender under "fix the
 * offending commit(s)" -- it inherited a break that predated it by two
 * commits and could not have introduced or fixed it.
 *
 * The fix is a comparison against each commit's own first parent, not a
 * threshold on the commit's own content: a path is this commit's fault only
 * on a green(or-absent)->red TRANSITION. A path with no parent blob (this
 * commit added it) that is red has nothing to compare against and is
 * correctly this commit's problem. A path whose parent blob was ALSO red is
 * inherited -- still worth surfacing (T137's whole point was visibility),
 * but as a non-failing NOTE naming the file and the parent that already
 * carried the break, not as an accusation against the commit that merely
 * left it alone.
 *
 * @typedef {{ path: string, redAtParent: boolean, parentSha: string | null, redHunkCountAtCommit?: number, redHunkCountAtParent?: number }} FormatRedPathTransition
 *   One entry per path that is format-red as of THIS commit's own content
 *   (the caller only includes paths already known to be red at the
 *   commit -- see `redAtCommitSet` in the CLI wrapper). `redAtParent` is
 *   true when that SAME path, as of the commit's immediate first parent's
 *   blob, was ALSO format-red -- i.e. this commit did not change whether
 *   the file is red. `parentSha` is that immediate parent's sha, or `null`
 *   only for a root commit (no parent at all). A path with no parent BLOB
 *   (added by this commit) or a green parent blob has `redAtParent: false`
 *   either way -- both mean THIS commit is responsible for the path being
 *   red right now. `redHunkCountAtCommit`/`redHunkCountAtParent` (T150) are
 *   supplied ONLY when `redAtParent` is true -- see `pathWasWorsened`'s doc
 *   comment for what they hold and why they are what distinguishes "still
 *   just as red" from "made worse". Omitting them (an older caller, or a
 *   fixture that only exercises the boolean transition) is equivalent to
 *   "not worsened", preserving T148's original NOTE-only behaviour.
 * @typedef {{ sha: string, message: string, redPaths: FormatRedPathTransition[] }} CommitFormatTransitions
 *   One entry per commit in the scanned range, oldest first. A commit whose
 *   changed files are all clean (or all inherited-red -- see below)
 *   contributes an empty `redPaths` to `introduced` regardless of order.
 *
 * @typedef {{ sha: string, message: string, paths: string[] }} FormatRedCommit
 *   A commit that ITSELF turned at least one path from green (or absent)
 *   to red -- the guard's actual failure condition.
 * @typedef {{ sha: string, message: string, path: string, parentSha: string | null }} InheritedRedNote
 *   A path that is red at this commit purely because it was ALREADY red at
 *   the immediate parent. `parentSha` names that parent so the note stays
 *   traceable without claiming it is the path's original offender -- the
 *   chain may run further back than one hop, and finding the true origin
 *   is not attempted here because it is not cheap in the general case (it
 *   would mean walking arbitrarily far outside the scanned range).
 */

/**
 * T150: counts the hunks (contiguous change regions) in a unified diff's
 * text by counting its `@@ ...` hunk-header lines. The caller
 * (`run-guard-format-check-per-commit.mjs`'s `diffHunkCount`) produces this
 * text from a REAL `git diff --no-index -U0` between two temp files holding
 * (1) a path's raw blob content and (2) oxfmt's own reformatted output for
 * that same content -- i.e. this counts how many separate regions of a file
 * oxfmt considers wrong, not how many lines changed. `-U0` (zero context
 * lines) is what makes hunk count meaningful as a proxy for "how many
 * distinct violations": with context lines, two nearby-but-separate
 * violations could be merged into one hunk by the SURROUNDING unchanged
 * lines each hunk's context would otherwise include, undercounting even
 * when the violations sit further apart than they do in the zero-context
 * form. A hunk header line always starts with the literal `@@ ` at column 0
 * in git's unified diff output; a content line never does, because every
 * content line carries a leading `+`/`-`/` ` marker -- so counting lines
 * that start with `@@ ` cannot be fooled by a diffed file whose own text
 * happens to contain that substring elsewhere.
 *
 * @param {string} unifiedDiffText
 * @returns {number}
 */
export function countDiffHunks(unifiedDiffText) {
  const matches = unifiedDiffText.match(/^@@ /gm);
  return matches ? matches.length : 0;
}

/**
 * T150: closes the gap T148 left -- a path with `redAtParent: true` was
 * ALWAYS reported as a non-failing NOTE, whether this commit left the exact
 * same break in place (a genuinely unrelated edit -- P6-W13's real
 * `20062c3`) or piled a brand-new, distinct break on top of it (the P6-W14
 * merge gate's synthetic `C3..C4`, which T148 alone also reported as a mere
 * NOTE). Both share `redAtParent: true` at the path level; a boolean cannot
 * tell them apart, so this compares a MAGNITUDE instead: the number of
 * oxfmt correction-diff hunks (see `countDiffHunks`) the path carries at
 * this commit versus at its immediate parent. A commit that leaves the hunk
 * count unchanged (or lowers it -- a partial, non-complete fix is still not
 * a NEW break) only carried the existing damage forward; a commit that
 * RAISES it added something oxfmt did not already want to correct at the
 * parent, which is exactly "made it worse".
 *
 * A count, not a byte-for-byte structural diff of the two correction
 * patches, because a count is what stays STABLE across the kind of
 * incidental change an unrelated edit produces (inserting or deleting lines
 * elsewhere in the file shifts every hunk's line numbers without changing
 * how many distinct regions oxfmt flags) while still moving the moment a
 * genuinely new, separate violation appears. It is not perfect: two
 * distinct violations landing close enough together to merge into a single
 * `-U0` hunk at BOTH the parent and the commit undercounts (the doc comment
 * atop this file names this and one more narrow gap explicitly, rather than
 * claiming this closes every case).
 *
 * Returns `false` -- "not worsened", i.e. keep T148's NOTE treatment --
 * when either hunk count is missing, which is what every caller that never
 * populates them (T148's own original tests, any future caller that only
 * cares about the boolean transition) gets by construction.
 *
 * @param {FormatRedPathTransition} redPath
 * @returns {boolean}
 */
export function pathWasWorsened(redPath) {
  const { redHunkCountAtCommit, redHunkCountAtParent } = redPath;
  if (typeof redHunkCountAtCommit !== "number" || typeof redHunkCountAtParent !== "number") {
    return false;
  }
  return redHunkCountAtCommit > redHunkCountAtParent;
}

/**
 * @param {CommitFormatTransitions[]} commits
 * @returns {{ introduced: FormatRedCommit[], inherited: InheritedRedNote[] }}
 *   `introduced` holds every commit that itself flipped at least one path
 *   from green/absent to red, OR (T150) WORSENED a path already red at its
 *   parent by adding a distinct new break to it (see `pathWasWorsened`) --
 *   both are what the guard fails on, and both are reported the same way
 *   (a bare path string) since either is equally this commit's fault.
 *   `inherited` holds one entry per (commit, path) pair where the path was
 *   already red at the immediate parent AND this commit did not make it any
 *   worse -- reported for visibility (T137's entire point) but never
 *   counted toward failure. A path can appear in `inherited` across several
 *   consecutive commits in the range if nothing in that stretch reformats
 *   it or worsens it; each such commit gets its own note, in range order,
 *   same as `introduced`'s per-commit ordering.
 */
export function classifyFormatRedCommits(commits) {
  const introduced = [];
  const inherited = [];
  for (const commit of commits) {
    const introducedPaths = [];
    for (const redPath of commit.redPaths) {
      if (redPath.redAtParent && !pathWasWorsened(redPath)) {
        inherited.push({
          sha: commit.sha,
          message: commit.message,
          path: redPath.path,
          parentSha: redPath.parentSha,
        });
      } else {
        introducedPaths.push(redPath.path);
      }
    }
    if (introducedPaths.length > 0) {
      introduced.push({ sha: commit.sha, message: commit.message, paths: introducedPaths });
    }
  }
  return { introduced, inherited };
}
