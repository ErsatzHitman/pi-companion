import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  findLocalExpoModuleSdkViolations,
  selectLocalExpoModuleBuildFiles,
  stripGradleComments,
} from "./guard-local-expo-module-sdk.mjs";

const BROKEN_MODULE = `
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()

android {
  namespace "sh.picompanion.shareintent"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
}
`;

test("the exact pre-fix shape is reported", () => {
  // Applying ExpoModulesCorePlugin.gradle and calling the KOTLIN helper is
  // what the broken module did, and is deliberately not enough.
  const violations = findLocalExpoModuleSdkViolations([
    { path: "apps/android/modules/share-intent/android/build.gradle", content: BROKEN_MODULE },
  ]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/android/modules/share-intent/android/build.gradle");
  assert.match(violations[0].reason, /establishes no Android compileSdk/);
});

test("each of the three recognised mechanisms satisfies the check on its own", () => {
  const cases = [
    ["useDefaultAndroidSdkVersions", `${BROKEN_MODULE}\nuseDefaultAndroidSdkVersions()\n`],
    [
      "expo-module-gradle-plugin",
      `plugins {\n  id 'com.android.library'\n  id 'expo-module-gradle-plugin'\n}\n`,
    ],
    ["explicit compileSdk", `android {\n  compileSdk 36\n}\n`],
    ["explicit compileSdkVersion", `android {\n  compileSdkVersion 36\n}\n`],
  ];

  for (const [label, content] of cases) {
    assert.deepEqual(
      findLocalExpoModuleSdkViolations([
        { path: `apps/android/modules/m/android/build.gradle`, content },
      ]),
      [],
      `${label} should satisfy the check`,
    );
  }
});

test("a COMMENT naming the helper does not satisfy the check", () => {
  // The trap this guard would otherwise fall into, and the one its own
  // subject file sets: that file's header discusses
  // `useDefaultAndroidSdkVersions()` at length while explaining the bug.
  // A guard that matched comment text would pass a module that only talks
  // about calling it.
  const commentOnly = `
// This module relies on useDefaultAndroidSdkVersions() to set compileSdk.
/* Historically it called useDefaultAndroidSdkVersions() here. */
apply plugin: 'com.android.library'
applyKotlinExpoModulesCorePlugin()
`;

  const violations = findLocalExpoModuleSdkViolations([
    { path: "apps/android/modules/m/android/build.gradle", content: commentOnly },
  ]);

  assert.equal(violations.length, 1);
});

test("stripGradleComments removes line and block comments but keeps code", () => {
  const stripped = stripGradleComments(`
// useDefaultAndroidSdkVersions()
/* useDefaultAndroidSdkVersions() */
realCall()
`);

  assert.ok(!stripped.includes("useDefaultAndroidSdkVersions"));
  assert.ok(stripped.includes("realCall()"));
});

test("selectLocalExpoModuleBuildFiles matches only a local module's android/build.gradle", () => {
  const paths = [
    "apps/android/modules/share-intent/android/build.gradle",
    "apps/android/modules/other/android/build.gradle",
    // Not a local module's own build file:
    "apps/android/modules/share-intent/expo-module.config.json",
    "apps/android/android/app/build.gradle",
    "apps/android/modules/share-intent/android/src/main/java/X.kt",
    "packages/expo-two-way-audio/android/build.gradle",
  ];

  assert.deepEqual(selectLocalExpoModuleBuildFiles(paths), [
    "apps/android/modules/share-intent/android/build.gradle",
    "apps/android/modules/other/android/build.gradle",
  ]);
});

test("the real tree: every local Expo module passes, and there is at least one to check", () => {
  // Non-vacuity, the shape CLAUDE.md's T217/T211 sections keep re-finding:
  // a guard that silently checks nothing reports OK forever. If this app
  // ever legitimately has zero local modules the runner says so explicitly,
  // but today it has one and that one must really be scanned.
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const paths = selectLocalExpoModuleBuildFiles(tracked);

  assert.ok(paths.length > 0, "expected at least one local Expo module to check");
  assert.ok(paths.includes("apps/android/modules/share-intent/android/build.gradle"));

  const violations = findLocalExpoModuleSdkViolations(
    paths.map((path) => ({ path, content: readFileSync(path, "utf8") })),
  );
  assert.deepEqual(violations, []);
});

test("MUTATION PROOF: removing the real call from the real file turns the real tree red", () => {
  const path = "apps/android/modules/share-intent/android/build.gradle";
  const real = readFileSync(path, "utf8");
  const mutated = real.replace("useDefaultAndroidSdkVersions()\n", "");

  assert.notEqual(mutated, real, "the mutation must actually change the file");
  assert.equal(findLocalExpoModuleSdkViolations([{ path, content: mutated }]).length, 1);
});
