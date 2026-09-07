#!/usr/bin/env node
// CLI entry point for the axe-route-coverage guard (T44A2). Run from the
// repository root (CI runs it via
// `node scripts/ci/run-guard-axe-route-coverage.mjs`).
// See scripts/ci/guard-axe-route-coverage.mjs for the checked signature,
// what it deliberately does and does not parse, and why.

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  MANIFEST_PATH,
  computeDeclaredRoutes,
  findRouteCoverageViolations,
  parseManifestEntries,
} from "./guard-axe-route-coverage.mjs";

export function main() {
  const readFile = (path) => readFileSync(path, "utf8");
  const fileExists = (path) => existsSync(path);

  const { routes, errors } = computeDeclaredRoutes({ readFile, fileExists });

  if (errors.length > 0) {
    console.error("guard-axe-route-coverage: FAILED (could not derive the real route list)");
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const manifestSource = readFile(MANIFEST_PATH);
  const manifestEntries = parseManifestEntries(manifestSource);

  const violations = findRouteCoverageViolations({ declaredRoutes: routes, manifestEntries });

  if (violations.length === 0) {
    console.log(
      `guard-axe-route-coverage: OK — ${routes.length} route(s) declared in route-tree.ts, all ` +
        `accounted for in ${MANIFEST_PATH} (${manifestEntries.filter((e) => e.swept).length} ` +
        `swept, ${manifestEntries.filter((e) => e.swept === false).length} exempt with a ` +
        `written reason).`,
    );
    return;
  }

  console.error("guard-axe-route-coverage: FAILED");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
