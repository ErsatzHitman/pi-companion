import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_BASELINE,
  findStaleBaselineEntries,
  findUnbaselinedAdvisories,
} from "./guard-audit-baseline.mjs";

// --- AUDIT_BASELINE shape sanity -----------------------------------------

test("AUDIT_BASELINE has no duplicate (package, severity, range) entries", () => {
  const keys = AUDIT_BASELINE.map((e) => `${e.package} ${e.severity} ${e.range}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("every AUDIT_BASELINE entry carries a non-empty owner and reason", () => {
  for (const entry of AUDIT_BASELINE) {
    assert.ok(entry.owner && entry.owner.length > 0, `${entry.package} has no owner`);
    assert.ok(entry.reason && entry.reason.length > 0, `${entry.package} has no reason`);
  }
});

test("AUDIT_BASELINE has exactly 36 entries — the real npm audit --json count measured for this task", () => {
  assert.equal(AUDIT_BASELINE.length, 36);
});

// --- findUnbaselinedAdvisories --------------------------------------------

test("passes when npm audit's output exactly matches the baseline (fixture)", () => {
  const vulnerabilities = Object.fromEntries(
    AUDIT_BASELINE.map((e) => [e.package, { severity: e.severity, range: e.range }]),
  );
  assert.deepEqual(findUnbaselinedAdvisories(vulnerabilities, AUDIT_BASELINE), []);
});

test("fails when npm audit reports a package the baseline never named (new-advisory fixture)", () => {
  const vulnerabilities = { "left-pad": { severity: "critical", range: "*" } };
  const violations = findUnbaselinedAdvisories(vulnerabilities, []);
  assert.deepEqual(violations, [{ package: "left-pad", severity: "critical", range: "*" }]);
});

test("treats a severity or range change on an ALREADY-baselined package as a new, unreviewed advisory", () => {
  const baseline = [
    {
      package: "expo",
      severity: "high",
      range: "40.0.0-alpha.0 - 40.0.0-beta.5",
      owner: "x",
      reason: "x",
    },
  ];
  const vulnerabilities = {
    expo: { severity: "critical", range: "40.0.0-alpha.0 - 40.0.0-beta.5" },
  };
  const violations = findUnbaselinedAdvisories(vulnerabilities, baseline);
  assert.deepEqual(violations, [
    { package: "expo", severity: "critical", range: "40.0.0-alpha.0 - 40.0.0-beta.5" },
  ]);
});

test("sorts violations by package name", () => {
  const vulnerabilities = {
    zebra: { severity: "low", range: "*" },
    apple: { severity: "low", range: "*" },
  };
  const violations = findUnbaselinedAdvisories(vulnerabilities, []);
  assert.deepEqual(
    violations.map((v) => v.package),
    ["apple", "zebra"],
  );
});

// --- findStaleBaselineEntries ----------------------------------------------

test("reports no stale entries when every baseline entry is still live (fixture)", () => {
  const vulnerabilities = Object.fromEntries(
    AUDIT_BASELINE.map((e) => [e.package, { severity: e.severity, range: e.range }]),
  );
  assert.deepEqual(findStaleBaselineEntries(vulnerabilities, AUDIT_BASELINE), []);
});

test("reports a baseline entry as stale when npm audit no longer reports it (fixed-advisory fixture)", () => {
  const baseline = [{ package: "left-pad", severity: "low", range: "*", owner: "x", reason: "x" }];
  const violations = findStaleBaselineEntries({}, baseline);
  assert.deepEqual(violations, baseline);
});

test("the disclosed blind spot is real: a different advisory on the SAME package at the SAME (severity, range) is invisible", () => {
  // This is not a bug to fix silently — it is the documented limitation in
  // guard-audit-baseline.mjs's own module header. This test pins that the
  // limitation behaves exactly as documented, so a future change to the
  // matching key is a deliberate decision, not an accidental narrowing.
  const baseline = [{ package: "expo", severity: "high", range: "*", owner: "x", reason: "x" }];
  // A totally different CVE, coincidentally the same severity and range.
  const vulnerabilities = { expo: { severity: "high", range: "*" } };
  assert.deepEqual(findUnbaselinedAdvisories(vulnerabilities, baseline), []);
});
