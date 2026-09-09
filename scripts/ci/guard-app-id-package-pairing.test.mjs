import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import test from "node:test";

import {
  APP_ID_VARIABLE,
  extractDefaultAppId,
  extractFlowAppId,
  collectAppIdPackagePairings,
  extractJobNeeds,
  extractWorkflowJobs,
  findAppIdPackagePairingViolations,
  resolveInheritedProfiles,
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

// ---------------------------------------------------------------------------
// P8-W11 gate. Two defects this guard shipped with, both now covered.
// ---------------------------------------------------------------------------

test("P8-W11 F2: the real tree evaluates a non-zero number of job x flow pairings", () => {
  // The runner's success message used to count FILES READ, which stays at
  // 15 even when every pairing has been skipped by an early `continue`.
  // `collectAppIdPackagePairings` returns what was actually evaluated, so
  // the runner can refuse to report OK on an empty check.
  const pairings = collectAppIdPackagePairings(readRealInputs());

  assert.ok(pairings.length > 0, "expected the real tree to yield at least one pairing");
  assert.ok(pairings.every((pairing) => pairing.ok));
  // Every violation is a pairing that failed, so the two views agree.
  assert.equal(findAppIdPackagePairingViolations(readRealInputs()).length, 0);
});

test("P8-W11 F2: an equivalently-spelled package ternary yields ZERO pairings, which is why a zero count must not print OK", () => {
  // `resolvePackageIds` matches one exact spelling. Reshaping it to a
  // valid, semantically identical form makes it return null, every job's
  // profile resolve to null, and every pairing be skipped — the guard then
  // finds no violations while checking nothing. The runner treats an empty
  // result as a hard failure precisely because of this; without that, the
  // original T43B2b defect could be restored under this reshape and the
  // guard would still print a reassuring OK.
  const inputs = readRealInputs();
  const reshaped = inputs.appConfigContent.replace(
    'package: isDevelopmentClient ? "sh.picompanion.debug" : "sh.picompanion",',
    'package: isDevelopmentClient === true ? "sh.picompanion.debug" : "sh.picompanion",',
  );

  assert.notEqual(reshaped, inputs.appConfigContent, "the reshape must actually change the source");
  assert.equal(resolvePackageIds(reshaped), null);
  assert.deepEqual(collectAppIdPackagePairings({ ...inputs, appConfigContent: reshaped }), []);
});

test("P8-W11 F3: a quoted APP_ID override is read, not treated as absent", () => {
  // `APP_ID="sh.picompanion" npx tsx ...` is idiomatic shell and identical
  // in meaning to the unquoted form. The original pattern could not match a
  // quoted value, so the job fell back to the harness default and the guard
  // reported a violation against a correct workflow.
  const workflow = `
jobs:
  packaged-app-smoke:
    steps:
      - run: npx eas build --platform android --profile production-apk --non-interactive
      - run: |
          adb install -r "$apk"
          APP_ID="sh.picompanion" npx tsx apps/android/e2e/run-flow.ts smoke
`;
  const jobs = extractWorkflowJobs(workflow);

  assert.equal(jobs[0].appIdOverride, "sh.picompanion");
});

test("P8-W11 F3: a single-quoted APP_ID override is read too", () => {
  const workflow = `
jobs:
  packaged-app-smoke:
    steps:
      - run: npx eas build --platform android --profile production-apk --non-interactive
      - run: |
          APP_ID='sh.picompanion' npx tsx apps/android/e2e/run-flow.ts smoke
`;

  assert.equal(extractWorkflowJobs(workflow)[0].appIdOverride, "sh.picompanion");
});

test("P8-W11 F3: an unquoted APP_ID override still works — the quote handling is additive", () => {
  const workflow = `
jobs:
  packaged-app-smoke:
    steps:
      - run: npx eas build --platform android --profile production-apk --non-interactive
      - run: |
          APP_ID=sh.picompanion npx tsx apps/android/e2e/run-flow.ts smoke
`;

  assert.equal(extractWorkflowJobs(workflow)[0].appIdOverride, "sh.picompanion");
});

// ---------------------------------------------------------------------------
// T312: build-once/fan-out — the job that BUILDS the APK is no longer the
// job that RUNS the flows, so the profile has to be inherited through
// `needs:`. Without that, `collectAppIdPackagePairings`' `if (!job.profile)
// continue` skips every dev-APK pairing and the guard still prints OK.
// ---------------------------------------------------------------------------

test("T312: extractJobNeeds reads the inline, inline-sequence and block-sequence forms", () => {
  const inline = `
jobs:
  runner:
    needs: builder
    steps:
      - run: echo hi
`;
  const inlineSequence = `
jobs:
  runner:
    needs: [shard-matrix, builder]
    steps:
      - run: echo hi
`;
  const blockSequence = `
jobs:
  runner:
    needs:
      - shard-matrix
      - builder
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

  assert.deepEqual(extractWorkflowJobs(inline)[0].needs, ["builder"]);
  assert.deepEqual(extractWorkflowJobs(inlineSequence)[0].needs, ["shard-matrix", "builder"]);
  assert.deepEqual(extractWorkflowJobs(blockSequence)[0].needs, ["shard-matrix", "builder"]);

  // Directly too: `extractJobNeeds` takes ONE job's text block, and the
  // block-sequence form is the one that has to stop at the next key
  // rather than swallowing the rest of the job.
  assert.deepEqual(
    extractJobNeeds(`  runner:\n    needs:\n      - a\n      - b\n    runs-on: ubuntu-latest\n`),
    ["a", "b"],
  );
  assert.deepEqual(extractJobNeeds(`  runner:\n    needs: [a]\n`), ["a"]);
  assert.deepEqual(extractJobNeeds(`  runner:\n    runs-on: ubuntu-latest\n`), []);
  // A job declaring no `needs:` at all reads as an empty list, never null,
  // so the BFS in `resolveInheritedProfiles` never has to null-check.
  assert.deepEqual(
    extractWorkflowJobs(`\njobs:\n  solo:\n    steps:\n      - run: echo hi\n`)[0].needs,
    [],
  );
});

// A minimal fan-out workflow in the real shape: one job builds with an
// explicit `--profile`, another runs a flow and declares no profile of its
// own. Written as a literal rather than derived from the real workflow so
// the assertions below stay true when the real file is next edited.
const FAN_OUT_WORKFLOW = `
jobs:
  builder:
    steps:
      - run: npx eas-cli build --platform android --profile development --non-interactive
  runner:
    needs:
      - builder
    steps:
      - run: |
          adb install -r "$RUNNER_TEMP/picompanion-debug.apk"
          npx tsx apps/android/e2e/run-flow.ts smoke
`;

const FAN_OUT_INPUTS = {
  easJsonContent: JSON.stringify({
    build: {
      development: { android: { env: { APP_VARIANT: "development" } } },
      "production-apk": { android: {} },
    },
  }),
  appConfigContent: `
    const isDevelopmentClient = process.env["APP_VARIANT"] === "development";
    package: isDevelopmentClient ? "sh.picompanion.debug" : "sh.picompanion",
  `,
  shardsJsonContent: JSON.stringify({ flows: ["smoke"] }),
  runPlanContent: 'export const DEFAULT_APP_ID = "sh.picompanion.debug";',
};

test("T312: a job with no --profile inherits one through needs", () => {
  const jobs = resolveInheritedProfiles(extractWorkflowJobs(FAN_OUT_WORKFLOW));
  const runner = jobs.find((job) => job.name === "runner");

  assert.equal(runner.profile, "development");
  assert.equal(runner.profileSource, "inherited");
  assert.equal(jobs.find((job) => job.name === "builder").profileSource, "own");
});

test("T312: MUTATION PROOF — the inherited profile is really what pairs the flow, and it can FIRE", () => {
  // The runner installs the `development` APK (`sh.picompanion.debug`) but
  // its flow declares the release package literally. That is the original
  // T43B2b defect, arrived at through a fan-out job rather than a job with
  // its own `--profile`, and it must be reported.
  const violations = findAppIdPackagePairingViolations({
    ...FAN_OUT_INPUTS,
    workflowContent: FAN_OUT_WORKFLOW,
    flowFiles: [{ name: "smoke", content: "appId: sh.picompanion\n" }],
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].job, "runner");
  assert.equal(violations[0].profile, "development");
  assert.equal(violations[0].resolvedPackage, "sh.picompanion.debug");
  assert.equal(violations[0].launchedAppId, "sh.picompanion");
});

test("T312: removing the needs edge makes the runner unpairable — the fail-safe, stated so it is not mistaken for coverage", () => {
  // Deliberately documents the limit of the fail-safe rather than
  // asserting it is protection: a runner that depends on nothing has no
  // profile to inherit, so it is skipped and the same mismatched flow goes
  // unreported. This is why the real-tree per-flow assertion below exists
  // — the fail-safe alone would let a dropped `needs:` edge pass silently.
  const detached = FAN_OUT_WORKFLOW.replace("    needs:\n      - builder\n", "");
  assert.notEqual(detached, FAN_OUT_WORKFLOW, "the mutation must actually change the workflow");

  const jobs = resolveInheritedProfiles(extractWorkflowJobs(detached));
  assert.equal(jobs.find((job) => job.name === "runner").profile, null);
  assert.equal(jobs.find((job) => job.name === "runner").profileSource, "none");

  assert.deepEqual(
    findAppIdPackagePairingViolations({
      ...FAN_OUT_INPUTS,
      workflowContent: detached,
      flowFiles: [{ name: "smoke", content: "appId: sh.picompanion\n" }],
    }),
    [],
  );
});

test("T312: two different inherited profiles are ambiguous, and resolve to none rather than a guess", () => {
  const twoBuilders = `
jobs:
  dev-builder:
    steps:
      - run: npx eas-cli build --platform android --profile development --non-interactive
  release-builder:
    steps:
      - run: npx eas-cli build --platform android --profile production-apk --non-interactive
  runner:
    needs: [dev-builder, release-builder]
    steps:
      - run: npx tsx apps/android/e2e/run-flow.ts smoke
`;

  const runner = resolveInheritedProfiles(extractWorkflowJobs(twoBuilders)).find(
    (job) => job.name === "runner",
  );

  assert.equal(runner.profile, null);
  assert.equal(runner.profileSource, "ambiguous");
});

test("T312: a profile is inherited transitively, not only from a direct need", () => {
  const chained = `
jobs:
  builder:
    steps:
      - run: npx eas-cli build --platform android --profile development --non-interactive
  middle:
    needs: builder
    steps:
      - run: echo passthrough
  runner:
    needs: middle
    steps:
      - run: npx tsx apps/android/e2e/run-flow.ts smoke
`;

  const runner = resolveInheritedProfiles(extractWorkflowJobs(chained)).find(
    (job) => job.name === "runner",
  );

  assert.equal(runner.profile, "development");
  assert.equal(runner.profileSource, "inherited");
});

test("T312: a needs cycle terminates instead of hanging", () => {
  // Not a shape GitHub Actions would accept, but the BFS must not depend
  // on the input being a valid DAG — a guard that hangs is worse than one
  // that reports nothing.
  const cyclic = `
jobs:
  a:
    needs: b
    steps:
      - run: echo a
  b:
    needs: a
    steps:
      - run: echo b
`;

  const jobs = resolveInheritedProfiles(extractWorkflowJobs(cyclic));
  assert.equal(jobs.find((job) => job.name === "a").profile, null);
  assert.equal(jobs.find((job) => job.name === "b").profile, null);
});

test("T312: the real tree pairs EVERY shard flow against the maestro-e2e job", () => {
  // The anti-silent-skip assertion, and the reason this test exists at
  // all. `P8-W11 F2` above only requires the real tree to yield MORE THAN
  // ZERO pairings — and after the build/run split, `packaged-app-smoke`'s
  // single `smoke` pairing satisfies that on its own. So a future edit
  // that breaks profile inheritance (renaming the build job, dropping the
  // `needs:` edge, moving to a shape `extractJobNeeds` cannot read) would
  // silently reduce the guard from eleven pairings to one and still print
  // a reassuring OK. This pins the ten by name.
  const inputs = readRealInputs();
  const pairings = collectAppIdPackagePairings(inputs);
  const shardFlows = flattenShardFlowNames(inputs.shardsJsonContent);

  const maestroFlows = pairings
    .filter((pairing) => pairing.job === "maestro-e2e")
    .map((pairing) => pairing.flow)
    .sort();

  assert.ok(shardFlows.length > 0, "shards.json must list at least one flow");
  assert.deepEqual(maestroFlows, [...shardFlows].sort());
  assert.ok(
    pairings.some((pairing) => pairing.job === "packaged-app-smoke"),
    "packaged-app-smoke must still be paired too",
  );
});

test("T312: the real maestro-e2e job resolves its profile by inheritance, not by carrying its own", () => {
  // If someone re-adds an `eas build --profile` to the shard job, this
  // fails — not because that is forbidden, but because it would mean the
  // five-builds-per-run cost T312 removed has come back, and the person
  // re-adding it should say so deliberately rather than have the guard
  // quietly keep passing either way.
  const jobs = resolveInheritedProfiles(extractWorkflowJobs(readFileSync(WORKFLOW_PATH, "utf8")));
  const maestro = jobs.find((job) => job.name === "maestro-e2e");
  const builder = jobs.find((job) => job.name === "build-development-apk");

  assert.equal(maestro.profileSource, "inherited");
  assert.equal(maestro.profile, "development");
  assert.equal(builder.profileSource, "own");
  assert.equal(builder.profile, "development");
});
