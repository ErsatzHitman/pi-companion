/**
 * T37D — the one documented command every T37E* task runs:
 *
 *   npx tsx apps/android/e2e/run-flow.ts <flow-name>
 *
 * against an **already-running, already-configured** emulator (see
 * `apps/android/maestro/README.md` for exactly what "already-running"
 * means and how to check it). This file only orchestrates process
 * spawning and cleanup; every piece of logic worth testing —
 * flow-name resolution, ephemeral endpoint allocation, the 6767 refusal,
 * the exact argv built for each child process, and (T207) the daemon
 * boot/exit decision below — lives in `harness/*.ts` and is covered by
 * `harness/*.test.ts`, not here.
 *
 * NOT exercised by this task: nothing in this wave has a device, a
 * Maestro binary, or an emulator (see the harness's own README and
 * T37D's report). This file is reviewable, typechecked, and its
 * imported logic is unit-tested, but it has never itself been run to
 * completion — that first real run belongs to whichever T37E* task first
 * has a device.
 *
 * T207 reads `APP_ID` from the environment (unset by every existing
 * caller except `packaged-app-smoke`, which sets it to `sh.picompanion`)
 * and passes it through to `buildRunPlan`, whose default leaves every
 * other caller — `maestro-e2e` included — behaviorally unchanged.
 *
 * T334 does two more things before the daemon starts, both after Maestro
 * run 34462826449 showed the isolated daemon had no `pi` to run and no
 * directory a flow could name as a session's `cwd`: it provisions the
 * scripted `pi` stand-in into the fresh home's `config.json`
 * (`harness/scripted-pi-provision.ts` -> `harness/scripted-pi.mjs`,
 * scenario chosen per flow) and mints a per-run working directory the
 * flow receives as `${FLOW_CWD}` (`harness/flow-cwd.ts`). Neither touches
 * anything outside this run's own temp directories.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFlowRegistry } from "./harness/flow-registry.js";
import { resolveIsolatedDaemonEndpoint } from "./harness/daemon-endpoint.js";
import { buildRunPlan } from "./harness/run-plan.js";
import { PRODUCTION_DAEMON_PORT } from "./harness/production-daemon-port.js";
import { combineRunExitCode, daemonFailedToBoot } from "./harness/daemon-exit-policy.js";
import { createFlowCwd } from "./harness/flow-cwd.js";
import { provisionScriptedPi } from "./harness/scripted-pi-provision.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PASEO_BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "paseo");

/** Milliseconds to wait after spawning the daemon before driving Maestro against it. */
const DAEMON_BOOT_DELAY_MS = 3_000;

function spawnAndWait(
  command: string,
  argv: string[],
  options: Parameters<typeof spawn>[2] = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const flowName = process.argv[2];
  const registry = createFlowRegistry();

  if (!flowName) {
    const available = registry.listFlowNames();
    console.error("Usage: npx tsx apps/android/e2e/run-flow.ts <flow-name>");
    console.error(`Available flows: ${available.length > 0 ? available.join(", ") : "(none)"}`);
    process.exitCode = 1;
    return;
  }

  // Throws with the available-flow list on a typo or unknown name.
  const flowPath = registry.resolveFlowPath(flowName);

  const endpoint = await resolveIsolatedDaemonEndpoint();
  // T334: both go into this run's own temp directories, never anywhere else.
  const scriptedPi = await provisionScriptedPi(endpoint.paseoHome, flowName);
  const flowCwd = await createFlowCwd(flowName);
  const plan = buildRunPlan(flowName, flowPath, endpoint, process.env["APP_ID"], flowCwd);

  console.log(`[run-flow] flow: ${plan.flowName} (${plan.flowPath})`);
  console.log(`[run-flow] isolated daemon home: ${plan.daemon.home}`);
  console.log(
    `[run-flow] scripted pi provisioned: ${scriptedPi.configPath} (scenario ${scriptedPi.scenario})`,
  );
  console.log(`[run-flow] flow working directory (FLOW_CWD): ${flowCwd}`);
  console.log(
    `[run-flow] isolated daemon listen: ${plan.daemon.listenAddress} (never ${PRODUCTION_DAEMON_PORT})`,
  );
  console.log(`[run-flow] emulator reaches it at: ${plan.maestro.env.DAEMON_ADDRESS}`);

  const daemon = spawn("node", [PASEO_BIN, ...plan.daemon.startArgv], { stdio: "inherit" });
  let daemonSpawnError: Error | null = null;
  let daemonExitCode: number | null = null;
  daemon.once("error", (error) => {
    daemonSpawnError = error instanceof Error ? error : new Error(String(error));
  });
  // T207 (folding in the P8-W10 merge gate's F4): a daemon whose bin
  // throws MODULE_NOT_FOUND (nothing built @picompanion/cli) spawns fine
  // and then exits on its own — no `error` event fires for that, only
  // `exit`. See harness/daemon-exit-policy.ts for why this is checked in
  // two places (once after the boot delay, once after the flow finishes).
  daemon.once("exit", (code) => {
    daemonExitCode = code;
  });

  await new Promise((resolve) => setTimeout(resolve, DAEMON_BOOT_DELAY_MS));
  if (
    daemonFailedToBoot({
      hadSpawnError: daemonSpawnError !== null,
      exitCodeAtBootCheck: daemonExitCode,
    })
  ) {
    if (daemonSpawnError) {
      console.error("[run-flow] failed to start isolated daemon:", daemonSpawnError);
    } else {
      console.error(
        `[run-flow] isolated daemon exited with code ${daemonExitCode} before it could boot — ` +
          "did every workflow job build @picompanion/cli and @picompanion/server first? " +
          "(packages/cli/bin/paseo imports ../dist/index.js)",
      );
    }
    process.exitCode = 1;
    return;
  }

  let exitCode = 1;
  try {
    exitCode = await spawnAndWait("maestro", plan.maestro.argv, {
      env: { ...process.env, ...plan.maestro.env },
    });
  } finally {
    daemon.kill();
    // T321: the stop result is REPORTED, not swallowed. It used to be
    // `.catch(() => 1)` with the exit code discarded, which hid a stop
    // command that had never once worked: `stop --home ...` is the agent
    // command and rejects `--home`, so every flow left its daemon running.
    // Two orphans per shard then held the CI job open until its timeout,
    // long after this process had exited. A failed stop is not fatal to the
    // flow's own result — the flow has already finished by here — but it
    // must be visible, because the next person debugging a hung job needs
    // to see it in the log rather than infer it from an orphan pid.
    const stopExit = await spawnAndWait("node", [PASEO_BIN, ...plan.daemon.stopArgv]).catch(
      (error: unknown) => {
        console.error("[run-flow] could not run the daemon stop command:", error);
        return 1;
      },
    );
    if (stopExit !== 0) {
      console.error(
        `[run-flow] daemon stop exited ${stopExit} for home ${plan.daemon.home} — a daemon may ` +
          "still be running and can hold this job open until its timeout.",
      );
    }
  }

  process.exitCode = combineRunExitCode(exitCode, daemonExitCode);
}

main().catch((error: unknown) => {
  console.error("[run-flow] failed:", error);
  process.exitCode = 1;
});
