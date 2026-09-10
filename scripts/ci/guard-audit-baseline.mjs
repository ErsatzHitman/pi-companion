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

// ## T231: the owner's unblock sequence, re-verified (not re-derived from
// scratch) at commit cc3980ae45f7d8991a04243588782a5ebd50b7a8 on 2026-09-08.
// `npm audit --json` runs without `npm install`/`npm ci` (it reads the
// already-installed node_modules and package-lock.json; it does not modify
// either) and was re-run in the foreground for this note: still 36
// advisories, 0 critical / 10 high / 23 moderate / 3 low, and the SERVER_
// BACKEND_OWNER/ANDROID_TOOLCHAIN_OWNER split below is still exactly 7/29 —
// the P9-W3 gate's figures were re-confirmed, not assumed. `node
// scripts/ci/run-guard-audit-baseline.mjs` exits 0 today. This section is
// the one place that sequence lives; docs/security-and-version-drift.md §2
// records the baseline's origin and disclosed limitation but not an ordered
// command list, and this task's `Owns:` line does not reach `package.json`
// or the lockfile, so nothing here may be executed by an agent — only read
// by the owner.
//
// Take the SERVER seven first — ordinary minor/major bumps, independent of
// the Expo question, verifiable by this repository's own unit/typecheck
// gates with no device needed:
//
//   1. `npm install --workspace=@picompanion/server` after widening the
//      `express` range in that workspace's package.json to a version with
//      no advisory (`npm audit --json`'s own `fixAvailable` marks
//      `express`/`body-parser`/`qs` as `true` — a non-major bump; `qs` and
//      `body-parser` are transitive through `express` and need no direct
//      edit). This alone should clear 3 of the 7 (body-parser, express, qs).
//   2. Bump `ai` (direct dep, pinned `5.0.78`) to the `fixAvailable` target
//      `7.0.93` — a semver-major jump; read that package's own migration
//      notes before landing it, since packages/server's actual call sites
//      are not proven compatible here. This should clear `ai` plus its two
//      transitive advisories (`@ai-sdk/gateway`, `@ai-sdk/provider-utils`),
//      4 of the 7.
//   3. Bump `uuid` (direct dep, pinned `^9.0.1`) to the `fixAvailable`
//      target `14.0.2` — five majors ahead; grep every `import ... from
//      "uuid"` call site first, since that package's default-export shape
//      has changed across majors before. This is the 7th.
//
// ## CORRECTED (P9-U): step 3 is DONE, steps 1 and 2 are now WRONG
//
// Step 3 was taken and is no longer pending. `uuid` is `^14.0.2` in
// `packages/server/package.json` and resolves 14.0.2. The export worry the
// step names did not materialise: all thirteen call sites import the NAMED
// `v4`, not a default export, and `v4` is still a named export in 14.0.2
// (checked by calling it, not by reading a changelog). `tsgo` typecheck exits
// 0 and the ceiling guard is unmoved.
//
// Steps 1 and 2 were then attempted and REVERTED, and the reason is the
// standing lesson here rather than a one-off: **`fixAvailable` is a moving
// target, and following it can move a dependency INTO a newly-published
// vulnerable range.** Measured within a single session, two `npm audit` runs
// minutes apart:
//
//   - Step 1's premise is gone. `express`'s fix is no longer non-major; it is
//     now `express@5.2.1`, `isSemVerMajor: true`. The cause is a NEW `qs`
//     advisory, "array-limit bypass via bracket-key comma parsing", covering
//     `>=6.14.2 <=6.15.3` — and `express@^4.18.2` already resolves `qs@6.15.3`
//     in this tree, so this arrived without anyone changing anything.
//   - Step 2's target is wrong twice over. It says `ai@7.0.93`; the current
//     `fixAvailable` is `ai@7.0.94`. More importantly, the interim `ai@5.0.253`
//     that one audit run offered as a NON-major fix is itself covered by a new
//     advisory spanning `5.0.223 - 5.0.253`, while the pinned `5.0.78` sits
//     outside it. Bumping to 5.0.253 therefore traded a `low` advisory for a
//     `moderate` one and took the total from 36 to 37.
//
// Both were reverted from scratchpad copies of `package-lock.json` and
// `packages/server/package.json` (never `git checkout --`), `npm install` was
// re-run, and `git status --porcelain` confirmed the restore was
// byte-identical. So: **all six remaining SERVER_BACKEND_OWNER advisories now
// need a semver-major bump** (`express@5.2.1`, `ai@7.0.94`), not the
// "3 non-major + 4 major" split step 1 and 2 describe. Re-read
// `fixAvailable` immediately before acting; do not trust the figures in this
// comment either, for exactly the reason it documents.
//   4. After each bump: `npm run build --workspace=@picompanion/server`,
//      `npm run typecheck --workspace=@picompanion/server`, and
//      `npm run test:unit --workspace=@picompanion/server` three times in a
//      row on one commit (this repository's own T240 rule for that
//      workspace's test suite). Then re-run
//      `node scripts/ci/run-guard-audit-baseline.mjs`: the remaining
//      SERVER_BACKEND_OWNER entries should print as STALE ("likely fixed or
//      withdrawn"), which is this guard's non-failing "safe to prune" signal
//      — prune those lines from AUDIT_BASELINE below in the SAME commit as
//      the bump, never left dangling. If `run-guard-audit-baseline.mjs`
//      instead FAILS naming a package still in this list, the bump did not
//      fully clear that advisory (a different range, or a new one) — treat
//      that as a new, unreviewed finding, not something to re-baseline
//      reflexively.
//
//      P9-U found a third outcome this step did not anticipate, and it is the
//      one that actually happened: the advisory can survive a successful bump
//      because a DIFFERENT node matches the same (package, severity, range)
//      triple. Clearing `packages/server`'s own `uuid` left the entry in
//      place via `node_modules/xcode/node_modules/uuid`. That is neither
//      stale nor a failure — it is a correct entry whose OWNER changed, and
//      the fix is to reassign the owner (see the `uuid` entry below), not to
//      prune it. Read `nodes` in `npm audit --json`, not just the package
//      name, before concluding a bump did nothing.
//
// Take the EXPO/ANDROID 29 second. Every one of their `fixAvailable`s points
// at `expo@57.0.20` (this app pins `^54.0.18`, three majors back) or a
// satellite package's own major bump. This is NOT clearable by a typecheck
// and a vitest run alone: an Expo SDK major bump changes native module
// versions, Metro's own bundling, and Android Gradle/NDK expectations that
// only a real device or emulator run can prove — the identical blocker
// T208 names for this repository's `android-maestro-e2e.yml` (EXPO_TOKEN
// plus a real dispatched run). Do not treat a green `apps/android`
// `npx vitest run` as sufficient evidence the bump is safe.
//
//   1. Follow the official Expo SDK 54→57 upgrade guide for
//      `apps/android` (the `expo`, `expo-*`, `@react-navigation/*`, and
//      Metro-chain packages listed under ANDROID_TOOLCHAIN_OWNER below all
//      move together; `npx expo install --fix` after the `expo` pin itself
//      is bumped is the standard mechanism for keeping satellites aligned,
//      but read the guide's own breaking-change list first — SDK bumps of
//      this size have moved config-plugin and asset-resolution behavior
//      before).
//   2. Build and dispatch a real device/emulator run
//      (`android-maestro-e2e.yml`, or an EAS build plus a manual install) —
//      this is the acceptance evidence for the Android half, not a local
//      typecheck.
//   3. Re-run `npm audit --json` after the bump and diff it against this
//      file's ANDROID_TOOLCHAIN_OWNER entries by hand before touching
//      anything: an SDK bump this large can both fix old advisories and
//      introduce new ones on packages that did not previously appear here.
//      Then run `node scripts/ci/run-guard-audit-baseline.mjs` the same way
//      as the server half — expect the 29 entries to report STALE, prune
//      them from AUDIT_BASELINE in the same commit as the bump, and treat
//      any FAILURE (a package `run-guard-audit-baseline.mjs` still reports
//      as unbaselined) as a new finding requiring its own reasoned entry,
//      never a reflex re-baseline.
//
// In both halves: a baseline entry is only ever deleted here once the bump
// that fixes it has landed and been verified by the gates above — per this
// task's own acceptance criterion, no advisory may be dropped from
// AUDIT_BASELINE without being fixed.

/** @type {AuditBaselineEntry[]} */
export const AUDIT_BASELINE = [
  {
    package: "@ai-sdk/gateway",
    severity: "low",
    // Range re-synced at the P9-Q merge gate, the third of three in the same
    // AI-SDK family whose advisory ranges were re-expressed together upstream
    // (see `@ai-sdk/provider-utils` and `ai` below). Narrowed, `<=2.0.147` to
    // `<=2.0.105`; installed version is 2.0.1, inside both, exposure unchanged.
    range: "<=2.0.105",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "@ai-sdk/provider-utils",
    severity: "low",
    // Range re-synced at the P9-Q merge gate alongside `ai` below. Upstream
    // NARROWED this one, `<=3.0.97` becoming `<3.0.28` — strictly fewer
    // versions considered vulnerable than the baseline claimed. Installed
    // version is 3.0.12, inside both, so exposure is unchanged and this is
    // bookkeeping. The guard flags a narrowing because it compares the recorded
    // range against the advisory's current one, and a baseline that is a
    // superset is as stale as one that is a subset.
    range: "<3.0.28",
    owner: SERVER_BACKEND_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    package: "ai",
    severity: "low",
    // Range re-synced at the P9-Q merge gate, the second such re-sync after
    // `expo-linking`'s at P9-P. Upstream did not add a new vulnerable version:
    // it SPLIT one arm, `3.0.22 - 6.0.0` becoming
    // `3.0.22 - 5.0.206 || 5.1.0-beta.0 - 6.0.0`, which is a more precise
    // statement of the same advisory. Measured rather than assumed: the
    // installed version is 5.0.78, inside `3.0.22 - 5.0.206` both before and
    // after, so exposure is identical and this is bookkeeping. Nothing in wave
    // P9-Q touched `package-lock.json` or this guard (`git log <base>..HEAD --`
    // those two paths returns nothing), so the change came from the registry.
    // If a future re-sync ever WIDENS coverage to a version this repository did
    // not previously resolve as vulnerable, that is a new acceptance and needs
    // the owner, not a range edit.
    range:
      "<=0.0.0-fd764a60-20260114143805 || 3.0.22 - 5.0.206 || 5.1.0-beta.0 - 6.0.0 || 7.0.0-beta.0 - 7.0.0-beta.1-gr2m-test",
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
    // Owner REASSIGNED (P9-U): `packages/server` bumped its own direct
    // `uuid` from `^9.0.1` to `^14.0.2`, which cleared the server's node.
    // The advisory did not disappear, because a DIFFERENT node still
    // matches this same (package, severity, range) triple:
    // `node_modules/xcode/node_modules/uuid`, transitive through the Expo
    // toolchain, whose `fixAvailable` is now `expo@57.0.21`
    // (`isSemVerMajor: true`). So this entry belongs to the Android
    // toolchain owner and NOT to the seven the owner sequence above calls
    // "the SERVER seven" — it is an Expo-line entry wearing a server
    // package's name, and reading the name alone would send the wrong owner
    // after it. This is the exact shape this guard's own header warns about
    // under "a baseline that outlives the advisory", one level in: the
    // triple outlived the NODE it was accepted for.
    severity: "moderate",
    range: "<11.1.1",
    owner: ANDROID_TOOLCHAIN_OWNER,
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
    // T326: the range was `40.0.0-alpha.0 - 40.0.0-beta.5 || >=41.0.0-alpha.0`
    // while an SDK-57 `expo@57.0.18` sat at the root beside the app's 54;
    // npm audit reports the range relative to what is installed, and with
    // one `expo@54.0.37` left it reports only the upper arm. Same advisory.
    package: "expo",
    severity: "high",
    range: ">=41.0.0-alpha.0",
    owner: ANDROID_TOOLCHAIN_OWNER,
    reason: NO_INSTALL_REASON,
  },
  {
    // T326: surfaced once `expo-asset` moved to the SDK-54 `12.0.13` the app
    // actually needs — npm audit now reaches `expo-audio` through it. The
    // installed `1.1.1` is BELOW the reported range's floor; this is the
    // via-chain shape, not a vulnerable install, and the fix npm names is
    // the same SDK upgrade as every other entry with this owner.
    package: "expo-audio",
    severity: "moderate",
    range:
      "1.1.2-canary-20260119-17896bf - 55.0.0-canary-20260223-05214f1 || 55.0.4-canary-20260128-67ce8d5 || 55.0.9-canary-20260424-7bedc9d - 55.0.9-canary-20260429-a5e59cf || 55.0.10-canary-20260327-0789fbc - 55.0.10-canary-20260402-9da566b || 56.0.0-canary-20260212-4f61309 - 56.0.0-canary-20260506-964f25d",
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
    // Range re-synced THREE times, at the P9-P, P9-T and T348 merge gates. All
    // three moved only this entry's trailing arm, and none changed exposure.
    //
    // At P9-P upstream advisory data GREW that arm, as open-ended
    // `>=58.0.0-canary-20260806-8c2d007`. At P9-T it was NARROWED to
    // `58.0.0-canary-20260806-8c2d007 - 58.0.0-canary-20260908-e343e6e`, i.e.
    // upstream published a fixed version and gave the arm an upper bound. At
    // T348 the arm was REMOVED outright -- the narrowing carried to its end.
    // Each time, the entry reported simultaneously as an unbaselined advisory
    // (new range) and as a stale entry (old range no longer matched), which is
    // the signature of a re-published range rather than a new finding.
    //
    // Measured rather than assumed, both times: the installed version is
    // 8.0.12, already inside the pre-existing
    // `2.2.2 - 55.0.0-canary-20260223-05214f1` arm, so the trailing arm covers
    // only versions ABOVE what this repository resolves and its bounds do not
    // touch this repository's exposure either way. Same advisory, same owner,
    // same reason, same exposure. Nothing in wave P9-P or wave P9-T touched
    // `package-lock.json`, this guard, or `docs/security-and-version-drift.md`
    // (`git log <base>..HEAD --` those three paths returns nothing in either
    // wave), so the change came from the registry, not from the tree.
    //
    // A NARROWING is the safe direction and needs no owner. If a future
    // re-sync adds or widens an arm so that it DOES cover the installed
    // version, that is a new acceptance and needs the owner, not a range
    // edit.
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
  return `${entry.package}\0${entry.severity}\0${entry.range}`;
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
