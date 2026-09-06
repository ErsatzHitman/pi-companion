#!/usr/bin/env node
// CLI entry point for the apps/android `.web.*` guard. Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-no-android-web-files.mjs`).
// See scripts/ci/guard-no-android-web-files.mjs for the checked rule.

import { execFileSync } from "node:child_process";
import { findAndroidWebFileViolations } from "./guard-no-android-web-files.mjs";

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function main() {
  const paths = listTrackedFiles();
  const violations = findAndroidWebFileViolations(paths);

  if (violations.length === 0) {
    console.log("guard-no-android-web-files: OK — no *.web.* files under apps/android.");
    return;
  }

  console.error("guard-no-android-web-files: FAILED");
  for (const path of violations) {
    console.error(`  .web.* file under apps/android: ${path}`);
  }
  process.exitCode = 1;
}

main();
