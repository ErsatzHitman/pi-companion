#!/usr/bin/env node
// CLI entry point for the packages/app + legacy-import guard. Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-no-legacy-app-tree.mjs`).
// See scripts/ci/guard-no-legacy-app-tree.mjs for the checked rules, the
// allowlist, and (T213) why a stale allowlist entry is reported as a
// violation class distinct from a genuine legacy reference.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  ALLOWLISTED_PATHS,
  SCANNED_EXTENSIONS,
  findViolations,
} from "./guard-no-legacy-app-tree.mjs";

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function main() {
  const paths = listTrackedFiles();
  const pathSet = new Set(paths);

  const scannable = paths.filter(
    (path) => !ALLOWLISTED_PATHS.has(path) && SCANNED_EXTENSIONS.has(extname(path)),
  );
  // T213: findStaleAllowlistViolations needs content for every ALLOWLISTED_PATHS
  // entry that still exists, regardless of SCANNED_EXTENSIONS — the allowlist
  // itself carries no extension gate, so staleness must be checked even for an
  // entry naming a non-scanned extension. Both real entries are .mjs (already
  // in SCANNED_EXTENSIONS) but this must not depend on that happening to be true.
  const allowlistedExisting = [...ALLOWLISTED_PATHS].filter((path) => pathSet.has(path));
  const files = [...scannable, ...allowlistedExisting].map((path) => ({
    path,
    content: readFileSync(path, "utf8"),
  }));

  const { pathViolations, referenceViolations, staleAllowlistViolations } = findViolations(
    paths,
    files,
  );

  if (
    pathViolations.length === 0 &&
    referenceViolations.length === 0 &&
    staleAllowlistViolations.length === 0
  ) {
    console.log("guard-no-legacy-app-tree: OK — no packages/app path or legacy import found.");
    return;
  }

  console.error("guard-no-legacy-app-tree: FAILED");
  for (const path of pathViolations) {
    console.error(`  packages/app path: ${path}`);
  }
  for (const { path, pattern } of referenceViolations) {
    console.error(`  legacy reference "${pattern}" in: ${path}`);
  }
  for (const { kind, path } of staleAllowlistViolations) {
    if (kind === "stale-missing-path") {
      console.error(
        `  STALE ALLOWLIST ENTRY: ALLOWLISTED_PATHS in scripts/ci/guard-no-legacy-app-tree.mjs ` +
          `names "${path}", but no file by that name is tracked today. Delete or correct that ` +
          "allowlist entry — there is no file left to excuse.",
      );
    } else {
      console.error(
        `  STALE ALLOWLIST ENTRY: ALLOWLISTED_PATHS in scripts/ci/guard-no-legacy-app-tree.mjs ` +
          `names "${path}", but that file no longer contains any legacy reference this guard ` +
          "would otherwise flag. The entry has outlived its reason — delete it, and never " +
          "reintroduce a legacy reference just to make the old reason true again.",
      );
    }
  }
  process.exitCode = 1;
}

main();
