// T17A: CI guard — `apps/android` is Android-only (plan.md invariant, §15.4)
// and must contain no `.web.*` files (React Native web-target overrides) and
// no web target of any kind.
//
// Pure, dependency-free check function only. `run-guard-no-android-web-files.mjs`
// is the CLI entry point CI actually runs; this module stays import-safe so
// `guard-no-android-web-files.test.mjs` can seed violations without touching
// the real working tree.

const ANDROID_PREFIX = "apps/android/";
const WEB_FILE_PATTERN = /\.web\.[^/.]+$/;

/**
 * @param {string[]} paths repo-relative, forward-slash tracked file paths
 * @returns {string[]} paths under apps/android matching `*.web.*`
 */
export function findAndroidWebFileViolations(paths) {
  return paths.filter((path) => path.startsWith(ANDROID_PREFIX) && WEB_FILE_PATTERN.test(path));
}
