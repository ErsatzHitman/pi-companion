// T17A: CI guard — nothing from Paseo's `packages/app` tree may ever enter
// this repository (plan.md invariant, §15.4), and no source file may
// reference the legacy `@getpaseo/*` package scope or a `packages/app` path
// once this repository has been renamed to `@picompanion/*` (T01-T04).
//
// Pure, dependency-free check functions only. `run-guard-no-legacy-app-tree.mjs`
// is the CLI entry point CI actually runs; this module stays import-safe so
// `guard-no-legacy-app-tree.test.mjs` can seed violations without touching
// the real working tree.

import { extname } from "node:path";

/** Extensions scanned for legacy string references. Binary/lockfile/asset
 * formats are excluded; markdown/docs are excluded separately (allowlisted
 * below) because provenance docs legitimately name the reference tree. */
export const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
]);

/** Files allowed to mention the legacy scope/path as guard fixtures or in
 * this guard's own implementation. Provenance prose lives in `.md` files,
 * which are never scanned (see SCANNED_EXTENSIONS). */
export const ALLOWLISTED_PATHS = new Set([
  "scripts/ci/guard-no-legacy-app-tree.mjs",
  "scripts/ci/guard-no-legacy-app-tree.test.mjs",
]);

// Matches only import/require/dynamic-import specifiers, e.g.
// `from "@getpaseo/client"`, `require("packages/app/src/...")`,
// `import("@getpaseo/app")`. Deliberately narrower than a bare substring
// search: fixture/test data that happens to contain the literal string
// "packages/app" (e.g. a sample PR diff path or workspace directory in a
// protocol test) is not a legacy import and must not trip this guard.
const LEGACY_IMPORT_PATTERN =
  /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|^\s*import\s+)["'`][^"'`]*(?:@getpaseo\/|packages\/app\/)[^"'`]*["'`]/m;

/**
 * @param {string[]} paths repo-relative, forward-slash tracked file paths
 * @returns {string[]} paths that live under `packages/app`
 */
export function findPackagesAppPathViolations(paths) {
  return paths.filter((path) => path === "packages/app" || path.startsWith("packages/app/"));
}

/**
 * @param {{ path: string, content: string }[]} files
 * @returns {{ path: string, pattern: string }[]}
 */
export function findLegacyReferenceViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    if (ALLOWLISTED_PATHS.has(path)) continue;
    if (!SCANNED_EXTENSIONS.has(extname(path))) continue;
    const match = LEGACY_IMPORT_PATTERN.exec(content);
    if (match) {
      const pattern = match[0].includes("@getpaseo/") ? "@getpaseo/" : "packages/app";
      violations.push({ path, pattern });
    }
  }
  return violations;
}

/**
 * @param {string[]} paths tracked repo-relative paths
 * @param {{ path: string, content: string }[]} files subset of `paths` with content loaded
 * @returns {{ pathViolations: string[], referenceViolations: { path: string, pattern: string }[] }}
 */
export function findViolations(paths, files) {
  return {
    pathViolations: findPackagesAppPathViolations(paths),
    referenceViolations: findLegacyReferenceViolations(files),
  };
}
