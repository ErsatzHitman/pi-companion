// T124: CI guard — a named capability shipped anywhere in this
// repository's real source (not just `packages/client/src`) may not
// coexist with prose in `apps/web/src`, `apps/android/src`, `scripts/ci`,
// `packaging/**` (T179 widened the denial scan to the latter two), `docs/**`
// (T197), or `.github/workflows/*.yml`/`apps/android/maestro/*.md` (T207)
// asserting that capability is absent. `run-guard-capability-prose.mjs`'s
// `isAppSourcePath` is the authoritative scope check — read it rather than
// trusting this list, which cannot watch itself.
//
// The history this encodes: at P6-W6, T110 landed as the wave's FIRST
// commit (adding real `getQueueModes`/`setSteeringMode`/`setFollowUpMode`
// sends to `packages/client/src/daemon-client.ts`) and T38B1a — written
// against the PRE-T110 tree — landed as its fourth, so ten sites across
// six files shipped stating a premise T110 had already made false: "no
// shipped `DaemonClient` implements this", "not implemented by any shipped
// `DaemonClient`", "true of every real `DaemonClient`", "no wire request to
// change it today". The worst (`Composer.tsx`'s header) described what a
// user sees and had it backwards. All ten were corrected at the P6-W6
// merge gate (`dabe8c4`); this guard is what stops an eleventh.
//
// T147: the P6-W12 merge gate proved the ORIGINAL version of this guard —
// which computed "shipped" from `packages/client/src` only — is inert for
// any capability that lives somewhere else. It added a real `CAPABILITIES`
// entry naming `useClipboardAction` (a hook in
// `apps/web/src/features/transcript/tool-call-row.tsx`, not
// `packages/client/src`) with the exact live denying phrase then in
// `CopyableField.tsx`, ran the guard, and got exit 0 with the false prose
// still in the tree. `run-guard-capability-prose.mjs` now treats every
// `packages/*/src` and `apps/*/src` (test files excluded) as "shipped"
// source, and `isCapabilityMemberDeclared` below recognizes more
// declaration shapes than a `Promise`-returning method, because T139's
// capability is a plain function/hook and T143's compaction fields
// (`packages/frontend-core/src/timeline/transcript-view.ts`'s
// `CompactionTranscriptEntry.summary` etc.) are plain interface
// properties, not methods.
//
// Deliberately narrow, per plan.md's usability requirement for this task:
// a curated `CAPABILITIES` list, each entry a group of member names plus
// the specific phrases that would be false once any of them exists. This
// is NOT a generic "grep every comment for every identifier" linter — that
// produces false positives forever and gets disabled within two waves.
// Widening WHERE shipped source is looked for (T147) is not the same
// change as widening WHAT gets flagged: `CAPABILITIES` stays a short,
// hand-curated list, and `denyingPhrases` stay specific quoted/paraphrased
// sentences, never a bare identifier. Add an entry here the moment a task
// ships a capability; the value is in the NEXT one, not the ones seeded
// below.
//
// Historical corrections are excluded on purpose. `dabe8c4`'s fix left
// several of these files QUOTING the false sentence verbatim, inside a
// "CORRECTED (P6-W6 merge gate): this said ..." explanation — e.g.
// `agent-turn-client.ts` now reads `this said "as of P6-W6 no shipped
// \`DaemonClient\` implements this"`. A naive phrase match trips on that
// quotation and fails the guard against its OWN fix — defect class 4 in
// this repository's catalogue ("a prohibition tripped by its own doc
// comment"), reproduced here one level up: the corrected file's comment,
// not the guard's own source. `HISTORICAL_QUOTE_MARKERS` is the deliberate
// handling: a denying phrase preceded (within the same explanation) by a
// marker like "CORRECTED" or "this said" is a citation of a past mistake,
// not a live claim, and is not a violation. See
// `guard-capability-prose.test.mjs`'s "does not flag a CORRECTED historical
// quotation" cases, each proven by deleting the marker and confirming the
// same input then fails.
//
// Pure, dependency-free check function only (beyond the shared, equally
// pure `./source-comment-stripper.mjs` — see T244 near `stripComments`
// below). `run-guard-capability-prose.mjs` is the CLI entry point CI
// actually runs; this module stays import-safe so `guard-capability-
// prose.test.mjs` can seed fixtures without touching the real working tree.

import { stripComments as sharedStripComments } from "./source-comment-stripper.mjs";

/**
 * @typedef {string | RegExp} CapabilityMember A group member naming a
 *   declaration to look for. A plain string is checked with
 *   `isCapabilityMemberDeclared` (name-based: method/function/const/
 *   interface-property shapes). A `RegExp` is tested directly against the
 *   file's comment-stripped source instead — see T169 below — for the case
 *   where a member NAME alone (`cancel`) cannot distinguish the capability's
 *   own declaration from an unrelated same-named member elsewhere in the
 *   SAME file.
 * @typedef {{ name: string, methodNames: (CapabilityMember | CapabilityMember[])[], denyingPhrases: RegExp[] }} Capability
 */
//
// T168: a `methodNames` entry is normally a single member (an OR across
// members, OR across files: "shipped" means ANY shipped file declares it).
// An entry MAY instead be an array group — a conjunction: "shipped" means
// some ONE shipped file declares EVERY member in that group. Use a group
// when a bare member name (`cancel`) is common enough elsewhere in the tree
// that it alone would keep an entry "shipped" even after the capability it
// names was removed (see the "transfer cancellation" entry below, and
// CLAUDE.md's "A shipped-gate token must disappear when the capability
// does"). Requiring the group's members to co-occur in one file ties
// "shipped" to the specific declaration this capability lives in (`cancel`
// returned alongside `useFileUpload`/`useFileDownload` from the same hook
// file) rather than to `cancel` existing anywhere at all (an approval
// dialog's own unrelated `cancel`, say).
//
// T169: co-occurrence in one FILE is not enough either, when the unrelated
// declaration shares BOTH the file and the bare name. T168's own archetype
// — `use-file-download.ts`'s `MinimalStreamReader.cancel?(reason?: unknown):
// Promise<void> | void`, declared in the very file `useFileDownload` lives
// in — satisfies `["useFileDownload", "cancel"]` by itself: `useFileDownload`
// is declared in that file, and so, in a completely unrelated shape, is
// something named `cancel`. Deleting `FileDownloadController.cancel` (the
// hook's own real cancel member) while leaving `MinimalStreamReader.cancel`
// in place left the entry "shipped" — reproduced against the real, committed
// file before this fix, and again as
// `guard-capability-prose.test.mjs`'s "T169: an unrelated cancel() in the
// SAME FILE as the hook, in a different shape, does not satisfy the shipped
// gate" test. The fix: a group member can be a `RegExp` matched against the
// declaration's actual SHAPE, not just its name, so `cancel` the controller
// method (`cancel: () => void`) and `cancel` the optional stream-reader
// callback (`cancel?(reason?: unknown): Promise<void> | void`) are
// distinguishable even when both live in the same file next to the same
// hook name.
//
// Matched against comment-stripped source, tolerant of the whitespace an
// interface property can carry (`cancel : ()  =>  void`), but anchored to
// the exact `() => void` arrow shape both `FileUploadController.cancel` and
// `FileDownloadController.cancel` declare — never a bare identifier, so it
// cannot be satisfied by mentioning "cancel" in prose.
const CONTROLLER_CANCEL_MEMBER = /\bcancel\s*:\s*\(\s*\)\s*=>\s*void\b/;

// T172: `summary` alone — as a bare member name run through
// `isCapabilityMemberDeclared` — is declared in 33 shipped files having
// nothing to do with compaction (`ModelThinkingPicker.tsx`,
// `QueueModePicker.tsx`, `ConnectForm.tsx`, `ShareChooserScreen.tsx`,
// `RecordList.tsx`, `packages/cli/src/commands/loop/inspect.ts`, and 27
// more), because the OR-across-bare-names shape below used to treat ANY of
// `summary`/`filesRead`/`filesModified` matching ANY shipped file as
// "shipped" — so the entry could never become false again once a single
// unrelated `summary?: string` field existed anywhere in the tree. Proven
// at the P6-W19 gate and reproduced again here: stripping the trio from all
// four files that actually declare it for compaction
// (`packages/protocol/src/agent-types.ts`,
// `packages/frontend-core/src/timeline/transcript-view.ts`,
// `packages/server/src/server/agent/agent-sdk-types.ts`,
// `apps/android/src/features/composer/turn-status-model.ts`) and
// re-inserting the exact pre-T146 sentence into `compaction-row.tsx` still
// exited 1 — a guard forbidding a now-true statement, worse than one that
// misses a false one (see CLAUDE.md's "A shipped-gate token must disappear
// when the capability does").
//
// T168's fix for `cancel` was an AND-group tying members to one file; a
// bare-name AND-group of `summary`+`filesRead`+`filesModified` gets most of
// the way there (only ~6-7 shipped files contain `filesRead`/`filesModified`
// at all, versus 33 for `summary` alone), but two of those six —
// `packages/protocol/src/messages.ts`'s zod schema (`filesRead:
// z.array(z.string()).optional()`) and `packages/server/src/server/agent/
// providers/pi/agent.ts`'s result-composition object (`{ filesRead:
// fileLists.readFiles }`) — genuinely carry the same wire values and would
// keep the bare-name AND-group "shipped" even after the trio is deleted
// from all four canonical declaring files, since neither of those two was
// ever asked to lose the fields. Per T169, the fix is a `RegExp` group
// member matching the declaration SHAPE, not just the name: these three
// patterns require an actual TypeScript field-type annotation (`: string`,
// `: string[]`, `: readonly string[]`, or `: ReadonlyArray<string>`), which
// a zod-schema property (`z.string()`, `z.array(z.string())`) or a
// plain-value object-literal construction (`{ filesRead: fileLists.readFiles
// }`) never has — so `messages.ts` and `pi/agent.ts` are correctly excluded
// as evidence while the four real declaring files (each of which types the
// field as shown) are correctly included. Measured directly: this group
// matches exactly those four files and no others across every tracked
// `packages|apps/*/src`+`scripts/ci` file — see
// `guard-capability-prose.test.mjs`'s "T172" cases.
const COMPACTION_SUMMARY_FIELD = /\bsummary\??\s*:\s*string\b/;
const COMPACTION_FILES_READ_FIELD =
  /\bfilesRead\??\s*:\s*(?:readonly\s+)?(?:string\[\]|ReadonlyArray<string>)/;
const COMPACTION_FILES_MODIFIED_FIELD =
  /\bfilesModified\??\s*:\s*(?:readonly\s+)?(?:string\[\]|ReadonlyArray<string>)/;

// T183 (HISTORICAL — see CLOSED (T184) and CORRECTED (T222) below):
// from T183 until T223 replaced it with the bare string below, this member
// was a `RegExp`. At the time it was chosen, that was NOT for T169's
// disambiguation reason (a bare `findBuildOrderViolations` collides with
// nothing — see the capability's own doc comment below) but for
// PERFORMANCE, for the reason the rest of this paragraph records.
// `isGroupMemberDeclared` only memoizes the comment-stripped source for
// `RegExp` members
// (`isRegexMemberDeclared`'s `strippedSourceCache`); a plain string member
// runs `isCapabilityMemberDeclared` — a fresh `stripComments` call, no
// caching — on every (appFile, shippedFile) pair the "is this shipped?"
// `.some()` walk visits. `scripts/ci/guard-docker-packaging-paths.mjs`
// (the sole declaring file) sorts near the very END of `git ls-files`'
// output (position ~2389 of 2429; the LAST of the ~1204 files
// `isShippedSourcePath` admits), so with a bare-string member every one of
// the ~905 denial-scan appFiles forces `.some()` to scan nearly the ENTIRE
// shipped-file list before finding it — none of the short-circuiting a
// declaring file earlier in `apps/`/`packages/` gets for free. Measured
// directly: `run-guard-capability-prose.mjs` with `methodNames:
// ["findBuildOrderViolations"]` (a bare string) ran in **6m0.591s**,
// against the ~3m49-3m51s baseline the P6-W22 gate measured with seven
// entries — almost exactly T179's own "quiet-path" cost for a member that
// cannot short-circuit at all (that commit measured 6m0.755s for a
// deliberately-unmatchable member, removed before commit rather than
// shipped). Switching this one member to a `RegExp` — reusing the SAME
// cache the "transfer cancellation" entry's `CONTROLLER_CANCEL_MEMBER`
// already pays for — brought it down to 4m5.452s and 4m4.544s across two
// separate foreground runs, because every shipped file's stripped text is
// computed at most ONCE per run and reused by every later `.some()` probe,
// this capability's or any other's. That is a real improvement (roughly a
// third faster than the bare-string version) but it is NOT back to the
// pre-this-entry ~3m49-3m51s baseline — it is ~13-16s over it, on top of a
// file count that grows every wave. The residual cost is structural, not a
// caching miss: `.some()` still walks the evidencePool IN ORDER for every
// one of the ~905 appFiles, and this capability's only match sits at the
// very end of that order, so ~905 × ~1204 cache HITS (cheap, but not free)
// still happen where an earlier-sorted declaring file would let most of
// those calls short-circuit in a handful of steps. Disclosed rather than
// hidden: a future capability whose only shipped evidence is deep in
// `scripts/ci` will pay this same tax, and the fix (if the total ever
// becomes a problem) is at the `findCapabilityDenialViolations` level —
// e.g. resolving "is X shipped" once per capability up front instead of
// once per (capability, appFile) pair — not something this entry can do
// alone.
//
// CLOSED (T184): the paragraph above described the state of the algorithm
// AT THE TIME this entry was written and is no longer an accurate
// description of `findCapabilityDenialViolations` — it now resolves "is
// this capability shipped?" once per capability, over the FULL
// `shippedFiles` list, before `appFiles` is walked at all, exactly as
// predicted above. There is no more per-appFile `evidencePool` and no
// more ~905×1204 walk for this (or any) entry, which is what retired the
// PERFORMANCE rationale the paragraph above measured.
//
// CORRECTED (T222): this block used to go on to say that, even with
// the walk above gone, "the member being a `RegExp` still matters for the
// reasons T169 gave (disambiguating a same-file, same-name collision)".
// That was never true for this member, and T221 established it directly:
// a bare `findBuildOrderViolations` collides with nothing in this tree
// (see the capability's own doc comment below for the measurement), so
// T169's disambiguation reason was dead on arrival here, independently of
// the algorithm change above. With BOTH rationales ever offered for the
// `RegExp` form now dead — performance retired by T184 above,
// disambiguation never live per T221 — nothing argued for keeping the
// brittle `RegExp` form, and T223 replaced it with the bare string
// `"findBuildOrderViolations"` below: a strict superset of declaration
// shapes for this member (see the capability's own doc comment for the
// const-arrow refactor that the old `RegExp` silently failed to match).
//
// The 4m3-4m5s -> **0.8s** speedup this block used to cite from the T184
// change is not restated as a LIVE figure: `run-guard-capability-prose.mjs`'s
// wall-clock time moves with the size of the tracked file corpus every
// wave. The runs below are therefore DATED rather than left standing as
// what the runner costs today — the same treatment T218 gave this guard's
// own shipped-file counts, in this directory. (CLAUDE.md took the other
// route for its two count claims, the `scripts/ci` test count and the
// capability ENTRY count, and dropped both figures outright.) Measured
// directly on this tree at T222, three foreground runs of
// `node scripts/ci/run-guard-capability-prose.mjs`: 1.257s, 1.228s,
// 1.347s — order-of-a-second, not order-of-a-minute, which is the only
// property this comment needs to assert; the exact figure will drift by
// the next wave and is not worth re-pinning.
//
// CORRECTED at the P8-W21 merge gate: the paragraph above cited
// "CLAUDE.md's test-count and shipped-files-count paragraphs" as its
// precedent. CLAUDE.md has no shipped-files-count paragraph — `grep -i
// restate CLAUDE.md` returns the test count, the capability entry count,
// and the sentence naming those two. And it labelled its own measurement
// "the T222 gate": T222 is the task, and the task took the measurement.
const FIND_BUILD_ORDER_VIOLATIONS_MEMBER = "findBuildOrderViolations";

// T215: T211 (`guard-run-guard-wiring.mjs`) added a dedicated walk over the
// allowlist's OWN keys — `for (const [runner, allowlistReason] of
// Object.entries(allowlist))` — to detect a stale entry independently of
// the main per-runner loop. Unlike `findStaleAllowlistViolations` below,
// T211 folded its stale-detection walk INTO the existing, pre-T211
// `findUnwiredRunGuardViolations` rather than naming a new function, and
// its two new violation kinds (`"stale-missing-runner"`, `"stale-wired"`)
// are STRING LITERAL VALUES — `stripCommentsAndStrings` erases every string
// literal's contents to `""` before any declaration check runs (T184's own
// doc comment explains why: a denying SENTENCE could otherwise
// self-certify as "shipped" by merely resembling a property value), so
// neither kind name can be used as a `methodNames` token at all — matching
// literal text that the guard's own stripping step deletes before this
// entry ever sees it would make the entry permanently un-shippable, the
// mirror image of T172's "token that outlives the capability" trap. This
// `RegExp` instead anchors to the real, structural CODE shape T211 added —
// the `Object.entries(allowlist)` walk itself — which survives comment-
// and-string stripping because it is neither. Measured directly across
// every tracked `packages/*/src`, `apps/*/src`, and `scripts/ci` file:
// exactly one match, `guard-run-guard-wiring.mjs`'s real T211 loop (line
// 319 as of this entry's authorship) — a second textual mention inside
// that same file's own header comment is stripped before matching, so it
// does not double-count and does not matter either way.
const STALE_RUN_GUARD_ALLOWLIST_WALK_MEMBER =
  /for\s*\(\s*const\s*\[\s*runner\s*,\s*allowlistReason\s*\]\s*of\s*Object\.entries\(\s*allowlist\s*\)\s*\)/;

// T232: T44A4 (`scripts/ci/guard-workspace-test-coverage.mjs`) shipped the
// same T211/T213-shaped stale-allowlist walk a third time — a dedicated
// pass over `ALLOWLISTED_UNTESTED_WORKSPACES`'s own keys, independent of
// the main per-workspace loop, reporting `kind: "stale-missing-workspace"`
// (the allowlisted package no longer resolves from a workspace glob) or
// `kind: "stale-tested"` (a real workflow now genuinely tests it). Like
// T211 and unlike T213, this walk was folded into the pre-existing
// `findWorkspaceTestCoverageViolations` rather than given its own function
// name, so — for the identical reason `STALE_RUN_GUARD_ALLOWLIST_WALK_MEMBER`
// above is a `RegExp` and not a bare string — a `methodNames` token here
// cannot be the two violation `kind` string literals (erased by
// `stripCommentsAndStrings` before any check runs) or the enclosing
// function's name (that name also covers the unrelated "untested workspace"
// half of this guard, so its mere existence proves nothing about the stale
// walk specifically). This `RegExp` instead anchors to the real, structural
// CODE shape the walk added — `for (const [workspace, allowlistReason] of
// Object.entries(allowlist))` — which survives comment-and-string stripping
// because it is neither. Measured directly across every tracked
// `packages/*/src`, `apps/*/src`, and `scripts/ci` file (test files
// excluded, per `isShippedSourcePath`): exactly one match,
// `guard-workspace-test-coverage.mjs`'s own loop — its sibling
// `run-guard-workspace-test-coverage.mjs` CLI entry point only destructures
// `{ kind, workspace, allowlistReason }` from each already-produced
// violation object, never re-declaring this walk.
const STALE_WORKSPACE_TEST_COVERAGE_ALLOWLIST_WALK_MEMBER =
  /for\s*\(\s*const\s*\[\s*workspace\s*,\s*allowlistReason\s*\]\s*of\s*Object\.entries\(\s*allowlist\s*\)\s*\)/;

/** @type {Capability[]} */
export const CAPABILITIES = [
  {
    // T110 (packages/client/src/daemon-client.ts) / T38B1a
    // (apps/web/src/features/composer). Seeded per T124's acceptance
    // criteria — the exact trio ten P6-W6 sites got wrong.
    name: "queue-mode trio (getQueueModes/setSteeringMode/setFollowUpMode)",
    methodNames: ["getQueueModes", "setSteeringMode", "setFollowUpMode"],
    denyingPhrases: [
      /no (?:shipped|real) `?DaemonClient`? (?:implements|has) (?:this|these|the (?:three|trio))\b/i,
      /not implemented by any shipped `?(?:@picompanion\/client `?)?DaemonClient`?/i,
      /do(?:es)? not exist on (?:a|any) (?:real|shipped) `?DaemonClient`?/i,
      /true of every real `?DaemonClient`?/i,
      /no wire request to change (?:it|this) today/i,
      /stay `?undefined`? against every real `?DaemonClient`?/i,
    ],
  },
  {
    // T139 (apps/web/src/features/transcript/tool-call-row.tsx's
    // `useClipboardAction`) shipped a visible failed state (an absent
    // Clipboard API and a rejected write both render `StatusIndicator
    // tone="danger"` with the real reason) where the hook used to swallow
    // every failure in a bare `catch {}` and unconditionally claim
    // "Copied". `CopyableField.tsx` (T41B1) carried a doc comment naming
    // that old behaviour as the deliberate contrast it was written
    // against; the P6-W12 merge gate found that comment still live and
    // used it to prove this guard's pre-T147 client-only scope was inert
    // (see this file's header). Fixed in the same commit as a `CORRECTED
    // (P6-W12)` note, which is why the real `CopyableField.tsx` passes
    // this guard today.
    name: "visible clipboard-failure state (useClipboardAction)",
    methodNames: ["useClipboardAction"],
    denyingPhrases: [
      // CopyableField.tsx's pre-P6-W12 wording (the exact live phrase the
      // P6-W12 merge gate's demo `CAPABILITIES` entry used).
      /swallows every clipboard failure in a bare `?catch\s*\{\}`?(?: and (?:shows|sets)[^.]*?(?:copied|regardless)[^.]*)?/i,
      // tool-call-row.tsx's own pre-T139 wording. One phrase spanning both
      // halves (rather than two separate phrases) so a single sentence
      // does not register as two violations.
      /never throws\b[^.]*\bsilently inert\b/i,
    ],
  },
  {
    // T143 (`packages/protocol/src/agent-types.ts`'s `CompactionTimelineItem`
    // and `packages/frontend-core/src/timeline/transcript-view.ts`'s
    // `CompactionTranscriptEntry`) carried `summary`, `estimatedTokensAfter`,
    // `filesRead` and `filesModified` from `compaction_end`'s wire payload
    // through to the view model. `apps/web/src/features/transcript/
    // compaction-row.tsx`'s `messageFor` (T38B3, before T143 existed)
    // unconditionally told every web user those details were not carried by
    // the app at all — the P6-W12 merge gate found the sentence still live
    // after T143 shipped, filed T146 to fix it rather than fixing it
    // itself (out of that gate's own owned files), and filed this entry as
    // the corresponding `CAPABILITIES` addition once T146 landed
    // (`16d73eb`). Only `summary` and `filesRead`/`filesModified` gate this
    // entry — `estimatedTokensAfter` is carried but was never part of the
    // "isn't available" claim, so it plays no role in "is this shipped?".
    //
    // T172: the flat `["summary", "filesRead", "filesModified"]` above was
    // an OR across bare names, OR across files — `summary` alone is
    // declared (by `isCapabilityMemberDeclared`'s permissive property-shape
    // regex) in 33 shipped files with nothing to do with compaction, so the
    // entry could never become "not shipped" again once ANY one of the
    // three names existed anywhere in the tree, regardless of whether this
    // capability's own four declaring files still carried it. Replaced with
    // a single AND-group of the three `COMPACTION_*_FIELD` regexes above,
    // each anchored to an actual TypeScript field-type annotation rather
    // than a bare name — see their doc comment for why a bare-name
    // AND-group (T168's fix for `cancel`) is not narrow enough here: two
    // unrelated files (`messages.ts`'s zod schema, `pi/agent.ts`'s
    // result-composition object) carry the same three bare names without
    // ever declaring a typed field, and would have kept this entry
    // "shipped" even with the trio deleted from every real declaring file.
    name: "compaction summary and file details (summary/filesRead/filesModified)",
    methodNames: [
      [COMPACTION_SUMMARY_FIELD, COMPACTION_FILES_READ_FIELD, COMPACTION_FILES_MODIFIED_FIELD],
    ],
    denyingPhrases: [
      // One phrase spanning the whole pre-T146 sentence (rather than two
      // separate phrases) so a single sentence does not register as two
      // violations — same reasoning as the clipboard-failure entry above.
      /a summary of what changed,? and which files were read or modified,? isn'?t available here yet\b[^.]*\bthe app doesn'?t carry that detail from the agent today/i,
    ],
  },
  {
    // T41B2 (`5ca8444`) shipped the redacted diagnostics export on web:
    // `apps/web/src/features/diagnostics/diagnostics-export.ts`'s
    // `buildDiagnosticsExportBundle`/`serializeDiagnosticsExportBundle`,
    // `use-diagnostics-export.ts`'s `useDiagnosticsExport`, and a visible
    // `Export diagnostics (.json)` button with an `Export failed - ...`
    // state in `DiagnosticsScreen.tsx`. The P6-W14 merge gate found
    // `apps/web/src/features/sessions/rpc-command-web-parity.ts` still
    // ending its `export_html` note with the unqualified sentence "No
    // export action exists in apps/web." - true of session export, false
    // as written. This entry was proven RED against that sentence and
    // GREEN once it was qualified, in the same commit that qualified it.
    name: "redacted diagnostics export (useDiagnosticsExport/buildDiagnosticsExportBundle)",
    methodNames: ["useDiagnosticsExport", "buildDiagnosticsExportBundle"],
    denyingPhrases: [/no export action exists in apps\/web/i],
  },
  {
    // T151 (`c1888ec`, `scripts/ci/guard-capability-prose.mjs`) shipped
    // `joinAdjacentStringLiterals`, folding a chain of `+`-concatenated
    // string literals into one before `flattenProse` matches denying
    // prose against it, so a denying phrase split across a concatenation
    // boundary can no longer escape this guard.
    // `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s
    // `export_html` note carried the exact opposite claim — written at the
    // P6-W15 wave base, before T151 landed — until the P6-W15 merge gate
    // corrected it (`eb37062`) into a "CORRECTED (T151)" historical note.
    // This entry could not have existed usefully before T156: T151 itself
    // ships in `scripts/ci`, which `isShippedSourcePath` ignored until
    // this task widened it — the P6-W15 merge gate proved that gap by
    // changing ONLY this entry's member name against the identical live
    // sentence and getting exit 0.
    name: "joins adjacent string literals before matching denying prose (joinAdjacentStringLiterals)",
    methodNames: ["joinAdjacentStringLiterals"],
    denyingPhrases: [
      /flattenProse does not join adjacent string literals\b[^.]*\bescapes guard-capability-prose entirely/i,
    ],
  },
  {
    // T206 (P8-W9) shipped an executable check for the "no legacy §3
    // envelope reader" prohibition that, until then, was enforced by
    // nothing but a grep someone ran once. Added at the P8-W9 merge gate,
    // which found T206 had shipped the capability without an entry here --
    // CLAUDE.md's "add a new capability entry the moment you ship one".
    // Like `joinAdjacentStringLiterals` above, this one ships in
    // `scripts/ci`, which only T156's widening made visible to this
    // runner at all; an entry the runner cannot see is a check that
    // cannot fail.
    //
    // The denying phrases are the exact shapes the pre-T206 tree used, and
    // which the P8-W7 gate itself wrote into `versioned-import.test.ts` on
    // purpose so that T206 would have to delete them. If one comes back
    // while the guard ships, the tree is telling a reader the prohibition
    // is unenforced while it is in fact enforced.
    name: "executable no-legacy-schema-reader check (findLegacySchemaReaderViolations)",
    methodNames: ["findLegacySchemaReaderViolations"],
    denyingPhrases: [
      /repo-wide half of the claim above rests on a grep/i,
      /rests on a grep performed when this was written, not on any executable check/i,
      /enforced by nothing but (?:an? )?(?:author's )?grep/i,
      /no executable check enforces[^.]*legacy schema reader/i,
    ],
  },
  {
    // T207 shipped the appId/package pairing guard AND fixed the defect
    // it checks for in the same commit: every `apps/android/maestro/*.yaml`
    // flow's `appId:` line became the variable `${APP_ID}`, and
    // `.github/workflows/android-maestro-e2e.yml`'s `packaged-app-smoke`
    // job started passing `APP_ID=sh.picompanion`. That made three P8-W10
    // merge-gate disclosures false the instant T207 landed: the workflow
    // header's "cannot pass as written" paragraph, its `packaged-app-smoke`
    // run step's "cannot succeed until T207" comment, and
    // `apps/android/maestro/README.md`'s "This job cannot pass yet"
    // paragraph — CLAUDE.md's T124 shape one more time, corrected in the
    // same commit that shipped the capability.
    //
    // This entry could not have existed usefully before T207 widened
    // `isAppSourcePath` to `.github/workflows/*.yml` and
    // `apps/android/maestro/*.md`: none of the three sites above lives
    // under `apps/web/src`, `apps/android/src`, `scripts/ci`,
    // `packaging/**`, or `docs/**`, so the pre-T207 scan would have exited
    // 0 with all three still false — the same shape T179 and T197 each
    // found for their own trees. Measured against the real, committed
    // tree with this entry added: 0 violations (every real site now
    // carries a `CORRECTED (T207)` note); reinstating any one of the three
    // phrases below unmarked makes the guard exit 1 — see
    // `guard-capability-prose.test.mjs`'s "T207" cases for the proof.
    //
    // `methodNames`: `findAppIdPackagePairingViolations` is a full,
    // camel-cased function name declared in exactly one file
    // (`scripts/ci/guard-app-id-package-pairing.mjs`), which is not the
    // file either denial site lives in — the T183/T184 self-judging trap
    // (CLAUDE.md's "a guard cannot police the file its own capability
    // ships in") does not apply here.
    name: "appId/package pairing guard (findAppIdPackagePairingViolations)",
    methodNames: ["findAppIdPackagePairingViolations"],
    denyingPhrases: [
      /packaged-app-smoke[\s#"'`]*cannot[\s#]+pass[\s#]+as[\s#]+written/i,
      /this[\s#]+step[\s#]+cannot[\s#]+succeed[\s#]+until[\s#]+T207/i,
      /this[\s#]+job[\s#]+cannot[\s#]+pass[\s#]+yet,?[\s#]+and[\s#]+the[\s#]+blocker[\s#]+is[\s#]+a[\s#]+wiring[\s#]+defect/i,
    ],
  },
  {
    // T41A3 (`apps/web/src/features/files/use-file-upload.ts`,
    // `use-file-download.ts`) shipped `cancel()` on both `useFileUpload`
    // and `useFileDownload`, a visible Cancel action in
    // `file-upload-panel.tsx`/`file-download-action.tsx`, and a distinct
    // info-tone `"cancelled"` status. T162: this is a FORWARD guard — the
    // P6-W16 gate grepped `apps/web/src` and `apps/android/src` for
    // cancellation-absence wording and found none, so unlike every entry
    // above, this one has no live sentence to prove it against. It was
    // proven instead by inserting a denying sentence into the real,
    // in-tree `use-file-upload.ts`, confirming `run-guard-capability-
    // prose.mjs` exits 1, and restoring the file byte-identically; the
    // corresponding synthetic pin is the pair of tests immediately below.
    //
    // CORRECTED (P6-W17 merge gate): this said `use-file-upload.ts`'s
    // module doc "truthfully discloses a real boundary ... because the
    // protocol has no cancel opcode (see T163)" and called it "a true
    // statement of a limit". T162 and T163 landed in the same wave and
    // T163 shipped the opcode, so that disclosure was false within the
    // hour. It has been rewritten; the separate `cancelUpload` entry
    // below is what guards the new claim. What survives from the
    // original note is the reason this entry's phrases stay narrow: an
    // honest statement of a REMAINING limit must never trip a
    // capability entry. CORRECTED (P6-W18 merge gate): this went on to
    // say "and this hook still has one (it does not send the opcode yet
    // — T165)". T165 (`9e54ff5`) wired `cancel()` to
    // `client.cancelUpload()` in the very next wave, so the hook no
    // longer has that limit. The rule the sentence illustrated still
    // holds; only its example is spent. The phrases below are anchored to
    // "upload"/"download"/"transfer" so ordinary prose about an unrelated
    // cancellable action (an approval, a dialog) cannot trip them either.
    //
    // T168: the ORIGINAL `methodNames: ["cancel"]` here was the broadest
    // shipped-gate token in this file — `cancel` alone is declared all
    // over the tree (an approval dialog, `MinimalStreamReader.cancel()`,
    // etc; see `guard-capability-prose.test.mjs`'s "unrelated 'cannot be
    // cancelled' prose" case for one of them), so it would keep this entry
    // "shipped" — and therefore keep forbidding the phrases below — even
    // if `cancel()` were deleted from BOTH `useFileUpload` and
    // `useFileDownload` entirely. A guard that goes on forbidding an
    // accurate statement after the capability it names is gone is worse
    // than one that misses a false one (see CLAUDE.md's "A shipped-gate
    // token must disappear when the capability does"). Each group below is
    // an AND — `cancel` only counts as evidence when it is declared in the
    // SAME file as the hook it cancels, which is exactly the shape
    // `use-file-upload.ts`/`use-file-download.ts` already have (the hook
    // function and the `FileUploadController`/`FileDownloadController`
    // interface's `cancel` member both live in one file) and an unrelated
    // `cancel` elsewhere never does.
    //
    // T169: co-declaration in the same file is still not enough when the
    // unrelated member shares the bare name `cancel` too —
    // `use-file-download.ts`'s own `MinimalStreamReader.cancel?(reason?:
    // unknown): Promise<void> | void` lives beside `useFileDownload` in
    // exactly this file. `CONTROLLER_CANCEL_MEMBER` below matches only the
    // real controller shape (`cancel: () => void`, as both
    // `FileUploadController` and `FileDownloadController` declare it), never
    // the stream-reader's optional, `Promise`-returning `cancel(reason?)`.
    name: "transfer cancellation (cancel on useFileUpload/useFileDownload)",
    methodNames: [
      ["useFileUpload", CONTROLLER_CANCEL_MEMBER],
      ["useFileDownload", CONTROLLER_CANCEL_MEMBER],
    ],
    denyingPhrases: [
      /(?:uploads?|downloads?|(?:file )?transfers?) (?:cannot|can'?t) be cancell?ed/i,
      /no way to cancel (?:an?|the) in-?flight (?:file )?transfer/i,
      /(?:file )?transfers? (?:cannot|can'?t) be interrupted/i,
    ],
  },
  {
    // T163 (`762ac3a`) shipped a real upload-cancel opcode:
    // `file.upload.cancel.request`/`.response` in
    // `packages/protocol/src/messages.ts`, `DaemonClient.cancelUpload`
    // (`packages/client/src/daemon-client.ts`), and
    // `FileUploadStore.cancelUpload`, which awaits the pending chunk-write
    // queue and removes the upload directory. Four sites in the tree
    // still asserted no such opcode existed when the P6-W17 merge gate
    // ran; three of them were written earlier in that same wave, by the
    // task that added the entry above. This entry is what stops the fifth.
    //
    // Deliberately narrow: it fires ONLY on the claim that the protocol
    // has no cancel opcode — never on prose about which callers use it.
    // CORRECTED (P6-W18 merge gate): this said prose saying
    // `use-file-upload.ts` "does not yet SEND it is true today (T165)".
    // T165 (`9e54ff5`) landed the call one wave later; that prose would
    // now be false, and this entry is deliberately blind to it either
    // way, which is the point of keeping the phrase list this narrow.
    name: "upload cancel opcode (cancelUpload/file.upload.cancel.request)",
    methodNames: ["cancelUpload"],
    denyingPhrases: [/(?:the )?protocol has no cancel opcode/i],
  },
  {
    // T174 (`d5516e1`, `scripts/ci/guard-docker-packaging-paths.mjs`)
    // shipped `findBuildOrderViolations`: the packaging guard's
    // presence-only checks (T43A3) gained a real ORDER check — `build:clean
    // --workspace=@picompanion/server` must precede `build:daemon-web-ui`,
    // and each of `@picompanion/client`/`@picompanion/frontend-core`/
    // `@picompanion/web` must build after the `@picompanion/*` workspaces
    // its own `dependencies` field names.
    //
    // T183: T179 widened this guard's DENIAL scan to `scripts/ci` and
    // `packaging/**` — necessary, but not sufficient. No `CAPABILITIES`
    // entry described the packaging build-order capability at all, so the
    // six false-premise sites the P6-W20/P6-W21 gates found (four in
    // `packaging/**`, two in `scripts/ci`) would keep passing even now that
    // they are in scope — re-derived at the P6-W22 gate: 0 violations
    // against all seven then-existing entries. This entry is the other
    // half. Measured against the real, committed tree with this entry
    // added: 0 violations (every real site already carries a `CORRECTED`
    // note); inserting either denying phrase UNMARKED into a real
    // `packaging/**` file makes the guard exit 1, and removing it again
    // returns it to exit 0 — see `guard-capability-prose.test.mjs`'s
    // "T183" cases for the pinned version of that proof.
    //
    // `methodNames`: unlike T172's `summary` (33 unrelated shipped files)
    // or T169's bare `cancel` (an approval dialog, a stream reader), a bare
    // `findBuildOrderViolations` COLLIDES with nothing — it is a full,
    // five-word, camel-cased function name found nowhere else in the tree.
    // Measured directly across every `packages/*/src`, `apps/*/src`, and
    // `scripts/ci` file: exactly ONE declaring file,
    // `scripts/ci/guard-docker-packaging-paths.mjs` itself (every other hit
    // is inside a comment in that same file or in
    // `run-guard-capability-prose.mjs`, both stripped before the
    // declaration check runs).
    //
    // So this member (`FIND_BUILD_ORDER_VIOLATIONS_MEMBER`, defined above)
    // is the bare string `"findBuildOrderViolations"` — T223. Before T223
    // it was a `RegExp` (`/\bfunction\s+findBuildOrderViolations\s*\(/`),
    // and T183/T221 (see that constant's own doc comment) established that
    // neither rationale ever offered for the `RegExp` form is live today:
    // the PERFORMANCE argument died once `findCapabilityDenialViolations`
    // started resolving "is this capability shipped?" once per capability
    // over the whole `shippedFiles` list (T184), and T169's DISAMBIGUATION
    // reason was never live for this member either, since a bare
    // `findBuildOrderViolations` collides with nothing in this tree (the
    // measurement two paragraphs up).
    //
    // With no live reason to keep it, the `RegExp` form's cost became the
    // reason to drop it: `declarationPatternsFor` recognizes four
    // declaration shapes for a bare-string member (an `async`/`Promise`-
    // returning method, a `function name(` declaration, a `const`/`let
    // name =` assignment, and an interface/type property), and the old
    // `RegExp` matched only the second of those four. Proven directly
    // against the real, exported `isCapabilityMemberDeclared` (not a
    // private copy of either pattern), by rewriting the real, committed
    // `guard-docker-packaging-paths.mjs` declaration from
    // `export function findBuildOrderViolations(commandText) {` to
    // `export const findBuildOrderViolations = (commandText) => {` — still
    // exported, still shipped, a behaviour-preserving refactor: the bare
    // string kept matching (`declared: true`) while the old `RegExp`
    // stopped (`matches: false`). Under the `RegExp` form that refactor
    // silently disabled this entry — the capability resolved as NOT
    // shipped, every denying phrase below became ALLOWED, exit 0, no
    // signal — a check-cannot-fail arriving by refactor rather than by
    // deletion, which the deletion proof below does not cover.
    // `guard-capability-prose.test.mjs`'s "T223" test pins this end-to-end
    // through the real, module-level `CAPABILITIES` entry — not a private
    // fixture — and was confirmed to fail (0 violations, not 1) against
    // the pre-fix `RegExp` member and pass against the bare string above.
    // The bare string is a strict superset of the `RegExp` form for this
    // member (nothing in this tree gives it a same-name collision to
    // disambiguate, so none of the extra three shapes it now also matches
    // can falsely mark it "shipped"), so switching costs nothing.
    //
    // The gate still goes quiet correctly on real deletion, a different
    // case from the refactor above: deleting `findBuildOrderViolations`'s
    // declaration entirely (in any of the four recognized shapes) leaves
    // zero declaring files, so a denying phrase inserted afterward is
    // still ALLOWED (exit 0) — the token disappears with the capability,
    // per CLAUDE.md's "a shipped-gate token must disappear when the
    // capability does".
    //
    // `denyingPhrases`: matches the two false claims the P6-W20 gate's
    // corrected quotations in `packaging/docker/Dockerfile` and
    // `packaging/docker/README.md` both still carry, historically, as
    // "this said ...". Deliberately does NOT include the sibling
    // "presence tests only, no position comparison"/"fully
    // order-insensitive" wording those same corrections use to describe
    // the OLD, true-at-the-time absence: `packaging/nix/README.md`'s
    // "order-insensitive" clause sits more than
    // `HISTORICAL_CONTEXT_WINDOW` (300 chars) past its nearest
    // `CORRECTED` marker, describing a past state in a still-legitimate
    // past tense ("at the time of that correction the check was ALSO
    // fully order-insensitive") — a denying phrase built from that
    // wording flags a real, currently-committed, non-false sentence. The
    // two phrases below are anchored to claims that were false THEN and
    // remain false NOW (`findBuildOrderViolations` compares against a
    // hardcoded `WORKSPACE_BUILD_DEPENDENCIES` array, never
    // `packages/server/package.json`'s real `prepack` script, so "matches
    // ... prepack" stays false either way), which is what makes them safe
    // denying phrases rather than a stale label for a past truth. The
    // first phrase tolerates a `#` between words (`[\s#]+` rather than
    // `\s+`) because the Dockerfile's own version of this sentence is
    // wrapped across three `#`-prefixed comment lines, and
    // `flattenProse` only collapses whitespace — it does not strip a
    // Dockerfile's `#` comment marker the way it strips a JSDoc `*`
    // gutter, so a plain `\s+` separator would silently never match this
    // file's wrapped copy of the sentence.
    //
    // T187: T184 removed the per-appFile self-exclusion that used to make
    // two of T179's six sites structurally invisible, so all six became
    // re-measurable. Re-measured directly against
    // `run-guard-capability-prose.mjs` on the committed tree, one at a
    // time (each site's exact `CORRECTED`-quoted false sentence, appended
    // UNMARKED as a comment to the file it lives in, then removed):
    //
    //   1. Dockerfile: "the guard checks that the build order matches
    //      packages/server/package.json's prepack" -> exit 1 (already
    //      caught by the first phrase above).
    //   2. docker/README.md: "the guard checks the source is not excluded
    //      by .dockerignore in a way that would break the build" -> exit
    //      0 (not caught; see below — NOT widened, on purpose).
    //   3. docker/README.md: "...concluded that 'this packaging path
    //      cannot silently skip the T43A1 bundling invariant'" -> exit 1
    //      (already caught by the second phrase above).
    //   4. nix/README.md: "those workspace names are checked against real
    //      package.json files in this repository" -> exit 0 (not caught;
    //      NOT widened, on purpose).
    //   5. guard-docker-packaging-paths.mjs (~line 30): "the exact failure
    //      mode T171 guards on the OUTPUT side, checked here on the INPUT
    //      (packaging-recipe) side instead" -> exit 0 (not caught; NOT
    //      widened, on purpose).
    //   6. guard-docker-packaging-paths.mjs (~line 160): "that output is
    //      comment-free by construction, since both extractors only ever
    //      collect RUN lines / phase-string bodies" -> exit 0 (not
    //      caught pre-T187; WIDENED below).
    //
    // So: two were already catchable (1, 3, unchanged by T187), and of
    // the remaining four, only site 6 is added here. The other three are
    // deliberately left unmatched, because none of them actually DENIES
    // this capability's existence — each is a claim this guard's
    // `denyingPhrases` mechanism cannot safely encode without risking a
    // phrase that goes on forbidding an accurate statement forever (see
    // CLAUDE.md's "A shipped-gate token must disappear when the
    // capability does", the same principle one level up: a denying
    // PHRASE, not just a shipped-gate token, must not survive past the
    // point where what it denies stops being false):
    //
    //   - Site 2 denies a DIFFERENT, still-genuinely-absent capability —
    //     whether this guard checks a `COPY` source against
    //     `.dockerignore` exclusion. `grep -c dockerignore` across all
    //     three guard files in this repository still returns 0 today (a
    //     separate guard, `guard-dockerignore-depth.mjs`, checks
    //     `.dockerignore` pattern DEPTH, T177/T180 — an unrelated
    //     capability with its own future entry if one is ever written,
    //     not this one). "The guard does not check dockerignore
    //     exclusion" is accurate today and has no announced plan to
    //     become false. Phrase-matching it here would forbid an
    //     accurate sentence about an absent, unrelated feature under a
    //     capability name that has nothing to do with it.
    //   - Site 4 denies that `REQUIRED_WORKSPACE_BUILD_STEPS` is derived
    //     from live `package.json` reads rather than being the hardcoded
    //     literal array it is by design (see that array's own doc
    //     comment above `REQUIRED_WORKSPACE_BUILD_STEPS` in
    //     `guard-docker-packaging-paths.mjs`). Nothing about landing more
    //     of `findBuildOrderViolations` makes this array read a real
    //     manifest — it is a provenance/implementation-detail claim, not
    //     a claim that build-order checking is absent, and it is likely
    //     to stay accurate indefinitely.
    //   - Site 5 denies that this guard is EQUIVALENT in power to T171's
    //     `guard-daemon-web-ui-bundled.mjs` ("the exact failure mode T171
    //     guards ... checked here ... instead"). The correction's own
    //     text says the true relationship is "strictly weaker", not
    //     "absent" — T171 catches a missing bundle for ANY reason in the
    //     packed tarball; this guard catches only the specific omission
    //     and ordering failures `findBuildOrderViolations` and its
    //     sibling presence checks enumerate. That gap is real and
    //     permanent by design (the two guards check different artifacts
    //     at different pipeline stages), so a phrase forbidding "this is
    //     weaker than T171" would forbid an accurate statement forever.
    //     Even the ORIGINAL (false) sentence never claimed build-order
    //     checking didn't exist — it claimed a false EQUIVALENCE to a
    //     different guard, which isn't the shape this guard exists to
    //     catch.
    //
    // Site 6 is different in kind: T178 shipped active comment-stripping
    // (`stripDockerfileComments`/`stripNixComments`, run BEFORE
    // `extractDockerRunCommands`/`extractNixPhaseCommands` join
    // continuations) specifically because the extracted RUN/phase text
    // was NOT comment-free "by construction" — a `#`-prefixed comment
    // inside a continuation could weld into real command text and defeat
    // the build-order check. Site 6's sentence denies that this active
    // stripping was ever necessary or exists; it is squarely the
    // capability's own "T178's comment-awareness" half (this entry's own
    // header names both halves), so it belongs here.
    //
    // RED/GREEN proof for the new phrase (also pinned in
    // `guard-capability-prose.test.mjs`'s "T187" cases): appending site
    // 6's sentence, unmarked, to a scratch copy of
    // `guard-docker-packaging-paths.mjs` and running
    // `run-guard-capability-prose.mjs` gives exit 1 with exactly this
    // capability's name; removing it again returns exit 0. Whole-scope
    // grep for the phrase's anchor text ("comment-free by construction")
    // across every `apps/web/src`, `apps/android/src`, `scripts/ci`, and
    // `packaging/**` file finds exactly one hit outside this guard's own
    // three self-excluded files (the real, `CORRECTED`-marked site this
    // phrase was written for) — see the test file for the exact count.
    name: "packaging build-order checking (findBuildOrderViolations)",
    methodNames: [FIND_BUILD_ORDER_VIOLATIONS_MEMBER],
    denyingPhrases: [
      /the[\s#]+guard[\s#]+check(?:s|ed)?[\s#]+(?:that[\s#]+)?the[\s#]+build[\s#]+order[\s#]+matches\b/i,
      /this\s+packaging\s+path\s+cannot\s+silently\s+skip\s+the\s+T43A1\s+bundling\s+invariant/i,
      /(?:that\s+)?output\s+is\s+"?comment-free\s+by\s+construction,?\s+since\s+both\s+extractors\s+only\s+ever\s+collect\s+RUN\s+lines\s*\/\s*phase-string\s+bodies/i,
    ],
  },
  {
    // T215: T211 (`b5e8c7f`) gave `guard-run-guard-wiring.mjs` a dedicated
    // check for a STALE `ALLOWLISTED_UNWIRED_RUN_GUARDS` entry — one naming
    // a runner that no longer exists (`kind: "stale-missing-runner"`) or one
    // a workflow now genuinely wires (`kind: "stale-wired"`) — closing the
    // "check that cannot fail" shape CLAUDE.md's catalogue names: before
    // T211, such an entry was consulted only from inside the per-runner
    // loop, so it was read only when a matching, still-unwired runner
    // existed, and a stale key just sat there forever.
    //
    // This is a FORWARD guard, the same shape as the "transfer
    // cancellation" entry above (T162): no site anywhere in
    // `apps/web/src`, `apps/android/src`, `scripts/ci`, `packaging/**`, or
    // (outside the excluded ledger — see `DOCS_LEDGER_DENIAL_EXCLUSIONS`'s
    // own doc comment in `run-guard-capability-prose.mjs`) `docs/**` denies
    // this capability today; `grep`ing all five trees for the phrases below
    // found nothing. `docs/issues-from-plan.md`'s own T211 and T213 specs
    // narrate the pre-fix defect in exactly this wording ("unreachable and
    // silently ignored", "cannot report a stale allowlist entry"), which is
    // why this entry could look, at a glance, like it would turn the ledger
    // red — it would not: T197 already excludes that one file from the
    // denial scan by name, for the identical reason (a task ledger
    // narrating a past defect in its own voice, without one of
    // `HISTORICAL_QUOTE_MARKERS`' triggers). See CLAUDE.md's T124 section
    // for the fuller decision record, including why the two REAL declaring
    // files' own historical narration ("Two kinds of entry were therefore
    // unreachable and silently ignored, forever") does not collide with the
    // phrases below either — proven, not assumed: both files wrap that
    // exact clause across a `//`-prefixed line break
    // (`guard-run-guard-wiring.mjs`: "...unreachable and\n// silently
    // ignored..."; `guard-no-legacy-app-tree.mjs`: "...unreachable and
    // silently\n// ignored..."), and `flattenProse` only strips a JSDoc `*`
    // gutter, never a `//` line-comment marker, so the flattened text keeps
    // a literal `//` sitting inside the phrase and no naive substring match
    // spans it. This entry's own phrases below are worded to avoid relying
    // on that fact anyway, on purpose: a comment reflow is a plausible,
    // meaning-preserving edit that could weld the historical text onto one
    // line with no warning, and this entry must not depend on nobody ever
    // doing that.
    //
    // `methodNames`: see `STALE_RUN_GUARD_ALLOWLIST_WALK_MEMBER`'s own doc
    // comment above for why a `RegExp` anchored to the real code shape is
    // required here rather than either kind string (both are string-literal
    // VALUES, erased by `stripCommentsAndStrings` before any check runs) or
    // the pre-existing `findUnwiredRunGuardViolations` name (real, but not
    // uniquely T211's — that function existed, under that exact name,
    // before T211 added the stale-entry walk to it). Not a group: this
    // single member is already unique across every tracked shipped file
    // (measured directly, see that constant's own comment), so there is no
    // bare-name collision for an AND-group to guard against, unlike T168's
    // `cancel` or T172's `summary`.
    name: "guard-run-guard-wiring detects stale allowlist entries (stale-missing-runner/stale-wired)",
    methodNames: [STALE_RUN_GUARD_ALLOWLIST_WALK_MEMBER],
    denyingPhrases: [
      /guard-run-guard-wiring(?:\.mjs)? (?:cannot|can'?t|does not) (?:report|detect|catch) a stale allowlist entry/i,
      /an allowlist entry naming a (?:deleted|renamed|nonexistent|non-existent) run-guard runner (?:cannot be (?:flagged|detected|caught)|is never (?:re-?checked|revisited))/i,
      /a runner (?:a workflow|that a workflow) now (?:genuinely )?wires can (?:still|also) (?:sit|remain) in the allowlist (?:unnoticed|undetected)/i,
    ],
  },
  {
    // T215: T213 (`f9b8877`) shipped the mirror-image fix for
    // `guard-no-legacy-app-tree.mjs`'s `ALLOWLISTED_PATHS` — the same
    // unreachable-stale-entry shape T211 closed one wave earlier, in a
    // different guard. Unlike T211, T213 named a genuinely NEW, unique
    // function for it: `findStaleAllowlistViolations`, declared in exactly
    // one shipped file (`guard-no-legacy-app-tree.mjs`; its `.test.mjs`
    // sibling is excluded from `shippedFiles` by construction) and found
    // nowhere else across every tracked `packages/*/src`, `apps/*/src`, or
    // `scripts/ci` file — a plain bare-string `methodNames` entry is
    // therefore sufficient, the same shape as
    // `findAppIdPackagePairingViolations` and `findLegacySchemaReaderViolations`
    // above; no `RegExp` shape-anchor and no AND-group are needed for the
    // reasons T169/T172 required them elsewhere (this name collides with
    // nothing).
    //
    // Also a FORWARD guard — see the entry above for the shared reasoning
    // (no live denial site outside the excluded ledger; the two real
    // declaring files' own historical narration does not collide with
    // these phrases, proven the same way). Kept as a SEPARATE entry from
    // the one above rather than merged into one capability: they are two
    // different guards, two different functions, shipped in two different
    // commits, and their natural denying phrases name the guard they are
    // about — collapsing them into one shipped-gate token would make an
    // unrelated guard's fix "ship" this capability's phrase protection
    // before its own guard actually had it, the same shape CLAUDE.md's "A
    // shipped-gate token must disappear when the capability does" warns
    // against one level up.
    name: "guard-no-legacy-app-tree detects stale allowlist entries (findStaleAllowlistViolations)",
    methodNames: ["findStaleAllowlistViolations"],
    denyingPhrases: [
      /guard-no-legacy-app-tree(?:\.mjs)? (?:cannot|can'?t|does not) (?:report|detect|catch) a stale allowlist entry/i,
      /an? ALLOWLISTED_PATHS entry naming a (?:deleted|renamed|nonexistent|non-existent) (?:file|path) (?:cannot be (?:flagged|detected|caught)|goes unnoticed)/i,
    ],
  },
  {
    // T228 (filed by the P9-W2 merge gate; widened by P9-W3 and P9-W9): five
    // guards shipped across three tasks without a `CAPABILITIES` entry, each
    // for the identical reason T211/T213 hit before T215 closed it — the
    // shipping task's `Owns` line never covered this file. This is the first
    // of the five: T44A2 (P9-W2) shipped
    // `scripts/ci/guard-axe-route-coverage.mjs`'s `findRouteCoverageViolations`,
    // deriving the real route list from `apps/web/src/routes/route-tree.ts`
    // and cross-checking it against `apps/web/e2e/fixtures/route-coverage-
    // manifest.ts`'s `ROUTE_COVERAGE` in both directions (a declared route
    // with no manifest entry; a manifest entry naming a route that no longer
    // exists).
    //
    // FORWARD guard, T162's shape: `docs/`, `plan.md`, `apps/web/src` and
    // `apps/web/e2e` were grepped for prose denying this capability at the
    // P9-W2 gate and none was found, so there is no live sentence to prove
    // this against — it was proven instead against a scratch copy of a real
    // tracked file (see this task's own report for the exact file, sentence,
    // and both exit codes) and pinned at the fixture level below.
    //
    // `methodNames`: a bare `findRouteCoverageViolations` is a full,
    // camel-cased, uniquely-declared function name — measured directly
    // across every `packages/*/src`, `apps/*/src`, and `scripts/ci` file:
    // exactly one declaring file, `guard-axe-route-coverage.mjs` itself
    // (its own `run-guard-axe-route-coverage.mjs` CLI entry point only
    // imports and calls it, neither of which is a declaration shape
    // `isCapabilityMemberDeclared` recognizes). No AND-group or `RegExp`
    // shape-anchor is needed, the same reasoning `findBuildOrderViolations`
    // and `findAppIdPackagePairingViolations` above give for their own bare
    // names.
    //
    // `denyingPhrases`: worded to describe the absence of the CROSS-CHECK
    // itself, never lifted from `guard-axe-route-coverage.mjs`'s own header
    // narration (which describes "a check that cannot fail" and routes
    // "silently cover[ing] fewer routes ... nobody remembers to add its
    // sweep" — a risk this guard closes, not a denial that it exists).
    name: "route coverage manifest cross-check (findRouteCoverageViolations)",
    methodNames: ["findRouteCoverageViolations"],
    denyingPhrases: [
      /nothing (?:cross-checks|derives and cross-checks) route-tree\.ts against (?:the )?route-coverage manifest/i,
      /a route (?:added to|declared in) route-tree\.ts with no route-coverage(?:-manifest)? entry (?:goes|is left) (?:undetected|unnoticed|unflagged)/i,
      /a stale route-coverage(?:-manifest)? entry naming a route that no longer exists (?:goes|is) (?:undetected|unnoticed|uncaught)/i,
    ],
  },
  {
    // T228, second of five: T44A3 (P9-W3) shipped
    // `scripts/ci/guard-version-drift.mjs` — `findWorkspacePinDrift` catches
    // a `@picompanion/*` dependency pin whose version string no longer
    // matches the target workspace's own `version` field;
    // `findWsHelloProtocolVersionDrift` and `findRelayProtocolVersionDrift`
    // catch the daemon/client and relay/protocol wire-version literal pairs
    // drifting apart. One capability, three functions, all declared in the
    // same file.
    //
    // FORWARD guard, same shape and same grep-before-registering discipline
    // as the entry above; no live denial site was found for any of the
    // three functions.
    //
    // `methodNames`: a flat list (OR across members), not an AND-group —
    // T168's group shape exists for a bare name common enough elsewhere to
    // self-certify as "shipped" (`cancel`, `summary`); measured directly,
    // each of these three camel-cased names is declared in exactly one
    // file, `guard-version-drift.mjs` itself, and nowhere else across every
    // `packages/*/src`, `apps/*/src`, or `scripts/ci` file — so there is no
    // collision for a group to guard against, the same measurement
    // `findBuildOrderViolations` made for its own bare name.
    //
    // `denyingPhrases`: worded around the absence of the CHECK, never
    // lifted from the guard's own header, which narrates the pre-fix risk
    // in its own words ("sit unnoticed", "checked by eye", "agree only
    // because nobody has edited either file").
    name: "workspace pin and wire-protocol version drift detection (findWorkspacePinDrift/findWsHelloProtocolVersionDrift/findRelayProtocolVersionDrift)",
    methodNames: [
      "findWorkspacePinDrift",
      "findWsHelloProtocolVersionDrift",
      "findRelayProtocolVersionDrift",
    ],
    denyingPhrases: [
      /nothing (?:checks|verifies) that an? @picompanion\/\* dependency pin(?:'s version)? (?:still )?matches the target workspace'?s own version field/i,
      /the (?:ws-hello|websocket hello) protocol version literals? (?:can|could) diverge between client and server with nothing to (?:catch|flag) it/i,
      /the relay(?:'s)? protocol version literal (?:can|could) drift from (?:packages\/protocol|the protocol package)'?s? constant with nothing to (?:catch|flag) it/i,
    ],
  },
  {
    // T228, third of five: T44A3 (P9-W3) also shipped
    // `scripts/ci/guard-secret-scan.mjs`'s `findSecretMatches`, a curated
    // vendor-prefix scan (AWS/GitHub/Slack/Google/Stripe/npm token shapes,
    // PEM private-key headers) over every tracked file.
    //
    // FORWARD guard, same discipline as the two entries above.
    //
    // `methodNames`: a bare `findSecretMatches` is uniquely declared in
    // `guard-secret-scan.mjs` — measured directly; `guard-signing-
    // material.mjs` and `run-guard-secret-scan.mjs` both only IMPORT and
    // CALL it (`import { findSecretMatches } from "./guard-secret-
    // scan.mjs";` matches none of `isCapabilityMemberDeclared`'s four
    // declaration shapes: no colon follows the name inside the import's
    // brace list, so the interface-property pattern does not fire either).
    //
    // `denyingPhrases`: worded around the absence of the SCAN, never
    // lifted from the guard's own header, which explains what it
    // deliberately does NOT catch (an unprefixed secret, one split across a
    // concatenation) — those are disclosed real limits, not a denial that
    // the scan exists at all, and this entry must never forbid them.
    name: "committed secret-shaped credential scan (findSecretMatches)",
    methodNames: ["findSecretMatches"],
    denyingPhrases: [
      /no (?:automated |executable )?(?:guard|scan|check) (?:looks for|scans for|detects) a vendor-prefixed (?:secret|credential|token) committed (?:to|in) this repository/i,
      /a committed (?:AWS|GitHub|Slack|Stripe|npm) (?:access )?(?:key|token) would go (?:undetected|unnoticed) in ci/i,
    ],
  },
  {
    // T228, fourth of five: T44A3 (P9-W3) also shipped
    // `scripts/ci/guard-audit-baseline.mjs` — `findUnbaselinedAdvisories`
    // fails the build on any `npm audit` advisory not already covered by
    // the reasoned `AUDIT_BASELINE`; `findStaleBaselineEntries` reports (but
    // does not fail on) a baseline entry with no matching live advisory.
    //
    // FORWARD guard, same discipline as the entries above.
    //
    // `methodNames`: a flat list, not an AND-group, for the same reason as
    // the version-drift entry above — both names are uniquely declared in
    // `guard-audit-baseline.mjs` and nowhere else, measured directly.
    //
    // `denyingPhrases`: worded around the absence of the BASELINE CHECK,
    // never lifted from the guard's own header, which explains why a
    // baseline is used instead of a bare `--audit-level` gate and discloses
    // a real, permanent blind spot (two advisories sharing an identical
    // package/severity/range) — a disclosed limit, not a denial the check
    // exists, and this entry must never forbid it.
    name: "npm audit baseline enforcement (findUnbaselinedAdvisories/findStaleBaselineEntries)",
    methodNames: ["findUnbaselinedAdvisories", "findStaleBaselineEntries"],
    denyingPhrases: [
      /a new npm audit advisory (?:outside|not covered by) the baseline would (?:pass|land) (?:silently|unnoticed|undetected)/i,
      /nothing reports when an? (?:npm audit )?baseline entry no longer (?:matches|has) a live advisory/i,
    ],
  },
  {
    // T228, fifth of five: T227 (P9-W9) shipped
    // `scripts/ci/guard-declared-root-dependencies.mjs`'s
    // `findUndeclaredRootDependencies` — every third-party import in
    // `scripts/ci`'s production `.mjs` files must be declared by the ROOT
    // `package.json`, closing the same "resolves only by hoisting" shape
    // T194 closed for a workspace-only package one level up.
    //
    // FORWARD guard, same discipline as the entries above; T227's own brief
    // records that no live denying prose existed for this capability either.
    //
    // `methodNames`: a bare `findUndeclaredRootDependencies` is a full,
    // uniquely-declared function name, measured directly the same way as
    // the entries above.
    //
    // `denyingPhrases`: worded around the absence of the DECLARATION CHECK,
    // never lifted from the guard's own header, which narrates the FIXED
    // `vite` defect in the past tense and already carries a `CORRECTED (at
    // the P9-W9 merge gate)` marker of its own for an unrelated correction —
    // this entry's phrases are independent of both.
    name: "root-manifest import declaration check (findUndeclaredRootDependencies)",
    methodNames: ["findUndeclaredRootDependencies"],
    denyingPhrases: [
      /nothing checks that (?:every )?scripts\/ci import is declared (?:by|in) the root package\.json/i,
      /an undeclared third-party import in scripts\/ci (?:would|could) keep resolving by hoisting with nothing to (?:catch|flag) it/i,
    ],
  },
  {
    // T232: T44A4's `guard-workspace-test-coverage.mjs` shipped the third
    // instance of the T211/T213 "stale allowlist walk" capability class —
    // see `STALE_WORKSPACE_TEST_COVERAGE_ALLOWLIST_WALK_MEMBER`'s own doc
    // comment above for why the member is a `RegExp` anchored to the real
    // code shape rather than a bare name, the same reasoning T215's
    // `STALE_RUN_GUARD_ALLOWLIST_WALK_MEMBER` entry gives.
    //
    // FORWARD guard, T162's/T215's shape: no site anywhere in
    // `apps/web/src`, `apps/android/src`, `scripts/ci`, `packaging/**`, or
    // `docs/**` (outside the excluded ledger) denies this capability today
    // — grepped for "stale"/"cannot"/"unreachable"/"undetected"/"unnoticed"
    // across `guard-workspace-test-coverage.mjs`,
    // `guard-workspace-test-coverage.test.mjs`, and
    // `run-guard-workspace-test-coverage.mjs` and found nothing resembling
    // the phrases below: the file's own header narrates what the walk DOES
    // ("an allowlist entry is checked for staleness by walking the
    // allowlist's own keys directly ... why folding either check into the
    // main loop would make it unreachable"), never that it fails to. So
    // there is no live sentence to prove this entry against; it is proven
    // instead against a scratch copy of a real tracked file and pinned at
    // the fixture level below — see this task's own report for the exact
    // file, sentence, and both exit codes.
    //
    // Not a group: this single member is already unique across every
    // tracked shipped file (measured directly, see that constant's own
    // comment), so there is no bare-name collision for an AND-group to
    // guard against, the same as T215's two entries above.
    name: "guard-workspace-test-coverage detects stale allowlist entries (stale-missing-workspace/stale-tested)",
    methodNames: [STALE_WORKSPACE_TEST_COVERAGE_ALLOWLIST_WALK_MEMBER],
    denyingPhrases: [
      /guard-workspace-test-coverage(?:\.mjs)? (?:cannot|can'?t|does not) (?:report|detect|catch) a stale allowlist entry/i,
      /an? ALLOWLISTED_UNTESTED_WORKSPACES entry naming a (?:renamed|removed|nonexistent|non-existent) workspace (?:cannot be (?:flagged|detected|caught)|goes unnoticed|is never (?:re-?checked|revisited))/i,
      /a workspace (?:that a workflow|a workflow) now (?:genuinely )?tests can (?:still|also) (?:sit|remain) in the allowlist (?:unnoticed|undetected)/i,
    ],
  },
  {
    // T246: `run-guard-capability-prose.mjs`'s `isShippedSourcePath` used to
    // require `<pkg-or-app>/src/` or `scripts/ci`, so a capability declared
    // in an app-ROOT config file — `apps/android/app.config.ts`, evaluated
    // by Expo directly rather than imported from `src/` — was invisible to
    // it. T235 shipped `computeVersionCodeFromSemver` there and falsified
    // two runbooks that asserted the capability was absent; the DENIAL side
    // already saw both (`isAppSourcePath` admits `docs/**`), but the
    // SHIPPING side could not, so any entry registered before the widening
    // would have exited 0 forever no matter how false the docs became. This
    // entry exists only because `run-guard-capability-prose.mjs`'s
    // `APP_ROOT_CONFIG_PATTERN` (added in the same commit) closes that gap.
    //
    // Not a FORWARD guard in the usual sense: a live denial of this exact
    // capability DID exist, in the two runbooks T235 falsified — but both
    // were already corrected (with a `CORRECTED at the P9-A merge gate`
    // marker directly before each quoted false sentence) before this entry
    // was written, so neither trips it today. Confirmed directly: the guard
    // stays at exit 0 with this entry registered and both runbooks in the
    // real, committed tree — see this task's own report for the exact
    // command and output. The RED/GREEN proof below instead uses a
    // scratchpad-restored copy of a third, unrelated tracked file (never
    // `apps/android/app.config.ts`, which this task's scope excludes, and
    // never one of the two runbooks, whose live text is the CORRECTED
    // quotations this entry must not trip on) — see this task's own report
    // for the exact file, sentence, and both exit codes.
    //
    // `methodNames`: a bare `computeVersionCodeFromSemver` is a full,
    // camel-cased function name — measured directly across every
    // `packages/*/src`, `apps/*/src`, `scripts/ci`, and (T246)
    // `apps/*/app.config.ts` file: exactly one declaring file,
    // `apps/android/app.config.ts` itself. No AND-group or `RegExp`
    // shape-anchor is needed, the same reasoning `findBuildOrderViolations`
    // and `findRouteCoverageViolations` give for their own bare names.
    //
    // `denyingPhrases`: worded in this entry's own phrasing, never lifted
    // from `app.config.ts`'s own decision record (which narrates the
    // pre-T235 state at length and carries no `HISTORICAL_QUOTE_MARKERS`
    // trigger of its own) — describing the absence of the DERIVATION
    // itself (a hardcoded or defaulted `versionCode` untied to the app's
    // own `version`), never the separate limit both runbooks went on to
    // state: that nothing fails a release whose git TAG disagrees with the
    // `version` `app.config.ts` declares (T247's gap, not this
    // capability's). CORRECTED at the P9-E merge gate: this said that limit
    // was "still-real, permanent", which T247 falsified earlier in this same
    // wave by shipping `checkAndroidReleaseTagVersion`. The phrasing
    // separation this paragraph describes is still correct and still
    // deliberate — the two capabilities are distinct, and each now has its
    // own entry — only the claim that T247's gap was permanent was wrong.
    name: "Android versionCode derived from app.config.ts's own semver (computeVersionCodeFromSemver)",
    methodNames: ["computeVersionCodeFromSemver"],
    denyingPhrases: [
      /apps\/android\/app\.config\.ts (?:does not|never) derives? (?:its|the) `?versionCode`? from (?:its own |the app'?s own )?semver `?version`?/i,
      /every tagged (?:android )?release (?:therefore )?ships the same `?versionCode`?/i,
    ],
  },
  {
    // Registered at the P9-E merge gate, for T247, which shipped in the
    // same wave). T247 added the release-tag/version agreement check but did
    // not register it here, and that omission was deliberate rather than an
    // oversight: T246 was editing this exact file in the same wave, and
    // CLAUDE.md's T215 and T228 sections both record what happens when two
    // tasks serially edit `CAPABILITIES` (T222 and T223 contending over the
    // same member). The gate is the first point at which one owner holds the
    // whole file, so the entry lands here.
    //
    // NOT a forward guard: a live denial of this exact capability existed in
    // THREE places the moment T247 landed, and all three were corrected in
    // the same commit that adds this entry rather than before it, which is
    // why the RED proof below could use one of them directly instead of a
    // synthetic sentence. `docs/android-apk-release.md` §3.2 was corrected by
    // T247's own follow-up (`efbfb98`); `docs/clean-install-and-rollback.md`
    // §B.6 said the same thing in almost the same words and was missed, and
    // `apps/android/app.config.ts`'s decision record carried a "GAP FILED ...
    // nothing enforces that a human actually bumps `version` before pushing a
    // new release tag" block describing the very step T247 shipped. Only the
    // first two are reachable by the denial scan: `isAppSourcePath` admits
    // `docs/**` but returns FALSE for `apps/android/app.config.ts` even after
    // T246's widening, which touched `isShippedSourcePath` only. That
    // asymmetry is real and is filed as T254 — this entry cannot catch a
    // denial in the one file the capability is ABOUT.
    //
    // `methodNames`: both names measured directly against the real tree — each
    // is declared in exactly one file, `guard-android-release-tag-version.mjs`,
    // which `isShippedSourcePath` already admits under `scripts/ci` (T156's
    // widening). A flat OR-list, not T168's AND-group: either name alone is
    // unique and specific enough, the same reasoning
    // `findUndeclaredRootDependencies` gives for its own bare name.
    //
    // `denyingPhrases`: worded to catch the TAG-DISAGREEMENT claim only, and
    // deliberately narrow enough not to trip on the two adjacent statements
    // that remain TRUE and are stated in both runbooks after the correction:
    // that nothing automates the `version` bump itself, and that two builds
    // declaring the same `version` still share a `versionCode`. Neither is
    // this capability's; conflating them would make the entry fire on correct
    // prose, which is how a curated entry gets disabled within two waves.
    name: "Android release tag/version agreement enforced in CI (checkAndroidReleaseTagVersion)",
    methodNames: ["checkAndroidReleaseTagVersion", "stripReleaseTagPrefix"],
    denyingPhrases: [
      /nothing (?:fails|blocks|stops|rejects) a release (?:job |build )?(?:that|whose) tags? .{0,100}?(?:while|disagrees|does not match)/i,
      /no (?:CI )?(?:step|check|guard) (?:fails|blocks|rejects) a release whose (?:git )?tag disagrees with/i,
      /nothing enforces that (?:a human |the owner |someone )?actually bumps `?version`? before (?:pushing|cutting) a (?:new )?release tag/i,
    ],
  },
  {
    // T249: T237 (`scripts/ci/run-guard-signing-material.mjs`) shipped
    // `readContentIfWorthwhile` — the function that now reads EVERY tracked
    // file's content (subject only to the 5 MiB size cap), replacing a prior
    // `SKIP_CONTENT_READ_EXTENSIONS` set that used to return `undefined`
    // before any read for `.png`/`.jpg`/.../`.zip`/`.jar`/`.pdf` — and
    // registered nothing here. This is the identical omission class T232
    // closed for `guard-workspace-test-coverage.mjs` one commit earlier in
    // the same wave (P9-B): a real, uniquely-declared capability with no
    // `CAPABILITIES` entry.
    //
    // `isShippedSourcePath` executed directly against the declaring file,
    // per this task's own instruction rather than inferred from a list of
    // areas (T124's repeated caution against conflating `isAppSourcePath`
    // and `isShippedSourcePath`):
    // `isShippedSourcePath("scripts/ci/run-guard-signing-material.mjs")` ===
    // `true` (`scripts/ci` under T156's widening) — see this task's own
    // report for the executed command and output.
    //
    // NOT a forward guard in the usual sense: a live denial of a closely
    // related premise (that content scanning skips certain extensions) DID
    // exist in three places the moment T237 landed, and all three were
    // corrected by the P9-B merge gate (`bc6c303`) — two inside
    // `guard-signing-material.mjs`'s own header (the "would throw on binary
    // content" reasoning, and a pointer to a skip list T237 deleted) and one
    // in `docs/android-apk-release.md` §2.2 — each now carrying a
    // "CORRECTED at the P9-B merge gate" marker directly before the quoted
    // false sentence, so none trips this entry today. Do not treat that
    // silence as evidence the entry is unnecessary: an entry registered
    // before `bc6c303` would have caught two of those three sites outright.
    // Proven instead against a scratchpad-restored copy of
    // `guard-signing-material.mjs` — see this task's own report for the
    // exact sentence, file, and both exit codes — and pinned at the fixture
    // level below.
    //
    // `methodNames`: a bare `readContentIfWorthwhile` is a real,
    // camel-cased function name declared in exactly ONE file
    // (`scripts/ci/run-guard-signing-material.mjs:86`) — measured directly:
    // `git grep -n "readContentIfWorthwhile"` across the whole tracked tree
    // returns that one declaration plus mentions inside its own test file
    // (import/usage, never a second declaration) and two doc references in
    // `docs/android-apk-release.md`. No AND-group or `RegExp` shape-anchor
    // is needed, the same reasoning `findUndeclaredRootDependencies` and
    // `computeVersionCodeFromSemver` give for their own bare names.
    //
    // `denyingPhrases`: worded away from BOTH corrected sites' actual
    // wording ("would throw", "verified by reading that file's main()
    // above", "the (much narrower) skip list this guard actually uses") and
    // from `guard-signing-material.mjs`'s own present-tense narration of
    // what it does now ("reads every tracked file it can", "needs no
    // content decode at all") — compared DE-WRAPPED (`//` gutters stripped,
    // whitespace collapsed, stricter than `flattenProse` itself, which
    // leaves `//` in place) against both files' full text, so a future
    // comment reflow welding a wrapped clause onto one line cannot create
    // the collision CLAUDE.md's T215 section describes. Confirmed directly:
    // all four candidate phrases considered for this entry returned `false`
    // against that de-wrapped text before any was kept.
    name: "guard-signing-material reads every tracked file's content, no extension skipped (readContentIfWorthwhile)",
    methodNames: ["readContentIfWorthwhile"],
    denyingPhrases: [
      /run-guard-signing-material(?:\.mjs)? (?:still )?skips? (?:reading )?(?:a|the) file'?s? content based on (?:its )?extension/i,
      /(?:content|byte) scanning (?:is|gets) skipped for (?:certain|some|binary) (?:file )?extensions? before (?:this|the) guard ever reads? (?:it|them)/i,
      /guard-signing-material(?:\.mjs)? (?:cannot|can'?t|does not|never) (?:reads?|scans?) (?:a|the) (?:\.jks|\.keystore|\.apk|\.aab|keystore|binary) file'?s? content for a pem header/i,
    ],
  },
  {
    // Registered at the P9-F merge gate, for T248, which shipped in the same
    // wave. T248 deleted `run-guard-secret-scan.mjs`'s `BINARY_EXTENSIONS`
    // set and replaced the extension-gated read with `readContentForScan`,
    // so the guard now reads every tracked file's content subject only to
    // `MAX_SCANNED_BYTES`. It registered nothing here — and unlike T247's
    // omission one wave earlier, this one had no contention excuse: T249 was
    // editing this file in the same wave for the same class of defect, which
    // is the exact reason the gate is the one place both can be reconciled.
    //
    // NOT a forward guard. Three live denials existed in `isAppSourcePath`
    // scope the moment T248 landed, all corrected in the commit that adds
    // this entry: `guard-signing-material.mjs`'s header (present tense,
    // "skips a file by EXTENSION before ever reading it, and that skip list
    // (`BINARY_EXTENSIONS`) explicitly names `.keystore`, `.jks`, `.apk` and
    // `.aab`"), `.github/workflows/ci.yml`'s `guard-signing-material` job
    // comment (same claim, same tense), and `docs/android-apk-release.md`
    // §2.1, whose own `Confirm:` command grepped the CURRENT file for those
    // four extensions and had silently started returning nothing. The first
    // two are what the RED proof below used; the doc's defect was the broken
    // command rather than a denying sentence, and was fixed by pinning the
    // command to the pre-T248 commit.
    //
    // `methodNames`: `readContentForScan` is a bare, uniquely-declared
    // exported function name — measured across the whole tree, exactly one
    // declaring file, `scripts/ci/run-guard-secret-scan.mjs`, which
    // `isShippedSourcePath` admits under `scripts/ci` (T156's widening). A
    // single non-group member; no AND-group and no shape-anchored `RegExp`
    // is needed, the same reasoning `findSecretMatches` gives next door.
    //
    // `denyingPhrases`: every phrase is SCOPED TO THIS GUARD BY NAME, which
    // is not decoration. `run-guard-no-node-builtin-in-web-bundle.mjs`
    // declares its own, entirely legitimate `BINARY_EXTENSIONS` set and
    // correctly says so in prose; an unscoped phrase about skipping files by
    // extension would fire on that file's true statement, which is how a
    // curated entry gets disabled within two waves. The phrases are also
    // worded away from `run-guard-secret-scan.mjs`'s own past-tense removal
    // narration ("this guard used to skip a `BINARY_EXTENSIONS` set"), which
    // carries no `HISTORICAL_QUOTE_MARKERS` trigger of its own — "used to
    // say" is a marker, "used to skip" is not — and which the denial scan
    // does read, since `isAppSourcePath` returns true for that path.
    // Confirmed by running all three phrases over every tracked `scripts/ci`,
    // `docs/**` and workflow file after the corrections: zero hits.
    name: "guard-secret-scan reads every tracked file's content (readContentForScan)",
    methodNames: ["readContentForScan"],
    denyingPhrases: [
      /(?:run-)?guard-secret-scan(?:\.mjs)?[^.]{0,120}?(?:skips|excludes|will not read|never reads) (?:a )?file[^.]{0,60}?by extension/i,
      /`?BINARY_EXTENSIONS`? skip list (?:explicitly )?(?:excludes|names)/i,
      /(?:run-)?guard-secret-scan(?:\.mjs)?[^.]{0,140}?(?:does not|never|cannot) reads? (?:the )?(?:content|bytes) of/i,
    ],
  },
];

// Marks a denying phrase as a QUOTATION of a past false statement rather
// than a live claim — e.g. "CORRECTED (P6-W6 merge gate): this said
// \"...\"". Matched against a window of text immediately BEFORE the
// phrase; see `findCapabilityDenialViolations`.
const HISTORICAL_QUOTE_MARKERS =
  /\bCORRECTED\b|\bthis (?:paragraph )?(?:previously )?said\b|\bpreviously said\b|\bno longer true\b|\bused to say\b/i;

// How far back (in flattened characters) to look for a historical-quote
// marker before deciding a phrase match is a live claim. Generous enough to
// span a full JSDoc paragraph ("CORRECTED (P6-W6 merge gate): this said
// the trio was" before the quoted phrase), narrow enough that an unrelated
// marker elsewhere in a large file cannot launder a real, current denial.
const HISTORICAL_CONTEXT_WINDOW = 300;

// How much surrounding text to keep for a reported violation's `context`,
// so a human (or this guard's own re-introduction proof) can see the
// actual sentence without opening the file.
const REPORT_CONTEXT_WINDOW = 80;

// T244: this used to be a hand-rolled BLOCK-first regex pair
// (`/\* … \*//g` then `//.*$/gm`), which has a real collision — a `/*`-
// shaped sequence inside a genuine `//` line comment (a backtick-quoted
// glob like `` `@picompanion/*` ``, present verbatim in `guard-declared-
// root-dependencies.mjs`'s own header, one of the files this guard scans
// under `scripts/ci`) is misread as a block-comment opener and swallows
// real code up to the next unrelated real closing delimiter. Measured
// directly against that real file: before this fix,
// `isCapabilityMemberDeclared(content, "WORKSPACE_SCOPE")` returned `false`
// for a `const WORKSPACE_SCOPE = "@picompanion/";` declaration that is
// genuinely there — a real declaration this guard's own declaration-
// detection was blind to purely because of comment-stripping order. See
// `source-comment-stripper.mjs`'s own header for the full collision history
// (line-first has the mirror failure) and its real, in-tree reproduction of
// both directions. `stripCommentsAndStrings` below still layers this
// file's OWN, deliberately single-line-only `stripStringLiterals` on top —
// that erasure scope is unchanged by this task (see its own comment).
function stripComments(source) {
  return sharedStripComments(source);
}

// T184: `isCapabilityMemberDeclared`'s comment-stripping alone was never
// enough — a string literal is not a comment, so a denying SENTENCE
// phrased with a colon after the capability's member name (`"{ summary:
// not carried by the app }"`, a test title, a UI copy string) could
// satisfy the interface-property declaration shape below purely by
// resembling code, with nothing structural behind it. Single-line only
// (mirrors `STRING_LITERAL` near `joinAdjacentStringLiterals` below, kept
// separate on purpose — that one exists to JOIN a concatenation chain for
// prose matching; this one exists to ERASE a literal's contents entirely
// before a declaration check ever sees them), tolerant of escapes, and
// replaces each match with an empty literal (`""`) rather than nothing —
// deleting the quotes too could weld the surrounding tokens into a new,
// accidental match; leaving an empty pair cannot.
const STRING_LITERAL_TO_ERASE = /(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g;

function stripStringLiterals(source) {
  return source.replace(STRING_LITERAL_TO_ERASE, '""');
}

// Comments first, then string literals — stripping comments first means an
// unbalanced quote inside a comment (a contraction like "don't") can never
// be mistaken for the start of a string literal that then eats real code
// after it. See `isCapabilityMemberDeclared` and
// `findCapabilityDenialViolations` for the two call sites this backs: one
// through the public, per-call API on raw source, one through a per-file
// cache for the denial scan's shipped-resolution pass.
function stripCommentsAndStrings(source) {
  return stripStringLiterals(stripComments(source));
}

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The four declaration shapes `isCapabilityMemberDeclared` recognizes for
 * `memberName`, built once so both the public per-call API and
 * `findCapabilityDenialViolations`'s cached shipped-resolution pass test
 * the exact same patterns against the exact same (comments-and-strings-
 * stripped) code.
 */
function declarationPatternsFor(memberName) {
  const escaped = escapeForRegExp(memberName);
  return [
    // class/interface method: `async name(` or `name(...): Promise<...>`
    new RegExp(`\\basync\\s+${escaped}\\s*\\(|\\b${escaped}\\??\\s*\\([^)]*\\)\\s*:\\s*Promise\\b`),
    // function declaration: `function name(`
    new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`),
    // const/let assignment: `const name = ` / `const name: Type = `
    new RegExp(`\\b(?:const|let)\\s+${escaped}\\b\\s*[:=]`),
    // interface/type property, anchored to a member boundary so it can't
    // match mid-sentence prose that merely contains "name:":
    // `{ name: Type }`, `interface X { readonly name?: Type; }`.
    new RegExp(`[{;,]\\s*(?:readonly\\s+)?${escaped}\\??\\s*:\\s*\\S`),
  ];
}

/**
 * Whether `memberName` is declared as a real, structural member of this
 * source — never merely mentioned in a comment or a string literal, both
 * stripped first. T124 only needed one shape (a class/interface method
 * with a `Promise`-returning signature, or an `async` method). T147 adds
 * three more, because T139's capability is a plain function/hook and
 * T143's is an interface property, neither of which is a
 * `Promise`-returning method:
 *
 *  - a `function name(` declaration (`useClipboardAction`);
 *  - a `const`/`let name =` assignment (an arrow function or function
 *    expression bound to a name);
 *  - an interface/type property, optionally `readonly` and optionally
 *    optional (`name?:` or `name:`), anchored to the start of a member
 *    (`{`, `;` or `,` before it, allowing for whitespace/newlines) so a
 *    plain-English sentence that merely contains "name:" somewhere mid-
 *    clause cannot satisfy it.
 *
 * T184: `code` used to be comment-stripped only. A denying SENTENCE lives
 * either in a comment (already handled) or in a string literal (a test
 * title, a rendered UI message, a JSDoc example inside a template
 * literal) — never in bare, uncommented code — so stripping string
 * literals too (`stripCommentsAndStrings`) closes the interface-property
 * false-positive T147 flagged ("a capability whose curated member is an
 * interface property could be marked shipped by the very sentence denying
 * it, since a string literal is not a comment") for every file, not only
 * the one file `findCapabilityDenialViolations` used to special-case. See
 * `guard-capability-prose.test.mjs`'s "T147/T184" cases for the
 * end-to-end proof, and that function's own doc comment for why the old
 * per-appFile self-exclusion this replaces was itself the blindness T184
 * exists to fix.
 *
 * This still is not a generic identifier scan: it only ever runs against
 * `methodNames` from the curated `CAPABILITIES` list above, on
 * comments-and-strings-stripped code.
 */
export function isCapabilityMemberDeclared(source, memberName) {
  const code = stripCommentsAndStrings(source);
  return declarationPatternsFor(memberName).some((pattern) => pattern.test(code));
}

// T151: a denying phrase split across a `+`-concatenation boundary escaped
// this guard completely — the exact shape below exited 0 at the P6-W14
// review while the same sentence on one literal exited 1:
//
//   "... returns zero. No export action exists in " +
//     "apps/web. ...";
//
// `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s `export_html`
// note is kept concatenated on purpose (its own comment explains why); that
// file is out of this task's scope and is left untouched.
//
// Matches one string literal, then one-or-more repetitions of
// (whitespace/newline, `+`, whitespace/newline, another string literal),
// and replaces the whole chain with a single literal holding the joined
// text. Deliberately narrow per T124's "not a generic parser" mandate: the
// only thing allowed between two literals is whitespace, newlines, and a
// bare `+` — never an arbitrary expression, a template-literal
// `${...}` interpolation boundary, or arithmetic on numbers (which never
// match the leading-quote requirement below). This is a textual join, not
// a JS parser: given `"a" + "b"` it does not know or care whether `+` here
// is really string concatenation in the surrounding program, only that the
// shape is a chain of adjacent literals with nothing but `+` between them,
// which is the exact shape source formatters like oxfmt's `printWidth`
// produce when they wrap a concatenated string. Nothing above constrains
// the two literals to share the same quote character — `"A" + 'B'` and
// `` `A` + "B" `` are just as much "a chain of adjacent literals with
// nothing but `+` between them" as `"A" + "B"` is.
//
// T157: T151's first cut embedded `STRING_LITERAL.source` twice in this
// pattern without renumbering its capturing group, so the SECOND literal's
// `\1` backreference still pointed at the FIRST literal's captured quote
// character — silently requiring the two literals to close with the same
// delimiter, which nothing above says is required and which the P6-W15
// merge gate's own table shows is not: `"A " + "B"` and `'A ' + 'B'` joined,
// but `"A " + 'B'` and `` `A ` + "B" `` did not, and a three-literal chain
// with a mixed middle delimiter (`"A " + 'B ' + "C"`) both failed to join
// AND mangled the recovered text (the regex engine, unable to match the
// prior literal's quote as `\1` on the middle segment, backtracks into
// matching a shorter, wrong span). `SECOND_LITERAL` below gives the second
// copy of `STRING_LITERAL` its own capturing group (group 2 — the only
// other group in this pattern) and points its backreferences at `\2`
// instead of the reused `\1`, so each literal in the chain is validated
// against its OWN opening delimiter, independent of every other literal's.
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/.source;
const SECOND_LITERAL = STRING_LITERAL.replace(/\\1/g, "\\2");
const LITERAL_CHAIN = new RegExp(
  `${STRING_LITERAL}(?:[ \\t]*\\r?\\n?[ \\t]*\\+[ \\t]*\\r?\\n?[ \\t]*${SECOND_LITERAL})+`,
  "g",
);
const SINGLE_LITERAL = new RegExp(STRING_LITERAL, "g");

function joinAdjacentStringLiterals(source) {
  return source.replace(LITERAL_CHAIN, (chain) => {
    let joined = "";
    let match;
    SINGLE_LITERAL.lastIndex = 0;
    while ((match = SINGLE_LITERAL.exec(chain)) !== null) {
      joined += match[0].slice(1, -1); // strip the surrounding quote chars
    }
    return `"${joined}"`;
  });
}

/**
 * Collapses a source file into a single-line prose blob so a denying
 * phrase that a JSDoc line-wrap (or a `readFileSync` of a multi-line
 * template literal) splits across lines still matches as one phrase.
 * Joins adjacent `+`-concatenated string literals (T151) BEFORE stripping
 * gutter stars or collapsing whitespace, so a phrase split across a
 * concatenation boundary is joined using each literal's own text — not
 * merely bridged by whitespace collapsing, which alone cannot help here
 * since the quotes and `+` between the two literals are not whitespace.
 * Strips JSDoc gutter stars (`^\s*\* `) first so they don't get
 * interleaved into the flattened text; a doubled `**bold**` marker is
 * preserved because the lookahead below refuses to eat a star that is
 * itself followed by another star.
 */
function flattenProse(source) {
  return joinAdjacentStringLiterals(source)
    .replace(/^[ \t]*\*(?!\*)[ \t]?/gm, "")
    .replace(/\s+/g, " ");
}

/**
 * Resolves which of `capabilities` are actually SHIPPED by `shippedFiles` — the
 * exact question `findCapabilityDenialViolations` asks before it will treat a
 * denying phrase as a violation, and the reason an unshipped capability's
 * "this does not exist yet" prose is correct rather than stale.
 *
 * Extracted at the P9-W10 merge gate so the guard and its tests answer that
 * question with ONE implementation. Before this, two tests titled "... are
 * shipped" computed shippedness as `CAPABILITIES.filter(c => names.includes(
 * c.name))` — a filter over the static array declared directly above them, which
 * reads the tree not at all. Proven inert at that gate rather than argued:
 * renaming `findRouteCoverageViolations`'s declaration out of
 * `guard-axe-route-coverage.mjs` left the whole file at `# pass 149, # fail 0`,
 * with the capability genuinely gone. A test that reimplements this predicate
 * would carry the same hazard one level down, so it is exported instead.
 *
 * @param {{ path: string, content: string }[]} shippedFiles
 * @param {typeof CAPABILITIES} [capabilities]
 * @returns {typeof CAPABILITIES} the subset that is declared somewhere in `shippedFiles`
 */
export function findShippedCapabilities(shippedFiles, capabilities = CAPABILITIES) {
  // T184: comments-and-strings-stripped source, memoized ONCE per shipped
  // file object and reused by every capability's shipped-resolution check
  // — the same file is never re-cleaned. T169's `RegExp` group members and
  // T147's bare-name members now share this one cache (previously only the
  // `RegExp` path was cached; the bare-name path went through
  // `isCapabilityMemberDeclared`'s own uncached internal strip on every
  // call). Since this pass no longer runs once per appFile, the cache no
  // longer needs to survive an O(appFiles) multiplier to pay for itself —
  // it now backs a walk over `shippedFiles` alone, run once per capability
  // group — a number of groups times a number of shipped files, both of
  // which grow every wave and are trivial at any size either has reached
  // so far — but keeping it means a shipped file already cleaned for one
  // capability is never re-cleaned for the next.
  const cleanedSourceCache = new WeakMap();
  function cleanedSource(file) {
    let cleaned = cleanedSourceCache.get(file);
    if (cleaned === undefined) {
      cleaned = stripCommentsAndStrings(file.content);
      cleanedSourceCache.set(file, cleaned);
    }
    return cleaned;
  }
  function isGroupMemberDeclared(file, member) {
    const cleaned = cleanedSource(file);
    return member instanceof RegExp
      ? member.test(cleaned)
      : declarationPatternsFor(member).some((pattern) => pattern.test(cleaned));
  }
  // T168: a token may be a plain member (OR across members/files) or an
  // array AND-group requiring every member in it to be declared in the
  // SAME shipped file — see the `Capability` typedef above. T169: a
  // member in either form may itself be a `RegExp` (see
  // `isGroupMemberDeclared`).
  //
  // T184: resolved ONCE per capability, over the full `shippedFiles` list
  // with no per-appFile exclusion — this is both the blindness fix (see
  // this function's doc comment) and the performance fix: the old
  // `evidencePool.some(...)` walk ran once per (capability, appFile) pair,
  // so a capability whose sole evidence sorts near the end of a ~1200-file
  // list paid nearly the full scan for every one of ~900 appFiles (T183's
  // own doc comment measured this at ~6m for a single such entry). This
  // walk now runs exactly once per capability regardless of how many
  // appFiles exist.
  function isCapabilityShipped(capability) {
    return capability.methodNames.some((token) => {
      const members = Array.isArray(token) ? token : [token];
      return shippedFiles.some((file) =>
        members.every((member) => isGroupMemberDeclared(file, member)),
      );
    });
  }

  return capabilities.filter((capability) => isCapabilityShipped(capability));
}

/**
 * @param {{ shippedFiles: { path: string, content: string }[], appFiles: { path: string, content: string }[] }} input
 *   `shippedFiles` should be every non-test source file under any
 *   `packages/*\/src` or `apps/*\/src` (T147: widened from
 *   `packages/client/src` alone, since a capability can ship in a
 *   protocol type, a frontend-core view model, or an app feature file
 *   just as validly as on `DaemonClient`). `appFiles` should be
 *   `apps/web/src`, `apps/android/src`, `scripts/ci`, and `packaging/**`
 *   (T179 added the latter two) — comments AND string literals both
 *   count, so a false test title (as one of the ten P6-W6 sites was)
 *   is caught the same as a false doc comment.
 *
 *   "Is this capability shipped?" is resolved ONCE per capability, over
 *   the full `shippedFiles` list, before this function ever looks at
 *   `appFiles` — T184. It used to be resolved once per (capability,
 *   appFile) PAIR, with the appFile currently under judgment excluded
 *   from its own evidence pool: T147's acceptance requirement, added so a
 *   capability whose curated member is an interface property (`summary:`,
 *   `filesRead:`) could not be marked "shipped" by the very sentence
 *   denying it, in the case where that sentence's own phrasing happens to
 *   contain `identifier:` — a string literal is not a comment, so
 *   `isCapabilityMemberDeclared`'s (then comment-only) stripping would not
 *   catch it.
 *
 *   CORRECTED (P6-W23 gate): the paragraph that used to stand here added
 *   that "every capability seeded here today ships in a different file
 *   from the one that ever carried its denial (T139: `tool-call-row.tsx`
 *   declares, `CopyableField.tsx` denied; T143: `transcript-view.ts`
 *   declares, `compaction-row.tsx` denies), so this exclusion costs
 *   nothing for either". T183 made both halves false in the same wave
 *   that wrote them into force: its packaging build-order entry has
 *   exactly ONE declaring file, `scripts/ci/guard-docker-packaging-
 *   paths.mjs`, and that is the same file carrying two of the six
 *   false-premise sites the entry was written for (T179's committed
 *   inventory names them: that file's header and its
 *   `findBuildOrderViolations` doc comment). While that file was being
 *   judged, the per-appFile exclusion meant the capability was never
 *   "shipped" for that judgment, so no denial in it could ever be
 *   reported. Measured at the gate: the byte-identical line `// The guard
 *   checks that the build order matches packages/server/package.json
 *   prepack.` appended to BOTH `guard-docker-packaging-paths.mjs` and
 *   `guard-dockerignore-depth.mjs` made `run-guard-capability-prose.mjs`
 *   exit 1 in 4m3s reporting exactly ONE violation — the
 *   `guard-dockerignore-depth.mjs` copy. The copy in the declaring file
 *   was not reported at all.
 *
 *   CLOSED (T184): resolving "shipped?" once per capability, over ALL of
 *   `shippedFiles` with no per-appFile path exclusion, removes the
 *   blindness by construction — every appFile, including the sole
 *   declaring file itself, is judged against the same answer. Re-running
 *   the exact P6-W23 mutation above against this version reports **TWO**
 *   violations, one per file, including the declaring file's own copy.
 *   T147's original bug — an interface-property member self-certified by
 *   the very string that denies it — does not return: `isGroupMemberDeclared`
 *   below now runs every member check (bare-name or `RegExp`) against
 *   `stripCommentsAndStrings`-cleaned source, so a denying SENTENCE
 *   (which lives in a comment or a string literal — source code never
 *   states its own absence as bare, uncommented code) can no longer read
 *   as a declaration in ANY file, not merely the one file the old
 *   exclusion special-cased. See `guard-capability-prose.test.mjs`'s
 *   "T147/T184" cases for the end-to-end proof (a fabricated
 *   `useClipboardAction` denial whose only "evidence" is a property-shaped
 *   string literal in the very file being judged stays unshipped, so the
 *   denying comment beside it is correctly allowed) and its "T184:
 *   declaring file's own denial" case for the two-violation reproduction
 *   of the mutation above. This also removes the ~905-appFile ×
 *   ~1204-shippedFile multiplier T183's own doc comment measured as the
 *   runtime's dominant cost — see this function's timing note below.
 * @returns {{ capability: string, path: string, phrase: string, context: string }[]}
 */
export function findCapabilityDenialViolations({ shippedFiles, appFiles }) {
  const violations = [];

  // Every capability reaching this loop is shipped. `findShippedCapabilities`
  // has already dropped the ones that are not yet real — for those, prose
  // disclosing their absence is true today and must not be reported.
  for (const capability of findShippedCapabilities(shippedFiles)) {
    for (const { path, content } of appFiles) {
      const flat = flattenProse(content);

      for (const phrase of capability.denyingPhrases) {
        const flags = phrase.flags.includes("g") ? phrase.flags : `${phrase.flags}g`;
        const globalPhrase = new RegExp(phrase.source, flags);
        let match;
        while ((match = globalPhrase.exec(flat)) !== null) {
          const contextStart = Math.max(0, match.index - HISTORICAL_CONTEXT_WINDOW);
          const precedingContext = flat.slice(contextStart, match.index);
          if (HISTORICAL_QUOTE_MARKERS.test(precedingContext)) continue;

          violations.push({
            capability: capability.name,
            path,
            phrase: match[0],
            context: flat
              .slice(
                Math.max(0, match.index - REPORT_CONTEXT_WINDOW),
                match.index + match[0].length + REPORT_CONTEXT_WINDOW,
              )
              .trim(),
          });
        }
      }
    }
  }

  return violations;
}
