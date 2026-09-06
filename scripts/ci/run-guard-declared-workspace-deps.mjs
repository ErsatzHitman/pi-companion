#!/usr/bin/env node
// CLI entry point for the declared-workspace-dependency guard. Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-declared-workspace-deps.mjs`).
// See scripts/ci/guard-declared-workspace-deps.mjs for the checked rule and
// its type-only-import decision.
//
// Walks `apps/android/src` and `apps/web/src`, collects every `@picompanion/*`
// specifier each app's source actually imports as a VALUE (not type-only),
// and fails when that package is not declared in the app's own
// `package.json` (`dependencies`, or `devDependencies` from a test file —
// see guard-declared-workspace-deps.mjs's TEST_FILE_PATTERN).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { findUndeclaredWorkspaceDeps } from "./guard-declared-workspace-deps.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const APPS = [
  {
    name: "apps/android",
    packageName: "@picompanion/android",
    srcDir: "apps/android/src",
    manifestPath: "apps/android/package.json",
  },
  {
    name: "apps/web",
    packageName: "@picompanion/web",
    srcDir: "apps/web/src",
    manifestPath: "apps/web/package.json",
  },
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORE_DIR_NAMES = new Set(["node_modules", "dist", ".expo", "android", "ios"]);

/** @returns {string[]} absolute paths of every file under `dir` */
function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...walk(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/** Maps every workspace package's name to its own `package.json` `version`,
 * so the audit report can name the exact line and install command each
 * undeclared dependency needs. */
function readWorkspacePackageVersions() {
  const versions = new Map();
  let entries;
  try {
    entries = readdirSync(join(repoRoot, "packages"));
  } catch {
    return versions;
  }
  for (const entry of entries) {
    const manifestPath = join(repoRoot, "packages", entry, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name) versions.set(manifest.name, manifest.version);
    } catch {
      // Not a package directory (or no package.json) — skip.
    }
  }
  return versions;
}

function readSourceFiles(absoluteSrcDir, repoRelativeSrcDir) {
  let absolutePaths;
  try {
    absolutePaths = walk(absoluteSrcDir);
  } catch {
    return [];
  }
  return absolutePaths
    .map((absolutePath) => ({
      absolutePath,
      path: `${repoRelativeSrcDir}/${relative(absoluteSrcDir, absolutePath).split("\\").join("/")}`,
    }))
    .filter(({ path }) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))))
    .map(({ absolutePath, path }) => ({ path, content: readFileSync(absolutePath, "utf8") }));
}

function main() {
  const workspaceVersions = readWorkspacePackageVersions();
  let anyViolations = false;

  for (const app of APPS) {
    const files = readSourceFiles(join(repoRoot, app.srcDir), app.srcDir);
    const manifest = JSON.parse(readFileSync(join(repoRoot, app.manifestPath), "utf8"));
    const violations = findUndeclaredWorkspaceDeps(files, manifest);

    if (violations.length === 0) {
      console.log(
        `guard-declared-workspace-deps: OK — ${app.name} declares every workspace package its source imports as a value (${files.length} files scanned).`,
      );
      continue;
    }

    anyViolations = true;
    const byPackage = new Map();
    for (const { path, packageName } of violations) {
      if (!byPackage.has(packageName)) byPackage.set(packageName, []);
      byPackage.get(packageName).push(path);
    }

    console.error(`guard-declared-workspace-deps: FAILED for ${app.name}`);
    for (const [packageName, paths] of byPackage) {
      const version = workspaceVersions.get(packageName) ?? "<unknown version>";
      console.error(`  ${packageName} is imported but not declared in ${app.manifestPath}:`);
      for (const path of paths) {
        console.error(`    imported by: ${path}`);
      }
      console.error(`    add to "dependencies" in ${app.manifestPath}:`);
      console.error(`      "${packageName}": "${version}",`);
      console.error(
        `    then run: npm install ${packageName}@${version} --workspace=${app.packageName} --save-exact`,
      );
    }
  }

  if (anyViolations) process.exitCode = 1;
}

main();
