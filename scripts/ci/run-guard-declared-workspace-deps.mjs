#!/usr/bin/env node
// CLI entry point for the declared-workspace-dependency guard. Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-declared-workspace-deps.mjs`).
// See scripts/ci/guard-declared-workspace-deps.mjs for the checked rule, its
// type-only-import decision, and (T251) `withSelfDeclared`'s self-import
// allowance.
//
// Walks `apps/android/src`, `apps/web/src`, and (T251) every `packages/*/src`
// that has both a `package.json` and a `src` directory, collects every
// `@picompanion/*` specifier each target's source actually imports as a
// VALUE (not type-only), and fails when that package is not declared in the
// target's OWN `package.json` (`dependencies`, or `devDependencies` from a
// test file — see guard-declared-workspace-deps.mjs's TEST_FILE_PATTERN).
// Each target is checked against its own manifest, never the root's — some
// packages legitimately import declared siblings (`server` -> `protocol`).
//
// T251 measured admitting every `packages/*/src` at once (not just
// `packages/relay`, the one T230 named) before choosing this scope: with
// `withSelfDeclared` applied, all ten `packages/*` with a `src` directory
// come back clean on this tree. Without it, two packages
// (`@picompanion/highlight`, `@picompanion/protocol`) each flagged exactly
// one "undeclared" package — their OWN name, reached via a self-referencing
// subpath import (`@picompanion/protocol`'s `"./*"` `exports` wildcard makes
// this resolvable) — never a real missing dependency. See this task's
// report for the full per-package table.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { findUndeclaredWorkspaceDeps, withSelfDeclared } from "./guard-declared-workspace-deps.mjs";

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

/**
 * T251: every `packages/<dir>` that has its own `package.json` (with a
 * `name`) and a `src` directory becomes a scan target, discovered fresh on
 * every run rather than hand-listed — the same reason `apps/*` above is the
 * one hand-listed pair left (there are only two, and a third app is a
 * structural change this guard's own scope does not anticipate).
 * @returns {{ name: string, packageName: string, srcDir: string, manifestPath: string }[]}
 */
function discoverPackageTargets() {
  const targets = [];
  let entries;
  try {
    entries = readdirSync(join(repoRoot, "packages"));
  } catch {
    return targets;
  }
  for (const entry of entries.sort()) {
    const manifestPath = join(repoRoot, "packages", entry, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue; // not a package directory (or no package.json) — skip.
    }
    if (!manifest.name) continue;
    try {
      if (!statSync(join(repoRoot, "packages", entry, "src")).isDirectory()) continue;
    } catch {
      continue; // no `src` directory to scan.
    }
    targets.push({
      name: `packages/${entry}`,
      packageName: manifest.name,
      srcDir: `packages/${entry}/src`,
      manifestPath: `packages/${entry}/package.json`,
    });
  }
  return targets;
}

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
  const targets = [...APPS, ...discoverPackageTargets()];
  let anyViolations = false;

  for (const app of targets) {
    const files = readSourceFiles(join(repoRoot, app.srcDir), app.srcDir);
    const manifest = withSelfDeclared(
      JSON.parse(readFileSync(join(repoRoot, app.manifestPath), "utf8")),
    );
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
