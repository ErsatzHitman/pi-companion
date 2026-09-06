import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import test from "node:test";

import {
  APP_ID_VARIABLE,
  extractDefaultAppId,
  extractFlowAppId,
  extractWorkflowJobs,
  findAppIdPackagePairingViolations,
  flattenShardFlowNames,
  resolveEasProfileVariants,
  resolvePackageForProfile,
  resolvePackageIds,
} from "./guard-app-id-package-pairing.mjs";

const WORKFLOW_PATH = ".github/workflows/android-maestro-e2e.yml";
const EAS_JSON_PATH = "apps/android/eas.json";
const APP_CONFIG_PATH = "apps/android/app.config.ts";
const SHARDS_JSON_PATH = "apps/android/maestro/shards.json";
const RUN_PLAN_PATH = "apps/android/e2e/harness/run-plan.ts";
const MAESTRO_DIR = "apps/android/maestro/";

function readRealFlowFiles() {
  return readdirSync(MAESTRO_DIR)
    .filter((entry) => extname(entry) === ".yaml")
    .map((entry) => ({
      name: entry.slice(0, -".yaml".length),
      content: readFileSync(`${MAESTRO_DIR}${entry}`, "utf8"),
    }));
}

function readRealInputs() {
  return {
    workflowContent: readFileSync(WORKFLOW_PATH, "utf8"),
    easJsonContent: readFileSync(EAS_JSON_PATH, "utf8"),
    appConfigContent: readFileSync(APP_CONFIG_PATH, "utf8"),
    flowFiles: readRealFlowFiles(),
    shardsJsonContent: readFileSync(SHARDS_JSON_PATH, "utf8"),
    runPlanContent: readFileSync(RUN_PLAN_PATH, "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Unit tests on the individual parsers, against small fixtures.
// ---------------------------------------------------------------------------

test("resolvePackageIds parses the real app.config.ts shape", () => {
  const source = `
    const isDevelopmentClient = process.env["APP_VARIANT"] === "development";
    const config = {
      android: {
        package: isDevelopmentClient ? "sh.picompanion.debug" : "sh.picompanion",
      },
    };
  `;
  assert.deepEqual(resolvePackageIds(source), {
    developmentValue: "development",
    developmentPackage: "sh.picompanion.debug",
    releasePackage: "sh.picompanion",
  });
});

test("resolvePackageIds returns null when the expected shape is not found (fails safe)", () => {
  assert.equal(resolvePackageIds("export default { android: { package: 'x' } };"), null);
});

test("resolveEasProfileVariants reads each profile's APP_VARIANT, null when unset", () => {
  const source = JSON.stringify({
    build: {
      development: { android: { env: { APP_VARIANT: "development" } } },
      "production-apk": { android: { buildType: "apk" } },
    },
  });
  assert.deepEqual(resolveEasProfileVariants(source), {
    development: "development",
    "production-apk": null,
  });
});

test("resolvePackageForProfile resolves the development profile to the development package", () => {
  const packageIds = {
    developmentValue: "development",
    developmentPackage: "sh.picompanion.debug",
    releasePackage: "sh.picompanion",
  };
  assert.equal(
    resolvePackageForProfile("development", { development: "development" }, packageIds),
    "sh.picompanion.debug",
  );
});

test("resolvePackageForProfile resolves a profile with no APP_VARIANT to the release package", () => {
  const packageIds = {
    developmentValue: "development",
    developmentPackage: "sh.picompanion.debug",
    releasePackage: "sh.picompanion",
  };
  assert.equal(
    resolvePackageForProfile("production-apk", { "production-apk": null }, packageIds),
    "sh.picompanion",
  );
});

test("resolvePackageForProfile returns null for an unknown profile or unresolvable packageIds", () => {
  const packageIds = {
    developmentValue: "development",
    developmentPackage: "sh.picompanion.debug",
    releasePackage: "sh.picompanion",
  };
  assert.equal(resolvePackageForProfile("nonexistent", {}, packageIds), null);
  assert.equal(resolvePackageForProfile("development", { development: "development" }, null), null);
});

test("extractFlowAppId reads the parameterized form", () => {
  assert.equal(extractFlowAppId('appId: ${APP_ID}\nname: "x"\n'), APP_ID_VARIABLE);
});

test("extractFlowAppId reads a literal package (the pre-T207 shape)", () => {
  assert.equal(
    extractFlowAppId('appId: sh.picompanion.debug\nname: "x"\n'),
    "sh.picompanion.debug",
  );
});

test("flattenShardFlowNames reads the top-level flows list", () => {
  const source = JSON.stringify({ flows: ["pairing", "cold-start-restore"], shards: [] });
  assert.deepEqual(flattenShardFlowNames(source), ["pairing", "cold-start-restore"]);
});

test("extractDefaultAppId reads the exported constant", () => {
  assert.equal(
    extractDefaultAppId('export const DEFAULT_APP_ID = "sh.picompanion.debug";\n'),
    "sh.picompanion.debug",
  );
});

test("extractWorkflowJobs finds a job's profile, explicit flow, and APP_ID override", () => {
  const workflow = `
jobs:
  packaged-app-smoke:
    steps:
      - run: npx eas build --platform android --profile production-apk --non-interactive
      - run: |
          adb install -r "$apk"
          APP_ID=sh.picompanion npx tsx apps/android/e2e/run-flow.ts smoke
  maestro-e2e:
    steps:
      - run: npx eas build --platform android --profile development --non-interactive
      - run: |
          flows="$(node -e "require('./apps/android/maestro/shards.json')")"
          for flow in $flows; do
            npx tsx apps/android/e2e/run-flow.ts "$flow"
          done
  shard-matrix:
    steps:
      - run: echo hi
`;
  const jobs = extractWorkflowJobs(workflow);
  const byName = Object.fromEntries(jobs.map((job) => [job.name, job]));

  assert.equal(byName["packaged-app-smoke"].profile, "production-apk");
  assert.equal(byName["packaged-app-smoke"].appIdOverride, "sh.picompanion");
  assert.equal(byName["packaged-app-smoke"].explicitFlow, "smoke");
  assert.equal(byName["packaged-app-smoke"].runsAllShardFlows, false);

  assert.equal(byName["maestro-e2e"].profile, "development");
  assert.equal(byName["maestro-e2e"].appIdOverride, null);
  assert.equal(byName["maestro-e2e"].explicitFlow, null);
  assert.equal(byName["maestro-e2e"].runsAllShardFlows, true);

  assert.equal(byName["shard-matrix"].profile, null);
});

// ---------------------------------------------------------------------------
// findAppIdPackagePairingViolations — fixture-level pass/fail cases.
// ---------------------------------------------------------------------------

const FIXTURE_APP_CONFIG = `
  const isDevelopmentClient = process.env["APP_VARIANT"] === "development";
  const config = { android: { package: isDevelopmentClient ? "sh.picompanion.debug" : "sh.picompanion" } };
`;
const FIXTURE_EAS_JSON = JSON.stringify({
  build: {
    development: { android: { env: { APP_VARIANT: "development" } } },
    "production-apk": { android: { buildType: "apk" } },
  },
});
const FIXTURE_SHARDS_JSON = JSON.stringify({ flows: ["pairing"], shards: [] });
const FIXTURE_RUN_PLAN = 'export const DEFAULT_APP_ID = "sh.picompanion.debug";\n';

function fixtureWorkflow({ appIdOverride } = {}) {
  return `
jobs:
  packaged-app-smoke:
    steps:
      - run: npx eas build --platform android --profile production-apk
      - run: |
          adb install -r "$apk"
          ${appIdOverride ? `APP_ID=${appIdOverride} ` : ""}npx tsx apps/android/e2e/run-flow.ts smoke
  maestro-e2e:
    steps:
      - run: npx eas build --platform android --profile development
      - run: |
          flows="$(node -e "require('./apps/android/maestro/shards.json')")"
          for flow in $flows; do
            npx tsx apps/android/e2e/run-flow.ts "$flow"
          done
`;
}

test("findAppIdPackagePairingViolations: passes when every flow is parameterized and packaged-app-smoke overrides APP_ID", () => {
  const violations = findAppIdPackagePairingViolations({
    workflowContent: fixtureWorkflow({ appIdOverride: "sh.picompanion" }),
    easJsonContent: FIXTURE_EAS_JSON,
    appConfigContent: FIXTURE_APP_CONFIG,
    flowFiles: [
      { name: "smoke", content: "appId: ${APP_ID}\n" },
      { name: "pairing", content: "appId: ${APP_ID}\n" },
    ],
    shardsJsonContent: FIXTURE_SHARDS_JSON,
    runPlanContent: FIXTURE_RUN_PLAN,
  });
  assert.deepEqual(violations, []);
});

test("findAppIdPackagePairingViolations: FAILS when a flow's appId is a literal that does not match the job's resolved package (the original T43B2b defect, reproduced by reverting parameterization)", () => {
  const violations = findAppIdPackagePairingViolations({
    workflowContent: fixtureWorkflow({ appIdOverride: "sh.picompanion" }),
    easJsonContent: FIXTURE_EAS_JSON,
    appConfigContent: FIXTURE_APP_CONFIG,
    flowFiles: [
      // Reverted: smoke.yaml pinned back to the literal debug package.
      { name: "smoke", content: "appId: sh.picompanion.debug\n" },
      { name: "pairing", content: "appId: ${APP_ID}\n" },
    ],
    shardsJsonContent: FIXTURE_SHARDS_JSON,
    runPlanContent: FIXTURE_RUN_PLAN,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].job, "packaged-app-smoke");
  assert.equal(violations[0].flow, "smoke");
  assert.equal(violations[0].resolvedPackage, "sh.picompanion");
  assert.equal(violations[0].launchedAppId, "sh.picompanion.debug");
});

test("findAppIdPackagePairingViolations: FAILS when packaged-app-smoke's APP_ID override is removed, falling back to the development default", () => {
  const violations = findAppIdPackagePairingViolations({
    // No appIdOverride this time — reproduces the defect through the
    // OTHER edit T207's own header comment calls out.
    workflowContent: fixtureWorkflow({}),
    easJsonContent: FIXTURE_EAS_JSON,
    appConfigContent: FIXTURE_APP_CONFIG,
    flowFiles: [
      { name: "smoke", content: "appId: ${APP_ID}\n" },
      { name: "pairing", content: "appId: ${APP_ID}\n" },
    ],
    shardsJsonContent: FIXTURE_SHARDS_JSON,
    runPlanContent: FIXTURE_RUN_PLAN,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].job, "packaged-app-smoke");
  assert.equal(violations[0].launchedAppId, "sh.picompanion.debug");
  assert.equal(violations[0].resolvedPackage, "sh.picompanion");
});

test("findAppIdPackagePairingViolations: negative control — a literal appId that already happens to equal the job's resolved package is not flagged", () => {
  const violations = findAppIdPackagePairingViolations({
    workflowContent: fixtureWorkflow({ appIdOverride: "sh.picompanion" }),
    easJsonContent: FIXTURE_EAS_JSON,
    appConfigContent: FIXTURE_APP_CONFIG,
    flowFiles: [
      { name: "smoke", content: "appId: ${APP_ID}\n" },
      // maestro-e2e resolves to sh.picompanion.debug — a literal that
      // happens to already match must not be flagged as if it were the
      // defect shape.
      { name: "pairing", content: "appId: sh.picompanion.debug\n" },
    ],
    shardsJsonContent: FIXTURE_SHARDS_JSON,
    runPlanContent: FIXTURE_RUN_PLAN,
  });
  assert.deepEqual(violations, []);
});

test("findAppIdPackagePairingViolations: a job with no --profile (e.g. shard-matrix) is never checked", () => {
  const workflow = `
jobs:
  shard-matrix:
    steps:
      - run: node -e "console.log(1)"
`;
  const violations = findAppIdPackagePairingViolations({
    workflowContent: workflow,
    easJsonContent: FIXTURE_EAS_JSON,
    appConfigContent: FIXTURE_APP_CONFIG,
    flowFiles: [{ name: "smoke", content: "appId: sh.picompanion.debug\n" }],
    shardsJsonContent: FIXTURE_SHARDS_JSON,
    runPlanContent: FIXTURE_RUN_PLAN,
  });
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// Real-tree proof: the actual committed files today produce zero
// violations (the state T207 leaves the tree in), and reverting T207's
// parameterization on the REAL smoke.yaml content — the exact mutation
// this task's acceptance criteria require — turns the real tree red.
// ---------------------------------------------------------------------------

test("the real tree today: every workflow job's resolved package matches what its flows launch", () => {
  const violations = findAppIdPackagePairingViolations(readRealInputs());
  assert.deepEqual(violations, []);
});

test("MUTATION PROOF: reverting the real smoke.yaml's appId to the pre-T207 literal turns the real tree red", () => {
  const inputs = readRealInputs();
  const mutatedFlowFiles = inputs.flowFiles.map((file) =>
    file.name === "smoke"
      ? { ...file, content: file.content.replace(APP_ID_VARIABLE, "sh.picompanion.debug") }
      : file,
  );
  // Confirm the mutation actually changed something, so this proof cannot
  // silently pass by mutating nothing.
  const smokeBefore = inputs.flowFiles.find((file) => file.name === "smoke").content;
  const smokeAfter = mutatedFlowFiles.find((file) => file.name === "smoke").content;
  assert.notEqual(smokeBefore, smokeAfter);

  const violations = findAppIdPackagePairingViolations({ ...inputs, flowFiles: mutatedFlowFiles });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].job, "packaged-app-smoke");
  assert.equal(violations[0].flow, "smoke");
  assert.equal(violations[0].resolvedPackage, "sh.picompanion");
  assert.equal(violations[0].launchedAppId, "sh.picompanion.debug");
});

test("MUTATION PROOF: removing the real workflow's APP_ID=sh.picompanion override turns the real tree red", () => {
  const inputs = readRealInputs();
  const mutatedWorkflow = inputs.workflowContent.replace("APP_ID=sh.picompanion ", "");
  assert.notEqual(mutatedWorkflow, inputs.workflowContent);

  const violations = findAppIdPackagePairingViolations({
    ...inputs,
    workflowContent: mutatedWorkflow,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].job, "packaged-app-smoke");
  assert.equal(violations[0].launchedAppId, "sh.picompanion.debug");
  assert.equal(violations[0].resolvedPackage, "sh.picompanion");
});
