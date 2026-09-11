# Handoff — 2026-09-11

You have the codebase. This is only the delta: what landed today, what state the
tree is in, and what to pick up next. For everything structural, read
[`HANDOFF.md`](./HANDOFF.md) first, then [`CLAUDE.md`](./CLAUDE.md), then
[`plan.md`](./plan.md). Task scope lives in
[`docs/issues-from-plan.md`](./docs/issues-from-plan.md).

`HANDOFF.md` §1 was last refreshed at `6c55c13` (T379) and is now three commits
stale. **Re-derive live state before acting** — the four commands in its
`Re-derive before acting` block, not the table above them.

## 1 · Where the tree stands

|                       |                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| HEAD                  | `c49bf0e` — `git rev-parse HEAD` to confirm                                                           |
| Branch / remote       | `main` → `origin` (`https://github.com/ErsatzHitman/pi-companion.git`), the only permitted remote     |
| Working tree          | clean at handoff (`node scripts/ci/run-guard-clean-working-tree.mjs` → exit 0)                        |
| Ledger                | **591 tasks**, recounted at T382 from the table's own rows                                            |
| Last CI read green    | run `34585144719` at `c49bf0e` → success                                                              |
| Previous CI           | run `34583610283` at `d11a6cb` → success                                                              |
| Last Maestro dispatch | `34573541455` at `6c55c13` → success, 5/5 shards                                                      |
| Local gate baseline   | `oxfmt --check .` clean · `oxlint` 12 warnings 0 errors · `node --test scripts/ci/*.test.mjs` 895/895 |

```bash
gh run list --branch main --limit 3
```

Both of today's pushes were read green. Nothing is in flight at handoff.

## 2 · What landed today

Four commits, each with its own CI run read after the push.

| Commit    | Task              | What it did                                                                                                                                               |
| --------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6c55c13` | T378              | The 48dp touch-target audit derived its component set from the tree instead of a typed list; found and fixed a real defect in `SessionControlsPicker.tsx` |
| `f394f9d` | T379              | Refreshed `HANDOFF.md` §1 and §9/§10                                                                                                                      |
| `d11a6cb` | T380              | Nine flow comments blamed a missing emulator for limits the emulator had stopped causing                                                                  |
| `c49bf0e` | T381 filed · T382 | Filed the four-unrun-flows follow-up; added `docs/ui-reference/`                                                                                          |

### T380 — the emulator claims

Eleven of the fifteen flows in `apps/android/maestro/` run on a booted emulator on
every dispatch, but nine comments still said no device existed. Two kinds:

- **A true conclusion propped up by a dead cause.** `composer-inputs.yaml` (three
  sites), `files-and-terminal.yaml`, and `queue-retry-compaction.yaml`'s second
  site. Each keeps its conclusion on the reason that actually holds it: the native
  picker is a **system** surface outside the app's process, so Maestro's view
  hierarchy cannot observe it — on any device. "We have no device" invited someone
  to try again with one.
- **Four flows that really have never run**, for a reason nobody stated: no shard
  owns them. Two cited `apps/android/maestro/README.md`'s "What T37D proved, and
  what it did not", which T371 had corrected to say the opposite — the citation
  resolved to its own refutation.

The finding worth the task: `shard-plan.ts`'s `NON_EXIT_GATE_FLOW_NAMES` justified
excluding `queue-retry-compaction` partly because "that flow's own header states it
has never been run". That was circular — this set decides which flows CI runs, so
"it has never run" cannot justify keeping it out of the thing that would run it.
The exclusion is kept on the sound reason alone (`plan.md` §14.4's ten scenarios are
a defined set), and the circular half is gone.

Nothing was deleted to make a claim disappear. Every correction quotes what it
replaces with a `CORRECTED (T380)` marker, which is also what keeps
`guard-capability-prose` from firing on the quotations.

### T382 — `docs/ui-reference/`

Two self-contained HTML pages, one per surface, that open in a browser with no build
step and no server:

- `pi-companion-app.html` — all nine Android screens (Chat, Sessions, Live,
  Settings, plus the five extension detail screens Settings links to). The chat
  screen plays one whole turn end to end on a loop.
- `pi-companion-web.html` — the desktop console with Sessions, the transcript and
  Live visible at once.

Colour is `packages/design-tokens/src/tokens.ts` value for value, in all three theme
states. Both composers carry the owner's amendment: no mode/model/effort/context
pills above the prompt bar; a context ring immediately right of the attachment
button, opening the same four groups `PromptControlsMenu.tsx` ships.

**Read `docs/ui-reference/README.md` before touching either file.** Three rules it
states: nothing there is imported, bundled, tested or served; the apps are the
product and a page is stale whenever the two disagree; and every session, path, diff
and test count in the pages is invented, so none of it is a record of anything.

**One formatter exemption.** `.oxfmtrc.json` now ignores `docs/ui-reference/*.html`.
oxfmt does format HTML and reindents the static transcript lines, which `.ln`'s
`white-space: pre-wrap` then renders as visible leading space — and the `pre-wrap`
is load-bearing, because a mockup of a terminal has to keep the runner's own
indentation. Formatting those files changes what they show. The reason is written in
both the README and the ledger, so the exemption cannot outlive it.

## 3 · The defect shape this run kept closing

**A curated list whose omissions produce no failure.** Closed five times: T373
(TalkBack table vs Maestro flow), T375 (`plan.md` §9.2 vs router routes), T377
(recipe audit's file list vs its directory), T378 (48dp audit's component list vs
`apps/android/src`), and again in T382 where a restated `ignorePatterns` list in
`run-guard-format-check-per-commit.mjs`'s header went stale the moment a pattern was
added.

The pattern that works, in order:

1. Derive the set from the tree, never type it out.
2. Name each exemption instead of omitting it — an omission exempts a file from
   every rule; a named exemption disputes exactly one.
3. Assert the exemption's own claim, so it fails when it stops being true.
4. Give the derived set a floor, so a broken walk cannot pass by finding nothing.
5. When a restated list or count is the problem, **drop it rather than re-pin it**
   — `CLAUDE.md` records this choice twice already.

Do not answer the next instance with a generic guard. `CLAUDE.md`'s T217 section
measured that question at 867 hits and a 100% false-positive rate, and closed it.

## 4 · Next steps

1. **T381** — the four flows (`file-download`, `recovered-turn-banner`,
   `session-tree-sheet`, `queue-retry-compaction`) still have no shard. Its ledger
   section has the scope. The constraint that makes it non-trivial: the exit gate
   asserts exactly `plan.md` §14.4's ten scenarios, and adding a flow to that set
   silently changes what "Phase 5 exits green" means. A separate, explicitly
   non-gating shard is the sketch; leaving them deliberately unobserved and saying
   so is the cheaper alternative and has to be argued against, not skipped.
2. **Refresh `HANDOFF.md` §1** — it is three commits stale, and §1 is the table the
   next agent re-derives live state from.
3. **Dispatch Maestro** if you touch anything under `apps/android/`:
   `gh workflow run android-maestro-e2e.yml --ref main`. It is `workflow_dispatch`
   only and does not run on push.

## 5 · Open acceptance boxes, and whose they are

**Ours:**

- **T313** — needs a real `android-apk-release.yml` run whose EAS build fails, to
  prove the failure path.
- **T381** — the four flows, above.

**The owner's** (do not try to close these yourself):

- **T44B1** — create an EAS signing keystore and dispatch the release workflow.
- **T373** — a human TalkBack pass on a real device.
- **T374** — `docs/android-apk-release.md` §4 steps 2, 4 and 5.

## 6 · Hard rules worth restating before you touch anything

These are in `CLAUDE.md` and `HANDOFF.md` in full. The ones that have actually cost
this project something:

- **Port `6767` is the owner's production daemon.** Never bind it, connect to it, or
  kill anything on it. Dev is `6768`. A CI guard fails if any file under
  `apps/android/maestro/` names 6767.
- **Never `npm install -g @picompanion/cli`, never run `paseo`, never start a
  daemon locally.** `$PASEO_HOME` is the owner's live data.
- **Never `git worktree add "$VAR"` with a bare variable** (T191 — that destroyed
  `.git` once, with no remote to recover from).
- **Never restore a file with `git checkout --`.** Copy it to the scratchpad first
  and restore from that copy.
- **Never run a verification command in the background and poll it.** The one
  accepted exception is an until-loop on `gh run view` for a CI run.
- **Never run the full monorepo test suite locally**, and never blanket-kill
  `node.exe`. `vitest` at its default 24 threads gets killed for low memory on this
  machine — use `--maxWorkers=3`.
- **Never pipe a verification run through `tail -N`** — it swallows the `Tests` line
  and the pipe's exit code masks vitest's.
- `--reporter=basic` does not exist in this Vitest. `git push` alone is a no-op; use
  `git push origin main`.
- Every commit ends with the `Co-Authored-By:` and `Claude-Session:` trailers.

## 7 · Per-commit gate set

In this order, from `D:/pi-companion`:

```bash
npx oxfmt <changed paths>
npx tsc --noEmit -p apps/android/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx vitest run --dir apps/android/src  --maxWorkers=3
npx vitest run --dir apps/android/e2e  --maxWorkers=3
git add -A && node --test scripts/ci/*.test.mjs
node scripts/ci/run-guard-capability-prose.mjs
node scripts/ci/run-guard-no-production-daemon-port.mjs
node scripts/ci/run-guard-declared-root-dependencies.mjs
node scripts/ci/run-orphan-modules.mjs
npx oxfmt --check .
npx oxlint
node scripts/ci/run-guard-clean-working-tree.mjs
git push origin main
# then read the real CI run and record its id and conclusion
```

`npx vitest run --dir <path>` accepts only one `--dir`. Commit after each task with
a ledger row and a ledger section; the row is exactly 241 characters, cells of width
8/118/11/18/8/71.
