// T326: CI guard — every Expo-managed package that `apps/android` can SEE must
// belong to the Expo SDK generation `apps/android`'s own `expo` belongs to.
//
// ## The defect this exists for
//
// Three Maestro dispatches in a row (runs 34420667467, 34433407469 and the
// one T325 diagnosed between them) died at native module registration with
// the same stack:
//
//   java.lang.NoClassDefFoundError: Failed resolution of:
//     Lexpo/modules/kotlin/types/AnyTypeCache;
//   at expo.modules.asset.AssetModule.definition(AssetModule.kt:125)
//
// `AnyTypeCache` is an SDK-57 `expo-modules-core` class. `expo-asset@57.0.15`
// had been installed at the repository ROOT while the app's `expo@54.0.37`
// wanted `~12.0.13` — and `expo-modules-autolinking` searches exactly two
// directories, `apps/android/node_modules` and the root `node_modules`,
// preferring the first. The correct `expo-asset@12.0.13` was installed too,
// but nested at `apps/android/node_modules/expo/node_modules/expo-asset`,
// where autolinking never looks. So the APK carried an SDK-57 Kotlin module
// compiled against an SDK-54 core, and every launch died before React
// rendered a pixel.
//
// Each of the three dispatches found ONE such package (`@expo/dom-webview`,
// then `@expo/log-box`, then `expo-asset`), because a crash at module
// registration reports only the first module that fails. Twenty minutes of
// emulator time per package, to learn a fact `package-lock.json` already
// stated. This guard reads that fact in milliseconds instead — and on its
// first real run it found two more the emulator had not reached yet
// (`react` and `react-native-worklets`, below).
//
// ## What is checked
//
// Expo publishes, inside the `expo` package itself, `bundledNativeModules.json`
// — the one authoritative map from package name to the version range that SDK
// ships with (`npx expo install` reads the same file). For every entry in it:
//
//   - the copy the app RESOLVES — `apps/android/node_modules/<name>` if it
//     exists, else the root `node_modules/<name>`; the order autolinking, Node
//     and Metro all use — must satisfy the SDK's range (`sdk-mismatch`);
//   - a root copy SHADOWED by a correct app-local one is still reported
//     (`shadowed-root-copy`), because Metro resolves a root-hoisted
//     dependent's imports by walking UP from that dependent, and finds the
//     root copy. That is how root `react-native-reanimated` would have loaded
//     root `react-native-worklets@0.8.3`'s JavaScript against the `0.5.1`
//     native side autolinked from the app — a mismatch worklets refuses at
//     startup — and how the root `react-native`'s renderer reached a
//     different `react` than this app's components. The exemption is a name
//     listed in `apps/android/metro.config.js`'s `APP_PINNED_MODULES`, whose
//     resolver forces that package to the app copy from every importer; the
//     runner reads that list from the real file, so a pin that is removed
//     un-exempts its package in the same commit;
//   - a package `apps/android` never bundles at all (`ANDROID_NEVER_LOADS`,
//     each with its reason) is skipped, and a listed name that is no longer
//     in `bundledNativeModules.json` or no longer installed is reported as
//     `stale-allowlist-entry` — the T211/T213 shape, closed here on day one;
//   - deeper nesting (`node_modules/expo/node_modules/expo-asset`) is a legal
//     npm arrangement invisible to the app, and is deliberately not checked.
//
// `expo` itself is not in that file, so it gets its own check: every visible
// `expo` must satisfy the range `apps/android/package.json` declares for it.
// That is the precondition for trusting `bundledNativeModules.json` at all —
// it is read from whichever `expo` the app resolves — and a shadowed root
// `expo` from another SDK is exactly T307's "two Expo runtimes" shape, so it
// gets no pin exemption.
//
// The source of truth is `package-lock.json`, not the installed tree, so the
// check is about what `npm ci` WILL install, not what happens to be on one
// machine. `run-guard-expo-sdk-alignment.mjs` reads `bundledNativeModules.json`
// from the real installed `expo` (that file is not in the lock) and refuses to
// run if the installed `expo` disagrees with the lock's — a stale
// `node_modules` must never produce a green result, the same standing reason
// CLAUDE.md gives for a stale `dist`.
//
// ## Why the range matcher is hand-rolled
//
// Every range in `expo@54.0.37`'s `bundledNativeModules.json` is one of three
// shapes — `~x.y.z`, `^x.y.z`, or an exact `x.y.z` — measured across all 119
// entries before this was written. Three shapes do not justify a `semver`
// import from `scripts/ci` (which T227's guard would then require the root
// manifest to declare), and this directory's convention is dependency-free
// check functions. A range shape this matcher does not recognise is reported
// as its own violation kind rather than skipped, so a future SDK that adds a
// fourth shape fails loudly instead of passing by omission.

export const APP_WORKSPACE = "apps/android";

/**
 * Packages `bundledNativeModules.json` names that `apps/android` never
 * bundles, so the copy at the root (installed for another workspace) is not
 * this app's concern. Curated and reasoned, never pattern-matched; a stale
 * entry is a violation in its own right.
 */
export const ANDROID_NEVER_LOADS = Object.freeze({
  "react-dom":
    'the DOM renderer — apps/android is Android-only by repository invariant (Metro `platforms: ["android"]`, no web imports), so no copy is ever bundled; the root copy is apps/web\'s',
});

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @param {string} text
 * @returns {{ major: number, minor: number, patch: number, prerelease: string | null } | null}
 */
export function parseVersion(text) {
  const match = VERSION_PATTERN.exec(String(text).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function atLeast(version, floor) {
  if (version.major !== floor.major) return version.major > floor.major;
  if (version.minor !== floor.minor) return version.minor > floor.minor;
  if (version.patch !== floor.patch) return version.patch > floor.patch;
  // A prerelease of the floor itself sorts below the floor.
  return version.prerelease === null || version.prerelease === floor.prerelease;
}

/**
 * Whether `version` satisfies one of the three range shapes
 * `bundledNativeModules.json` uses. Returns `null` — not `false` — for a
 * range shape it does not understand, so the caller can report it instead of
 * treating it as a pass or a mismatch.
 *
 * @param {string} versionText
 * @param {string} rangeText
 * @returns {boolean | null}
 */
export function satisfiesBundledRange(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (!version) return null;

  const range = String(rangeText).trim();
  const operator = range.startsWith("~") ? "~" : range.startsWith("^") ? "^" : "";
  const floor = parseVersion(operator ? range.slice(1) : range);
  if (!floor) return null;

  if (operator === "") {
    return (
      version.major === floor.major &&
      version.minor === floor.minor &&
      version.patch === floor.patch &&
      version.prerelease === floor.prerelease
    );
  }
  if (operator === "~") {
    return (
      version.major === floor.major && version.minor === floor.minor && atLeast(version, floor)
    );
  }
  // "^": same major, or for 0.x the same minor.
  if (floor.major === 0) {
    return version.major === 0 && version.minor === floor.minor && atLeast(version, floor);
  }
  return version.major === floor.major && atLeast(version, floor);
}

/**
 * The lockfile entries for `name` that `appPath` can see: its own
 * `node_modules` first (what wins), then the root. Workspace links and
 * entries without a version are not installs and are skipped.
 *
 * @param {Record<string, { version?: string, link?: boolean }>} lockPackages
 * @param {string} appPath
 * @param {string} name
 * @returns {{ location: string, version: string }[]}
 */
export function visibleInstalls(lockPackages, appPath, name) {
  const installs = [];
  for (const location of [`${appPath}/node_modules/${name}`, `node_modules/${name}`]) {
    const entry = lockPackages[location];
    if (!entry || entry.link || typeof entry.version !== "string") continue;
    installs.push({ location, version: entry.version });
  }
  return installs;
}

const APP_PINNED_MODULES_PATTERN = /const\s+APP_PINNED_MODULES\s*=\s*\[([^\]]*)\]/;

/**
 * The package names `apps/android/metro.config.js` forces to the app's own
 * copy from every importer — read from the file's own `APP_PINNED_MODULES`
 * array literal, so the exemption and the pin cannot drift apart. Returns
 * `null` when the array is not found, which the caller must treat as a
 * failure rather than "nothing is pinned".
 *
 * @param {string} metroConfigSource
 * @returns {string[] | null}
 */
export function extractAppPinnedModules(metroConfigSource) {
  const match = APP_PINNED_MODULES_PATTERN.exec(metroConfigSource);
  if (!match) return null;
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * @param {object} input
 * @param {Record<string, { version?: string, link?: boolean }>} input.lockPackages
 *   `package-lock.json`'s `packages` map.
 * @param {Record<string, string>} input.bundledNativeModules
 *   The app's SDK's `expo/bundledNativeModules.json`.
 * @param {string} input.appExpoRange
 *   The range `apps/android/package.json` declares for `expo`.
 * @param {string[]} [input.appPinnedModules]
 *   `apps/android/metro.config.js`'s `APP_PINNED_MODULES`.
 * @param {string} [input.appPath]
 * @returns {{ kind: string, package: string, location: string, version: string, expected: string, reason: string }[]}
 */
export function findExpoSdkAlignmentViolations({
  lockPackages,
  bundledNativeModules,
  appExpoRange,
  appPinnedModules = [],
  appPath = APP_WORKSPACE,
}) {
  const violations = [];
  const pinned = new Set(appPinnedModules);

  const expoInstalls = visibleInstalls(lockPackages, appPath, "expo");
  if (expoInstalls.length === 0) {
    violations.push({
      kind: "expo-not-installed",
      package: "expo",
      location: `${appPath}/node_modules/expo`,
      version: "(none)",
      expected: appExpoRange,
      reason: `no \`expo\` is installed where ${appPath} could resolve it, so no SDK can be checked at all`,
    });
  }
  for (const install of expoInstalls) {
    const ok = satisfiesBundledRange(install.version, appExpoRange);
    if (ok === true) continue;
    violations.push({
      kind: ok === null ? "unrecognised-range" : "expo-outside-declared-range",
      package: "expo",
      location: install.location,
      version: install.version,
      expected: appExpoRange,
      reason:
        ok === null
          ? `\`expo\` is declared as "${appExpoRange}", a range shape this guard does not understand`
          : `\`expo@${install.version}\` at ${install.location} is outside the "${appExpoRange}" ${appPath}/package.json declares`,
    });
  }

  for (const [name, reasonNeverLoaded] of Object.entries(ANDROID_NEVER_LOADS)) {
    const stale = !(name in bundledNativeModules)
      ? `is no longer named by bundledNativeModules.json`
      : visibleInstalls(lockPackages, appPath, name).length === 0
        ? `is no longer installed anywhere ${appPath} could see`
        : null;
    if (!stale) continue;
    violations.push({
      kind: "stale-allowlist-entry",
      package: name,
      location: "ANDROID_NEVER_LOADS",
      version: "(n/a)",
      expected: "(n/a)",
      reason: `ANDROID_NEVER_LOADS exempts \`${name}\` (${reasonNeverLoaded}), but it ${stale}; remove the entry`,
    });
  }

  for (const [name, range] of Object.entries(bundledNativeModules)) {
    if (name in ANDROID_NEVER_LOADS) continue;
    const installs = visibleInstalls(lockPackages, appPath, name);
    installs.forEach((install, index) => {
      const ok = satisfiesBundledRange(install.version, range);
      if (ok === true) return;
      if (ok === null) {
        violations.push({
          kind: "unrecognised-range",
          package: name,
          location: install.location,
          version: install.version,
          expected: range,
          reason: `bundledNativeModules.json gives \`${name}\` the range "${range}", a shape this guard does not understand`,
        });
        return;
      }
      if (index === 0) {
        violations.push({
          kind: "sdk-mismatch",
          package: name,
          location: install.location,
          version: install.version,
          expected: range,
          reason: `\`${name}@${install.version}\` at ${install.location} is not in the SDK's "${range}"`,
        });
        return;
      }
      if (pinned.has(name)) return;
      violations.push({
        kind: "shadowed-root-copy",
        package: name,
        location: install.location,
        version: install.version,
        expected: range,
        reason: `\`${name}@${install.version}\` at ${install.location} is not in the SDK's "${range}"; ${installs[0].location} (${installs[0].version}) is correct, but a root-hoisted dependent's import walks up to the root copy — either bring the root copy into range or pin \`${name}\` in ${appPath}/metro.config.js's APP_PINNED_MODULES`,
      });
    });
  }

  return violations;
}
