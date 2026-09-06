#!/usr/bin/env node
// CLI entry point for the T16 Android-only build guard. Walks `app/` and
// `src/` under `apps/android`, plus its own root config files, and fails
// the build (non-zero exit) if it finds a `.web.*` file or a source file
// importing `react-native-web`/`react-dom`. See `guard-no-web-artifacts.mjs`
// for the pure check functions this wraps.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { findWebFileViolations, findWebImportViolations } from "./guard-no-web-artifacts.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["app", "src"];
const SCAN_ROOT_FILES = ["app.config.ts", "metro.config.js", "babel.config.js"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIR_NAMES = new Set(["node_modules", "dist", ".expo", "android", "ios"]);

/** @returns {string[]} repo-relative (to `apps/android`), forward-slash paths of every file under `dir` */
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

const absolutePaths = [
  ...SCAN_DIRS.filter((dir) => {
    try {
      return statSync(join(appRoot, dir)).isDirectory();
    } catch {
      return false;
    }
  }).flatMap((dir) => walk(join(appRoot, dir))),
  ...SCAN_ROOT_FILES.map((file) => join(appRoot, file)).filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }),
];

const relativePaths = absolutePaths.map((path) => relative(appRoot, path).split("\\").join("/"));

const fileViolations = findWebFileViolations(relativePaths);

const sourceFiles = absolutePaths
  .map((absolutePath, index) => ({ absolutePath, path: relativePaths[index] }))
  .filter(({ path }) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))))
  .map(({ absolutePath, path }) => ({ path, contents: readFileSync(absolutePath, "utf8") }));

const importViolations = findWebImportViolations(sourceFiles);

if (fileViolations.length > 0 || importViolations.length > 0) {
  console.error("apps/android is Android-only: found web artifacts.\n");
  for (const path of fileViolations) {
    console.error(`  - ${path} (".web.*" files are not allowed in apps/android)`);
  }
  for (const { path, reason } of importViolations) {
    console.error(`  - ${path} (${reason})`);
  }
  process.exit(1);
}

console.log(`apps/android: no web artifacts found in ${relativePaths.length} scanned files.`);
