// T316: CI guard — every LOCAL Expo module under `apps/android/modules/*`
// must establish an Android `compileSdk`, or the Android Gradle Plugin
// rejects it and fails the configuration phase of the WHOLE app, not just
// that module.
//
// The defect this exists for: `apps/android/modules/share-intent/android/
// build.gradle` applied `expo-modules-core`'s shared Gradle plugin and
// called `applyKotlinExpoModulesCorePlugin()`, which configures Kotlin —
// but never called `useDefaultAndroidSdkVersions()`, which is the helper
// in that same file that actually sets `compileSdkVersion`,
// `minSdkVersion` and `targetSdkVersion`. The build died with:
//
//   A problem occurred evaluating project ':react-native-reanimated'.
//   > Failed to apply plugin 'com.facebook.react'.
//      > A problem occurred configuring project ':share-intent'.
//         > Android Gradle Plugin: project ':share-intent' does not
//           specify `compileSdk` in build.gradle
//
// Note where that surfaced: while configuring a THIRD-PARTY project, with
// this repository's own module named only on the third line. A future
// reader hitting this again should not have to work back from
// `react-native-reanimated` to a file they own.
//
// ## Why a static guard rather than "the build would catch it"
//
// Nothing in this repository had ever run Gradle against the Android
// project when this shipped. `ci.yml`'s `android-tests` runs `expo
// prebuild --platform android --no-install`, which GENERATES the native
// project and stops — it never configures or assembles it. EAS never
// reached the assemble step either: it failed earlier, at `Bundle
// JavaScript` (T314). So the module sat unbuildable from the day it was
// written, with every gate green, and only the first runner-local Gradle
// assemble (T315) surfaced it.
//
// A real `./gradlew assembleRelease` is the authoritative check and now
// runs in `android-maestro-e2e.yml`'s `build-development-apk` job. This
// guard is the fast, static companion: it fails in milliseconds, names
// the module and the specific missing call, and — unlike the real build —
// costs nothing to run on every push.
//
// ## What counts as "establishes compileSdk"
//
// Three recognised mechanisms, measured against this app's real installed
// Expo version (`expo-modules-core@…/android/ExpoModulesCorePlugin.gradle`
// and `expo-constants`' own `build.gradle`) rather than assumed:
//
//   1. `useDefaultAndroidSdkVersions()` — the helper
//      `ExpoModulesCorePlugin.gradle` exposes alongside
//      `applyKotlinExpoModulesCorePlugin`. What `share-intent` uses.
//   2. The `expo-module-gradle-plugin` Gradle plugin, which sets the same
//      values for modules shipped inside Expo packages (`expo-constants`
//      uses this form). A local module may migrate to it.
//   3. An explicit `compileSdk`/`compileSdkVersion` assignment in the
//      module's own `android { }` block — allowed, though it pins a
//      second copy of a version the rest of the project already agrees
//      on.
//
// Applying `ExpoModulesCorePlugin.gradle` alone is deliberately NOT
// enough, because that is exactly what the broken module did.
//
// Pure, dependency-free check functions only; `run-guard-local-expo-
// module-sdk.mjs` is the CLI entry point.

const COMPILE_SDK_MECHANISMS = [
  {
    id: "useDefaultAndroidSdkVersions",
    pattern: /\buseDefaultAndroidSdkVersions\s*\(/,
    description: "calls useDefaultAndroidSdkVersions() from ExpoModulesCorePlugin.gradle",
  },
  {
    id: "expo-module-gradle-plugin",
    pattern:
      /\bid\s+["']expo-module-gradle-plugin["']|\bapply\s+plugin:\s*["']expo-module-gradle-plugin["']/,
    description: "applies the expo-module-gradle-plugin Gradle plugin",
  },
  {
    id: "explicit-compile-sdk",
    pattern: /\bcompileSdk(?:Version)?\s*[= ]/,
    description: "sets compileSdk / compileSdkVersion explicitly",
  },
];

/**
 * Strips `//` line comments and `/* *\/` block comments, so a module whose
 * COMMENT merely discusses `useDefaultAndroidSdkVersions` — this guard's
 * own subject file does, at length — cannot satisfy the check without
 * actually calling it. The same trap `guard-capability-prose.mjs` and T305
 * each had to close.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripGradleComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * @typedef {{ path: string, reason: string }} LocalExpoModuleSdkViolation
 */

/**
 * @param {{ path: string, content: string }[]} buildGradleFiles every
 *   tracked `apps/android/modules/<name>/android/build.gradle`
 * @returns {LocalExpoModuleSdkViolation[]}
 */
export function findLocalExpoModuleSdkViolations(buildGradleFiles) {
  const violations = [];

  for (const file of buildGradleFiles) {
    const source = stripGradleComments(file.content);
    const satisfied = COMPILE_SDK_MECHANISMS.some((mechanism) => mechanism.pattern.test(source));
    if (satisfied) continue;

    violations.push({
      path: file.path,
      reason:
        "establishes no Android compileSdk. Use one of: " +
        COMPILE_SDK_MECHANISMS.map((mechanism) => mechanism.description).join("; ") +
        ".",
    });
  }

  return violations;
}

/**
 * The paths this guard checks, so the runner and its test agree on scope
 * rather than each spelling the glob out.
 *
 * @param {string[]} trackedPaths output of `git ls-files`
 * @returns {string[]}
 */
export function selectLocalExpoModuleBuildFiles(trackedPaths) {
  return trackedPaths.filter((path) =>
    /^apps\/android\/modules\/[^/]+\/android\/build\.gradle$/.test(path),
  );
}
