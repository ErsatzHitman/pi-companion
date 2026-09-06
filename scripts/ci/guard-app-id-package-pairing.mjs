// T207: CI guard — ties each `.github/workflows/android-maestro-e2e.yml`
// job's EAS build profile to the Android package it actually installs
// (`apps/android/eas.json` + `apps/android/app.config.ts`), and fails when
// that job then runs a Maestro flow whose resolved `appId` names a
// DIFFERENT package — one it never installed and therefore can never
// launch.
//
// This is the defect T43B2b shipped and nothing caught: `packaged-app-
// smoke` built EAS profile `production-apk` (no `APP_VARIANT`, so
// `app.config.ts` resolves the package to the release id `sh.picompanion`)
// and then ran `smoke.yaml`, whose first line was the literal `appId:
// sh.picompanion.debug` — a package that job never installs. `node --test`
// and `apps/android`'s `vitest run e2e` both stayed green throughout,
// because every `sh.picompanion.debug` in test code was a fixture the
// test wrote itself, never the real flow file — see this guard's own test
// file for the measured proof.
//
// ## What this reads, and why it has to be four files, not three
//
// `apps/android/maestro/*.yaml` (each flow's declared `appId`),
// `apps/android/eas.json` (which EAS profile sets `APP_VARIANT` to what),
// and `apps/android/app.config.ts` (what package each `APP_VARIANT`
// resolves to) are the three files this task's own brief names. They are
// not enough on their own: after T207 parameterizes every flow's `appId`
// to the variable `${APP_ID}`, resolving what a flow actually launches
// requires knowing what value a WORKFLOW JOB supplies for `APP_ID` — an
// explicit override (`packaged-app-smoke` sets `APP_ID=sh.picompanion`
// before invoking `run-flow.ts`) or, when a job supplies none (`maestro-e2e`
// never does), the harness's own default. That default lives in
// `apps/android/e2e/harness/run-plan.ts`'s `DEFAULT_APP_ID` export, so
// this guard reads that file too — the alternative, hardcoding the
// default a second time here, is exactly the kind of duplicated-fact
// drift this repository's guards are written to avoid (see
// `production-daemon-port.ts`'s own header for the same reasoning applied
// to the port `6767`).
//
// ## What counts as "this job resolves to this package"
//
// `resolvePackageIds` parses `app.config.ts`'s
// `isDevelopmentClient = process.env["APP_VARIANT"] === "development"`
// and `package: isDevelopmentClient ? "sh.picompanion.debug" :
// "sh.picompanion"` — the two literal strings, not a hardcoded pair, so a
// real rename of either package id is picked up rather than silently
// compared against a stale copy. `resolveEasProfileVariants` reads every
// profile's `android.env.APP_VARIANT` out of the real `eas.json` (`null`
// when a profile sets none, e.g. `production-apk` today). A profile whose
// `APP_VARIANT` equals `app.config.ts`'s own development-flag string
// resolves to the development package; anything else (including no
// `APP_VARIANT` at all) resolves to the release package — the exact
// ternary `app.config.ts` itself evaluates at build time.
//
// ## What counts as "this job runs this flow, launching this appId"
//
// `extractWorkflowJobs` splits the workflow into per-job text blocks (top-
// level `  <job-name>:` keys under `jobs:`) and, per job, looks for:
//   - `--profile <name>` in an `eas build` command — the profile this job
//     builds. A job with none (`shard-matrix`) is skipped entirely: it
//     builds nothing, so there is no package to pair a flow against.
//   - An explicit `APP_ID=<value>` (shell-assignment form, what
//     `packaged-app-smoke` uses) or `APP_ID: <value>` (a hypothetical
//     `env:` block form) — the override this job supplies, if any.
//   - Which flow(s) it runs: a literal `run-flow.ts <name>` names one flow
//     directly (`packaged-app-smoke`'s `smoke`); a job whose script
//     mentions `shards.json` and never names a flow literally (`maestro-
//     e2e`, which loops over a shell variable) is understood to run every
//     flow the real `apps/android/maestro/shards.json` lists. A job this
//     guard cannot place in either shape is skipped rather than guessed at
//     — see "What this deliberately does not catch" below.
//
// A flow's declared `appId` (`extractFlowAppId`) is either a literal
// package string (the pre-T207, buggy shape) or the parameterized
// `${APP_ID}` (T207's fix). A literal is compared to the job's resolved
// package directly — this is what makes reverting T207's parameterization
// on any one flow file provably red again (see this guard's own test
// file's mutation proof). `${APP_ID}` is resolved through the job's own
// override, falling back to `run-plan.ts`'s `DEFAULT_APP_ID` — this is
// what makes REMOVING `packaged-app-smoke`'s `APP_ID=sh.picompanion`
// override provably red too: the flow would then fall back to the
// development default, which the production-apk-installed package can't
// launch, reproducing the original T43B2b defect through a different edit.
//
// ## What this deliberately does NOT catch
//
// - A job whose profile or flow selection this guard cannot recognize
//   (some future shape this text-based extraction was not written for) is
//   skipped, not flagged — this guard reports a mismatch it can prove, not
//   every job it cannot fully parse. Narrow beats a generic YAML/shell
//   interpreter here, the same call `guard-docker-packaging-paths.mjs`
//   makes for Dockerfile `RUN` chains.
// - `app.config.ts`'s ternary must be spelled with the exact
//   `isDevelopmentClient ? "..." : "..."` shape this file already uses;
//   a rewritten conditional in some structurally different form would
//   make `resolvePackageIds` return `null`, and every job is then skipped
//   (fails safe: no false accusation, but also no protection) rather than
//   guessed at.
//
// Pure, dependency-free check functions only. `run-guard-app-id-package-
// pairing.mjs` is this module's CLI entry point, wired into CI as the
// `guard-app-id-package-pairing` job (P8-W11 gate — for the wave in which
// this guard shipped, that job did not exist and only this file's own test
// ran the check in CI); the module stays
// import-safe so `guard-app-id-package-pairing.test.mjs` can seed fixtures
// without touching the real working tree.

/**
 * The variable form every flow's `appId:` line is parameterized to
 * (T207). Exported so the guard's own test file and
 * `run-guard-app-id-package-pairing.mjs` share one literal rather than
 * two copies of the same magic string.
 */
export const APP_ID_VARIABLE = "${APP_ID}";

/**
 * @param {string} appConfigContent raw `apps/android/app.config.ts` source
 * @returns {{ developmentValue: string, developmentPackage: string, releasePackage: string } | null}
 *   `null` when the expected shapes are not found (fails safe — callers
 *   must skip rather than guess when this returns `null`).
 */
export function resolvePackageIds(appConfigContent) {
  const devFlagMatch = appConfigContent.match(
    /isDevelopmentClient\s*=\s*process\.env\[["']APP_VARIANT["']\]\s*===\s*["']([^"']+)["']/,
  );
  const packageMatch = appConfigContent.match(
    /package:\s*isDevelopmentClient\s*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/,
  );
  if (!devFlagMatch || !packageMatch) return null;
  return {
    developmentValue: devFlagMatch[1],
    developmentPackage: packageMatch[1],
    releasePackage: packageMatch[2],
  };
}

/**
 * @param {string} easJsonContent raw `apps/android/eas.json` source
 * @returns {Record<string, string | null>} profile name -> its
 *   `android.env.APP_VARIANT` value, or `null` when the profile sets none
 */
export function resolveEasProfileVariants(easJsonContent) {
  const parsed = JSON.parse(easJsonContent);
  /** @type {Record<string, string | null>} */
  const result = {};
  for (const [name, profile] of Object.entries(parsed?.build ?? {})) {
    result[name] = profile?.android?.env?.APP_VARIANT ?? null;
  }
  return result;
}

/**
 * @param {string} profileName
 * @param {Record<string, string | null>} easProfileVariants
 * @param {{ developmentValue: string, developmentPackage: string, releasePackage: string } | null} packageIds
 * @returns {string | null} the package this profile resolves to, or
 *   `null` when it cannot be determined (unknown profile, or
 *   `resolvePackageIds` itself failed)
 */
export function resolvePackageForProfile(profileName, easProfileVariants, packageIds) {
  if (!packageIds) return null;
  if (!Object.hasOwn(easProfileVariants, profileName)) return null;
  const variant = easProfileVariants[profileName];
  return variant === packageIds.developmentValue
    ? packageIds.developmentPackage
    : packageIds.releasePackage;
}

/**
 * @param {string} yamlContent one `apps/android/maestro/*.yaml` flow file
 * @returns {string | null} the flow's declared `appId` value — either a
 *   literal package or the parameterized `${APP_ID}` — or `null` if the
 *   file has no `appId:` line at all
 */
export function extractFlowAppId(yamlContent) {
  const match = yamlContent.match(/^appId:\s*(.+?)\s*$/m);
  return match ? match[1] : null;
}

/**
 * @param {string} shardsJsonContent raw `apps/android/maestro/shards.json`
 * @returns {string[]} every flow name the shard config lists
 */
export function flattenShardFlowNames(shardsJsonContent) {
  const parsed = JSON.parse(shardsJsonContent);
  return Array.isArray(parsed?.flows) ? parsed.flows : [];
}

/**
 * @param {string} runPlanContent raw `apps/android/e2e/harness/run-plan.ts`
 * @returns {string | null} the value `DEFAULT_APP_ID` is declared as
 */
export function extractDefaultAppId(runPlanContent) {
  const match = runPlanContent.match(/DEFAULT_APP_ID\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * Blanks everything from a `#` to the end of its line. Applied before
 * every regex extraction below so a comment merely QUOTING a shape (e.g.
 * this guard's own workflow-header prose saying "`APP_ID=sh.picompanion`
 * below resolves it...", in backticks, right beside the real assignment
 * it is describing) can never be mistaken for the real config or command
 * it explains. Line-based and not comment-aware of quoting inside YAML
 * string scalars — none of the four patterns below ever needs to match
 * text that legitimately contains a `#`, so the simple form is enough
 * here (unlike `guard-no-legacy-schema-reader.mjs`'s JS-comment stripper,
 * which has to handle block comments and string literals too).
 */
function stripHashComments(content) {
  return content
    .split("\n")
    .map((line) => {
      const hashIndex = line.indexOf("#");
      return hashIndex === -1 ? line : line.slice(0, hashIndex);
    })
    .join("\n");
}

const JOB_HEADER_PATTERN = /^ {2}([a-zA-Z0-9_-]+):\s*$/gm;
const PROFILE_PATTERN = /--profile\s+([^\s"']+)/;
const APP_ID_SHELL_PATTERN = /\bAPP_ID=["']?([^\s"']+)["']?/;
const APP_ID_ENV_BLOCK_PATTERN = /\bAPP_ID:\s*["']?([^\s"'\n]+)["']?/;
const EXPLICIT_FLOW_PATTERN = /run-flow\.ts\s+["']?([a-zA-Z][a-zA-Z0-9-]*)["']?/;
const SHARDS_JSON_MENTION_PATTERN = /shards\.json/;

/**
 * @typedef {{
 *   name: string,
 *   profile: string | null,
 *   appIdOverride: string | null,
 *   explicitFlow: string | null,
 *   runsAllShardFlows: boolean,
 * }} WorkflowJob
 */

/**
 * @param {string} workflowContent raw
 *   `.github/workflows/android-maestro-e2e.yml` source
 * @returns {WorkflowJob[]} one entry per top-level job under `jobs:`
 */
export function extractWorkflowJobs(workflowContent) {
  const jobsIndex = workflowContent.indexOf("\njobs:");
  const jobsSection = jobsIndex === -1 ? workflowContent : workflowContent.slice(jobsIndex);

  const headers = [...jobsSection.matchAll(JOB_HEADER_PATTERN)];
  return headers.map((header, index) => {
    const start = header.index;
    const end = index + 1 < headers.length ? headers[index + 1].index : jobsSection.length;
    const content = stripHashComments(jobsSection.slice(start, end));

    const profileMatch = content.match(PROFILE_PATTERN);
    const appIdShellMatch = content.match(APP_ID_SHELL_PATTERN);
    const appIdEnvMatch = content.match(APP_ID_ENV_BLOCK_PATTERN);
    const explicitFlowMatch = content.match(EXPLICIT_FLOW_PATTERN);
    const runsAllShardFlows = SHARDS_JSON_MENTION_PATTERN.test(content) && !explicitFlowMatch;

    return {
      name: header[1],
      profile: profileMatch ? profileMatch[1] : null,
      appIdOverride: appIdShellMatch ? appIdShellMatch[1] : appIdEnvMatch ? appIdEnvMatch[1] : null,
      explicitFlow: !runsAllShardFlows && explicitFlowMatch ? explicitFlowMatch[1] : null,
      runsAllShardFlows,
    };
  });
}

/**
 * @typedef {{ job: string, flow: string, profile: string, resolvedPackage: string, launchedAppId: string }} PairingViolation
 */

/**
 * @param {{
 *   workflowContent: string,
 *   easJsonContent: string,
 *   appConfigContent: string,
 *   flowFiles: { name: string, content: string }[],
 *   shardsJsonContent: string,
 *   runPlanContent: string,
 * }} inputs
 * @returns {PairingViolation[]}
 */
export function collectAppIdPackagePairings({
  workflowContent,
  easJsonContent,
  appConfigContent,
  flowFiles,
  shardsJsonContent,
  runPlanContent,
}) {
  const packageIds = resolvePackageIds(appConfigContent);
  const easProfileVariants = resolveEasProfileVariants(easJsonContent);
  const flowAppIds = new Map(flowFiles.map((file) => [file.name, extractFlowAppId(file.content)]));
  const shardFlowNames = flattenShardFlowNames(shardsJsonContent);
  const defaultAppId = extractDefaultAppId(runPlanContent);

  const pairings = [];

  for (const job of extractWorkflowJobs(workflowContent)) {
    if (!job.profile) continue;
    const resolvedPackage = resolvePackageForProfile(job.profile, easProfileVariants, packageIds);
    if (!resolvedPackage) continue;

    let flowNames;
    if (job.runsAllShardFlows) {
      flowNames = shardFlowNames;
    } else if (job.explicitFlow) {
      flowNames = [job.explicitFlow];
    } else {
      continue;
    }

    const effectiveAppId = job.appIdOverride ?? defaultAppId;

    for (const flowName of flowNames) {
      const declaredAppId = flowAppIds.get(flowName);
      if (declaredAppId === undefined || declaredAppId === null) continue;

      const launchedAppId = declaredAppId === APP_ID_VARIABLE ? effectiveAppId : declaredAppId;
      pairings.push({
        job: job.name,
        flow: flowName,
        profile: job.profile,
        resolvedPackage,
        launchedAppId: launchedAppId ?? "(unresolvable)",
        ok: Boolean(launchedAppId) && launchedAppId === resolvedPackage,
      });
    }
  }

  return pairings;
}

/**
 * The violations half of `collectAppIdPackagePairings`, unchanged in shape
 * from before the P8-W11 gate split the two apart.
 *
 * @param {Parameters<typeof collectAppIdPackagePairings>[0]} inputs
 * @returns {{ job: string, flow: string, profile: string, resolvedPackage: string, launchedAppId: string }[]}
 */
export function findAppIdPackagePairingViolations(inputs) {
  return collectAppIdPackagePairings(inputs)
    .filter((pairing) => !pairing.ok)
    .map(({ ok: _ok, ...violation }) => violation);
}
