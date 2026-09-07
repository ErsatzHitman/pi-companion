#!/usr/bin/env node
// CLI entry point for the workspace-test-coverage guard (T44A4). Run from
// the repository root; CI runs it as the `guard-workspace-test-coverage`
// job in `.github/workflows/ci.yml`.
// See scripts/ci/guard-workspace-test-coverage.mjs for the checked rule,
// the allowlist and its two recorded reasons, and why a stale allowlist
// entry is reported as a violation class distinct from an untested
// workspace.

import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { extractRunStepContents } from "./guard-run-guard-wiring.mjs";
import {
  findWorkspaceTestCoverageViolations,
  resolveWorkspacePackages,
} from "./guard-workspace-test-coverage.mjs";

const WORKFLOWS_DIR = ".github/workflows/";
const WORKFLOW_FILENAME_PATTERN = /\.ya?ml$/;

function readRootWorkspaceGlobs() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  if (!Array.isArray(manifest.workspaces)) {
    throw new Error(
      'package.json\'s "workspaces" field is not an array — cannot resolve workspaces.',
    );
  }
  return manifest.workspaces;
}

function readPackageName(packageJsonPath) {
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof manifest.name === "string" ? manifest.name : null;
  } catch {
    return null;
  }
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
  const workspaces = resolveWorkspacePackages({
    workspaceGlobs: readRootWorkspaceGlobs(),
    listDir: (dir) => readdirSync(dir),
    readPackageName,
  });
  const workflows = readWorkflows();

  // A guard that finds nothing to check must not report success — same
  // fail-safe `run-guard-run-guard-wiring.mjs` and `run-guard-app-id-
  // package-pairing.mjs` apply. If this ever reads zero workspaces or zero
  // workflow files, something about the repository layout this script
  // expects has changed, and reporting OK would be checking nothing while
  // claiming to have checked everything.
  if (workspaces.length === 0 || workflows.length === 0) {
    console.error("guard-workspace-test-coverage: FAILED");
    console.error(
      `  Resolved ${workspaces.length} workspace package(s) from package.json's "workspaces" field ` +
        `and found ${workflows.length} workflow file(s) under ${WORKFLOWS_DIR}. This guard checked ` +
        "nothing, so it cannot be passing.",
    );
    process.exitCode = 1;
    return;
  }

  const violations = findWorkspaceTestCoverageViolations({
    workspaces,
    workflows,
    extractRunStepContents,
  });

  if (violations.length === 0) {
    console.log(
      `guard-workspace-test-coverage: OK — every one of ${workspaces.length} workspace package(s) ` +
        "is either tested by a real `npm run test... --workspace=<name>` step in some " +
        `${WORKFLOWS_DIR}*.yml file, or carries a recorded allowlist reason.`,
    );
    return;
  }

  console.error("guard-workspace-test-coverage: FAILED");
  for (const { kind, workspace, allowlistReason } of violations) {
    if (kind === "stale-missing-workspace") {
      console.error(
        `  STALE ALLOWLIST ENTRY: ALLOWLISTED_UNTESTED_WORKSPACES in ` +
          `scripts/ci/guard-workspace-test-coverage.mjs names "${workspace}", but no workspace by ` +
          `that name resolves from package.json's "workspaces" field today (recorded reason: ` +
          `"${allowlistReason}"). Delete or correct that allowlist entry — there is no workspace ` +
          "left to excuse.",
      );
    } else if (kind === "stale-tested") {
      console.error(
        `  STALE ALLOWLIST ENTRY: ALLOWLISTED_UNTESTED_WORKSPACES in ` +
          `scripts/ci/guard-workspace-test-coverage.mjs names "${workspace}" as legitimately ` +
          `untested (recorded reason: "${allowlistReason}"), but a real \`run:\` step in some ` +
          `${WORKFLOWS_DIR}*.yml file now genuinely tests it. The entry has outlived its reason — ` +
          "delete it, and never unwire the test job just to make the old reason true again.",
      );
    } else if (allowlistReason === null) {
      console.error(
        `  UNTESTED WORKSPACE: "${workspace}" is tested by no \`run:\` step in any ` +
          `${WORKFLOWS_DIR}*.yml file (a comment mentioning its name does not count). Either wire ` +
          "a job running its tests (`npm run test --workspace=" +
          `${workspace}\` or a \`test:*\` variant), or add a reasoned entry to ` +
          "ALLOWLISTED_UNTESTED_WORKSPACES in scripts/ci/guard-workspace-test-coverage.mjs " +
          "explaining why it stays untested on purpose.",
      );
    } else {
      console.error(
        `  UNTESTED WORKSPACE: "${workspace}" has an ALLOWLISTED_UNTESTED_WORKSPACES entry, but its ` +
          `reason ("${allowlistReason}") is too short to count as a recorded decision (minimum 20 ` +
          "characters). Write a real reason, or wire a test job for this workspace instead.",
      );
    }
  }
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
