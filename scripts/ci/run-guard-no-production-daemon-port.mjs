#!/usr/bin/env node
// CLI entry point for the apps/android/maestro production-port guard. Run
// from the repository root (CI runs it via `node
// scripts/ci/run-guard-no-production-daemon-port.mjs`).
// See scripts/ci/guard-no-production-daemon-port.mjs for the checked rule.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findProductionDaemonPortViolations } from "./guard-no-production-daemon-port.mjs";

const MAESTRO_PREFIX = "apps/android/maestro/";

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function main() {
  const paths = listTrackedFiles().filter((path) => path.startsWith(MAESTRO_PREFIX));
  const files = paths.map((path) => ({ path, content: readFileSync(path, "utf8") }));
  const violations = findProductionDaemonPortViolations(files);

  if (violations.length === 0) {
    console.log(
      `guard-no-production-daemon-port: OK — no apps/android/maestro/ file names port 6767 (${paths.length} files scanned).`,
    );
    return;
  }

  console.error("guard-no-production-daemon-port: FAILED");
  for (const path of violations) {
    console.error(`  names the production daemon port: ${path}`);
  }
  process.exitCode = 1;
}

main();
