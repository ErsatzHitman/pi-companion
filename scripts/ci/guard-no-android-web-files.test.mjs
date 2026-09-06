import assert from "node:assert/strict";
import test from "node:test";
import { findAndroidWebFileViolations } from "./guard-no-android-web-files.mjs";

test("passes on a clean apps/android tree", () => {
  const paths = [
    "apps/android/src/index.ts",
    "apps/android/src/screens/Home.tsx",
    "apps/web/src/index.web.ts",
  ];

  assert.deepEqual(findAndroidWebFileViolations(paths), []);
});

test("fails on a seeded .web.tsx file under apps/android", () => {
  const paths = ["apps/android/src/screens/Home.web.tsx"];

  assert.deepEqual(findAndroidWebFileViolations(paths), ["apps/android/src/screens/Home.web.tsx"]);
});

test("fails on a seeded .web.ts and .web.js file under apps/android", () => {
  const paths = ["apps/android/src/lib/platform.web.ts", "apps/android/src/lib/legacy.web.js"];

  assert.deepEqual(findAndroidWebFileViolations(paths), [
    "apps/android/src/lib/platform.web.ts",
    "apps/android/src/lib/legacy.web.js",
  ]);
});

test("does not flag apps/web .web.* files (only apps/android is guarded)", () => {
  const paths = ["apps/web/src/index.web.ts"];

  assert.deepEqual(findAndroidWebFileViolations(paths), []);
});

test("does not flag a directory or filename that merely contains 'web' without the .web. marker", () => {
  const paths = ["apps/android/src/screens/WebViewScreen.tsx", "apps/android/webview/index.ts"];

  assert.deepEqual(findAndroidWebFileViolations(paths), []);
});
