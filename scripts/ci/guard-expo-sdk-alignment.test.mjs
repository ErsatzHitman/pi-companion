import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ANDROID_NEVER_LOADS,
  APP_WORKSPACE,
  extractAppPinnedModules,
  findExpoSdkAlignmentViolations,
  parseVersion,
  satisfiesBundledRange,
  visibleInstalls,
} from "./guard-expo-sdk-alignment.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// A subset of expo@54.0.37's real bundledNativeModules.json — the entries the
// fixtures below exercise, with their real SDK-54 ranges.
const SDK_54_BUNDLED = {
  "expo-asset": "~12.0.13",
  "expo-audio": "~1.1.1",
  "expo-constants": "~18.0.14",
  "expo-font": "~14.0.12",
  "expo-modules-core": "~3.0.30",
  "expo-secure-store": "~15.0.8",
  react: "19.1.0",
  "react-dom": "19.1.0",
  "react-native": "0.81.5",
  "react-native-worklets": "0.5.1",
};

const APP_EXPO_RANGE = "^54.0.18";
const PINNED = ["react", "react-native"];

// The lockfile shape at 5aab232, the commit whose dispatch (run 34433407469)
// died on `expo-asset@57.0.15`: the app's own `expo@54` nested under
// apps/android, an SDK-57 `expo` at the root, `expo-asset@57` at the root,
// and the correct `expo-asset@12` two levels deep where nothing can see it.
const LOCK_AT_5AAB232 = {
  "node_modules/expo": { version: "57.0.18" },
  "node_modules/expo-asset": { version: "57.0.15" },
  "node_modules/expo-constants": { version: "57.0.16" },
  "node_modules/expo-font": { version: "57.0.2" },
  "node_modules/expo-modules-core": { version: "2.5.0" },
  "node_modules/expo-audio": { version: "1.1.1" },
  "node_modules/react": { version: "19.2.8" },
  "node_modules/react-dom": { version: "19.2.8" },
  "node_modules/react-native": { version: "0.81.5" },
  "node_modules/react-native-worklets": { version: "0.8.3" },
  "apps/android/node_modules/expo": { version: "54.0.37" },
  "apps/android/node_modules/expo-constants": { version: "18.0.14" },
  "apps/android/node_modules/expo-font": { version: "14.0.12" },
  "apps/android/node_modules/expo-modules-core": { version: "3.0.30" },
  "apps/android/node_modules/expo-secure-store": { version: "15.0.8" },
  "apps/android/node_modules/react": { version: "19.1.0" },
  "apps/android/node_modules/expo/node_modules/expo-asset": { version: "12.0.13" },
  "node_modules/@picompanion/android": { resolved: "apps/android", link: true },
};

// A clean shape: one SDK, every visible copy inside it, the web app's
// `react`/`react-dom` at the root beside the app's own `react`. (The real
// tree after T326 hoists even more to the root — only `react` stays nested —
// but a few app-local copies are kept here so the shadowing cases below have
// something to shadow.)
const LOCK_AFTER_FIX = {
  "node_modules/expo": { version: "54.0.37" },
  "node_modules/expo-font": { version: "14.0.12" },
  "node_modules/expo-modules-core": { version: "3.0.30" },
  "node_modules/expo-audio": { version: "1.1.1" },
  "node_modules/react": { version: "19.2.8" },
  "node_modules/react-dom": { version: "19.2.8" },
  "node_modules/react-native": { version: "0.81.5" },
  "node_modules/react-native-worklets": { version: "0.5.1" },
  "apps/android/node_modules/expo-asset": { version: "12.0.13" },
  "apps/android/node_modules/expo-constants": { version: "18.0.14" },
  "apps/android/node_modules/expo-secure-store": { version: "15.0.8" },
  "apps/android/node_modules/react": { version: "19.1.0" },
  "node_modules/expo/node_modules/expo-asset": { version: "12.0.13" },
  "node_modules/@picompanion/android": { resolved: "apps/android", link: true },
};

const check = (lockPackages, overrides = {}) =>
  findExpoSdkAlignmentViolations({
    lockPackages,
    bundledNativeModules: SDK_54_BUNDLED,
    appExpoRange: APP_EXPO_RANGE,
    appPinnedModules: PINNED,
    ...overrides,
  });

const kindsByLocation = (violations) =>
  Object.fromEntries(violations.map((v) => [`${v.package}@${v.location}`, v.kind]));

test("the exact 5aab232 shape is reported, naming every foreign-SDK copy the app can see", () => {
  const violations = check(LOCK_AT_5AAB232);

  assert.deepEqual(kindsByLocation(violations), {
    // The SDK-57 `expo` shadowing the app's own is T307's two-runtimes shape
    // and gets no pin exemption.
    "expo@node_modules/expo": "expo-outside-declared-range",
    // The crash T325 could not get past: no app-local copy, so the root one
    // is what autolinking compiled in.
    "expo-asset@node_modules/expo-asset": "sdk-mismatch",
    // Correct app-local copies shadowing wrong root ones — still live for
    // every root-hoisted dependent, and none of these is Metro-pinned.
    "expo-constants@node_modules/expo-constants": "shadowed-root-copy",
    "expo-font@node_modules/expo-font": "shadowed-root-copy",
    "expo-modules-core@node_modules/expo-modules-core": "shadowed-root-copy",
    // What the guard's first real run found beyond the emulator's reach.
    "react-native-worklets@node_modules/react-native-worklets": "sdk-mismatch",
  });

  // The crashing module is reported with the version that crashed and the
  // range the SDK actually wanted, so the fix is readable from the failure.
  const asset = violations.find((v) => v.package === "expo-asset");
  assert.equal(asset.version, "57.0.15");
  assert.equal(asset.expected, "~12.0.13");
  assert.match(asset.reason, /expo-asset@57\.0\.15.*not in the SDK's "~12\.0\.13"/);
});

test("the post-fix shape is clean", () => {
  assert.deepEqual(check(LOCK_AFTER_FIX), []);
});

test("a correct app-local copy does not excuse a wrong root copy — it is a shadowed-root-copy", () => {
  // Metro walks UP from a root-hoisted dependent and finds the root copy.
  const violations = check({
    ...LOCK_AFTER_FIX,
    "node_modules/expo-asset": { version: "57.0.15" },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "shadowed-root-copy");
  assert.equal(violations[0].location, "node_modules/expo-asset");
  assert.match(
    violations[0].reason,
    /apps\/android\/node_modules\/expo-asset \(12\.0\.13\) is correct/,
  );
  assert.match(violations[0].reason, /APP_PINNED_MODULES/);
});

test("a Metro pin to the app copy is the only exemption for a shadowed root copy", () => {
  // `react` is exactly this case in the real tree: root 19.2.8 for apps/web,
  // app-local 19.1.0, and metro.config.js forcing every importer to the
  // app copy. Remove the pin and the same tree is a violation.
  assert.deepEqual(check(LOCK_AFTER_FIX), []);

  const unpinned = check(LOCK_AFTER_FIX, { appPinnedModules: ["react-native"] });
  assert.equal(unpinned.length, 1);
  assert.equal(unpinned[0].package, "react");
  assert.equal(unpinned[0].kind, "shadowed-root-copy");
  assert.equal(unpinned[0].location, "node_modules/react");
});

test("a pin never excuses the copy the app actually RESOLVES", () => {
  // Pinning `react` says "use the app copy"; if the app copy itself is the
  // wrong one, the pin makes it worse, not exempt.
  const violations = check({
    ...LOCK_AFTER_FIX,
    "apps/android/node_modules/react": { version: "19.2.8" },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "sdk-mismatch");
  assert.equal(violations[0].location, "apps/android/node_modules/react");
});

test("ANDROID_NEVER_LOADS skips react-dom, and only react-dom", () => {
  assert.deepEqual(Object.keys(ANDROID_NEVER_LOADS), ["react-dom"]);
  // LOCK_AFTER_FIX carries root react-dom@19.2.8 against the SDK's 19.1.0
  // and is clean above; drop the exemption and it is a sdk-mismatch.
  const withoutExemption = findExpoSdkAlignmentViolations({
    lockPackages: LOCK_AFTER_FIX,
    bundledNativeModules: { "react-dom": "19.1.0" },
    appExpoRange: APP_EXPO_RANGE,
    appPinnedModules: PINNED,
  });
  assert.deepEqual(withoutExemption, []);
});

test("a stale ANDROID_NEVER_LOADS entry is reported, in both ways it can go stale", () => {
  // No longer in bundledNativeModules.json:
  const notBundled = findExpoSdkAlignmentViolations({
    lockPackages: LOCK_AFTER_FIX,
    bundledNativeModules: { ...SDK_54_BUNDLED, "react-dom": undefined },
    appExpoRange: APP_EXPO_RANGE,
    appPinnedModules: PINNED,
  }).filter((v) => v.kind === "stale-allowlist-entry");
  // (`undefined` still leaves the key present; delete it properly.)
  const bundledWithout = { ...SDK_54_BUNDLED };
  delete bundledWithout["react-dom"];
  const notBundledForReal = findExpoSdkAlignmentViolations({
    lockPackages: LOCK_AFTER_FIX,
    bundledNativeModules: bundledWithout,
    appExpoRange: APP_EXPO_RANGE,
    appPinnedModules: PINNED,
  }).filter((v) => v.kind === "stale-allowlist-entry");
  assert.equal(notBundled.length, 0);
  assert.equal(notBundledForReal.length, 1);
  assert.match(notBundledForReal[0].reason, /no longer named by bundledNativeModules\.json/);

  // Still bundled, but not installed anywhere the app can see:
  const lockWithout = { ...LOCK_AFTER_FIX };
  delete lockWithout["node_modules/react-dom"];
  const notInstalled = check(lockWithout).filter((v) => v.kind === "stale-allowlist-entry");
  assert.equal(notInstalled.length, 1);
  assert.match(notInstalled[0].reason, /no longer installed anywhere apps\/android could see/);
});

test("a bundled package that is simply not installed is not a violation", () => {
  assert.deepEqual(
    check(LOCK_AFTER_FIX, {
      bundledNativeModules: { ...SDK_54_BUNDLED, "expo-camera": "~17.0.8" },
    }),
    [],
  );
});

test("a copy nested deeper than the app can see is ignored, in both directions", () => {
  // Right version nested under the wrong one was the 5aab232 shape for
  // expo-asset; the nested copy neither helps nor is itself reported.
  assert.deepEqual(
    check({
      ...LOCK_AFTER_FIX,
      "node_modules/expo-audio/node_modules/expo-asset": { version: "57.0.15" },
    }),
    [],
  );
});

test("no visible expo at all is its own failure, not a vacuous pass", () => {
  const lockPackages = { ...LOCK_AFTER_FIX };
  delete lockPackages["node_modules/expo"];
  const violations = check(lockPackages);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "expo-not-installed");
});

test("a range shape the matcher does not understand is reported, never skipped", () => {
  const violations = check(LOCK_AFTER_FIX, {
    bundledNativeModules: { ...SDK_54_BUNDLED, "expo-font": ">=14.0.0 <15.0.0" },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "unrecognised-range");
  assert.equal(violations[0].package, "expo-font");
});

test("workspace links are not installs", () => {
  assert.deepEqual(visibleInstalls(LOCK_AFTER_FIX, APP_WORKSPACE, "@picompanion/android"), []);
});

test("extractAppPinnedModules reads the array literal and returns null when it is absent", () => {
  assert.deepEqual(
    extractAppPinnedModules(
      `const x = 1;\nconst APP_PINNED_MODULES = ["react", 'react-native'];\n`,
    ),
    ["react", "react-native"],
  );
  assert.deepEqual(
    extractAppPinnedModules(`const APP_PINNED_MODULES = [\n  "react",\n  "react-native",\n];`),
    ["react", "react-native"],
  );
  assert.deepEqual(extractAppPinnedModules(`const APP_PINNED_MODULES = [];`), []);
  assert.equal(extractAppPinnedModules(`const PINNED = ["react"];`), null);
});

test("satisfiesBundledRange: the three shapes bundledNativeModules.json actually uses", () => {
  // tilde: same major.minor, patch at or above the floor
  assert.equal(satisfiesBundledRange("12.0.13", "~12.0.13"), true);
  assert.equal(satisfiesBundledRange("12.0.20", "~12.0.13"), true);
  assert.equal(satisfiesBundledRange("12.0.12", "~12.0.13"), false);
  assert.equal(satisfiesBundledRange("12.1.0", "~12.0.13"), false);
  assert.equal(satisfiesBundledRange("57.0.15", "~12.0.13"), false);
  // caret: same major, at or above the floor; 0.x locks the minor
  assert.equal(satisfiesBundledRange("54.0.37", "^54.0.18"), true);
  assert.equal(satisfiesBundledRange("54.1.0", "^54.0.18"), true);
  assert.equal(satisfiesBundledRange("54.0.17", "^54.0.18"), false);
  assert.equal(satisfiesBundledRange("57.0.18", "^54.0.18"), false);
  assert.equal(satisfiesBundledRange("0.20.3", "^0.20.0"), true);
  assert.equal(satisfiesBundledRange("0.21.0", "^0.20.0"), false);
  // exact
  assert.equal(satisfiesBundledRange("13.15.0", "13.15.0"), true);
  assert.equal(satisfiesBundledRange("13.16.1", "13.15.0"), false);
  assert.equal(satisfiesBundledRange("0.8.3", "0.5.1"), false);
  // prerelease of the floor sorts below it
  assert.equal(satisfiesBundledRange("12.0.13-canary.1", "~12.0.13"), false);
  // unknown shapes and unparseable versions are `null`, not a verdict
  assert.equal(satisfiesBundledRange("1.0.0", "*"), null);
  assert.equal(satisfiesBundledRange("1.0.0", ">=1.0.0"), null);
  assert.equal(satisfiesBundledRange("git+https://x", "~1.0.0"), null);
  assert.equal(parseVersion("not-a-version"), null);
});

test("the real metro.config.js declares APP_PINNED_MODULES, and it names react and react-native", () => {
  const source = readFileSync(join(repoRoot, APP_WORKSPACE, "metro.config.js"), "utf8");
  const pinned = extractAppPinnedModules(source);
  assert.notEqual(pinned, null);
  assert.ok(
    pinned.includes("react"),
    "react must stay pinned: apps/web's root react is a different version",
  );
  assert.ok(pinned.includes("react-native"));
});

test("the real lockfile is clean against the real installed expo's bundledNativeModules.json", (t) => {
  const lockPackages = JSON.parse(
    readFileSync(join(repoRoot, "package-lock.json"), "utf8"),
  ).packages;
  const appExpoRange = JSON.parse(
    readFileSync(join(repoRoot, APP_WORKSPACE, "package.json"), "utf8"),
  ).dependencies.expo;
  const appPinnedModules = extractAppPinnedModules(
    readFileSync(join(repoRoot, APP_WORKSPACE, "metro.config.js"), "utf8"),
  );

  let bundledNativeModules;
  try {
    const appRequire = createRequire(join(repoRoot, APP_WORKSPACE, "package.json"));
    bundledNativeModules = JSON.parse(
      readFileSync(appRequire.resolve("expo/bundledNativeModules.json"), "utf8"),
    );
  } catch {
    // The `changes` job runs this suite before any `npm ci`; the
    // `guard-expo-sdk-alignment` job is the hard gate for the real tree.
    t.skip("expo is not installed under apps/android; run npm ci to check the real tree");
    return;
  }

  // Every range in the real file is one of the three shapes the matcher
  // handles — if Expo ever adds a fourth, this is where it shows up first.
  for (const [name, range] of Object.entries(bundledNativeModules)) {
    assert.notEqual(
      satisfiesBundledRange("0.0.0", range),
      null,
      `bundledNativeModules.json's range for ${name} ("${range}") is a shape satisfiesBundledRange does not understand`,
    );
  }

  assert.deepEqual(
    findExpoSdkAlignmentViolations({
      lockPackages,
      bundledNativeModules,
      appExpoRange,
      appPinnedModules,
    }),
    [],
  );
});
