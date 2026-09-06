# CLAUDE.md — Pi Companion agent guide

This file supplements [`README.md`](./README.md) for AI coding agents (Claude, Pi, or
otherwise) working in this repository.

## The authoritative spec

**[`plan.md`](./plan.md) is the sole, authoritative plan for this repository.** It
supersedes every earlier plan, including anything from the abandoned fork experiment
that produced the Paseo reference checkout's Pi UI renderers and Beautiful component
work. Read it — in particular "Read this first", §5 (legacy frontend policy), §6
(repository structure), and §13 (development phases) — before making any structural
or architectural change. Task-level scope and acceptance criteria are broken out in
[`docs/issues-from-plan.md`](./docs/issues-from-plan.md); when in doubt about a task's
boundary, that file governs, but it never overrides `plan.md` on architecture.

If you are executing a specific task, read that task's section, plus the `plan.md`
sections it cites, before writing code. Do exactly that task's scope; do not fill in
files owned by a different task.

## What this repository is (and is not)

- This is a **new repository built from scratch**. It is not a Git fork of Paseo:
  no fork history, no upstream remote, no inherited working tree. Never add a git
  remote pointing at Paseo or any other upstream.
- `D:\paseo` (Paseo `v0.3.0-beta.2`) is a **read-only reference checkout**. You may
  read it for behavior — request names, capability gates, timeline catch-up rules,
  connection probing, attachment/outbox edge cases, terminal resize ownership, old
  test scenarios — but you must never modify it, and you must convert what you learn
  into a new test or written requirement rather than copying implementation.
- The backend — `protocol`, `client`, `server` (including the Pi provider), `relay`,
  `highlight`, `cli`, `pi-bridge`, `expo-two-way-audio` — was ported from that
  reference under `@picompanion/*` with AGPL-3.0-or-later attribution recorded in
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and `docs/T0*-provenance.md`.
  This work is done; treat those packages as the AGPL-compliant backend foundation.
- **Nothing from Paseo's `packages/app` (its old frontend) may ever enter this
  repository.** No Pi UI renderer, no Beautiful component, no Expo Router screen, no
  store, no test, no config from that tree may be copied, ported, or used as a base
  for `apps/web`, `apps/android`, or `packages/frontend-core`. Those two apps are
  built from blank scaffolds sharing one framework-neutral core. See `plan.md` §5 for
  the full exclusion boundary and the one narrow exception (a legacy-data export
  utility that may only ever be added inside the legacy checkout, never here).

## Reference-only documents in this tree

Some files here are copied verbatim from Paseo or generated while auditing it, and
describe Paseo's **old** product/frontend/monorepo layout. They are historical or
behavioral reference material only — never treat them as this product's
specification, and never let their descriptions of "Paseo" bleed into new product
docs, UI copy, or package metadata:

- `packages/server/README.md`, `packages/server/CLAUDE.md`, `packages/server/AGENTS.md`
- `packages/client/README.md`, `packages/protocol/README.md`, `packages/pi-bridge/README.md`
- `packages/expo-two-way-audio/README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`
- `docs/T02-provenance.md`, `docs/T03-provenance.md`, `docs/T04-provenance.md`
- `docs/frontend-data-migration.md`, `docs/pi-extension-compatibility.md`

`plan.md` itself is the only document in this repository that describes the _new_
product; everything above is reference-only.

## Repository invariants

These hold everywhere in the codebase, not just for a single task:

- `packages/frontend-core` must never import React, React Native, Expo, DOM types,
  or browser globals. It exposes `platform/` interfaces; platform implementations
  live in `apps/web` and `apps/android`.
- `apps/web` is DOM-first React + Vite. No Next.js, no SSR.
- `apps/android` is Android-only. It must contain no `.web.*` files and no web-only
  imports; Metro is configured to reject them.
- Web and Android depend on package **exports** (e.g. `@picompanion/frontend-core`,
  `@picompanion/design-tokens`), never source-relative cross-workspace paths.
- Any `@/` alias is package-local; no root-level alias maps into a package `src`.
- Nothing from any Paseo `packages/app` tree may enter this repository, in any form.
- The only git remote is `origin` = `https://github.com/ErsatzHitman/pi-companion.git`, added
  by the owner on 2026-09-06 (T190) after the repository loss showed that "add no git remote"
  left zero recovery path. Add no other remote, and never one pointing at Paseo.
- The repository is AGPL-3.0-or-later from its first commit.
- Every committed blob is LF, and `.gitattributes` (`* text=auto eol=lf`, T192) keeps working
  copies LF on every platform. Before it existed, a Windows checkout with `core.autocrlf=true`
  materialised CRLF and four committed `scripts/ci` tests that read the real
  `packaging/docker/Dockerfile` and `packaging/nix/flake.nix` through `\n`-anchored regexes
  failed locally while passing on CI, and `oxfmt --check .` reported ~2361 of 2369 files as
  misformatted. Three waves burned verifier time re-proving that noise was noise. **The local
  baseline is `node --test scripts/ci/*.test.mjs` all-pass and `oxfmt --check .` → clean;
  a failure in either is real.** Do not restate the test COUNT here. It changes on any wave that
  adds a guard, and a stale figure reads as a regression to the next reader: it was 394 when this
  paragraph was written, 424 at P8-W10, 461 at P8-W11 and 484 at P8-W12, and a merge gate paid to
  re-derive it each time. What matters is that nothing fails. If you ever see the whole formatter go red at once, check
  `.gitattributes` is still present before you believe anything else.

## Working locally

- Keep the production daemon on port `6767` untouched unless the user explicitly
  approves a restart. Local development uses a separate dev daemon on
  `127.0.0.1:6768` (see `plan.md` §15.1).
- Follow the repository rule: **do not run the full test suite locally.** Run
  targeted, one-shot, time-boxed commands and let CI run the complete matrix, e.g.:

  ```bash
  npx vitest run <specific-test-file> --bail=1
  npm run typecheck --workspace=@picompanion/frontend-core
  npm run lint -- apps/web/src packages/frontend-core/src
  ```

- Never start watch-mode, interactive, or long-running server commands (`vite dev`,
  `expo start`, `vitest --watch`, or anything waiting on stdin) as part of
  verification. Kill anything you spawn before finishing a task.

- **Never run a verification command in the background and then poll it.** Run it in
  the foreground, once, with an explicit timeout, and read the result. Do not
  `run_in_background` a build, test, typecheck, Playwright run, or Maestro flow and
  then loop on `true`, `sleep`, `tail`, or `cat` of its log waiting for it to finish.

  This is the single largest source of wasted work in this repository. One task
  (T57) spent 623 turns and 385 tool calls to make 14 edits: 172 of those calls were
  a bare `true` and another 22 were `cat`/`tail` of a log, all of it polling a
  Playwright run. Every poll turn re-sends the entire context, so the loop cost
  roughly 176M input tokens and drove peak context to 397k while the agent was, in
  substance, doing nothing. Foreground runs cost one turn regardless of how long they
  take.

  If a command is genuinely too slow to foreground within its timeout, that is a
  signal the task is mis-scoped, not a reason to poll. Say so plainly, record what
  you could and could not verify, and stop. A task whose acceptance criteria require
  a real-browser or on-device run should keep that run as its only slow step, with
  implementation and unit-level proof completed and committed before it.

- Commit incrementally so partial progress is never lost, and use commit messages
  prefixed with the task ID you are implementing (e.g. `T12B: ...`).

## Wave-end and merge-gate verification MUST run against committed content (T93)

An orphaned uncommitted fix has twice concealed the true state of `main`: at P5-W22 it
hid a silent revert (the reverted fix's replacement sat uncommitted in the tree); at
P5-W23 `main` was **red** at `f4446ff` — two committed assertions about the same file
that could not both pass — while the verifier reported `2141 passed`, a number that
existed only with two uncommitted files applied on top. Every gate that verifier ran
(the whole suite, a mutation proof, "typecheck clean") tested content no commit
contained. `git status` on the reported-clean tree would have shown it instantly.

This is not optional and not a suggestion — it is a required procedure for anyone
(agent or human) verifying a task, a wave, or a merge gate before reporting gate
results or declaring the wave done:

1. **Before running any gate**, make the tree you are about to test unambiguous:
   - Prefer testing an actual clean checkout of the commit(s) under test — e.g.
     `git worktree add --detach <scratch-dir> <sha-or-range-tip>` and run every gate
     inside that worktree, or a fresh `git clone`. This is the strongest guarantee:
     nothing uncommitted can possibly be on the path.

     **`<scratch-dir>` must be a literal, absolute path you have just printed — never
     a bare shell variable (T191).** On 2026-09-06 the P6-W24 merge gate ran
     `git worktree add --detach "$TMPDIR_X" b34c11c` with the variable unset. Git
     received an empty path, failed with `fatal: The empty string is not a valid path`,
     and on that failure recursively deleted the directory it had been "preparing" —
     which resolved to the repository itself. `.git/` (every commit, `main`, nine
     stashes), `.github/`, `.gitignore`, `.dockerignore`, `.oxfmtrc.json` and
     `.oxlintrc.json` were destroyed; only a lock on `.pi/` stopped the enumeration
     there. History was not recoverable (no remote, no clone, no bundle existed); the
     tree was re-initialised at `2063eb2` and the deleted files were rebuilt from
     session transcripts. If you script this step, `set -u` and
     `[ -n "$DIR" ] || exit 1` before the `git` call, and `mkdir` the directory
     first so a wrong value fails on `mkdir`, not inside git.

   - If testing in place (the working tree you have been editing) is unavoidable,
     `git stash --include-untracked` immediately before running any gate, run every
     gate, then `git stash pop` to restore afterward — never let a gate run see
     content that is not in a commit.
   - Never run `npm run test`, `vitest run`, `npm run typecheck`, or
     `npm run format:check` in place without first doing one of the above and
     confirming (see step 2) that the tree is clean.

2. **Before reporting ANY gate result — pass or fail — run
   `node scripts/ci/run-guard-clean-working-tree.mjs` from the repository root** (see
   `scripts/ci/guard-clean-working-tree.mjs` for exactly what it checks and what
   `.gitignore`-covered scratch output it correctly ignores). A non-zero exit means
   STOP: the gate result you were about to report is not about `main`, or is not about
   the commit you think it is — commit the named files (if they belong to your task)
   or discard them (if they are stray), then re-run every gate from a clean state.
3. If a worktree or clone was used for step 1, remove it after use
   (`git worktree remove --force <scratch-dir>`) — it is scratch, not a deliverable.
4. A gate result is only reportable once step 2 exits `0` on the exact tree the gates
   in step 1 ran against. "The suite passed" and "the tree is clean" are two separate,
   both-required facts — report both, never only the first.
5. **After you push, read the real CI run for the commit you pushed, and record its
   conclusion and run id.** Local green plus CI red is a **RED wave**, not a passing one
   with an infrastructure footnote. Until 2026-09-06 this repository had no remote (T190),
   so the strongest available gate was a local approximation of CI — and the first push
   proved the approximation disagreed. Two defects had sat on `main` across many waves:
   an undeclared workspace dependency in `apps/android` (T194) and every CI job building
   `frontend-core` before `@picompanion/client` (T195). Both were invisible locally because
   every local checkout carries a stale `packages/client/dist` that a clean `npm ci`
   checkout does not have, so the same typecheck passes here and fails there. **A stale
   `dist` is the standing reason a local build can disagree with CI; suspect it first.**

   No browser is needed, and the orchestrator — not an implementer — is the one who
   pushes and reads the result:

   ```bash
   gh run list --branch main --limit 3
   gh run view <run-id>
   gh run view --job <job-id> --log-failed
   ```

This check is local-only, run by hand at wave end as step 2 above, and is deliberately
NOT wired into CI (`.github/workflows/ci.yml`). T96 closed that as will-not-wire:
`actions/checkout` always hands a CI job a pristine tree, so a `guard-clean-working-tree`
job would report exit 0 on every run by construction, including at the two commits that
motivated this guard — `9ac1184` (P5-W22's silent revert) and `f4446ff` (P5-W23's red
`main`) both reproduce exit 0 from a pristine `git worktree` checkout. The guard only
does real work against a working tree an agent has actually been editing, which is
exactly what step 2 above runs it against.

See `plan.md` §14 (testing strategy) and §15 (development and deployment) for full
detail on required test layers, contract fixtures, performance budgets, bundling, and
the Android release pipeline.

## Never quote a SHA from the harness's `gitStatus` block (P6-W19)

The `gitStatus` system-reminder an agent receives at session start is a **snapshot taken
when the session opened** and is not refreshed as the session runs. In a long orchestration
session it goes stale by hundreds of commits: at P6-W19 it still named `6ae376a` ("docs:
record the P6-W1 outcome") as HEAD, **159 commits behind** the actual wave base, and an
implementer copied that SHA into a committed calibration comment as "measured at HEAD".
The measurements were real and correct; only the provenance was false, which is the worst
shape — a number a future reader will trust, attributed to a tree that never produced it.

**`git rev-parse HEAD` is the only acceptable source for a SHA that goes into shipped prose,
a commit message, or a test comment.** The same applies to the branch name and the recent
commit list in that block. Treat all of it as "what was true when this session started".

## Prose asserting a capability is absent, once it lands, is a defect (T124)

This is the fourth wave in which a capability landed beside prose — a doc comment, an
interface comment, even a test title — asserting that capability does not exist. At
P6-W6, T110 landed as the wave's **first** commit (real `getQueueModes`/
`setSteeringMode`/`setFollowUpMode` sends on `packages/client/src`'s `DaemonClient`) and
T38B1a, written against the pre-T110 tree, landed as its **fourth** — so ten sites across
six files shipped a stale premise: "no shipped `DaemonClient` implements this", "not
implemented by any shipped `DaemonClient`", "true of every real `DaemonClient`", "no wire
request to change it today". The worst (`Composer.tsx`'s header comment) described what a
user sees, and had it backwards. All ten were corrected at the gate (`dabe8c4`).

**The rule this encodes: before you land a capability, grep for prose asserting it is
missing — in the same commit that lands it.** `grep -rn` the method/capability name and
phrases like "no shipped", "not implemented", "does not exist", "no wire request" across
`apps/web/src` and `apps/android/src`, and fix every hit your own commit falsifies.

This is now also a committed, hard check, run the same way as the T93 procedure above is
a committed hard check for tree cleanliness — not a substitute for the grep above, a
backstop for it:

- `scripts/ci/guard-capability-prose.mjs` holds a curated `CAPABILITIES` list — deliberately
  narrow, not a generic "grep every comment" linter, which would false-positive forever and
  get disabled within two waves. Each entry names a capability's method(s) and the specific
  phrases that would be false once it ships. A name may be a group (T168): every name in the
  group must be declared in the SAME file before that group counts as shipped, which is how
  an entry avoids being satisfied by an unrelated member of the same name elsewhere. Seven
  entries as of the P6-W17 gate: the
  seeded queue-mode trio (`getQueueModes`/`setSteeringMode`/`setFollowUpMode`); T147's visible
  clipboard-failure state (`useClipboardAction`) and carried compaction detail
  (`summary`/`filesRead`/`filesModified`); the P6-W14 gate's redacted diagnostics export
  (`useDiagnosticsExport`/`buildDiagnosticsExportBundle`); T157's own
  `joinAdjacentStringLiterals`, the first entry for a capability shipping in `scripts/ci`
  and the reason T156 had to widen the scope above before it could be added; T162's transfer
  cancellation; and the P6-W17 gate's upload-cancel opcode.
- `node scripts/ci/run-guard-capability-prose.mjs` fails when a named method is genuinely
  declared in any `packages/*/src`, `apps/*/src`, or `scripts/ci` file, test files excluded
  (comments stripped first, so a TODO mentioning the method doesn't count as "shipped")
  while a comment OR string literal (a test title counts — one of the ten P6-W6 sites
  was one) in `apps/web/src` or `apps/android/src` uses one of that capability's denying
  phrases.
- It deliberately does **not** fire on a quoted historical correction — prose reading
  "CORRECTED (P6-W6 merge gate): this said \`...\`" while explaining what used to be wrong.
  `dabe8c4`'s own fix left several files quoting the exact false sentence verbatim for this
  reason; a naive phrase match would fail the guard against its own correction. A denying
  phrase is only a violation when no such marker ("CORRECTED", "this said", "previously
  said", "no longer true", "used to say") appears in the text immediately before it.
- **Add a new capability entry the moment you ship one**, and check first that the runner
  can SEE where your capability ships. The scope has been widened twice for exactly this
  reason: T147 from `packages/client/src` to `packages/*/src`+`apps/*/src` after an entry
  outside the client package proved inert, and T156 to `scripts/ci` after an entry for a
  guard's own capability proved inert the same way. An entry the runner cannot see is a
  check that cannot fail. The value of this guard is in the next capability it catches,
  not the five listed here.

`scripts/ci/guard-capability-prose.test.mjs` covers this with `node --test`, including a
pair of tests proving the historical-quotation handling is real: the exact corrected
prose passes, and deleting only the "CORRECTED" marker from that same sentence fails.
