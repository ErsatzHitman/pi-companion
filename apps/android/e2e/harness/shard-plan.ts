/**
 * T37F (plan.md §14.4, §15.4) — reads and validates
 * `apps/android/maestro/shards.json`, the Phase-5-exit-gate shard
 * assignment for the ten §14.4 flows (T37E1-T37E10). This module owns no
 * flow file and starts no process: it is pure data-in, data-out, the same
 * "provable without a device" shape as `flow-registry.ts` and
 * `run-plan.ts` next to it, so `shard-plan.test.ts` can assert the real
 * config is valid — and that specific corruptions of it are rejected —
 * without an emulator, a device, or Maestro installed.
 *
 * `run-flow.ts` (T37D) already runs exactly one flow by name; this module
 * deliberately does not duplicate that orchestration. Running a shard is
 * "call `resolveShardFlows` once, then invoke the existing single-flow
 * command for each name it returns, in order" — see
 * `apps/android/maestro/README.md`'s "The one documented command" and
 * this task's own report for why a shard adds no second way to start a
 * flow.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createFlowRegistry } from "./flow-registry.js";

const REAL_SHARDS_PATH = fileURLToPath(new URL("../../maestro/shards.json", import.meta.url));

/**
 * `smoke.yaml` is T37D's own harness-proof flow (plan.md §6), never one of
 * the ten §14.4 scenarios T37E1-T37E10 wrote. The exit gate this module
 * backs re-runs exactly those ten, so `smoke` is excluded from the
 * "known flow names" set the shard config is checked against, the same
 * way `flow-registry.ts` already excludes the reserved `config` name.
 *
 * `file-download.yaml` (T77) is excluded for the identical reason: it was
 * added after T37F's ten-flow set closed, is not one of T37E1-T37E10, and
 * is deliberately not assigned to a shard (see that flow's own header
 * comment) — including it here would make `shards.json`'s real "known
 * flows" set drift from the ten §14.4 scenarios `shard-plan.test.ts` and
 * `flow-independence.test.ts` both assert against. It still runs the
 * same one documented way any flow does:
 * `npx tsx apps/android/e2e/run-flow.ts file-download`.
 *
 * CORRECTED (T381): "deliberately not assigned to a shard" no longer
 * holds — this flow is assigned to the non-gating observation set
 * (`listNonExitGateFlowNames` below; run via `run-shard.ts non-gating`),
 * which the `maestro-non-gating` CI job runs on every dispatch without
 * joining the exit gate's ten. The first half above still holds (not one
 * of T37E1-T37E10, so never in `shards.json`), and this exclusion set is
 * unchanged.
 *
 * `recovered-turn-banner.yaml` (T106) is excluded for the identical
 * reason as `file-download.yaml` above: it was added long after T37F's
 * ten-flow set closed, is not one of T37E1-T37E10, and — see that flow's
 * own header comment — deep-links to a `__DEV__`-only lab route rather
 * than a paired session, a different shape from every T37E* scenario.
 * Runs the same one documented way: `npx tsx apps/android/e2e/run-flow.ts
 * recovered-turn-banner`.
 *
 * CORRECTED (T381): still unassigned, and the reason is now structural
 * rather than "nobody gave it a shard". Its `openLink:` step targets a
 * `picompanion://dev/…` route whose wrapper returns `<Redirect href="/" />`
 * when `!__DEV__`, and every APK CI builds is the `assembleRelease`
 * variant (`__DEV__` false; the debug variant carries no embedded bundle
 * — T311). No CI-buildable APK mounts this flow's screen, so
 * `listNonExitGateFlowNames` below deliberately leaves dev-linked flows
 * out of the observed set. Observing it needs a real mount point for its
 * component (its header's disclosed gap) or a Metro-backed debug-APK job;
 * this task builds neither, and says so here rather than implying a
 * shard assignment would suffice.
 *
 * `session-tree-sheet.yaml` (T39A) is excluded for the identical reason
 * as `recovered-turn-banner.yaml` immediately above — same wave-6 shape
 * (added long after T37F's ten-flow set closed, deep-links to its own
 * `__DEV__`-only lab route). Runs the same one documented way:
 * `npx tsx apps/android/e2e/run-flow.ts session-tree-sheet`.
 *
 * CORRECTED (T381): same structural verdict as `recovered-turn-banner`
 * immediately above — still unassigned because no CI-buildable APK mounts
 * its `picompanion://dev/…` screen, not because no shard names it. See
 * that paragraph for the full reason; it applies here unchanged.
 *
 * `queue-retry-compaction.yaml` (T39C) is excluded for the identical
 * reason as the three above — added long after T37F's ten-flow set
 * closed, not one of T37E1-T37E10.
 *
 * CORRECTED (T380). This paragraph used to add a second reason, which
 * it called the one that made the exclusion "mandatory rather than
 * merely consistent": that the flow "has never been run (no emulator,
 * no device, no Maestro binary here)", so "putting an admittedly-unrun
 * flow into the CI exit gate would assert a run nobody has made".
 *
 * Both halves have to go, for different reasons. The parenthetical is
 * simply false now — the emulator boots on every dispatch and the ten
 * sharded flows were green end to end in dispatch 34558058662. And the
 * argument was circular even when the parenthetical was true: this set
 * is what decides which flows CI runs, so "it has never run" cannot be
 * a reason to keep it out of the thing that would run it. Adding a
 * never-run flow to a gate does not assert a run; it performs one, and
 * reports whatever happens.
 *
 * What survives is the first reason alone, which is sound and is the
 * same one the three flows above carry: this set is `plan.md` §14.4's
 * ten scenarios, and T39C is not one of them. Widening it would change
 * what the Phase 5 exit gate MEANS, which is not a shard file's call to
 * make. Giving these four flows a run of their own, outside the exit
 * gate, is a different change and does not touch this set.
 *
 * Runs the same one documented way any flow does:
 * `npx tsx apps/android/e2e/run-flow.ts queue-retry-compaction`.
 *
 * CORRECTED (T381): same assignment change as `file-download.yaml` above —
 * this flow joins the non-gating observation set (`listNonExitGateFlowNames`
 * below; run via `run-shard.ts non-gating`) while staying out of
 * `shards.json`, for the same "not one of T37E1-T37E10" reason that still
 * holds.
 */
const NON_EXIT_GATE_FLOW_NAMES = new Set([
  "smoke",
  "file-download",
  "recovered-turn-banner",
  "session-tree-sheet",
  "queue-retry-compaction",
]);

/**
 * T381 — flows the non-gating observation job runs, derived from the tree
 * rather than typed out: every real flow minus the exit gate's ten, minus
 * the flows observed elsewhere, minus the flows no CI-built APK can run.
 *
 * The three subtractions each name their reason, so none of them can go
 * stale silently:
 *
 * - Exit-gate flows are `listExitGateFlowNames`' own output — a flow
 *   promoted into `shards.json` leaves this set with no edit here.
 * - `OBSERVED_ELSEWHERE` names the flows a different CI job already runs
 *   (`smoke`, via `packaged-app-smoke`), so this job never runs anything
 *   twice.
 * - Dev-linked flows open a `picompanion://dev/…` route. Every `app/dev/`
 *   route wrapper returns `<Redirect href="/" />` when `!__DEV__`, and CI
 *   only ever builds the `assembleRelease` variant, so those screens do
 *   not exist on a CI-built APK and asserting on them there can only fail.
 *   Detected from each flow file's own `openLink:` step, so a flow whose
 *   component gains a real mount point — and drops its dev link — joins
 *   the observed set automatically.
 */
const OBSERVED_ELSEWHERE = new Set(["smoke"]);

const DEV_ROUTE_LINK_PATTERN = /openLink:\s*["']picompanion:\/\/dev\//;

export function usesDevOnlyRoute(flowPath: string): boolean {
  return DEV_ROUTE_LINK_PATTERN.test(readFileSync(flowPath, "utf8"));
}

export function listNonGatingObservedFlowNames(maestroDir?: string): string[] {
  const registry = createFlowRegistry(maestroDir);
  const exitGate = new Set(listExitGateFlowNames(maestroDir));
  return registry.listFlowNames().filter((name) => {
    if (exitGate.has(name) || OBSERVED_ELSEWHERE.has(name)) return false;
    return !usesDevOnlyRoute(registry.resolveFlowPath(name));
  });
}

export interface Shard {
  name: string;
  flows: string[];
}

export interface ShardConfig {
  description: string;
  flows: string[];
  shards: Shard[];
}

export function loadShardConfig(shardsPath: string = REAL_SHARDS_PATH): ShardConfig {
  const raw = readFileSync(shardsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as ShardConfig).flows) ||
    !Array.isArray((parsed as ShardConfig).shards)
  ) {
    throw new Error(`Malformed shard config at ${shardsPath}: expected { flows: [], shards: [] }`);
  }
  return parsed as ShardConfig;
}

/**
 * The ten §14.4 flows the exit gate must cover, derived from the real
 * `apps/android/maestro/*.yaml` files rather than typed out a second time
 * — so a new T37E-style flow file (or a renamed/removed one) shows up as
 * a validation issue instead of silently going unwatched.
 */
export function listExitGateFlowNames(maestroDir?: string): string[] {
  const registry = createFlowRegistry(maestroDir);
  return registry.listFlowNames().filter((name) => !NON_EXIT_GATE_FLOW_NAMES.has(name));
}

/**
 * Every issue found with a shard config, checked against the real set of
 * flows it is supposed to cover. Returns an empty array when the config is
 * valid. Never throws — a caller (the test, or a future CI preflight
 * script) decides whether an issue list is fatal.
 */
export function validateShardConfig(config: ShardConfig, knownFlowNames: string[]): string[] {
  const issues: string[] = [];
  const known = new Set(knownFlowNames);

  const declaredFlows = new Set(config.flows);
  if (declaredFlows.size !== config.flows.length) {
    issues.push("config.flows contains a duplicate flow name");
  }

  for (const name of config.flows) {
    if (!known.has(name)) {
      issues.push(`config.flows names "${name}", which is not a real §14.4 flow`);
    }
  }
  for (const name of known) {
    if (!declaredFlows.has(name)) {
      issues.push(`§14.4 flow "${name}" is not listed in config.flows`);
    }
  }

  const shardNames = new Set<string>();
  const seenInShards = new Set<string>();
  for (const shard of config.shards) {
    if (shardNames.has(shard.name)) {
      issues.push(`duplicate shard name "${shard.name}"`);
    }
    shardNames.add(shard.name);

    if (shard.flows.length === 0) {
      issues.push(`shard "${shard.name}" has no flows`);
    }

    for (const flowName of shard.flows) {
      if (!declaredFlows.has(flowName)) {
        issues.push(`shard "${shard.name}" names "${flowName}", which is not in config.flows`);
      }
      if (seenInShards.has(flowName)) {
        issues.push(`flow "${flowName}" appears in more than one shard`);
      }
      seenInShards.add(flowName);
    }
  }

  for (const name of declaredFlows) {
    if (!seenInShards.has(name)) {
      issues.push(`flow "${name}" is not assigned to any shard`);
    }
  }

  return issues;
}

export function listShardNames(config: ShardConfig): string[] {
  return config.shards.map((shard) => shard.name);
}

/** The ordered flow names for one shard. Throws on an unknown shard name. */
export function resolveShardFlows(config: ShardConfig, shardName: string): string[] {
  const shard = config.shards.find((candidate) => candidate.name === shardName);
  if (!shard) {
    const available = listShardNames(config).join(", ") || "(none)";
    throw new Error(`No shard named "${shardName}". Available shards: ${available}`);
  }
  return shard.flows;
}
