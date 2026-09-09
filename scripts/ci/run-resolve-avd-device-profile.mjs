#!/usr/bin/env node
// CLI entry point for the AVD device-profile resolver (T317). Run inside a
// GitHub Actions step, BEFORE `reactivecircus/android-emulator-runner`:
//
//   - name: Resolve an AVD device profile this runner's catalog has
//     id: avd
//     run: node scripts/ci/run-resolve-avd-device-profile.mjs
//   - uses: reactivecircus/android-emulator-runner@...
//     with:
//       profile: ${{ steps.avd.outputs.profile }}
//
// Writes `profile=<id>` to `$GITHUB_OUTPUT` and prints the whole catalog
// into a collapsed log group, so the next person debugging an AVD failure
// can read what the runner actually offered instead of inferring it from
// `Error: No device found matching --device <x>`. See
// scripts/ci/avd-device-profile.mjs for why this is resolved at run time
// rather than checked statically.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import { chooseAvdDeviceProfile, parseAvdDeviceIds } from "./avd-device-profile.mjs";

/**
 * `avdmanager` is not on PATH on every runner image, so the SDK's own
 * `cmdline-tools` location is tried first and PATH is the fallback.
 *
 * The PATH fallback is not speculative: run 34392173679's own failure log
 * shows the emulator action reaching `avdmanager` by bare name on this
 * image (`/usr/bin/sh -c \echo no | avdmanager create avd ...`), so a
 * bare-name lookup does resolve there today. The explicit SDK paths are for
 * images where it does not.
 *
 * @returns {string}
 */
function resolveAvdManager() {
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (sdkRoot) {
    for (const relative of [
      "cmdline-tools/latest/bin/avdmanager",
      "cmdline-tools/bin/avdmanager",
      "tools/bin/avdmanager",
    ]) {
      const candidate = path.join(sdkRoot, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "avdmanager";
}

function main() {
  const avdmanager = resolveAvdManager();

  let listOutput = "";
  try {
    listOutput = execFileSync(avdmanager, ["list", "device"], { encoding: "utf8" });
  } catch (error) {
    // A missing or failing `avdmanager` is not fatal here: the emulator
    // action installs its own SDK packages afterwards and creating the AVD
    // with no `--device` flag is valid. Falling back loudly beats failing
    // the job before the emulator has even been asked to start.
    console.log(`::warning::could not run \`${avdmanager} list device\`: ${error.message}`);
  }

  const availableIds = parseAvdDeviceIds(listOutput);
  console.log("::group::avdmanager list device");
  console.log(listOutput.trimEnd() || "(no output)");
  console.log("::endgroup::");
  console.log(`available device profiles (${availableIds.length}): ${availableIds.join(", ")}`);

  const profile = chooseAvdDeviceProfile(availableIds);
  if (profile === "") {
    console.log(
      "::warning::none of the preferred Pixel device profiles exist in this runner's AVD " +
        "catalog; creating the AVD with no --device flag (the emulator action's own default). " +
        "plan.md names a Pixel 8 API 35 reference emulator, so the AVD is no longer that shape.",
    );
  } else {
    console.log(`resolved device profile: ${profile}`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, `profile=${profile}\n`);
}

main();
