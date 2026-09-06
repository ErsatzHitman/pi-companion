#!/usr/bin/env node
// CLI entry point for the capability-denial-prose guard. Run from the
// repository root (CI runs it via
// `node scripts/ci/run-guard-capability-prose.mjs`).
// See scripts/ci/guard-capability-prose.mjs for the checked rule, the
// CAPABILITIES list, and why historical "CORRECTED" quotations are exempt.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { CAPABILITIES, findCapabilityDenialViolations } from "./guard-capability-prose.mjs";

// T147: "shipped" used to mean `packages/client/src` alone, which made a
// `CAPABILITIES` entry for a capability living anywhere else provably
// inert — the P6-W12 merge gate added one naming `useClipboardAction`
// (a hook in `apps/web/src`) and got exit 0 with a live denying sentence
// still in the tree. Now any package's or app's `src/` counts: a plain
// `[^/]+` between `packages|apps` and `/src/` matches every workspace
// (`packages/client/src/`, `packages/protocol/src/`,
// `packages/frontend-core/src/`, `apps/web/src/`, `apps/android/src/`,
// ...) without hardcoding each one.
const SHIPPED_SRC_PATTERN = /^(?:packages|apps)\/[^/]+\/src\//;
// T156: T147's widening still missed `scripts/ci` — this repository's own
// CI guards, which are exactly the kind of place a capability can ship
// without ever touching a package's or app's `src/`. The P6-W15 merge gate
// proved the gap by changing ONLY a `CAPABILITIES` entry's member name
// between `joinAdjacentStringLiterals` (ships in
// `scripts/ci/guard-capability-prose.mjs`) and `useDiagnosticsExport`
// (ships in `apps/web/src/features/diagnostics/`) against the identical
// live denying sentence: exit 0 for the former, exit 1 for the latter.
// Scoped to `scripts/ci` specifically, not `scripts/` wholesale — per
// `guard-capability-prose.mjs`'s "keep the guard survivable" note,
// `scripts/ci` is the directory that holds guards; a scratch or one-off
// script directory elsewhere under `scripts/` is not shipped source.
const SCRIPTS_CI_SRC_PATTERN = /^scripts\/ci\//;
const APP_SRC_PREFIXES = ["apps/web/src/", "apps/android/src/"];
// T156: `.mjs` added because `scripts/ci`'s guards are plain ESM `.mjs`
// modules, not `.ts`/`.tsx`.
//
// CORRECTED (P6-W16 merge gate): this said "no file under `apps/*/src` or
// `packages/*/src` today uses that extension, so widening it here cannot
// change what ... `isShippedSourcePath` match outside `scripts/ci`". That
// is false by exactly one file: `packages/server/src/terminal/
// terminal-ts-loader.mjs` is tracked (since `0cee983`, T04) and
// `run-orphan-modules.mjs` already names it. Counted at the gate:
// 1172 `.ts`/`.tsx` non-test files under `packages|apps/*/src`, + 1 (the
// loader) + 25 non-test `scripts/ci` `.mjs` = the 1198 this runner reports.
// The inclusion is correct on its merits — the loader IS shipped source, and
// a capability declared there should count — but the rationale above was
// not, and "this cannot change anything" is the kind of claim that stops
// the next reader from checking. `isAppSourcePath` below is genuinely
// unchanged: it is `.ts`/`.tsx`-gated on its own prefixes.
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);
const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".test.mjs"];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function hasSourceExtension(path) {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && SOURCE_EXTENSIONS.has(path.slice(dot));
}

function isTestSourcePath(path) {
  return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * Whether `path` counts as "shipped" real source for deciding if a
 * capability is actually real today — any package or app's `src/`
 * directory, or (T156) `scripts/ci` — excluding test files (a fake/mock
 * under a `.test.ts`/`.test.mjs` must never be able to make the guard
 * believe a capability is real). Exported so `guard-capability-prose.test.mjs`
 * can prove the widened scope directly, not by re-deriving an equivalent
 * regex.
 */
export function isShippedSourcePath(path) {
  return (
    (SHIPPED_SRC_PATTERN.test(path) || SCRIPTS_CI_SRC_PATTERN.test(path)) &&
    hasSourceExtension(path) &&
    !isTestSourcePath(path)
  );
}

// T179: the DENIAL scan (which files get checked for false prose) was
// never widened even though the shipped-source scan above was widened
// twice (T147, T156) — it was still only `apps/web/src`/`apps/android/src`.
// Every false-premise site the P6-W20 and P6-W21 gates found lived
// OUTSIDE that scope and was invisible to `isAppSourcePath`: four sites in
// `packaging/**` (`packaging/docker/Dockerfile`'s header,
// `packaging/docker/README.md` twice, `packaging/nix/README.md`) and two
// in `scripts/ci` (`guard-docker-packaging-paths.mjs`'s header and its
// `findBuildOrderViolations` doc comment) — `run-guard-capability-
// prose.mjs` exited 0 with all six present, none of them in
// `apps/web/src` or `apps/android/src`.
//
// CORRECTED (P6-W22 gate): that sentence originally read "...because
// none of them was `apps/web/src` or `apps/android/src`", which names the
// scope as the operative cause. It was one cause, not the only one, and
// widening the scope does NOT on its own make those six sites catchable.
// All six are about the packaging build-order capability (T174's
// `findBuildOrderViolations`, T178's comment-awareness), and no
// `CAPABILITIES` entry's `denyingPhrases` describe it — re-derived at the
// gate against all seven entries. So they would pass today even in scope.
// The widening below is real, necessary, and forward-looking; it is the
// half of the fix that lives here. The other half is an entry for that
// capability, which CLAUDE.md's "add a new capability entry the moment you
// ship one" required of T174 and which no task has yet written. T183.
// (This paragraph named that task "T184" until this note; no such task
// was ever filed — T183 is the real one, `docs/issues-from-plan.md`'s
// entry and the P6-W22 gate commit that filed it both agree.)
//
// CLOSED (T183): `guard-capability-prose.mjs`'s `CAPABILITIES` list now
// has an entry for the packaging build-order capability
// ("packaging build-order checking (findBuildOrderViolations)"),
// `denyingPhrases` matching two of the six real corrected sentences named
// above. Both halves the paragraph above called for now exist: the scope
// widens to where the false premise lived (this file, T179) and an entry
// describes the capability those sites were wrong about (T183).
//
// QUALIFIED (P6-W23 gate): this said "Both halves ... are done", which
// reads as though all six sites are now catchable. They are not. Two of
// the six live in `scripts/ci/guard-docker-packaging-paths.mjs` — the
// SOLE declaring file for `findBuildOrderViolations` — and
// `findCapabilityDenialViolations` excludes each judged file from its own
// evidence pool, so the capability is never "shipped" while that file is
// being judged and no denial in it can be reported. Proven at the gate by
// appending one byte-identical sentence to that file and to
// `guard-dockerignore-depth.mjs`: exit 1, exactly one violation, and it
// was NOT the declaring file's copy. The other two of the six are within
// scope but outside the entry's two `denyingPhrases`. So: two catchable,
// two out of phrase coverage (T187), two structurally uncatchable until
// T184. The entry is real and does real work — it is the closure claim
// that overstated.
//
// CLOSED (T184): `findCapabilityDenialViolations` no longer excludes the
// judged file from its own evidence pool at all — "is this capability
// shipped?" is resolved once per capability, over the FULL `shippedFiles`
// list, before `appFiles` is ever walked (see that function's own doc
// comment for the mechanism and the two-violation reproduction of the
// exact mutation above). The "two structurally uncatchable" category
// this note named is gone: re-measured directly (each of the six real
// sites' quoted false text, isolated from its own `CORRECTED` marker and
// from any OTHER marker nearby that would otherwise exempt it too) against
// this post-T184 version —
//
//   Site 1 (Dockerfile, "the guard checks that the build order matches
//     ... prepack"): CATCHABLE (already true pre-T184; unaffected).
//   Site 2 (README.md, the `.dockerignore`-exclusion claim): not caught —
//     no `denyingPhrase` describes this claim at all (T187).
//   Site 3 (README.md, "... concluded that 'this packaging path cannot
//     silently skip the T43A1 bundling invariant'"): CATCHABLE — this one
//     was always in-phrase-coverage; the P6-W23 note's "two catchable"
//     count already included it, confirmed unaffected here.
//   Site 4 (nix/README.md, the provenance/`REQUIRED_WORKSPACE_BUILD_
//     STEPS` claim, adjacent to the legitimately-past-tense
//     "order-insensitive" sentence `guard-capability-prose.mjs`'s
//     `denyingPhrases` doc comment deliberately excludes): not caught —
//     no phrase describes it (T187).
//   Site 5 (this file's own `~30`, "this used to call that 'the exact
//     failure mode T171 guards on the OUTPUT side ...'"; SELF-file):
//     not caught. Pre-T184 this was invisible for a STRUCTURAL reason
//     (self-exclusion); post-T184 it is visible and evaluated like every
//     other site, and simply has no matching phrase — the same reason as
//     Site 2 and Site 4, not a different one.
//   Site 6 (this file's own `~160`, the "comment-free by construction"
//     claim; SELF-file): not caught, same reason as Site 5.
//
// So: two catchable (unchanged), four not caught for phrase-coverage
// reasons (T187's question) — but where the P6-W23 note split those four
// into "two out of phrase coverage" and "two structurally uncatchable",
// there is now only one category: every one of the six sites is
// structurally visible to this guard, and whether each SHOULD be
// phrase-matched (Site 4 arguably should not — see the "order-insensitive"
// exclusion reasoning above) is entirely T187's to decide. This guard does
// not widen `denyingPhrases` itself.
//
// (Note for the next reader: "Site 5 (this file's own `~30`...)" and
// "Site 6 (this file's own `~160`...)" above both meant
// `scripts/ci/guard-docker-packaging-paths.mjs` — the sole declaring file
// for `findBuildOrderViolations`, which is also where two of the six
// sites live — not THIS file, `run-guard-capability-prose.mjs`. Left as
// written per "keep the record"; flagging the imprecision here rather
// than editing it, since it does not change which six sites were meant or
// what was measured about them.)
//
// CLOSED (T187): re-measured all six sites directly against
// `run-guard-capability-prose.mjs` on the committed tree, one at a time —
// each site's own `CORRECTED`-quoted false sentence, reconstructed
// UNMARKED and appended as a comment to the file it originally lived in,
// then removed again (never `git checkout --`, per CLAUDE.md's "re-read
// HEAD before you commit a shared file" caution about that command; a
// saved scratch copy restored the file each time):
//
//   Site 1 (Dockerfile): exit 1 — CATCHABLE, unaffected by T187.
//   Site 2 (docker/README.md, `.dockerignore`-exclusion claim): exit 0.
//   Site 3 (docker/README.md, T43A1-bundling-invariant claim): exit 1 —
//     CATCHABLE, unaffected by T187.
//   Site 4 (nix/README.md, `REQUIRED_WORKSPACE_BUILD_STEPS` provenance
//     claim): exit 0.
//   Site 5 (guard-docker-packaging-paths.mjs, the T171-equivalence
//     overclaim): exit 0.
//   Site 6 (guard-docker-packaging-paths.mjs, the comment-free-by-
//     construction claim): exit 0 — WIDENED below.
//
// Decision, per site, recorded in full (with the RED/GREEN proof and the
// whole-scope collision grep for the new phrase) in
// `guard-capability-prose.mjs`'s own entry comment and pinned by
// `guard-capability-prose.test.mjs`'s "T187" test block — summarized
// here so this qualification's own record stays accurate without having
// to repeat the reasoning twice:
//
//   - Sites 1 and 3 needed nothing; already catchable.
//   - Site 6 was WIDENED: a third `denyingPhrase` now matches it. It is
//     squarely a denial of this capability's own "T178's
//     comment-awareness" half (the entry's header names both halves) —
//     T178 shipped active comment-stripping precisely because the
//     extracted RUN/phase text was NOT comment-free "by construction",
//     so a sentence denying that stripping is necessary denies a real,
//     shipped part of this capability. RED/GREEN and a whole-scope grep
//     (exactly one hit, the real marked site) both confirm this.
//   - Sites 2, 4, and 5 were deliberately left UNWIDENED, each for its
//     own reason, not swept together: Site 2 denies a different,
//     still-genuinely-absent capability (`.dockerignore`-exclusion
//     checking, unrelated to build order); Site 4 denies a
//     provenance/implementation-detail (a hardcoded array vs a live
//     manifest read) that is likely to stay accurate indefinitely; Site 5
//     denies false EQUIVALENCE to a different guard (T171), and the
//     correction's own true relationship — "strictly weaker", by
//     permanent design — would itself become a forbidden-forever
//     statement if phrase-matched. None of the three denies that
//     `findBuildOrderViolations` (or its comment-awareness) exists, which
//     is the only thing this guard's `denyingPhrases` mechanism can
//     safely encode without eventually forbidding an accurate sentence.
//
// So: three catchable (1, 3, 6) and three sites this guard deliberately
// never phrase-matches, in writing, with a stated reason each — not
// "structurally uncatchable" (T184 already closed that) and not merely
// "unmeasured" (this closes that too). Nothing here is expected to need
// re-deciding unless a future task changes what any of the three unmatched
// sites actually claims.
//
// Widened to the two DEMONSTRATED trees only, per plan.md's "curated, not
// generic" mandate for this guard:
//  - `scripts/ci/*.mjs` — this repository's own guards, which carry doc
//    comments describing what OTHER guards (and capabilities) do or don't
//    do; exactly where the two P6-W20/W21 `scripts/ci` sites lived. Test
//    files ARE included (unlike `isShippedSourcePath`'s exclusion of
//    `.test.mjs`, which exists so a fake CAN'T count as "shipped") because
//    a false claim in a guard's own `.test.mjs` title is exactly as live a
//    defect as one in its body — the apps/web|android side has worked this
//    way from the start (one of the original ten P6-W6 sites was a test
//    title, not a doc comment).
//  - `packaging/**` — narrative prose about the packaging pipeline
//    (`Dockerfile`, `README.md`, `flake.nix`), exactly the tree all four
//    P6-W20 packaging sites lived in.
//
// Deliberately NOT widened to `.github/**` (arguable: workflow YAML is
// step definitions, not narrative prose, and no demonstrated false site
// lives there — nothing forces adding a tree "just in case") or `docs/**`
// (wrong: `docs/issues-from-plan.md`'s ledger is full of historical task
// briefs that correctly described a capability as absent AT THE TIME they
// were written — including this very task's own writeup, which says "The
// denial scan was never widened" about a state this exact commit makes
// false. Scanning `docs/` would turn the ledger of past and in-flight work
// into a permanent, unfixable source of guard failures against its own
// history).
const SCRIPTS_CI_DENIAL_PREFIX = "scripts/ci/";
const PACKAGING_PREFIX = "packaging/";
// Curated, not "every extension under packaging/" — matches what the
// demonstrated sites actually are: `Dockerfile` (no extension at all),
// `README.md`, and `flake.nix`.
const PACKAGING_EXTENSIONS = new Set([".md", ".nix"]);

// T179: found live, by actually running the widened guard against this
// repository before committing to the widening (exactly what this task's
// own brief asked for) — the three files that MAKE this guard are not
// ordinary `scripts/ci` prose, they are the DEFINITION of what a denying
// phrase is, and describing that necessarily involves citing examples of
// the exact wording a past false claim used. `guard-capability-prose.mjs`
// deliberately quotes historical false sentences in its `CAPABILITIES`
// list and header comments (documentation of what USED to be wrong, most
// without one of `HISTORICAL_QUOTE_MARKERS`' exact-phrase triggers
// immediately before them — the header instead says things like "...had
// already made false: ..."); `guard-capability-prose.test.mjs`'s fixtures
// construct those same sentences as literal `content` strings by design,
// to prove the matcher works, the way a profanity filter's test suite has
// to contain profanity; and even THIS file's own explanatory comment,
// immediately above, needed one such example to describe the problem and
// tripped over it live during authorship — proof by construction that no
// file whose job is to talk ABOUT denying phrases can safely stay in this
// scan. Naively widening the denial scan to `scripts/ci` without this
// exclusion made the guard fail against its own committed source on every
// run — first 60+ self-inflicted violations naming the first two files
// below, then one more in this file once its own doc comment was written.
//
// Excluding exactly these three files — never `scripts/ci` at large —
// keeps the widening's real target (every OTHER `scripts/ci` guard, which
// is where the demonstrated P6-W20/P6-W21 sites actually lived) fully in
// scope. See `guard-capability-prose.test.mjs`'s "T179: guard-capability-
// prose.mjs and its own test file are excluded" cases.
const SELF_REFERENTIAL_DENIAL_EXCLUSIONS = new Set([
  "scripts/ci/guard-capability-prose.mjs",
  "scripts/ci/guard-capability-prose.test.mjs",
  "scripts/ci/run-guard-capability-prose.mjs",
]);

function isPackagingProsePath(path) {
  if (!path.startsWith(PACKAGING_PREFIX)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (basename === "Dockerfile") return true;
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && PACKAGING_EXTENSIONS.has(basename.slice(dot));
}

/**
 * Whether `path` is in scope for the denial-prose scan itself — T179:
 * `apps/web/src`, `apps/android/src`, `scripts/ci`, and `packaging/**`,
 * except this guard's own three files (see
 * `SELF_REFERENTIAL_DENIAL_EXCLUSIONS`).
 * Comments AND test files both included throughout (one of the ten P6-W6
 * sites this guard exists to catch was a test title, not a doc comment).
 */
export function isAppSourcePath(path) {
  if (SELF_REFERENTIAL_DENIAL_EXCLUSIONS.has(path)) return false;
  if (APP_SRC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return hasSourceExtension(path);
  }
  if (path.startsWith(SCRIPTS_CI_DENIAL_PREFIX)) {
    return hasSourceExtension(path);
  }
  return isPackagingProsePath(path);
}

function readFiles(paths) {
  return paths.map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

export function main() {
  const tracked = listTrackedFiles();

  const shippedPaths = tracked.filter(isShippedSourcePath);
  const appPaths = tracked.filter(isAppSourcePath);

  const shippedFiles = readFiles(shippedPaths);
  const appFiles = readFiles(appPaths);

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  if (violations.length === 0) {
    console.log(
      `guard-capability-prose: OK — ${CAPABILITIES.length} capability group(s) checked against ` +
        `${shippedPaths.length} packages/*/src|apps/*/src|scripts/ci file(s) and ${appPaths.length} ` +
        `apps/web|android src + scripts/ci + packaging/** file(s); no live denial found for a ` +
        `shipped capability.`,
    );
    return;
  }

  console.error("guard-capability-prose: FAILED");
  for (const violation of violations) {
    console.error(
      `  ${violation.path}: "${violation.capability}" is a real, shipped capability, but this ` +
        `file's prose asserts it is absent:`,
    );
    console.error(`    ...${violation.context}...`);
  }
  console.error(
    "  Fix the prose to describe what the codebase actually does today (or, if the capability " +
      "genuinely regressed, remove/adjust its entry in scripts/ci/guard-capability-prose.mjs's " +
      'CAPABILITIES list). A quoted historical correction ("CORRECTED: this said ...") is exempt — see ' +
      "that file's header comment.",
  );
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
