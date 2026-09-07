#!/usr/bin/env node
// CLI entry point for the dependency-audit-baseline guard (T44A3). Run from
// the repository root (CI runs it via
// `node scripts/ci/run-guard-audit-baseline.mjs`, AFTER `npm ci`). See
// scripts/ci/guard-audit-baseline.mjs for the baseline and the matching
// rule's disclosed limitation.
//
// `npm audit --json` exits 1 whenever it finds ANY advisory — that is
// expected and NOT itself treated as this guard's failure; only stdout's
// parsed `.vulnerabilities` matters. A non-JSON stdout (a network failure,
// a broken npm install) is NOT silently treated as "no advisories" — it
// fails loudly, because "audit produced garbage" and "audit found nothing"
// must never look the same to this guard.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  AUDIT_BASELINE,
  findStaleBaselineEntries,
  findUnbaselinedAdvisories,
} from "./guard-audit-baseline.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function runNpmAudit() {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`could not run npm audit: ${result.error.message}`);
  }
  if (!result.stdout || !result.stdout.trim()) {
    throw new Error(
      `npm audit produced no stdout (exit code ${result.status}). stderr:\n${result.stderr ?? "<empty>"}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `npm audit's stdout was not valid JSON: ${error.message}\n---\n${result.stdout}`,
    );
  }
  return parsed;
}

function main() {
  const audit = runNpmAudit();
  const vulnerabilities = audit.vulnerabilities ?? {};

  const unbaselined = findUnbaselinedAdvisories(vulnerabilities, AUDIT_BASELINE);
  const stale = findStaleBaselineEntries(vulnerabilities, AUDIT_BASELINE);

  if (stale.length > 0) {
    console.log(
      `guard-audit-baseline: NOTE — ${stale.length} baseline entr${stale.length === 1 ? "y is" : "ies are"} stale (npm audit no longer reports them; likely fixed or withdrawn). Not a failure — please prune from AUDIT_BASELINE in scripts/ci/guard-audit-baseline.mjs when convenient:`,
    );
    for (const entry of stale) {
      console.log(
        `    ${entry.package} (${entry.severity}, ${entry.range}) — owner: ${entry.owner}`,
      );
    }
  }

  if (unbaselined.length === 0) {
    console.log(
      `guard-audit-baseline: OK — every advisory npm audit reports (${Object.keys(vulnerabilities).length} package(s)) is covered by the documented baseline (docs/security-and-version-drift.md).`,
    );
    return;
  }

  console.error(
    `guard-audit-baseline: FAILED — ${unbaselined.length} advisory/advisories are not in the documented baseline:`,
  );
  for (const v of unbaselined) {
    console.error(`  ${v.package} — severity: ${v.severity}, range: ${v.range}`);
  }
  console.error(
    "  Triage each: if it is genuinely new and unfixable here (needs npm install/npm ci, which this" +
      " environment refuses), add it to AUDIT_BASELINE in scripts/ci/guard-audit-baseline.mjs with a named" +
      " owner and reason, and record it in docs/security-and-version-drift.md. Never widen this guard's" +
      " matching to make an unreviewed finding disappear.",
  );
  process.exitCode = 1;
}

main();
