#!/usr/bin/env node
// CLI entry point for the declared-root-dependency guard. Run from the
// repository root (CI runs it via
// `node scripts/ci/run-guard-declared-root-dependencies.mjs`). See
// scripts/ci/guard-declared-root-dependencies.mjs for the checked rule, its
// production-files-only scope, and why comments (never string literals)
// are stripped before parsing.
//
// Walks `scripts/ci` for `*.mjs` files, excluding `*.test.mjs`, collects
// every third-party import specifier each file's source contains, and
// fails when that specifier's resolved package name is declared in
// neither `dependencies` nor `devDependencies` of the root `package.json`.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findUndeclaredRootDependencies } from "./guard-declared-root-dependencies.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptsCiDir = fileURLToPath(new URL(".", import.meta.url));

function readProductionFiles() {
  return readdirSync(scriptsCiDir)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .sort()
    .map((name) => ({
      path: `scripts/ci/${name}`,
      content: readFileSync(new URL(name, import.meta.url), "utf8"),
    }));
}

function main() {
  const files = readProductionFiles();
  const rootManifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const violations = findUndeclaredRootDependencies(files, rootManifest);

  if (violations.length === 0) {
    console.log(
      `guard-declared-root-dependencies: OK — every third-party import across ${files.length} scripts/ci production files is declared in the root package.json (${repoRoot}).`,
    );
    return;
  }

  console.error("guard-declared-root-dependencies: FAILED");
  const byPackage = new Map();
  for (const { path, packageName, specifier } of violations) {
    if (!byPackage.has(packageName)) byPackage.set(packageName, []);
    byPackage.get(packageName).push({ path, specifier });
  }
  for (const [packageName, sites] of byPackage) {
    console.error(`  "${packageName}" is imported but not declared in the root package.json:`);
    for (const { path, specifier } of sites) {
      console.error(`    imported by: ${path} (specifier "${specifier}")`);
    }
    console.error(`    add to "devDependencies" in the root package.json, at the version already`);
    console.error(
      `    resolved in package-lock.json, then confirm with a read-only lockfile check`,
    );
    console.error(`    (never a speculative hand-edit) that the two stay in sync.`);
  }
  process.exitCode = 1;
}

main();
