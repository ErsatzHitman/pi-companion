#!/usr/bin/env node
// CLI entry point for the emulator-script POSIX guard (T319). Run from the
// repository root; CI runs it as the `guard-emulator-script-posix` job. See
// scripts/ci/guard-emulator-script-posix.mjs for the rule and the six
// minutes of emulator boot that a one-word bashism used to cost.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  extractEmulatorScriptBlocks,
  findEmulatorScriptViolations,
  selectWorkflowFiles,
} from "./guard-emulator-script-posix.mjs";

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
}

function main() {
  const workflows = selectWorkflowFiles(listTrackedFiles()).map((path) => ({
    path,
    content: readFileSync(path, "utf8"),
  }));

  const scriptCount = workflows.reduce(
    (total, workflow) => total + extractEmulatorScriptBlocks(workflow.content).length,
    0,
  );

  // Non-vacuity. This repository runs the emulator action today, so zero
  // extracted scripts means the extraction stopped working — a workflow
  // shape it was not written for, or a renamed action — not that the tree
  // got cleaner. Without this the guard would report OK forever after any
  // such change, which is the shape CLAUDE.md's T211/T217 sections keep
  // re-finding.
  if (scriptCount === 0) {
    console.error("guard-emulator-script-posix: FAILED");
    console.error(
      `  found no android-emulator-runner \`script:\` blocks across ${workflows.length} ` +
        "workflow(s). This repository has two; the extraction is broken.",
    );
    process.exitCode = 1;
    return;
  }

  const violations = findEmulatorScriptViolations(workflows);

  if (violations.length === 0) {
    console.log(
      `guard-emulator-script-posix: OK — all ${scriptCount} emulator \`script:\` block(s) are ` +
        "free of the checked bashisms.",
    );
    return;
  }

  console.error("guard-emulator-script-posix: FAILED");
  for (const violation of violations) {
    console.error(`  ${violation.path}: ${violation.reason}`);
  }
  console.error(
    "  reactivecircus/android-emulator-runner runs `script:` through `/usr/bin/sh -c`, which is " +
      "dash on Ubuntu runners — not bash. An ordinary `run:` step defaults to bash and is " +
      "unaffected; only the emulator action's own script is checked.",
  );
  process.exitCode = 1;
}

main();
