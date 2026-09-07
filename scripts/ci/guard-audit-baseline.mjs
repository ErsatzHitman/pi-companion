// T44A3: CI guard — `npm audit`'s advisory set must stay inside a
// documented, reasoned baseline; anything new must be triaged, not
// silently absorbed.
//
// ## Why a baseline rather than a bare `npm audit --audit-level=...` gate
//
// A real `npm audit --json` taken on this tree (see
// docs/security-and-version-drift.md for the full run) reports 36 real
// advisories today, none fixable without `npm install`/`npm ci` — both
// refused by this environment's permission classifier, and every available
// fix is a semver-major bump of the Expo/React Native toolchain (or, for
// `packages/server`'s own direct deps `ai`/`express`/`uuid`, a bump this
// task's scope does not include). A bare `npm audit --audit-level=moderate`
// step would therefore fail on EVERY run, forever, for reasons nobody
// reading a red CI job could fix from that job alone — which is exactly
// the shape that gets a gate silently disabled a few waves later. Raising
// `--audit-level` until the gate goes quiet was explicitly ruled out by
// this task's own brief, for the same reason: it hides real findings
// rather than documenting them.
//
// So instead: `AUDIT_BASELINE` below names every advisory this repository
// currently accepts, WITH a reason and an owner, matched against
// `npm audit --json`'s real output by (package, severity, range) — not by
// package name alone, which `guard-capability-prose.mjs`'s own history
// warns against (T162's "a token that outlives the capability" and this
// guard's mirror, "a baseline that outlives the advisory"). This guard
// fails when:
//
//   1. `npm audit` reports an advisory NOT in the baseline — a real new
//      finding, or an existing package's advisory that changed severity or
//      affected range (which this guard treats as effectively a NEW
//      advisory, on purpose: an unreviewed severity change should not pass
//      silently just because the package name matches something already
//      accepted).
//
// A baseline entry whose (package, severity, range) no longer appears in
// `npm audit`'s output (the advisory was fixed, withdrawn, or the range
// changed) is reported as STALE — but, deliberately, does NOT fail the
// build. See `findStaleBaselineEntries`'s own doc comment for why.
//
// ## The disclosed blind spot
//
// Matching on (package, severity, range) is far narrower than matching on
// package name alone, but it is not perfect: a genuinely NEW, DIFFERENT
// advisory landing on an already-baselined package, at the exact same
// severity and the exact same affected range string, would be invisible to
// this guard. That is vanishingly unlikely (two independent advisories
// rarely share an identical range) and is disclosed here rather than
// solved, because doing better means keying on the advisory's own GHSA id
// or numeric `source`, which `npm audit --json`'s `via` array carries
// inconsistently — sometimes a string (an upstream package name, for a
// purely transitive entry), sometimes an object with `source`/`url`/`title`
// (for the package the advisory was filed against directly). Parsing that
// reliably is future work if this blind spot is ever actually hit; see
// docs/security-and-version-drift.md.
//
// Pure, dependency-free check functions only. `run-guard-audit-baseline.mjs`
// is the CLI entry point CI actually runs; it is the one that shells out to
// `npm audit --json`, which needs network access this module stays free of.

/**
 * @typedef {{ package: string, severity: string, range: string, owner: string, reason: string }} AuditBaselineEntry
 */

// Measured on this tree at commit HEAD when this guard was written (see
// docs/security-and-version-drift.md for the exact `npm audit --json` run
// this was captured from) — 36 entries, one per top-level key `npm audit
// --json` reported. Every one requires an `npm install`/`npm ci` this
// environment's permission classifier refuses, so every entry's `reason` is
// the same; `owner` differs by which workspace actually depends on the
// vulnerable package.
const ANDROID_TOOLCHAIN_OWNER = "apps/android dependency owner (Expo/React Native SDK upgrade)";
const SERVER_BACKEND_OWNER = "packages/server dependency owner (backend runtime deps)";
const NO_INSTALL_REASON =
  "no fix exists without an npm install (a semver-major bump in every case here), and " +
  "this environment's permission classifier refuses npm install/npm ci — filed as an owner decision, not silently waived";

/** @type {AuditBaselineEntry[]} */
export const AUDIT_BASELINE = [
  {
    package: "@ai-sdk/gateway",
    severity: "low",
    range: "<=2.0.147",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@ai-sdk/provider-utils",
    severity: "low",
    range: "<=3.0.97",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "ai",
    severity: "low",
    range:
      "<=0.0.0-fd764a60-20260114143805 || 3.0.22 - 6.0.0 || 7.0.0-beta.0 - 7.0.0-beta.1-gr2m-test",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "body-parser",
    severity: "moderate",
    range: "1.20.5 - 1.20.6",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "express",
    severity: "moderate",
    range: "4.22.2",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "qs",
    severity: "moderate",
    range: "2.2.5 - 6.15.3",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "uuid",
    severity: "moderate",
    range: "<11.1.1",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },

  {
    package: "@expo/cli",
    severity: "high",
    range: "<=0.0.0-canary-20231123-1b19f96-4 || >=0.0.1-canary-20231125-d600e44",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/config",
    severity: "moderate",
    range: "<=0.0.1-canary-20240418-8d74597 || >=3.3.23-alpha.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/config-plugins",
    severity: "moderate",
    range: "*",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/inline-modules",
    severity: "moderate",
    range: ">=0.0.2-canary-20260409-6fc2991",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/local-build-cache-provider",
    severity: "moderate",
    range: "*",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/metro",
    severity: "high",
    range: "<=55.1.1 || 56.0.0-rc.0 - 56.0.1",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/metro-config",
    severity: "high",
    range: "<=0.0.1-canary-20240418-8d74597 || >=0.1.49-alpha.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@expo/prebuild-config",
    severity: "moderate",
    range: "*",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-native/metro-config",
    severity: "high",
    range:
      "<=0.81.0-rc.5 || 0.82.0-nightly-20250710-586f5ba89 - 0.82.0-rc.5 || >=0.87.0-nightly-20260507-ba204faa7",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-navigation/bottom-tabs",
    severity: "moderate",
    range: "<=7.18.18",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-navigation/core",
    severity: "moderate",
    range: "<=8.0.0-alpha.9",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-navigation/elements",
    severity: "moderate",
    range: "<=2.9.40",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-navigation/native",
    severity: "moderate",
    range: "<=3.0.0-alpha.12 || 3.0.1 - 3.6.5 || 4.0.0-alpha.0 - 7.3.18",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@react-navigation/native-stack",
    severity: "moderate",
    range: "<=7.18.10",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "decode-uri-component",
    severity: "moderate",
    range: "<=0.4.2",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo",
    severity: "high",
    range: "40.0.0-alpha.0 - 40.0.0-beta.5 || >=41.0.0-alpha.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo-asset",
    severity: "moderate",
    range:
      "<=0.0.1-canary-20240418-8d74597 || 8.6.1 - 55.0.0-canary-20260223-05214f1 || 55.0.3-canary-20260128-67ce8d5 || 55.0.8-canary-20260424-7bedc9d - 55.0.8-canary-20260429-a5e59cf || 55.0.11-canary-20260327-0789fbc - 55.0.11-canary-20260402-9da566b || 56.0.0-canary-20260212-4f61309 - 56.0.0-canary-20260506-964f25d",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo-constants",
    severity: "moderate",
    range:
      "<=0.0.1-canary-20240418-8d74597 || 10.1.2 - 55.0.14 || 56.0.0-canary-20260212-4f61309 - 56.0.0-canary-20260506-964f25d",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo-linking",
    severity: "moderate",
    range:
      "<=0.0.1-canary-20240418-8d74597 || 2.2.2 - 55.0.0-canary-20260223-05214f1 || 55.0.4-canary-20260128-67ce8d5 || 55.0.8-canary-20260424-7bedc9d - 55.0.8-canary-20260429-a5e59cf || 55.0.10-canary-20260327-0789fbc - 55.0.10-canary-20260402-9da566b || 56.0.0-canary-20260212-4f61309 - 56.0.0-canary-20260506-964f25d",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo-module-scripts",
    severity: "moderate",
    range: "<=0.0.1-canary-20240418-8d74597 || 2.1.0 - 55.0.2",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "expo-router",
    severity: "moderate",
    range: "*",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "image-size",
    severity: "high",
    range: "*",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "jest-expo",
    severity: "moderate",
    range: "42.0.0 - 56.0.0-canary-20260506-964f25d",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "metro",
    severity: "high",
    range: "0.22.1 - 0.83.7 || 0.84.0 - 0.84.4 || >=0.85.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "metro-config",
    severity: "high",
    range: "<=0.83.7 || 0.84.0 - 0.84.4 || >=0.85.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "metro-transform-worker",
    severity: "high",
    range: "0.60.0 - 0.83.7 || 0.84.0 - 0.84.4 || >=0.85.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "postcss",
    severity: "high",
    range: "<=8.5.22",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "query-string",
    severity: "moderate",
    range: "5.0.0 - 9.4.1",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "xcode",
    severity: "moderate",
    range: ">=0.9.2",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
];

function baselineKey(entry) {
  return `${entry.package} ${entry.severity} ${entry.range}`;
}

/**
 * @param {Record<string, { severity: string, range: string }>} vulnerabilities
 *   `npm audit --json`'s own `.vulnerabilities` object, keyed by package name.
 * @param {AuditBaselineEntry[]} baseline
 * @returns {{ package: string, severity: string, range: string }[]} every
 *   advisory `npm audit` reports that is not covered by the baseline,
 *   sorted by package name.
 */
export function findUnbaselinedAdvisories(vulnerabilities, baseline) {
  const baselineKeys = new Set(baseline.map(baselineKey));
  const violations = [];
  for (const [packageName, info] of Object.entries(vulnerabilities)) {
    const key = baselineKey({ package: packageName, severity: info.severity, range: info.range });
    if (!baselineKeys.has(key)) {
      violations.push({ package: packageName, severity: info.severity, range: info.range });
    }
  }
  violations.sort((a, b) => a.package.localeCompare(b.package));
  return violations;
}

/**
 * A baseline entry whose exact (package, severity, range) no longer appears
 * in `npm audit`'s live output means the advisory was fixed, withdrawn, or
 * its range changed — in every case, something IMPROVED. This is reported
 * so the baseline can be trimmed (an untrimmed baseline is itself the
 * "stale allowlist entry" shape this repository's CLAUDE.md names at
 * T211/T213/T215), but deliberately does NOT fail the build: failing a
 * security gate because a vulnerability went away would be a perverse
 * incentive, and this repository already has a cheaper, non-blocking way to
 * surface the same fact (this function's own return value, printed by the
 * runner). See docs/security-and-version-drift.md for the standing
 * instruction to prune a stale entry on sight rather than leave it.
 *
 * @param {Record<string, { severity: string, range: string }>} vulnerabilities
 * @param {AuditBaselineEntry[]} baseline
 * @returns {AuditBaselineEntry[]} baseline entries with no matching live advisory
 */
export function findStaleBaselineEntries(vulnerabilities, baseline) {
  const liveKeys = new Set(
    Object.entries(vulnerabilities).map(([packageName, info]) =>
      baselineKey({ package: packageName, severity: info.severity, range: info.range }),
    ),
  );
  return baseline.filter((entry) => !liveKeys.has(baselineKey(entry)));
}
