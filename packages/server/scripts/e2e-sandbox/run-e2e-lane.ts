#!/usr/bin/env node
/**
 * T101 — the bounded, sandboxed runner for packages/server's e2e and
 * integration test lanes.
 *
 * Usage (from packages/server/):
 *   tsx scripts/e2e-sandbox/run-e2e-lane.ts <e2e|integration> [--dry-run]
 * or via the wired npm scripts:
 *   npm run test:e2e:sandboxed
 *   npm run test:integration:sandboxed
 *
 * What "bounded, sandboxed" means concretely:
 *   - sandboxed: `buildSandboxEnv` (./sandbox-env.ts) allocates an ephemeral
 *     port distinct from the production daemon (6767) and dev daemon (6768)
 *     and a fresh `PASEO_HOME` under the OS temp directory, then strips any
 *     ambient env var that names one of the forbidden ports before handing
 *     the child process its environment.
 *   - bounded: `runBounded` (./bounded-runner.ts) puts a hard wall-clock
 *     ceiling on the underlying `npm run test:e2e` / `npm run test:integration`
 *     invocation and kills the whole process tree if it is exceeded, instead
 *     of letting a hang in a spawned daemon or terminal process wait forever.
 *
 * This file was never invoked with `--execute` (the default) by the agent
 * that wrote it — see docs/server-e2e-sandbox.md for the disclosure. Only
 * `--dry-run`, which resolves the sandbox plan without spawning `npm`/vitest
 * and therefore opens no socket beyond the momentary loopback bind-and-release
 * `allocateSandboxPort` uses to ask the OS for a free port number, was ever
 * run during T101's implementation.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSandboxEnv, assertNotForbiddenPort, type SandboxEnvResult } from "./sandbox-env.js";
import { runBounded, type BoundedRunResult } from "./bounded-runner.js";

export interface LaneDefinition {
  /** The package.json script this lane wraps. */
  npmScript: string;
  /** Hard wall-clock bound in milliseconds. */
  timeoutMs: number;
  description: string;
}

// Not measured against a real run (see docs/server-e2e-sandbox.md) — chosen
// conservatively as a multiple of test:unit's measured ~140-270s foreground
// time for a lane that additionally spawns real daemon/terminal processes.
// Adjust once a real run's duration is observed.
export const LANES: Record<string, LaneDefinition> = {
  e2e: {
    npmScript: "test:e2e",
    timeoutMs: 15 * 60_000,
    description: "vitest run e2e.test.ts --maxWorkers=1 (excludes *.real.e2e / *.local.e2e)",
  },
  integration: {
    npmScript: "test:integration",
    timeoutMs: 8 * 60_000,
    description: "the three daemon-e2e/model-catalog integration suites, --maxWorkers=1",
  },
};

export function resolveLane(name: string | undefined): LaneDefinition | undefined {
  if (!name) return undefined;
  return LANES[name];
}

export interface ParsedCliArgs {
  laneName: string | undefined;
  dryRun: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [laneName, ...rest] = argv;
  return { laneName, dryRun: rest.includes("--dry-run") };
}

export interface LaneRunPlan {
  laneName: string;
  lane: LaneDefinition;
  sandbox: SandboxEnvResult;
}

/**
 * Resolves everything a lane run needs — the lane definition and a real
 * sandbox environment (real ephemeral port, real isolated temp home) —
 * without spawning `npm`/vitest. This is the seam the unit tests exercise
 * directly, and what `--dry-run` prints instead of executing.
 */
export async function planLaneRun(laneName: string | undefined): Promise<LaneRunPlan> {
  const lane = resolveLane(laneName);
  if (!lane || !laneName) {
    throw new Error(
      `Unknown or missing lane "${laneName}". Valid lanes: ${Object.keys(LANES).join(", ")}`,
    );
  }
  const sandbox = await buildSandboxEnv();
  assertNotForbiddenPort(sandbox.port, "run-e2e-lane resolved sandbox port");
  return { laneName, lane, sandbox };
}

function packageRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

function describePlan(plan: LaneRunPlan): string {
  return (
    `[e2e-sandbox] lane=${plan.laneName} npmScript=${plan.lane.npmScript} ` +
    `port=${plan.sandbox.port} paseoHome=${plan.sandbox.paseoHome} ` +
    `timeoutMs=${plan.lane.timeoutMs}`
  );
}

async function main(): Promise<void> {
  const { laneName, dryRun } = parseCliArgs(process.argv.slice(2));

  let plan: LaneRunPlan;
  try {
    plan = await planLaneRun(laneName);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Usage: run-e2e-lane.ts <${Object.keys(LANES).join("|")}> [--dry-run]`);
    process.exitCode = 2;
    return;
  }

  console.log(describePlan(plan));

  if (dryRun) {
    console.log(
      "[e2e-sandbox] --dry-run: not spawning npm/vitest. No daemon or terminal process was started.",
    );
    return;
  }

  const result: BoundedRunResult = await runBounded("npm", ["run", plan.lane.npmScript], {
    cwd: packageRoot(),
    env: plan.sandbox.env,
    shell: process.platform === "win32",
    timeoutMs: plan.lane.timeoutMs,
    onOutput: (chunk, stream) =>
      (stream === "stdout" ? process.stdout : process.stderr).write(chunk),
  });

  if (result.timedOut) {
    console.error(
      `[e2e-sandbox] lane "${plan.laneName}" exceeded its ${plan.lane.timeoutMs}ms bound and was killed.`,
    );
    process.exitCode = 124;
    return;
  }

  process.exitCode = result.code ?? 1;
}

const isDirectlyExecuted = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error("[e2e-sandbox] fatal error", error);
    process.exitCode = 1;
  });
}
