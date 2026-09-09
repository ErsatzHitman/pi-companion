#!/usr/bin/env node
// CLI entry point for the npx binary-vs-package guard (T310). Run from the
// repository root; CI runs it as the `guard-npx-binary-package` job. See
// scripts/ci/guard-npx-binary-package.mjs for the checked rule and the
// `npx eas` failure that motivated it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  collectLockfileBins,
  collectManifestNpxInvocations,
  collectWorkflowNpxInvocations,
  EXTERNAL_NPX_PACKAGES,
  findNpxBinaryPackageViolations,
  selectManifestFiles,
  selectWorkflowFiles,
} from "./guard-npx-binary-package.mjs";

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
}

/** @param {string[]} paths */
function read(paths) {
  return paths.map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

/** @param {import("./guard-npx-binary-package.mjs").NpxBinaryPackageViolation} violation */
function describe(violation) {
  switch (violation.kind) {
    case "binary-not-package":
      return (
        `  \`npx ${violation.target}\` in ${violation.source} names a BINARY, not a package. ` +
        `npx resolves a package name, and the binary \`${violation.target}\` is shipped by ` +
        `\`${violation.suggestion}\` — write \`npx ${violation.suggestion}\`.`
      );
    case "unresolvable":
      return (
        `  \`npx ${violation.target}\` in ${violation.source} names neither a binary any locked ` +
        "dependency ships nor a registered external package. npx will download an npm package " +
        `literally named \`${violation.target}\`, which may not exist or may ship no bin at all. ` +
        "Declare the dependency, or register the package in EXTERNAL_NPX_PACKAGES with a reason."
      );
    case "placeholder-reason":
      return `  EXTERNAL_NPX_PACKAGES["${violation.target}"] carries a placeholder reason.`;
    case "stale-uninvoked":
      return (
        `  EXTERNAL_NPX_PACKAGES["${violation.target}"] is registered but nothing runs ` +
        `\`npx ${violation.target}\` any more. Remove the entry.`
      );
    case "stale-locally-installed":
      return (
        `  EXTERNAL_NPX_PACKAGES["${violation.target}"] is no longer needed: the lockfile now ` +
        "ships a binary of that name, so npx resolves it locally. Remove the entry."
      );
    default:
      return `  ${JSON.stringify(violation)}`;
  }
}

function main() {
  const tracked = listTrackedFiles();
  const workflows = read(selectWorkflowFiles(tracked));
  const manifests = read(selectManifestFiles(tracked));
  const lockfileBins = collectLockfileBins(JSON.parse(readFileSync("package-lock.json", "utf8")));

  const invocations = [
    ...collectWorkflowNpxInvocations(workflows),
    ...collectManifestNpxInvocations(manifests),
  ];

  // Non-vacuity. This repository runs npx in CI today; zero invocations means
  // the extraction stopped working (a workflow shape `extractRunStepContents`
  // no longer parses, a moved directory), not that the tree got cleaner. A
  // guard that silently checks nothing reports OK forever — the shape
  // CLAUDE.md's T211/T217 sections keep re-finding.
  if (invocations.length === 0) {
    console.error("guard-npx-binary-package: FAILED");
    console.error(
      `  found no npx invocations at all across ${workflows.length} workflow(s) and ` +
        `${manifests.length} manifest(s). This repository has several; the extraction is broken.`,
    );
    process.exitCode = 1;
    return;
  }

  const violations = findNpxBinaryPackageViolations({ invocations, lockfileBins });

  if (violations.length === 0) {
    console.log(
      `guard-npx-binary-package: OK — all ${invocations.length} npx invocation(s) resolve to a ` +
        `locked binary or one of ${Object.keys(EXTERNAL_NPX_PACKAGES).length} registered ` +
        "external package(s).",
    );
    return;
  }

  console.error("guard-npx-binary-package: FAILED");
  for (const violation of violations) console.error(describe(violation));
  process.exitCode = 1;
}

main();
