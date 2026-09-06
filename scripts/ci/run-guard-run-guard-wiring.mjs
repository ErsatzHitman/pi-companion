#!/usr/bin/env node
// CLI entry point for the run-guard-wiring guard (T209). Run from the
// repository root; CI runs it as the `guard-run-guard-wiring` job in
// `.github/workflows/ci.yml` — that job is itself the proof this guard
// works, since it is exactly the `run:` line this guard looks for, in the
// exact workflow file it scans.
// See scripts/ci/guard-run-guard-wiring.mjs for the checked rule, the
// allowlist and its two recorded reasons, and why comment text can never
// satisfy this check.

import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { findUnwiredRunGuardViolations } from "./guard-run-guard-wiring.mjs";

const CI_SCRIPTS_DIR = "scripts/ci/";
const WORKFLOWS_DIR = ".github/workflows/";
const RUN_GUARD_FILENAME_PATTERN = /^run-guard-.*\.mjs$/;
const WORKFLOW_FILENAME_PATTERN = /\.ya?ml$/;

function listRunGuardFilenames() {
  return readdirSync(CI_SCRIPTS_DIR)
    .filter((entry) => RUN_GUARD_FILENAME_PATTERN.test(entry))
    .sort();
}

function readWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((entry) => WORKFLOW_FILENAME_PATTERN.test(entry))
    .map((entry) => ({
      path: `${WORKFLOWS_DIR}${entry}`,
      content: readFileSync(`${WORKFLOWS_DIR}${entry}`, "utf8"),
    }));
}

export function main() {
  const runnerFilenames = listRunGuardFilenames();
  const workflows = readWorkflows();

  // A guard that finds nothing to check must not report success — the same
  // fail-safe `run-guard-app-id-package-pairing.mjs`'s own runner applies
  // (P8-W11 gate finding F2). If this ever reads zero runners or zero
  // workflow files, something about the repository layout this script
  // expects has changed, and reporting OK would be checking nothing while
  // claiming to have checked everything.
  if (runnerFilenames.length === 0 || workflows.length === 0) {
    console.error("guard-run-guard-wiring: FAILED");
    console.error(
      `  Found ${runnerFilenames.length} run-guard-*.mjs runner(s) under ${CI_SCRIPTS_DIR} and ` +
        `${workflows.length} workflow file(s) under ${WORKFLOWS_DIR}. This guard checked ` +
        "nothing, so it cannot be passing.",
    );
    process.exitCode = 1;
    return;
  }

  const violations = findUnwiredRunGuardViolations({ runnerFilenames, workflows });

  if (violations.length === 0) {
    console.log(
      `guard-run-guard-wiring: OK — every one of ${runnerFilenames.length} scripts/ci/run-guard-*.mjs ` +
        `runner(s) is either invoked by a real \`run:\` step in some .github/workflows/*.yml file, or ` +
        "carries a recorded allowlist reason.",
    );
    return;
  }

  console.error("guard-run-guard-wiring: FAILED");
  for (const { runner, allowlistReason } of violations) {
    if (allowlistReason === null) {
      console.error(
        `  ${CI_SCRIPTS_DIR}${runner} is referenced by no \`run:\` step in any ${WORKFLOWS_DIR}*.yml ` +
          "file (a comment mentioning its filename does not count). Either wire it into a " +
          `workflow job (\`run: node ${CI_SCRIPTS_DIR}${runner}\`), or add a reasoned entry to ` +
          "ALLOWLISTED_UNWIRED_RUN_GUARDS in scripts/ci/guard-run-guard-wiring.mjs explaining why " +
          "it stays unwired on purpose.",
      );
    } else {
      console.error(
        `  ${CI_SCRIPTS_DIR}${runner} has an ALLOWLISTED_UNWIRED_RUN_GUARDS entry, but its reason ` +
          `("${allowlistReason}") is too short to count as a recorded decision (minimum 20 ` +
          "characters). Write a real reason, or wire the runner into a workflow instead.",
      );
    }
  }
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
