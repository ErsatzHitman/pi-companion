#!/usr/bin/env node
// CLI entry point for the Expo SDK alignment guard (T326). Run from the
// repository root after `npm ci`; CI runs it as the `guard-expo-sdk-alignment`
// job. See scripts/ci/guard-expo-sdk-alignment.mjs for the checked rule and
// the three emulator runs it replaces.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_WORKSPACE,
  extractAppPinnedModules,
  findExpoSdkAlignmentViolations,
  visibleInstalls,
} from "./guard-expo-sdk-alignment.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const lockPackages = readJson(join(repoRoot, "package-lock.json")).packages;
  const appManifest = readJson(join(repoRoot, APP_WORKSPACE, "package.json"));
  const appExpoRange = appManifest.dependencies?.expo;
  if (typeof appExpoRange !== "string") {
    console.error(
      `guard-expo-sdk-alignment: FAILED — ${APP_WORKSPACE}/package.json declares no \`expo\` dependency.`,
    );
    process.exitCode = 1;
    return;
  }

  const metroConfigPath = join(APP_WORKSPACE, "metro.config.js");
  const appPinnedModules = extractAppPinnedModules(
    readFileSync(join(repoRoot, metroConfigPath), "utf8"),
  );
  if (appPinnedModules === null) {
    console.error(
      `guard-expo-sdk-alignment: FAILED — cannot find \`const APP_PINNED_MODULES = [...]\` in ${metroConfigPath}; the shadowed-root-copy exemption has nothing to read.`,
    );
    process.exitCode = 1;
    return;
  }

  // `bundledNativeModules.json` ships inside the `expo` package and is not in
  // the lockfile, so it has to come from the installed tree — resolved from
  // the APP, the same way Node, Metro and autolinking resolve it.
  const appRequire = createRequire(join(repoRoot, APP_WORKSPACE, "package.json"));
  let installedExpoVersion;
  let bundledNativeModules;
  try {
    installedExpoVersion = readJson(appRequire.resolve("expo/package.json")).version;
    bundledNativeModules = readJson(appRequire.resolve("expo/bundledNativeModules.json"));
  } catch (error) {
    console.error(
      `guard-expo-sdk-alignment: FAILED — cannot resolve \`expo\` from ${APP_WORKSPACE}; run \`npm ci\` first. (${String(error?.message ?? error)})`,
    );
    process.exitCode = 1;
    return;
  }

  // A stale node_modules must never produce a green result: the lock is what
  // CI installs, so the installed `expo` must be the lock's `expo`.
  const lockExpo = visibleInstalls(lockPackages, APP_WORKSPACE, "expo")[0];
  if (!lockExpo || lockExpo.version !== installedExpoVersion) {
    console.error(
      `guard-expo-sdk-alignment: FAILED — installed expo@${installedExpoVersion} does not match package-lock.json's ${lockExpo ? `expo@${lockExpo.version} at ${lockExpo.location}` : "(no visible expo)"}; node_modules is stale relative to the lock. Run \`npm ci\`.`,
    );
    process.exitCode = 1;
    return;
  }

  const violations = findExpoSdkAlignmentViolations({
    lockPackages,
    bundledNativeModules,
    appExpoRange,
    appPinnedModules,
  });

  const checked = Object.keys(bundledNativeModules).filter(
    (name) => visibleInstalls(lockPackages, APP_WORKSPACE, name).length > 0,
  ).length;

  if (violations.length === 0) {
    console.log(
      `guard-expo-sdk-alignment: OK — expo@${installedExpoVersion} (${lockExpo.location}); all ${checked} installed package(s) named by its bundledNativeModules.json are inside that SDK's ranges at every location ${APP_WORKSPACE} can see (Metro-pinned to the app copy: ${appPinnedModules.join(", ") || "none"}).`,
    );
    return;
  }

  console.error(
    `guard-expo-sdk-alignment: FAILED — ${violations.length} finding(s) against expo@${installedExpoVersion}'s SDK, as ${APP_WORKSPACE} sees the tree:`,
  );
  for (const violation of violations) {
    console.error(`  [${violation.kind}] ${violation.reason}`);
  }
  console.error(
    "  A foreign-SDK native module autolinks into the APK and dies at module registration on every launch (T325); a foreign-SDK JavaScript copy reached by a root-hoisted dependent is the two-runtimes shape T307 measured.",
  );
  console.error(
    "  Find the edge that pulls it in with `npm explain <package>`; an unbounded `*` peer or dependency range is the usual cause (T307).",
  );
  process.exitCode = 1;
}

main();
