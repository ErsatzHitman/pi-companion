/**
 * T320 — one shard's worth of work as a SINGLE command:
 *
 *   npx tsx apps/android/e2e/run-shard.ts <shard-name> <apk-path>
 *
 * ## Why this file exists
 *
 * `reactivecircus/android-emulator-runner` does not hand its `script:` input
 * to one shell. It runs **each line separately**, as its own `sh -c`
 * invocation — visible verbatim in Maestro run 34407860092's log:
 *
 *   [command]/usr/bin/sh -c set -eu
 *   [command]/usr/bin/sh -c adb install -r "$RUNNER_TEMP/picompanion-debug.apk"
 *   [command]/usr/bin/sh -c flows="$(node -e "
 *   /usr/bin/sh: 1: Syntax error: Unterminated quoted string
 *
 * Three things follow, and the workflow previously assumed the opposite of
 * all three: no shell state (a variable, a `set -e`) survives from one line
 * to the next; no construct may span lines, so a `for` loop or a multi-line
 * command substitution is a syntax error; and `set -eu` is a no-op, because
 * it configures a shell that exits at the end of that one line. Failure
 * still propagates — the action checks each line's exit status, which is
 * how the syntax error above failed the step.
 *
 * So the shard loop cannot live in the workflow. It lives here, in the same
 * language and directory as `run-flow.ts`, and the workflow's `script:`
 * becomes a single line that cannot be broken by any of the three.
 *
 * ## What it does NOT do
 *
 * It does not re-implement `run-flow.ts`. Each flow is still run by exactly
 * the command `apps/android/maestro/README.md` documents — flow-name
 * resolution, ephemeral daemon endpoints, the 6767 refusal and the daemon
 * exit policy all stay in that file and its harness. This is the loop and
 * the `adb install` around it, nothing more.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadShardConfig, resolveShardFlows } from "./harness/shard-plan.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUN_FLOW = path.join(REPO_ROOT, "apps", "android", "e2e", "run-flow.ts");

function run(command: string, argv: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio: "inherit", cwd: REPO_ROOT, shell: false });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function capture(command: string, argv: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd: REPO_ROOT, shell: false });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("error", (error) => resolve(`<failed to run ${command}: ${String(error)}>`));
    child.once("close", () => resolve(out));
  });
}

/**
 * T322: dumps the device log for a flow that failed, into the directory the
 * workflow uploads as an artifact.
 *
 * Maestro already writes its own screenshots and view hierarchy under
 * `~/.maestro/tests/<timestamp>/`, and those survive the job because the
 * Maestro CLI runs on the RUNNER, not on the device. `adb logcat` does not:
 * `reactivecircus/android-emulator-runner` kills the emulator the moment its
 * `script:` returns, so a device log can only be captured from inside this
 * process. Without it, a flow that fails because the app crashed on launch
 * is indistinguishable from one that fails because a selector is wrong —
 * which is exactly the ambiguity run 34420667467's
 * `Assertion is false: id: connect-onboarding is visible` left behind.
 */
async function captureDeviceLog(flow: string, outDir: string): Promise<void> {
  const log = await capture("adb", ["logcat", "-d", "-v", "time", "-t", "3000"]);
  const file = path.join(outDir, `logcat-${flow}.txt`);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, log, "utf8");
    console.log(`[run-shard] wrote device log for ${flow}: ${file}`);
  } catch (error) {
    console.error(`[run-shard] could not write ${file}:`, error);
  }
}

async function main(): Promise<void> {
  const [shardName, apkPath] = process.argv.slice(2);

  if (!shardName || !apkPath) {
    console.error("Usage: npx tsx apps/android/e2e/run-shard.ts <shard-name> <apk-path>");
    process.exitCode = 1;
    return;
  }

  // Throws with the known shard names on a typo, rather than silently
  // running zero flows and reporting success — the shape a shard name that
  // no longer exists would otherwise take.
  const flows = resolveShardFlows(loadShardConfig(), shardName);
  console.log(`[run-shard] ${shardName}: ${flows.length} flow(s) — ${flows.join(", ")}`);

  const installExit = await run("adb", ["install", "-r", apkPath]);
  if (installExit !== 0) {
    console.error(`[run-shard] adb install failed with exit code ${installExit}: ${apkPath}`);
    process.exitCode = installExit;
    return;
  }

  // Every flow runs even after one fails, so a single dispatch reports every
  // broken flow in this shard rather than only the first. The shard's own
  // exit code is the first non-zero one. Flow order never matters: each flow
  // starts with its own `clearState: true` launchApp (see
  // apps/android/maestro/README.md's "Flow independence").
  let firstFailure = 0;
  const results: { flow: string; exitCode: number }[] = [];

  const debugDir = path.join(process.env["RUNNER_TEMP"] ?? REPO_ROOT, "maestro-debug");

  for (const flow of flows) {
    console.log(`::group::flow: ${flow}`);
    const exitCode = await run("npx", ["tsx", RUN_FLOW, flow]);
    if (exitCode !== 0) await captureDeviceLog(flow, debugDir);
    console.log("::endgroup::");
    results.push({ flow, exitCode });
    if (exitCode !== 0 && firstFailure === 0) firstFailure = exitCode;
  }

  for (const { flow, exitCode } of results) {
    console.log(`[run-shard] ${flow}: ${exitCode === 0 ? "PASS" : `FAIL (exit ${exitCode})`}`);
  }

  process.exitCode = firstFailure;
}

main().catch((error: unknown) => {
  console.error("[run-shard] failed:", error);
  process.exitCode = 1;
});
