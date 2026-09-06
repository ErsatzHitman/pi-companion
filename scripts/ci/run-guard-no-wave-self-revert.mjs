#!/usr/bin/env node
// CLI entry point for the wave-self-revert guard. Run from the repository
// root:
//
//   node scripts/ci/run-guard-no-wave-self-revert.mjs [<git-range>]
//
// `<git-range>` is any range `git rev-list` accepts (e.g. `acacff2^..9ac1184`,
// `origin/main...HEAD`). If omitted, it defaults to the repository's ENTIRE
// history (`<root commit>..HEAD`) — this is deliberately NOT how the guard
// is meant to run in CI (a whole-history scan is a dry run for proving the
// guard clean before it is ever wired into a blocking job; a wave-scoped
// job would pass the wave's own range instead), see
// scripts/ci/guard-no-wave-self-revert.mjs for the checked rule and
// scripts/ci/guard-no-wave-self-revert.test.mjs for the real P5-W22 case
// this guard exists to catch.
//
// T89 report (see the task's commit): this script is intentionally NOT
// wired into a blocking CI job yet.

import { execFileSync } from "node:child_process";
import { findWaveSelfReverts } from "./guard-no-wave-self-revert.mjs";

const MAX_BUFFER = 1024 * 1024 * 256;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
}

function resolveRange(argv) {
  const explicitRange = argv[2];
  if (explicitRange) return explicitRange;
  const root = git(["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
  return `${root}..HEAD`;
}

function listCommitShas(range) {
  // --reverse: oldest first, matching findWaveSelfReverts's expected order.
  // --no-merges: a merge commit's "diff" against a single parent does not
  // mean what a normal commit's diff means; this guard is about a linear
  // wave history of ordinary commits.
  const out = git(["rev-list", "--reverse", "--no-merges", range]).trim();
  return out ? out.split("\n") : [];
}

/** Splits one `git show --unified=0` diff into per-file added/removed line lists. */
function parseCommitDiff(diffText) {
  const files = [];
  const blocks = diffText.split(/^diff --git .*$/m).slice(1);
  for (const block of blocks) {
    if (block.includes("\nBinary files ")) continue;
    const addedPathMatch = block.match(/^\+\+\+ b\/(.+)$/m);
    const removedPathMatch = block.match(/^--- a\/(.+)$/m);
    const path =
      addedPathMatch && addedPathMatch[1] !== "/dev/null"
        ? addedPathMatch[1]
        : removedPathMatch && removedPathMatch[1] !== "/dev/null"
          ? removedPathMatch[1]
          : null;
    if (!path) continue;

    const addedLines = [];
    const removedLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) addedLines.push(line.slice(1));
      else if (line.startsWith("-")) removedLines.push(line.slice(1));
    }
    files.push({ path, addedLines, removedLines });
  }
  return files;
}

function loadCommit(sha) {
  const message = git(["log", "-1", "--format=%B", sha]);
  const diffText = git(["show", sha, "--unified=0", "--no-color", "--format="]);
  return { sha, message, files: parseCommitDiff(diffText) };
}

function main() {
  const range = resolveRange(process.argv);
  const shas = listCommitShas(range);
  const commits = shas.map(loadCommit);
  const violations = findWaveSelfReverts(commits);

  if (violations.length === 0) {
    console.log(
      `guard-no-wave-self-revert: OK — no commit in ${range} reintroduces text an earlier commit in that range deleted from the same file (${commits.length} commits scanned).`,
    );
    return;
  }

  console.error("guard-no-wave-self-revert: FAILED");
  for (const violation of violations) {
    const deletedSubject = violation.deletedByMessage.split("\n")[0];
    const reintroducedSubject = violation.reintroducedByMessage.split("\n")[0];
    console.error(`  ${violation.path}`);
    console.error(`    deleted by   ${violation.deletedBySha}  ${deletedSubject}`);
    console.error(`    reintroduced by ${violation.reintroducedBySha}  ${reintroducedSubject}`);
    console.error(`    line: ${violation.line.trim()}`);
  }
  console.error(
    '  A later commit in this range re-added text an earlier commit in the same range deleted from the same file. If this is a deliberate revert, say so in the reintroducing commit\'s message (e.g. "Revert ..."); otherwise this is very likely the P5-W22 failure mode — re-read HEAD before committing a shared file.',
  );
  process.exitCode = 1;
}

main();
