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
// T246: the shipped-source scan required `<pkg-or-app>/src/` or
// `scripts/ci`, so a capability declared in an app-ROOT config file — one
// Expo (or another app tool) evaluates directly, outside `src/` — was
// invisible to it. T235 shipped `computeVersionCodeFromSemver` in
// `apps/android/app.config.ts` and falsified two runbooks that asserted the
// capability was absent; the DENIAL side already saw both runbooks
// (`isAppSourcePath` admits `docs/**`), but the SHIPPING side could never
// see the file the capability actually lives in, so a `CAPABILITIES` entry
// for it would have exited 0 forever no matter how false the docs became —
// the P9-A merge gate measured exactly that (`isAppSourcePath=false`,
// `isShippedSourcePath=false` for `apps/android/app.config.ts`).
//
// Curated to the single demonstrated shape, not `apps/*/*.ts` at large:
// `apps/<name>/app.config.ts` only. Measured directly against `git
// ls-files` at authorship: exactly one file matches —
// `apps/android/app.config.ts` — because `apps/web` has no `app.config.ts`
// of its own (it is a Vite app; its equivalent root config,
// `vite.config.ts`, is a build-tool config with no analogous "capability
// worth protecting" identified, and is deliberately NOT included here per
// this task's narrow scope). If a second app ever grows an `app.config.ts`,
// this pattern picks it up the same way `SHIPPED_SRC_PATTERN` above already
// generalizes across every `<pkg-or-app>/src/` without hardcoding each one.
//
// T314 (decided at the P9-U wave, and this is the criterion that task left
// open): `apps/<name>/metro.config.js` is admitted too, for the same reason
// and by the same test. T314 shipped two real capabilities in
// `apps/android/metro.config.js` — `RELATIVE_JS_SPECIFIER` (Metro retries a
// relative `./x.js` specifier as `./x`, which is what 207 unresolvable
// specifiers needed) and `WEB_FILE_BLOCK_PATTERN` (the `*.web.*` blocklist
// anchored to this app's OWN `src/`, so a dependency's `Bounce.web.ts` is no
// longer blocked). Both are real, uniquely-declared names: measured with
// `git grep -w` across `packages/*/src`, `apps/*/src`, `scripts/ci` and
// every app-root config, each appears in exactly one file, this one. So the
// T246 test above is satisfied — this config declares capabilities worth
// protecting, not bare config values — and a will-not-widen note would have
// had to argue that away.
//
// Measured before trusting it, per T246's own discipline: `git ls-files`
// matches exactly one file today, `apps/android/metro.config.js`
// (`apps/web` is a Vite app and has no Metro config), and NONE of the
// existing `CAPABILITIES` entries' members appears anywhere in it — checked
// by running every entry's `methodNames` against the real file's text — so
// this widening cannot change the shipped verdict of any entry but the two
// T314 registers.
//
// The DENIAL side is deliberately NOT widened to this file. Its header
// narrates the pre-fix state at length ("Metro appends its `sourceExts` to
// the specifier as given") without a `HISTORICAL_QUOTE_MARKERS` trigger, so
// admitting it to the denial scan would risk the self-narration collision
// T179 and T215 each had to resolve — and no denial site has ever been
// found there, only in `docs/**`, which the denial scan already reaches.
const APP_ROOT_CONFIG_PATTERN = /^apps\/[^/]+\/(?:app\.config\.ts|metro\.config\.js)$/;
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
// loader) + 25 non-test `scripts/ci` `.mjs` = 1198, what this runner
// reported at that gate (P6-W16). It recomputes fresh on every run, so
// treat that figure as a dated snapshot, not the current count (T218).
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
 * directory, (T156) `scripts/ci`, or (T246, widened by T314) an app-root
 * `app.config.ts` or `metro.config.js` — excluding test files (a fake/mock
 * under a `.test.ts`/`.test.mjs` must never be able to make the guard
 * believe a capability is real). The app-root branch names whole filenames,
 * so neither `app.config.ts` nor `metro.config.js` can BE a test file and
 * that branch needs no test-file check of its own; `app.config.test.ts` and
 * `metro.config.test.ts` both exist in this tree and neither matches.
 * Exported so `guard-capability-prose.test.mjs` can prove the widened scope
 * directly, not by re-deriving an equivalent regex.
 */
export function isShippedSourcePath(path) {
  // The app-root branch names each whole filename, extension included, so
  // it carries its own extension check. Routing it through
  // `hasSourceExtension` as well would silently exclude
  // `metro.config.js`: `.js` is deliberately not in `SOURCE_EXTENSIONS`,
  // and widening that set to admit one config file would newly admit every
  // `.js` under every `src/` tree — far past what this decision measured.
  if (APP_ROOT_CONFIG_PATTERN.test(path)) return true;
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
// then removed again (never `git checkout --`; a saved scratch copy
// restored the file each time). CORRECTED (P6-W25 merge gate): this
// attributed the restore-from-scratch rule to CLAUDE.md's "re-read HEAD
// before you commit a shared file" caution. CLAUDE.md contains neither
// phrase — that wording is HANDOFF.md's and
// `run-guard-no-wave-self-revert.mjs`'s, and it is about the P5-W22
// concurrent-edit failure mode, not about `git checkout --` at all. The
// rule this comment follows comes from the wave prompt.
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
// lives there — nothing forces adding a tree "just in case").
//
// CORRECTED (T197): this paragraph previously said `docs/**` was also
// deliberately left out, reasoning that `docs/issues-from-plan.md`'s
// ledger is full of historical task briefs that correctly described a
// capability as absent AT THE TIME they were written, and that scanning
// `docs/` would turn that ledger into "a permanent, unfixable source of
// guard failures against its own history". That reasoning was right about
// the ledger and wrong about the conclusion: T197 was filed BECAUSE P8-W5
// shipped a 370-line `docs/legacy-retirement.md`, almost entirely
// capability claims, that this guard could not see at all — the same
// "curated entry the runner's scope can never see" shape T147 and T156
// each closed one directory over. The ledger's own hazard is real (proven
// below, by running the widened scan against the real, committed tree
// before committing to it, exactly as T179's own paragraph above did for
// `scripts/ci`): 13 violations, across all six then-CAPABILITIES entries
// with a shipped member, every one of them inside
// `docs/issues-from-plan.md` narrating a PAST wave's already-fixed defect
// (a task brief quoting the exact denying sentence a prior gate corrected,
// most without one of `HISTORICAL_QUOTE_MARKERS`' exact-phrase triggers
// immediately before the quotation — the ledger instead says things like
// "which was already false" or "stay narrow deliberately and were never
// meant to fire on"). Zero violations came from any of the other ten
// tracked `docs/*.md` files, `docs/legacy-retirement.md` included (whose
// three `CORRECTED (P8-W5 merge gate)` markers all worked correctly in
// this same run). So the fix is the same shape T179 used for its own
// three self-referential files below, one directory up: exclude the ONE
// file demonstrated to trip on its own historical narration, not the tree
// that file happens to live in. `DOCS_LEDGER_DENIAL_EXCLUSIONS` is that
// exclusion, checked the same way `SELF_REFERENTIAL_DENIAL_EXCLUSIONS` is.
const SCRIPTS_CI_DENIAL_PREFIX = "scripts/ci/";
const PACKAGING_PREFIX = "packaging/";
// Curated, not "every extension under packaging/" — matches what the
// demonstrated sites actually are: `Dockerfile` (no extension at all),
// `README.md`, and `flake.nix`.
const PACKAGING_EXTENSIONS = new Set([".md", ".nix"]);
// T197: `docs/` narrative prose (`.md` only — every tracked `docs/` file is
// Markdown today; a future non-.md addition should be judged on its own
// merits rather than silently admitted). `docs/legacy-retirement.md` (the
// file that motivated this task) and the four reference-only Paseo
// documents CLAUDE.md names (`docs/T02-provenance.md`, `T03`, `T04`,
// `docs/frontend-data-migration.md`, `docs/pi-extension-compatibility.md`)
// all scan clean today — measured directly, see this file's header note
// above and `guard-capability-prose.test.mjs`'s "T197" cases.
const DOCS_PREFIX = "docs/";
const DOCS_EXTENSIONS = new Set([".md"]);
// T207: found live, the same way T179 and T197 each found their own gap
// — by tracing where a real false-premise site actually lived and
// checking this scan could see it. The P8-W10 merge gate wrote a
// "cannot pass as written" disclosure into THREE places once T207's own
// dependency (T43B2b) shipped a defect it couldn't yet fix:
// `.github/workflows/android-maestro-e2e.yml`'s header and its
// `packaged-app-smoke` run step, and `apps/android/maestro/README.md`.
// None of the three is under `apps/web/src`, `apps/android/src`,
// `scripts/ci`, `packaging/**`, or `docs/**` — the widened scan would
// have exited 0 with all three still reading "cannot pass" the moment
// T207 made that false, the identical shape T179 and T197 each closed
// for their own trees. `.github/workflows/` (`.yml` only — the three
// files there today are all `.yml`) and `apps/android/maestro/` are the
// two prefixes this widening adds.
//
// T281: DECISION — WIDEN `apps/android/maestro/` from `.md` alone to
// `.md`+`.yaml`. T207's own comment (above, left standing rather than
// rewritten, per CLAUDE.md's "leave a correction in place" preference for
// a decision that was right at the time) reasoned that the flow `.yaml`
// files were "governed by `guard-no-production-daemon-port.mjs`'s
// narrower rule, not this one" — true as far as it goes, but that guard
// checks ONLY for a literal production-daemon-port mention; it has never
// scanned for a capability-denial sentence, and nothing else did either.
// The P9-O merge gate found two of its seven falsified prose sites sitting
// in exactly this blind spot: `apps/android/maestro/composer-inputs.yaml`'s
// own narrative comments (the same "TWO OF FOUR INPUT MODES..." block
// `README.md` — already in scope — narrates prose in) asserted the mic
// action ran "over the same outbox/sessionId/onSubmit a text send uses"
// and that `handleMicPress` was "real end to end since T276", both false
// the moment T277 landed in the same wave — structurally invisible to
// this guard the whole time, the same "check that cannot fail" shape
// T246 and T254 each closed one directory over.
//
// MEASURED before widening, per this task's own instruction (the same
// discipline T246 used for `APP_ROOT_CONFIG_PATTERN`): `git ls-files
// 'apps/android/maestro/*.yaml'` returns exactly 14 files (plus one
// `shards.json`, already excluded — no extension this set admits) at
// authorship. Running the widened scan against the real, committed tree
// (all 14 read as `appFiles` alongside `README.md`) produced ZERO new
// violations against the then-27 real `CAPABILITIES` entries — every one
// of these 14 files is Maestro flow YAML with narrative `#`-comments
// describing what the flow proves, the same genre `README.md` already
// carries, not adversarial or profanity-filter-shaped content the way
// this guard's own three self-referential files are. No new exclusion
// was needed the way `SELF_REFERENTIAL_DENIAL_EXCLUSIONS` was for those
// three, or `DOCS_LEDGER_DENIAL_EXCLUSIONS` was for the task ledger.
const WORKFLOWS_PREFIX = ".github/workflows/";
const WORKFLOWS_EXTENSIONS = new Set([".yml"]);
const MAESTRO_PREFIX = "apps/android/maestro/";
const MAESTRO_EXTENSIONS = new Set([".md", ".yaml"]);
// T197: `docs/issues-from-plan.md` is the repository's own task ledger —
// CLAUDE.md calls it out by name as governing task scope, so it is not one
// of the "reference-only" documents this task's brief warned about, and it
// is not a place a Paseo doc's OLD description of a different product could
// leak from. It is excluded for a narrower, demonstrated reason: it
// narrates, in its own voice, exactly the kind of past-tense capability
// history `guard-capability-prose.mjs`'s own header describes about
// itself — quoting a prior wave's false claim to explain what a gate
// corrected — and it does so overwhelmingly without one of
// `HISTORICAL_QUOTE_MARKERS`' triggers immediately before the quotation
// (a ledger entry says "was already false" or "which stay narrow
// deliberately", not "CORRECTED: this said"). Measured directly against
// the real, committed tree: including `docs/issues-from-plan.md` in the
// denial scan produces exactly 13 violations, none of them a genuine
// present-tense denial of a shipped capability — see this file's header
// note for the count broken down by capability. Excluding exactly this
// one file, the same way `SELF_REFERENTIAL_DENIAL_EXCLUSIONS` excludes
// exactly three `scripts/ci` files rather than `scripts/ci` at large,
// keeps the widening's real target (every OTHER `docs/*.md` file, which is
// where `docs/legacy-retirement.md` — the file that motivated this task —
// actually lives) fully in scope.
const DOCS_LEDGER_DENIAL_EXCLUSIONS = new Set(["docs/issues-from-plan.md"]);

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

// T295: DECISION — WIDEN. The P9-Q merge gate found `packages/client/src/
// daemon-client.ts` asserting "Not yet called by either app" about
// `requestAttachmentDownloadToken` — a sentence T284 falsified in the same
// wave that wrote it, and one no guard could have caught: `isAppSourcePath`
// never reached a package's own `src/` tree at all. That is
// `isShippedSourcePath`'s scope, and conflating the two is the error
// CLAUDE.md already documents at T147, T216, T217 and T224.
//
// This task decided the question by measuring, not by assuming the answer —
// the honest case AGAINST widening is real: `packages/*/src` is where the
// wire protocol and both clients live, dense with legitimately-conditional
// prose ("no shipped `DaemonClient` implements this", "not wired by any
// caller yet") that is true when written and becomes false silently, which
// is also exactly the shape most likely to produce false positives and get
// this guard disabled (CLAUDE.md's T217 section).
//
// MEASURED before widening: every one of the real `CAPABILITIES` entries'
// `denyingPhrases`, run through the real `findCapabilityDenialViolations`,
// against every tracked `packages/*/src` file — first the 645 non-test
// files, then again against all 1106 files with `.test.ts`/`.test.tsx`/
// `.test.mjs` included (the same treatment `apps/web/src`, `apps/android/
// src` and `scripts/ci` already get from this scan, and the treatment this
// widening gives `packages/*/src` too, below) — produced ZERO violations in
// both runs. The dense, legitimately-conditional prose this file's own
// package source carries did not trip a single existing entry.
//
// The pattern check this task's own brief required (a search of
// `docs/issues-from-plan.md` and the real tree's own `CORRECTED` markers,
// not just the one P9-Q instance) found the identical defect shape landing
// in `packages/*/src` at least three times, none of them ever reachable by
// this guard: `packages/frontend-core/src/actions/arbitration.ts` carried
// "[agent_permission_resolved] had no client identity field" until the
// P6-W7 merge gate corrected it once T111 added exactly that field in the
// same wave; `packages/server/src/server/daemon-e2e/queue-mode-routing.e2e.
// test.ts` carried a stale present-tense mention of a retired queue-mode-
// visibility mechanism, corrected by hand at a later gate and explicitly
// disclosed there as outside that task's own `Owns` grant; and this file's
// `daemon-client.ts`/`requestAttachmentDownloadToken` sentence is the third.
//
// No new exclusion (`SELF_REFERENTIAL_DENIAL_EXCLUSIONS`- or
// `DOCS_LEDGER_DENIAL_EXCLUSIONS`-shaped) was needed: none of this guard's
// own three self-referential files live under `packages/*/src`, and every
// `packages/*/src` file measured above that narrates its own past mistakes
// (`daemon-client.ts`, `arbitration.ts`, and others) already does so with a
// "CORRECTED ... this said" marker `HISTORICAL_QUOTE_MARKERS` already
// exempts — confirmed directly by the zero-violation runs above, which
// included every one of those files' real, committed text, not a synthetic
// stand-in.
//
// `packages/*/src` now joins the denial scan the same way `apps/web/src`
// and `apps/android/src` already do: every source-extensioned file, with
// test files INCLUDED (not excluded the way `isShippedSourcePath` excludes
// them) — the same reasoning already given for those two trees and for
// `scripts/ci` applies unchanged: a false denial in a package's own test
// title is exactly as live a defect as one in its doc comment, and the
// `queue-mode-routing.e2e.test.ts` instance above is a real example of it.
const PACKAGES_SRC_DENIAL_PATTERN = /^packages\/[^/]+\/src\//;

function isPackagingProsePath(path) {
  if (!path.startsWith(PACKAGING_PREFIX)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (basename === "Dockerfile") return true;
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && PACKAGING_EXTENSIONS.has(basename.slice(dot));
}

// T197: see `DOCS_LEDGER_DENIAL_EXCLUSIONS`'s own doc comment above for why
// exactly one file is excluded rather than `docs/` at large.
function isDocsProsePath(path) {
  if (DOCS_LEDGER_DENIAL_EXCLUSIONS.has(path)) return false;
  if (!path.startsWith(DOCS_PREFIX)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && DOCS_EXTENSIONS.has(basename.slice(dot));
}

// T207: see `WORKFLOWS_PREFIX`/`MAESTRO_PREFIX`'s own comment above for
// why these two were added. Same curated-extension shape as
// `isPackagingProsePath`/`isDocsProsePath` above, not "everything under
// the prefix."
function isWorkflowsProsePath(path) {
  if (!path.startsWith(WORKFLOWS_PREFIX)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && WORKFLOWS_EXTENSIONS.has(basename.slice(dot));
}

function isMaestroProsePath(path) {
  if (!path.startsWith(MAESTRO_PREFIX)) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot !== -1 && MAESTRO_EXTENSIONS.has(basename.slice(dot));
}

// T254: DECISION — WIDEN. `isShippedSourcePath` above admits an app-root
// config file (`APP_ROOT_CONFIG_PATTERN`, T246) but `isAppSourcePath` did
// not, so `apps/android/app.config.ts` could DECLARE a capability but could
// never be caught DENYING one — including a denial of the capability it is
// itself about. The P9-E merge gate found a live instance: T247 shipped
// `checkAndroidReleaseTagVersion`, and `app.config.ts`'s own decision record
// carried a "GAP FILED ... nothing enforces that a human actually bumps
// `version` before pushing a new release tag" block describing exactly the
// step T247 had just shipped, invisible to this scan while its two sibling
// runbooks (both under `docs/**`, already in scope) were not.
//
// The risk this task's brief named before widening: `app.config.ts` is a
// long, deliberately narrative decision record, and one registered entry's
// own comment (`checkAndroidReleaseTagVersion`'s, in
// `guard-capability-prose.mjs`) reasons about avoiding a phrase collision
// with that file's prose — a collision impossible today only because this
// function returned `false` for it. Widening makes that reasoning
// load-bearing rather than hypothetical, so it had to be measured, not
// assumed, before landing.
//
// MEASURED (T254): every one of the 23 `CAPABILITIES` entries' phrases run
// against the real, current `apps/android/app.config.ts` content (via
// `findCapabilityDenialViolations` with that file as the sole `appFiles`
// entry and the real repository as `shippedFiles`, so every entry resolved
// "shipped" exactly as it would in production) — zero violations. The one
// entry that explicitly worried about this (`checkAndroidReleaseTagVersion`)
// is safe for a stated reason: its target sentences in `app.config.ts` are
// the "GAP CLOSED by T247 (P9-E)" block's OWN quotation of the pre-fix text,
// which sits after "This block previously said", one of
// `HISTORICAL_QUOTE_MARKERS`' exact triggers — the same exemption that
// already protects every other historical quotation this guard scans.
// `computeVersionCodeFromSemver`'s entry does not mention `app.config.ts`'s
// prose at all (its `denyingPhrases` were deliberately worded away from that
// file's own wording, per its own comment) and was unaffected either way.
// See this task's own report for the executed script and its full output.
//
// So: widened. `apps/android/app.config.ts` now joins the denial scan the
// same way it already joined the shipped-source scan under T246 — using the
// identical `APP_ROOT_CONFIG_PATTERN`, so a second app's future
// `app.config.ts` is picked up by both sides symmetrically, never only one.
//
/**
 * Whether `path` is in scope for the denial-prose scan itself — T179:
 * `apps/web/src`, `apps/android/src`, `scripts/ci`, and `packaging/**`;
 * T197 added `docs/**`; T207 added `.github/workflows/*.yml` and
 * `apps/android/maestro/*.md`; T254 added `apps/<name>/app.config.ts` (the
 * same `APP_ROOT_CONFIG_PATTERN` `isShippedSourcePath` already used); T281
 * widened the maestro half to `apps/android/maestro/*.yaml` as well (see
 * `MAESTRO_EXTENSIONS`'s own comment for the measurement); T295 added every
 * package's own `src/` tree (see `PACKAGES_SRC_DENIAL_PATTERN`'s own comment
 * for the measurement that justified it) — except this guard's own three files
 * (see `SELF_REFERENTIAL_DENIAL_EXCLUSIONS`) and the task ledger,
 * `docs/issues-from-plan.md` (see `DOCS_LEDGER_DENIAL_EXCLUSIONS`).
 * Comments AND test files both included throughout (one of the ten P6-W6
 * sites this guard exists to catch was a test title, not a doc comment).
 */
export function isAppSourcePath(path) {
  if (SELF_REFERENTIAL_DENIAL_EXCLUSIONS.has(path)) return false;
  if (APP_SRC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return hasSourceExtension(path);
  }
  if (PACKAGES_SRC_DENIAL_PATTERN.test(path)) {
    return hasSourceExtension(path);
  }
  if (path.startsWith(SCRIPTS_CI_DENIAL_PREFIX)) {
    return hasSourceExtension(path);
  }
  if (APP_ROOT_CONFIG_PATTERN.test(path)) return true;
  if (isPackagingProsePath(path)) return true;
  if (isWorkflowsProsePath(path)) return true;
  if (isMaestroProsePath(path)) return true;
  return isDocsProsePath(path);
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
        `${shippedPaths.length} packages/*/src|apps/*/src|scripts/ci|app-root config file(s) ` +
        `and ${appPaths.length} ` +
        `packages/*/src + apps/web|android src + scripts/ci + packaging/** + docs/** + ` +
        `.github/workflows/*.yml + apps/android/maestro/*.md|*.yaml + apps/*/app.config.ts ` +
        `file(s); no live denial found for a shipped capability.`,
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
