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
//   - What decides the package this job builds — its BUILD TARGET, which
//     is one of two things (T315): `--profile <name>` in an `eas build`
//     command (`packaged-app-smoke`), or an `APP_VARIANT` the job exports
//     directly (`build-development-apk`, which assembles with Gradle on
//     the runner and never calls EAS). The second is the more direct of
//     the two — `app.config.ts` reads `APP_VARIANT`, and an EAS profile
//     matters here only because `eas.json` sets that same variable for it.
//     A job with neither of its own inherits one through `needs:` when
//     exactly one distinct target is reachable that way (T312's
//     build-once/fan-out shape: one job builds, the five `maestro-e2e`
//     shards install what it produced). A job with neither — `shard-matrix`,
//     which builds nothing and depends on nothing — is skipped entirely:
//     there is no package to pair a flow against. See
//     `resolveInheritedBuildTargets` for why ambiguity resolves to "skip"
//     rather than to a guess.
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
const NEEDS_PATTERN = /^ {4}needs:[ \t]*(.*)$/m;
const NEEDS_SEQUENCE_ITEM_PATTERN = /^ {6}-\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/;
const APP_ID_SHELL_PATTERN = /\bAPP_ID=["']?([^\s"']+)["']?/;
const APP_ID_ENV_BLOCK_PATTERN = /\bAPP_ID:\s*["']?([^\s"'\n]+)["']?/;
const APP_VARIANT_SHELL_PATTERN = /\bAPP_VARIANT=["']?([^\s"']+)["']?/;
const APP_VARIANT_ENV_BLOCK_PATTERN = /\bAPP_VARIANT:\s*["']?([^\s"'\n]+)["']?/;
const EXPLICIT_FLOW_PATTERN = /run-flow\.ts\s+["']?([a-zA-Z][a-zA-Z0-9-]*)["']?/;
// A job runs the WHOLE shard set when it either reads `shards.json`
// directly or invokes the shard runner that reads it. Both spellings are
// recognised, and that is deliberate rather than redundant: T320 moved the
// shard loop out of the workflow and into `run-shard.ts` (the emulator
// action executes each `script:` line as its own `sh -c`, so a `for` loop in
// YAML cannot work), and matching only `shards.json` collapsed this guard
// from 11 pairings to 1 while still printing OK — the third time a
// WORKFLOW edit, not a guard edit, reached the "check that cannot fail"
// shape here, after T312 and T315. T312's own
// "the real tree pairs EVERY shard flow" test is what caught it.
const SHARDS_JSON_MENTION_PATTERN = /shards\.json|run-shard\.ts/;

/**
 * @typedef {{
 *   name: string,
 *   profile: string | null,
 *   appVariant: string | null,
 *   needs: string[],
 *   appIdOverride: string | null,
 *   explicitFlow: string | null,
 *   runsAllShardFlows: boolean,
 * }} WorkflowJob
 */

/**
 * @typedef {{ kind: "profile" | "variant", value: string }} BuildTarget
 */

/**
 * T315: an EAS profile is not the only way a job decides which package it
 * builds, and after the E2E build moved off EAS onto a runner-local Gradle
 * assemble it stopped being the way THIS repository's `maestro-e2e` path
 * decides at all.
 *
 * `apps/android/app.config.ts` reads `process.env["APP_VARIANT"]`. An EAS
 * profile only matters here because `eas.json` sets that variable for it —
 * the profile is an indirection, never the source of truth. A job that
 * exports `APP_VARIANT` directly (what the Gradle build does) picks the
 * package by the same expression, one step more directly, so this guard
 * reads both and treats them as the same kind of fact.
 *
 * Recording it as a tagged target rather than a bare string matters for
 * inheritance: `"development"` as a profile name and `"development"` as an
 * `APP_VARIANT` value happen to coincide today, and collapsing them into
 * one string would make two jobs that decide the package by different
 * mechanisms look identical — so a genuinely ambiguous fan-in would read as
 * unambiguous.
 *
 * @param {WorkflowJob} job
 * @returns {BuildTarget | null}
 */
export function jobBuildTarget(job) {
  if (job.profile) return { kind: "profile", value: job.profile };
  if (job.appVariant) return { kind: "variant", value: job.appVariant };
  return null;
}

/**
 * @param {BuildTarget | null} target
 * @param {Record<string, string | null>} easProfileVariants
 * @param {{ developmentValue: string, developmentPackage: string, releasePackage: string } | null} packageIds
 * @returns {string | null} the package this target resolves to, or `null`
 *   when it cannot be determined (fails safe — callers must skip)
 */
export function resolveTargetPackage(target, easProfileVariants, packageIds) {
  if (!target || !packageIds) return null;
  if (target.kind === "profile") {
    return resolvePackageForProfile(target.value, easProfileVariants, packageIds);
  }
  return target.value === packageIds.developmentValue
    ? packageIds.developmentPackage
    : packageIds.releasePackage;
}

/**
 * How a target reads in a failure message. Both phrasings are kept even
 * though no job in this repository builds an EAS profile any more
 * (CORRECTED at T330: this said `packaged-app-smoke` "still builds an EAS
 * profile"; it assembles with Gradle under `APP_VARIANT: production`
 * since T330) -- `android-apk-release.yml` still builds one, and a future
 * job here may again.
 *
 * @param {BuildTarget | null} target
 * @returns {string}
 */
export function describeBuildTarget(target) {
  if (!target) return "(no build target)";
  return target.kind === "profile"
    ? `EAS profile "${target.value}"`
    : `APP_VARIANT "${target.value}"`;
}

/**
 * T312: the job that BUILDS an APK and the job that INSTALLS it need not
 * be the same job. When `maestro-e2e`'s five shards each ran their own
 * `eas build`, every shard carried its own `--profile` and this guard
 * could read it directly. Collapsing those five identical builds into one
 * shared `build-development-apk` job (five EAS builds of one commit down
 * to one) moves the `--profile` out of the job that runs the flows — and
 * `collectAppIdPackagePairings`' `if (!job.profile) continue` would then
 * skip every one of the ten dev-APK pairings without saying so, leaving
 * only `packaged-app-smoke`'s single pairing behind. That is this
 * repository's recurring "check that cannot fail" shape, arrived at by
 * a workflow edit rather than by a guard edit, so the guard has to model
 * the fan-out rather than be blind to it.
 *
 * A job with no `--profile` of its own inherits one through `needs`,
 * transitively. Exactly one distinct profile among everything it depends
 * on is an inheritance; zero (`shard-matrix`, which builds nothing) or
 * two or more (a job consuming two different APKs, which this workflow
 * does not do today) leaves the profile `null` so the caller skips the
 * job — fails safe, the same call `resolvePackageIds` makes when
 * `app.config.ts`'s ternary is spelled some way this file does not
 * recognize.
 *
 * @param {string} jobContent one job's comment-stripped text block
 * @returns {string[]} the job names this job declares in `needs:`, in
 *   inline (`needs: a`), inline-sequence (`needs: [a, b]`) or block-
 *   sequence form; `[]` when it declares none or uses a shape this does
 *   not recognize
 */
export function extractJobNeeds(jobContent) {
  const match = jobContent.match(NEEDS_PATTERN);
  if (!match) return [];

  const inline = match[1].trim();
  if (inline) {
    return inline
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  const names = [];
  for (const line of jobContent
    .slice(match.index + match[0].length)
    .split("\n")
    .slice(1)) {
    const item = line.match(NEEDS_SEQUENCE_ITEM_PATTERN);
    if (item) {
      names.push(item[1]);
      continue;
    }
    if (line.trim() === "") continue;
    break;
  }
  return names;
}

/**
 * Fills in each job's inherited profile per `extractJobNeeds`' contract.
 *
 * @param {WorkflowJob[]} jobs
 * @returns {(WorkflowJob & { profileSource: "own" | "inherited" | "none" | "ambiguous" })[]}
 */
export function resolveInheritedBuildTargets(jobs) {
  const byName = new Map(jobs.map((job) => [job.name, job]));

  return jobs.map((job) => {
    const own = jobBuildTarget(job);
    if (own) return { ...job, buildTarget: own, targetSource: "own" };

    const seen = new Set();
    const queue = [...job.needs];
    /** @type {Map<string, BuildTarget>} */
    const found = new Map();
    while (queue.length > 0) {
      const name = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const dependency = byName.get(name);
      if (!dependency) continue;
      const target = jobBuildTarget(dependency);
      if (target) {
        found.set(`${target.kind}:${target.value}`, target);
        continue;
      }
      queue.push(...dependency.needs);
    }

    if (found.size !== 1) {
      return {
        ...job,
        buildTarget: null,
        targetSource: found.size === 0 ? "none" : "ambiguous",
      };
    }
    return { ...job, buildTarget: [...found.values()][0], targetSource: "inherited" };
  });
}

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
    const appVariantShellMatch = content.match(APP_VARIANT_SHELL_PATTERN);
    const appVariantEnvMatch = content.match(APP_VARIANT_ENV_BLOCK_PATTERN);
    const explicitFlowMatch = content.match(EXPLICIT_FLOW_PATTERN);
    const runsAllShardFlows = SHARDS_JSON_MENTION_PATTERN.test(content) && !explicitFlowMatch;

    return {
      name: header[1],
      profile: profileMatch ? profileMatch[1] : null,
      appVariant: appVariantShellMatch
        ? appVariantShellMatch[1]
        : appVariantEnvMatch
          ? appVariantEnvMatch[1]
          : null,
      needs: extractJobNeeds(content),
      appIdOverride: appIdShellMatch ? appIdShellMatch[1] : appIdEnvMatch ? appIdEnvMatch[1] : null,
      explicitFlow: !runsAllShardFlows && explicitFlowMatch ? explicitFlowMatch[1] : null,
      runsAllShardFlows,
    };
  });
}

/**
 * @typedef {{ job: string, flow: string, target: string, resolvedPackage: string, launchedAppId: string }} PairingViolation
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

  for (const job of resolveInheritedBuildTargets(extractWorkflowJobs(workflowContent))) {
    if (!job.buildTarget) continue;
    const resolvedPackage = resolveTargetPackage(job.buildTarget, easProfileVariants, packageIds);
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
        target: describeBuildTarget(job.buildTarget),
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
 * @returns {{ job: string, flow: string, target: string, resolvedPackage: string, launchedAppId: string }[]}
 */
export function findAppIdPackagePairingViolations(inputs) {
  return collectAppIdPackagePairings(inputs)
    .filter((pairing) => !pairing.ok)
    .map(({ ok: _ok, ...violation }) => violation);
}
