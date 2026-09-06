#!/usr/bin/env node
// CLI entry point for the packages/app + legacy-import guard. Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-no-legacy-app-tree.mjs`).
// See scripts/ci/guard-no-legacy-app-tree.mjs for the checked rules.

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

  const scannable = paths.filter(
    (path) => !ALLOWLISTED_PATHS.has(path) && SCANNED_EXTENSIONS.has(extname(path)),
  );
  const files = scannable.map((path) => ({ path, content: readFileSync(path, "utf8") }));

  const { pathViolations, referenceViolations } = findViolations(paths, files);

  if (pathViolations.length === 0 && referenceViolations.length === 0) {
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
  process.exitCode = 1;
}

main();
