#!/usr/bin/env node
// CLI entry point for the apps/web node:-builtin-reachability guard. Run
// from the repository root (CI runs it via
// `node scripts/ci/run-guard-no-node-builtin-in-web-bundle.mjs`). See
// scripts/ci/guard-no-node-builtin-in-web-bundle.mjs for the checked rule.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { findNodeBuiltinViolations } from "./guard-no-node-builtin-in-web-bundle.mjs";

const WEB_SRC_PREFIX = "apps/web/src/";
const ENTRY_PATH = "apps/web/src/main.tsx";

// Content is read for every tracked file under apps/web/src, not only
// parseable ones — a relative specifier can legitimately resolve to a
// `.css` font stylesheet or a `.woff2` file (existence, not parseability,
// is what resolution needs), and the guard itself skips parsing anything
// whose extension is not in its own PARSEABLE_EXTENSIONS set. Binary
// extensions (`.woff2`) are read as empty placeholders: this guard's
// resolver only ever needs to confirm such a path *exists*, never its
// bytes, and reading real binary content as utf8 would produce
// mojibake that the parser must never scan.
const BINARY_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".png", ".jpg", ".jpeg", ".gif"]);

function listTrackedWebSrcFiles() {
  const output = execFileSync("git", ["ls-files", "apps/web/src"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function buildFileMap(paths) {
  const files = new Map();
  for (const path of paths) {
    if (!path.startsWith(WEB_SRC_PREFIX)) continue;
    const content = BINARY_EXTENSIONS.has(extname(path)) ? "" : readFileSync(path, "utf8");
    files.set(path, content);
  }
  return files;
}

function main() {
  const paths = listTrackedWebSrcFiles();
  const files = buildFileMap(paths);

  if (!files.has(ENTRY_PATH)) {
    console.error(
      `guard-no-node-builtin-in-web-bundle: FAILED — production entry ${ENTRY_PATH} not found ` +
        "among tracked files; this guard cannot walk a graph with no root.",
    );
    process.exitCode = 1;
    return;
  }

  const violations = findNodeBuiltinViolations(files, ENTRY_PATH);

  if (violations.length === 0) {
    console.log(
      "guard-no-node-builtin-in-web-bundle: OK — no node: builtin reachable from " +
        `${ENTRY_PATH} (checked both node: and bare specifier forms).`,
    );
    return;
  }

  console.error("guard-no-node-builtin-in-web-bundle: FAILED");
  for (const { path, specifier } of violations) {
    console.error(`  ${path} imports node builtin "${specifier}"`);
  }
  process.exitCode = 1;
}

main();
