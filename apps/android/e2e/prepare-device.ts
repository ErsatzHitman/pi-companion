/**
 * T329 — `packaged-app-smoke`'s device preparation as a single command:
 *
 *   npx tsx apps/android/e2e/prepare-device.ts <apk-path>
 *
 * The shards get the same steps from `run-shard.ts`, which calls the same
 * `prepareDevice`. This file exists because `packaged-app-smoke` runs
 * `run-flow.ts` directly (one flow, the release package) rather than
 * through the shard loop, and `reactivecircus/android-emulator-runner`
 * runs each `script:` line as its own shell (see `run-shard.ts`'s doc
 * comment) — so the preparation has to be one line, and that line has to
 * be the same code the shards run, or the two jobs drift apart the way
 * T328's copied `hide_error_dialogs` line already had.
 */
import { fileURLToPath } from "node:url";

import { adbDeviceCommands } from "./harness/adb.js";
import { prepareDevice } from "./harness/device-prep.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
  const [apkPath] = process.argv.slice(2);
  if (!apkPath) {
    console.error("Usage: npx tsx apps/android/e2e/prepare-device.ts <apk-path>");
    process.exitCode = 1;
    return;
  }
  process.exitCode = await prepareDevice(apkPath, adbDeviceCommands(REPO_ROOT));
}

main().catch((error: unknown) => {
  console.error("[prepare-device] failed:", error);
  process.exitCode = 1;
});
