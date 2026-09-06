// T16 — Android-only build guard (plan.md §6/§9.1): `apps/android` must
// contain no `.web.*` files and no web-only imports (`react-native-web`,
// `react-dom`). Wired into `npm run build` via
// `run-guard-no-web-artifacts.mjs`.
//
// Pure, dependency-free check functions only, so
// `guard-no-web-artifacts.test.mjs` can seed violations without touching
// the real working tree. The CLI entry point that walks the filesystem is
// `run-guard-no-web-artifacts.mjs`.

const WEB_FILE_PATTERN = /\.web\.[^/\\.]+$/;

const BANNED_IMPORT_PATTERNS = [
  {
    name: "react-native-web",
    pattern: /(?:from\s+|require\(\s*)["']react-native-web(?:\/[^"']*)?["']/,
  },
  { name: "react-dom", pattern: /(?:from\s+|require\(\s*)["']react-dom(?:\/[^"']*)?["']/ },
];

/**
 * @param {string[]} paths repo-relative, forward-slash file paths under `apps/android`
 * @returns {string[]} paths matching the `*.web.*` filename pattern
 */
export function findWebFileViolations(paths) {
  return paths.filter((path) => WEB_FILE_PATTERN.test(path));
}

/**
 * @param {{ path: string, contents: string }[]} files
 * @returns {{ path: string, reason: string }[]} files importing a banned web-only module
 */
export function findWebImportViolations(files) {
  const violations = [];
  for (const file of files) {
    for (const { name, pattern } of BANNED_IMPORT_PATTERNS) {
      if (pattern.test(file.contents)) {
        violations.push({ path: file.path, reason: `imports "${name}"` });
        break;
      }
    }
  }
  return violations;
}
