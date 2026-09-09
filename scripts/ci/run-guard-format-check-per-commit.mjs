#!/usr/bin/env node
// CLI entry point for the per-commit format:check guard (T137). Run from
// anywhere inside the repository:
//
//   node scripts/ci/run-guard-format-check-per-commit.mjs [<git-range>]
//
// `<git-range>` is any range `git rev-list` accepts (e.g.
// `68f899f..d89058c`, `origin/main...HEAD`). If omitted, it defaults to the
// repository's ENTIRE history (`<root commit>..HEAD`) -- this is deliberately
// NOT how the guard is meant to run in CI (a whole-history scan would rerun
// oxfmt over every historical commit's changed files on every CI run,
// forever; the wired CI job instead passes this run's own
// `merge-base(base, HEAD)..HEAD`, exactly mirroring
// `run-guard-no-wave-self-revert.mjs`'s dry-run-vs-wired-job split -- see
// that script's header and `.github/workflows/ci.yml`'s
// `guard-no-wave-self-revert` job for the precedent this follows). See
// `guard-format-check-per-commit.mjs`'s module header for the full
// range-bound rationale and the measured wall-clock this task's report
// quotes.
//
// For each commit in the range (oldest first, merges skipped -- a merge
// commit's diff against a single parent does not mean "the files this
// commit changed" the way an ordinary commit's does, and this guard is
// about linear wave history same as guard-no-wave-self-revert):
//
//   1. `git diff-tree --numstat -z --diff-filter=ACMR <sha>` lists every
//      file that commit added, copied, modified, or renamed-to (never a
//      file it only deleted -- nothing to format-check there) and, via the
//      `-z` NUL-terminated form, sidesteps git's C-style quoting of unusual
//      filenames entirely (see guard-format-check-per-commit.mjs's
//      `parseNumstatRecords` doc comment).
//   2. Binary files (numstat's `-`/`-` marker) are skipped -- oxfmt has no
//      defined behavior for arbitrary bytes piped through a text formatter.
//   3. Every remaining file's post-commit blob content
//      (`git show <sha>:<path>`) is written into a per-commit scratch
//      directory that mirrors the repository's relative path layout,
//      alongside a copy of THAT COMMIT's own `.oxfmtrc.json`
//      (`git show <sha>:.oxfmtrc.json`, falling back to the working tree's
//      current copy if that commit predates the config file entirely) --
//      preserving the real relative layout is what lets oxfmt apply its own
//      `ignorePatterns` (`*.lock`, `**/*.gen.ts`, `**/*.gen.tsx`,
//      `memory.md`, `.dev/**`) exactly as it would for a real checkout,
//      without this guard reimplementing glob matching itself.
//   4. The PINNED oxfmt binary (never `npx`, which resolves a floating,
//      unpinned version -- see resolveOxfmtBinary below and this task's
//      report for the six false failures that produced at the real P6-W10
//      gate) is run once per commit: `oxfmt --list-different <scratchDir>`.
//      Clean output + exit 0 means every file in that commit is correctly
//      formatted; each printed line is an absolute path to a file that is
//      NOT, and is turned back into that file's real repository-relative
//      path by `relativizeOxfmtListDifferentOutput`.
//   5. The scratch directory is removed before moving to the next commit.
//
// T148 adds one more comparison per changed file: this same procedure is
// ALSO run against each file's blob at the commit's own immediate first
// parent (`git show <sha>^:<path>`, skipped -- meaning "no parent blob" --
// when the path did not exist there, e.g. the commit added it), using that
// parent's own `.oxfmtrc.json` the same way. `classifyFormatRedCommits`
// (guard-format-check-per-commit.mjs) then reports only a commit that
// itself flipped a path from green/absent to red as a FAILURE; a path that
// was already red at the parent is reported as a non-failing NOTE instead
// -- this is what stops an unrelated edit to an already-red file (P6-W13's
// `20062c3`, which only touched a different section of a file broken two
// commits earlier) from being named an offender, while keeping the break
// itself visible per T137's original goal. `classifyFormatRedCommits`
// still evaluates every commit in the range independently -- this is the
// entire point of a PER-COMMIT check: a commit in the MIDDLE of the range
// can be flagged even when the range's last commit undid the damage, which
// is exactly what happened at the real `68f899f..d89058c` (`4a23d89` red,
// `9b01176` silently fixed it, `d89058c` tip green) and what a tip-only
// `npm run format:check` can never see -- T148 keeps that same per-commit
// visibility, it just also says WHICH commit is at fault for each red
// path, versus which commit merely inherited it.
//
// T150 adds ONE further comparison, and only for a path found red at BOTH
// the commit and its parent (T148's "inherited" candidates): each of the
// commit's and the parent's raw content is reformatted with the pinned
// oxfmt (`formatContentWithOxfmt`, into its own disposable scratch
// directory so this never disturbs the commit/parent directories above),
// and the number of hunks in a REAL `git diff --no-index -U0` between each
// blob's raw and reformatted content is counted (`diffHunkCount` /
// `countDiffHunks`). `classifyFormatRedCommits`'s `pathWasWorsened` then
// fails the commit, instead of merely noting it, when the commit's hunk
// count is HIGHER than the parent's -- i.e. this commit added a distinct
// new violation oxfmt did not already want to correct at the parent, not
// just carried the same one forward. This closes the P6-W14 merge gate's
// `C3..C4` gap: T148 alone reported a second, independent break added to an
// already-red file as just another non-failing NOTE.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classifyFormatRedCommits,
  countDiffHunks,
  isBinaryNumstatRecord,
  parseNumstatRecords,
  relativizeOxfmtListDifferentOutput,
} from "./guard-format-check-per-commit.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const MAX_BUFFER = 1024 * 1024 * 256;

/** Commit count above which this guard prints a cost warning -- not a hard
 * failure (a deliberate manual dry run over a long range is legitimate; see
 * the module header), just a signal matching CLAUDE.md's "if a command is
 * genuinely too slow ... that is a signal the task is mis-scoped" doctrine.
 * The wired CI job never approaches this: it is always scoped to one
 * push's/PR's own commits. */
const LARGE_RANGE_WARNING_THRESHOLD = 200;

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    cwd: repoRoot,
    ...options,
  });
}

/**
 * Resolves the PINNED oxfmt entry script directly -- never `npx oxfmt`,
 * which resolves whatever version npm's registry serves at invocation time
 * regardless of what `package.json`/`package-lock.json` pin. That gap is
 * not theoretical: `npx oxfmt --check .` reported six false failures at the
 * real P6-W10 merge gate, at a HEAD where the pinned
 * `./node_modules/.bin/oxfmt` (0.46.0, matching both `package.json`'s
 * `devDependencies.oxfmt` and `package-lock.json`) exits 0 over 2324 files
 * -- see this task's report for the reproduction.
 *
 * Resolves the real entry file under `node_modules/oxfmt/bin/` rather than
 * the `node_modules/.bin/oxfmt` shim, for the same reason
 * run-guard-server-test-typecheck-ceiling.mjs resolves tsgo's real entry
 * directly: this script is invoked with plain `node`, which does not run a
 * shell and therefore does not pick up the `.bin` shim's shebang/PATHEXT
 * handling the way `npm run` would.
 *
 * FAILS LOUDLY (throws) if the package is not installed -- this must never
 * silently skip the check. A missing `node_modules/oxfmt` most often means
 * `npm ci`/`npm install` was never run; see this task's report for exactly
 * what that failure prints.
 */
function resolveOxfmtBinary() {
  const entry = path.join(repoRoot, "node_modules", "oxfmt", "bin", "oxfmt");
  if (!existsSync(entry)) {
    throw new Error(
      `run-guard-format-check-per-commit: pinned oxfmt binary not found at ${entry}. ` +
        "Run `npm ci` first -- this guard refuses to silently skip the check or fall back to an unpinned `npx oxfmt`.",
    );
  }
  return entry;
}

function resolveRange(argv) {
  const explicitRange = argv[2];
  if (explicitRange) return explicitRange;
  const root = git(["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
  return `${root}..HEAD`;
}

function listCommitShas(range) {
  const out = git(["rev-list", "--reverse", "--no-merges", range]).trim();
  return out ? out.split("\n") : [];
}

function loadCommitMessage(sha) {
  return git(["log", "-1", "--format=%B", sha]);
}

/** Every file `sha` added, copied, modified, or renamed-to, excluding binaries. */
function loadChangedTextFiles(sha) {
  const raw = git([
    "diff-tree",
    "--no-commit-id",
    "-r",
    "--numstat",
    "-z",
    "--diff-filter=ACMR",
    sha,
  ]);
  return parseNumstatRecords(raw)
    .filter((record) => !isBinaryNumstatRecord(record))
    .map((record) => record.path);
}

function loadBlobAtCommit(sha, relPath) {
  return git(["show", `${sha}:${relPath}`]);
}

/** Same as `loadBlobAtCommit`, but returns `null` instead of throwing when
 * `relPath` does not exist at `sha` -- T148 needs this to tell "the parent
 * had this file and it was clean" apart from "this commit added the file",
 * both of which mean the same thing for classification (this commit is
 * responsible for the file being red) but are reached differently.
 *
 * T303: a bare `git show "<sha>:<relPath>"` does NOT answer "does this path
 * exist at this commit?" unambiguously -- CORRECTED, this used to claim "any
 * `git show` failure is treated as 'path absent at this commit'; the only
 * realistic cause here is exactly that", which is false for any path
 * containing `[` or `]`, i.e. every Expo Router dynamic segment in both
 * apps (`apps/android/src/app/h/[serverId]/...`,
 * `apps/web/src/app/.../[agentId]/...`). Measured against the real
 * repository at the P9-S gate: `git show "<sha>:<plain-absent-path>"` fails
 * with `fatal: path '...' exists on disk, but not in '<sha>'` and throws, as
 * expected -- but `git show "<sha>:apps/android/src/app/h/[serverId]/devices.tsx"`
 * for that same file at a commit before it existed EXITS 0 and prints a
 * commit log dump instead, because git falls back to interpreting the
 * bracketed `<sha>:<path>` string as a revision-range pathspec rather than
 * failing to resolve it as an object. A caller trusting that exit code would
 * wrongly conclude the path exists. `git cat-file -e "<sha>:<path>"` does
 * not have this failure mode -- verified directly against this same
 * repository for all three shapes a caller here can hit: a plain absent
 * path, a bracketed absent path, and a bracketed path that genuinely exists
 * all exit with the correct code (128, 128, 0 respectively), so it is used
 * here as a existence check performed BEFORE any content is requested;
 * `git show` is then safe to call for the actual content, because at that
 * point the path is already known to resolve to a real blob and the
 * ambiguity this comment describes cannot arise (confirmed directly: `git
 * show` on an EXISTING bracketed path returns the exact blob content, same
 * as for a plain path -- the fallback-to-pathspec behavior only triggers
 * when the object fails to resolve). */
export function tryLoadBlobAtCommit(sha, relPath) {
  try {
    // A missing path is the EXPECTED, common case here (any file the
    // commit added has no parent blob at all) -- `stdio` is fully ignored
    // so git's routine "fatal: path ... exists on disk, but not in '<sha>'"
    // does not spam every caller of this guard for what is normal control
    // flow, not a real error.
    git(["cat-file", "-e", `${sha}:${relPath}`], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    return null;
  }
  return git(["show", `${sha}:${relPath}`], { stdio: ["ignore", "pipe", "ignore"] });
}

/** The commit's immediate first parent's sha, or `null` for a root commit
 * (no parent at all). `shas` passed into this script's main loop always
 * come from `listCommitShas`, which already excludes merge commits
 * (`--no-merges`), so an ordinary commit here has at most one parent and
 * `%P` never needs disambiguating between several. */
function loadParentSha(sha) {
  const parents = git(["log", "-1", "--format=%P", sha]).trim();
  return parents ? parents.split(/\s+/)[0] : null;
}

/** The commit's own `.oxfmtrc.json`, or the working tree's current copy if
 * that commit predates the config file (so an early-history commit does
 * not simply crash this guard). */
function loadConfigAtCommit(sha) {
  try {
    return git(["show", `${sha}:.oxfmtrc.json`]);
  } catch {
    return git(["show", "HEAD:.oxfmtrc.json"]);
  }
}

/** Writes `content` to `relPath` under `scratchDir`, creating parent
 * directories as needed -- Expo Router's `[serverId]`/`[agentId]` bracket
 * segments are ordinary path characters and need no special handling. */
function writeScratchFile(scratchDir, relPath, content) {
  const target = path.join(scratchDir, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Runs the pinned oxfmt against one commit's scratch directory. Returns
 * the relative (repository-style) paths of every file that is not
 * correctly formatted. Distinguishes a genuine "found differences" exit
 * (oxfmt exits non-zero, `execFileSync` throws, but the thrown error still
 * carries the process's real `.stdout`) from a real spawn failure (no such
 * property) the same way run-guard-server-test-typecheck-ceiling.mjs's
 * `isSpawnFailure` does. */
function listDifferentFiles(oxfmtEntry, scratchDir) {
  try {
    const stdout = execFileSync(process.execPath, [oxfmtEntry, "--list-different", scratchDir], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return relativizeOxfmtListDifferentOutput(stdout, scratchDir);
  } catch (err) {
    if (typeof err.status !== "number") {
      // Not a normal "oxfmt exited non-zero" — the process never
      // completed a real run at all. Propagate rather than silently
      // reporting "no differences".
      throw err;
    }
    return relativizeOxfmtListDifferentOutput(err.stdout ?? "", scratchDir);
  }
}

/** T150: runs the pinned oxfmt `--write` against `rawContent` (for
 * `relPath`, formatted per `oxfmtrcContent`) in its OWN disposable scratch
 * directory -- never one of `main`'s per-commit/per-parent directories --
 * and returns the formatted content as a string. Mirrors `relPath`'s own
 * relative layout in that throwaway directory for the same reason the
 * commit/parent scratch directories above do: so oxfmt's `ignorePatterns`
 * apply exactly as they would for a real checkout. */
function formatContentWithOxfmt(oxfmtEntry, relPath, rawContent, oxfmtrcContent) {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-format-check-per-commit-fmt-"));
  try {
    writeScratchFile(dir, ".oxfmtrc.json", oxfmtrcContent);
    writeScratchFile(dir, relPath, rawContent);
    execFileSync(process.execPath, [oxfmtEntry, "--write", dir], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return readFileSync(path.join(dir, relPath), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** T150: the number of hunks in the REAL, `git diff --no-index -U0` unified
 * diff between two in-memory strings -- written to a throwaway pair of temp
 * files purely so git's own diff engine does the line-diffing (never this
 * repository's tracked history; these two files are never committed
 * anywhere). Returns 0 without shelling out at all when the strings are
 * identical -- oxfmt already correctly formatted, nothing to count. See
 * `guard-format-check-per-commit.mjs`'s `countDiffHunks` for how the
 * resulting diff text is turned into a hunk count, and its `pathWasWorsened`
 * for how that count is used. */
function diffHunkCount(contentA, contentB) {
  if (contentA === contentB) return 0;
  const dir = mkdtempSync(path.join(tmpdir(), "guard-format-check-per-commit-diff-"));
  try {
    const fileA = path.join(dir, "a");
    const fileB = path.join(dir, "b");
    writeFileSync(fileA, contentA);
    writeFileSync(fileB, contentB);
    try {
      const stdout = git(["diff", "--no-index", "--no-color", "-U0", fileA, fileB]);
      return countDiffHunks(stdout);
    } catch (err) {
      if (typeof err.status !== "number") {
        throw err;
      }
      return countDiffHunks(err.stdout ?? "");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const oxfmtEntry = resolveOxfmtBinary();
  const range = resolveRange(process.argv);
  const shas = listCommitShas(range);

  if (shas.length > LARGE_RANGE_WARNING_THRESHOLD) {
    console.warn(
      `guard-format-check-per-commit: WARNING — range ${range} spans ${shas.length} commits, ` +
        `above this guard's ${LARGE_RANGE_WARNING_THRESHOLD}-commit cost signal. This guard is designed for a ` +
        "single wave's own commit range (see the module header); a range this large is a sign the range " +
        "argument is mis-scoped, not a reason to add a hard cutoff here. Continuing anyway.",
    );
  }

  const scratchBase = mkdtempSync(path.join(tmpdir(), "guard-format-check-per-commit-"));
  const commits = [];
  try {
    for (const sha of shas) {
      const message = loadCommitMessage(sha);
      const changedFiles = loadChangedTextFiles(sha);
      const parentSha = loadParentSha(sha);

      const commitScratchDir = path.join(scratchBase, `${sha}-commit`);
      const parentScratchDir = path.join(scratchBase, `${sha}-parent`);
      mkdirSync(commitScratchDir, { recursive: true });
      mkdirSync(parentScratchDir, { recursive: true });

      let redAtCommit = [];
      let redAtParent = [];
      const existsAtParent = new Map();
      const rawContentAtCommit = new Map();
      const rawContentAtParent = new Map();
      let configAtCommitContent = null;
      let configAtParentContent = null;
      try {
        // This commit's own post-commit content.
        configAtCommitContent = loadConfigAtCommit(sha);
        writeScratchFile(commitScratchDir, ".oxfmtrc.json", configAtCommitContent);
        for (const relPath of changedFiles) {
          const content = loadBlobAtCommit(sha, relPath);
          rawContentAtCommit.set(relPath, content);
          writeScratchFile(commitScratchDir, relPath, content);
        }
        redAtCommit =
          changedFiles.length > 0 ? listDifferentFiles(oxfmtEntry, commitScratchDir) : [];

        // T148: the SAME paths' content at the immediate first parent, so a
        // red path can be classified as introduced-here vs inherited. A
        // root commit (parentSha === null) has nothing to compare against
        // -- every one of its red paths is, correctly, its own fault.
        if (parentSha !== null) {
          configAtParentContent = loadConfigAtCommit(parentSha);
          writeScratchFile(parentScratchDir, ".oxfmtrc.json", configAtParentContent);
          let anyParentFile = false;
          for (const relPath of changedFiles) {
            const parentBlob = tryLoadBlobAtCommit(parentSha, relPath);
            existsAtParent.set(relPath, parentBlob !== null);
            if (parentBlob !== null) {
              rawContentAtParent.set(relPath, parentBlob);
              writeScratchFile(parentScratchDir, relPath, parentBlob);
              anyParentFile = true;
            }
          }
          redAtParent = anyParentFile ? listDifferentFiles(oxfmtEntry, parentScratchDir) : [];
        }
      } finally {
        rmSync(commitScratchDir, { recursive: true, force: true });
        rmSync(parentScratchDir, { recursive: true, force: true });
      }

      const redAtCommitSet = new Set(redAtCommit);
      const redAtParentSet = new Set(redAtParent);
      const redPaths = changedFiles
        .filter((relPath) => redAtCommitSet.has(relPath))
        .map((relPath) => {
          const wasRedAtParent =
            existsAtParent.get(relPath) === true && redAtParentSet.has(relPath);
          const entry = { path: relPath, redAtParent: wasRedAtParent, parentSha };
          if (wasRedAtParent) {
            // T150: both sides are red -- compare the SIZE of the
            // correction oxfmt would apply (a count of diff hunks between
            // the raw content and oxfmt's own reformatted output) to tell
            // "this commit merely carried the same break forward" apart
            // from "this commit made it WORSE" (classifyFormatRedCommits's
            // `pathWasWorsened`).
            const formattedAtCommit = formatContentWithOxfmt(
              oxfmtEntry,
              relPath,
              rawContentAtCommit.get(relPath),
              configAtCommitContent,
            );
            const formattedAtParent = formatContentWithOxfmt(
              oxfmtEntry,
              relPath,
              rawContentAtParent.get(relPath),
              configAtParentContent,
            );
            entry.redHunkCountAtCommit = diffHunkCount(
              rawContentAtCommit.get(relPath),
              formattedAtCommit,
            );
            entry.redHunkCountAtParent = diffHunkCount(
              rawContentAtParent.get(relPath),
              formattedAtParent,
            );
          }
          return entry;
        });

      commits.push({ sha, message, redPaths });
    }
  } finally {
    rmSync(scratchBase, { recursive: true, force: true });
  }

  const { introduced, inherited } = classifyFormatRedCommits(commits);

  const reportInherited = () => {
    if (inherited.length === 0) return;
    console.error(
      "  NOTE — inherited (already format-red at the immediate parent; not counted as a failure):",
    );
    for (const note of inherited) {
      const subject = note.message.split("\n")[0];
      const parentLabel = note.parentSha ?? "(root commit, no parent)";
      console.error(`  ${note.sha}  ${subject}`);
      console.error(`    format-red (already red at parent ${parentLabel}): ${note.path}`);
    }
  };

  if (introduced.length === 0) {
    console.log(
      `guard-format-check-per-commit: OK — no commit in ${range} newly introduced a format-red file (${commits.length} commits scanned).`,
    );
    reportInherited();
    return;
  }

  console.error("guard-format-check-per-commit: FAILED");
  for (const violation of introduced) {
    const subject = violation.message.split("\n")[0];
    console.error(`  ${violation.sha}  ${subject}`);
    for (const p of violation.paths) {
      console.error(`    format-red: ${p}`);
    }
  }
  reportInherited();
  console.error(
    "  At least one commit in this range ITSELF turned a file from green (or absent) to format-red " +
      "(see CLAUDE.md's T93 section and docs/issues-from-plan.md's T137/T148). The ONLY fix is to " +
      "make the named commit(s) format-green as of their own content — amend or squash while the " +
      "range is still local. A later commit that reformats the named files does NOT clear this, " +
      "however clearly its message says so: `classifyFormatRedCommits` compares each touched path " +
      "against that commit's own parent and never reads any later commit. That is T137's stated " +
      "acceptance criterion, not an oversight — the incident it was built for (`4a23d89`) WAS " +
      "repaired by a later commit in the same range, and the criterion is that the check fails " +
      "anyway.",
  );
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
