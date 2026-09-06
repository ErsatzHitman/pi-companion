#!/usr/bin/env node
// CLI entry point for the appId/package pairing guard (T207). Run from
// the repository root (CI runs it via
// `node scripts/ci/run-guard-app-id-package-pairing.mjs`).
// See scripts/ci/guard-app-id-package-pairing.mjs for the checked rule
// and why it needs four real files, not three, to resolve correctly.

import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { findAppIdPackagePairingViolations } from "./guard-app-id-package-pairing.mjs";

const WORKFLOW_PATH = ".github/workflows/android-maestro-e2e.yml";
const EAS_JSON_PATH = "apps/android/eas.json";
const APP_CONFIG_PATH = "apps/android/app.config.ts";
const SHARDS_JSON_PATH = "apps/android/maestro/shards.json";
const RUN_PLAN_PATH = "apps/android/e2e/harness/run-plan.ts";
const MAESTRO_DIR = "apps/android/maestro/";

function readFlowFiles() {
  // No `git ls-files` dependency here (unlike the other guards in this
  // directory) — the flow set is small, fixed, and every guard that reads
  // it elsewhere (`flow-registry.ts`) already just reads the real
  // directory, so this does the same rather than adding a second listing
  // mechanism.
  return readdirSync(MAESTRO_DIR)
    .filter((entry) => extname(entry) === ".yaml")
    .map((entry) => ({
      name: entry.slice(0, -".yaml".length),
      content: readFileSync(`${MAESTRO_DIR}${entry}`, "utf8"),
    }));
}

export function main() {
  const workflowContent = readFileSync(WORKFLOW_PATH, "utf8");
  const easJsonContent = readFileSync(EAS_JSON_PATH, "utf8");
  const appConfigContent = readFileSync(APP_CONFIG_PATH, "utf8");
  const shardsJsonContent = readFileSync(SHARDS_JSON_PATH, "utf8");
  const runPlanContent = readFileSync(RUN_PLAN_PATH, "utf8");
  const flowFiles = readFlowFiles();

  const violations = findAppIdPackagePairingViolations({
    workflowContent,
    easJsonContent,
    appConfigContent,
    flowFiles,
    shardsJsonContent,
    runPlanContent,
  });

  if (violations.length === 0) {
    console.log(
      `guard-app-id-package-pairing: OK — every ${WORKFLOW_PATH} job's resolved EAS package ` +
        `matches the appId every flow it runs would launch (${flowFiles.length} flow file(s) checked).`,
    );
    return;
  }

  console.error("guard-app-id-package-pairing: FAILED");
  for (const violation of violations) {
    console.error(
      `  job "${violation.job}" builds EAS profile "${violation.profile}", which installs ` +
        `"${violation.resolvedPackage}", but runs flow "${violation.flow}", which would launch ` +
        `"${violation.launchedAppId}" — that package is never installed by this job.`,
    );
  }
  console.error(
    "  Either parameterize the flow's appId (apps/android/maestro/<flow>.yaml's first line " +
      "should read `appId: ${APP_ID}`) and have this job pass the matching -e APP_ID=<value> " +
      "override, or point the job at a flow that can actually launch on the package it installs.",
  );
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
