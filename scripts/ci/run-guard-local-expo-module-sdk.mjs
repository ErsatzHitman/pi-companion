#!/usr/bin/env node
// CLI entry point for the local-Expo-module compileSdk guard (T316). Run
// from the repository root; CI runs it as the
// `guard-local-expo-module-sdk` job. See
// scripts/ci/guard-local-expo-module-sdk.mjs for the checked rule and why
// it is a static check rather than "the build would catch it".

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  findLocalExpoModuleSdkViolations,
  selectLocalExpoModuleBuildFiles,
} from "./guard-local-expo-module-sdk.mjs";

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
}

function main() {
  const paths = selectLocalExpoModuleBuildFiles(listTrackedFiles());

  // Zero modules is a legitimate state (this app had none before T36F), so
  // it is reported rather than treated as a failure the way
  // `guard-app-id-package-pairing` treats zero pairings — there, zero meant
  // the check had silently stopped working; here it means the directory is
  // empty, which the message says out loud.
  if (paths.length === 0) {
    console.log(
      "guard-local-expo-module-sdk: OK — no local Expo modules under apps/android/modules.",
    );
    return;
  }

  const violations = findLocalExpoModuleSdkViolations(
    paths.map((path) => ({ path, content: readFileSync(path, "utf8") })),
  );

  if (violations.length === 0) {
    console.log(
      `guard-local-expo-module-sdk: OK — all ${paths.length} local Expo module(s) establish an ` +
        "Android compileSdk.",
    );
    return;
  }

  console.error("guard-local-expo-module-sdk: FAILED");
  for (const violation of violations) {
    console.error(`  ${violation.path} ${violation.reason}`);
  }
  console.error(
    "  Without it the Android Gradle Plugin rejects the module and fails the configuration " +
      "phase of the whole app — reported against whichever third-party project it was " +
      "configuring at the time, not against the module you own.",
  );
  process.exitCode = 1;
}

main();
