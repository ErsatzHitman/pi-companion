#!/usr/bin/env node
// CLI entry point for the `.dockerignore` depth-agnostic-pattern guard
// (T180). Run from anywhere: `node scripts/ci/run-guard-dockerignore-depth.mjs`.
//
// Never runs `docker build` — no Docker toolchain is assumed to be
// installed, and none is invoked here. It reads `.dockerignore` and the
// repository's own tracked file list as plain text/paths; see
// scripts/ci/guard-dockerignore-depth.mjs for exactly what evidence that
// produces and does not produce (in particular, the four tool-convention
// families and the disclosed `*.log` gap).
//
// T257: the real-disk walk below (`findRealNestedOccurrences`) is now
// filtered by `.gitignore` (`gitIgnoredEntries` + `isGitIgnoredPath`), so
// this runner's verdict on a live, dirty working tree means what `ci.yml`'s
// verdict means on its always-clean `checkout` + `setup-node` disk, with no
// `npm ci` and no test run. See guard-dockerignore-depth.mjs's "T257" header
// paragraph for the measured before/after and the argument for filtering
// rather than only documenting the divergence.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  bareTargetName,
  findDockerignoreDepthViolations,
  findTrackedNestedNames,
  isGitIgnoredPath,
  nameGlobToRegExp,
  parseDockerignoreLines,
} from "./guard-dockerignore-depth.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

/**
 * Repository-relative directory of a repository-relative file path, using
 * `.` for a file directly at the repository root — matching this guard's
 * `DockerignoreEvidence` convention.
 *
 * @param {string} repoRelativeFilePath
 * @returns {string}
 */
function dirOf(repoRelativeFilePath) {
  const dir = path.posix.dirname(repoRelativeFilePath.replace(/\\/g, "/"));
  return dir === "" ? "." : dir;
}

/**
 * Unique, repository-relative directories (see `dirOf`) containing at least
 * one tracked file whose BASENAME matches `basenamePattern`.
 *
 * @param {string[]} trackedFiles
 * @param {RegExp} basenamePattern
 * @returns {string[]}
 */
function dirsContaining(trackedFiles, basenamePattern) {
  const dirs = new Set();
  for (const file of trackedFiles) {
    if (basenamePattern.test(path.posix.basename(file.replace(/\\/g, "/")))) {
      dirs.add(dirOf(file));
    }
  }
  return [...dirs];
}

/**
 * T257: the set of paths `.gitignore` (plus git's other standard excludes)
 * currently covers, as posix-separated repository-relative entries — a
 * whole ignored directory comes back as ONE entry with a trailing `/`
 * (git's own `--directory` flag; it does not enumerate every file inside an
 * ignored directory, which is also what keeps this cheap: no need to ask
 * git about the contents of an ignored `node_modules`), an ignored file with
 * none. Feeds `isGitIgnoredPath` (guard-dockerignore-depth.mjs) so
 * `findRealNestedOccurrences` below can skip exactly the state CI's
 * `checkout` + `setup-node` (no `npm ci`, no test run) never has.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
function gitIgnoredEntries(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return new Set(
    output
      .split("\0")
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/\\/g, "/")),
  );
}

/**
 * Best-effort REAL on-disk evidence: for each bare name this `.dockerignore`
 * mentions (whether or not it already carries the double-star-slash
 * prefix), does a matching directory or file actually exist somewhere other
 * than the repository root, right now, that `.gitignore` does NOT already
 * cover? This is additive, strongest-possible evidence for a name that
 * recurs on disk without being gitignored (T257: a developer's own stray,
 * un-ignored directory is the residual case this still catches) — it is NOT
 * required for this guard's correctness (the structural family evidence in
 * guard-dockerignore-depth.mjs covers the seven patterns T177 fixed without
 * it), and before T257 it was also the only evidence source for `*.log`,
 * which has no single owning tool config file (see that file's "DISCLOSED
 * GAP" comment) — T257 narrowed that further still, since `.gitignore`'s own
 * bare `*.log` line normally covers a real nested `.log` file too, which is
 * now filtered out along with everything else `.gitignore` already tracks;
 * see guard-dockerignore-depth.mjs's "T257" header paragraph for why that
 * trade was made. On a pristine checkout (this guard's own CI job: a bare
 * `actions/checkout`, no build, no install) this returns an empty set, same
 * as every other build-state-dependent guard in this directory — and now
 * also on a dirty local checkout whose only nested matches are ordinary
 * gitignored build/test state, which is the parity T257 exists to establish.
 *
 * Bounded: never descends into `.git`, and does not descend into a
 * directory once it has already matched one of the bare names being looked
 * for (matching T177's own `find -type d -name X` style — no need to look
 * inside a `node_modules` for a nested `node_modules`).
 *
 * @param {string} root
 * @param {string[]} bareNames
 * @param {Set<string>} ignoredEntries
 * @returns {Set<string>}
 */
function findRealNestedOccurrences(root, bareNames, ignoredEntries) {
  const patterns = bareNames.map((name) => ({ name, regExp: nameGlobToRegExp(name) }));
  const found = new Set();

  function walk(dir, depth) {
    if (depth > 6) return; // repository is not nested deeper than this in practice
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const isRoot = dir === root;
      const matched = patterns.find((p) => p.regExp.test(entry.name));
      if (matched) {
        // Never descend into anything matching a bare `.dockerignore` name,
        // root-level or not: a root-level match (e.g. `.pi/`, itself a real
        // agent-scratch worktree carrying its OWN full `node_modules` tree,
        // vendored packages' own `.github` folders included) is exactly the
        // kind of noise this walk must not treat as "recurrence" — it is
        // already fully excluded by its own root-anchored pattern, so
        // anything inside it says nothing about whether THIS repository's
        // own build tooling produces a nested copy. Only a match found
        // strictly BELOW the root counts as real evidence.
        if (!isRoot) {
          const relPath = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/");
          // T257: skip anything `.gitignore` already covers — CI's disk
          // never has it, so counting it here is exactly what made this
          // runner's local verdict mean something different from CI's.
          if (!isGitIgnoredPath(relPath, ignoredEntries)) {
            found.add(matched.name);
          }
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(root, 0);
  return found;
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]);
  const dockerignorePath = path.join(root, ".dockerignore");

  if (!existsSync(dockerignorePath)) {
    console.error(`guard-dockerignore-depth: FAILED — missing ${dockerignorePath}`);
    process.exitCode = 1;
    return;
  }

  const dockerignoreContent = readFileSync(dockerignorePath, "utf8");

  const trackedFiles = git(["ls-files"], root)
    .split("\n")
    .filter((line) => line.length > 0);

  const packageJsonDirs = dirsContaining(trackedFiles, /^package\.json$/);
  const tsconfigDirs = dirsContaining(trackedFiles, /^tsconfig[^/]*\.json$/);
  const playwrightConfigDirs = dirsContaining(
    trackedFiles,
    /^playwright\.config\.(ts|js|mjs|cjs)$/,
  );
  const expoConfigDirs = dirsContaining(trackedFiles, /^metro\.config\.js$/);

  const bareNames = [
    ...new Set(
      parseDockerignoreLines(dockerignoreContent)
        .map((pattern) => bareTargetName(pattern))
        .filter((name) => name !== null),
    ),
  ];
  const trackedNestedNames = findTrackedNestedNames(trackedFiles, bareNames);
  const ignoredEntries = gitIgnoredEntries(root);
  const diskNestedNames = findRealNestedOccurrences(root, bareNames, ignoredEntries);
  const realNestedNames = new Set([...trackedNestedNames, ...diskNestedNames]);

  const evidence = {
    packageJsonDirs,
    tsconfigDirs,
    playwrightConfigDirs,
    expoConfigDirs,
    realNestedNames,
  };
  const result = findDockerignoreDepthViolations({ dockerignoreContent, evidence });

  console.log("guard-dockerignore-depth: evidence gathered —");
  console.log(
    `  package.json directories (${packageJsonDirs.length}): ${packageJsonDirs.join(", ")}`,
  );
  console.log(`  tsconfig*.json directories (${tsconfigDirs.length}): ${tsconfigDirs.join(", ")}`);
  console.log(
    `  playwright.config.* directories (${playwrightConfigDirs.length}): ${playwrightConfigDirs.join(", ") || "(none)"}`,
  );
  console.log(
    `  metro.config.js directories (${expoConfigDirs.length}): ${expoConfigDirs.join(", ") || "(none)"}`,
  );
  console.log(
    `  real nested occurrences found on disk: ${[...realNestedNames].join(", ") || "(none)"}`,
  );

  if (result.ok) {
    console.log("guard-dockerignore-depth: OK");
    return;
  }
  console.error("guard-dockerignore-depth: FAILED");
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
}

main();
