#!/usr/bin/env node
// CLI entry point for the appId/package pairing guard (T207). Run from
// the repository root; CI runs it as the `guard-app-id-package-pairing`
// job in `.github/workflows/ci.yml`.
//
// CORRECTED (P8-W11 gate): this said "CI runs it via ..." on the commit
// that shipped it, when no workflow referenced this file at all — the
// check reached CI only through `guard-app-id-package-pairing.test.mjs`'s
// real-tree assertion inside the `changes` job's `node --test
// scripts/ci/*.test.mjs` step. The job named above closes that gap; T209
// adds the check that would have caught an unwired runner.
// See scripts/ci/guard-app-id-package-pairing.mjs for the checked rule
// and why it needs four real files, not three, to resolve correctly.

import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { collectAppIdPackagePairings } from "./guard-app-id-package-pairing.mjs";

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

  const pairings = collectAppIdPackagePairings({
    workflowContent,
    easJsonContent,
    appConfigContent,
    flowFiles,
    shardsJsonContent,
    runPlanContent,
  });
  const violations = pairings.filter((pairing) => !pairing.ok);

  // A guard that resolves nothing must not report success. Every early
  // `continue` in the collector — an unparseable `app.config.ts` ternary,
  // an unknown EAS profile, a job with no recognised flow — silently
  // removes pairings, and the previous message counted FILES READ, which
  // stays reassuringly at 15 while zero pairings are evaluated (P8-W11
  // gate finding F2).
  if (pairings.length === 0) {
    console.error("guard-app-id-package-pairing: FAILED");
    console.error(
      `  Resolved ZERO job x flow pairings from ${flowFiles.length} flow file(s). This guard ` +
        `checked nothing, so it cannot be passing. One of ${APP_CONFIG_PATH}'s package ` +
        `ternary, ${EAS_JSON_PATH}'s profiles, or ${WORKFLOW_PATH}'s jobs no longer has the ` +
        `shape this guard parses.`,
    );
    process.exitCode = 1;
    return;
  }

  if (violations.length === 0) {
    console.log(
      `guard-app-id-package-pairing: OK — every ${WORKFLOW_PATH} job's resolved EAS package ` +
        `matches the appId every flow it runs would launch (${pairings.length} job x flow ` +
        `pairing(s) evaluated across ${flowFiles.length} flow file(s)).`,
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
