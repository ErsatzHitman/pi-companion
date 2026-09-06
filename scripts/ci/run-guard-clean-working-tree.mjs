#!/usr/bin/env node
// CLI entry point for the clean-working-tree guard (T93). Run from
// anywhere inside the repository:
//
//   node scripts/ci/run-guard-clean-working-tree.mjs
//
// This is the wave-end check: run it as the LAST step before reporting a
// wave (or any verification pass) done. A non-zero exit means the working
// tree carries uncommitted changes that no commit — and therefore nothing
// any later reader of `git log` — actually contains. See
// scripts/ci/guard-clean-working-tree.mjs for the checked rule, what it
// deliberately ignores and why, and the P5-W22/P5-W23 incidents this
// guard exists to have caught.
//
// Resolves the repository root itself (`git rev-parse --show-toplevel`)
// before running `git status`, so the result is identical regardless of
// the directory this script is invoked from — `git status --porcelain`'s
// paths are relative to the current directory by default, and a verifier
// running this from a package subdirectory must still see every dirty
// file, not just the ones under that subdirectory.
//
// `--untracked-files=all` is passed deliberately: the default
// (`--untracked-files=normal`) collapses an untracked directory to one
// `?? dir/` line, which would still fail this guard but would not "name
// the files" as the task requires — this guard's acceptance criterion is
// that every dirty file is named individually.
//
// `--ignored` is never passed — see guard-clean-working-tree.mjs's module
// header for exactly what that excludes and why that exclusion is correct.
//
// NOT WIRED INTO CI, DELIBERATELY (T96, will-not-wire; T93 filed a CI-
// wiring follow-up and T96 closed it). This guard cannot catch either of
// the incidents it exists for from inside a CI job, because CI never sees
// the uncommitted state that made those incidents real: `actions/checkout`
// always produces a pristine tree, and `npm ci` plus every build in this
// repo write only paths `.gitignore` already covers. Reproduced directly
// (not by reading) with `git worktree add --detach <scratch> <sha>` against
// both motivating commits: at `9ac1184` (P5-W22's silent revert) and at
// `f4446ff` (the commit where `main` was red at P5-W23), a pristine
// worktree checkout is clean and this CLI exits 0 at both. A
// `guard-clean-working-tree` CI job would therefore be green on every run
// by construction, regardless of the commit under test — a check nothing
// can fail is not a check. This guard's only real job is CLAUDE.md's
// wave-end procedure ("Wave-end and merge-gate verification MUST run
// against committed content"): it runs against the WORKING TREE an agent
// has been editing, where that agent's own uncommitted changes are the
// thing under test — precisely the state no CI job ever occupies.

import { execFileSync } from "node:child_process";
import { findDirtyWorkingTreeEntries } from "./guard-clean-working-tree.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const porcelainOutput = git(["-C", root, "status", "--porcelain", "--untracked-files=all"]);
  const entries = findDirtyWorkingTreeEntries(porcelainOutput);

  if (entries.length === 0) {
    console.log("guard-clean-working-tree: OK — working tree is clean, nothing uncommitted.");
    return;
  }

  console.error("guard-clean-working-tree: FAILED");
  console.error(
    `  ${entries.length} uncommitted change${entries.length === 1 ? "" : "s"} in the working tree:`,
  );
  for (const entry of entries) {
    console.error(`    ${entry.status} ${entry.path}`);
  }
  console.error(
    "  A wave (or any verification pass) may not end dirty. Every gate a verifier runs " +
      "against this tree — vitest, typecheck, format — tests these uncommitted changes too, " +
      "and that result stops being real the moment anyone reads `git log` instead of the disk: " +
      "see P5-W22 (an uncommitted fix concealed a silent revert) and P5-W23 (`main` was red at " +
      "a commit whose passing test count existed only with two files applied that no commit " +
      "contained). Commit these files (or intentionally discard them) and re-run this guard " +
      "before reporting the wave done.",
  );
  process.exitCode = 1;
}

main();
