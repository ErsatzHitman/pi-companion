#!/usr/bin/env node
// CLI entry point for the duplicate-permission-state guard. Run from the
// repository root (CI runs it via
// `node scripts/ci/run-guard-no-duplicate-permission-state.mjs`).
// See scripts/ci/guard-no-duplicate-permission-state.mjs for the checked
// rule and why only `apps/android/src/features/composer/permission-recovery.ts`
// is exempt.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { findDuplicatePermissionStateUnions } from "./guard-no-duplicate-permission-state.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = "apps/android/src";
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

function readSourceFiles() {
  const absoluteSrcDir = join(repoRoot, SRC_DIR);
  let absolutePaths;
  try {
    absolutePaths = walk(absoluteSrcDir);
  } catch {
    return [];
  }
  return absolutePaths
    .map((absolutePath) => ({
      absolutePath,
      path: `${SRC_DIR}/${relative(absoluteSrcDir, absolutePath).split("\\").join("/")}`,
    }))
    .filter(({ path }) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))))
    .map(({ absolutePath, path }) => ({ path, content: readFileSync(absolutePath, "utf8") }));
}

function main() {
  const files = readSourceFiles();
  const violations = findDuplicatePermissionStateUnions(files);

  if (violations.length === 0) {
    console.log(
      `guard-no-duplicate-permission-state: OK — apps/android/src redeclares the permission-state vocabulary only in features/composer/permission-recovery.ts (${files.length} files scanned).`,
    );
    return;
  }

  console.error("guard-no-duplicate-permission-state: FAILED");
  for (const { path, typeName } of violations) {
    console.error(
      `  ${path} declares \`type ${typeName}\`, a second permission-state union — it either contains "denied-permanently" or its members are all drawn from PermissionState's five literals`,
    );
  }
  console.error(
    "  Unify onto features/composer/permission-recovery.ts's PermissionState/PermissionKind instead of declaring a new one — see that file's header comment.",
  );
  process.exitCode = 1;
}

main();
