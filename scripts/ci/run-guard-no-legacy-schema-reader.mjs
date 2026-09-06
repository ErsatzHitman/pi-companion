#!/usr/bin/env node
// CLI entry point for the no-legacy-schema-reader guard (T206). Run from
// the repository root (CI runs it via
// `node scripts/ci/run-guard-no-legacy-schema-reader.mjs`).
// See scripts/ci/guard-no-legacy-schema-reader.mjs for the checked
// signature and why it is drawn where it is.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { findLegacySchemaReaderViolations } from "./guard-no-legacy-schema-reader.mjs";

// Exactly the two directories `versioned-import.test.ts`'s own doc comment
// names: "no legacy schema reader ... exists anywhere under
// `apps/android/src` or `packages/frontend-core/src`". Not `apps/web/src`
// or any other `packages/*` — out of this task's stated scope, and outside
// the written prohibition this guard enforces.
const SCAN_PREFIXES = ["apps/android/src/", "packages/frontend-core/src/"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
// Test files are excluded from the scan entirely — a fixture proving the
// absence of a reader (e.g. `versioned-import.test.ts` itself, which
// constructs the §3 envelope shape as a synthetic, opaque value on
// purpose) must never be mistaken for the reader it is disproving.
const TEST_SUFFIXES = [".test.ts", ".test.tsx"];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function hasScannedExtension(path) {
  return SCAN_EXTENSIONS.has(extname(path));
}

function isTestPath(path) {
  return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * Whether `path` is in scope for the legacy-schema-reader scan. Exported
 * so `guard-no-legacy-schema-reader.test.mjs` can prove the scope directly
 * rather than re-deriving an equivalent check.
 */
export function isScannedPath(path) {
  return (
    SCAN_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
    hasScannedExtension(path) &&
    !isTestPath(path)
  );
}

export function main() {
  const tracked = listTrackedFiles();
  const scannedPaths = tracked.filter(isScannedPath);
  const files = scannedPaths.map((path) => ({ path, content: readFileSync(path, "utf8") }));

  const violations = findLegacySchemaReaderViolations(files);

  if (violations.length === 0) {
    console.log(
      `guard-no-legacy-schema-reader: OK — ${scannedPaths.length} file(s) under apps/android/src ` +
        `and packages/frontend-core/src checked; no version===1-keyed hosts/drafts/attachments ` +
        `reader found.`,
    );
    return;
  }

  console.error("guard-no-legacy-schema-reader: FAILED");
  for (const { path, fields } of violations) {
    console.error(
      `  ${path}: discriminates on version === 1 and reads ${fields.join("/")} back out of a ` +
        `value — this is a legacy §3 envelope reader, which docs/frontend-data-migration.md §2/§3 ` +
        `and apps/android/src/platform/offline/versioned-import.test.ts both say must not exist ` +
        "in this repository.",
    );
  }
  console.error(
    "  Remove the import path (any future export/import utility belongs in the legacy checkout " +
      "per plan.md §5.3, never here — see docs/frontend-data-migration.md §3), or, if the Phase 0 " +
      "decision has genuinely been reversed in writing, update that decision doc and this guard " +
      "together.",
  );
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
