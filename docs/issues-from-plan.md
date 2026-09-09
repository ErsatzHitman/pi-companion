# Workflow-ready task breakdown from plan.md

**Source:** `plan.md` (greenfield rewrite, 2026-08-31). **Purpose:** small, isolated tasks
for parallel implementation with `@quintinshaw/pi-dynamic-workflows` — each task runs as one
agent in its own worktree, with a testing round and a final merge stage.

**Sizing rule:** every task must be completable by ONE agent in 1-3 hours and deliver one
cohesive thing. If a task needs a long unattended build-fix-rerun loop, it is too big and
must be split further. (An earlier, coarser cut of this list produced single tasks that ran
over an hour and burned millions of tokens; that is the failure mode this rule exists to
prevent.)

**Isolation design rules used here:**

- Tasks inside the same wave touch **disjoint file sets**, so their worktree branches merge
  cleanly.
- Tasks that must touch the same files are **serialized with `depends-on`** and placed in
  different waves.
- Scaffold tasks create every directory and `package.json` up front so later feature tasks
  only add files inside their own subtree and never edit shared root files.
- The Pi UI payload fix is a hard gate: **T07A → T07B** must land before any renderer or
  client-side Pi UI state task (T21B, T29A/B, T34A/B), per plan §4.2.
- Constraint guards are tasks themselves: `frontend-core` must have no React/DOM/React
  Native/Expo imports (T14), web is DOM-first Vite (T15), Android is Android-only with no
  `.web.*` files (T16), and nothing from Paseo's `packages/app` ever enters the repo (T17A).
- Never run watch-mode, interactive, or unbounded commands inside a task; tests are one-shot
  and time-boxed.

**Reference imports:** tasks labeled `area: reference-import` copy or adapt code from the
read-only `D:\paseo` checkout (Paseo `v0.3.0-beta.2`, AGPL-3.0-or-later). Each must record
provenance and AGPL attribution (consolidated in T05).

**Execution model:** one phase at a time. Within a phase, each wave runs its tasks in
parallel, then a testing round verifies each branch, then one merge agent integrates the phase
into `main`. Phases 0-4 were planned at up to 5-10 concurrent agents and their wave rows still
record what actually ran. **Phases 5, 6 and 7 are capped at 4 concurrent agents**, and their
wave tables were recomputed by list scheduling over the declared dependency graph under that
cap — no wave exceeds 4 tasks and no task is scheduled at or before any of its dependencies.

**Tallies in this file (decided at T219, P8-W18):** this file carries a few hand-incremented
running counts rather than values any guard can check —
`scripts/ci/guard-capability-prose.mjs`'s `DOCS_LEDGER_DENIAL_EXCLUSIONS` excludes this whole
file from its denial scan, so no check in this repository can ever see one of these go stale.
Keeping them honest here is a convention, not a gate. Two shapes exist, and they get different
treatment because one counts a single set that keeps growing and the other is many independent
tasks each recording their own local snapshot of the same three named sites — see `CLAUDE.md`'s
T217 subsection for why a generic guard over count claims was investigated and rejected, and why
that recomputation has to be domain-specific:

- **The master table's own size** (the total-task-count line right below it) is an open,
  ever-growing count — every wave adds rows, so no fixed number is ever going to stay true. Per
  this decision it is _dated_ to the commit it was last verified against, the same convention
  `docs/legacy-retirement.md` §2.3 uses for its gate figures: a snapshot to recount and re-date,
  never to silently overwrite. Do not bump that number without doing the count yourself
  (distinct task IDs in the table above) and updating the date alongside it.
- **The Android "construction-site" counters.** This family is defined by SHAPE, not by a list:
  any count — in merge gates _or_ in waves, which are the same claim in two phrasings — of
  how long `getProbeUrl`/`NativeNetworkReachability`, `SqliteStructuredStorage`/`OfflineCache`,
  or the terminal transport has stayed unconstructed, wherever it appears. Each such number is
  that task's own account at the time it was written. Today the family is `T32S7`, `T32S11`,
  `T32S12`, `T32S13`, `T60C`, `T62`, `T68` and `T32B6`, and a ninth task narrating the same
  sites is covered on the day it lands, which is why the rule is the shape and not that list.
  (CORRECTED at the P8-W18 merge gate: this named five tasks and defined the family BY that
  enumeration, which left `T32S7`'s "two waves running", `T60C`'s "three consecutive waves"
  and `T32B6`'s "three waves" — all counted, so none of them reachable by the no-count
  exemption below — in neither the covered set nor the excused one.)
  The family is **not one running quantity and must never be read as one**: it does
  not even increase monotonically. `T62` (wave `P5-W17`) reports the terminal at "four merge gates
  and counting" one wave _after_ `T32S11` (wave `P5-W16`) reported it at "five gates", and `T68`
  (wave `P5-W20`) reports `OfflineCache` at "twelve consecutive merge gates" a full wave after
  `T32S13` (wave `P5-W19`) reported `getProbeUrl` — a different site — at twelve. Every number in
  this family belongs to the paragraph it sits in and is dated by that paragraph's own task, whose
  `wave:` line is the date; most entries even say so in the prose itself ("updated after P5-W15",
  "after P5-W17", "confirmed at the P5-W16 merge gate"). **Do not edit any of these numbers to
  make them agree with each other or with anything measured today, and do not try to derive a
  single current count from them** — that arithmetic was never valid, which is exactly why this
  decision leaves the family alone rather than reconciling it. The one pair named in T219's own
  brief that predates every later task's "as of wave X" phrasing — `T32S11`'s "since P5-W9 — six
  gates" / "since P5-W10 — five gates" — is the sole exception: it is annotated in place, below,
  with the wave that produced it, and nothing about its meaning is changed by that annotation.
- A bare "unmounted since P5-Wxx" with no attached count (for example `T32S10`'s, elsewhere in
  this file) is not a tally at all — it names a starting wave, not a number that grows — and
  needs no dating.

---

## Master table

| ID     | Title                                                                           | Phase     | Area             | Wave   | Depends on                                                            |
| ------ | ------------------------------------------------------------------------------- | --------- | ---------------- | ------ | --------------------------------------------------------------------- |
| T01    | Initialize greenfield repository and tooling baseline                           | phase-0   | tooling          | P0-W1  | —                                                                     |
| T02    | Port protocol, relay, and highlight packages                                    | phase-0   | reference-import | P0-W2  | T01                                                                   |
| T10    | Write Phase 0 decision docs and verify release identity                         | phase-0   | docs             | P0-W2  | T01                                                                   |
| T03    | Port client SDK, CLI, pi-bridge, and audio module                               | phase-0   | reference-import | P0-W3  | T02                                                                   |
| T04    | Port server daemon with Pi provider                                             | phase-0   | reference-import | P0-W3  | T02                                                                   |
| T05    | Record third-party provenance and AGPL attribution                              | phase-0   | docs             | P0-W4  | T02, T03, T04                                                         |
| T06A   | Capture Pi RPC event fixtures                                                   | phase-0   | protocol         | P0-W4  | T04                                                                   |
| T06B   | Capture daemon WebSocket and bridge-kind fixtures                               | phase-0   | protocol         | P0-W4  | T04                                                                   |
| T09A   | Implement incremental live-tail checkpoint                                      | phase-0   | protocol         | P0-W4  | T04                                                                   |
| T06C   | Add transcript-protection tests                                                 | phase-0   | protocol         | P0-W5  | T06A                                                                  |
| T07A   | Define typed Pi UI payload schemas and capability gate                          | phase-0   | protocol         | P0-W5  | T06B                                                                  |
| T09B   | Add watcher race tests and live-tail benchmark                                  | phase-0   | protocol         | P0-W5  | T09A                                                                  |
| T07B   | Normalize and dual-emit Pi UI payloads in the daemon                            | phase-0   | protocol         | P0-W6  | T07A                                                                  |
| T07C   | Add payload compatibility fixtures and COMPAT tags                              | phase-0   | protocol         | P0-W7  | T07B                                                                  |
| T08A   | Implement bridge state and identity rules                                       | phase-0   | protocol         | P0-W7  | T07B                                                                  |
| T08B   | Implement revision handling and reconnect replay tests                          | phase-0   | protocol         | P0-W8  | T08A                                                                  |
| T11    | Prune unused server dependencies                                                | phase-0   | tooling          | P0-W9  | T04, T08B, T09B                                                       |
| T12A   | Wire root workspaces, scripts, and workspace stubs                              | phase-1   | tooling          | P1-W1  | T03, T04                                                              |
| T12B   | Write README and CLAUDE repository docs                                         | phase-1   | docs             | P1-W2  | T12A                                                                  |
| T13    | Build design-tokens package with web and native outputs                         | phase-1   | tokens           | P1-W2  | T12A                                                                  |
| T14    | Build frontend-core skeleton with import guards                                 | phase-1   | core             | P1-W2  | T12A                                                                  |
| T17A   | Create CI pipeline, path filters, and legacy guards                             | phase-1   | ci               | P1-W2  | T12A                                                                  |
| T18    | Create daemon web-UI bundling script and prepack                                | phase-1   | tooling          | P1-W2  | T04, T12A                                                             |
| T15    | Scaffold blank DOM-first web shell                                              | phase-1   | web              | P1-W3  | T12A, T14                                                             |
| T16    | Scaffold Android-only Expo shell with Metro guards                              | phase-1   | android          | P1-W3  | T12A, T14                                                             |
| T17B   | Create Android APK release workflow                                             | phase-1   | ci               | P1-W4  | T16, T17A                                                             |
| T19A   | Implement DaemonClient lifecycle and feature gates                              | phase-2   | core             | P2-W1  | T03, T14                                                              |
| T20A   | Implement timeline reducer core invariants                                      | phase-2   | core             | P2-W1  | T06A, T14                                                             |
| T21A   | Implement permission and extension dialog state                                 | phase-2   | core             | P2-W1  | T14                                                                   |
| T21B   | Implement Pi UI element state and revision handling                             | phase-2   | core             | P2-W1  | T07A, T14                                                             |
| T22    | Implement core drafts, outbox, and offline cache                                | phase-2   | core             | P2-W1  | T14                                                                   |
| T23    | Implement core tool-call view models with fallback                              | phase-2   | core             | P2-W1  | T06A, T14                                                             |
| T19B   | Implement host registry, probing, and relay selection                           | phase-2   | core             | P2-W2  | T19A                                                                  |
| T20B   | Implement pagination, gap recovery, and reconciliation                          | phase-2   | core             | P2-W2  | T20A                                                                  |
| T21C   | Implement extension action controller                                           | phase-2   | core             | P2-W2  | T21B                                                                  |
| T24    | Add navigation intents, fixtures, recorded-session test                         | phase-2   | core             | P2-W3  | T19B, T20B, T21C, T22, T23                                            |
| T25A   | Build web primitives and component lab                                          | phase-3   | web              | P3-W1  | T13, T15                                                              |
| T26A   | Build Android primitives and component lab                                      | phase-3   | android          | P3-W1  | T13, T16                                                              |
| T25B   | Build web recipes and accessibility passes                                      | phase-3   | web              | P3-W2  | T25A                                                                  |
| T26B   | Build Android recipes and accessibility passes                                  | phase-3   | android          | P3-W2  | T26A                                                                  |
| T13B   | Re-token design system to Beautiful UI language                                 | phase-3.5 | tokens           | P35-W1 | T25B, T26B                                                            |
| T25C   | Web conformance pass to Beautiful UI language                                   | phase-3.5 | web              | P35-W2 | T13B                                                                  |
| T26C   | Android conformance pass to Beautiful UI language                               | phase-3.5 | android          | P35-W2 | T13B                                                                  |
| T13C   | Bundle Inter/Geist Mono and complete light-theme values                         | phase-3.5 | tokens           | P35-W3 | T25C, T26C                                                            |
| T27S1  | Build the three-region web app shell                                            | phase-4   | web              | P4-W1  | T24, T25A                                                             |
| T27S2  | Add the web route table and lazy route boundaries                               | phase-4   | web              | P4-W1  | T24, T25A                                                             |
| T27A1  | Build the connect form and host-profile validation                              | phase-4   | web              | P4-W2  | T27S1, T27S2                                                          |
| T27A2  | Add bearer-token authentication and credential storage                          | phase-4   | web              | P4-W3  | T27A1                                                                 |
| T27A3  | Apply ConnectionOffer pairing payloads                                          | phase-4   | web              | P4-W4  | T27A2                                                                 |
| T27A4  | Add QR-based pairing capture                                                    | phase-4   | web              | P4-W5  | T27A3                                                                 |
| T27A5  | Handle daemon-injected bootstrap configuration                                  | phase-4   | web              | P4-W6  | T27A2                                                                 |
| T27A6  | Build the connection error taxonomy and relay profiles                          | phase-4   | web              | P4-W7  | T27A5                                                                 |
| T27B1  | Render the session list from core state                                         | phase-4   | web              | P4-W3  | T27S1                                                                 |
| T27B2  | Add session create and open                                                     | phase-4   | web              | P4-W4  | T27B1                                                                 |
| T27B3  | Add session resume and cold open                                                | phase-4   | web              | P4-W5  | T27B2                                                                 |
| T27B4  | Add session archive and delete                                                  | phase-4   | web              | P4-W6  | T27B3                                                                 |
| T27B5  | Add Pi session discovery and import                                             | phase-4   | web              | P4-W7  | T27B4                                                                 |
| T27B6  | Keep session list state correct across reconnect                                | phase-4   | web              | P4-W8  | T27B5                                                                 |
| T28A1  | Build the transcript view model in frontend-core                                | phase-4   | core             | P4-W2  | T24                                                                   |
| T28A2  | Render assistant, user, and streaming messages                                  | phase-4   | web              | P4-W3  | T28A1, T27S1                                                          |
| T28A3  | Render thinking and reasoning sections                                          | phase-4   | web              | P4-W4  | T28A2                                                                 |
| T28A4  | Render tool calls and the safe unknown-tool card                                | phase-4   | web              | P4-W5  | T28A3                                                                 |
| T28A5  | Render images, attachments, and diffs                                           | phase-4   | web              | P4-W6  | T28A4                                                                 |
| T28A6  | Virtualize the transcript to a bounded window                                   | phase-4   | web              | P4-W7  | T28A5                                                                 |
| T28A7  | Render compaction and retry markers and compact layout                          | phase-4   | web              | P4-W8  | T28A6                                                                 |
| T28B1  | Build the composer input and prompt submission                                  | phase-4   | web              | P4-W3  | T27S1                                                                 |
| T28B2  | Add steer, follow-up, and abort                                                 | phase-4   | web              | P4-W4  | T28B1                                                                 |
| T28B3  | Show queue state and queue controls                                             | phase-4   | web              | P4-W5  | T28B2                                                                 |
| T28B4  | Add slash-command completion                                                    | phase-4   | web              | P4-W6  | T28B3                                                                 |
| T28B5  | Add model and thinking-level selection                                          | phase-4   | web              | P4-W7  | T28B4                                                                 |
| T28B6  | Add composer attachments                                                        | phase-4   | web              | P4-W8  | T28B5                                                                 |
| T28B7  | Build permission and approval dialogs                                           | phase-4   | web              | P4-W9  | T28B6                                                                 |
| T29A1  | Build the web renderer registry                                                 | phase-4   | web              | P4-W2  | T21C, T25A                                                            |
| T29A2  | Render the status, widget, and progress kinds                                   | phase-4   | web              | P4-W3  | T29A1                                                                 |
| T29A3  | Render the log, markdown, and composer kinds                                    | phase-4   | web              | P4-W4  | T29A2                                                                 |
| T29B1  | Render the roster kind                                                          | phase-4   | web              | P4-W5  | T29A3                                                                 |
| T29B2  | Render the form kind with action states                                         | phase-4   | web              | P4-W6  | T29B1                                                                 |
| T29B3  | Render the diff kind                                                            | phase-4   | web              | P4-W7  | T29B2                                                                 |
| T29B4  | Render the panel kind composing other kinds                                     | phase-4   | web              | P4-W8  | T29B3                                                                 |
| T29B5  | Add dangerous-action confirmation                                               | phase-4   | web              | P4-W9  | T29B4                                                                 |
| T29R1  | Build the right extension rail container                                        | phase-4   | web              | P4-W3  | T27S1                                                                 |
| T29R2  | Show fleet, workflow, loop, and goal state in the rail                          | phase-4   | web              | P4-W9  | T29R1, T29B1                                                          |
| T29C1  | Derive context-window and cache telemetry in core                               | phase-4   | core             | P4-W2  | T24                                                                   |
| T29C2  | Render the context window and cache meter                                       | phase-4   | web              | P4-W10 | T29C1, T29R1                                                          |
| T30A1  | Build the TerminalController in frontend-core                                   | phase-4   | core             | P4-W2  | T24                                                                   |
| T30A2  | Build the xterm terminal route                                                  | phase-4   | web              | P4-W3  | T30A1, T27S2                                                          |
| T30A3  | Honour terminal resize ownership and latency                                    | phase-4   | web              | P4-W4  | T30A2                                                                 |
| T30B1  | Browse and list files over daemon RPC                                           | phase-4   | web              | P4-W3  | T27S2                                                                 |
| T30B2  | Read and display a file read-only                                               | phase-4   | web              | P4-W4  | T30B1                                                                 |
| T30B3  | Add the CodeMirror editor and save path                                         | phase-4   | web              | P4-W5  | T30B2                                                                 |
| T30B4  | Add file upload and download                                                    | phase-4   | web              | P4-W6  | T30B3                                                                 |
| T30B5  | Add file search                                                                 | phase-4   | web              | P4-W7  | T30B4                                                                 |
| T30B6  | Add the file diff view                                                          | phase-4   | web              | P4-W8  | T30B5                                                                 |
| T31A   | Build the Playwright harness and isolated daemon fixture                        | phase-4   | web              | P4-W10 | T27A6, T27B6                                                          |
| T31B1  | Green the connect and deep-link restore scenarios                               | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31B2  | Green the session lifecycle scenario                                            | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31B3  | Green the steer and follow-up scenario                                          | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31B4  | Green the transcript tool-call and diff scenario                                | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31B5  | Green the reconnect and catch-up scenario                                       | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31B6  | Green the keyboard-navigation and axe scenario                                  | phase-4   | web              | P4-W11 | T31A, T53A4                                                           |
| T31C1  | Cover the approvals scenarios                                                   | phase-4   | web              | P4-W12 | T31B2, T28B7, T29B5                                                   |
| T31C2  | Cover the Pi extension bridge scenarios                                         | phase-4   | web              | P4-W12 | T31B2, T29B5                                                          |
| T31C3  | Cover the terminal scenarios                                                    | phase-4   | web              | P4-W12 | T31B2, T53A5, T30A3                                                   |
| T31C4  | Cover the file browser scenarios                                                | phase-4   | web              | P4-W12 | T31B2, T53A5, T30B6                                                   |
| T31D   | Enforce the performance budgets in CI                                           | phase-4   | ci               | P4-W13 | T31C1, T31C2, T31C3, T31C4                                            |
| T32S1  | Build the Android navigation shell                                              | phase-5   | android          | P5-W1  | T24, T26A                                                             |
| T32S1B | Wire lifecycle events into the resume controller                                | phase-5   | android          | P5-W2  | T32S1, T46A2                                                          |
| T32S1C | Register Phase-5 route stubs for every feature family                           | phase-5   | android          | P5-W3  | T32S1B                                                                |
| T32S2  | Add deep links and cold-start routing                                           | phase-5   | android          | P5-W6  | T32S1C                                                                |
| T32S3  | Own the Android router root for the rest of Phase 5                             | phase-5   | android          | P5-W7  | T32S2, T32B3, T33A2                                                   |
| T32S4  | Mount the transcript and bridge slots, and keep owning the router root          | phase-5   | android          | P5-W9  | T32S3, T33A3, T34A5                                                   |
| T32S5  | Own the Android shared UI primitives and recipes                                | phase-5   | android          | P5-W9  | T32S1C, T33B4                                                         |
| T32S6  | Mount wave P5-W9's deliverables and keep owning the router root                 | phase-5   | android          | P5-W10 | T32S4, T32P1, T32S5, T33A4, T37A                                      |
| T32S7  | Mount wave P5-W10's deliverables and keep owning the router root                | phase-5   | android          | P5-W11 | T32S6, T33B5, T35A2, T37B                                             |
| T32S8  | Mount wave P5-W11's deliverables and keep owning the router root                | phase-5   | android          | P5-W12 | T32S7, T32B6, T34A6                                                   |
| T32S9  | Mount wave P5-W12's deliverables and keep owning the router root                | phase-5   | android          | P5-W13 | T32S8, T33B6, T35B2                                                   |
| T32S10 | Mount wave P5-W13's deliverables and keep owning the router root                | phase-5   | android          | P5-W14 | T32S9, T32A6, T33A6                                                   |
| T32S11 | Mount wave P5-W14's deliverables and keep owning the router root                | phase-5   | android          | P5-W16 | T32S10, T32P2, T36A, T36C, T60C                                       |
| T32S12 | Mount wave P5-W16 and P5-W17's deliverables and keep owning the router root     | phase-5   | android          | P5-W18 | T32S11, T32P3, T36F, T60C                                             |
| T32S13 | Mount the six deliverables P5-W18 left unmounted and make the composer send     | phase-5   | android          | P5-W19 | T32S12, T63, T64, T36F, T32A7                                         |
| T32P1  | Own the Android platform adapters and report a real network path                | phase-5   | android          | P5-W9  | T32S3, T32B5                                                          |
| T32P2  | Build the Android file-picker and sharing platform adapters                     | phase-5   | android          | P5-W15 | T35A4, T60C                                                           |
| T32P3  | Write the Android NotificationsPlatform adapter and settle the state union      | phase-5   | android          | P5-W17 | T36A, T36B, T60C                                                      |
| T32A1  | Build the Android connect form                                                  | phase-5   | android          | P5-W4  | T32S1C                                                                |
| T32A1B | Wire the Android connect form to a live DaemonClientLifecycle                   | phase-5   | android          | P5-W6  | T32A1, T19A                                                           |
| T32A2  | Store credentials in SecureStore                                                | phase-5   | android          | P5-W5  | T32A1                                                                 |
| T32A3  | Apply ConnectionOffer pairing on Android                                        | phase-5   | android          | P5-W7  | T32A2                                                                 |
| T32A4  | Add QR camera pairing                                                           | phase-5   | android          | P5-W9  | T32A3                                                                 |
| T32A5  | Support relay host profiles on Android                                          | phase-5   | android          | P5-W11 | T32A4                                                                 |
| T32A6  | Build first-run onboarding                                                      | phase-5   | android          | P5-W13 | T32A5                                                                 |
| T32A7  | Carry the daemon host and port on DaemonConnectionSnapshot                      | phase-5   | android          | P5-W18 | T32S11, T35A4                                                         |
| T32A8  | Complete the connect-to-session-list path                                       | phase-5   | android          | P5-W18 | T32A6, T32S11, T37E1                                                  |
| T32C1  | Add the Android settings screen                                                 | phase-5   | android          | P5-W15 | T32S10, T33B6                                                         |
| T32B1  | Render the Android session list                                                 | phase-5   | android          | P5-W4  | T32S1C                                                                |
| T32B2  | Add Android session create and open                                             | phase-5   | android          | P5-W5  | T32B1                                                                 |
| T32B3  | Add Android session resume and cold-start restore                               | phase-5   | android          | P5-W6  | T32B2                                                                 |
| T32B4  | Add Android session archive and delete                                          | phase-5   | android          | P5-W7  | T32B3                                                                 |
| T32B5  | Survive network path switches                                                   | phase-5   | android          | P5-W8  | T32B4                                                                 |
| T32B6  | Own the Android session list for the rest of Phase 5                            | phase-5   | android          | P5-W11 | T32B5, T32P1, T32S4                                                   |
| T33A1  | Build the compact transcript header and status strip                            | phase-5   | android          | P5-W4  | T32S1C                                                                |
| T33A2  | Render Android messages and streaming text                                      | phase-5   | android          | P5-W6  | T33A1                                                                 |
| T33A2B | Supply the Android frame-clock platform implementation                          | phase-5   | android          | P5-W5  | T32S1C, T45A2                                                         |
| T33A3  | Render Android thinking sections                                                | phase-5   | android          | P5-W7  | T33A2                                                                 |
| T33A4  | Render Android tool calls and unknown-tool card                                 | phase-5   | android          | P5-W9  | T33A3                                                                 |
| T33A5  | Render Android images, attachments, and diffs                                   | phase-5   | android          | P5-W12 | T33A4                                                                 |
| T33A6  | Virtualize the Android transcript                                               | phase-5   | android          | P5-W13 | T33A5                                                                 |
| T33B1  | Build the Android bottom composer                                               | phase-5   | android          | P5-W4  | T32S1C                                                                |
| T33B2  | Add Android steer, follow-up, and abort                                         | phase-5   | android          | P5-W5  | T33B1                                                                 |
| T33B3  | Add Android queue controls                                                      | phase-5   | android          | P5-W6  | T33B2                                                                 |
| T33B4  | Fix IME and sheet keyboard ownership                                            | phase-5   | android          | P5-W8  | T33B3                                                                 |
| T33B5  | Add Android approvals in-app                                                    | phase-5   | android          | P5-W9  | T33B4                                                                 |
| T33B6  | Add haptic patterns                                                             | phase-5   | android          | P5-W12 | T33B5                                                                 |
| T33B7  | Add Android attachments and mic action                                          | phase-5   | android          | P5-W13 | T33B6                                                                 |
| T34A1  | Build the Android renderer registry                                             | phase-5   | android          | P5-W1  | T21C, T26A                                                            |
| T34A2  | Render Android status, widget, and progress kinds                               | phase-5   | android          | P5-W2  | T34A1                                                                 |
| T34A3  | Render Android log, markdown, and composer kinds                                | phase-5   | android          | P5-W3  | T34A2                                                                 |
| T34A4  | Pin the bridge area above the composer                                          | phase-5   | android          | P5-W7  | T34A3                                                                 |
| T34A5  | Give the Pi UI bridge a live element store and action controller                | phase-5   | android          | P5-W8  | T34A4                                                                 |
| T34A6  | Feed a live agent_stream into the Pi UI store and send actions                  | phase-5   | android          | P5-W11 | T34A5, T32S6                                                          |
| T34B1  | Render the Android roster and pin the fleet                                     | phase-5   | android          | P5-W8  | T34A4                                                                 |
| T34B2  | Render the Android form kind                                                    | phase-5   | android          | P5-W10 | T34B1                                                                 |
| T34B3  | Render the Android diff kind                                                    | phase-5   | android          | P5-W11 | T34B2                                                                 |
| T34B4  | Render the Android panel kind                                                   | phase-5   | android          | P5-W13 | T34B3                                                                 |
| T35A1  | Browse files on Android over daemon RPC                                         | phase-5   | android          | P5-W8  | T32S2                                                                 |
| T35A2  | Read and display a file on Android                                              | phase-5   | android          | P5-W10 | T35A1                                                                 |
| T35A3  | Add the Android native editor                                                   | phase-5   | android          | P5-W12 | T35A2                                                                 |
| T35A4  | Add Android upload and download                                                 | phase-5   | android          | P5-W14 | T35A3                                                                 |
| T35B1  | Build the Android terminal WebView wrapper                                      | phase-5   | android          | P5-W10 | T32S2                                                                 |
| T35B2  | Honour the binary channel and backpressure                                      | phase-5   | android          | P5-W12 | T35B1                                                                 |
| T35B3  | Verify Android terminal resize and keyboard                                     | phase-5   | android          | P5-W14 | T35B2                                                                 |
| T36A   | Add Android push registration                                                   | phase-5   | android          | P5-W14 | T32B5                                                                 |
| T36B   | Add permission notifications with safe actions                                  | phase-5   | android          | P5-W15 | T36A                                                                  |
| T36C   | Add share-intent handling                                                       | phase-5   | android          | P5-W14 | T32B5                                                                 |
| T36D   | Add voice entry and attachment pickers                                          | phase-5   | android          | P5-W15 | T32B5                                                                 |
| T36E   | Choose and wire the Android share-intent receiver                               | phase-5   | android          | P5-W16 | T36C, T32P2                                                           |
| T36F   | Write the native ShareIntentPort module                                         | phase-5   | android          | P5-W18 | T36E                                                                  |
| T37A   | Wire the Expo SQLite offline cache                                              | phase-5   | android          | P5-W9  | T32B5                                                                 |
| T37B   | Mark cached data stale until catch-up                                           | phase-5   | android          | P5-W10 | T37A                                                                  |
| T37C   | Recover from process death during a turn                                        | phase-5   | android          | P5-W13 | T37B                                                                  |
| T37D   | Build the Maestro harness                                                       | phase-5   | android          | P5-W15 | T37C                                                                  |
| T57B   | Make the source-text regex tests mutation-proof                                 | phase-5   | android          | P5-W16 | T33B1                                                                 |
| T60A   | Unify the secret-shaped redaction helper across the apps                        | phase-5   | core             | P5-W11 | T33A4, T37A                                                           |
| T60B   | Declare and pre-build the workspace packages apps/android imports               | phase-5   | core             | P5-W11 | T35A2                                                                 |
| T60C   | Declare the undeclared dependencies and unblock three stalled adapters          | phase-5   | core             | P5-W16 | T60B, T32P1, T37A                                                     |
| T60D   | Unify the two Android permission-recovery vocabularies                          | phase-5   | android          | P5-W15 | T32A6, T33B7                                                          |
| T60E   | Fold CameraPermissionStatus onto PermissionState and widen the guard            | phase-5   | android          | P5-W17 | T60D, T32A4                                                           |
| T60F   | Delete the notification permission-recovery restatement                         | phase-5   | android          | P5-W17 | T60D, T36B                                                            |
| T60G   | Own the permission-recovery vocabulary and apply T60F's per-kind title override | phase-5   | android          | P5-W18 | T60E, T60F, T32P3                                                     |
| T61    | Confirm push re-registration semantics in the protocol and daemon               | phase-5   | core             | P5-W16 | T36A                                                                  |
| T61B   | Send the superseded push token on refresh                                       | phase-5   | core             | P5-W18 | T61, T36A                                                             |
| T62    | Expose a public terminal frame API on DaemonClient                              | phase-5   | core             | P5-W17 | T34A1, T34B4                                                          |
| T63    | Build a live-turn path so a real agent_permission_request can be raised         | phase-5   | android          | P5-W18 | T33A6, T34A1, T36B                                                    |
| T64    | Subscribe to pi_queue_update and produce a real turnRunning signal              | phase-5   | android          | P5-W19 | T63, T33A6                                                            |
| T65    | Give TerminalBinaryTransport a dispose hook so a left screen unsubscribes       | phase-5   | android          | P5-W19 | T62, T32S12                                                           |
| T66    | Make a relay-paired profile reconnectable and give it a download path           | phase-5   | android          | P5-W19 | T32A8, T32A7                                                          |
| T67    | Fail loudly when the share-intent config plugin cannot patch MainActivity       | phase-5   | android          | P5-W19 | T36F                                                                  |
| T68    | Construct an OfflineCache on AppCore and give it a lifecycle owner              | phase-5   | android          | P5-W20 | T32S13, T60C                                                          |
| T32S15 | Mount whatever P5-W21 leaves unreached (fourteenth mount task)                  | phase-5   | android          | P5-W22 | T69, T70, T74                                                         |
| T73    | Reconstruct a daemonAddress on a direct reconnect                               | phase-5   | android          | P5-W22 | T32S14, T66                                                           |
| T74    | Give AppCore a shutdown path so its singletons are disposed                     | phase-5   | android          | P5-W21 | T68, T32S14                                                           |
| T75    | Make the composer's text-only send and retry reach the real OutboxController    | phase-5   | android          | P5-W22 | T33B7, T32S13                                                         |
| T76    | Give recoverInFlightTurns and createTurnOutbox a production caller              | phase-5   | android          | P5-W23 | T37C, T60C                                                            |
| T77    | Cover the file download path T32S14 made reachable                              | phase-5   | android          | P5-W22 | T37E9, T32S14                                                         |
| T78    | Mount platform/file-picker.ts and platform/sharing.ts into FilesScreen          | phase-5   | android          | P5-W22 | T32P2, T35A4                                                          |
| T79    | Give the files and terminal routes real in-app navigation                       | phase-5   | android          | P5-W22 | T35A4, T35B3                                                          |
| T80    | Make the terminal route reachable instead of permanently unavailable            | phase-5   | android          | P5-W23 | T62, T59                                                              |
| T81    | Bring composer-icon-action.tsx inside the touch-target audit loop               | phase-5   | android          | P5-W21 | T37E10                                                                |
| T82    | Stop OfflineCacheOwner's catch path from clobbering a disposed state            | phase-5   | android          | P5-W22 | T68, T74                                                              |
| T83    | Collapse the double microphone permission prompt to one port                    | phase-5   | android          | P5-W23 | T70, T36D                                                             |
| T84    | Make a gate read Maestro flow comments, not only their steps                    | phase-5   | android          | P5-W23 | T72                                                                   |
| T85    | Consolidate the touch-target audits onto one strict predicate                   | phase-5   | android          | P5-W23 | T81                                                                   |
| T86    | Make files-and-terminal.contract.test.ts parse its own flow's steps             | phase-5   | android          | P5-W23 | T72, T78                                                              |
| T87    | Declare @picompanion/highlight and the blocked native dependencies              | phase-5   | android          | P5-W24 | T35A2, T60C                                                           |
| T88    | Mount native-network-reachability so the network-path-change rule can fire      | phase-5   | android          | P5-W24 | T32P1, T87                                                            |
| T89    | Guard against a wave commit that reverts an earlier commit in the same wave     | phase-5   | android          | P5-W23 | T32S15                                                                |
| T90    | Make the touch-target audit read hitSlop's value, not merely its presence       | phase-6   | android          | P6-W1  | T81, T85                                                              |
| T91    | Close the prose-premise falsification class T84 does not catch                  | phase-6   | android          | P6-W2  | T72, T84, T86                                                         |
| T92    | Wire run-guard-no-wave-self-revert into CI, scoped to the PR's own range        | phase-6   | tooling          | P6-W1  | T89                                                                   |
| T93    | Fail a wave that ends with a dirty working tree                                 | phase-6   | tooling          | P6-W1  | T89                                                                   |
| T94    | Retire mic-permission-port.ts or give it a production consumer                  | phase-6   | android          | P6-W5  | T83                                                                   |
| T95    | Surface a recovered awaiting-confirmation turn in the transcript                | phase-6   | android          | P6-W2  | T76                                                                   |
| T96    | Close the guard-clean-working-tree CI item as will-not-wire, with the reason    | phase-6   | tooling          | P6-W2  | T92, T93                                                              |
| T97    | Carry streamingBehavior through the Pi RPC prompt command                       | phase-6   | daemon           | P6-W2  | T38B0a, T38B0b                                                        |
| T98    | Export the extension fixtures from frontend-core's public testing barrel        | phase-6   | core             | P6-W2  | T40A1                                                                 |
| T99    | Fail the Pi-mirror contract test loudly on CI, and close get_entries' drift     | phase-7   | daemon           | P6-W13 | T38A0, T51A                                                           |
| T100   | Delete or consume packages/protocol/src/literal-union.ts                        | phase-7   | protocol         | P6-W13 | T51A                                                                  |
| T101   | Give the server e2e and integration lanes a bounded, sandboxed runner           | phase-6   | tooling          | P6-W4  | T38A0                                                                 |
| T102   | Bring packages/server test files under typecheck                                | phase-6   | tooling          | P6-W5  | T97                                                                   |
| T103   | Export the actions domain from frontend-core's public barrel                    | phase-6   | core             | P6-W3  | T47A1a, T98                                                           |
| T104   | Assert §11.7 fixture coverage by parsing the plan table                         | phase-6   | core             | P6-W5  | T40A2                                                                 |
| T105   | Give editFromHere and RequestArbitrator production consumers                    | phase-6   | web              | P6-W4  | T38A1b, T38A3, T103                                                   |
| T106   | Prove the recovered-turn banner above the source-text layer                     | phase-6   | android          | P6-W5  | T95, T87                                                              |
| T107   | Honour streamingBehavior on the already-active-turn path                        | phase-6   | daemon           | P6-W4  | T38B0c                                                                |
| T109   | Warn once on an unknown channel in the Pi UI decoder                            | phase-6   | daemon           | P6-W5  | T40A3                                                                 |
| T110   | Send fork, clone, rename and the queue modes from the client                    | phase-6   | client           | P6-W6  | T38A1b, T38A4, T38A5, T38B0c                                          |
| T111   | Carry answeredBy through agent_permission_resolved                              | phase-6   | protocol         | P6-W7  | T47A1a, T47A2                                                         |
| T112   | Give pi_notice a consumer or delete it                                          | phase-6   | daemon           | P6-W6  | T40A2                                                                 |
| T113   | Deliver workflow:progress's step and total to the rail                          | phase-6   | daemon           | P6-W7  | T40A4                                                                 |
| T114   | Render elapsed time from startedAt, and settle Edit-from-here's gating          | phase-6   | web              | P6-W7  | T40A4, T105                                                           |
| T115   | Resolve three unreferenced modules                                              | phase-6   | repo             | P6-W6  | T101                                                                  |
| T116   | Install expo-router, or stop declaring it                                       | phase-6   | android          | P6-W6  | T87                                                                   |
| T117   | Split the plan.md loader out of apps/web's production graph                     | phase-6   | web              | P6-W7  | T38A5, T104                                                           |
| T118   | Drive the Android §11.7 matrix from the plan table                              | phase-6   | android          | P6-W7  | T104, T40B1                                                           |
| T119   | Give the server typecheck ceiling a floor and a coverage assertion              | phase-6   | tooling          | P6-W8  | T102                                                                  |
| T120   | Re-include the seven deferred ui-bridge test files                              | phase-6   | tooling          | P6-W9  | T102, T109                                                            |
| T121   | Wire the recovered-turn banner's outbox at the production mount                 | phase-6   | android          | P6-W8  | T106, T87                                                             |
| T122   | Build @picompanion/client in the web CI jobs, or name the gap                   | phase-6   | tooling          | P6-W8  | T110, T38B1a                                                          |
| T123   | Move the two remaining dev-lab tests onto a comment-stripping reader            | phase-6   | android          | P6-W8  | T32S1C, T106, T39A                                                    |
| T124   | Guard against prose that asserts a capability is absent                         | phase-6   | tooling          | P6-W9  | T110, T38B1a                                                          |
| T125   | Commit the import-graph orphan walker to scripts/ci/                            | phase-6   | tooling          | P6-W9  | T115, T101                                                            |
| T126   | Guard apps/web/src against a node: builtin re-entering the bundle               | phase-6   | tooling          | P6-W9  | T117, T38A5                                                           |
| T127   | Surface the queue-mode provider notice the web adapter drops                    | phase-6   | web              | P6-W8  | T38B1a, T110                                                          |
| T128   | Attribute Pi UI action results the way T111 attributed permissions              | phase-6   | protocol         | P6-W9  | T111, T47A1a                                                          |
| T129   | Fix the third vacuous dev-lab test, recipe-lab.test.ts                          | phase-6   | android          | P6-W9  | T123, T39A                                                            |
| T130   | Sweep every raw-readFileSync source-text test for the same defect class         | phase-6   | tooling          | P6-W10 | T123, T129                                                            |
| T131   | Mount AgentSettingsPanel and wire auto-compaction/auto-retry onto DaemonClient  | phase-6   | web              | P6-W10 | T38B2                                                                 |
| T132   | Wire queueModeClient/turnStatusClient into the Android production Composer      | phase-6   | android          | P6-W10 | T39C, T121                                                            |
| T133   | Extend the web bundle guard to bare node builtin specifiers                     | phase-6   | tooling          | P6-W10 | T126                                                                  |
| T134   | Give answeredBy a human label, or resolve one at the surfaces                   | phase-6   | protocol         | P6-W10 | T111, T128                                                            |
| T135   | Register the two dev-lab routes router-root.test.ts has never allowed           | phase-6   | android          | P6-W11 | T39A, T106                                                            |
| T136   | Make router-root.test.ts runnable without expo-router installed                 | phase-6   | android          | P6-W11 | T32S2, T87                                                            |
| T137   | Gate format:check per commit across a wave range, not only at the tip           | phase-6   | tooling          | P6-W11 | T93                                                                   |
| T138   | Assert ROUTE_HEADINGS covers every non-fallback web route                       | phase-6   | web              | P6-W12 | T41B1, T54A2                                                          |
| T139   | Make useClipboardAction fail visibly instead of always saying Copied            | phase-6   | web              | P6-W12 | T41B1                                                                 |
| T140   | Style the diagnostics screen (six orphaned pc-diagnostics class names)          | phase-6   | web              | P6-W12 | T41B1                                                                 |
| T142   | Decide get_tree's fate: wire it or remove the plumbing                          | phase-6   | daemon           | P6-W12 | T51A                                                                  |
| T143   | Carry compaction_end's discarded structured payload to the client               | phase-6   | protocol         | P6-W12 | T51A, T38B3                                                           |
| T144   | Give use-file-search.test.ts its own path-authorization case                    | phase-6   | web              | P6-W12 | T41A1a                                                                |
| T146   | Render T143's carried compaction fields on web, and delete the false copy       | phase-6   | web              | P6-W13 | T143, T38B3                                                           |
| T147   | Let guard-capability-prose see capabilities outside packages/client/src         | phase-6   | tooling          | P6-W13 | T124, T139, T143                                                      |
| T148   | Separate introduced from inherited redness in the per-commit format gate        | phase-6   | tooling          | P6-W14 | T137, T93                                                             |
| T149   | Render or retire Android's carried estimatedTokensAfter compaction field        | phase-6   | android          | later  | T143, T146                                                            |
| T150   | Close the per-commit format gate's inherited-red blind spot                     | phase-6   | tooling          | P6-W15 | T148, T137                                                            |
| T151   | Join adjacent string literals before matching capability-denying prose          | phase-6   | tooling          | P6-W15 | T124, T147                                                            |
| T152   | Extend the Pi RPC drift detector to the web parity registry                     | phase-6   | daemon           | P6-W15 | T51B                                                                  |
| T153   | Give Android's file editor T41A1b's pinned write basis                          | phase-6   | android          | P6-W15 | T41A1b                                                                |
| T154   | Broaden the diagnostics export's residual query-secret backstop                 | phase-6   | web              | later  | T41B2                                                                 |
| T156   | Widen guard-capability-prose's shipped-source scope to scripts/ci               | phase-6   | tooling          | P6-W16 | T124, T147, T151                                                      |
| T157   | Fix the reused backreference in the prose guard's literal-chain pattern         | phase-6   | tooling          | P6-W16 | T151                                                                  |
| T159   | Comment-strip the parity extractor in the Pi RPC drift detector                 | phase-6   | daemon           | P6-W16 | T152                                                                  |
| T160   | Audit and drop the nine orphaned stashes on main                                | phase-6   | tooling          | owner  | T93                                                                   |
| T162   | Add a CAPABILITIES entry for web transfer cancellation                          | phase-6   | tooling          | P6-W17 | T41A3, T156                                                           |
| T163   | Close the upload-cancel protocol gap T41A3 disclosed                            | phase-6   | protocol         | P6-W17 | T41A3                                                                 |
| T164   | Retitle the prose guard's trivially-passing real-file test                      | phase-6   | tooling          | P6-W17 | T156                                                                  |
| T165   | Make the web upload hook actually send T163's cancel opcode                     | phase-6   | web              | P6-W18 | T163, T41A3                                                           |
| T166   | Close out the upload-cancel rows this file states as still open                 | phase-6   | docs             | P6-W18 | T163                                                                  |
| T168   | Tighten the transfer-cancellation entry's shipped-capability gate               | phase-6   | tooling          | P6-W18 | T162                                                                  |
| T169   | Make the transfer-cancellation gate go quiet when cancel() is gone              | phase-6   | tooling          | P6-W19 | T168                                                                  |
| T171   | Assert the packed daemon tarball actually carries the web UI                    | phase-8   | tooling          | P6-W19 | T43A1                                                                 |
| T172   | Close the compaction entry's shipped-gate hole (summary spans 33 files)         | phase-6   | tooling          | P6-W20 | T169, T168                                                            |
| T173   | Cover the isInsideDir call site, not just the predicate                         | phase-8   | daemon           | P6-W20 | T43A2                                                                 |
| T174   | Make the packaging guard check build order, not just step presence              | phase-8   | tooling          | P6-W21 | T43A3                                                                 |
| T175   | Check the packaging artifacts' runtime entrypoint paths exist                   | phase-8   | tooling          | P6-W22 | T174                                                                  |
| T176   | Wire the packaging guard into CI                                                | phase-8   | tooling          | P6-W21 | T43A3                                                                 |
| T177   | Fix .dockerignore depth semantics and its header rationale                      | phase-8   | tooling          | P6-W21 | T43A3                                                                 |
| T178   | Make the packaging guard comment-aware in its build-step checks                 | phase-8   | tooling          | P6-W22 | T174                                                                  |
| T179   | Widen guard-capability-prose's DENIAL scan to match its declaration scope       | phase-6   | tooling          | P6-W22 | T156                                                                  |
| T180   | Give .dockerignore a guard                                                      | phase-8   | tooling          | P6-W23 | T177                                                                  |
| T181   | Warn at authoring time that a new CI filter needs the pinned array updated      | phase-8   | tooling          | P6-W23 | T176                                                                  |
| T182   | Replace the hard-coded line-number pointers in the packaging prose              | phase-8   | docs             | P6-W23 | T174                                                                  |
| T183   | Add a CAPABILITIES entry for the packaging build-order capability               | phase-6   | tooling          | P6-W23 | T179, T174                                                            |
| T184   | Resolve capability-shipped once per capability, not per file pair               | phase-6   | tooling          | P6-W24 | T183                                                                  |
| T185   | Route .dockerignore edits to a CI path filter                                   | phase-8   | tooling          | P6-W24 | T180                                                                  |
| T186   | Correct the capability-prose CI job's scope prose                               | phase-6   | tooling          | P6-W24 | T179, T183                                                            |
| T187   | Widen T183's denying phrases, or scope the two remaining sites out              | phase-6   | tooling          | P6-W25 | T184                                                                  |
| T188   | Reconstruct .github/ after the repository loss (done at recovery)               | phase-8   | tooling          | P6-W24 | T185, T186                                                            |
| T189   | Recreate the six deleted root dotfiles (done at recovery)                       | phase-8   | tooling          | P6-W24 | T180                                                                  |
| T190   | Re-initialise version control and keep an off-volume bundle backup              | phase-8   | tooling          | P6-W24 | —                                                                     |
| T191   | Guard the scratch-dir variable in the T93 worktree step                         | phase-8   | docs             | P6-W24 | —                                                                     |
| T192   | Add .gitattributes so Windows checkouts stop failing four committed tests       | phase-8   | tooling          | P8-W5  | —                                                                     |
| T193   | Bind the collision test to the shipped regex it claims to be about              | phase-8   | tooling          | P8-W5  | T187                                                                  |
| T194   | Declare @picompanion/highlight in apps/android so CI typecheck passes           | phase-8   | tooling          | P8-W6  | —                                                                     |
| T195   | Build @picompanion/client before frontend-core in every CI job                  | phase-8   | ci               | P8-W6  | —                                                                     |
| T196   | Read CI after every push now that a remote exists                               | phase-8   | docs             | P8-W6  | T194, T195                                                            |
| T197   | Bring docs/ into guard-capability-prose's denial scan                           | phase-8   | tooling          | P8-W7  | T187, T193                                                            |
| T198   | Build apps/web's declared workspace dependencies from its own scripts           | phase-8   | tooling          | P8-W6  | T195                                                                  |
| T199   | Build @picompanion/server before the web-tests Playwright run                   | phase-8   | ci               | P8-W6  | T195                                                                  |
| T200   | Correct the vendored EXPO_ROUTER_CTX_IGNORE against the real package            | phase-8   | tooling          | P8-W6  | T196                                                                  |
| T201   | Make expo prebuild able to load app.config.ts without duplicating the allowlist | phase-8   | android          | P8-W6  | T36E, T200                                                            |
| T202   | Correct an overclaiming test title in guard-capability-prose.test.mjs           | phase-8   | tooling          | P8-W6  | T197                                                                  |
| T32S14 | Mount T66's reconnect path and the route-level fetchImpl seam                   | phase-5   | android          | P5-W20 | T66, T32S13                                                           |
| T69    | Build the share target chooser so features/share/ has an entry point            | phase-5   | android          | P5-W21 | T36F, T32S14                                                          |
| T70    | Mount the voice feature behind a real entry point or delete it                  | phase-5   | android          | P5-W21 | T36D, T32S14                                                          |
| T71    | Replace the terminal buffer's wall-clock assertion with a structural one        | phase-5   | android          | P5-W21 | T62                                                                   |
| T72    | Make the composer-inputs contract test read its own Maestro flow                | phase-5   | android          | P5-W21 | T37E3                                                                 |
| T37E1  | Cover the direct and relay pairing scenario                                     | phase-5   | android          | P5-W16 | T37D, T32A6                                                           |
| T37E2  | Cover the cold-start session restore scenario                                   | phase-5   | android          | P5-W16 | T37D, T32B3, T32S2, T33A6                                             |
| T37E3  | Cover the composer input and share-intent scenario                              | phase-5   | android          | P5-W17 | T37D, T36C, T36D                                                      |
| T37E4  | Cover the notification approval scenario                                        | phase-5   | android          | P5-W17 | T37D, T36B                                                            |
| T37E5  | Cover the roster, form, and panel sheet scenario                                | phase-5   | android          | P5-W17 | T37D, T34B4                                                           |
| T37E6  | Cover the background-and-kill-during-a-turn scenario                            | phase-5   | android          | P5-W20 | T37D, T37C, T33A6                                                     |
| T37E7  | Cover the network path switch scenario                                          | phase-5   | android          | P5-W20 | T37D, T32B5                                                           |
| T37E8  | Cover the offline cache and outbox flush scenario                               | phase-5   | android          | P5-W20 | T37D, T37B                                                            |
| T37E9  | Cover the files and terminal route scenario                                     | phase-5   | android          | P5-W20 | T37D, T35A4, T35B3                                                    |
| T37E10 | Cover the touch-target and TalkBack accessibility scenario                      | phase-5   | android          | P5-W20 | T37D, T33B7, T34B4, T35A4                                             |
| T37F   | Re-run the §14.4 flows as the Phase 5 exit gate                                 | phase-5   | android          | P5-W21 | T37E1, T37E2, T37E3, T37E4, T37E5, T37E6, T37E7, T37E8, T37E9, T37E10 |
| T38A0  | Mirror Pi's session fork, clone, naming, and auto-retry commands                | phase-6   | daemon           | P6-W1  | T10                                                                   |
| T38A1a | Add the session tree model to core                                              | phase-6   | core             | P6-W1  | T27B6                                                                 |
| T38A1b | Add an edit-from-here branch shortcut                                           | phase-6   | core             | P6-W3  | T38A1a                                                                |
| T38A2  | Render the session tree on web                                                  | phase-6   | web              | P6-W2  | T38A1a                                                                |
| T38A3  | Add session fork and clone                                                      | phase-6   | web              | P6-W3  | T38A2, T38A0                                                          |
| T38A4  | Add session naming and metadata                                                 | phase-6   | web              | P6-W4  | T38A3, T38A0                                                          |
| T38A5  | Check §11.1 command parity on web                                               | phase-6   | web              | P6-W5  | T38A4                                                                 |
| T38B0a | Define queue-mode and per-message routing protocol types                        | phase-6   | protocol         | P6-W1  | T10                                                                   |
| T38B0b | Mirror Pi's steering and follow-up mode RPC commands                            | phase-6   | daemon           | P6-W2  | T38B0a                                                                |
| T38B0c | Wire queue-mode changes and per-message routing through the daemon session      | phase-6   | daemon           | P6-W3  | T38B0b                                                                |
| T38B1a | Add the steer and follow-up mode control                                        | phase-6   | web              | P6-W6  | T38A5, T38B0c                                                         |
| T38B1b | Add per-message steer/follow-up routing to the composer                         | phase-6   | web              | P6-W7  | T38B1a                                                                |
| T38B2  | Add auto-compaction and auto-retry settings                                     | phase-6   | web              | P6-W8  | T38B1b, T38A0                                                         |
| T38B3  | Surface compaction, retry, and extension errors                                 | phase-6   | web              | P6-W9  | T38B2                                                                 |
| T40A1  | Cover the core extension fixtures                                               | phase-6   | core             | P6-W1  | T29B5                                                                 |
| T40A2  | Cover the remaining extension fixtures                                          | phase-6   | core             | P6-W2  | T40A1                                                                 |
| T40A3  | Verify web renderers and action round-trips                                     | phase-6   | web              | P6-W3  | T40A2                                                                 |
| T40A4  | Verify the published channels                                                   | phase-6   | web              | P6-W4  | T40A3                                                                 |
| T39A   | Add the Android session tree sheet                                              | phase-6   | android          | P6-W6  | T38A5, T33B7                                                          |
| T39B   | Add Android model and thinking selectors                                        | phase-6   | android          | P6-W7  | T39A                                                                  |
| T39C   | Add Android queue, retry, and compaction surfaces                               | phase-6   | android          | P6-W8  | T39B                                                                  |
| T40B1  | Verify the Android extension matrix                                             | phase-6   | android          | P6-W5  | T40A4, T34B4                                                          |
| T40B2  | Add real-session transcript-protection tests                                    | phase-6   | core             | P6-W6  | T40B1                                                                 |
| T47A1a | Define single-answer semantics for approvals and dialogs                        | phase-6   | core             | P6-W2  | T21C                                                                  |
| T47A1b | Guard prompt submission during a running turn against a new arbitration path    | phase-6   | core             | P6-W4  | T47A1a                                                                |
| T47A2  | Show contested and superseded state in the web dialog                           | phase-6   | web              | P6-W4  | T47A1a, T28B7                                                         |
| T41A1a | Enforce a single path-authorization door for file access                        | phase-7   | web              | P6-W11 | T31D                                                                  |
| T41A1b | Detect file write conflicts                                                     | phase-7   | web              | P7-W2  | T41A1a                                                                |
| T41A2  | Build the conflict resolution flow                                              | phase-7   | web              | P7-W3  | T41A1b                                                                |
| T41A3  | Add transfer progress and cancellation                                          | phase-7   | web              | P7-W4  | T41A2                                                                 |
| T41A4  | Keep terminal latency within budget                                             | phase-7   | web              | P7-W5  | T41A3                                                                 |
| T41B1  | Build the web diagnostics screen                                                | phase-7   | web              | P6-W11 | T31D                                                                  |
| T41B2  | Add the redacted diagnostics export                                             | phase-7   | web              | P7-W2  | T41B1                                                                 |
| T41B3  | Bound and stabilise the export                                                  | phase-7   | web              | P7-W3  | T41B2                                                                 |
| T42A1  | Add Android push and trusted devices                                            | phase-7   | android          | P7-W1  | T10, T37F                                                             |
| T42A2  | Add device revocation                                                           | phase-7   | android          | P7-W2  | T42A1                                                                 |
| T42A3  | Build the Android diagnostics screen                                            | phase-7   | android          | P7-W7  | T41B3 (T42A2 edge dropped, T203)                                      |
| T42B1  | Execute the client data migration or reset                                      | phase-7   | android          | P7-W7  | T22 (T42A3 edge dropped, T203)                                        |
| T42B2  | Test versioned-JSON import                                                      | phase-7   | android          | P7-W8  | T42B1                                                                 |
| T203   | Correct three P7 dependency edges that are scheduling artifacts                 | phase-7   | docs             | P8-W6  | —                                                                     |
| T204   | Make the local Expo config plugin resolvable on CI, not only on the workstation | phase-8   | android          | P8-W7  | T201                                                                  |
| T205   | Type-check metro.config.js and babel.config.js, or say in writing why not       | phase-8   | android          | P8-W9  | T204                                                                  |
| T206   | Enforce the "no legacy schema reader" prohibition with a check, not a grep      | phase-8   | ci               | P8-W9  | T42B2                                                                 |
| T207   | Make the Android flows launchable on the packaged package id, and guard it      | phase-8   | android/tooling  | P8-W11 | T43B2b                                                                |
| T208   | Owner-gated: configure EXPO_TOKEN and confirm the emulator action boots here    | phase-8   | ci               | P9-U   | T207                                                                  |
| T209   | A guard-guard: every run-guard-\*.mjs is wired into a workflow, or allowlisted  | phase-8   | ci               | P8-W12 | T207                                                                  |
| T210   | Fix legacy-retirement.md ordering: the undo must precede the cutover            | phase-8   | docs             | P8-W12 | —                                                                     |
| T211   | guard-run-guard-wiring cannot report a stale allowlist entry                    | phase-8   | ci               | P8-W13 | T209                                                                  |
| T212   | Drop the churning file and test counts from legacy-retirement.md 2.3            | phase-8   | docs             | P8-W13 | —                                                                     |
| T213   | guard-no-legacy-app-tree's ALLOWLISTED_PATHS has the shape T211 closed          | phase-8   | ci               | P8-W14 | —                                                                     |
| T214   | guard-run-guard-wiring's CI job copy names one of its three failure modes       | phase-8   | ci               | P8-W14 | T211                                                                  |
| T215   | Decide whether a stale-allowlist check is a guard-capability-prose capability   | phase-8   | ci               | P8-W15 | T211, T213                                                            |
| T216   | guard-capability-prose test T147 passes for a reason its title denies           | phase-8   | ci               | P8-W16 | —                                                                     |
| T217   | Investigate a guard for count claims in committed prose                         | phase-8   | ci               | P8-W17 | —                                                                     |
| T218   | Date-qualify the drifting shipped-file counts in scripts/ci                     | phase-8   | ci               | P8-W18 | —                                                                     |
| T219   | Decide what to do with issues-from-plan's hand-incremented tallies              | phase-8   | docs             | P8-W18 | —                                                                     |
| T221   | guard-capability-prose states two contradictory member rationales               | phase-8   | ci               | P8-W19 | —                                                                     |
| T222   | CLOSED (T184)'s disambiguation half is live and false                           | phase-8   | ci               | P8-W21 | T223                                                                  |
| T223   | The findBuildOrderViolations RegExp member is refactor-fragile                  | phase-8   | ci               | P8-W20 | —                                                                     |
| T224   | A live "roughly 8 capabilities today" claim against a real 12                   | phase-8   | ci               | P8-W22 | —                                                                     |
| T225   | Nothing links the 60 ms coalescer pin to the 20 msg/s bridge budget             | phase-9   | daemon           | P9-W7  | —                                                                     |
| T226   | Web caps the extension log at 500 lines where Android bounds it to 200          | phase-9   | web              | P9-W8  | —                                                                     |
| T227   | scripts/ci imports vite, which no root package.json declares                    | phase-9   | ci               | P9-W9  | —                                                                     |
| T228   | Register P9-W2's and P9-W3's four new guard capabilities in CAPABILITIES        | phase-9   | ci               | P9-W10 | —                                                                     |
| T229   | SHA-pin the 56 tag-pinned GitHub Actions refs, looked up not guessed            | phase-9   | ci               | P9-W11 | —                                                                     |
| T230   | Make the relay wire version structurally impossible to diverge                  | phase-9   | daemon           | P9-W12 | T44A3                                                                 |
| T231   | Triage the 36 baselined npm advisories (needs npm install)                      | phase-9   | tooling          | P9-W13 | T44A3                                                                 |
| T232   | Register the workspace-test-coverage stale-allowlist walk in CAPABILITIES       | phase-9   | tooling          | P9-W14 | T44A4                                                                 |
| T233   | Wire or allowlist cli's test:local and server's test:integration                | phase-9   | ci               | P9-W15 | T44A4                                                                 |
| T234   | Decide whether protocol's and web's Linux-only CI coverage is intended          | phase-9   | ci               | P9-W16 | T44A4                                                                 |
| T235   | Give apps/android a per-release versionCode so a second APK installs            | phase-9   | android          | P9-W17 | T44B1                                                                 |
| T236   | Settle whether the EAS remote archive carries the locally-built dist/           | phase-9   | ci               | P9-U   | T44B1                                                                 |
| T237   | Close or document guard-signing-material's content-read skip list               | phase-9   | tooling          | P9-W19 | T44B1                                                                 |
| T238   | Decide whether the published CLI binary keeps the name paseo                    | phase-9   | docs             | P9-W20 | T44B2                                                                 |
| T239   | Replace the coalescer comment's four file:line citations with symbols           | phase-9   | daemon           | P9-W21 | T225                                                                  |
| T240   | Make server test:unit reproducibly green under file parallelism                 | phase-9   | daemon           | P9-W22 | T225                                                                  |
| T241   | Correct the log bridge fixture's virtualized-log description                    | phase-9   | protocol         | P9-W23 | T226                                                                  |
| T242   | Rule on superseded mechanism names in reference-only docs                       | phase-9   | docs             | P9-W24 | T226                                                                  |
| T243   | Close the archive/snapshot interleaving that drops archivedAt                   | phase-9   | daemon           | P9-W25 | none                                                                  |
| T244   | Replace the four hand-rolled comment strippers with one tokenizer               | phase-9   | tooling          | P9-W26 | T227                                                                  |
| T246   | Decide whether isShippedSourcePath should see app-root config files             | phase-9   | tooling          | P9-W27 | T228                                                                  |
| T247   | Fail an Android release whose tag disagrees with app.config.ts version          | phase-9   | ci               | P9-W28 | T235                                                                  |
| T248   | Apply T237's measurement to guard-secret-scan's binary skip list                | phase-9   | tooling          | P9-W29 | T237                                                                  |
| T249   | Register readContentIfWorthwhile in CAPABILITIES                                | phase-9   | tooling          | P9-W30 | T237, T232                                                            |
| T250   | Make test:integration wire-able or retire its dead auth helpers                 | phase-9   | server           | P9-W31 | T233                                                                  |
| T251   | Extend guard-declared-workspace-deps to packages/relay                          | phase-9   | tooling          | P9-W32 | T230, T227                                                            |
| T252   | Migrate the last two scripts/ci comment strippers to the shared tokenizer       | phase-9   | tooling          | P9-W33 | T244                                                                  |
| T253   | Re-derive shipped source's citations of reference-only documents                | phase-9   | docs             | P9-W34 | T242                                                                  |
| T254   | Decide whether isAppSourcePath should admit apps/\*/app.config.ts               | phase-9   | tooling          | P9-W35 | T246, T247                                                            |
| T255   | Pin the Android release-tag guard's shapes to the workflow's own trigger        | phase-9   | tooling          | P9-W36 | T247                                                                  |
| T256   | Re-scope source-comment-stripper's four-guards safety claim to its callers      | phase-9   | tooling          | P9-W37 | T252                                                                  |
| T257   | Make guard-dockerignore-depth mean the same thing locally and in CI             | phase-9   | tooling          | P9-W38 | none                                                                  |
| T258   | Decide test:integration's three e2e files under a Pi-only registry              | phase-9   | server           | P9-W39 | T250                                                                  |
| T259   | Widen T251's capability entry to the apps-only framing it misses                | phase-9   | tooling          | P9-W40 | T251                                                                  |
| T260   | Repoint the two scripts/ci legacy-schema citations at plan.md 5.3               | phase-9   | tooling          | P9-W41 | T253                                                                  |
| T261   | Record T253's provenance/authority classification durably                       | phase-9   | docs             | P9-W42 | T253                                                                  |
| T262   | LEGACY_PROVIDER_IDS excludes pi, so the shipped Android app sees no agents      | phase-9   | server           | P9-W43 | none                                                                  |
| T263   | Teach canPrecedeRegex about the JSX closing-tag case, or scope it               | phase-9   | tooling          | P9-W44 | T256                                                                  |
| T264   | Guard or document the unguarded extraClients overlay                            | phase-9   | server           | P9-W45 | T262                                                                  |
| T265   | Anchor T259's two over-wide phrases to their own guard                          | phase-9   | tooling          | P9-W46 | T259                                                                  |
| T266   | Decide whether the vestigial isProviderVisibleToClient callback should go       | phase-9   | server           | P9-W47 | T262                                                                  |
| T267   | Reclassify rpc-types.ts's get_commands citation and close T253's ledger         | phase-9   | docs             | P9-W48 | T261                                                                  |
| T268   | Restore pronoun coverage to T265's anchored phrases                             | phase-9   | tooling          | P9-W49 | T265                                                                  |
| T269   | Stop citing shipped source by line number, and guard it                         | phase-9   | tooling          | P9-W50 | none                                                                  |
| T272   | Close the prose-form line-number population T269 never measured                 | phase-9   | docs             | P9-W51 | T269                                                                  |
| T273   | Repoint real-session-protection.test.ts's rotted agent.ts citation              | phase-9   | core             | P9-W52 | T269                                                                  |
| T274   | Retire the bundle-budget guard's overtaken missing-rationale claim              | phase-9   | tooling          | P9-W53 | T269                                                                  |
| T275   | Date or recount the four-marker citation that has rotted                        | phase-9   | tooling          | P9-W54 | T272                                                                  |
| T276   | Ship a real VoiceCapturePort and make the mic button waveform-only              | phase-9   | android          | P9-W55 | none                                                                  |
| T277   | Transcribe through Groq, clean it, and put the text in the prompt bar           | phase-9   | server           | P9-W56 | T276                                                                  |
| T278   | Image thumbnails and capture in the mobile prompt bar                           | phase-9   | android          | P9-W57 | none                                                                  |
| T279   | Drag-and-drop, paste, and inline previews in the web composer                   | phase-9   | web              | P9-W58 | none                                                                  |
| T280   | Make create-agent's post-return dispatch awaitable by its own tests             | phase-9   | server           | P9-W59 | none                                                                  |
| T281   | Register wave P9-O's four capabilities in guard-capability-prose                | phase-9   | tooling          | P9-W60 | none                                                                  |
| T282   | Wire transcribeClient, attachmentSource and cameraCapture at the mount          | phase-9   | android          | P9-W61 | T276, T277, T278                                                      |
| T283   | Serve attachment bytes to a remote client, capability-scoped                    | phase-9   | server           | P9-W62 | none                                                                  |
| T284   | Wire both transcript renderers to the attachment-serving capability             | phase-9   | web              | P9-W63 | T283                                                                  |
| T285   | Cover the fifth PermissionKind in permission-recovery's own battery             | phase-9   | android          | P9-W64 | T278                                                                  |
| T286   | Reconcile cleanTranscript's leading-filler doc with its regex                   | phase-9   | server           | P9-W65 | T277                                                                  |
| T287   | Correct resolveGroqSttCredentials's model-always-Groq-valid claim               | phase-9   | server           | P9-W66 | T277                                                                  |
| T288   | Pin T283's $PASEO_HOME criterion and drop the layer-symmetry claim              | phase-9   | server           | P9-W67 | T283                                                                  |
| T289   | Register resolveTranscribeClient in guard-capability-prose                      | phase-9   | tooling          | P9-W68 | T282                                                                  |
| T290   | Ship real AttachmentSourcePort and CameraCapturePort at the mount               | phase-9   | android          | P9-W69 | T278, T282                                                            |
| T291   | Re-pin expo-audio to the version this app's own expo bundles                    | phase-9   | android          | P9-U   | T276                                                                  |
| T292   | Slash-command completion in the Android composer                                | phase-9   | android          | P9-W71 | none                                                                  |
| T293   | Serve the composer's current text to an extension (getEditorText)               | phase-9   | server           | P9-W72 | none                                                                  |
| T294   | Decide the two legacy storage permissions expo-image-picker merges in           | phase-9   | android          | P9-W73 | T290                                                                  |
| T295   | Settle whether the capability-prose denial scan reaches package source          | phase-9   | tooling          | P9-W74 | none                                                                  |
| T296   | wrapSessionProvider drops six optional AgentSession methods                     | phase-9   | server           | P9-W75 | T293                                                                  |
| T297   | Land T280's deterministic ENOTEMPTY reproduction as a real test                 | phase-9   | server           | P9-W76 | T280                                                                  |
| T298   | Pin app.config.ts's permission decision as a registered capability              | phase-9   | tooling          | P9-W77 | T294                                                                  |
| T299   | Revoking a trusted device does not stop its push notifications                  | phase-9   | daemon           | P9-W78 | T42A2                                                                 |
| T300   | No revoked-clientId denylist: a revoked device can silently re-register         | phase-9   | daemon           | P9-W79 | T42A2                                                                 |
| T301   | Give the devices and diagnostics routes a navigable entry point                 | phase-9   | android          | P9-W80 | T42A1, T42A2                                                          |
| T302   | Move websocket-server.browser-tools.test.ts into test:unit:serial               | phase-9   | server           | P9-W81 | T240                                                                  |
| T303   | Fix the format-check guard's bracketed-path parent-existence false positive     | phase-9   | tooling          | P9-W82 | none                                                                  |
| T304   | Retire the duplicate exhaustiveness check that only the ceiling guard sees      | phase-9   | server           | P9-W83 | T296                                                                  |
| T305   | Give `.pc-message__text` the same `white-space: pre-wrap` the thinking body has | phase-9   | web              | P9-U   | T28A3                                                                 |
| T306   | Re-pin `expo-secure-store` to the version this app's own `expo` bundles         | phase-9   | android          | P9-U   | T291                                                                  |
| T307   | Explain, or remove, the hoisted root `expo@57` no workspace asks for            | phase-9   | android          | P9-U   | T291, T306                                                            |
| T308   | Show the local wall-clock time on every transcript message                      | phase-9   | core             | P9-U   | T28A1, T28A2, T33A2                                                   |
| T309   | The observation test's self-heal tick is both required and harmful              | phase-9   | server           | P9-U   | T240                                                                  |
| T310   | Both EAS workflows invoked `npx eas`, a package that cannot run                 | phase-9   | tooling          | P9-U   | T208, T17B, T37F                                                      |
| T50    | Decide how the agent's configured surface is exposed                            | phase-7   | docs             | P7-W2  | T10                                                                   |
| T51A   | Audit the Pi RPC mirror and decide what to carry                                | phase-7   | daemon           | P6-W11 | T10, T38A0, T38B0c                                                    |
| T51B   | Add a drift-detection test for the Pi RPC mirror                                | phase-7   | daemon           | P7-W3  | T51A                                                                  |
| T43A1  | Cut daemon packaging over to the new web app                                    | phase-8   | tooling          | P8-W1  | T11, T18, T31D, T37F                                                  |
| T43A2  | Verify the bundled UI serves correctly                                          | phase-8   | tooling          | P8-W2  | T43A1                                                                 |
| T43A3  | Add Docker and Nix packaging paths                                              | phase-8   | tooling          | P8-W3  | T43A2                                                                 |
| T43B1  | Re-verify provenance and notices                                                | phase-8   | docs             | P6-W25 | T05, T43A3                                                            |
| T43B2a | Retire the legacy install and pass static gates                                 | phase-8   | tooling          | P8-W5  | T43B1                                                                 |
| T43B2b | Pass browser and device suites as packaging gate                                | phase-8   | tooling          | P8-W10 | T43B2a                                                                |
| T59    | Deploy the daemon to a public VPS behind TLS                                    | phase-8   | tooling          | P8-W7  | T43A3, T43B2b                                                         |
| T44A1  | Run the performance checks                                                      | phase-9   | ci               | P9-W1  | T40B2, T41A4, T41B3, T42B2, T43B2b                                    |
| T44A2  | Run the accessibility gates                                                     | phase-9   | ci               | P9-W2  | T44A1                                                                 |
| T44A3  | Run security and version-drift checks                                           | phase-9   | ci               | P9-W3  | T44A2                                                                 |
| T44A4  | Run the full CI matrix                                                          | phase-9   | ci               | P9-W4  | T44A3                                                                 |
| T44B1  | Produce the signed APK                                                          | phase-9   | ci               | P9-W5  | T44A4                                                                 |
| T44B2  | Verify clean installs and document rollback                                     | phase-9   | docs             | P9-W6  | T44B1                                                                 |
| T45A1  | Add a frame-clock platform interface to frontend-core                           | phase-4   | core             | P4-W4  | T14                                                                   |
| T45A2  | Batch streaming timeline updates onto the frame clock                           | phase-4   | core             | P4-W5  | T45A1, T28A1                                                          |
| T45A3  | Wire the web frame clock and assert the paint budget                            | phase-4   | web              | P4-W6  | T45A2, T28A2                                                          |
| T46A1  | Fence asynchronous responses with a run generation                              | phase-4   | core             | P4-W4  | T20B                                                                  |
| T46A2  | Add a resume-reconciliation controller to core                                  | phase-4   | core             | P4-W5  | T46A1, T19A                                                           |
| T46A3  | Trigger resume reconciliation from web lifecycle events                         | phase-4   | web              | P4-W6  | T46A2                                                                 |
| T48A1  | Derive turn and session cost in core                                            | phase-4   | core             | P4-W4  | T29C1                                                                 |
| T48A2  | Show session cost alongside the context meter                                   | phase-4   | web              | P4-W11 | T48A1, T29C2                                                          |
| T49    | Extend the Windows CI gate to core and web unit suites                          | phase-4   | ci               | P4-W14 | T17A, T31D                                                            |
| T52A1  | Stop dropping inbound image and attachment content                              | phase-4   | daemon           | P4-W9  | T10                                                                   |
| T52A2  | Carry attachments through the transcript view model                             | phase-4   | core             | P4-W10 | T52A1                                                                 |
| T52A3  | Render message images and attachments in the transcript                         | phase-4   | web              | P4-W11 | T52A2                                                                 |
| T53A1  | Construct a live DaemonClient and provide it to routes                          | phase-4   | web              | P4-W9  | T19A, T27A3                                                           |
| T53A2  | Mount the transcript into the session screen                                    | phase-4   | web              | P4-W12 | T53A1, T52A3                                                          |
| T53A3  | Mount the session and extension rails into the shell                            | phase-4   | web              | P4-W10 | T53A1, T29R2                                                          |
| T53A4  | Give the sessions list screen the live client                                   | phase-4   | web              | P4-W10 | T53A1                                                                 |
| T53A5  | Give the files, terminal and settings screens the client                        | phase-4   | web              | P4-W10 | T53A1                                                                 |
| T54A1  | Bring the palette to WCAG AA contrast                                           | phase-4   | design           | P4-W12 | T13C                                                                  |
| T54A2  | Give the app shell a level-one heading                                          | phase-4   | web              | P4-W12 | T27S1                                                                 |
| T54A3  | Feed browser offline events into connection status                              | phase-4   | web              | P4-W12 | T53A1                                                                 |
| T57    | Anchor the transcript on the prompt after sending (opt)                         | phase-4   | web              | P4-W14 | T53A2                                                                 |
| T58    | Lazy-load the two chunks over the bundle budget                                 | phase-4   | web              | P4-W15 | T31D                                                                  |
| T58B   | Keep the generated validator out of browser bundles                             | phase-4   | core             | P4-W16 | T58                                                                   |
| T58C   | Make the browser validator fix apply to Android too                             | phase-5   | android          | P5-W2  | T58B                                                                  |

**462 tasks** (distinct IDs counted directly from the table above), recounted at the P9-C
merge gate — the commit that filed `T250` and `T251`, two rows past the **460** recounted at the
P9-B merge gate — the commit that filed `T248` and `T249`, two rows past the **458** recounted at
the P9-A merge gate, which filed `T246` and `T247`, two past the **456** filed at
the P9-W9 gate with `T244`, three past the **455** counted just after the
P9-W8 gate, two past the **454** filed at that
gate with `T241` and `T242`, three past the **452** counted at
the P9-W7 gate, four past the **450** counted at
the P9-W6 gate, three past the **449** counted at the P9-W5
gate, four past the **446**
counted at the P9-W4 gate, six past the **443**
counted at the P9-W3 gate, six past the **440**
counted at the P9-W2 gate, four past the **439** counted at the P9-W1
gate, seven rows past the **436**
counted at the P8-W21 gate, five past the **435** counted at the P8-W19
gate, six past the **433** counted at the
P8-W18 gate and seven past the **432** T219 verified at
`9bc08d0413975f77f82c0fa92282854381b0f19f`, and up from the **221** this line
previously claimed. That is not new phases (both counts run P0 through P9): it is 239 tasks filed as follow-up work
within phases already open when "221" was written: P4 81 → 84 (+3), P5 51 → 127 (+76), P6
20 → 103 (+83), P7 14 → 19 (+5), P8 5 → 53 (+48), P9 6 → 30 (+24). See the tallies
note above this table for why that is expected and how to keep this figure honest rather than
silently overwriting it again. Phase distribution at this count: P0 17, P1 9, P2 10, P3 4, P3.5
4, P4 84, P5 127, P6 103, P7 19, P8 53, P9 30. The previous line's merged/remaining split is
dropped here rather than recomputed: this table carries no status column, so "merged" cannot be
verified by reading the table alone, only by cross-referencing which tasks have actually landed
elsewhere — a mixing of concerns this line should not reintroduce.

#lesson **jsdom accessibility tests are not accessibility tests.** The first axe run in a REAL
browser (E2E, batch F) found WCAG-AA colour-contrast failures in the Beautiful UI palette itself —
down to 2.61:1 — after hundreds of green jsdom axe assertions. Plan §14.1 always said real-browser
tooling; until T31B6 we only had jsdom. T54A1 fixes the palette by explicit user decision.

#lesson **E2E tasks must own ONE spec file each.** The original T31B bundled connect, session and
transcript scenarios; it burned 910k tokens without finishing because the full Playwright suite
takes ~15 minutes, so every debugging cycle cost that much. It was stopped and split into T31B1-B6
and T31C1-C4, one spec file each, and every E2E prompt now says to run only your own spec while
iterating. Its real work was salvaged, not discarded.

#lesson **Phase 4 built the parts but never assembled them.** After 60 merged web tasks, every
feature passed its own criteria while the app as a whole did not work: no `DaemonClient` was ever
constructed, the transcript was rendered by no screen, and `root-route.tsx` passed neither rail
slot. "Each family owns a directory" prevented conflicts but left **integration owned by nobody**,
and per-directory acceptance criteria could all be met by an unassembled app. T53A1-T53A3 close it,
and they must land before the E2E tasks (T31A-D), which cannot pass otherwise. Future phases need
an explicit assembly task per surface, not just feature tasks.

Batch C merged 17 of its 19: **T28A6 (transcript virtualization) and T28A7 (compaction and retry
markers) were never implemented** — the T28A6 agent died without reporting, which short-circuited
T28A7. Its branch existed and was an ancestor of another branch, so the merge reported the work as
contained in main; it was not. The transcript still renders every entry unbounded, against §14.5.
Both are pending and carry no completed work. #lesson **branch ancestry is not evidence that work
was delivered** — check the code.

Tasks T45–T50 were added after the `D:\ompweb` architecture review (2026-09-01); see
"Findings folded in from the ompweb review" near the end of this file for what was
accepted, what was reshaped, and what was deliberately not built.

---

## Parallel execution waves

Tasks in a wave have disjoint file sets and all dependencies satisfied by earlier waves.
Phase 0-4 rows record waves as they were run, up to 10 wide; a wider wave simply queues.
Phase 5-7 rows are capped at 4 and were generated from the task bodies, so the two tables and
the task details always agree.

| Wave   | Tasks                                                                    | Width |
| ------ | ------------------------------------------------------------------------ | ----- |
| P0-W1  | T01                                                                      | 1     |
| P0-W2  | T02, T10                                                                 | 2     |
| P0-W3  | T03, T04                                                                 | 2     |
| P0-W4  | T05, T06A, T06B, T09A                                                    | 4     |
| P0-W5  | T06C, T07A, T09B                                                         | 3     |
| P0-W6  | T07B                                                                     | 1     |
| P0-W7  | T07C, T08A                                                               | 2     |
| P0-W8  | T08B                                                                     | 1     |
| P0-W9  | T11                                                                      | 1     |
| P1-W1  | T12A                                                                     | 1     |
| P1-W2  | T12B, T13, T14, T17A, T18                                                | 5     |
| P1-W3  | T15, T16                                                                 | 2     |
| P1-W4  | T17B                                                                     | 1     |
| P2-W1  | T19A, T20A, T21A, T21B, T22, T23                                         | 6     |
| P2-W2  | T19B, T20B, T21C                                                         | 3     |
| P2-W3  | T24                                                                      | 1     |
| P3-W1  | T25A, T26A                                                               | 2     |
| P3-W2  | T25B, T26B                                                               | 2     |
| P35-W1 | T13B                                                                     | 1     |
| P35-W2 | T25C, T26C                                                               | 2     |
| P35-W3 | T13C                                                                     | 1     |
| P4-W1  | T27S1, T27S2                                                             | 2     |
| P4-W2  | T27A1, T28A1, T29A1, T29C1, T30A1                                        | 5     |
| P4-W3  | T27A2, T27B1, T28A2, T28B1, T29A2, T29R1, T30A2, T30B1                   | 8     |
| P4-W4  | T27A3, T27B2, T28A3, T28B2, T29A3, T30A3, T30B2, T45A1, T46A1, T48A1     | 10    |
| P4-W5  | T27A4, T27B3, T28A4, T28B3, T29B1, T30B3, T45A2, T46A2                   | 8     |
| P4-W6  | T27A5, T27B4, T28A5, T28B4, T29B2, T30B4, T45A3, T46A3                   | 8     |
| P4-W7  | T27A6, T27B5, T28A6, T28B5, T29B3, T30B5                                 | 6     |
| P4-W8  | T27B6, T28A7, T28B6, T29B4, T30B6                                        | 5     |
| P4-W9  | T28B7, T29B5, T29R2, T52A1, T53A1                                        | 5     |
| P4-W10 | T29C2, T31A, T52A2, T53A3, T53A4, T53A5                                  | 6     |
| P4-W11 | T31B1, T31B2, T31B3, T31B4, T31B5, T31B6, T48A2, T52A3                   | 8     |
| P4-W12 | T31C1, T31C2, T31C3, T31C4, T53A2, T54A1, T54A2, T54A3                   | 8     |
| P4-W13 | T31D                                                                     | 1     |
| P4-W14 | T49, T57                                                                 | 2     |
| P4-W15 | T58                                                                      | 1     |
| P4-W16 | T58B                                                                     | 1     |
| P5-W1  | T32S1, T34A1                                                             | 2     |
| P5-W2  | T32S1B, T34A2, T58C                                                      | 3     |
| P5-W3  | T32S1C, T34A3                                                            | 2     |
| P5-W4  | T32A1, T32B1, T33A1, T33B1                                               | 4     |
| P5-W5  | T32A2, T32B2, T33A2B, T33B2                                              | 4     |
| P5-W6  | T32A1B, T32B3, T32S2, T33A2, T33B3                                       | 5     |
| P5-W7  | T32A3, T32B4, T32S3, T33A3, T34A4                                        | 5     |
| P5-W8  | T32B5, T33B4, T34A5, T34B1, T35A1                                        | 5     |
| P5-W9  | T32A4, T32P1, T32S4, T32S5, T33A4, T37A                                  | 6     |
| P5-W10 | T32S6, T33B5, T34B2, T35A2, T35B1, T37B                                  | 6     |
| P5-W11 | T32S7, T32A5, T32B6, T34A6, T34B3, T60A, T60B                            | 7     |
| P5-W12 | T32S8, T33A5, T33B6, T35A3, T35B2                                        | 5     |
| P5-W13 | T32S9, T32A6, T33A6, T33B7, T34B4, T37C                                  | 6     |
| P5-W14 | T32S10, T35A4, T35B3, T36A, T36C                                         | 5     |
| P5-W15 | T32C1, T32P2, T36B, T36D, T37D, T60D                                     | 6     |
| P5-W16 | T32S11, T36E, T37E1, T37E2, T57B, T60C, T61                              | 7     |
| P5-W17 | T32P3, T37E3, T37E4, T37E5, T60E, T60F, T62                              | 7     |
| P5-W18 | T32A7, T32A8, T32S12, T36F, T60G, T61B, T63                              | 7     |
| P5-W19 | T32S13, T64, T65, T66, T67                                               | 5     |
| P5-W20 | T37E6, T37E7, T37E8, T37E9, T37E10, T68, T32S14                          | 7     |
| P5-W21 | T37F, T69, T70, T71, T72, T74, T81                                       | 7     |
| P5-W22 | T32S15, T73, T75, T77, T78, T79, T82                                     | 7     |
| P5-W23 | T76, T80, T83, T84, T85, T86, T89                                        | 7     |
| P5-W24 | T87, T88                                                                 | 2     |
| P6-W1  | T38A0, T40A1, T38A1a, T38B0a, T90, T92, T93                              | 7     |
| P6-W2  | T38A2, T40A2, T38B0b, T47A1a, T96, T97, T98                              | 7     |
| P6-W3  | T38A3, T40A3, T38A1b, T38B0c, T91, T103, T95                             | 7     |
| P6-W4  | T38A4, T40A4, T47A2, T47A1b, T101, T105, T107                            | 7     |
| P6-W5  | T38A5, T40B1, T104, T94, T102, T106, T109                                | 7     |
| P6-W6  | T39A, T40B2, T38B1a, T110, T112, T115, T116                              | 7     |
| P6-W7  | T39B, T38B1b, T111, T113, T114, T117, T118                               | 7     |
| P6-W8  | T38B2, T39C, T119, T121, T122, T123, T127                                | 7     |
| P6-W9  | T38B3, T120, T124, T125, T126, T128, T129                                | 7     |
| P6-W10 | T130, T131, T132, T133, T134                                             | 5     |
| P6-W11 | T135, T136, T137, T51A, T41A1a, T41B1                                    | 6     |
| P6-W12 | T138, T139, T140, T142, T143, T144                                       | 6     |
| P6-W13 | T146, T147, T99, T100                                                    | 4     |
| P6-W14 | T148, T50, T51B, T41A1b, T41B2                                           | 5     |
| P6-W15 | T150, T151, T152, T153, T41A2, T41B3                                     | 6     |
| P6-W16 | T156, T157, T159, T154, T41A3                                            | 5     |
| P6-W17 | T162, T163, T164, T41A4                                                  | 4     |
| P6-W18 | T165, T166, T168, T43A1                                                  | 4     |
| P6-W19 | T169, T171, T43A2                                                        | 3     |
| P6-W20 | T172, T173, T43A3                                                        | 3     |
| P6-W21 | T174, T176, T177                                                         | 3     |
| P6-W22 | T175, T178, T179                                                         | 3     |
| P6-W23 | T180, T181, T182, T183                                                   | 4     |
| P6-W24 | T184, T185, T186 (+ T188, T189, T190, T191 filed and closed at the gate) | 3     |
| P6-W25 | T187, T43B1 (moved from P8-W4: independent files, one wave)              | 2     |
| P8-W4  | (retired: T43B1 moved to P6-W25)                                         | 0     |
| P7-W1  | T42A1 (blocked: expo-notifications, expo-device)                         | 1     |
| P7-W2  | T42A2 (blocked behind T42A1)                                             | 1     |
| P7-W3  | (retired: T42A3 moved to P7-W4 to match its task row)                    | 0     |
| P7-W4  | (retired: T42A3 moved to P7-W7, T203)                                    | 0     |
| P7-W5  | (retired: T42B1 moved to P7-W7, T203)                                    | 0     |
| P7-W6  | (retired: T42B2 moved to P7-W8, T203)                                    | 0     |
| P7-W7  | T42A3, T42B1 (unblocked by T203; disjoint directories)                   | 2     |
| P7-W8  | (retired: T42B2 ran in P8-W7 alongside T204; disjoint directories)       | 0     |
| P8-W5  | T43B2a, T193 (T192 closed at the P6-W25 gate by the orchestrator)        | 2     |
| P8-W6  | T194, T195, T196, T198, T199, T200, T201, T197, T202 (gate)              | 9     |
| P8-W7  | T204, T42B2 (both landed; gate corrected four prose sites)               | 2     |
| P8-W9  | T205, T206 (both filed by the P8-W7 gate; disjoint)                      | 2     |
| P8-W10 | T43B2b (orphaned from this table until now; its row said P8-W6, a wave   | 1     |
|        | that ran without it. Nothing else is runnable to pair it with: T59 and   |       |
|        | T42A1/T42A2 are owner-blocked, and every P9 task is behind it.) Landed;  |       |
|        | the gate found the Android half cannot pass and filed T207.              |       |
| P8-W11 | T207 (filed by the P8-W10 gate: `packaged-app-smoke` cannot pass as      | 1     |
|        | written, and nothing detects that). Landed; the gate wired the new       |       |
|        | guard into CI, which T207 shipped unwired, and filed T209.               |       |
| P8-W12 | T209, T210 (both filed by the P8-W11 gate; disjoint: ci vs docs). Both   | 2     |
|        | KEEP; the gate found nothing to fix and filed T211, T212.                |       |
| P8-W13 | T211, T212 (both filed by the P8-W12 gate; disjoint: ci vs docs). Both   | 2     |
|        | KEEP; the gate fixed one contradictory sentence and filed T213, T214.    |       |
| P8-W14 | T213, T214 (both filed by the P8-W13 gate; disjoint: guard vs ci.yml).   | 2     |
|        | Both KEEP; the gate fixed one carried-over header premise, filed T215.   |       |
| P8-W15 | T215 (filed by the P8-W14 gate; a policy decision, so it runs alone).    | 1     |
|        | KEEP; the gate fixed two stale CLAUDE.md bullets and filed T216.         |       |
| P8-W16 | T216 (filed by the P8-W15 gate). KEEP; the gate removed a self-          | 1     |
|        | falsifying test title and an already-wrong tally, and filed T217.        |       |
| P8-W17 | T217 (filed by the P8-W16 gate; investigate-first, may conclude no).     | 1     |
|        | KEEP, not built; the gate fixed the scope its rationale misstated.       |       |
| P8-W18 | T218, T219 (both filed by the P8-W17 gate; disjoint: ci vs docs).        | 2     |
|        | Both KEEP; the gate widened T219's policy from a list to a shape.        |       |
| P8-W19 | T221 (filed by the P8-W18 gate; pre-existing, not this wave's).          | 1     |
|        | KEEP; the answer was that NEITHER cited rationale is live.               |       |
| P8-W20 | T223 (filed by the P8-W19 gate; a real check-cannot-fail shape).         | 1     |
|        | KEEP; the gate restored the RegExp branch's lost mutation coverage.      |       |
| P8-W21 | T222 (filed by the P8-W19 gate; runs after T223 owns the member).        | 1     |
|        | KEEP; the gate cut a precedent it cited that does not exist.             |       |
| P8-W22 | T224 (filed by the P8-W21 gate; pre-existing, not this wave's).          | 1     |
|        | KEEP; the gate cut a re-trigger firing that could not have happened.     |       |
| P8-W8  | T59 (owner-deferred: VPS)                                                | 1     |
| P9-W1  | T44A1                                                                    | 1     |
|        | KEEP-WITH-FIX; the gate cut two false attributions from its own          |       |
|        | classification of plan.md 14.5, and filed T225-T227.                     |       |
| P9-W2  | T44A2                                                                    | 1     |
|        | KEEP-WITH-FIX; the gate moved a typecheck step that could not have       |       |
|        | passed a clean CI checkout, and filed T228.                              |       |
| P9-W3  | T44A3                                                                    | 1     |
|        | KEEP-WITH-FIX; all three checks fire, but the register under-reported    |       |
|        | the wave's own new tag-pinned Actions as zero. Filed T229-T231.          |       |
| P9-W4  | T44A4 — landed at the P9-W4 gate (KEEP-WITH-FIX):                        | 1     |
|        | the job classification and the coverage guard are sound, but             |       |
|        | relay-tests claimed no build was needed while one test reads             |       |
|        | a gitignored dist/, and two prose claims were false. Filed               |       |
|        | T232-T234.                                                               |       |
| P9-W5  | T44B1 — landed at the P9-W5 gate (KEEP-WITH-FIX): the                    | 1     |
|        | enforcement is real and fires both ways, but the wave's own new          |       |
|        | guard and the previously-green secret scan both went red on the          |       |
|        | commit that added them. Filed T235-T237.                                 |       |
| P9-W6  | T44B2 — landed at the P9-W6 gate (KEEP-WITH-FIX): the                    | 1     |
|        | source-inspection method is sound and the rollback section is            |       |
|        | usable, but the runbook's FIRST command told a non-expert to             |       |
|        | expect `added 1 package` from an install that resolves a few             |       |
|        | hundred, and two citations named the wrong source. Filed T238.           |       |
| P9-W7  | T225 — landed at the P9-W7 gate (KEEP-WITH-FIX): the comment             | 1     |
|        | is more accurate than the spec it implements — it states what the        |       |
|        | window does NOT bound — but one citation was off by one and one          |       |
|        | scope claim was false as written. Filed T239-T240.                       |       |
| P9-W8  | T226 — landed at the P9-W8 gate (KEEP-WITH-FIX): a real                  | 1     |
|        | decision, argued and recorded in the budget's own bullet, with           |       |
|        | both platforms' pins watched to fire — but the guard's own item          |       |
|        | title still quoted the sentence the same commit deleted, and             |       |
|        | three further citations had gone stale. Filed T241-T242.                 |       |
| P9-W9  | T227 — landed at the P9-W9 gate (KEEP-WITH-FIX): manifest and            | 1     |
|        | lockfile moved together so npm ci stays safe, and the new guard          |       |
|        | fires on its own motivating case with no allowlist — but the             |       |
|        | assertion protecting that case could not fail. Filed T244 and            |       |
|        | widened T228 to a fifth capability. The wave's own guard header          |       |
|        | also quoted a legacy specifier and turned guard-no-legacy-app-tree       |       |
|        | red on main; fixed in the gate commit's follow-up.                       |       |
| P9-W10 | T228 — landed at the P9-W10 gate (KEEP-WITH-FIX): all five entries       | 1     |
|        | fire and none collides with its own guard's header, but both             |       |
|        | tests titled "are shipped" resolved shippedness by filtering             |       |
|        | CAPABILITIES by name, reading no file. One shared predicate              |       |
|        | now serves the guard and both tests. No new tasks filed.                 |       |
| P9-W11 | T229 — landed in wave P9-A (KEEP): 63 tag-pinned refs, not the           | 1     |
|        | ledger's stale 56. All 88 uses: lines now SHA-pinned with a              |       |
|        | version comment; the one annotated tag was peeled to its                 |       |
|        | commit, re-resolved twice at the gate.                                   |       |
| P9-W12 | T230 (filed by the P9-W3 gate; needs the Workers packaging answer).      | 1     |
| P9-W13 | T231 (owner-blocked: needs npm install for a semver-major bump)          | 1     |
| P9-W14 | T232 — landed in wave P9-B (KEEP): the entry's methodNames is a          | 1     |
|        | RegExp over the real stale walk, not a string literal the                |       |
|        | comment stripper erases. Fired at the gate from docs/ on a               |       |
|        | phrase the implementer never used, then restored.                        |       |
| P9-W15 | T233 (filed by the P9-W4 gate; the new guard cannot see it).             | 1     |
| P9-W16 | T234 (filed by the P9-W4 gate; a decision, not a code change).           | 1     |
| P9-W17 | T235 — landed in wave P9-A (KEEP): versionCode derived from the          | 1     |
|        | file's own semver, not EAS autoIncrement, which cannot                   |       |
|        | accumulate under appVersionSource local. Falsified two                   |       |
|        | runbooks, both corrected at the gate. Left T247 open.                    |       |
| P9-W18 | T236 (filed by the P9-W5 gate; owner-blocked on EXPO_TOKEN).             | 1     |
| P9-W19 | T237 — landed in wave P9-B (KEEP-WITH-FIX): the skip list is             | 1     |
|        | gone and every tracked file is read. Left three prose sites              |       |
|        | asserting the decode would throw — it does not — and an                  |       |
|        | unguarded main() in a module its own test imports; all four              |       |
|        | fixed at the gate. Filed T248 and T249.                                  |       |
| P9-W20 | T238 — landed in wave P9-B (KEEP): the bin name stays paseo.             | 1     |
|        | Nothing under packages/cli moved. Recorded in plan.md §1.1               |       |
|        | and the runbook §A.2, where a reader meets the name.                     |       |
| P9-W21 | T239 — landed in wave P9-B (KEEP): four file:line citations              | 1     |
|        | replaced with symbols. The wave proved its own policy —                  |       |
|        | T238's plan.md edit moved the cited bullet 1163 → 1200 while             |       |
|        | the wave was open, so a renumbered citation would have                   |       |
|        | shipped false.                                                           |       |
| P9-W22 | T240 (filed by the P9-W7 gate; three runs, three results).               | 1     |
| P9-W23 | T241 — landed in wave P9-A (KEEP): description rewritten from            | 1     |
|        | both renderers, which slice to 200 before mounting. No test              |       |
|        | asserted the old string, and none was added to justify it.               |       |
| P9-W24 | T242 (filed by the P9-W8 gate; a policy, not an edit).                   | 1     |
| P9-W25 | T243 — landed in wave P9-A (KEEP): per-agent runExclusive around         | 1     |
|        | every read-modify-write, replacing waitForPendingWrite. The              |       |
|        | new test was watched failing on unmodified base code at the              |       |
|        | gate, in a worktree, not taken from the report.                          |       |
| P9-W26 | T244 (filed by the P9-W9 gate; four guards, one shared bug).             | 1     |
| P9-W27 | T246 (filed by the P9-A gate; widen the scope or refuse it).             | 1     |
| P9-W28 | T247 (filed by the P9-A gate; the one gap T235 left open).               | 1     |
| P9-W29 | T248 (filed by the P9-B gate; the same false premise, one                | 1     |
|        | file over — and this one still skips 24 tracked files).                  |       |
| P9-W30 | T249 (filed by the P9-B gate; T232's own omission class,                 | 1     |
|        | committed by the wave that closed it for someone else).                  |       |
| P9-W31 | T250 (filed by the P9-C gate; the suite fails, but not for the           | 1     |
|        | reason T233 committed — and the remedy it named would not help).         |       |
| P9-W32 | T251 (filed by the P9-C gate; the gap T230 named as the reason           | 1     |
|        | a relay→protocol import cannot be added safely).                         |       |
| P9-W33 | T252 (filed by the P9-D gate; two strippers T244 did not own,            | 1     |
|        | both using the order T244 proved defective).                             |       |
| P9-W34 | T253 (filed by the P9-D gate; the criterion T242 could not               | 1     |
|        | satisfy inside its own Owns line).                                       |       |
| P9-W35 | T254 (filed by the P9-E gate; T246 widened the shipped side              | 1     |
|        | only, so app.config.ts can declare but never deny).                      |       |
| P9-W36 | T255 (filed by the P9-E gate; the tag shapes T247 covers are             | 1     |
|        | asserted only in test titles, never read from the workflow).             |       |
| P9-W37 | T256 (filed by the P9-F gate; a safety claim scoped to four              | 1     |
|        | guards, now relied on by seven, one of them whole-tree).                 |       |
| P9-W38 | T257 (filed by the P9-F gate; the guard walks ignored disk               | 1     |
|        | state, so its local verdict disagrees with CI's).                        |       |
| P9-W39 | T258 (filed by the P9-F gate; T250 measured the cause and                | 1     |
|        | correctly refused the product-scope call it implies).                    |       |
| P9-W40 | T259 (filed by the P9-G gate; the entry fires only on the                | 1     |
|        | one sentence it was written against).                                    |       |
| P9-W41 | T260 (filed by the P9-G gate; two scripts/ci files T253's                | 1     |
|        | own grep scope could not reach).                                         |       |
| P9-W42 | T261 (filed by the P9-G gate; T253's own third criterion,                | 1     |
|        | whose answer lives only in a session report).                            |       |
| P9-W43 | T262 (filed by the P9-H gate; a shipped product defect T258              | 1     |
|        | surfaced and correctly refused to fix in its own scope).                 |       |
| P9-W44 | T263 (filed by the P9-H gate; the one shape that really does             | 1     |
|        | trigger the regex heuristic, inert today).                               |       |
| P9-W45 | T264 (filed by the P9-I gate; two merge paths, only one of               | 1     |
|        | which applies the manifest guard).                                       |       |
| P9-W46 | T265 (filed by the P9-I gate; two phrases that fire on true              | 1     |
|        | statements about other guards).                                          |       |
| P9-W47 | T266 (filed by the P9-I gate; the seam T262 deferred, inert              | 1     |
|        | at two of its six call sites even before T262).                          |       |
| P9-W48 | T267 (filed by the P9-I gate; one kept citation that fails               | 1     |
|        | T261's own test, plus two satisfied checkboxes).                         |       |
| P9-W49 | T268 (filed by the P9-J gate; the anchoring silenced the                 | 1     |
|        | pronoun form stale prose actually uses).                                 |       |
| P9-W50 | T269 (filed by the P9-J gate; one commit rotted five                     | 1     |
|        | line-number citations, one of them on arrival).                          |       |
| P9-W51 | T272 (filed by the P9-K gate; the rule forbids a prose                   | 1     |
|        | form its own recovery grep cannot find).                                 |       |
| P9-W52 | T273 (filed by the P9-L gate; a citation that has drifted                | 1     |
|        | 69 lines, found by T272 and outside its Owns).                           |       |
| P9-W53 | T274 (filed by the P9-L gate; the rationale the comment                  | 1     |
|        | calls missing is now the test's own title).                              |       |
| P9-W54 | T275 (filed by the P9-L gate; invisible to T272's grep                   | 1     |
|        | twice over -- single-digit, then bare numbers).                          |       |
| P9-W55 | T276 (owner request; the press-to-stop machine exists, the               | 1     |
|        | recorder behind it does not).                                            |       |
| P9-W56 | T277 (owner request; the audio outcome dead-ends and a                   | 1     |
|        | finished transcript auto-sends instead of offering).                     |       |
| P9-W57 | T278 (owner request; StagedAttachment carries nothing a                  | 1     |
|        | thumbnail could render from).                                            |       |
| P9-W58 | T279 (owner request; the web composer has no paste, drop                 | 1     |
|        | or dragover handler at all).                                             |       |
| P9-W59 | T280 (filed by the P9-M gate after CI went RED; a test                   | 1     |
|        | racing its own asynchronous continuation).                               |       |
| P9-W60 | T281 (filed by the P9-O gate; the guard is green only because            | 1     |
|        | nothing this wave shipped is registered).                                |       |
| P9-W61 | T282 (filed by the P9-O gate; the mic asks for a permission it           | 1     |
|        | cannot repay, and the pickers are inert).                                |       |
| P9-W62 | T283 (owner request; an attachment sent from one surface cannot          | 1     |
|        | be fetched by the other -- no RPC serves the path).                      |       |
| P9-W63 | T284 (owner request; both renderers already carry the unwired            | 1     |
|        | seam this fills).                                                        |       |
| P9-W64 | T285 (filed by the P9-O gate; a subset array a Record would              | 1     |
|        | have caught).                                                            |       |
| P9-W65 | T286 (filed by the P9-O gate; 'Um... hello' survives the                 | 1     |
|        | filter the doc says it does not).                                        |       |
| P9-W66 | T287 (filed by the P9-O gate; GROQ_STT_MODEL produces exactly            | 1     |
|        | the value the sentence promises cannot happen).                          |       |
| P9-W67 | T288 (filed by the P9-P gate; the one non-negotiable nothing             | 1     |
|        | pins is the one a later widening would break).                           |       |
| P9-W68 | T289 (filed by the P9-P gate; T282 shipped the mount wiring              | 1     |
|        | and registered nothing -- P9-O's omission again).                        |       |
| P9-W69 | T290 (owner ran the picker install at 488c4dc; T278's whole              | 1     |
|        | feature is unreachable until these two ports exist).                     |       |
| P9-W70 | T291 (found while verifying that install; expo-audio is pinned           | 1     |
|        | below what this app's own expo bundles).                                 |       |
| P9-W71 | T292 (owner request; typing / offers commands on web and is              | 1     |
|        | plain text on Android).                                                  |       |
| P9-W72 | T293 (owner request; the tier-2 bridge can push editor text but          | 1     |
|        | not read it, so prompt-arbitrage is inert).                              |       |
| P9-W73 | T294 (filed by the P9-Q gate; the privacy argument is incomplete         | 1     |
|        | about its own chosen path).                                              |       |
| P9-W74 | T295 (filed by the P9-Q gate; a sentence T284 falsified sat where        | 1     |
|        | no guard could see it).                                                  |       |

---

## Task details

### Phase 0 — Bootstrap, reference audit, and fix contracts

#### T01 — Initialize greenfield repository and tooling baseline

`labels: phase-0, area: tooling` · `wave: P0-W1` · `depends-on: —`
**STATUS: DONE — committed as `e1aec64` on `main`; independent verification still pending.**

Create the repository: fresh `git init` with no Paseo remote, clean root `package.json`,
AGPL-3.0-or-later `LICENSE`, and baseline tooling config (oxfmt, oxlint, root tsconfig,
knip, vitest).

- [x] `git remote -v` prints nothing; history starts at the initial commit
- [x] Root `package.json` carries Pi Companion metadata only and workspace globs
- [x] `npm run format:check`, `lint`, and `typecheck` succeed

#### T02 — Port protocol, relay, and highlight packages

`labels: phase-0, area: reference-import` · `wave: P0-W2` · `depends-on: T01`
**STATUS: DONE — committed as `fb803c6` on `phase0/t02`; verification pending.**
**Copies code from `D:\paseo` — AGPL attribution required (recorded in T05).**

Copy `packages/protocol`, `packages/relay`, and `packages/highlight` from the reference
under `@picompanion/*`. These are leaf packages, so they port first.

- [x] All three packages build; ported protocol tests pass
- [x] No import or path references `D:\paseo` or `packages/app`
- [x] Provenance notes handed to T05

#### T10 — Write Phase 0 decision docs and verify release identity

`labels: phase-0, area: docs` · `wave: P0-W2` · `depends-on: T01`
**STATUS: DONE — committed as `a00b764` on `phase0/t10`; verification pending.**

Re-audit installed extensions into `docs/pi-extension-compatibility.md`, write the
keep/reset decision into `docs/frontend-data-migration.md`, and verify EAS project,
package ids, and signing credential ownership.

- [x] `docs/pi-extension-compatibility.md` covers every installed extension against §11.7
- [x] `docs/frontend-data-migration.md` records export-vs-reset per data class
- [x] Release identity and signing ownership documented

#### T03 — Port client SDK, CLI, pi-bridge, and audio module

`labels: phase-0, area: reference-import` · `wave: P0-W3` · `depends-on: T02`
**STATUS: DONE — committed as `ff695bc` on `phase0/t03`; verification pending.**
**Copies code from `D:\paseo` — AGPL attribution required (recorded in T05).**

Copy `packages/client`, `packages/cli`, `packages/pi-bridge`, and
`packages/expo-two-way-audio` under `@picompanion/*`.

- [x] All four packages build; ported tests pass
- [x] No `packages/app` or Paseo-path references
- [x] Provenance notes handed to T05

#### T04 — Port server daemon with Pi provider

`labels: phase-0, area: reference-import` · `wave: P0-W3` · `depends-on: T02`
**STATUS: DONE — committed as `d90195a` on `phase0/t04`; verification pending.**
**Copies code from `D:\paseo` — AGPL attribution required (recorded in T05).**

Copy `packages/server` including the Pi provider (`providers/pi/` with `ui-bridge/`,
session watcher, live tail), reduced to the Pi-only surface.

- [x] Server builds and targeted server tests pass
- [x] Daemon starts against a scratch `$PASEO_HOME` and serves the WebSocket hello
- [x] Pi provider, UI bridge, watcher, and live tail present

#### T05 — Record third-party provenance and AGPL attribution

`labels: phase-0, area: docs` · `wave: P0-W4` · `depends-on: T02, T03, T04`

Create `THIRD_PARTY_NOTICES.md`: Paseo attribution (AGPL-3.0-or-later, copyright, source
location, what was copied per package) plus the Beautiful source/license checklist from
plan §10.1. This is the gate document later recipe tasks must consult.

- [x] Every ported package from T02-T04 has an attribution entry
- [x] Beautiful checklist exists with source URL/version/license columns
- [x] The §10.1 gate is stated: no Beautiful-inspired recipe lands without an approved row

#### T06A — Capture Pi RPC event fixtures

`labels: phase-0, area: protocol` · `wave: P0-W4` · `depends-on: T04`

Record fixtures for all 21 Pi RPC event types listed in plan §11.1 (agent/turn/message
lifecycle, bash and tool execution, queue, compaction, retries, extension error) into the
shared fixtures directory, using synthetic paths and secrets.

- [x] All 21 event types have at least one recorded fixture
- [x] Fixtures load through a shared loader used by later core tests
- [x] No real paths, tokens, or prompt content in fixture data

#### T06B — Capture daemon WebSocket and bridge-kind fixtures

`labels: phase-0, area: protocol` · `wave: P0-W4` · `depends-on: T04`

Record the daemon-side WebSocket sequences from plan §14.2 — hello and capability
negotiation, session lifecycle, permission dialog, reconnect with gap — plus one fixture
per Pi UI bridge kind for all ten kinds.

- [x] Every §14.2 WebSocket scenario has a recorded fixture
- [x] All ten bridge kinds are represented
- [x] Fixtures are replayable without a live daemon

#### T09A — Implement incremental live-tail checkpoint

`labels: phase-0, area: protocol` · `wave: P0-W4` · `depends-on: T04`

Replace the whole-file reread in `pi-live-tail.ts` with a byte-offset or entry-id
checkpoint so append processing reads work proportional to appended bytes.

- [x] Live tail resumes from a checkpoint instead of rereading the file
- [x] Existing live-tail tests still pass
- [x] Checkpoint survives restart and handles truncation safely

#### T06C — Add transcript-protection tests

`labels: phase-0, area: protocol` · `wave: P0-W5` · `depends-on: T06A`

Add the two transcript-protection tests from plan §11.7: `display:false` content stays
hidden, and a final `message_end` replacement corrects the live row in place rather than
appending a duplicate.

- [x] Hidden-message test fails if `display:false` content leaks into the projection
- [x] Final-correction test asserts in-place replacement by message id
- [x] Both run one-shot against recorded fixtures

#### T07A — Define typed Pi UI payload schemas and capability gate

`labels: phase-0, area: protocol` · `wave: P0-W5` · `depends-on: T06B`
**GATE: T21B, T29A/B, and T34A/B all depend transitively on this.**

Steps 1-3 of plan §4.2: typed payload schemas for all ten kinds, an optional canonical
`payload` field on the wire envelope, and `CLIENT_CAPS.piUiPayloadV2` plus
`server_info.features.piUiPayloadV2`; regenerate the ahead-of-time validators.

- [x] Typed schema exists for each of the ten kinds; no field is silently stripped
- [x] Canonical `payload` is optional; no Zod transform in the shared wire schema
- [x] New capability and feature flag are separate from the existing `piUiBridge` gate
- [x] Regenerated validators build and pass

#### T09B — Add watcher race tests and live-tail benchmark

`labels: phase-0, area: protocol` · `wave: P0-W5` · `depends-on: T09A`

Add duplicate-import race tests for `pi-session-watcher.ts` and the plan §13 benchmark: a
100,000-entry synthetic session must read work proportional to appended bytes.

- [x] Duplicate-import race tests pass deterministically
- [x] Warm append processing < 250 ms p95 and < 50 MiB additional peak memory
- [x] Benchmark is runnable one-shot and skippable by label in CI

#### T07B — Normalize and dual-emit Pi UI payloads in the daemon

`labels: phase-0, area: protocol` · `wave: P0-W6` · `depends-on: T07A`

Steps 4-6 of plan §4.2: normalize current top-level v1 fields into `payload` inside the
daemon decoder before protocol validation, accept both old helper messages and canonical
payload messages, and emit canonical payloads to capable clients while preserving the
legacy top-level projection for older ones.

- [x] Normalization happens at the daemon boundary, not in the shared schema
- [x] Old helper messages and canonical messages are both accepted
- [x] Capable clients receive `payload`; legacy clients still receive top-level fields

#### T07C — Add payload compatibility fixtures and COMPAT tags

`labels: phase-0, area: protocol` · `wave: P0-W7` · `depends-on: T07B`

Steps 7-9 of plan §4.2: fixtures for old helper → old client, old helper → new client, new
helper → old client, and new helper → new client; wire-compatibility tests; and
`// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28` tags on transition
code.

- [x] All four combination fixtures round-trip without payload loss
- [x] Wire-compatibility tests pass against both projections
- [x] Every transition code path carries a COMPAT tag with the removal date

#### T08A — Implement bridge state and identity rules

`labels: phase-0, area: protocol` · `wave: P0-W7` · `depends-on: T07B`

Replace provisional behavior in the Pi provider's `ui-bridge/state.ts`: reject a patch for
a missing element and request a full resync, append only to payload types that support it,
enforce TTL in the daemon only, and preserve `ns:id` identity with composite action
identity for routing.

- [x] Patch for a missing element triggers resync instead of inventing an element
- [x] Append is rejected for kinds that do not support it
- [x] TTL is daemon-enforced; helper TTL is advisory
- [x] Action routing uses composite identity, never a bare element id

#### T08B — Implement revision handling and reconnect replay tests

`labels: phase-0, area: protocol` · `wave: P0-W8` · `depends-on: T08A`

Deterministic revision rules from plan §4.2 — discard a delta at or below current, apply
only `current + 1`, request full state on a jump, accept full state at or above current —
plus bounded optional durable snapshots, and tests for reconnect replay, sequence gaps,
stale revisions, close, and agent shutdown.

- [x] Each revision rule has a unit test
- [x] Reconnect replay, gap, stale-revision, close, and shutdown paths tested
- [x] Ephemeral Pi UI state never enters the durable cache
- [x] Durable snapshots are bounded, optional, and backward-readable

#### T11 — Prune unused server dependencies

`labels: phase-0, area: tooling` · `wave: P0-W9` · `depends-on: T04, T08B, T09B`

The ported server still lists dependencies used only by Paseo's deleted providers. Remove
them only after knip, the server build, and targeted tests prove they are unused, then
regenerate the lockfile and start tracking it.

- [x] `knip` reports no unused server dependencies
- [x] Server build and targeted tests stay green after removal
- [x] Lockfile regenerated and now committed

### Phase 1 — Workspace skeleton

#### T12A — Wire root workspaces, scripts, and workspace stubs

`labels: phase-1, area: tooling` · `wave: P1-W1` · `depends-on: T03, T04`

Register the ported backend packages and create minimal stubs (directory, `package.json`,
empty `src/`) for `apps/web`, `apps/android`, `packages/frontend-core`, and
`packages/design-tokens`, so later tasks never edit shared root files. Add the root
dev/build/typecheck/lint/test scripts from plan §14.6 and §15.1.

- [ ] `npm install --workspaces` succeeds with all workspaces recognized
- [ ] Root scripts from §14.6/§15.1 exist and run
- [ ] Aliases are package-local; no root alias maps into a package `src`

#### T12B — Write README and CLAUDE repository docs

`labels: phase-1, area: docs` · `wave: P1-W2` · `depends-on: T12A`

Write `README.md` and `CLAUDE.md` for this repository, both linking `plan.md` prominently
and marking any copied Paseo documents as reference material rather than product spec.

- [ ] Both files link `plan.md` as authoritative
- [ ] Copied Paseo docs are labeled reference-only
- [ ] No document describes Paseo's old frontend as this product

#### T13 — Build design-tokens package with web and native outputs

`labels: phase-1, area: tokens` · `wave: P1-W2` · `depends-on: T12A`

Fill the `packages/design-tokens` stub per plan §10.2: semantic colors, typography, spacing
and radii, elevation, status tones, code and diff colors, motion, and breakpoints, emitting
CSS variables for web and typed theme objects for Android.

- [ ] `npm run build:design-tokens` produces both web and native exports
- [ ] Dark and light themes exist; no raw hex reaches consumers
- [ ] Reduced-motion and high-contrast hooks present

#### T14 — Build frontend-core skeleton with import guards

`labels: phase-1, area: core` · `wave: P1-W2` · `depends-on: T12A`

Fill `packages/frontend-core` with the §6 directory layout and the narrow platform
interfaces of §7.3, plus an enforced guard (lint rule and test) that fails on any React,
React Native, Expo, DOM, or browser-global import.

- [ ] Directory layout matches plan §6
- [ ] All §7.3 platform interfaces defined and documented
- [ ] Guard fails the build on a seeded React/DOM import

#### T17A — Create CI pipeline, path filters, and legacy guards

`labels: phase-1, area: ci` · `wave: P1-W2` · `depends-on: T12A`

Author CI from scratch: the §15.4 job list, path filters distinguishing
frontend-core/web/android/backend/protocol without skipping shared contract tests, a guard
failing on any `packages/app` path or legacy import, and a guard rejecting `.web.*` files
in `apps/android`.

- [ ] §15.4 jobs defined; path filters route correctly on test changes
- [ ] `packages/app` guard fails on a seeded violation
- [ ] `.web.*` guard fails on a seeded violation

#### T18 — Create daemon web-UI bundling script and prepack

`labels: phase-1, area: tooling` · `wave: P1-W2` · `depends-on: T04, T12A`
**Adapts the reference build script — AGPL attribution required (recorded in T05).**

Create `scripts/build-daemon-web-ui.mjs` with `apps/web/dist` as its only source and
`packages/server/dist/server/web-ui` as output, preserving precompression, hashed-asset
caching, SPA fallback, and connection-hint injection; wire the server prepack.

- [ ] Script bundles a placeholder `apps/web/dist` into the server output
- [ ] Daemon serves the bundle with `PASEO_WEB_UI_ENABLED=true` and runs cleanly without it
- [ ] `--web-ui` / `--no-web-ui` and `PASEO_WEB_UI_*` behavior matches the reference

#### T15 — Scaffold blank DOM-first web shell

`labels: phase-1, area: web` · `wave: P1-W3` · `depends-on: T12A, T14`

Fill `apps/web`: React 19 + Vite + TanStack Router, no Next.js and no SSR. A blank
authenticated shell shows connected/disconnected from a fake core adapter and reads
`window.__PASEO_INITIAL_DAEMON_CONNECTION__` when daemon-served.

- [ ] `npm run dev:web` serves the shell; production build emits `apps/web/dist`
- [ ] Connected/disconnected state flows through core interfaces, not local state
- [ ] §8.2 route stubs survive static SPA fallback on refresh

#### T16 — Scaffold Android-only Expo shell with Metro guards

`labels: phase-1, area: android` · `wave: P1-W3` · `depends-on: T12A, T14`

Fill `apps/android`: Expo 54 / RN 0.81 with Expo Router, an Android-only Metro
configuration, and a check rejecting `.web.*` files and web-only imports. Same fake core
adapter as web.

- [ ] App boots on the reference emulator with a connected/disconnected shell
- [ ] `.web.*` rejection fails the build on a seeded file
- [ ] No web target exists in `apps/android`

#### T17B — Create Android APK release workflow

`labels: phase-1, area: ci` · `wave: P1-W4` · `depends-on: T16, T17A`

Write a signed Android APK release workflow for `apps/android`, using the reference
workflow only as behavioral documentation. Release tags build and attach the APK.

- [ ] Workflow builds `apps/android` on a release tag (dry-run acceptable until Phase 9)
- [ ] Signing credentials are read from secrets, never committed
- [ ] Artifact naming uses `sh.picompanion`

### Phase 2 — frontend-core

#### T19A — Implement DaemonClient lifecycle and feature gates

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T03, T14`

In `frontend-core/src/connection`: construct and own the `DaemonClient` lifecycle, perform
the hello exchange, and enable capabilities and server feature gates exactly once per
connection.

- [ ] Recorded hello/capability fixtures drive gate state correctly
- [ ] Client lifecycle (connect, disconnect, dispose) is leak-free under test
- [ ] No React/DOM/RN/Expo import (guard stays green)

#### T20A — Implement timeline reducer core invariants

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T06A, T14`

In `frontend-core/src/timeline`: ingestion plus the §7.4 invariants that do not require
pagination — epoch reset, epoch/seq dedupe, `replaceMessageId` correction in place, tool
updates attached to their call, preserved daemon timestamps.

- [ ] Each covered §7.4 invariant has a fixture-driven test
- [ ] Duplicate events never produce duplicate rows
- [ ] Final-message correction replaces in place

#### T21A — Implement permission and extension dialog state

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T14`

In `frontend-core/src/permissions`: permission requests and extension dialog requests
(select, confirm, input, editor) with pending/answered/timeout states and response
dispatch.

- [ ] Permission fixtures drive answer round-trips
- [ ] Timeouts resolve without leaking pending state
- [ ] Dialog kinds map to platform-neutral view models

#### T21B — Implement Pi UI element state and revision handling

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T07A, T14`

In `frontend-core/src/extensions`: Pi UI element state keyed by `ns:id`, client-side
revision handling mirroring the daemon rules, and reconnect replay. Consumes the canonical
`payload` from T07A.

- [ ] Canonical payload parsed for all ten kinds; v1 projection still accepted
- [ ] Stale and jumped revisions handled per plan §4.2
- [ ] Ephemeral state never persisted as history

#### T22 — Implement core drafts, outbox, and offline cache

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T14`

In `frontend-core/src/composer` and `offline`: drafts, queued prompts with stable client
submission ids, safe outbox semantics, and display-only cache serialization with stale
marking.

- [ ] Drafts survive simulated restart through the storage interface
- [ ] Outbox refuses automatic resend while idempotency is unverified
- [ ] Cached timelines load flagged stale until authoritative catch-up

#### T23 — Implement core tool-call view models with fallback

`labels: phase-2, area: core` · `wave: P2-W1` · `depends-on: T06A, T14`

In `frontend-core/src/tools`: typed view models for the §11.6 tool families plus the safe
generic card model for arbitrary tools (name, source, state, duration, collapsible input,
streaming updates, result or error).

- [ ] Every §11.6 family maps to a typed view model from fixtures
- [ ] An unknown tool shape produces the generic model, never a throw
- [ ] Streaming updates stay attached to their call

#### T19B — Implement host registry, probing, and relay selection

`labels: phase-2, area: core` · `wave: P2-W2` · `depends-on: T19A`

In `frontend-core/src/hosts`: host profiles, connection probing, reconnect policy, and
direct-versus-relay selection, layered on the T19A client lifecycle.

- [ ] Host profiles persist through the storage interface
- [ ] Reconnect and relay-switch paths covered by unit tests
- [ ] Probing prefers direct and falls back to relay deterministically

#### T20B — Implement pagination, gap recovery, and reconciliation

`labels: phase-2, area: core` · `wave: P2-W2` · `depends-on: T20A`

Extend the reducer with authoritative pagination, gap detection that pages until complete,
optimistic user-row reconciliation with accepted daemon rows, stale-tail restore, and
restart recovery during an active turn.

- [ ] Gap detection pages to completion against recorded fixtures
- [ ] Optimistic rows reconcile without duplication
- [ ] Restart during an active turn recovers correct state

#### T21C — Implement extension action controller

`labels: phase-2, area: core` · `wave: P2-W2` · `depends-on: T21B`

Implement the `ExtensionActionController` with composite action identity
`(agentId, namespace, elementId, actionId, requestId)` and pending, success, and failure
states per plan §12.3.

- [ ] Action round-trip, rejection, timeout, and stale-revision fixtures pass
- [ ] Composite identity prevents cross-element action collisions
- [ ] Dangerous-action confirmation hook is exposed to renderers

#### T24 — Add navigation intents, fixtures, recorded-session test

`labels: phase-2, area: core` · `wave: P2-W3` · `depends-on: T19B, T20B, T21C, T22, T23`

Add platform-neutral navigation intents and the shared fixture/contract builders both apps
consume, then the Phase 2 exit test: a complete recorded session driven from hello through
reconnect, gap recovery, extension action, and final correction, in Node without React.

- [ ] Recorded-session contract test passes in plain Node (Phase 2 exit)
- [ ] Fixture builders exported for web and Android suites
- [ ] Behavior notes from the reference frontend are captured as tests, never copied code

### Phase 3 — Design system

#### T25A — Build web primitives and component lab

`labels: phase-3, area: web` · `wave: P3-W1` · `depends-on: T13, T15`

Implement the §10.3 primitive set for web from generated CSS variables (Tailwind, Radix
where it reduces accessibility risk) plus a dev-only component lab route driven by shared
fixtures.

- [ ] All §10.3 primitives exist with one approved treatment each
- [ ] Component lab renders every primitive from fixtures
- [ ] No product color appears as a raw hex in component code

#### T26A — Build Android primitives and component lab

`labels: phase-3, area: android` · `wave: P3-W1` · `depends-on: T13, T16`

Implement the same §10.3 primitives natively from typed theme tokens, plus a dev-only lab
screen using the same fixtures, with 48 dp targets and no hover dependencies.

- [ ] Primitive semantics match the web set on shared fixtures
- [ ] Touch targets are at least 48 dp
- [ ] Lab screen renders every primitive

#### T25B — Build web recipes and accessibility passes

`labels: phase-3, area: web` · `wave: P3-W2` · `depends-on: T25A`

Build the §10.4 Pi-case recipes for web and apply §10.5: accessible names, keyboard
operation, visible focus, non-color status, reduced motion, and axe checks.

- [ ] Every §10.4 recipe exists with a real Pi use case
- [ ] axe checks pass; keyboard-only operation verified
- [ ] Any Beautiful-inspired recipe has an approved `THIRD_PARTY_NOTICES.md` row

#### T26B — Build Android recipes and accessibility passes

`labels: phase-3, area: android` · `wave: P3-W2` · `depends-on: T26A`

Build the same recipes natively with Reanimated motion from shared tokens, and verify
TalkBack roles and states, reduced motion, and dark/light themes.

- [ ] Recipes match web semantics on shared fixtures
- [ ] TalkBack roles and states verified on critical components
- [ ] Reduced-motion and dark/light verified

### Phase 3.5 — Beautiful UI conformance

Phases 1–3 built the design system against an invented palette, because plan §10 pointed at
the wrong source. The real source is the MIT-licensed Beautiful UI
(<https://www.beautifului.dev/>); its language is specified in `docs/beautiful-ui-reference.md`.
This phase makes the existing design system match it, before Phase 4 builds more UI on top.

#### T13B — Re-token design system to Beautiful UI language

`labels: phase-3.5, area: tokens` · `wave: P35-W1` · `depends-on: T25B, T26B`

Rewrite `packages/design-tokens` to Beautiful UI's semantic structure and values from
`docs/beautiful-ui-reference.md`: surface stack `page/canvas/surface/inset/field`, text ramp
`ink/ink-2/ink-3`, `line`/`line-strong`/`line-soft`, accent and status tones with their tints,
radii 6/8/10/14, ring-based shadow set, Inter + Geist Mono, the small type scale, and the
`cubic-bezier(.23,1,.32,1)` easing family. Both themes. Keep the existing web CSS-variable and
native theme-object output shapes so consumers keep compiling.

- [ ] Both themes carry the exact values in `docs/beautiful-ui-reference.md`
- [ ] Old token names either map to new ones or are removed with all call sites updated
- [ ] `npm run build:design-tokens`, typecheck, and the full test suite are green

#### T25C — Web conformance pass to Beautiful UI language

`labels: phase-3.5, area: web` · `wave: P35-W2` · `depends-on: T13B`

Restyle every primitive and recipe in `apps/web/src/ui` to the new tokens: 1px ring shadows
instead of blurs, dashed hairline section dividers, the small type scale, Geist Mono tabular
numerals, the signature easing, `active:scale-[0.96]` on controls, and the shimmer-gradient
treatment on live/thinking states. Adapted Beautiful UI code is permitted under MIT provided
each such file gets an attribution header and a `THIRD_PARTY_NOTICES.md` row.

- [ ] Every primitive and recipe matches `docs/beautiful-ui-reference.md`
- [ ] The remaining raw hex values in `apps/web/src/styles/global.css` and
      `apps/web/src/features/connection/connection-status.tsx` are gone (unmet Phase 3 exit)
- [ ] Existing axe and keyboard tests still pass, unweakened
- [ ] Any file with adapted code has an attribution header and a notices row

#### T26C — Android conformance pass to Beautiful UI language

`labels: phase-3.5, area: android` · `wave: P35-W2` · `depends-on: T13B`

Apply the same language natively in `apps/android/src/ui`. Beautiful UI's control sizes
(24–28px) are below the touch minimum: keep the visual size but expand the touch target to
48dp via hit slop or padding, so density reads the same while remaining usable.

- [ ] Primitives and recipes match the web treatment on shared fixtures
- [ ] Touch targets remain at least 48dp with the tighter visual sizing
- [ ] TalkBack, reduced-motion, and dark/light tests still pass, unweakened

#### T13C — Bundle Inter/Geist Mono and complete light-theme values

`labels: phase-3.5, area: tokens` · `wave: P35-W3` · `depends-on: T25C, T26C`

Closes the two gaps the Phase 3.5 exit verifier found.

First, **self-host the fonts**. The token layer names Inter and Geist Mono, but neither is
bundled, so on any machine without them installed the UI silently falls back to a system
face and the near-exact match is lost. Vendor both (subset woff2 for web with `@font-face`
and `font-display: swap`; `expo-font` with the TTFs for Android), and record their SIL Open
Font License in `THIRD_PARTY_NOTICES.md`.

Second, **apply the recovered light-theme values**. `docs/beautiful-ui-reference.md` now
publishes every light role that was previously only described qualitatively — `hover`,
`hover-2`, `line-soft`, `accent-ink`, all `*-tint` fills, the `tooltip-*` set, `stripe`,
`stripe-bg`, and the light shadow strings. T13B necessarily approximated these; replace the
approximations with the published values.

- [ ] Inter and Geist Mono render from bundled assets on both platforms with no system fallback
- [ ] Font licences recorded in `THIRD_PARTY_NOTICES.md`
- [ ] Every light-theme role matches `docs/beautiful-ui-reference.md` exactly
- [ ] Existing tests still pass, unweakened; typecheck, format:check and oxlint clean

### Phase 4 — Web vertical slice

#### T27S1 — Build the three-region web app shell

`labels: phase-4, area: web` · `wave: P4-W1` · `depends-on: T24, T25A`

Build the plan §8.3 desktop layout: a left session rail, a centre transcript-and-composer column, and a right live Pi extension rail, with named slots that later tasks fill. This task owns the shell file so no other task has to edit it.

Owns: `apps/web/src/ui/shell.tsx and its stylesheet`. No other task in this wave touches those files.

- [ ] The three regions render with empty slots and a responsive compact fallback
- [ ] The right rail is present and does not collapse to a status chip when it has content
- [ ] Slots are typed so a feature can mount into one without editing the shell

#### T27S2 — Add the web route table and lazy route boundaries

`labels: phase-4, area: web` · `wave: P4-W1` · `depends-on: T24, T25A`

Define the route table and the lazy-loading boundaries every feature route will hang off, with a not-found and an error route.

Owns: `apps/web/src/routes/`. No other task in this wave touches those files.

- [ ] Routes resolve and render placeholder screens
- [ ] Lazy boundaries produce separate build chunks
- [ ] Unknown routes render the not-found screen, not a blank page

#### T27A1 — Build the connect form and host-profile validation

`labels: phase-4, area: web` · `wave: P4-W2` · `depends-on: T27S1, T27S2`

Build the connect screen: host address, profile selection and client-side validation, composing existing primitives.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] Invalid host input is rejected with a visible, named error
- [ ] The form is keyboard operable and passes an asserted axe check
- [ ] Valid input produces a connection attempt through core

#### T27A2 — Add bearer-token authentication and credential storage

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T27A1`

Implement `paseo.bearer.<token>` authentication and store credentials through the platform storage interface.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] A successful auth persists credentials and survives reload
- [ ] No token or password appears in any URL query string
- [ ] Logout clears stored credentials

#### T27A3 — Apply ConnectionOffer pairing payloads

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T27A2`

Parse and apply a `ConnectionOffer`, including rejecting malformed and expired offers.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] A valid offer populates the connect form and connects
- [ ] A malformed or expired offer is rejected with a distinct error
- [ ] Offer parsing is unit-tested against fixtures

#### T27A4 — Add QR-based pairing capture

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T27A3`

Add QR capture that feeds the offer path, degrading cleanly where no camera is available.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] A scanned offer completes pairing
- [ ] Camera-denied and no-camera cases show an explained fallback to manual entry
- [ ] The QR chunk is lazily loaded

#### T27A5 — Handle daemon-injected bootstrap configuration

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T27A2`

When the daemon serves the bundled web UI it injects bootstrap configuration; consume it and skip redundant pairing.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] Injected bootstrap connects without showing the pairing form
- [ ] A missing or malformed bootstrap falls back to manual connect
- [ ] Bootstrap values never override an explicit user-entered host silently

#### T27A6 — Build the connection error taxonomy and relay profiles

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T27A5`

Give each failure mode a distinct, non-alarming message, and support relay host profiles alongside direct ones.

Owns: `apps/web/src/features/connect/`. No other task in this wave touches those files.

- [ ] Wrong password and wrong daemon key produce different, correct errors
- [ ] Direct and relay profiles both connect against a dev daemon
- [ ] Errors are announced to screen readers and are not colour-only

#### T27B1 — Render the session list from core state

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T27S1`

Render the left-rail session list from core state, composing existing primitives, including empty and error states.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Sessions render grouped with status shown in text as well as colour
- [ ] Empty and error states render from the shared placeholder primitive
- [ ] An asserted axe check passes and rows are keyboard reachable

#### T27B2 — Add session create and open

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T27B1`

Add session creation and opening through core mutations.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Creating a session round-trips against a dev daemon
- [ ] Opening a session navigates and loads its timeline
- [ ] A failed create surfaces an error without losing typed input

#### T27B3 — Add session resume and cold open

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T27B2`

Resume an existing session, including opening cold from a direct URL.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Resume restores timeline and queue state
- [ ] A direct session URL opens correctly on a cold load
- [ ] Resuming a missing session fails with a clear message

#### T27B4 — Add session archive and delete

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T27B3`

Add archive and delete with confirmation for the destructive path.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Archive and delete round-trip against a dev daemon
- [ ] Delete requires explicit confirmation
- [ ] The list updates optimistically and reconciles with the daemon

#### T27B5 — Add Pi session discovery and import

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T27B4`

Discover existing Pi sessions on the host and import them, including terminal-started sessions.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Discovered sessions are listed distinctly from imported ones
- [ ] An imported terminal session appears correctly and can be opened
- [ ] Import is idempotent when run twice

#### T27B6 — Keep session list state correct across reconnect

`labels: phase-4, area: web` · `wave: P4-W8` · `depends-on: T27B5`

Make the list survive disconnect, reconnect and gap recovery without duplicating or dropping rows.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] List state survives a forced reconnect against a dev daemon
- [ ] No duplicate rows appear after gap recovery
- [ ] Stale rows are marked rather than silently shown as current

#### T28A1 — Build the transcript view model in frontend-core

`labels: phase-4, area: core` · `wave: P4-W2` · `depends-on: T24`

Turn timeline state into a framework-neutral list of transcript entries covering every §11.1 lifecycle state. No React, no DOM.

Owns: `packages/frontend-core/src/timeline/transcript-view.ts`. No other task in this wave touches those files.

- [ ] Every §11.1 lifecycle state maps to a typed entry
- [ ] A recorded session produces a stable entry list in plain Node
- [ ] The purity guard still passes

#### T28A2 — Render assistant, user, and streaming messages

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T28A1, T27S1`

Render the three core message shapes, composing the StreamingMessage recipe.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Streaming text updates incrementally without re-rendering the whole list
- [ ] User and assistant messages are distinguishable without colour alone
- [ ] An asserted axe check passes

#### T28A3 — Render thinking and reasoning sections

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T28A2`

Render collapsible thinking and reasoning using the ThinkingSection recipe.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Thinking sections expand and collapse by keyboard with correct ARIA state
- [ ] Live thinking shows the shimmer treatment and respects reduced motion
- [ ] Long reasoning is bounded rather than unbounded

#### T28A4 — Render tool calls and the safe unknown-tool card

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T28A3`

Render tool calls through the T23 view models, with a safe generic card for unknown tools.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Known tools render their specific card
- [ ] An unknown tool renders the safe generic card and never raw payload
- [ ] Tool status is conveyed in text as well as colour

#### T28A5 — Render images, attachments, and diffs

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T28A4`

Render image and attachment entries and inline diffs via the DiffSummary recipe.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

**Landed PARTIAL in batch C, by design.** Diffs, tool-result images and payload bounding are done.
Message-level images and attachments were left visibly unimplemented with a cited diagnosis rather
than faked, and the diagnosis is correct: the data never reaches the transcript because
`getUserMessageText` (`packages/server/src/server/agent/providers/pi/history-mapper.ts:41-53`) is
typed to receive `(PiTextContent | PiImageContent)[]` and **silently drops every image block**, and
`AgentTimelineItem`'s message variants carry no attachment field. Pi does send this content. Same
class of defect as the queue modes: our port discards a capability Pi provides.

The remaining criterion is therefore T52A1-T52A3, not this task. Note T33A5 (Android) reads the
same data, so the fix must land before Phase 5.

- [x] Diffs render with add/remove counts in tabular mono figures
- [x] Oversized payloads are bounded, not dropped silently
- [x] Tool-result images render with accessible names
- [x] A very large markdown message degrades to plain text rather than freezing the renderer (ompweb review)
- [ ] Message-level images and attachments render with accessible names — **moved to T52A3**

#### T28A6 — Virtualize the transcript to a bounded window

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T28A5`

Virtualize the list so a very long session stays responsive.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] A 10,000-item transcript renders within a bounded DOM window
- [ ] Scroll position and follow-tail behave correctly during streaming
- [ ] The virtualization test carries an explicit timeout
- [ ] The payload itself is bounded, not just the view: a long session is paged rather than sent whole (ompweb review)

#### T28A7 — Render compaction and retry markers and compact layout

`labels: phase-4, area: web` · `wave: P4-W8` · `depends-on: T28A6`

Add compaction and retry markers and the responsive compact layout.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Compaction and retry markers render as distinct, explained entries
- [ ] The compact layout renders correctly below the wide breakpoint
- [ ] No pre-existing transcript assertion was weakened

#### T28B1 — Build the composer input and prompt submission

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T27S1`

Build the composer on the PromptBar recipe, with submission through core.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

- [ ] A prompt submits and appears optimistically in the transcript
- [ ] The composer is keyboard operable with a visible focus treatment
- [ ] An asserted axe check passes

#### T28B2 — Add steer, follow-up, and abort

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T28B1`

Add steering, follow-up submission and abort against a running turn.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

- [ ] Steer and follow-up round-trip with correct queue state
- [ ] Abort stops the turn and the UI reflects it promptly
- [ ] Each control has a distinct accessible name

#### T28B3 — Show queue state and queue controls

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T28B2`

Surface queue depth and the steer/follow-up split.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

**Scope corrected during batch B, then corrected again.** This task originally required "controls
to change mode". The first correction claimed no such mode existed anywhere; **that was wrong**,
and the record is kept here because the mistake is instructive. Pi genuinely supports it: its RPC
accepts `set_steering_mode` and `set_follow_up_mode` (`"all" | "one-at-a-time"`, applied to the
live session and persisted), and `get_state` returns both. The real gap is that **our ported Pi
RPC mirror is incomplete** — Pi accepts 35 request types and
`packages/server/src/server/agent/providers/pi/rpc-types.ts` mirrors only some of them, omitting
both setters — so the capability was unreachable, not absent. (The old name was `queueMode`, which
Pi migrates to `steeringMode`; that rename is why the first search missed it.)

T28B3 stays display-only, which is correct for its wave and is satisfied. The controls need daemon
plumbing first: T38B0a-c, then T38B1a/T38B1b. The wider mirror gap is T51A/T51B.

- [x] Queue depth and the steer/follow-up split are visible and update live from `pi_queue_update`
- [x] Queue state is conveyed in text, not colour alone
- [x] The display reflects the daemon's classification rather than asserting a client-side mode

#### T28B4 — Add slash-command completion

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T28B3`

Add slash-command completion driven by daemon-provided commands, using the CommandSearch recipe.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

- [ ] Completion lists daemon-provided commands, not a hard-coded set
- [ ] Keyboard selection and dismissal work correctly
- [ ] An unknown command submits as plain text rather than erroring

#### T28B5 — Add model and thinking-level selection

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T28B4`

Add model and thinking-level pickers reflecting and changing session state.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

- [ ] Changing model or thinking level round-trips and persists
- [ ] The current selection is visible without opening the picker
- [ ] Unavailable options are explained rather than silently missing

#### T28B6 — Add composer attachments

`labels: phase-4, area: web` · `wave: P4-W8` · `depends-on: T28B5`

Add attachment selection and upload through the core outbox.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

- [ ] An attachment uploads and appears on the submitted message
- [ ] Oversized or rejected attachments produce a clear error
- [ ] Attachments survive a reconnect mid-upload or fail explicitly

#### T28B7 — Build permission and approval dialogs

`labels: phase-4, area: web` · `wave: P4-W9` · `depends-on: T28B6`

Build the approval surface on the ApprovalForm recipe for permission requests.

Owns: `apps/web/src/features/approvals/`. No other task in this wave touches those files.

- [ ] A permission request can be approved and denied from the UI
- [ ] The decision round-trips and the turn continues correctly
- [ ] Dialogs trap focus and are dismissible by keyboard

#### T29A1 — Build the web renderer registry

`labels: phase-4, area: web` · `wave: P4-W2` · `depends-on: T21C, T25A`

Build the §11.4 registry: per-element error boundary, unknown-kind fallback, action state handling and payload caps.

Owns: `apps/web/src/features/extensions/registry*`. No other task in this wave touches those files.

- [ ] An element that throws is contained by its own boundary
- [ ] An unknown kind produces one visible diagnostic, not transcript text
- [ ] Oversized payloads are capped with an explanation

#### T29A2 — Render the status, widget, and progress kinds

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T29A1`

Render the three simplest bridge kinds from canonical fixtures.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] All three render from canonical-payload fixtures
- [ ] Progress conveys value in text as well as visually
- [ ] An asserted axe check passes

#### T29A3 — Render the log, markdown, and composer kinds

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T29A2`

Render the remaining three simple kinds, with markdown sanitised.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] All three render from canonical-payload fixtures
- [ ] Markdown is sanitised and cannot inject script or raw HTML
- [ ] Log output is bounded and scrollable

#### T29B1 — Render the roster kind

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T29A3`

Render roster rows with label, status, detail, progress and actions, using the TaskRows recipe.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] Roster rows render every documented field from fixtures
- [ ] Row status is conveyed in text as well as colour
- [ ] Row actions dispatch and show pending state
- [ ] The roster reconstructs after a reload from stored snapshots, with live data winning over history (ompweb review)

#### T29B2 — Render the form kind with action states

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T29B1`

Render form elements and submission, with pending, success and failure states.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] Forms render every documented field type from fixtures
- [ ] Pending, success and failure states are each visible
- [ ] Forms are keyboard operable and labelled

#### T29B3 — Render the diff kind

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T29B2`

Render the diff kind using the DiffSummary recipe and the shared highlighter.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] Diffs render from fixtures with correct add/remove counts
- [ ] Large diffs are bounded rather than dropped
- [ ] Counts use tabular mono figures

#### T29B4 — Render the panel kind composing other kinds

`labels: phase-4, area: web` · `wave: P4-W8` · `depends-on: T29B3`

Render panel, which composes other kinds, without unbounded recursion.

Owns: `apps/web/src/features/extensions/renderers/`. No other task in this wave touches those files.

- [ ] A panel renders nested kinds from fixtures
- [ ] Nesting depth is bounded with a visible diagnostic beyond the limit
- [ ] A failing child does not take down the panel

#### T29B5 — Add dangerous-action confirmation

`labels: phase-4, area: web` · `wave: P4-W9` · `depends-on: T29B4`

Require explicit confirmation for actions flagged dangerous.

Owns: `apps/web/src/features/extensions/`. No other task in this wave touches those files.

- [ ] A dangerous action cannot fire without confirmation
- [ ] The confirmation names the action and its consequence
- [ ] Non-dangerous actions are unaffected

#### T29R1 — Build the right extension rail container

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T27S1`

Build the rail container and the §11.5 placement rules that decide what appears there.

Owns: `apps/web/src/features/rail/`. No other task in this wave touches those files.

- [ ] The rail hosts elements per the §11.5 placement rules
- [ ] It collapses only when genuinely empty, never while content is live
- [ ] Rail content is reachable by keyboard

#### T29R2 — Show fleet, workflow, loop, and goal state in the rail

`labels: phase-4, area: web` · `wave: P4-W9` · `depends-on: T29R1, T29B1`

Surface subagent fleet, workflow progress, loop and goal state in the rail.

Owns: `apps/web/src/features/rail/`. No other task in this wave touches those files.

- [ ] Fleet, workflow, loop and goal state stay visible while active
- [ ] None of them collapse into a single status chip
- [ ] State updates live from published channels

#### T29C1 — Derive context-window and cache telemetry in core

`labels: phase-4, area: core` · `wave: P4-W2` · `depends-on: T24`

Derive context-window usage and cache-hit share from the protocol token fields, framework-neutral.

Owns: `packages/frontend-core/src/telemetry/`. No other task in this wave touches those files.

- [ ] Usage and cache share are derived from the protocol fields, not guessed
- [ ] Missing provider fields yield an explicit unknown rather than zero
- [ ] Covered by unit tests in plain Node

#### T29C2 — Render the context window and cache meter

`labels: phase-4, area: web` · `wave: P4-W10` · `depends-on: T29C1, T29R1`

Render the meter in the rail in the Beautiful UI language.

Owns: `apps/web/src/features/rail/`. No other task in this wave touches those files.

- [ ] Used/max and cache share render live and update per turn
- [ ] The unknown state is shown honestly rather than as zero
- [ ] Values use mono tabular figures and are announced to screen readers

#### T30A1 — Build the TerminalController in frontend-core

`labels: phase-4, area: core` · `wave: P4-W2` · `depends-on: T24`

Build the framework-neutral terminal controller over the binary channel, including backpressure accounting.

Owns: `packages/frontend-core/src/terminal/`. No other task in this wave touches those files.

- [ ] Data round-trips through the controller in plain Node tests
- [ ] Backpressure invariants hold under a flood fixture
- [ ] The purity guard still passes

#### T30A2 — Build the xterm terminal route

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T30A1, T27S2`

Mount xterm on the controller behind a lazily loaded route.

Owns: `apps/web/src/features/terminal/`. No other task in this wave touches those files.

- [ ] The terminal round-trips against a dev daemon
- [ ] The xterm chunk is lazily loaded and absent from the initial bundle
- [ ] The terminal is themed from design tokens

#### T30A3 — Honour terminal resize ownership and latency

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T30A2`

Match daemon resize-ownership semantics and keep latency inside budget.

Owns: `apps/web/src/features/terminal/`. No other task in this wave touches those files.

- [ ] Resize ownership matches daemon behaviour
- [ ] Latency stays within the §14.5 budget under test
- [ ] Disconnect and reconnect restore a usable terminal

#### T30B1 — Browse and list files over daemon RPC

`labels: phase-4, area: web` · `wave: P4-W3` · `depends-on: T27S2`

Build the file browser reading exclusively through daemon RPC.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Directory listing renders and navigates
- [ ] No direct filesystem or path access exists in the browser layer
- [ ] Permission and missing-path errors are explained

#### T30B2 — Read and display a file read-only

`labels: phase-4, area: web` · `wave: P4-W4` · `depends-on: T30B1`

Read a file and render it read-only with the CodeBlock primitive.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Text files render with correct highlighting
- [ ] Binary and oversized files are refused with an explanation
- [ ] Reads go through daemon RPC

#### T30B3 — Add the CodeMirror editor and save path

`labels: phase-4, area: web` · `wave: P4-W5` · `depends-on: T30B2`

Add editing and saving with CodeMirror.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] An edited file saves and reloads with the new content
- [ ] The editor chunk is lazily loaded
- [ ] A failed save keeps the buffer and explains the failure

#### T30B4 — Add file upload and download

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T30B3`

Add upload and download over daemon RPC.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Upload and download both round-trip against a dev daemon
- [ ] Progress is visible for large transfers
- [ ] Failures are recoverable without losing the selection

#### T30B5 — Add file search

`labels: phase-4, area: web` · `wave: P4-W7` · `depends-on: T30B4`

Add search across files using the SearchField primitive.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Search returns results and navigates to a hit
- [ ] Result count is bounded with an explicit truncation notice
- [ ] Search is keyboard operable

#### T30B6 — Add the file diff view

`labels: phase-4, area: web` · `wave: P4-W8` · `depends-on: T30B5`

Add a diff view for changed files and confirm chunk splitting.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Diffs render for a changed file
- [ ] The diff chunk is lazily loaded
- [ ] Large diffs are bounded rather than dropped

#### T31A — Build the Playwright harness and isolated daemon fixture

`labels: phase-4, area: web` · `wave: P4-W10` · `depends-on: T27A6, T27B6`

Build the E2E harness with a daemon fixture that is provably isolated from production.

Owns: `apps/web/e2e/`. No other task in this wave touches those files.

- [ ] The harness starts an isolated daemon on an ephemeral port
- [ ] A guard fails the run if port 6767 is ever targeted
- [ ] One smoke scenario passes end to end

#### T31B1 — Green the connect and deep-link restore scenarios

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/connect.spec.ts` and `apps/web/e2e/deep-link-restore.spec.ts` (plus `e2e/fixtures/connect-ui.ts`). No other task in this wave touches those files.

- [ ] A browser pairs with the isolated daemon through the real connect UI
- [ ] A cold full-page load straight at a session URL reconnects and restores that session
- [ ] No token or daemon key appears in a URL query string at any point

#### T31B2 — Green the session lifecycle scenario

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/session-lifecycle.spec.ts` (plus `e2e/fixtures/seed-session.ts`). No other task in this wave touches those files.

- [ ] A session is created from the UI against the live daemon, not only through a seeded RPC
- [ ] A turn runs end to end and its assistant text appears in the transcript
- [ ] The spec no longer documents the create-from-UI gap as known-broken, because T53A4 closed it

#### T31B3 — Green the steer and follow-up scenario

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/session-steer-and-follow-up.spec.ts`. No other task in this wave touches those files.

- [ ] A second submission while a turn is active is accepted as a steer or follow-up, not rejected
- [ ] The two routes are visibly distinguishable, per plan.md §12.3 and the queue-mode note in T38B0a
- [ ] The transcript shows the queued message once it runs

#### T31B4 — Green the transcript tool-call and diff scenario

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/transcript-tool-and-diff.spec.ts`. No other task in this wave touches those files.

- [ ] A tool call's collapsible input opens and closes
- [ ] A diff-bearing tool call renders its diff with add/remove counts
- [ ] Streamed assistant text arrives in order with no lost delta

#### T31B5 — Green the reconnect and catch-up scenario

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/reconnect-and-catch-up.spec.ts`. No other task in this wave touches those files.

- [ ] The session rail marks itself stale while offline
- [ ] It catches back up once reconnected, with no duplicated or dropped timeline rows
- [ ] Seeded sessions are actually visible in the rail (they are not today, which is half of why this spec fails)

#### T31B6 — Green the keyboard-navigation and axe scenario

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T31A, T53A4`

Split out of the original T31B, which bundled connect, session and transcript scenarios into one task. That task consumed 910k tokens without finishing, because the full E2E suite takes about 15 minutes per run and the agent was debugging on that feedback loop. **Run only your own spec file** while iterating; run the whole suite once at the end.

The spec already exists on `main` and currently FAILS. That failure is real and honest, not flaky: it documents that the app could not reach a live daemon. Fix the product or the spec as the criteria require — never by weakening an assertion or deleting the spec.

Owns: `apps/web/e2e/keyboard-navigation.spec.ts` (plus `e2e/fixtures/axe.ts`). No other task in this wave touches those files.

- [ ] The composer and session rail are fully keyboard operable with visible focus
- [ ] axe reports no violations on the assembled session screen in a real browser
- [ ] This is the first accessibility check running outside jsdom, so record any finding jsdom missed

#### T31C1 — Cover the approvals scenarios

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T31B2, T28B7, T29B5`

Split out of the original T31C, which bundled four scenario families into one task. Write this spec from scratch. Run only your own spec file while iterating; the full suite takes about 15 minutes.

Owns: `apps/web/e2e/approvals.spec.ts`. No other task in this wave touches those files.

- [ ] A blocking permission request appears and can be answered from the browser
- [ ] A dangerous action requires its explicit confirmation
- [ ] An answer from one client marks the request superseded for the other (plan.md §12.3)

#### T31C2 — Cover the Pi extension bridge scenarios

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T31B2, T29B5`

Split out of the original T31C, which bundled four scenario families into one task. Write this spec from scratch. Run only your own spec file while iterating; the full suite takes about 15 minutes.

Owns: `apps/web/e2e/extension-bridge.spec.ts`. No other task in this wave touches those files.

- [ ] A live Pi extension renders through the bridge into the extension rail
- [ ] An extension action round-trips to the daemon and back
- [ ] An unknown or malformed payload degrades visibly instead of crashing the rail

#### T31C3 — Cover the terminal scenarios

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T31B2, T53A5, T30A3`

Split out of the original T31C, which bundled four scenario families into one task. Write this spec from scratch. Run only your own spec file while iterating; the full suite takes about 15 minutes.

Owns: `apps/web/e2e/terminal.spec.ts`. No other task in this wave touches those files.

- [ ] A terminal session opens against the isolated daemon and echoes input
- [ ] Resize is owned by one side only, with no resize loop
- [ ] Closing the route disposes the terminal without leaking a process

#### T31C4 — Cover the file browser scenarios

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T31B2, T53A5, T30B6`

Split out of the original T31C, which bundled four scenario families into one task. Write this spec from scratch. Run only your own spec file while iterating; the full suite takes about 15 minutes.

Owns: `apps/web/e2e/files.spec.ts`. No other task in this wave touches those files.

- [ ] Browsing, opening and editing a file all round-trip over daemon RPC
- [ ] A path outside the allowed root is refused, and there is no second, weaker path that bypasses the check
- [ ] A large file degrades to a bounded view rather than freezing the browser

#### T31D — Enforce the performance budgets in CI

`labels: phase-4, area: ci` · `wave: P4-W13` · `depends-on: T31C1, T31C2, T31C3, T31C4`

Measure and enforce the §14.5 budgets as a CI gate.

Owns: `apps/web/e2e/` (the budget measurement harness) and the `web-tests` job in
`.github/workflows/ci.yml`. No other task in this wave touches those files.

**CI has never actually run the E2E suite.** Both Playwright steps in `web-tests` are guarded
on `hashFiles('apps/web/playwright.config.ts')`, but the config lives at
`apps/web/e2e/playwright.config.ts`. The guard has always evaluated false, so both steps are
silent no-ops and their "documented no-op until T31 lands" comment is stale — T31 landed.
Fixing that guard is part of this task: a performance gate layered on a suite that never runs
would be a gate over nothing.

- [ ] The Playwright steps in `web-tests` actually run, with the guard corrected or removed
- [ ] The session route stays within 500 KiB gzip and the check fails when exceeded
- [ ] Event-to-paint p95 stays within 100 ms
- [ ] Budget failures are reported with the measured number

**This task cannot be run.** No git remote may ever be added and no local runner is installed,
so no agent can execute the workflow. The budget _measurement_ is locally verifiable — run it
against a real build and report real numbers. The CI wiring is not. Say which is which in the
report; do not claim a green CI gate.

### Phase 5 — Android vertical slice

#### T32S1 — Build the Android navigation shell

`labels: phase-5, area: android` · `wave: P5-W1` · `depends-on: T24, T26A`

Build the Expo Router structure and the §9.2 compact shell with named slots later tasks fill.

Owns: `apps/android/src/app/` layout, providers, and empty named slots only (no per-feature
route files — see T32S1C). No other task in this wave touches those files.

- [ ] The shell renders with empty slots on the emulator
- [ ] Navigation between top-level destinations works
- [ ] No .web.\* file and no web-only import is introduced

#### T32S1B — Wire lifecycle events into the resume controller

`labels: phase-5, area: android` · `wave: P5-W2` · `depends-on: T32S1, T46A2`

Split out of the original T32S1, whose fourth criterion (added in the ompweb review) wired an
unrelated, independently verifiable concern — app foreground/connectivity events feeding the
T46A2 resume controller — into the navigation-shell scaffolding task. Foreground and
connectivity churn is constant on Android, so this is real work, just not nav-shell work.

Owns: `apps/android/src/app/`. No other task in this wave touches those files.

- [ ] Foreground and connectivity changes feed the T46A2 resume controller

#### T58C — Make the browser validator fix apply to the Android bundle too

`labels: phase-5, area: android` · `wave: P5-W2` · `depends-on: T58B`

**T58B's fix does not protect Android, and the failure is silent.** T58B kept the 12,346,977-byte
generated `ws-outbound.aot.js` out of browser builds by adding a `"browser"` condition to
`packages/protocol/package.json`'s `./validation/ws-outbound` subpath. Vite resolves `"browser"`
by default. **Metro does not.** Its default `unstable_conditionNames` is
`["require", "import", "react-native"]`, and `apps/android/metro.config.js` does not override it,
so Metro resolves `"default"` — the AOT file.

Nothing is broken today only because no Android module imports `@picompanion/client`
(verified: zero matches under `apps/android/`). `T32A1`-`T32A6` will, at `P5-W4`. **This task
must land before then**, which is why it sits at W2 rather than being deferred.

The measurement to make: import `@picompanion/client` from a throwaway Android module, run
`npm run export --workspace=@picompanion/android`, and grep the output bundle for
`AUTO-GENERATED by zod-aot`. That is the same proof T58B used for the web build
(`grep -rl "AUTO-GENERATED by zod-aot" apps/web/dist/` returning nothing).

Two candidate fixes, both cheap — measure, then pick one and say why:

- Add `"browser"` to `config.resolver.unstable_conditionNames` in `apps/android/metro.config.js`.
  Widest blast radius: it changes resolution for **every** dependency, not just ours, and a
  React Native app is not a browser, so any package whose `"browser"` entry assumes DOM globals
  would newly resolve to it.
- Add a `"react-native"` condition beside `"browser"` on protocol's `./validation/ws-outbound`
  subpath, pointing at the same `ws-outbound.browser.js`. Narrower and explicit, but it only
  fixes this one subpath — every future `"browser"`-conditioned export needs the same treatment.

Owns: `apps/android/metro.config.js` and `packages/protocol/package.json`. No other task in this
wave touches those files.

- [ ] An Android bundle that imports `@picompanion/client` provably does not contain the AOT
      artifact, proven by grepping a real `expo export` output, with the command and its result
      in the commit message
- [ ] Outbound validation still runs in the Android bundle — the fix routes to a real validator,
      not to nothing. A test asserts the Android-resolved validator rejects the same envelopes
      the Node one rejects
- [ ] The Node/daemon path still resolves the AOT file, verified by `require.resolve`
- [ ] `apps/web`'s session-route bundle budget still passes, unchanged
- [ ] Whichever option is chosen, the rejected one is recorded with the measured reason

#### T32S1C — Register Phase-5 route stubs for every feature family

`labels: phase-5, area: android` · `wave: P5-W3` · `depends-on: T32S1B`

Every Phase 5 feature family (connect, sessions, transcript/session-detail, files, terminal,
notifications/settings) needs a reachable Expo Router route inside `apps/android/src/app/`
before its screens are visible on the emulator. T32S1 built the shell "with named slots";
without a task that owns filling those slots with stub files, each family's own task would be
tempted to add its own route file into that same directory the moment it starts — the exact
shared-file collision already logged for Phase 4's E2E fixtures (see "Sizing and collision
rules", "three sibling E2E tasks... all needed to extend one SHARED fixture file that no task
owned"). This task creates every stub route up front so every downstream feature task only
ever adds files inside its own `apps/android/src/features/*` subtree, never inside
`apps/android/src/app/`.

Owns: `apps/android/src/app/`. No other task in this wave, or in any later Phase 5 wave,
touches those files.

- [ ] A stub route exists for every Phase 5 destination (connect, sessions, session detail,
      files, terminal, notifications/settings) and each renders a placeholder
- [ ] Every stub imports its screen component from the matching `apps/android/src/features/*`
      directory rather than containing feature logic itself
- [ ] No Phase 5 task **concurrent with** this one is listed as owning
      `apps/android/src/app/`. T32S2 (P5-W6) does own it, deliberately and later — it
      is this task's direct dependant, so serial ownership of the same directory is
      correct, not a collision. This criterion is about the wave, not the phase.
- [ ] **`apps/android/app/` is deleted, or its four files are moved into
      `apps/android/src/app/`.** Expo Router selects `src/app` as its root because that
      directory exists (`@expo/cli` `router.js:125-133`), so `apps/android/app/_layout.tsx`,
      `index.tsx`, `dev/component-lab.tsx` and `dev/recipe-lab.tsx` are never bundled and
      silently do nothing. Surfaced by T58C, whose first measurement probe measured nothing
      for exactly this reason. This task owns the router root, so it owns this
- [ ] **T32S1's open second criterion is closed here.** T32S1 shipped
      `apps/android/src/app/top-level-destinations.ts` (`TOP_LEVEL_DESTINATIONS`,
      `destinationHref`) and `compact-shell.tsx` (`CompactSessionShell`) with **no production
      consumer** — its own scope forbade creating the route files that would use them, so
      "Navigation between top-level destinations works" could not be satisfied and was left
      open on purpose. The stubs this task creates must actually consume those exports, and
      navigating between `sessionList` and `settings` must work. Until then that code is dead
      and the shell is unproven.

#### T32S2 — Add deep links and cold-start routing

`labels: phase-5, area: android` · `wave: P5-W6` · `depends-on: T32S1C`

Handle deep links and cold-start routing into a specific session.

Owns: `apps/android/src/app/`. No other task in this wave touches those files.

**Ten non-route modules under the router root are silently registered as routes, and this
task owns the fix.** T32S1C folded `apps/android/app/` into `apps/android/src/app/` on the
correct premise that `@expo/cli` prefers `src/app` — but it moved the routes _in_ rather than
moving the non-routes _out_. Expo Router's context module matches every `.ts`/`.tsx` under the
router root:

```js
// apps/android/node_modules/expo-router/_ctx.android.js
require.context(process.env.EXPO_ROUTER_APP_ROOT, true,
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.ios|\.web)?\.[tj]sx?$/, ...)
```

so `compact-shell-slots.ts`, `compact-shell.tsx`, `core-context.tsx`, `core.ts`,
`error-boundary.tsx`, `host-tabs.ts`, `navigation-shell.tsx`, `resume-signals.ts`,
`route-placeholder.tsx` and `top-level-destinations.ts` each become a route node with no
default export. Per `getRoutesCore.js:302-313` that logs `Route "..." is missing the required
default export` **only when `NODE_ENV === 'development'`**; in a production bundle the nodes
stay in the route tree and the linking config, and `app.config.ts`'s
`experiments.typedRoutes: true` emits `/core`, `/host-tabs`, `/route-placeholder` and the rest
into the generated route-type union — which this task's own deep-link work then has to route
around.

**No CI gate catches this.** The Android CI build is `expo prebuild`, which does not bundle, so
every gate on T32S1C was green. Test files under the same root are already handled — T58C's
`TEST_FILE_BLOCK_PATTERN` in `metro.config.js` blocks them, and its comment documents exactly
this class of problem for tests but not for source modules. Two candidate fixes: move the ten
into a non-router directory (`apps/android/src/app-shell/`, updating importers), or extend the
Metro blockList the way T58C did for tests. Measure which one leaves `typedRoutes` clean and
say why.

**This task also owns the mount seam nobody was assigned** (found at the `P5-W4` merge gate).
`T33A1` shipped `features/transcript/` and `T33B1` shipped `features/composer/`, both with
all-required props and no context read, so the session route cannot mount them as written.
`npx knip` reports six files as entirely unused: `composer/{Composer.tsx,
composer-icon-action.tsx,index.ts}` and `transcript/{header.tsx,index.ts,status-strip.tsx}`.
`T33A2` owns `features/transcript/` and `T33B2` owns `features/composer/`, but the mount point
is `src/app/h/[serverId]/session/[agentId]/index.tsx`, which is **this** task's territory —
so no task's `Owns` grant covered "mount the header into the session route" and all three
could assume another would do it. Half of `P5-W4` is dead code until this lands.

That same file's doc comment asserts `T33A1` and `T33B1` "each read `useLocalSearchParams`
themselves once they have a live session." Neither does; both are pure prop-driven. Correct
the comment rather than leaving a false claim in the tree.

- [ ] `TranscriptHeader`, `TranscriptStatusStrip` and `Composer` are mounted in the session
      route and `npx knip` no longer reports any file under `features/transcript/` or
      `features/composer/` as unused
- [ ] The session route's doc comment describes how those components actually receive data
- [ ] No module under the Expo Router root is registered as a route unless it is one — proven
      by a test or a generated-types assertion, not by reading the directory
- [ ] A deep link opens the right destination from cold start
- [ ] An invalid link lands on a explained fallback screen
- [ ] Cold start does not flash the wrong screen first

#### T32S3 - Own the Android router root for the rest of Phase 5

`labels: phase-5, area: android` · `wave: P5-W7` · `depends-on: T32S2, T32B3, T33A2`

**`apps/android/src/app/` has no owner left, and six real defects live in it.** T32S1C's grant
says "No other task in this wave, or in any later Phase 5 wave, touches those files", naming
T32S2 as the single deliberate later owner. T32S2 has shipped. Every remaining fix whose code
sits in the router root is therefore unassignable, and the P5-W6 merge gate found six of them.
This task exists to hold that directory for the rest of the phase, and to close all six.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`, and `apps/android/src/platform/`
(for the reachability adapter in item 5). No other task in this wave touches those files. **Any
later Phase 5 task that needs a change under the router root files it against this task rather
than editing it.**

**(1) The `transcript` slot is empty - a verbatim repeat of the defect T32S2 was created to
fix.** T33A2 built `TranscriptMessageRow` and `createTranscriptMessageBatcher` in
`features/transcript/`; nothing renders either. `npx knip` clears the _files_ only because the
session route imports the barrel, but both symbols are still listed under unused _exports_. The
`liveExtension` slot is likewise `null` - that one is T34A4's content, but this task owns the
mount point.

**(2) Four modules still register as broken route nodes.** T32S2 moved six of the ten out to
`src/app-shell/` (`compact-shell-slots`, `compact-shell`, `error-boundary`, `host-tabs`,
`navigation-shell`, `top-level-destinations`) and correctly rejected the Metro-blockList option:
`metro.config.js`'s `blockList` governs only Metro's resolver, while the typed-routes union
comes from `require-context-ponyfill.js`'s own `node:fs` walk, which is blockList-independent.
Four remain, because `features/connect`, `features/files` and `features/terminal` import them
and T32S2 could not edit those directories: `core.ts`, `core-context.tsx`, `resume-signals.ts`,
`route-placeholder.tsx`. They sit in T32S2's `KNOWN_NON_ROUTE_EXCEPTIONS` list. Finish the move
and delete the exception list. Verify the way the P5-W6 gate did - by running expo-router's real
`EXPO_ROUTER_CTX_IGNORE` from `expo-router/_ctx-shared` over the live filesystem - not by
reading the directory.

**(3) Cold start unconditionally redirects to `/connect`.** `src/app/index.tsx` `<Redirect>`s
regardless of any stored connection, so T32S2's own criterion "Cold start does not flash the
wrong screen first" is not met. The obstacle is real and disclosed: `SecureStorage` is async and
cannot resolve before the first synchronous paint. The fix is a resolved/unresolved gate in
`AppCoreProvider` that renders nothing (or a neutral splash) until the stored profile read
settles.

**(4) `sessions.tsx` passes neither `sessionService` nor `keyValueStorage` to `SessionsScreen`,
so T32B3's cold-start restore and resume controller are dead at runtime** - the screen's own
`if (!sessionService) return null` guard fires. This blocks **T37E2** ("Cold start into the last
opened session passes on the reference emulator"), which depends on T32B3 and T32S2 and will
fail as currently wired. Supply both from `AppCore`.

**(5) `FakeNetworkReachability` is on the resume production path.** T32A1B took it off the
connect-status path while T32B3 simultaneously made `AppCore.attachResumeSignals` live via
`useResumeSignals` at `sessions-screen.tsx:201` - and that consumes `AppCore.network`, which is
still the fake. Resume signals therefore see an always-online adapter: `network-online` and
`network-path-change` can never fire. Replace it with a real reachability adapter under
`src/platform/`. **T32B5 ("Survive network path switches", P5-W8) cannot meet its criteria until
this lands**, and T32B5's own grant covers only `features/sessions/`, so it cannot do this
itself. `debugToggleConnection` in `core.ts` exists only to drive the fake; remove it with the
fake, and check for callers first.

**(6) The session route's `status` is a hardcoded literal.** Both halves of the real plumbing
now exist - `DaemonConnectionStore` (T32A1B) exposes the live phase and `deriveTranscriptStatus`
(T33A1) accepts exactly that union - but nothing joins them, because the store is scoped inside
`ConnectionShell`'s `useMemo` rather than app-wide. Lifting it into `AppCore` is this task's call
to make; if you decide it belongs in `features/connect/` instead, say so and file it there.

- [ ] Running expo-router's real `EXPO_ROUTER_CTX_IGNORE` walk over the live filesystem finds
      zero modules without a default export under the router root, and
      `KNOWN_NON_ROUTE_EXCEPTIONS` is deleted rather than extended
- [ ] The session route renders `TranscriptMessageRow` through `createTranscriptMessageBatcher`;
      `npx knip` no longer lists either under unused exports
- [ ] Cold start with a stored profile lands on the session, not on `/connect`, and renders
      nothing rather than the wrong screen while the async read settles
- [ ] `SessionsScreen` receives a real `sessionService` and `keyValueStorage`, and its
      `if (!sessionService) return null` guard is no longer what production hits
- [ ] `AppCore.network` is a real reachability adapter; `FakeNetworkReachability` and
      `debugToggleConnection` are gone, with no remaining importer
- [ ] The session route's connection status comes from the live `DaemonConnectionStore`, not a
      literal
- [ ] Every criterion above is proven by a test, not by reading the file. On-device cold start
      remains T37E2's and T59's to prove

#### T32S7 - Mount wave P5-W10's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W11` · `depends-on: T32S6, T33B5, T35A2, T37B`

**The standing one-wave-behind mount role, third instance.** T32S6 (P5-W10) did its job: it
mounted `<PortalHost>` at `app-shell/navigation-shell.tsx` and put `TranscriptToolCallRow` on the
live transcript path, and it correctly changed nothing at the two construction sites blocked on
an install. And, exactly as structure predicts, **two of P5-W10's six deliverables shipped with
no live importer**, because a task cannot mount what a sibling is writing beside it.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`. **Any later Phase 5 task needing a
change under the router root files it here rather than editing it.**

**(1) The file read path is dead in the live app, and this is the cheapest real defect open.**
`core.ts`'s `fileBrowserClient` object literal (around `core.ts:288`) forwards `listDirectory`
only, so `readFile` is `undefined` and every file open renders "Not connected" while listing
works. T35A2's read path - daemon RPC, real Lezer highlighting, binary/oversize/vanished refusals

- is fully unit-proven and completely unreachable. `getFileBrowserDaemonClient()` already casts to
  `FileBrowserClient`; this is a ~5-line forward plus one `core.ts` test.

**(2) `features/approvals/` has no live importer.** T33B5 shipped `ApprovalsContainer`,
`ApprovalsHost`, `use-approvals-queue` and the barrel; `npx knip` lists all four as unused files.
Mounting it needs a documented cast: `DaemonClientLike` in
`packages/frontend-core/src/connection/daemon-client-lifecycle.ts` has six members and neither
`respondToPermission` nor `on(...)`, although the runtime `DaemonClient` has both
(`packages/client/src/daemon-client.ts:4728`). Widening that interface is `frontend-core`'s, not
this task's - **cast with a comment naming the gap, and file the widening.**

**(3) `platform/offline/` has no importer, two waves running.** T37A built the cache, T37B the
staleness model and catch-up reconciliation. Full construction is still blocked on `expo-sqlite`,
but **the announcement half is not blocked**: `describeSessionListStaleness` needs no driver.
T32B6 is wiring the session-list side in this same wave; take the timeline/transcript side or
say plainly that you left it to T32B6.

**(4) `NativeNetworkReachability` is unmounted for a third wave**, still blocked on:

```
npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1
```

Same rule as always: if it is not installed, **change nothing and report the command**. T32B6
needs the same package this wave - coordinate rather than both editing `core.ts`.

- [ ] `readFile` is forwarded to `FilesScreen` and a file open reaches T35A2's real read path
- [ ] `features/approvals/` has a live importer, or the exact blocker is named
- [ ] The staleness announcement reaches a surface, or the task that must render it is named
- [ ] For the blocked installs: either installed and switched, or nothing changed and the exact
      command reported
- [ ] **No deliverable from wave P5-W10 is left without a mount that this task did not either
      complete or name with its specific blocker**
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and no
      source-text assertion reads raw file text - use the comment-stripped `readCode()` pattern

#### T60B - Declare and pre-build the workspace packages apps/android imports

`labels: phase-5, area: core` · `wave: P5-W11` · `depends-on: T35A2`

**A near-miss CI break, caught only because the P5-W10 merge gate re-ran the gates against a
simulated clean checkout instead of trusting a green local run.** T35A2 made `apps/android` the
first Android importer of `@picompanion/highlight`. That package's `exports` resolve `types` to
`./dist/index.d.ts` and `default` to `./dist/*.js` - **built output, never source**, with no
tsconfig `paths` and no vitest alias. Nothing in CI or in `apps/android`'s own scripts built it,
so a clean checkout failed both the typecheck and the unit-test step:

```
error TS2307: Cannot find module '@picompanion/highlight' or its corresponding type declarations.
Error: Cannot find package '@picompanion/highlight/lezer-only'
```

It passed locally only because developer trees already carried a stale `packages/highlight/dist`.
The build-ordering half is fixed (`10fe6b0`), in `.github/workflows/ci.yml`'s `android-tests` job
and in all four `apps/android` scripts that pre-build workspace packages.

**The declaration half is still open and needs the `npm install` P5-W10 was forbidden.**
`@picompanion/highlight` is imported at `features/files/file-syntax-highlight.ts` but absent from
`apps/android/package.json`'s dependencies - it resolves purely by root hoisting, which Metro and
an EAS production bundle do not owe anyone.

Owns: `apps/android/package.json`, `package-lock.json`, and the equivalent audit for `apps/web`.

- [ ] Every workspace package `apps/android` imports is declared in its `dependencies`, verified
      by walking the real import graph rather than by reading the manifest
- [ ] `apps/web` gets the same audit; any undeclared workspace import there is declared too
- [ ] A guard or CI step fails when a workspace package is imported but undeclared, so the next
      one is caught by a gate rather than by a merge gate's manual probe
- [ ] `npm ci && npm run typecheck --workspace=@picompanion/android` passes from a tree with
      every `packages/*/dist` removed

#### T32S8 - Mount wave P5-W11's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W12` · `depends-on: T32S7, T32B6, T34A6`

**The standing one-wave-behind mount role, fourth instance - and the first where the predecessor
dropped handoffs that were not blocked.** T32S7 (P5-W11) closed the two items that mattered most:
`core.ts`'s `fileBrowserClient` now forwards `readFile`, so T35A2's entire unit-proven read path
is reachable from a file open for the first time, and `features/approvals/` is mounted in the
session route. It also correctly changed nothing at the netinfo construction site.

**But two named, unblocked one-liners were filed into its grant during the wave and neither was
picked up**, and T32S7's report does not mention either. Both are yours, and both are cheap.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

**(1) `network={core.network}` at `app/h/[serverId]/(tabs)/sessions.tsx`.** One line. T32B6
(P5-W11) wired `SessionListNetworkSync`, the connection-path label and T37B's staleness
announcement into `sessions-screen.tsx`, all reachable only through a `network` prop the route
never passes - so `listState.stale` is never set, `SessionListNetworkSync` is never constructed,
and three of T32B6's four criteria are correct in the screen and inert in production. **This is
not blocked on anything**: `core.network` is a real, already-constructed adapter. T32B6 filed it
by name in its report and in two doc comments rather than reaching across the boundary, which is
exactly right - and then it sat.

**(2) `client.on("agent_stream", ...)` in `core.ts`, plus the same subscription's
`batcher.push(...)` in the session route.** T34A6 (P5-W11) built `ingestPiUiAgentStreamMessage`,
proved it against a scripted wire-shaped feed, and wrote the missing subscription out in full in
its own doc comment. There is no `client.on("agent_stream", ...)` anywhere in `apps/android`, so
the Pi UI store is still permanently empty and `createTranscriptMessageBatcher` still receives
nothing. **One subscription closes both, and it also feeds T34B3's `DiffRenderer`, which is
registered on the live path and has never had an element arrive.**

**(3) `sessions.tsx`'s doc comment is stale.** It still tells readers "nothing has connected
`AppCore.connection` to a real `ConnectForm` submission yet", which T32A4 closed in P5-W9 and
which `core.ts` itself now contradicts. Pre-existing staleness inside your own grant.

**(4) `NativeNetworkReachability` and the offline cache are unmounted for a fourth wave**, both
blocked on installs. **T60C runs in this same wave to unblock them.** If T60C has landed when you
start, switch both construction sites; if it has not, change nothing and say so.

- [ ] `sessions.tsx` passes `network={core.network}`, and a path switch reaches
      `SessionListNetworkSync` on the live path
- [ ] A live `agent_stream` message reaches `piUiSession.store` and the transcript batcher through
      one subscription, proven against a scripted fake client rather than a real socket
- [ ] **No deliverable from wave P5-W11 is left without a mount that this task did not either
      complete or name with its specific blocker**
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and every
      prohibition over source text reads the comment-stripped `readCode()`, never raw `source`

#### T60C - Declare the undeclared dependencies and unblock three stalled adapters

`labels: phase-5, area: core` · `wave: P5-W16` · `depends-on: T60B, T32P1, T37A`

**Do not launch this task until the user has granted an `npm install` window.** Every other task
in Phase 5 is explicitly forbidden to run `npm install`, and that rule has held - no agent has
vendored, stubbed, or hand-added a package in eleven waves. The consequence is that four separate
pieces of finished, tested work are now stalled behind the same missing grant, and **CI is red**.

**(1) CI's `typecheck` job fails today.** T60B's guard (P5-W11) does exactly what it was built to
do: `@picompanion/highlight` is imported at `features/files/file-syntax-highlight.ts` but absent
from `apps/android/package.json`, resolving purely by root hoisting - which Metro and an EAS
production bundle do not owe anyone. The guard is red on arrival, by design, and was **not**
weakened to pass.

```
npm install @picompanion/highlight@0.3.0-beta.2 --workspace=@picompanion/android --save-exact
```

**(2) `NativeNetworkReachability` has been unmounted for three consecutive waves** (P5-W9, W10,
W11). T32P1 built it behind an injected `NetInfoModule` port; `core.ts` still builds
`createPollingNetworkReachability`, whose `kind` can only ever be `"unknown"`/`"none"`, with
`getProbeUrl` hardcoded to `() => null`.

```
npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1
```

**(3) The offline cache has been unconstructed for three consecutive waves.** T37A built
`SqliteStructuredStorage` behind an injected `SqliteDriver` port with a real bound policy; T37B
added catch-up reconciliation proven idempotent in both directions. Nothing constructs it. Use
the version `expo/bundledNativeModules.json` pins.

**(3b) T37C's process-death recovery is blocked by the same missing driver.** T37C (P5-W13)
built `createTurnOutbox`/`recoverInFlightTurns`, proved all three kill windows (pending,
sending-unverified, already-sent-and-deleted), proved replay idempotent, and proved no row escapes
as `"sending"`. Nothing can construct it until `expo-sqlite` lands.

**(3c) P5-W14 added three more, all in one wave.** T36A's push registration needs
`expo-notifications` and `expo-device`; T32P2's file-picker and sharing adapters need
`expo-document-picker`/`expo-image-picker` and `expo-sharing`. Without them
`features/notifications/` and `features/share/` both sit under `knip`'s Unused files, and
`FilesScreen`'s four transfer props stay unforwarded, so T35A4's upload and download panels never
render. **Use the versions `node_modules/expo/bundledNativeModules.json` pins.**

**(4) The terminal renders a themed `EmptyState` instead of a terminal.** T35B1 built the wrapper
behind an injected WebView port and proved every rule against a scripted fake.

```
npm install --workspace=@picompanion/android react-native-webview@13.16.1
```

Owns: `apps/android/package.json`, `package-lock.json`, and nothing else. **Switching the
construction sites is the router root's, not yours** - land the installs, then T32S8 switches
them.

- [ ] `npm ci && node scripts/ci/run-guard-declared-workspace-deps.mjs` exits 0 for both apps
- [ ] `npm ci && npm run typecheck --workspace=@picompanion/android` passes from a tree with
      every `packages/*/dist` removed
- [ ] Each install is a separate commit, so any one can be reverted without the others
- [ ] The three native modules are declared but **not** wired here; the exact construction-site
      changes T32S8 must make are written down

#### T32S9 - Mount wave P5-W12's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T32S8, T33B6, T35B2`

**The standing one-wave-behind mount role, fifth instance - and the first where the predecessor
landed everything filed against it.** T32S8 (P5-W12) closed both of the one-liners its own
predecessor had dropped: `sessions.tsx:46` passes `network={core.network}`, and `core.ts:354` has
a real `client.on("agent_stream", ...)` whose handler feeds `ingestPiUiAgentStreamMessage`
unconditionally and then fans out to `agentStreamListeners`, which the session route consumes as
`core.subscribeAgentStream((message) => batcher.push(message))`. One `on()` call, both consumers.
It also rewrote its own stale doc comment and correctly changed nothing at the blocked
construction sites.

**The wave still produced one inert deliverable and one gap of a new kind. Both are yours.**

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`, and - **this wave only, because
nothing else in P5-W13 touches it** - `apps/android/src/features/approvals/` for the haptic
trigger in item (1).

**(1) T33B6's haptics module has no importer at all.** `npx knip` lists
`platform/haptics/index.ts` under **Unused files** - the only `apps/android` entry there. The
module is finished and unit-proven against a scripted `VibrationPlatform`: four §9.3 patterns,
a suppression gate, and a trigger API that requires the caller to name the visible signal it
accompanies. **Nothing is blocked** - `expo-haptics` is absent but React Native's own `Vibration`
is present and `createRNVibrationPlatform()` already wraps it. Construct it once in `core.ts`,
thread it through `AppCore`, and fire `approval`/`blocked` from `features/approvals/`. **The
`finished`/`error` triggers belong to `features/transcript/`, which is T33A6's grant this wave -
file that seam with the exact code rather than reaching across it, and say in your report that
you did.**

**(2) `haptic.ts`'s suppression gate is advisory, not structural**, and the P5-W12 merge gate
corrected the comment that claimed otherwise: `createRNVibrationPlatform()` is re-exported from
the barrel and its returned object exposes a public `vibrate(pattern)`, so a call site can reach
the platform without passing through `fireHaptic`. Harmless while no call site exists - **you are
about to create the first ones.** Either route every one of them through `fireHaptic` and say so,
or make the bypass impossible.

**(3) Registration is not receipt - a new gap class worth remembering.** T34B3 registered
`DiffRenderer` on the live path in P5-W11 and `registry-index.test.ts` proved
`piUiRendererRegistry.has("diff")`, yet no `kind: "diff"` element had ever reached it: every
fixture in two waves used `kind: "widget"`. The P5-W12 merge gate closed it with one test driving
a real diff element from a scripted `agent_stream` message through the store and the visibility
gate to an `"ok"` render decision. **When you mount something, assert that a value of its own kind
actually arrives, not that the wiring exists.**

**(4) T35B2's `TerminalOutputBuffer` is reachable but inert, and this one IS blocked.**
`TerminalScreen` is mounted at `session/[agentId]/terminal/[terminalId].tsx` and constructs
`TerminalSessionController`, but with `createNotConnectedTerminalBinaryTransport()` and
`createUnavailableTerminalWebViewPort()`. Blocked on `react-native-webview`, which T60C holds.
**Change nothing there and say so.**

**(5) `NativeNetworkReachability` and the offline cache are unmounted for a fifth wave**, both
blocked on the same ungranted `npm install` window. `core.ts` still builds
`createPollingNetworkReachability` with `getProbeUrl` hardcoded to `() => null`, and nothing
constructs `SqliteStructuredStorage`. **Change nothing there and say so.**

- [ ] The four §9.3 haptic triggers fire from real call sites, with the platform constructed once
      in `core.ts`, or the exact task that must own each remaining trigger is named
- [ ] No deliverable from wave P5-W12 is left without a mount that this task did not either
      complete or name with its specific blocker
- [ ] Every mount this task adds is proven by a test asserting that a value of the mounted kind
      actually arrives, not that the registration or the prop exists
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and every
      prohibition over source text reads the comment-stripped `readCode()`, never raw `source`

#### T32S10 - Mount wave P5-W13's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W14` · `depends-on: T32S9, T32A6, T33A6`

**The standing one-wave-behind mount role, sixth instance.** T32S9 (P5-W13) constructed
`createRNVibrationPlatform()` once in `core.ts`, threaded it onto `AppCore.vibrationPlatform`, and
fired `approval`/`blocked` from `features/approvals/` through `fireHaptic` - with zero `.vibrate(`
call sites anywhere outside `haptic.ts`, so the advisory suppression gate is honoured in practice.

**What P5-W13 taught, and what this task exists to prevent: seam ping-pong.** T32S9 filed the
`finished`/`error` triggers at `features/transcript/`; T33A6 built them, filed the mount back at
`app/`, and **neither could close it** - T33A6's commit landed after T32S9's, so T32S9 could not
take a seam that did not yet exist, and T33A6 could not reach the route. The module shipped with
no importer at all, and the merge gate mounted it. The same ordering left `Composer` with no
`sessionId`, keying **every** outbox entry `"local"`. **When a seam is filed at you by a task that
commits after you do, it is still yours the next wave. Read the previous wave's merge-gate
findings, not only the tasks' own reports.**

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

**(1) `OnboardingGate` has no live importer.** T32A6 built the gate, `createOnboardingController`,
`describeCameraPermissionRecovery` and an injected permissions port, all unit-proven: fresh
storage runs onboarding, a completed flag skips it, a half-finished run resumes, a storage read
failure does **not** silently skip. `app/connect.tsx` still renders a bare `ConnectionShell`.
**Nothing is blocked** - the gate takes `AppCore.keyValueStorage`, which already exists. T32A6
estimated four lines.

**(2) `TranscriptWindowList` has no live importer.** T33A6 built the bounded window and proved it
with concrete numbers - a 10,000-row session retains 50 rows with `hiddenOlderCount` 9,950, and a
5,000-append flood retains 25 with `unreadCount` 5,000 - plus follow-tail interleavings. The
session route still renders a plain `ScrollView` over `entries.map`. T33A6 confirmed the swap is a
drop-in: `renderRow` delegates entirely to the caller's existing per-kind switch and preserves the
`session-transcript-row-${id}` test ids byte-for-byte, so T33A5's images, attachments, diffs and
their accessible names survive unchanged. **Prove that they do.**

**(3) The blocked construction sites, unchanged.** `core.ts` still builds
`createPollingNetworkReachability` with `getProbeUrl` hardcoded to `() => null`
(`NativeNetworkReachability`, unmounted since P5-W9); nothing constructs `SqliteStructuredStorage`
(unmounted since P5-W9), which also blocks T37C's `createTurnOutbox`/`recoverInFlightTurns`; and
the terminal is still on `createNotConnectedTerminalBinaryTransport()` +
`createUnavailableTerminalWebViewPort()` (unmounted since P5-W10). **T60C runs in this same wave.
If it has landed when you start, switch all three; if it has not, change nothing and say so.**

**(4) Both haptic call sites hardcode `hapticsEnabled: true`** because no settings surface exists
anywhere in `apps/android`. **T32C1 owns building one** - do not invent a private toggle here.

- [ ] `OnboardingGate` and `TranscriptWindowList` each have a live importer, proven by a test
      asserting the mounted behaviour actually occurs, not that the import exists
- [ ] T33A5's image, attachment and diff rows still render inside the window with their
      accessible names intact
- [ ] **No deliverable from wave P5-W13 is left without a mount that this task did not either
      complete or name with its specific blocker** - including any seam the P5-W13 merge gate
      recorded rather than a task's own report
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and every
      prohibition over source text reads the comment-stripped `readCode()`, never raw `source`

#### T32C1 - Add the Android settings screen

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T32S10, T33B6`

**There is no settings surface anywhere in `apps/android`, and two shipped features are hardcoded
around its absence.** `features/approvals/use-approvals-queue.ts` and
`features/transcript/transcript-status-haptics-model.ts` both pass `hapticsEnabled: true` as a
literal, each with a doc comment saying a future settings task owns threading a real toggle down
to both call sites at once. This is that task.

Owns: `apps/android/src/features/settings/` (create it). The route entry and any `AppCore`
threading belong to the router-root owner - **file those seams with exact code rather than
editing `app/` or `app-shell/` yourself.**

Read plan.md's settings section with sed -n, and `apps/web/src`'s settings surface if one exists,
before designing - match its vocabulary rather than inventing a second one.

- [ ] Haptics can be turned off, and both existing call sites read that value rather than a
      hardcoded `true`, proven by a test asserting a suppressed trigger reaches the platform
      zero times through the real call path
- [ ] Every setting persists through `AppCore.keyValueStorage`, survives a cold start, and has a
      defined value when storage is empty or fails to read
- [ ] No setting is written to plain storage if it is secret-shaped; use `frontend-core`'s
      `security/` helpers rather than a private pattern list
- [ ] The screen has a live importer, or the exact task that must mount it is named

#### T60D - Unify the two Android permission-recovery vocabularies

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T32A6, T33B7`

**P5-W13 shipped the same five-state permission-recovery shape twice, in two grants, because
neither task could own a shared module.** Both get the important thing right - `denied-permanently`
is distinct from `denied`, and the permanent case routes to system settings rather than back into
a re-prompt dead end - but they are two vocabularies:

|               | `features/connect/` (T32A6)     | `features/composer/` (T33B7)    |
| ------------- | ------------------------------- | ------------------------------- |
| type          | `OnboardingPermissionStatus`    | `PermissionState`               |
| action ids    | `"openSettings"` / `"continue"` | `"open-settings"` / `"dismiss"` |
| parameterised | camera-specific                 | by `PermissionKind`             |

**Unify onto `features/composer/permission-recovery.ts`'s shape**, which is already parameterised
by kind so camera slots in as a third; T32A6's would need generalising first. T33B7 filed the
requirement in its own source under "WHAT MUST BE UNIFIED LATER"; T32A6's report does not mention
T33B7 at all. **T36D reuses this affordance for the microphone, so it must be one module by then.**

This is the same shape as [T60A](#t60a), which unified three private secret-shaped redaction
lists. Follow it: one module, both call sites rewritten against it, no compatibility shim left
behind.

Owns: the shared module plus the call sites in `features/connect/` and `features/composer/`.

- [ ] One permission-recovery module, parameterised by permission kind, with both existing call
      sites rewritten against it and no second vocabulary left in the tree
- [ ] Every state still has a named, non-empty recovery, and `denied-permanently` still routes to
      system settings - asserted by tests, not by inspection
- [ ] A guard or test fails if a second private permission-state vocabulary reappears

#### T32S11 - Mount wave P5-W14's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W16` · `depends-on: T32S10, T32P2, T36A, T36C, T60C`

**The standing one-wave-behind mount role, seventh instance - and the first whose backlog is
genuinely blocked rather than merely unclosed.** T32S10 (P5-W14) mounted both of P5-W13's inert
deliverables: `app/connect.tsx` renders `<OnboardingGate storage={core.keyValueStorage}>` around
`ConnectionShell`, and the session route renders `<TranscriptWindowList>` in place of the plain
`ScrollView` over `entries.map`, with the composed `${testId}-row-${item.id}` equal to the
hand-built id it replaced - which is why T33A5's image, attachment and diff tests pass unchanged.

**Three seams were filed at T32S10 during P5-W14 and none could be closed, for a reason different
in kind from P5-W13's.** The P5-W14 merge gate checked and refused to close them: unlike
`OnboardingGate` (which needed only `AppCore.keyValueStorage`, already built) and
`TranscriptWindowList` (a documented drop-in), **these need packages that are not installed and
platform adapters that do not exist.** Closing them would have produced live-looking wiring
against permanently unavailable ports. **Your dependencies are T32P2 and T60C; do not start any
of items 1-3 before confirming both have landed, and if either has not, say so and mount nothing
against a fake.**

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

**(1) `features/notifications/` has no importer at all** - `knip` lists its barrel under Unused
files. T36A built `PushRegistrationController` (`registerForPush`, `attachTokenRefresh`,
`resetForNewConnection`) behind an injected `PushRegistrationPort`, proved the registration call
count for same-token refresh, new-token refresh, concurrent refresh and refresh-during-flight,
and correctly reused `features/composer/permission-recovery.ts`'s vocabulary rather than writing a
third. `registerPushToken` is real in `packages/protocol` and `DaemonClient`. **Blocked on
`expo-notifications` + `expo-device` (T60C).** Construct in `core.ts`, reset on reconnect.

**(2) `features/share/` has no importer at all** - also under `knip`'s Unused files. T36C built
`classifyShareIntent` (a real allowlist), a session chooser that re-validates against a freshly
supplied `validSessionIds` at resolve time, and `materializeShareDraft` routing through
`frontend-core`'s real `OutboxController`. **Blocked on T32P2's adapters and on T36E deciding the
receiver**, and it additionally needs an `android.intentFilters` block in the Expo config, which
T36C filed as exact JSON rather than editing outside its grant.

**(3) `FilesScreen`'s four transfer props are unforwarded**: `filePicker`, `sharing`,
`downloadOrigin`, `fetchImpl`. `FilesScreen` itself is mounted and live, so upload and download
panels simply never render. **Blocked on T32P2** building the adapters and resolving the daemon
HTTP origin.

**(4) The four long-blocked construction sites** (counts as of this task's own wave, P5-W16 —
see the tallies note at the top of this file). `core.ts` still builds
`createPollingNetworkReachability` with `getProbeUrl` hardcoded to `() => null`
(`NativeNetworkReachability`, unmounted since P5-W9 - **six gates**); nothing constructs
`SqliteStructuredStorage` (since P5-W9 - **six gates**), which also strands T37C's
`createTurnOutbox`/`recoverInFlightTurns`; and `terminal-screen.tsx` still defaults to
`createNotConnectedTerminalBinaryTransport()` / `createUnavailableTerminalWebViewPort()` (since
P5-W10 - **five gates**). All are T60C's installs. **If T60C has landed, switch all of them; if it
has not, change nothing and say so.**

**(5) `decideTerminalResizeOwnership` (T35B3) has no importer outside its own test**, and does not
model the server's COMPAT `undefined -> "claim"` default. It may be intended as a verification
model only. **Decide that explicitly and write the decision down** rather than letting it drift a
third wave.

**(6) P5-W15 added five more unmounted deliverables, and this is now a two-wave backlog.** `knip`
lists three of them under Unused files - `features/settings/index.ts`,
`features/settings/SettingsScreen.tsx`, `features/voice/index.ts`. The other two,
`platform/file-picker.ts` and `platform/sharing.ts`, escape that list only because their own test
files import them; they are equally unmounted. Every one of the five filed its seam at this task
with exact code, in its own report, rather than claiming a mount it did not have.

- **T32C1's `SettingsScreen`** needs a route and `AppCore.keyValueStorage`. It is **not blocked on
  any package** - `keyValueStorage` already exists. Its `SettingsController.getSnapshot()` returns
  `{ hapticsEnabled: boolean }`, which is exactly the shape the two hardcoded haptic call sites
  need: `app/h/[serverId]/session/[agentId]/index.tsx:194` and
  `features/approvals/use-approvals-queue.ts:102` both still pass a literal `true`. The first is
  **inside your grant**; the second is not, so file it. A storage read failure resolves to
  `hapticsEnabled: true` with `loadError: true` on all three failure branches - do not "fix" that
  to false.
- **T32P2's `createAndroidFilePicker`/`createAndroidSharing`** close items (2) and (3) above once
  constructed, but are **blocked on `expo-document-picker`/`expo-image-picker`/`expo-sharing`
  (T60C)**.
- **T32P2 also found the real reason `FilesScreen.downloadOrigin` is unreachable**, and it is not
  a picker problem: `DaemonConnectionSnapshot` carries no host or port, so no daemon HTTP origin
  can be derived without changing it. T32P2 filed the exact shape and did **not** string-munge one
  out of a WebSocket URL. **Deciding that shape is yours or the `features/connect/` owner's - say
  which.**
- **T36B's `createPermissionNotificationController`** additionally needs `onController` added to
  `ApprovalsContainer`, which T36B filed rather than editing outside its grant. Blocked on
  `expo-notifications` (T60C).
- **T36D's `features/voice/`** needs driving from `features/composer/`'s mic button, and is
  blocked on the audio/speech packages (T60C).
- T36B's `route-to-approval`/`route-to-session` outcomes are named states with no navigation
  behind them. Route them to real `expo-router` navigation, or say why not.

**(7) The construction-site gate counts, updated after P5-W15:** `getProbeUrl` still `() => null`
at `app-shell/core.ts:318` - **eight gates**; `OfflineCache` unconstructed - **three gates**;
the terminal still falling back to `createNotConnectedTerminalBinaryTransport()` - **three
gates**. All T60C's.

- [ ] Every P5-W14 and P5-W15 deliverable is either mounted, or named with the specific package or
      adapter that blocks it and the task that owns that blocker
- [ ] Every mount this task adds is proven by a test asserting the mounted behaviour actually
      occurs, not that the import or the prop exists
- [ ] Nothing is wired against a port that cannot exist yet - a mount against a permanently
      unavailable adapter is worse than an honest gap
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and every
      prohibition over source text reads the comment-stripped `readCode()`, never raw `source`

#### T32P2 - Build the Android file-picker and sharing platform adapters

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T35A4, T60C`

**Three finished deliverables are stranded on adapters that do not exist.** T35A4 (P5-W14) built
upload and download over daemon RPC - real `client.uploadFile`, a real
`FileDownloadTokenRequestSchema` capability token, monotonic progress that reaches exactly 100%
only on success, and cancellation proven as an interleaving with an in-flight chunk. It renders
nothing, because `FilesScreen`'s `filePicker`, `sharing`, `downloadOrigin` and `fetchImpl` props
are unforwarded and **`apps/android/src/platform/` contains no `FilePicker` or `Sharing`
implementation at all**. T36C's share handling needs the same adapters.

`packages/frontend-core` already defines the `FilePicker` and `Sharing` interfaces - **implement
those, do not define new ones**, exactly as T32P1 implemented `NetInfoModule` for network
reachability.

Owns: `apps/android/src/platform/file-picker.ts`, `apps/android/src/platform/sharing.ts`, and
their tests. **Construction and forwarding belong to the router root (T32S11) - file those seams
with exact code rather than editing `app-shell/core.ts`.**

**Check what is installed before designing.** `expo-document-picker`, `expo-image-picker` and
`expo-sharing` are all absent today; **T60C runs in this same wave and holds that grant.** If they
have landed when you start, implement against them; if they have not, build behind the same
injected-port shape T32P1 used, prove every rule against a scripted fake, and report the exact
install commands with the versions `node_modules/expo/bundledNativeModules.json` pins. Do not
vendor, stub, or claim a real picker opened.

**Resolving the daemon HTTP origin is part of this task and is the least obvious half.** T35A4's
`buildFileDownloadUrl` needs an origin; the download endpoint reads its capability token **only**
from `req.query.token` (`packages/server/src/server/bootstrap.ts`), which is the real and only
wire contract - single-use, 60s TTL. Find where the connection already knows the daemon's HTTP
origin rather than reconstructing one from a WebSocket URL by hand, and never put anything but
that token in the query string.

- [ ] `FilePicker` and `Sharing` are implemented against `frontend-core`'s existing interfaces,
      with no second interface defined anywhere
- [ ] Every refusal path - permission denied, cancelled, unsupported type, oversize - lands in a
      named state, asserted against a scripted fake
- [ ] The daemon HTTP origin is derived from what the connection already knows, and nothing but
      the capability token reaches a URL query string
- [ ] Whatever cannot be built because a package is uninstalled is named with the exact install
      command, and nothing is stubbed to look live

#### T36E - Choose and wire the Android share-intent receiver

`labels: phase-5, area: android` · `wave: P5-W16` · `depends-on: T36C, T32P2`

**T36C built everything that happens _after_ a share intent arrives, and nothing that makes one
arrive.** `classifyShareIntent`, the session chooser and `materializeShareDraft` are all
unit-proven; the receiving half needs an `android.intentFilters` block in the Expo config plus a
runtime receiver, and **no task owns either.** T36C filed the exact JSON rather than editing
outside its grant, and explicitly recorded that `expo-share-intent` is **unvetted** - it is not
installed, and whether it is the right route at all has never been decided.

Decide it here, with reasons, before writing code: `expo-share-intent`, a bare `expo-linking`
route, or a small native module. Weigh what each costs at EAS build time and whether it survives
`expo prebuild`. **Nothing from `D:/paseo/packages/app` may enter this repository in any form.**

Owns: the receiver module, the Expo config's `android.intentFilters` block, and the T36C wiring
those two need. **The route and any `AppCore` threading belong to T32S11 - file those seams with
exact code.**

- [ ] The receiver route is chosen with the trade-off written down, not defaulted to
- [ ] A scripted intent reaches `classifyShareIntent` and comes out as a draft or a named
      refusal, proven end to end against a fake receiver
- [ ] The Expo config declares only the MIME types T36C's allowlist actually accepts
- [ ] A share arriving while the app is cold-started is handled, not dropped - or the exact
      blocker is named

#### T61 - Confirm push re-registration semantics in the protocol and daemon

`labels: phase-5, area: core` · `wave: P5-W16` · `depends-on: T36A`

**T36A's token-refresh correctness rests on an assumption nobody has checked.** It proved, against
a scripted fake, that a refresh producing a new token registers the new one and never
double-registers - but `packages/protocol` has **no** `unregister_push_token` or `deregister`
request (confirmed absent at the P5-W14 gate, by two independent greps). So whether a superseded
token stops receiving depends entirely on the daemon overwriting per device on
`register_push_token`, and that is unverified. **If it appends rather than overwrites, every token
a device has ever held keeps receiving notifications forever** - a real privacy defect on a shared
or resold device, not a tidiness issue.

Read `packages/server`'s push registration handler and settle it. If the daemon overwrites, write
that down as the contract in `packages/protocol`'s own doc comment so the next reader does not
re-derive it. If it does not, the protocol needs a deregistration request, and that is this task's
deliverable.

Owns: `packages/protocol` and `packages/server`'s push registration path, plus their tests.
**Do not touch `apps/android`** - T36A's model is already correct against either answer.

- [ ] The re-registration contract is determined by reading the daemon, not assumed, and written
      down where a protocol reader will find it
- [ ] A superseded token provably stops receiving, or a deregistration request exists and is
      tested in both directions
- [ ] No push token reaches a log, a URL query string, or plain storage on either side

#### T32P3 - Write the Android NotificationsPlatform adapter and settle the state union

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T36A, T36B, T60C`

**A third permission-flavoured vocabulary exists, in a package no Android task may edit, and
nothing is scheduled to reconcile it.** `packages/frontend-core/src/platform/notifications.ts`
defines `NotificationPermissionState` (`"granted" | "denied" | "prompt" | "unsupported"`) for
`NotificationsPlatform.requestPermission`/`getPermissionState`. No Android adapter implements that
interface, so the union has never been exercised on this platform and no task owns deciding
whether it should fold onto `features/composer/permission-recovery.ts`'s `PermissionState`.

Found at the P5-W15 merge gate, which counted the vocabularies itself rather than trusting the
wave's own greps: T60D's report and the wave verifier both claimed one vocabulary remained; the
gate's grep found two under `apps/android/src` plus this one in `frontend-core`. See T60E for the
second.

Owns: the Android `NotificationsPlatform` implementation under `apps/android/src/platform/`, plus
its tests. **`packages/frontend-core` may be edited only if the answer is that the union folds -
and then only that union.** Construction belongs to the router-root owner; file that seam.

- [ ] An Android `NotificationsPlatform` exists, implementing `frontend-core`'s existing interface
      with no second interface defined, and every refusal path lands in a named state
- [ ] Whether `NotificationPermissionState` folds onto `PermissionState` is decided with the
      reason written down, and if it folds, it is folded rather than left recorded
- [ ] Nothing about a notification's content reaches a log or plain storage

**Blocked on `expo-notifications` and `expo-device` (T60C).** If T60C has not landed, build behind
T36A's injected `PushRegistrationPort` shape, prove against a scripted fake, and say so - do not
stub a live-looking adapter.

#### T60E - Fold CameraPermissionStatus onto PermissionState and widen the guard

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T60D, T32A4`

**T60D unified two permission vocabularies and a third survived it, unseen by the guard T60D built
in the same wave.** T60D's own report claimed "no second vocabulary left in the tree" and the
P5-W15 wave verifier confirmed it "by grep". Both greps keyed on `"denied-permanently"`.
`features/connect/qr-scanner-port.ts:50` declares

```ts
export type CameraPermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";
```

which does not contain that member, so neither grep saw it - and neither does
`scripts/ci/guard-no-duplicate-permission-state.mjs`, which keys on the same literal. The P5-W15
merge gate proved the blind spot by planting a union without `"denied-permanently"`: the guard
passed it. That blind spot is now recorded in the guard's own header; **this task is what closes
it.**

The survival is defensible, not accidental - every `CameraPermissionStatus` literal is already a
`PermissionState` literal, a structural subset needing no cast, which is why
`features/connect/onboarding-permissions-port.ts` can satisfy `PermissionPort` without one. It is
still a second vocabulary, and the guard cannot see it.

Owns: `features/connect/qr-scanner-port.ts`, `qr-scan-model.ts`, `features/connect/index.ts`,
`scripts/ci/guard-no-duplicate-permission-state.mjs` and its test, plus the tests of the files
above.

- [ ] `CameraPermissionStatus` is gone and every consumer reads `PermissionState`, with
      `qr-scan-model.ts`'s `mapPermissionStatus` still mapping every state it can now receive -
      including the two it could not before
- [ ] The guard flags a permission-shaped union whether or not it contains `"denied-permanently"`,
      proven in both directions against a planted fixture, and the KNOWN BLIND SPOT note in its
      header is deleted because it is no longer true
- [ ] No existing test is weakened; if one changes because the vocabulary changed, the commit
      message says which assertion changed and why it still proves the same thing

#### T60F - Delete the notification permission-recovery restatement

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T60D, T36B`

**A workaround outlived its reason by one wave.** T36A (P5-W14) could not extend
`features/composer/permission-recovery.ts`'s `PermissionKind` - that file was unowned in its wave -
so `features/notifications/notification-permission-recovery.ts` restated the same
`(state) -> copy` shape for a single kind, over the same imported `PermissionState`, and wrote
down the three things a later task must fold in.

T60D (P5-W15) did the first two: `PermissionKind` now carries `"notifications"` (and `"camera"`),
with matching `KIND_LABEL` and `KIND_PURPOSE` entries. The third - deleting the restatement -
could not be done in that wave because `features/notifications/` was T36B's live grant, and the
P5-W15 merge gate deliberately left it rather than making a user-visible copy change at a gate.
The stale header was corrected there; this is the code change.

Owns: `features/notifications/notification-permission-recovery.ts` and its call sites and tests.

- [ ] `describeNotificationPermissionRecovery` and `NotificationPermissionRecoveryCopy` are gone,
      and every call site calls `describePermissionRecovery("notifications", state)`
- [ ] The user-visible copy change is deliberate: the two tables word their titles differently, so
      say which wording survives and why, rather than letting the diff decide
- [ ] Every state still has a named, non-empty recovery and `denied-permanently` still routes to
      system settings, asserted by tests

#### T32A7 - Carry the daemon host and port on DaemonConnectionSnapshot

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T32S11, T35A4`

**T35A4's download panel cannot render, and the reason is not the file picker.** T32P2 (P5-W15)
went looking for a daemon HTTP origin to give `buildFileDownloadUrl` and found that
`DaemonConnectionSnapshot` carries only `{ phase, error, path }` - no host, no port - even though
`connect()` already receives the address and discards it. T32P2 deliberately did **not**
string-munge an origin out of a WebSocket URL and filed the shape instead. T32S11 (P5-W16) read
the seam, agreed the field belongs on the snapshot, and corrected the location: the store is
`features/connect/daemon-connection-store.ts`, not `app-shell/`. Neither could edit it.

Owns: `apps/android/src/features/connect/daemon-connection-store.ts` and its tests.

- [ ] The snapshot carries the daemon's host and port, taken from what `connect()` already
      receives rather than reconstructed, and a consumer can derive an HTTP origin from it
- [ ] Nothing but the capability token ever reaches a URL query string - the download endpoint
      reads `req.query.token` and that token is single-use with a 60s TTL
- [ ] The host and port never reach a log

#### T32A8 - Complete the connect-to-session-list path

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T32A6, T32S11, T37E1`

**There is today no in-app path from a fresh install to `/h/:serverId/sessions`.** Found at the
P5-W16 merge gate while checking why T37E2's cold-start flow could not pass even with a device:
`saveHostProfile` has **no caller anywhere**, and nothing navigates after a successful connect
(`features/connect/connection-shell.tsx`). The cold-start restore that T32B3 built and T32S3
wired is therefore unreachable in practice - `app/index.tsx` reads a stored profile that nothing
ever stores.

T37E1 (P5-W16) found the matching gap on the pairing side: `QrPairingPanel.tsx` has no camera
module and **no manual-paste `TextField`**, so relay pairing is not merely unproven on a device,
it is structurally unscriptable. Both halves are the same missing path and are folded into one
task so they cannot file seams at each other.

Owns: `apps/android/src/features/connect/connection-shell.tsx`, `QrPairingPanel.tsx`, and their
tests. **Navigation belongs to the router root - file that seam at T32S12 with exact code if the
navigation call cannot live here.**

- [ ] A successful connect saves a host profile and navigates to that server's session list,
      proven by a test asserting the stored value and the destination, not that the call exists
- [ ] A failed connect saves nothing and lands in a named state
- [ ] Relay pairing has an entry point a test can drive - a manual-paste field at minimum - so
      the pairing flow is scriptable without a camera
- [ ] `QrPairingPanel.tsx` offers an "Open settings" affordance for T60E's `"settings"` phase
- [ ] No host, port, token or pairing URL reaches a log

**T60E (P5-W17) filed a seam here without knowing the task ID.** Its fold gave `mapPermissionStatus`
a new `"settings"` phase for `denied-permanently` - the state that must route to system settings
rather than re-prompt. But `QrPairingPanel.tsx`'s `showRetry` covers only `"denied"` and
`"unavailable"`, so a permanently-denied user sees static text with no action at all. The panel is
in your grant; the phase already exists.

#### T32S12 - Mount wave P5-W16 and P5-W17's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T32S11, T32P3, T36F, T60C`

**The standing one-wave-behind mount role, eighth instance.** T32S11 (P5-W16) mounted the one
item of its eight-item backlog that was not blocked on an uninstalled package - T32C1's settings
screen, on a real registered tab route - and produced a blocker map for the rest that the merge
gate spot-checked and found accurate.

`knip` now lists three `apps/android` files under Unused files, down from five:
`features/notifications/index.ts` (T36A/T36B, blocked on `expo-notifications` + `expo-device`),
`features/share/index.ts` (T36C/T36E, blocked on [T36F](#t36f)'s native module) and
`features/voice/index.ts` (T36D, blocked on the audio/speech packages).

**Read the P5-W16 merge-gate findings before starting, not only the tasks' own reports.** The
gate found T32S11's headline mutation had been reported as killed when it was not: `index.tsx`
carried two byte-identical `useState(() => core.settings.getSnapshot().hapticsEnabled)` blocks and
the regression test did a whole-file `toMatch`, so it passed as long as _either_ call site
matched. **A sibling occurrence of the same code satisfying an assertion is a fifth source-text
defect class**; anchor every source-text assertion to the component it names.

Also outstanding at the router root: `sessions.tsx` needs `state`/`onSessionCreated` threading so
a created session appears as a row (T37E2's finding), and the construction-site gate counts stand
at `getProbeUrl` still `() => null` - **nine gates**; `OfflineCache` unconstructed - **four**;
terminal on `createNotConnectedTerminalBinaryTransport()` - **four**, and that last one is blocked
on [T62](#t62)'s public client API, not merely on a mount.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

**(P5-W17 backlog, and the gate found `knip` under-reports it.)** `knip` still lists exactly the
same three files and this wave added none - but two more P5-W17 deliverables are equally unmounted
and simply do not appear, because a colocated test (resp. the package barrel) counts as a consumer:

- **T32P3's `createUnavailableAndroidNotificationsPlatform()`** has no importer but its own test,
  and **`AppCore` has no `notifications` field at all** - you must add the slot, not just the
  value. T32P3 decided **not** to fold `NotificationPermissionState`; it narrows
  `denied-permanently -> "denied"` at the boundary and exports `getNativePermissionState()`
  returning the real five-state read, so a settings screen can still call
  `describePermissionRecovery("notifications", state)` and route to system settings. Mount both.
- **T62's `openTerminalSession`** needs a `TerminalBinaryTransport` adapter; T62 supplied exact
  code. It also disclosed an open policy question that is yours: **an open session silently
  reports `dropped-not-connected` forever after a reconnect** - decide the reconnect/resubscribe
  policy rather than inheriting it.
- **A second live mount point for `sheet`/`screen`-placement Pi UI elements.** T37E5's structural
  finding, confirmed at the gate: one `PiUiElement` carries one `placement`, so a `panel` can
  never be both `"pinned"` (to be selected) and `"sheet"` (to open as a Sheet). Panel's Sheet mode
  is unreachable on any device today.

**Construction-site gate counts after P5-W17:** `getProbeUrl` still `() => null` at
`app-shell/core.ts:344` - **eleven gates**; `OfflineCache` unconstructed - **eleven**; terminal on
`createNotConnectedTerminalBinaryTransport()` at `terminal-screen.tsx:99` - **ten**. T62 built the
client capability but `apps/android` imports `@picompanion/client` only as types, so the terminal
count does **not** reset - it is now a mount, not an API gap.

- [ ] Every P5-W16 and P5-W17 deliverable is either mounted, or named with the specific package or
      adapter that blocks it and the task that owns that blocker
- [ ] Every mount this task adds is proven by a test asserting the mounted behaviour actually
      occurs, and anchored to the call site the test names - never a whole-file `toMatch`
- [ ] Nothing is wired against a port that cannot exist yet
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount, and every
      prohibition over source text reads the comment-stripped `readCode()`, never raw `source`

#### T36F - Write the native ShareIntentPort module

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T36E`

**T36E chose the in-repo native route with the trade-off written down, built the whole TypeScript
orchestration behind an injected `ShareIntentPort`, and could not write the native half.** No task
owns the ~150 lines of Kotlin plus the config plugin that make a real Android intent reach JS.
Until it exists `features/share/` cannot mount, and `createUnavailableShareIntentPort()` is what
production gets.

T36E rejected `expo-share-intent` (unvetted third-party native code sitting on the "never log a
shared file's name, path or bytes" boundary) and ruled out bare `expo-linking` entirely (it would
force user content into a URL). Read T36E's decision before starting; if you disagree, say why
rather than silently choosing differently.

Owns: the native module, its config plugin, and the `ShareIntentPort` implementation that talks to
it. **Mounting belongs to T32S12.**

- [ ] A real Android intent reaches `classifyShareIntent` and comes out as a draft or a named
      refusal
- [ ] The module survives `expo prebuild` and builds under EAS, or the exact blocker is named
- [ ] A shared file's name, path and bytes never reach a log, plain storage, or a URL query string
- [ ] An intent arriving while the process is dead is delivered, not dropped

#### T61B - Send the superseded push token on refresh

`labels: phase-5, area: core` · `wave: P5-W18` · `depends-on: T61, T36A`

**[T61](#t61) proved the daemon side and the client half is still missing.** `PushTokenStore` is a
flat `Set<string>` with no device identity, so `register_push_token` **appends**: every token a
device has ever held keeps receiving forever. T61 added `unregister_push_token` and tested it in
both directions on the server. But `DaemonClient` has no `unregisterPushToken(token)`, and
`PushRegistrationController.attachTokenRefresh` never sends the **old** token when a refresh
produces a new one - so in production a refreshed device still accumulates tokens.

This is a real privacy defect on a shared or resold device, not a tidiness issue.

Owns: `packages/client`'s push path, and `apps/android/src/features/notifications/`'s refresh
handling, plus their tests.

- [ ] `DaemonClient.unregisterPushToken(token)` exists and sends the request T61 defined
- [ ] A token refresh provably deregisters the superseded token and registers the new one, in that
      order, with the interleaving where the deregistration fails covered by a named outcome
- [ ] Deregistering a token the daemon does not know is a no-op that leaks nothing about whether
      it existed
- [ ] No push token reaches a log, a URL query string, or plain storage on either side

#### T62 - Expose a public terminal frame API on DaemonClient

`labels: phase-5, area: core` · `wave: P5-W17` · `depends-on: T34A1, T34B4`

**The terminal is not merely unmounted - it is blocked on API that does not exist.** Confirmed at
the P5-W16 merge gate: `DaemonClient.sendBinaryFrame` (line 1631) and `tryHandleBinaryFrame` are
both `private`, and there is no public terminal frame send or receive surface. So
`terminal/[terminalId].tsx` passes no `transport` prop and `TerminalScreen` falls back to
`createNotConnectedTerminalBinaryTransport()` - four merge gates and counting.

Every previous wave recorded this as "blocked on `react-native-webview`" ([T60C](#t60c)). That is
half the story: installing the package would still leave the transport with nothing to call.

Owns: `packages/client`'s terminal frame path and its tests. **Do not touch `apps/android`** -
mounting is T32S12's.

- [ ] A public send and receive surface for terminal binary frames exists on `DaemonClient`,
      shaped to what `TerminalBinaryTransport` needs, with backpressure and close semantics
      decided rather than defaulted
- [ ] A frame arriving for an unknown or closed terminal lands in a named state, not an exception
- [ ] Nothing about terminal content reaches a log
- [ ] The existing private methods are not merely re-exported: the public surface is the one the
      transport interface actually needs, and the commit message says what was deliberately not
      exposed

#### T60G - Own the permission-recovery vocabulary and apply T60F's per-kind title override

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T60E, T60F, T32P3`

**`features/composer/permission-recovery.ts` holds the canonical permission vocabulary and has no
future owner.** T60D and T60F are both complete and nothing in P5-W18 or later owns the file.
Three separate siblings falsified its header comment inside a single wave (P5-W17), and the merge
gate had to repair all three by hand because no task could edit it:

- it said `PermissionState` mirrors `qr-scanner-port.ts`'s `CameraPermissionStatus` - T60E deleted
  that type, so the dependency now runs the other way;
- it said the notifications copy table "stays in place" and folding it away "is the one follow-up
  T60D leaves open" - T60F did exactly that, in the same wave;
- it left the `NotificationPermissionState` fold "for whoever wires `NotificationsPlatform` to
  decide" - T32P3 decided it, in the same wave.

A file every sibling depends on and nobody owns will keep rotting. Give it an owner.

**It also holds a filed, unapplied copy decision.** T60F chose the composer's generic title
pattern for all four kinds and wrote down, with a five-row side-by-side table, that the deleted
`"undetermined"` wording ("Turn on notifications?") was **better writing**, traded away for one
consistent pattern. It filed the exact code for a per-kind title override and has nobody to apply
it to.

Owns: `apps/android/src/features/composer/permission-recovery.ts` and its tests.

- [ ] T60F's per-kind `"undetermined"` title override is either applied or declined with the
      reason written down - a filed decision nobody applies is the same as no decision
- [ ] The file's header describes the tree as it is after P5-W17, and every claim in it is one a
      grep could falsify today
- [ ] Every `PermissionKind` x `PermissionState` pair still has a named, non-empty recovery, and
      `denied-permanently` still routes to system settings for every kind, asserted by tests
- [ ] The union is not widened without also widening
      `scripts/ci/guard-no-duplicate-permission-state.mjs`'s literal domain, which keys on the
      five members as they stand

#### T63 - Build a live-turn path so a real agent_permission_request can be raised

`labels: phase-5, area: android` · `wave: P5-W18` · `depends-on: T33A6, T34A1, T36B`

**No task owns making a turn actually run, and two flow tasks are already blocked on it.** Found
at the P5-W17 merge gate while checking T37E4's Gap B: `SessionRoute` hardcodes
`turnRunning={false}` and `NO_OP_TURN_SERVICE` (`app/h/[serverId]/session/[agentId]/index.tsx`
around lines 402-403), and the isolated `--no-relay` daemon a flow starts provisions no agent
credentials. So nothing in this app can cause the daemon to emit an
`agent_permission_request`, and the whole approvals path - which T36B, T32S11 and T37E4 have all
built against - has never been driven by a real one.

**This blocks [T37E6](#t37e6), whose criterion is "backgrounding and killing the app _during an
active turn_".** That is unsatisfiable while no turn can start, which is why T37E6 moved to
P5-W19 behind this task rather than discovering the same wall at its own gate.

Owns: the turn service wiring and whatever credential or fixture path lets a locally-started
daemon run one. **The router root belongs to [T32S12](#t32s12) - file that seam with exact code
rather than editing `app/`.**

- [ ] A turn can be started against a locally-started, isolated daemon and reaches a real
      `agent_permission_request`, proven by a test asserting the request arrives - not that the
      service was registered
- [ ] `NO_OP_TURN_SERVICE` is no longer what the session route gets in production, or the exact
      remaining blocker is named with the task that owns it
- [ ] Whatever credential the local path needs is supplied by the test harness, never committed,
      and never reaches a log, plain storage, or a URL query string
- [ ] A turn that fails to start lands in a named state, not a silent no-op

#### T32S13 - Mount the six deliverables P5-W18 left unmounted and make the composer send

`labels: phase-5, area: android` · `wave: P5-W19` · `depends-on: T32S12, T63, T64, T36F, T32A7`

**The standing router-root role, ninth instance - and it inherits a specific, verified list.**
P5-W18 was the first wave in nine where `app/` and `app-shell/` had an owner, and T32S12 used it
well: `AppCore` gained a `notifications` slot that did not exist, the terminal transport reset a
ten-gate counter, and T63's `TurnService` reached the session route. It ran out of budget before
the rest. The P5-W18 merge gate walked the import graph itself and found **18 unmounted product
files, not `knip`'s 3** - knip misses 15 of them because a colocated test or a package barrel
counts as a consumer.

**The single most visible gap in the app: a user typing a message into the composer still sends
nothing.** `app/h/[serverId]/session/[agentId]/index.tsx:42` is
`function handleSubmit(_text: string) {}`, passed as `onSubmit` at line 445. T63's
`startDaemonTurn` (`features/sessions/turn-service.ts:118`) has **zero production callers** - the
gate grepped for them. T63 filed the exact wiring code; T32S12 took the `turnService` half and
not the `onSubmit` half.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

- [ ] `onSubmit` calls `startDaemonTurn`, proven by a test asserting the turn actually reaches the
      client - not that the handler is non-empty
- [ ] `turnRunning` comes from [T64](#t64)'s subscription, or the exact blocker is named
- [ ] `features/share/` and `features/notifications/` are mounted, or each is named with the
      package and task that blocks it - T36F and T32A7 both filed exact code
- [ ] `getProbeUrl` and `FilesScreen.downloadOrigin` read the live `daemonAddress` T32A7 landed
- [ ] `sessions.tsx` fetches the session list on mount, so a returning user sees sessions that
      already exist rather than only ones created in this process
- [ ] Every mount is proven by a value of the mounted kind arriving, and every source-text
      assertion is anchored to the function or component it names

**The gate's verified backlog, with what is blocked and what is merely unmounted:**

- **`features/notifications/` - MERELY UNMOUNTED, not blocked.** The barrel has zero importers, so
  T61B's whole refresh-ordering controller is unreachable. Only `push-registration-port.js` is
  reached, directly, by `platform/notifications-platform.ts`.
- **`features/share/` - MERELY UNMOUNTED, not blocked.** Eight files unreached. T36F filed exact
  wiring code that falls back safely when the native module is unlinked.
- **`features/voice/` - BLOCKED** on the audio/speech packages (T60C).
- **`buildDaemonHttpOrigin` has zero callers.** T32A7 built it and filed the seam;
  `files/[...path].tsx:53` still mounts `FilesScreen` with no `downloadOrigin`.
- **`getProbeUrl` is still `(): string | null => null` at `app-shell/core.ts:417` - twelve
  gates - and it is now purely a mount problem.** T32A7's `daemonAddress` landed, so `core.ts`
  can compute a real probe URL from the snapshot it already holds. One file, your own grant.
- `platform/file-picker.ts`, `platform/sharing.ts` (T32P2) and `platform/native-network-
reachability.ts` are also unreached.

**Do NOT install a package.** Distinguish carefully between _blocked_ and _merely unmounted_ - the
gate found five of the six are merely unmounted, so "an honest gap beats a fake mount" should
resolve to a real mount for most of this list.

#### T64 - Subscribe to pi_queue_update and produce a real turnRunning signal

`labels: phase-5, area: android` · `wave: P5-W19` · `depends-on: T63, T33A6`

**`turnRunning={false}` is hardcoded at `app/h/[serverId]/session/[agentId]/index.tsx:448` and
nobody owns changing it.** Both T63 and the P5-W18 merge gate named it; neither owned it. The
composer therefore never shows a turn in progress, never disables submit while one runs, and
never re-enables afterwards - and once [T32S13](#t32s13) wires `onSubmit` to `startDaemonTurn`,
a user will be able to fire overlapping turns with no feedback at all.

The daemon already reports queue state. This task turns that into a signal the session route can
read.

Owns: a subscription module under `apps/android/src/features/sessions/`, plus its tests.
**`app/` is [T32S13](#t32s13)'s - file the mount seam with exact code and commit early.**

- [ ] A `pi_queue_update` from the daemon produces a `turnRunning` value the session route can
      read, proven by a test asserting the value changes when a real parsed message arrives
- [ ] A turn that ends, is aborted, or errors returns the signal to not-running - each by a named
      path, none by a timeout
- [ ] A subscription that is dropped and re-established does not report a stale running turn
- [ ] Nothing about a turn's content reaches a log

**Read `features/sessions/turn-service.ts` (T63) first** so this composes with `startDaemonTurn`
rather than competing with it, and check `packages/protocol` for what `pi_queue_update` actually
carries before designing a shape. If the protocol lacks something, **say so and name it** rather
than inventing a wire shape. T63 also disclosed that `setMode` has no wire support and fails with
a named error - do not try to fix that here.

#### T65 - Give TerminalBinaryTransport a dispose hook so a left screen unsubscribes

`labels: phase-5, area: android` · `wave: P5-W19` · `depends-on: T62, T32S12`

**T32S12 mounted the terminal transport and disclosed the gap it could not close: there is no
dispose or close hook, so a terminal screen the user navigates away from stays subscribed
daemon-side.** Every visited terminal leaks a live subscription for the process's lifetime, and
the daemon keeps sending frames nobody reads.

T62 built `openTerminalSession` with a real `close()`; what is missing is a way for
`TerminalBinaryTransport` - the interface the screen holds - to be told the screen is gone.

Owns: `apps/android/src/features/terminal/`'s transport interface and adapter, plus their tests.
**`app/` is [T32S13](#t32s13)'s - file the unmount-on-navigate seam with exact code.**

- [ ] `TerminalBinaryTransport` has a dispose or close method, and calling it provably reaches
      T62's `session.close()` - asserted by the session actually closing, not by the call existing
- [ ] Disposing twice, and disposing a transport that never connected, are named no-ops
- [ ] A frame arriving after dispose lands in a named drop state and never reaches a disposed
      subscriber
- [ ] No terminal byte, payload, or terminal id joined to content reaches a log

**T62 also left an open policy question that belongs here or with T32S13 - decide and say which:**
an open session silently reports `dropped-not-connected` **forever** after a reconnect. Either
resubscribe on reconnect or make the permanent-drop state visible; do not inherit the silence.

#### T66 - Make a relay-paired profile reconnectable and give it a download path

`labels: phase-5, area: android` · `wave: P5-W19` · `depends-on: T32A8, T32A7`

**T32A8 completed the connect-to-session-list path and disclosed that the relay half of it does
not survive a restart: `HostProfileRecord` carries no E2EE pin, so a saved relay profile cannot
actually be reconnected later.** A user who pairs over relay, closes the app, and reopens it gets
a stored profile that cannot be used - the cold-start restore T32B3 built resolves to a dead
entry.

T32A7 found the matching gap on the transport side and made the honest call rather than faking
it: `daemonAddress` is deliberately `null` on the relay path, because a relay tunnel proxies only
the encrypted WebSocket and no honest HTTP origin exists. **So relay-paired connections have no
file-download path at all**, and `buildDaemonHttpOrigin` cannot invent one.

Both halves are the same missing capability and are folded into one task so they cannot file
seams at each other.

Owns: `apps/android/src/features/connect/credential-store.ts` and its tests, plus whatever relay
download path the second half needs.

- [ ] A relay-paired profile saved to storage can be reconnected after a cold start, proven by a
      test that restores from storage and reaches a connected state - not by asserting the record
      has more fields
- [ ] The E2EE pin is stored in secure storage, never plain storage, and never reaches a log or a
      URL query string
- [ ] Either relay-paired connections get a working file-download path, or the refusal is a named,
      user-visible state rather than a silently missing button - and the reason is written down
- [ ] A stored profile whose pin no longer matches lands in a named state, not a silent failure

**The fourth criterion is the security-relevant one.** A pin that no longer matches is the exact
signal of a substituted daemon. It must be distinguishable from "cannot reach the host", and it
must not be papered over by falling back to an unpinned connection.

#### T67 - Fail loudly when the share-intent config plugin cannot patch MainActivity

`labels: phase-5, area: android` · `wave: P5-W19` · `depends-on: T36F`

**T36F's config plugin has a silent-failure path the P5-W18 merge gate found and deliberately did
not fix, because the premise could not be verified without running prebuild.**
`with-share-intent-module.ts` patches the generated `MainActivity.kt` with a `.replace()` keyed on
`import android.os.Bundle`. If the Expo template ever stops emitting that import, the `.replace()`
becomes a **no-op**: `Intent` goes unimported, the plugin reports success, and `expo prebuild`
does not catch it because prebuild does not compile Kotlin. Gradle or EAS fails much later, with
an error pointing nowhere near the plugin.

The sibling closing-brace check in the same file already throws on a failed match. This one does
not.

Owns: `apps/android`'s share-intent config plugin and its tests.

- [ ] Every patch the plugin applies either changes the file or throws with a message naming the
      anchor it could not find, proven by a test feeding it a `MainActivity.kt` without that anchor
- [ ] A plugin run against a template that already carries the patch is idempotent, not a double
      application
- [ ] The plugin's failure message says what a developer should do, not only what went wrong

**You cannot run `expo prebuild`, `eas build`, Gradle, or `adb`, and you may not install a
package.** The Expo template is not on disk until prebuild runs - **that is exactly why the gate
left this open**, so feed the plugin fixture files rather than trying to obtain the real template,
and name what a device or a CI prebuild would still have to confirm. The P5-W18 gate did verify
statically that `@expo/config-plugins`' `pluginExtensions` includes `.ts` and that the string-path
form resolves in the installed version, so plugin _resolution_ is not in doubt - only what happens
when an anchor is missing.

#### T68 - Construct an OfflineCache on AppCore and give it a lifecycle owner

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T32S13, T60C`

**Nothing in this repository has ever constructed an `OfflineCache`, in twelve consecutive merge
gates.** `platform/offline/index.ts:37` says so in its own header, and it is still true: only
tests construct one. Unlike the other long-running construction sites, this one is **genuinely
ownerless** - it is not merely unmounted. It needs a `SqliteStructuredStorage` instance and a
lifecycle owner on `AppCore`, and no task has ever claimed either.

Owns: the `OfflineCache` construction and its lifecycle, plus its tests. **`app-shell/core.ts` is
the router-root owner's - file that seam with exact code if the slot cannot live in your files.**

- [ ] An `OfflineCache` is constructed once, owned by something with a defined lifetime, and
      disposed when that lifetime ends - proven by a test asserting the disposal actually happens
- [ ] A cache that cannot open its storage lands in a named degraded state and the app still runs
- [ ] Nothing cached reaches plain storage unencrypted, a log, or a URL query string
- [ ] Two constructions for the same scope are prevented, not merely discouraged

**Blocked on `expo-sqlite` (T60C), which is blocked on the repository owner's `npm install`
window.** If it has not landed, build behind the injected storage interface, prove against an
in-memory fake, report the exact install command, and **say plainly that no real SQLite file was
opened** - do not stub a live-looking cache.

#### T32S14 — Mount T66's reconnect path and the route-level fetchImpl seam

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T66, T32S13`

The standing one-wave-behind mount task, thirteenth instance. The P5-W19 merge gate's own
import-graph walk found **19** product files nothing reaches (knip reported 2 — it counts a
colocated test or a package barrel as a consumer, so never trust it for this). Two of those
gaps are this task's:

1. `features/connect/reconnect.ts`'s `createReconnectHostProfile` has **zero production
   callers**. T66 built it and filed the seam; nothing calls it. A saved profile still cannot
   be reconnected from the UI, which is the whole point of having saved one.
2. The route-level `fetchImpl` is unwired, so T66's _named_ relay-download refusal is
   unreachable — the download button is silently absent rather than visibly refused. A
   refusal the user cannot see is not a refusal.

Owns: the mount sites only. Do not rewrite the feature modules you are mounting; if a
mounted module needs a change, file the exact seam and say who owns it.

- [ ] `createReconnectHostProfile` has at least one production caller, proven by a test in
      which a _value of the reconnected kind actually arrives_ — registration is not receipt
- [ ] `fetchImpl` reaches the route, and T66's named refusal is reachable and visible
- [ ] Mount **both halves** of anything you mount — half a mount passes every test you write
      about the other half (P5-W18's `createTurnService`/`startDaemonTurn` pair)
- [ ] `cd apps/android && npx vitest run` (whole suite) is green before you commit

#### T69 — Build the share target chooser so features/share/ has an entry point

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T36F, T32S14`

`features/share/` is complete, tested, and **unreachable**: mounting it needs a chooser
screen — where an incoming share picks its destination session — and no task has ever created
one. The P5-W19 gate flagged this as genuinely ownerless rather than merely unmounted, which
is why it gets its own task instead of another line in the mount task.

Owns: the chooser screen and its route. `features/share/` itself belongs to T36F.

- [ ] An incoming share reaches a screen that lists real destinations and routes to one
- [ ] A share arriving with no eligible destination lands in a named, visible state
- [ ] Nothing shared reaches a log or a URL query string
- [ ] `cd apps/android && npx vitest run` (whole suite) is green before you commit

#### T70 — Mount the voice feature behind a real entry point or delete it

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T36D, T32S14`

`features/voice/` is unmounted and **unclaimed** — no task in any wave owns mounting it. Its
audio packages are also in the uninstallable set (see T60C), so it cannot be proven end to
end today. Decide honestly: either give it a real entry point behind the injected recorder
interface and prove it against a fake, or delete it and say so. Do not leave a third wave of
dead product code behind a green test file.

Owns: `features/voice/` and its entry point.

- [ ] Either a value of the voice-entry kind actually arrives at the outbox in a test, or the
      feature is deleted and `plan.md`'s voice scope is amended to match
- [ ] If mounted: a denied or unavailable microphone lands in a named, visible state
- [ ] Report the exact install command for anything you could not install; do not stub a
      live-looking recorder
- [ ] `cd apps/android && npx vitest run` (whole suite) is green before you commit

#### T71 — Replace the terminal buffer's wall-clock assertion with a structural one

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T62`

`features/terminal/terminal-output-buffer.test.ts:129` asserts `elapsedMs < 5000` after
50,000 `enqueueOutput` calls. Its own title states the real intent — "enqueue is a plain
synchronous call — no Promise, no timer" — and that intent has nothing to do with the clock.
Under whole-suite parallel load it fails (`expected 6746 to be less than 5000`) while passing
10/10 in isolation. Since every implementer must now run the whole suite before committing,
a test that fails only under whole-suite load poisons that gate for every future wave.

Owns: that one test. Do not change `terminal-output-buffer.ts`.

- [ ] The stated intent is asserted structurally — that no Promise is returned and no timer or
      microtask is scheduled — not by elapsed time
- [ ] The replacement fails when `enqueueOutput` is made asynchronous (show the mutation)
- [ ] No wall-clock threshold remains anywhere in that file

#### T72 — Make the composer-inputs contract test read its own Maestro flow

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T37E3`

`e2e/flows/composer-inputs.contract.test.ts` never opens `maestro/composer-inputs.yaml`. That
is exactly why the yaml drifted into asserting `text: "Sent"` on a premise T32S13 had already
destroyed: unpaired, a send now settles `{ status: "failed" }` and the entry renders
"Failed". No gate runs Maestro, so the flow would have failed on a device with nothing in CI
to catch it. The P5-W19 merge gate corrected that one yaml by hand; this task makes the class
of drift impossible.

Owns: the contract test's yaml-reading assertions. Corresponding coverage for the other
Maestro flows is in scope where the same drift is possible.

- [ ] The contract test reads the yaml and fails when the flow asserts a state the wired app
      cannot reach (show the mutation)
- [ ] The check names which flow and which assertion drifted, not just that something did
- [ ] No flow file names the production daemon's port, in any form including comments

#### T32S15 — Mount whatever P5-W21 leaves unreached (fourteenth mount task)

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T69, T70, T74`

The standing one-wave-behind mount task. Start by running your **own** import-graph
walk from the real entry points (`apps/android/src/app/**` expo-router routes;
`apps/web/src/main.tsx`), never counting a test or a package barrel as a consumer.
**Do not use knip** (it under-reported 19 as 2 at the P5-W19 gate) and **do not trust a
naive walker either**: the P5-W20 gate's first walker reported 60 android files unreached
where the true number was 16, because its import regex swallowed bare side-effect imports
(`import "./renderers";`) and doc-comment prose forged edges. Correct for both, and say in
your report which number you got before and after correcting.

Owns: the mount sites only. Do not rewrite the feature modules you mount.

- [ ] Every mount is proven by a value of the mounted kind actually arriving — registration
      is not receipt
- [ ] Both halves of every pair are mounted, or the unmounted half is disclosed by name
- [ ] Anything you cannot mount in scope is filed with its exact seam and named owner
- [ ] `cd apps/android && npx vitest run` (whole suite) and `npm run format:check` are both
      green before you commit

#### T73 — Reconstruct a daemonAddress on a direct reconnect

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T32S14, T66`

Found at the P5-W20 merge gate, immediately after that gate fixed the neighbouring bug.
`adoptLifecycle` now publishes the right `path` for a reconnected profile, but
`daemonAddress` is still `null` on the direct path, so a reconnected direct profile offers
**no download origin and no probe URL** — the two things a direct connection exists to
provide. The address must be reconstructed from `HostProfileRecord.endpoint`.

Owns: `features/connect/daemon-connection-store.ts` and its callers.

- [ ] A reconnected direct profile publishes a real `daemonAddress`, proven by a value
      reaching a consumer (a download origin or a probe URL), not by a non-null field
- [ ] A malformed or unparseable stored endpoint lands in a named, visible state
- [ ] Nothing from the endpoint reaches a log or a URL query string

#### T74 — Give AppCore a shutdown path so its singletons are disposed

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T68, T32S14`

`createAppCore()` has **no teardown path for any singleton**. T68's `OfflineCacheOwner`
exposes a working `dispose()` that nothing in production ever calls; the same is true of
every other long-lived object the core builds. Today this is masked because a second
`createAppCore()` releases the first one's offline scope — a workaround the P5-W20 gate had
to add, not a lifecycle.

Owns: `app-shell/core.ts`'s teardown and `app-shell/core-context.tsx`'s call site.

- [ ] `AppCore` exposes one shutdown entry point that disposes every singleton it owns
- [ ] The provider calls it, proven by a test asserting a _disposed_ state is actually
      observed after unmount — not that a dispose function was registered
- [ ] Shutting down twice is safe and named, not a crash
- [ ] A shutdown mid-open (`offlineCache.open()` still in flight) settles to `"disposed"`

#### T75 — Make the composer's text-only send and retry reach the real OutboxController

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T33B7, T32S13`

Two defects in one file, found at the P5-W20 gate and to be shipped together:

1. `Composer.tsx`'s text-only send never reaches the real `OutboxController` — the outbox
   path is gated on `attachmentsToSend.length > 0`, so the most common send in the app
   bypasses the outbox entirely.
2. `Composer.tsx`'s `handleRetry` never calls `outbox.remove`/`confirmResend`, so a retry
   orphans the original entry and mints a new stable id.

Owns: `features/composer/Composer.tsx` and its model.

- [ ] A text-only send reaches the real `OutboxController`, proven by the entry arriving
- [ ] A retry reconciles the original entry rather than orphaning it — assert the orphan is
      gone, not merely that the new one exists
- [ ] The failure path a send can actually reach today (unpaired ⇒ `"Failed"`) still
      renders its named state

#### T76 — Give recoverInFlightTurns and createTurnOutbox a production caller

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T37C, T60C`

T37C built both; neither has ever had a production caller. Explicitly **not** T68's or
T32S14's — the P5-W20 gate checked. Blocked on `expo-sqlite` (T60C), which is blocked on
the repository owner's `npm install` window.

Owns: the mount sites for T37C's recovery path.

- [ ] A recovered in-flight turn actually arrives at the transcript after a simulated
      process death, proven by the value
- [ ] Build behind the injected storage interface and prove against a fake; report the exact
      install command and say plainly that no real SQLite file was opened

#### T77 — Cover the file download path T32S14 made reachable

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T37E9, T32S14`

A gap this repository _created_: T32S14 wired the route-level `fetchImpl`, making T66's
named relay-download refusal reachable and the download panel visible for the first time —
and no Maestro flow covers it. T37E9's flow was written against the pre-T32S14 route and
asserts only that `-upload` is absent.

Owns: the download flow and its contract test. Requires a real file selection and an HTTP
origin.

- [ ] The flow exercises a real download and asserts the state the wired app can reach
- [ ] T66's _named_ refusal is asserted as visible, not merely as a missing button
- [ ] The flow names the production daemon's port nowhere, comments included
- [ ] The contract test reads the yaml (see T72) rather than pinning source text alone

#### T78 — Mount platform/file-picker.ts and platform/sharing.ts into FilesScreen

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T32P2, T35A4`

T32P2 built both adapters; nothing wires either into `FilesScreen`, confirmed by the P5-W20
gate's own import-graph walk. `expo-document-picker`, `expo-image-picker` and `expo-sharing`
are all uninstallable, so build behind the injected interfaces and prove against fakes.

Owns: the `FilesScreen` mount sites. Do not rewrite T32P2's adapters.

- [ ] A picked file's value actually arrives at the upload path; a share's value actually
      arrives at the sharing adapter
- [ ] A denied permission or an unavailable picker lands in a named, visible state
- [ ] Report the exact install commands; do not stub a live-looking picker

#### T79 — Give the files and terminal routes real in-app navigation

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T35A4, T35B3`

Both routes are reachable **only by deep link** — there is no in-app control anywhere that
navigates to either. Every test and Maestro flow that "covers" them opens them directly by
URL, which is why no gate has ever noticed.

Owns: the navigation entry points.

- [ ] A user can reach the files route and the terminal route from a mounted screen, proven
      by a navigation test that starts from that screen — not from a deep link
- [ ] Touch targets are at least 48dp and TalkBack announces each control
- [ ] A route reached with no connection lands in its existing named state, not a crash

#### T80 — Make the terminal route reachable instead of permanently unavailable

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T62, T59`

The terminal route reports "unavailable" unconditionally: `react-native-webview` is not
installed **and** no `webview` prop is wired, so even a device with the package would still
see the unavailable state. Fixing the second half does not need the install; fixing the
first does. May collapse into T59's real-device work — check before starting.

Owns: the terminal route's webview seam.

- [ ] The `webview` prop is wired, so an available implementation actually renders
- [ ] The unavailable state remains named and visible when there is genuinely no webview
- [ ] Report the exact install command; do not stub a live-looking webview

#### T81 — Bring composer-icon-action.tsx inside the touch-target audit loop

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T37E10`

`touch-targets.test.ts`'s loop reads `./${name}.tsx` relative to `ui/primitives/`, so a
component under `features/composer/` cannot be added to `CRITICAL_INTERACTIVE_PRIMITIVES`
without changing the loop. T37E10 had to prove `composer-icon-action.tsx`'s 48dp target
separately in its own contract test — a structural gap, not a missing assertion.

Owns: `touch-targets.test.ts`.

- [ ] The loop accepts a path, not just a bare primitive name, and `composer-icon-action.tsx`
      is in the audited set
- [ ] The audit fails when any audited component's minimum dimension drops below 48
      (show the mutation for at least one component outside `ui/primitives/`)
- [ ] No component is silently dropped from the set by a path that fails to resolve

#### T82 — Stop OfflineCacheOwner's catch path from clobbering a disposed state

`labels: phase-5, area: android` · `wave: P5-W22` · `depends-on: T68, T74`

Confirmed at `platform/offline/offline-cache-owner.ts:227` by the P5-W21 merge gate. Both
success paths in `doOpen()` guard with `isDisposed()`; the **catch does not**. A
`driverFactory.open()` that rejects _after_ `dispose()` has run overwrites the final
`"disposed"` status with `"degraded"` — so an owner the app has already torn down reports
itself as a live, degraded cache. T74 found this while building `AppCore.shutdown()`,
disclosed it, and correctly disclaimed ownership.

Owns: `platform/offline/offline-cache-owner.ts` and its tests.

- [ ] A rejecting `driverFactory.open()` racing a `dispose()` settles to `"disposed"`,
      proven by a test that fails when the guard is removed (show the mutation)
- [ ] The three paths out of `doOpen()` — resolve, reject, and disposed-mid-flight — are
      each covered, not just the one that regressed
- [ ] `AppCore.shutdown()` (T74) still observes a disposed cache after the fix

#### T83 — Collapse the double microphone permission prompt to one port

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T70, T36D`

`handleMicPress` resolves microphone permission **twice**, against two separate ports
(`VoiceCapturePort` and `MicPermissionPort`). This is harmless only because both currently
return `"unavailable"`; with a real recorder installed it is two OS prompts for one
permission, which is a user-visible defect and a likely denial. T70 documented it in a doc
comment and filed it against no task ID.

Blocked on the audio/speech packages (T60C's `npm install` window). Build behind the
injected ports, prove against fakes, report the exact install command, and say plainly that
no real recorder was exercised.

Owns: `features/composer/Composer.tsx`'s mic path and the port seam it resolves through.

- [ ] Exactly one permission resolution happens per mic press, proven by a counting fake
- [ ] A denied or permanently-denied microphone lands in a named, visible state with the
      recovery copy the existing flow already asserts
- [ ] The `"unavailable"` path — no recorder installed — still renders its current notice

#### T84 — Make a gate read Maestro flow comments, not only their steps

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T72`

T72 built the parser that made contract tests read their own flows, and it reads **steps
only**. In the very same wave, `maestro/composer-inputs.yaml` — a Phase 5 exit-gate flow —
carried five prose assertions that T69 and T70 had destroyed, plus a citation of a
`features/share/index.ts` note T69 deleted. All 2027 tests were blind to it; only the merge
gate reading the yaml by hand caught it. This is the third consecutive wave in which a flow
comment asserted a premise another task had already falsified.

Owns: the comment-reading check, built on T72's existing parser.

- [ ] A flow header that names a symbol which no longer exists fails a gate, by name
- [ ] A flow comment that states a gap another task has since closed fails a gate
- [ ] The check does not fire on prose that is merely explanatory — show both a true
      positive and a true negative (mutations for each)

#### T85 — Consolidate the touch-target audits onto one strict predicate

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T81`

Two loose ends left by the P5-W21 gate's headline fix, which replaced
`elementMeetsTouchTarget`'s `||` with a strict "every declared minimum must reach 48":

1. That `||` had been in place for all 11 audited components, not just the one T81 added.
   All 23 assertions pass under the strict predicate today, so no existing primitive was
   passing on one axis only — but that finding deserves a recorded, tested decision rather
   than a commit message.
2. `composer-accessibility.test.ts` carries its own looser 48dp regex that now duplicates
   the shared loop. Two predicates for one rule is how the loose one survives.

Owns: `ui/primitives/touch-targets.test.ts` and `composer-accessibility.test.ts`.

- [ ] One predicate audits every interactive component; the duplicate regex is deleted, not
      merely relaxed
- [ ] A single-axis shrink fails for every audited component (show the mutation on at least
      two, one inside and one outside `ui/primitives/`)
- [ ] A component whose path fails to resolve still fails loudly and by name (T81's rule)

#### T86 — Make files-and-terminal.contract.test.ts parse its own flow's steps

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T72, T78`

**No test anywhere parses `maestro/files-and-terminal.yaml`'s steps.** `grep -rn
"agent-upload" e2e src` returns nothing; only `file-download.contract.test.ts` uses T72's
`parseMaestroSteps`. That is exactly how this flow came to carry `assertNotVisible` on the
upload panel _after_ T78 mounted the `filePicker` that makes it render — a step that would
have failed on the first real device run, caught only by a human reading the yaml at the
merge gate. The same file already carried a "CORRECTED AT THE P5-W20 MERGE GATE" paragraph
for the identical failure one wave earlier.

There is a second, related hollowness in the same file:
`files-and-terminal.contract.test.ts:121` claims to guard the upload-omitted assertion, but
its predicate only matches the _source shape_ of `UploadPanel`'s internal guard
(`if (!client || !filePicker) return null;`) — never whether the route actually supplies a
`filePicker`. So mounting a real picker could never fail it, and the file now asserts two
things that cannot both describe a working app.

Owns: `e2e/flows/files-and-terminal.contract.test.ts`.

- [ ] The test parses its own flow's steps and cross-checks every `id:` selector against
      real source, the way `file-download.contract.test.ts` already does
- [ ] A step asserting visibility that the wired app contradicts fails the test, by name
      (show the mutation in both directions)
- [ ] The hollow line-121 predicate is replaced by one that reads the route's actual props,
      not the panel's internal guard

#### T87 — Declare @picompanion/highlight and the blocked native dependencies

`labels: phase-5, area: android` · `wave: P5-W24` · `depends-on: T35A2, T60C`

**This task cannot be executed by an agent.** `npm install` / `npm ci` / any
`package.json`-dependency or `package-lock.json` edit is refused by the permission
classifier, and no agent has been able to add a package in more than twenty waves. It is
recorded here because it is the **only red CI job** in the repository and it blocks the
Phase 5 exit gate.

`run-guard-declared-workspace-deps` fails because
`apps/android/src/features/files/file-syntax-highlight.ts` (added in `5b0b5c8`, T35A2)
imports `@picompanion/highlight`, which `apps/android/package.json` does not declare. The
guard prints the exact fix:

```
npm install @picompanion/highlight@0.3.0-beta.2 --workspace=@picompanion/android --save-exact
```

Blocked on the same grant, and needed by tasks already filed: `expo-sqlite` (T68, T76),
`react-native-webview` (T80), the audio/speech packages (T83),
`@react-native-community/netinfo` (T88), `expo-document-picker` / `expo-image-picker` /
`expo-sharing` (T78's adapters are mounted but permanently unavailable without them),
`expo-notifications` and `expo-device` (T60C).

- [ ] `run-guard-declared-workspace-deps` exits 0
- [ ] Every package added is pinned exactly and recorded in `package-lock.json`
- [ ] Nothing that was building behind an injected interface is rewritten to bypass it —
      the fakes stay, the real adapters simply start resolving

#### T88 — Mount native-network-reachability so the network-path-change rule can fire

`labels: phase-5, area: android` · `wave: P5-W24` · `depends-on: T32P1, T87`

`src/platform/native-network-reachability.ts` is a real, complete, **entirely unmounted**
adapter — confirmed by two independent import-graph walks at the P5-W22 gate, and
disclosed in its own doc comment since T32P1. Until it is mounted, `resume-signals.ts`'s
`"network-path-change"` rule can never fire, so a Wi-Fi-to-cellular handoff produces no
resume signal at all.

Blocked on `npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1`
(T87). One line in `core.ts` after that.

Owns: the mount site in `app-shell/core.ts`.

- [ ] A simulated path change produces a real `"network-path-change"` resume signal, proven
      by the signal arriving — registration is not receipt
- [ ] The polling fallback still works when the native module is absent, in its named state
- [ ] Report the exact install command if the grant has still not landed, and say plainly
      that no real native module was loaded

#### T89 — Guard against a wave commit that reverts an earlier commit in the same wave

`labels: phase-5, area: android` · `wave: P5-W23` · `depends-on: T32S15`

At P5-W22 one task reconstructed a shared file from a **stale baseline** using git plumbing
and silently reverted another task's fix that had landed 4.5 minutes earlier, then asserted
in its own commit message that the reverted hunk was "not-yet-committed". Nothing in the
pipeline detects this. It cost the wave a real regression that every task's self-reported
test count concealed, because an orphaned uncommitted copy of the reverted fix was sitting
in the working tree the whole time.

The check is cheap: for a commit range, flag any later commit that re-introduces text an
earlier commit in the same range deleted from the same file.

Owns: a new `scripts/ci/run-guard-*.mjs` plus its `node --test` unit tests, matching the
five existing guards' shape exactly.

- [ ] The guard flags the real P5-W22 case (`9ac1184` vs `acacff2`) when pointed at that
      range, naming both commits and the file
- [ ] It does not flag a legitimate revert whose message says so, nor an unrelated edit that
      happens to restore similar text elsewhere in the file — show a true negative
- [ ] Unit tests follow the existing `scripts/ci/*.test.mjs` conventions and pass

#### T90 — Make the touch-target audit read hitSlop's value, not merely its presence

`labels: phase-6, area: android` · `wave: P6-W1` · `depends-on: T81, T85`

T85 correctly deleted `composer-accessibility.test.ts`'s duplicate 48dp regex and made
`ui/primitives/touch-targets.test.ts`'s `elementMeetsTouchTarget` the **sole** proof for all
11 audited components. Its `hitSlop` fallback is `/hitSlop=\{?\d/` — a **presence** test that
never reads the number. `Chip.tsx` is the only audited component declaring no
`minHeight`/`minWidth` at all, so its entire 48dp guarantee now rests on that unread value.

Independently reproduced at the P5-W23 merge gate: `Chip.tsx` `hitSlop={14} -> hitSlop={1}`
still passes **23/23**; deleting `hitSlop` entirely fails by name, 22/23. The predicate
catches absence and never magnitude. The hole predates T85, but T85 is what made it
load-bearing.

Fixing it needs a real decision, which is why the gate filed it instead of inventing a
threshold: `hitSlop` is symmetric, so the effective target is the element's own resolved
height plus `2 x hitSlop`. Either compute that against the component's real declared
dimensions, or give `Chip` an explicit `minHeight`/`minWidth` so it leaves the branch.

Owns: `ui/primitives/touch-targets.test.ts` and, if you take the second route, `Chip.tsx`.

- [ ] `hitSlop={1}` on any audited component fails, by name
- [ ] The legitimate `hitSlop` pattern still passes, and the threshold is justified in a
      comment against the element's real resolved dimensions — not a magic number
- [ ] The strict-AND `minHeight`/`minWidth` branch T85 shipped still bites on a single-axis
      shrink (show the mutation on two components, one outside `ui/primitives/`)

#### T91 — Close the prose-premise falsification class T84 does not catch

`labels: phase-6, area: android` · `wave: P6-W2` · `depends-on: T72, T84, T86`

T84 was filed to stop a Maestro flow's prose from asserting a premise another task had
destroyed. It does not. The P5-W23 merge gate built a detached worktree at `84a9738` — the
exact P5-W22 tree whose comment was falsified — copied HEAD's gate in, and ran it: **it
passes**. It also passes on P5-W23's own falsified `files-and-terminal.yaml` comment.

T84 is a real, mutation-proven gate for a **narrower** class: citations — file paths,
PascalCase symbols, quoted-content claims. P5-W22's defect was an unquoted **premise**
("the route passes no `webview` prop") whose every citation was valid. T86's step-parsing is
what actually closes the class, and only for one flow out of twelve.

Two routes, either acceptable: extend T84's `checkFileContentClaims` to unquoted premise
prose, or extend T86's disk-parsing pattern to the remaining flows. The second is duller and
more likely to hold.

- [ ] The gate fails on the real `84a9738` tree, proven by running it there, not by reading
      its code
- [ ] It does not fire on merely explanatory prose — show the true negative with a mutation
- [ ] State plainly which flows are covered and which are not; a partial gate that claims
      full coverage is worse than none

#### T92 — Wire run-guard-no-wave-self-revert into CI, scoped to the PR's own range

`labels: phase-6, area: tooling` · `wave: P6-W1` · `depends-on: T89`

T89 built the guard and deliberately did not wire it: over full history it reports **43
findings across 13 files**, all legacy (oxfmt reformats, old T27A1/T30B/T31B fix-ups). But
the **range-scoped** form is already clean — `24db6bb..HEAD` -> OK across 7 commits — so a
PR-scoped job (`merge-base..HEAD`) is wireable today. It would have been the only automated
catch for P5-W22's silent revert.

`.github/workflows/ci.yml` currently runs five guards; this one is referenced nowhere.

- [ ] The guard runs in CI over the PR's own range only, and the job is green on `main`
- [ ] A PR containing the P5-W22 pattern fails that job — prove it against `acacff2^..9ac1184`
- [ ] Legacy history is excluded by RANGE, never by a suppression list that would also hide
      a real future finding

#### T93 — Fail a wave that ends with a dirty working tree

`labels: phase-6, area: tooling` · `wave: P6-W1` · `depends-on: T89`

**The highest-leverage item on this list.** An orphaned uncommitted fix has now concealed
the true state of `main` in two consecutive waves:

- P5-W22's silent revert was survivable only because an uncommitted copy of the reverted fix
  sat in the working tree.
- P5-W23 shipped a **red** `main` at `f4446ff` — two committed assertions about the same
  file that could not both pass — and the verifier reported `2141 passed`, a number that
  exists only with two uncommitted files applied. Every gate that verifier ran (whole suite,
  the T86 mutation, T80's "typecheck clean") tested content no commit contained.

Nothing in the pipeline fails when a wave ends dirty, and every verifier that runs `vitest`
in place tests the working tree rather than `HEAD`.

- [ ] A wave-end check fails on a non-empty `git status --porcelain`, naming the files
- [ ] The verifier's own instructions run the suite from a clean checkout (or `git stash`
      first, restoring afterwards) — a documented procedure, not a suggestion
- [ ] Prove it against `f4446ff` with its two files restored: the check must fail there

#### T94 — Retire mic-permission-port.ts or give it a production consumer

`labels: phase-6, area: android` · `wave: P6-W5` · `depends-on: T83`

T83 correctly collapsed the double microphone prompt onto `VoiceCapturePort`, which left
`mic-permission-port.ts` with **zero production consumers**. It is honestly disclosed in its
own docstring, but it is now kept alive solely by `composer-inputs.contract.test.ts:251`
asserting its export exists — a contract test pinning production-dead code in place.

Decide and record: delete it, or give it the consumer its existence implies. Either is fine;
leaving a test as a module's only reason to exist is not.

- [ ] The module is deleted along with the assertion that pinned it, or it has a real
      production caller proven by a value arriving
- [ ] `composer-inputs.yaml` and every contract test still agree with the source after the
      change — read their comments, not only their steps

#### T95 — Surface a recovered awaiting-confirmation turn in the transcript

`labels: phase-6, area: android` · `wave: P6-W2` · `depends-on: T76`

T76 disclosed this itself. `turnOutbox.getRecoveredTurns()` is a real source of truth and no
screen reads it: a turn recovered after process death is `"awaiting-confirmation"` and the
user is shown nothing about it.

Note the honest limit T76 also recorded: `expo-sqlite` is uninstallable, so `doOpen()`
degrades before the recovery caller runs and the whole path is a no-op on a real device
today (T87). Build the UI behind the same injected interface, prove against a fake, and say
plainly that no real SQLite file was opened.

- [ ] A recovered turn actually appears in the transcript in a named state, proven by the
      value arriving — registration is not receipt
- [ ] The empty case renders nothing rather than an empty shell
- [ ] Report the exact install command and the fact that the production path stays degraded

#### T96 — Close the guard-clean-working-tree CI item as will-not-wire, with the reason

`labels: phase-6, area: tooling` · `wave: P6-W2` · `depends-on: T92, T93`

T93 shipped `scripts/ci/run-guard-clean-working-tree.mjs` and filed a follow-up to wire it
into `.github/workflows/ci.yml`. **That follow-up is wrong and must not be actioned as
written.** The P6-W1 merge gate proved why, by building pristine worktrees rather than
reading the code:

- At `9ac1184` — P5-W22's silent revert — the guard returns **exit 0**.
- At `f4446ff` — the commit where `main` was **red** — it returns **exit 0**.

`actions/checkout` always produces a clean tree, and `npm ci` plus every build write only
`.gitignore`d paths (`node_modules/`, `dist/`, `packages/protocol/src/generated/validation/*.aot.ts`).
A `guard-clean-working-tree` job in CI would be **green by construction on every run** — the
exact "a fix that nothing can fail" shape T84 already demonstrated once this month.

The guard is sound where T93 actually scoped it: a **local wave-end check**, run as the last
step before a wave is reported done, which is where both motivating failures occurred. That
is already `CLAUDE.md`'s procedure.

- [ ] The CI-wiring item is closed as will-not-wire, with the two exit-0 reproductions
      recorded so nobody re-opens it
- [ ] `CLAUDE.md`'s wave-end procedure and the guard's own CLI doc agree on when it runs
- [ ] Nothing that DOES belong in CI (T92's range-scoped self-revert job) is disturbed

#### T97 — Carry streamingBehavior through the Pi RPC prompt command

`labels: phase-6, area: daemon` · `wave: P6-W2` · `depends-on: T38B0a, T38B0b`

**A scope hole that makes a later task unbuildable, found by the P6-W1 gate's own diff of
Pi's `.d.ts`.** T38B0a added `streamingBehavior?: "steer" | "followUp"` to the protocol.
Pi's real `prompt` command carries it (`rpc-types.d.ts:17-19`). Our mirror's `prompt` does
**not**, and no task owns adding it: T38B0b's grant is `rpc-types.ts` for _"these two
commands only"_ (`set_steering_mode`, `set_follow_up_mode`), and T38B0c owns only
`session.ts`.

T38B0c's third checkbox is _"a client can route an individual message as a steer or as a
follow-up using T38B0a's field."_ It cannot: `PiCliRuntime.prompt()`
(`cli-runtime.ts:107-116`) takes no such argument, and `PiRpcCommand`'s trailing
`| { id?: string; type: string }` catch-all means a dropped field **typechecks silently** —
so the gap would ship green. This must land before T38B0c starts in P6-W3.

- [ ] `prompt` mirrors Pi's optional `streamingBehavior` exactly, verified against the
      installed Pi's own `.d.ts` (READ-ONLY — never edit that tree)
- [ ] Dropping the field somewhere in the chain FAILS a test — the catch-all arm must not be
      able to swallow it silently; show the mutation
- [ ] Omitting the field preserves today's behaviour exactly

#### T98 — Export the extension fixtures from frontend-core's public testing barrel

`labels: phase-6, area: core` · `wave: P6-W2` · `depends-on: T40A1`

T40A1's second acceptance criterion is **"Fixtures are shared by web and Android."** They
are not, and this was not disclosed. `frontend-core`'s `exports` map has a single `"."`
entry; the only route out is `src/index.ts` -> `export * as testing from "./testing/index.js"`;
and **`testing/index.ts` re-exports nothing from `fixtures/extensions/`**. The P6-W1 gate
proved it by importing the real package export from `apps/web` and printing the barrel: 43
symbols, `loadExtensionFixture` not among them. The fixtures are reachable only from their
own colocated test.

Editing `testing/index.ts` was outside T40A1's `Owns` grant, so this is a scope bind rather
than misconduct — but the criterion is unmet and the README shows a `from "./index.js"`
usage example that cannot work. The precedent file (`timeline/fixtures/`) hits the same bind
and discloses it at length in `apps/android/.../message-row-model.test.ts:20-41`.

Either export them, or record the decision that fixtures stay in-package — but not both
silently. Do this alongside T40A2 so the second half lands already reachable.

- [ ] A test in `apps/web` AND one in `apps/android` import a fixture through the package
      export `@picompanion/frontend-core` and a real value arrives — registration is not
      receipt
- [ ] The README's usage example matches what actually resolves
- [ ] If the decision is instead "in-package only", the criterion is struck from T40A1 and
      T40A2 with the reason recorded

#### T99 — Fail the Pi-mirror contract test loudly on CI, and close get_entries' drift

`labels: phase-7, area: daemon` · `wave: P7-W1` · `depends-on: T38A0, T51A`

Two mirror findings from the P6-W1 gate's own field-for-field parse of Pi's `rpc-types.d.ts`
command union:

1. **The contract test silently SKIPS when no Pi is installed.** On CI (ubuntu, no `pi`) all
   four of T38A0's checks pass **vacuously**; the test only bites on a developer machine.
   A gate that cannot fail where it runs is not a gate.
2. **`get_entries` drift, disclosed by nobody.** Pi's is
   `{id?, type:"get_entries", since?: string}`; ours omits `since`. T38A0 disclosed
   `get_tree`'s extra `targetId?: string`; this one no report mentioned.

**CORRECTED (T99, P7-W1): this originally said "all 35 command arms".** T51A counted by hand
(`docs/pi-extension-compatibility.md` §9.1) and found the real total is **32** `RpcCommand`
request-type arms plus **2** separate `RpcExtensionUIRequest`/`RpcExtensionUIResponse` message
types outside that union — not 35, and by the time this task ran `get_entries`'s drift was no
longer "disclosed by nobody": T51A's own verdict table records it, and declined to fix it only
to avoid colliding with this task's file.

- [x] The contract test fails loudly rather than skipping when `CI=true`. Decided per this
      task's own two documented options: vendored a small, exact, pinned fragment of Pi's real
      `.d.ts` (the arms and `RpcSessionState` fields this test already covered, plus
      `get_entries`) into `rpc-types.pi-mirror.contract.test.ts` itself, so the field-for-field
      comparison runs — and can fail — for real on every machine including CI, which has no
      `pi` CLI. A second `describe.skipIf` block checks that vendored snapshot for staleness
      against an installed Pi when one is present; `skipIf` reports as vitest's own distinct
      "skipped" count, never folded into "passed", so a CI run with no Pi cannot read as a
      false green for that half either. Follows T136's precedent (vendor one small fragment
      with a parity check, not the whole package).
- [x] `get_entries` matches Pi's signature (`{ id?: string; type: "get_entries"; since?: string }`,
      verified against the installed `@earendil-works/pi-coding-agent@0.84.1`), and the fix is
      mutation-proven: reverting to the pre-fix arm fails the named
      `'get_entries' matches the vendored Pi RpcCommand snapshot field-for-field` test (1
      failed, 1 passed, 21 skipped under `-t "get_entries"`); restoring it byte-identically
      returns the file to 23 passed.
- [x] T51A's audit (`docs/pi-extension-compatibility.md` §9.1-§9.2) already recorded the full
      32-arm verdict table before this task ran; this task does not re-derive it.

#### T100 — Delete or consume packages/protocol/src/literal-union.ts

`labels: phase-7, area: protocol` · `wave: P7-W1` · `depends-on: T51A`

Imported by **nothing anywhere in the repository** — its only hit is a URL in its own header.
It survived every previous import-graph walk because `packages/protocol`'s `exports` map is a
wildcard (`"./*"`), which makes every module a public entry point and therefore trivially
"reachable". That is a **sixth** walker over-reporting mode, and worth recording as such
alongside the five already catalogued.

Low value, opportunistic. Delete it, or give it the consumer its existence implies.

- [ ] The file is deleted, or has a real importer
- [ ] The wildcard-exports walker caveat is written down where the next gate will read it

#### T101 — Give the server e2e and integration lanes a bounded, sandboxed runner

`labels: phase-6, area: tooling` · `wave: P6-W4` · `depends-on: T38A0`

`packages/server` has 312 test files, 56 of them `*.e2e.test.ts` / `*.real.e2e.test.ts`. They
open real sockets and spawn real daemon and terminal processes, so no agent can run them
under this repository's rules, and none ever has.

The P6-W1 verifier reported the **whole** server workspace as unverifiable on this basis. The
merge gate corrected that, and the correction matters: CI does not run the full suite —
`server-tests-*` runs `npm run test:unit`, which excludes `**/*.e2e.test.ts` and **completes
in 270 seconds in the foreground**, 3498 tests. So the real gap is only the `test:e2e` /
`test:integration` lanes, not the workspace.

Two failures were observed in that 270s run — `checkout-git.test.ts` (EBUSY on a Windows
temp rmdir) and `relationship-controller.test.ts` (30s timeout) — both of which **pass in
isolation** under `--maxWorkers=1`. Windows parallelism flakes, not wave-caused; neither file
was in P6-W1's diff. They should be fixed or serialised, not left to flake.

- [ ] The e2e/integration lanes run somewhere bounded, with the port rules honoured — never
      6767, never 6768, ephemeral ports and isolated home directories only
- [ ] The two Windows parallelism flakes are fixed or explicitly serialised, with the cause
      recorded rather than a retry bolted on
- [ ] `npm run test:unit`'s 270s foreground time is documented so no future verifier reports
      the workspace as unverifiable again

#### T102 — Bring packages/server test files under typecheck

`labels: phase-6, area: tooling` · `wave: P6-W5` · `depends-on: T97`

**`packages/server/tsconfig.server.json` excludes `src/**/\*.test.ts`, so roughly 260 test
files in the largest workspace in this repository are never typechecked by CI.** The P6-W2
merge gate measured what that hides: a tsconfig that includes them reports **1071 errors**
(`TS7006`implicit-any,`TS2835` missing ESM extensions, and others).

This is not a hygiene item. It is what made T97's interface change **unfalsifiable**: deleting
`streamingBehavior?: PiPromptStreamingBehavior` from `PiRuntimeSession.prompt` in `runtime.ts`
left `npm run typecheck --workspace=@picompanion/server` at **exit 0** and every server test
green, because the only call site passing a third argument lives in `cli-runtime.test.ts` -
excluded from the project. That hole was closed for one signature by a source-text assertion
(`81cff31`); it will reopen for the next interface change unless the exclusion goes.

1071 errors is too large for one commit and most are mechanical. Land it incrementally and
report the real count after each pass; a partial improvement with a shrinking, enforced
ceiling is a good outcome. What is **not** acceptable is silencing the errors with `any`,
`@ts-expect-error`, or a widened `skipLibCheck`.

- [ ] Test files in `packages/server` are typechecked by a command CI runs, with the real
      error count reported before and after
- [ ] Deleting a parameter from an interface that only a test file passes now FAILS typecheck - prove it with T97's exact mutation on `runtime.ts`
- [ ] No error is closed by `any`, `@ts-expect-error`, or a suppression list; if a residual
      count remains, it is enforced as a ceiling that cannot grow

#### T103 — Export the actions domain from frontend-core's public barrel

`labels: phase-6, area: core` · `wave: P6-W3` · `depends-on: T47A1a, T98`

The exact bind T98 closed for the extension fixtures, one directory over.
`packages/frontend-core/src/actions/index.ts` **does not exist**, and `src/index.ts` carries no
`export * as actions from "./actions/index.js"`, so T47A1a's `RequestArbitrator` - the thing
that makes an approval answerable exactly once across our two clients - is reachable from
neither app. Confirmed at the P6-W2 gate by grep and by an independent import-graph walk.

T47A1a's Owns grant was `arbitration.ts` and its test, so this was a scope bind and it was
disclosed in-commit. It must land in P6-W3 because **both** T47A1b and T47A2 (P6-W4) need it.

Follow T98's shape exactly (`f55ee37`), including its proof: an importing test in each app,
not a re-export the barrel merely mentions.

- [ ] A test in `apps/web` AND one in `apps/android` import the arbitrator through the package
      specifier `@picompanion/frontend-core` and a REAL VALUE arrives - an import that
      resolves to `undefined` still passes a truthiness check on the namespace object
- [ ] Deleting the export line fails those tests, in both apps - show the mutation
- [ ] The Android-side test does not reach `react-native` (the RN-in-vitest limitation)

#### T104 — Assert §11.7 fixture coverage by parsing the plan table

`labels: phase-6, area: core` · `wave: P6-W5` · `depends-on: T40A2`

`packages/frontend-core/src/testing/fixtures/extensions/extensions.test.ts` asserts §11.7
coverage against a **hard-coded 12-name array**. The names are right today - the P6-W2 gate
read `plan.md:825-865` itself and confirmed the mapping is name-for-name, not a count - but a
thirteenth row added to the plan's "First-class UI through bridge elements" table would fail
nothing at all. The guarantee "every §11.7 extension has a fixture" is currently a snapshot,
not an invariant.

Parse the table out of `plan.md` and drive the coverage assertion from it, the way the
`scripts/ci/run-guard-*.mjs` family reads real source rather than a copied list.

Small and opportunistic; do not let it grow into a plan-parsing framework.

**Second, same shape, found at the P6-W3 gate:** `EXTENSION_TO_PLAN_ROW` in
`apps/web/src/features/extensions/extension-fixture-renderers.test.tsx` (T40A3) maps all 12
§11.7 rows byte-for-byte correctly today - the gate read the plan table and diffed it row by
row - but the mapped values feed only the `it(...)` title. A wrong or stale row **renames a
test instead of failing one**. Close both sites in one pass; they are the same defect twice.

- [ ] Adding a row to §11.7's table with no matching fixture FAILS the test, by name - show
      the mutation
- [ ] Removing a fixture that §11.7 still lists FAILS the test, by name
- [ ] Mutating any of `EXTENSION_TO_PLAN_ROW`'s 12 values FAILS a named assertion rather than
      renaming a test
- [ ] The parser fails loudly if the table cannot be found, rather than passing vacuously -
      a check that cannot fail where it runs is not a check

#### T105 — Give editFromHere and RequestArbitrator production consumers

`labels: phase-6, area: web` · `wave: P6-W4` · `depends-on: T38A1b, T38A3, T103`

Two complete, tested, fully exported modules that **nothing in either app calls**:

- `packages/frontend-core/src/sessions/tree-edit-shortcut.ts` (T38A1b, P6-W3). It was the
  P6-W3 import-graph walk's single new orphan. The merge-gate commit `974a7b4` added the
  missing `src/sessions/index.ts` re-export, so the ROUTE is open - but a route is not a
  caller.
- `packages/frontend-core/src/actions/arbitration.ts`'s `RequestArbitrator` (T47A1a, P6-W2),
  exported through the package specifier by T103 and independently verified arriving in both
  apps. Also zero production consumers.

Both were disclosed by their own authors and both were outside their Owns grants, so this is
scheduled work, not misconduct. But "shipped, exported, and called by nobody" is how a module
becomes dead code that every future walker has to re-adjudicate - and an arbitration mechanism
that no approval path consults does not make anything answerable exactly once.

- [ ] A real user-facing path calls `editFromHere` and the resulting fork appears - proven by
      the value arriving, not by the import resolving
- [ ] An approval or dialog path consults `RequestArbitrator`, and a second answer to an
      already-answered request is observably superseded in the UI
- [ ] Deleting either call site fails a named test - show both mutations

#### T106 — Prove the recovered-turn banner above the source-text layer

`labels: phase-6, area: android` · `wave: P6-W5` · `depends-on: T95, T87`

**Read this before acting: the P6-W3 merge gate reported that T95's banner had "zero
executable proof" because two mutations left the whole `apps/android` suite green. That report
is WRONG.** Both mutations were re-run at the P6-W3 review against the committed tree:

- `recovered-turn-banner.tsx`'s body replaced with `return null` -> **2 failed / 2165 passed**
- `<RecoveredTurnBanner turns={recoveredTurns} />` deleted from the route -> **1 failed /
  2166 passed**

T95's assertions bite. Do not re-file this as a hollow-check finding and do not rewrite those
tests as though they were decorative.

What is genuinely missing is narrower and honestly disclosed by T95 itself:

1. The view layer is proven by anchored source-text assertions only, because
   `recovered-turn-banner.tsx` reaches `react-native` and cannot render under this workspace's
   vitest - the repo-wide limitation, not a shortcut this file invented. A device-level or
   Maestro assertion on the banner's actual text is the only thing that closes it.
2. It is **display-only**. Nothing calls `OutboxController.confirmResend`, so a user shown a
   recovered turn can neither retry nor discard it.
3. The production path stays degraded: `expo-sqlite` is uninstallable (T87), so
   `getRecoveredTurns()` returns null forever on a real device and the banner can never appear
   there. Report the exact install command; do not pretend otherwise.

- [ ] A Maestro flow (or the render capability itself) asserts the banner's real text with a
      recovered turn present, and the flow's steps are parsed by a contract test
- [ ] Confirm and discard actions exist and reach `OutboxController`, proven by the call
      arriving at a counting fake
- [ ] The degraded-production reality is stated plainly, with the install command

#### T107 — Honour streamingBehavior on the already-active-turn path

`labels: phase-6, area: daemon` · `wave: P6-W4` · `depends-on: T38B0c`

`packages/server/src/server/agent/providers/pi/agent.ts`'s `startTurn` has two branches.
The idle branch forwards the routing choice correctly (`:1426-1429`:
`this.runtimeSession.prompt(payload.text, payload.images, options?.streamingBehavior)`). The
**already-active-turn** branch does not: `:1394` calls `this.runtimeSession.steer(payload.text,
payload.images)` and `:1396` calls `this.runtimeSession.followUp(...)`, both **ignoring
`options?.streamingBehavior` entirely**.

So a per-message steer/follow-up choice is silently dropped for exactly the case the feature
exists for - a message sent while a turn is already running. Verified by reading the file at
the P6-W3 review; T38B0c disclosed it in its own commit message and no task owned it.

- [ ] A per-message `streamingBehavior` sent while a turn is ACTIVE reaches the runtime
      session, proven by the value arriving at a recording fake
- [ ] Dropping it again fails a named test - show the mutation. Note that
      `tsconfig.server.json` excludes `src/**/*.test.ts` (T102), so a green typecheck is not
      evidence here
- [ ] Omitting the field preserves today's behaviour on both branches

#### T109 — Warn once on an unknown channel in the Pi UI decoder

`labels: phase-6, area: daemon` · `wave: P6-W5` · `depends-on: T40A3`

**STATUS: CLOSED at the P6-W5 review — already satisfied, no code change was needed or
made.** The task's premise was wrong: it assumed the P6-W3 gate's daemon-side prototype had
been removed. The de-duplicated warning has shipped since the T04 port / T07B
(`decoder.ts:11-17`: a module-level `Set<string>`, `warnUnknownChannel(ch)` called from the
`channel` op branch), and T40A3 (`b051689`) added the counting-fake test —
`git merge-base --is-ancestor b051689 <P6-W5 base>` confirms both predate the wave.

All three acceptance criteria were verified by mutation at the review, against the committed
tree, with `decoder.test.ts` at a 4-passed baseline: deleting the de-duplication guard
(`if (unknownChannelWarned.has(channel)) return;`) → **3 failed / 1 passed**; deleting the
`warnUnknownChannel(ch)` call entirely → **3 failed / 1 passed**; the true negative (a known
channel warns zero times) is one of the four. Both mutations restored byte-identically.

One live consequence: T102's commit deferred seven `ui-bridge` test files to "whoever picks
up ui-bridge once T109 lands". T109 never needed to land, so that re-inclusion is now
**T120**.

`packages/server/src/server/agent/providers/pi/ui-bridge/decoder.ts` drops unrecognised
channels **silently**, so a new extension publishing an unmapped channel produces no signal
anywhere in the daemon. T40A3 closed the equivalent gap on the client side and proved the
de-duplication with a counting fake; the P6-W3 merge gate prototyped the daemon half during
mutation work and removed it again, since it was outside scope.

Small and opportunistic. The de-duplication is the whole point - a per-frame warning on a
streaming channel is worse than silence.

- [ ] An unknown channel produces exactly ONE diagnostic, proven with a counting fake, not by
      reading a log
- [ ] A known channel produces none - show the true negative
- [ ] Removing the de-duplication set fails a named test

#### T110 — Send fork, clone, rename and the queue modes from the client

`labels: phase-6, area: client` · `wave: P6-W6` · `depends-on: T38A1b, T38A4, T38A5, T38B0c`

**The single root cause behind four shipped-but-inert affordances.** `packages/client/src`
contains **zero** occurrences of `forkAgent`, `cloneAgent`, or a rename request - verified at
the P6-W4 review by `grep -rn "forkAgent|cloneAgent" packages/client/src | wc -l` returning
`0`. Every consumer above it therefore degrades to a disabled path or a "Not connected"
banner, while still rendering an enabled control:

- `apps/web`'s "Edit from here" button. `host-session-screen.tsx`'s
  `adaptEditFromHereForkClient(client)` gates on `typeof client.forkAgent === "function"` and
  so returns `undefined` on **every production render**. `EditFromHereSurface` renders the
  button unconditionally; `use-edit-from-here.ts:145-148` checks `!client` only on activation
  and sets "Not connected - can't branch this conversation yet."
- `packages/frontend-core`'s `sessions/tree-edit-shortcut.ts` (T38A1b) and the session tree's
  fork chain (T38A1a/T38A3) - modelled, exported, tested, and unreachable.
- T38A4's session rename/metadata reconciliation, for the same reason.

This is the wire gap, not a UI gap. Close it in `@picompanion/client`'s `DaemonClient`, on top
of the protocol messages that already exist, and the four consumers light up together.

**WIDENED at the P6-W5 review.** The same hole blocks the queue-mode control, T38B1a, which
runs in this same wave. `packages/protocol/src/messages.ts:1635-1680` defines
`set_steering_mode_request`, `set_follow_up_mode_request` and `get_queue_modes_request`;
`packages/server/src/server/session.ts:2147/:2149` dispatches all three and
`:3259/:3283` handle them. `grep -rn` across `packages/client/src` for any of those three,
plus `forkAgent`, `cloneAgent` and `renameAgent`, returns **0**. Six client sends are
missing, not three, and they are one task's worth of work in one file.

T38B1a's second acceptance criterion - "a mode changed by another client is reflected here
without a manual refresh" - cannot be satisfied until this lands. It is running in parallel,
against an injected port, and will disclose the gap rather than fake it.

- [ ] `DaemonClient` exposes fork, clone, and rename methods that send real protocol messages,
      proven by the frame arriving at a recording fake transport - not by the method existing
- [ ] `DaemonClient` sends `set_steering_mode_request`, `set_follow_up_mode_request` and
      `get_queue_modes_request`, and surfaces their responses, proven the same way
- [ ] `adaptEditFromHereForkClient` returns a defined adapter for a real `DaemonClient`,
      proven by a test that constructs one rather than a hand-written object literal
- [ ] Deleting `client={editFromHereClient}` from `host-session-screen.tsx` FAILS a named
      test. It does not today: at the P6-W4 review, deleting it left the whole apps/web suite
      at 134 files / 1201 tests passed, byte-identical to baseline

#### T111 — Carry answeredBy through agent_permission_resolved

`labels: phase-6, area: protocol` · `wave: P6-W7` · `depends-on: T47A1a, T47A2`

T47A1a built `RequestArbitrator` so an approval is answerable exactly once, and T47A2 shows
contested/superseded state in the web dialog. But `agent_permission_resolved` carries no
`answeredBy`, so a second client learns only _that_ a request was resolved, never _by whom_.
"Contested" can be displayed locally and never attributed across clients.

- [ ] `agent_permission_resolved` carries the answering client's identity, round-tripped
      through a contract fixture
- [ ] A second client renders who answered, proven by the value arriving in the DOM
- [ ] Omitting the field keeps today's behaviour for a single-client session

#### T112 — Give pi_notice a consumer or delete it

`labels: phase-6, area: daemon` · `wave: P6-W6` · `depends-on: T40A2`

`pi_notice` is produced by the daemon and consumed by nobody - found by the P6-W4 import-graph
walk and confirmed by grep. Either surface it (it is the only channel the Pi provider has for
out-of-band operator-visible warnings) or remove the producer. Shipping a message type with no
reader is how a protocol accumulates dead surface that every future walker re-adjudicates.

Decide explicitly and record which way, with the reason, in the commit message.

- [ ] Either a consumer renders `pi_notice` and deleting that consumer fails a named test, OR
      the producer and its type are removed and no reference survives
- [ ] The chosen direction is stated with its rationale, not left implied

#### T113 — Deliver workflow:progress's step and total to the rail

`labels: phase-6, area: daemon` · `wave: P6-W7` · `depends-on: T40A4`

T40A4 drove the real `PiUiStateStore.applyChannel` for all three published channels and
recorded what each actually emits. `workflow:progress` sends `step` and `total`, but the
synthesis produces a `placement: "status"` progress element (which never reaches the rail)
plus - only when the channel sends `active: true` - a **pinned plain-text `widget`**. So the
rail shows "workflow - implement" as a label and the step/total never arrive anywhere a
renderer can read them. T40A4 disclosed this in its own report rather than faking a progress
bar; it is real work, not a defect in that task.

- [ ] `step`/`total` reach a pinned element's typed payload, proven against the real
      `applyChannel`, not a hand-written element literal
- [ ] The rail renders determinate progress from them, proven in the DOM
- [ ] Dropping either field fails a named test in `ui-bridge/state.test.ts`

#### T114 — Render elapsed time from startedAt, and settle Edit-from-here's gating

`labels: phase-6, area: web` · `wave: P6-W7` · `depends-on: T40A4, T105`

Two loose ends the P6-W4 gate found, both about an affordance that is present but does
nothing. Neither is a defect in the task that shipped it; both were disclosed.

**First: `startedAt` has no reader.** T40A4 carries `pi-goal:status`'s `startedAt` (epoch ms)
into both synthesized elements' typed payload, and that is proven server-side. But
`grep -rn startedAt` across `apps/web/src/features/extensions/renderers/` and
`apps/android/src/features/extensions/` returns **nothing** - no elapsed time is displayed
anywhere. Today the value is visible only through `RailElementCard`'s raw-payload disclosure.
Note that `published-channels.test.tsx`'s `startedAt` assertion CANNOT prove this end to end:
it reads back a literal declared in its own file (verified - deleting both `startedAt` spreads
from `ui-bridge/state.ts` leaves that file 3/3 green while `state.test.ts` fails 2).

**Second: an enabled button that can only fail.** Every user message ships an enabled "Edit
from here" control whose only possible outcome is the banner "Not connected - can't branch
this conversation yet." Decide whether to gate the control on a live fork-capable client or
keep it and explain the state; either is defensible, shipping it undecided is not.

CORRECTED at the P6-W6 review: this paragraph said "until T110 lands". T110 landed (`5806cff`)
and did NOT unblock it, and never could have. There is no fork/clone/rename wire message for a
client to send at all - `grep -ciE "fork_agent|clone_agent|rename_agent"` over
`packages/protocol/src/messages.ts` and `packages/server/src/server/session.ts` returns 0 and 0,
re-confirmed at that review. T110 disclosed exactly this at `daemon-client.ts:3050-3080`, naming
the six schemas that would be required. No task owns adding them, so the fork-capable client
this control waits on does not exist and is not scheduled. Gate accordingly, or explain the
state truthfully - do not write prose promising a future task that is not filed.

- [ ] A renderer displays live elapsed time from `payload.startedAt`, proven in the DOM with a
      controllable clock
- [ ] The Edit-from-here gating decision is implemented and its rationale recorded
- [ ] Both changes fail a named test when reverted - show the mutations

#### T115 — Resolve three unreferenced modules

`labels: phase-6, area: repo` · `wave: P6-W6` · `depends-on: T101`

The P6-W4 import-graph walk stabilised at **27 orphans**, identical base-vs-HEAD, after
suppressing six catalogued over-reporting modes (bare side-effect imports and `export ... from`
barrels; doc-comment prose forging edges; non-`src` entry points such as `app.config.ts`,
`plugins/**`, `modules/**` and `*.config.*`; ESM `.js`/`.jsx` specifiers not resolved back to
`.ts`/`.tsx` - which alone accounted for 807 false positives; CLI/child-process entry points;
and `packages/protocol`'s wildcard `"./*"` exports map). Of the survivors, three are genuinely
referenced by nothing:

- `packages/server/src/server/agent/providers/pi/provider-notices.ts`
- `packages/server/src/server/agent/providers/pi/session-stream-adapter.ts`
- `apps/android/src/features/share/index.ts`

For each: wire it to a real caller or delete it. Do not add a test that merely imports it -
"a fix that no test can fail is not a fix", and an import-only test makes an orphan invisible
to the walker without making it live.

- [ ] Each of the three is either called from a production path (proven by the call arriving)
      or removed outright
- [ ] The walker's orphan count drops by three, run base-vs-HEAD
- [ ] No module is rescued by a test whose only act is importing it

#### T116 — Install expo-router, or stop declaring it

`labels: phase-6, area: android` · `wave: P6-W6` · `depends-on: T87`

`apps/android/package.json` declares `"expo-router": "~6.0.13"` (line 25) and sets
`"main": "expo-router/entry"` (line 5), both since `10fe6b0` (P5-W10) - but the package has
**never been installed**: `grep -c '"node_modules/expo-router' node_modules/.package-lock.json`
returns `0`, and `node_modules/expo-router` does not exist. Consequences on `main` today:

- `npm run typecheck --workspaces` exits `2` with 15 x `Cannot find module 'expo-router'`
  (plus `app.config.ts(52,5) TS2353 edgeToEdgeEnabled`, a separate Expo config-typing issue)
- `apps/android` vitest is 172 passed / 1 failed of 173 files;
  `src/app/router-root.test.ts` fails on `Cannot find module 'expo-router/_ctx-shared'`

**This is not a P6-W4 regression, and equally not new.** Established at the P6-W4 review:
`git diff 1c9b43a..f126ad0 -- apps/android` is empty, no dependency line changed anywhere in
the range (the only `package.json` edit in it is `packages/server`'s test-script split, T101),
and the package was never in the lockfile. The P6-W3 review measured this workspace green at
173 files / 2167 tests only because a stale Vite dependency cache under `node_modules/.vite`
still resolved the specifier; that cache was cleared at 06:28 during P6-W4 (its mtime, with
only `.vite`/`.vite-temp` changed) and holds no expo-router chunk now. A long-standing defect
newly **exposed**, not newly introduced.

Blocked on the same grant as T87: `npm install` is refused by this repository's auto-mode
classifier, so no agent can install it. Report the command, do not work around it, and do not
vendor or stub the package.

    npm install expo-router@~6.0.13 --workspace=@picompanion/android --save-exact

- [ ] `expo-router` resolves, or the declaration and `main` entry are removed and the router
      root is rewritten against what IS installed
- [ ] `apps/android` typecheck exits `0` and vitest is 173/173
- [ ] Whichever way it goes, `run-guard-declared-workspace-deps` is green for this package

#### T117 — Split the plan.md loader out of apps/web's production graph

`labels: phase-6, area: web` · `wave: P6-W7` · `depends-on: T38A5, T104`

The acute half of this was fixed at the P6-W5 gate (`eb9fa55`): T38A5's barrel block was
deleted from `apps/web/src/features/sessions/index.ts`, taking `apps/web`'s build from three
`has been externalized for browser compatibility` warnings to zero. What remains is the
structural half.

`apps/web/src/features/sessions/plan-section-11-1-commands.ts` still imports `node:fs`,
`node:path` and `node:url` in a non-test file. It is unreachable from any production module
today, but only because one barrel block is absent - nothing enforces that.
`packages/frontend-core/src/testing/plan-table.ts`, committed one commit earlier in the same
wave, states the stricter rule for itself and follows it: the parser is pure, and each
`.test.ts` caller reads plan.md. Two tasks in one wave reached opposite conclusions about the
same problem.

Do what `plan-table.ts` does: leave `parseSection111RpcCommands` pure, move `loadPlanMarkdown`
and `loadSection111RpcCommands` into the two `.test.ts` callers
(`plan-section-11-1-commands.test.ts`, `rpc-command-web-parity.test.ts`), and add the guard.

- [ ] No non-test file under `apps/web/src` imports a `node:` builtin, enforced by a
      `scripts/ci/run-guard-*.mjs` that FAILS when one does - show the mutation by adding
      such an import and watching the guard fail
- [ ] `cd apps/web && npm run build` emits zero "has been externalized" lines
- [ ] Both T38A5 test files still pass with the loader moved into them

#### T118 — Drive the Android §11.7 matrix from the plan table

`labels: phase-6, area: android` · `wave: P6-W7` · `depends-on: T104, T40B1`

**T104 closed a defect on web and core; T40B1 reopened it on Android in the very next commit
of the same wave** (`git merge-base --is-ancestor 0bcbad3 2b91c2e` → yes). This is not
misconduct - the two ran in parallel and T40B1 started from the pre-T104 file - but it must
not stand.

`apps/android/src/features/extensions/extension-fixture-renderers.test.ts` carries a
hand-copied `EXTENSION_TO_PLAN_ROW` (`:122`), derives `EXPECTED_EXTENSIONS` from its own keys
(`:136`) rather than from plan.md, and consumes `requiredUi` (`:321`) in nothing but the
`it(...)` template literal at `:323`. A wrong or stale value **renames a test instead of
failing one** - the exact defect T104 was filed to close, and it even carries verbatim the
test title T104 had just deleted from the web file.

Reproduced at the P6-W5 review against the committed tree, baseline 15 passed:

| Mutation                                   | web / core (post-T104)                   | android (T40B1)       |
| ------------------------------------------ | ---------------------------------------- | --------------------- |
| `EXTENSION_TO_PLAN_ROW.todo` -> wrong text | web: **1 failed / 14 passed**, by name   | **15 passed - GREEN** |
| add a 13th row to plan.md §11.7            | core and web: **1 failed each**, by name | **15 passed - GREEN** |

Use `testing.parseSection117BridgeElementsTable` from `@picompanion/frontend-core`, exactly
as the web and core sites now do. Read T104's commit first and match its shape rather than
inventing a third one.

- [ ] Mutating any `EXTENSION_TO_PLAN_ROW` value FAILS a named Android test - show it
- [ ] Adding a 13th §11.7 row with no Android fixture FAILS a named Android test - show it
- [ ] `requiredUi` is load-bearing: it feeds an assertion, not only a test title
- [ ] The parser fails loudly if the table cannot be found

#### T119 — Give the server typecheck ceiling a floor and a coverage assertion

`labels: phase-6, area: tooling` · `wave: P6-W8` · `depends-on: T102`

T102's positive claim holds and was re-verified at the P6-W5 review: deleting
`streamingBehavior?: PiPromptStreamingBehavior` from `PiRuntimeSession.prompt` in
`providers/pi/runtime.ts` now makes `run-guard-server-test-typecheck-ceiling.mjs` **exit 1**
("1057 typecheck error(s), which is 3 MORE than the enforced ceiling of 1054"), where before
T102 the whole workspace typecheck exited 0. That is real and it closes T97's hole.

But `evaluateTypecheckCeiling` only tests `errorCount <= ceiling`, so the guard cannot detect
its own defeat. Two probes, both run at the review:

1. **One-line revert.** Adding `"src/**/*.test.ts"` back to `tsconfig.server.tests.json`'s
   `exclude` - undoing T102 entirely - takes the count 1054 -> 75 and the guard reports
   **OK, exit 0**. Its own failure text then invites lowering the ceiling to match.
2. **The compiler not running is indistinguishable from success.** `resolveTsgoBinary`'s
   throw is caught by `main`'s `try` around `runTsgo`; a plain `Error` carries no
   `.stdout`/`.stderr`, so `output` becomes `""`, which counts as zero errors. Run from a
   scratch repo where tsgo is unreachable, the guard prints
   "OK - 0 error(s) in packages/server test files (ceiling 1054)" and exits 0.

`guard-server-test-typecheck-ceiling.test.mjs`'s eight cases cover `countTypecheckErrors` and
`evaluateTypecheckCeiling` only; nothing covers the runner. A guard that reports success when
it did not run is worse than no guard.

- [ ] A count that drops far below the ceiling without an explicit ceiling change FAILS
- [ ] A shrinking resolved file set FAILS, so excluding files cannot be mistaken for fixing them
- [ ] tsgo being unspawnable FAILS loudly instead of reporting zero errors
- [ ] Both probes above exit non-zero - show each

#### T120 — Re-include the seven deferred ui-bridge test files

`labels: phase-6, area: tooling` · `wave: P6-W9` · `depends-on: T102, T109`

T102 excluded seven test files from the new strict typecheck project on the stated grounds
that "T109 owns decoder.ts and decoder.test.ts in that directory this wave", adding: "whoever
picks up ui-bridge next should fold them back into `include` ... once T109 lands". T109 turned
out to be already satisfied and correctly landed nothing, so this re-inclusion has no owner.
This task is that owner.

The seven, in `packages/server/tsconfig.server.tests.json`'s `exclude`:
`actions.test.ts`, `decoder.test.ts`, `identity.test.ts`, `payload-compat.fixtures.test.ts`,
`payload-compat.test.ts`, `revision.test.ts`, `state.test.ts` - all under
`src/server/agent/providers/pi/ui-bridge/`.

Land it after T119, so the re-baselined ceiling is enforced by a guard that has a floor.

- [ ] All seven are back in `include`, with `TYPECHECK_ERROR_CEILING` re-baselined to the
      real measured count and the before/after numbers reported
- [ ] No error is closed by `any`, `@ts-expect-error`, `@ts-ignore`, or `skipLibCheck`
- [ ] `packages/server`'s unit suite still passes

#### T121 — Wire the recovered-turn banner's outbox at the production mount

`labels: phase-6, area: android` · `wave: P6-W8` · `depends-on: T106, T87`

T106 added real Resend/Discard actions that reach `OutboxController`, proven against the real
unmodified controller (verified at the review: pointing `confirmRecoveredTurn` at a wrong id
fails 3 tests, including the unmocked-controller one). But the production mount passes no
`outbox`, so those actions render only in the `__DEV__` lab. Three doc comments -
`app-shell/core.ts`, `app/h/[serverId]/session/[agentId]/index.tsx`, and
`features/transcript/recovered-turn-banner.tsx` - each say "see T106's report for the exact
wiring that would close it **and who owns it**", and no task owned it. This is that task, so
the pointers resolve.

The obstacle is an instance split: `Composer` holds one `OutboxController` and
`AppCore.turnOutbox` holds another. Unify them, then pass `getOutbox()` at the session route.

Note the banner still cannot appear on a real device: `expo-sqlite` is uninstallable (T87), so
`getRecoveredTurns()` returns null there. Wire it anyway and state that plainly - do not
vendor or stub the package.

- [ ] One `OutboxController` instance serves both the composer and the recovered-turn banner,
      proven by a value arriving at a counting fake through the real mount
- [ ] The production route passes `outbox`; deleting that prop FAILS a named test
- [ ] The three doc comments are updated to name this task instead of an unfiled owner
- [ ] The T87 blocker is restated with the exact install command

#### T122 — Build `@picompanion/client` in the web CI jobs, or name the gap

`labels: phase-6, area: tooling` · `wave: P6-W8` · `depends-on: T110, T38B1a`

`apps/web` resolves `@picompanion/client` through that package's **built `dist/`** (its
`exports` map), never its source. CI's `web-tests` and `web-unit-tests-windows` jobs build
only `protocol`/`design-tokens`/`highlight`/`frontend-core`; only the `typecheck` job builds
the `protocol -> relay -> highlight -> client -> server -> cli` chain.

P6-W6 made the cost concrete, twice. (1) T38B1a's `DaemonTurnClient` declared
`setSteeringMode`/`setFollowUpMode` as `Promise<void>` while T110's real `DaemonClient`
returns `Promise<AgentProviderNotice | null>`; against the stale `dist` every local gate was
green, and against a built one `apps/web` had **13 `TS2345` errors**, one of them at the
production call site `routes/screens/host-session-screen.tsx(304,49)`. The mandatory
`typecheck` job was red at the wave tip. (2) At the gate, mutating
`DaemonClient.setFollowUpMode` to hardcode `mode: "one-at-a-time"` left
`daemon-agent-turn-client.fixture.test.ts` **14 passed (14)** against the stale `dist`, and
**1 failed / 13 passed** after rebuilding it. A web unit test can therefore pass against
client code that no longer exists.

- [ ] Either both web jobs build `@picompanion/client` before running, or a named,
      committed document records the staleness as a deliberate limitation
- [ ] A test or guard proves the chosen answer: with the build step, a deliberate
      source-only change to `packages/client` must change a web job's result
- [ ] The `daemon-agent-turn-client.ts` doc comment that now names T122 resolves

#### T123 — Move the two remaining dev-lab tests onto a comment-stripping reader

`labels: phase-6, area: android` · `wave: P6-W8` · `depends-on: T32S1C, T106, T39A`

`apps/android/src/app/dev/component-lab.test.ts` (T32S1C) and `recovered-turn-lab.test.ts`
(T106) each assert a `lazy(() => import("..."))` literal against **raw** `readFileSync`
text, while the `.tsx` they read quotes that same literal in its own doc comment. The
assertion is satisfied by the prose alone. Proven at the P6-W6 gate on the third file in
the family, `session-tree-lab.test.ts` (T39A): repointing the real `lazy()` at a nonexistent
module left it **2 passed (2)**, and so did deleting the `const LazySessionTreeLab = lazy(...)`
declaration outright. That third file was fixed in the gate commit (`dabe8c4`); these two
were not, because they are not this wave's.

Reuse the `readCode()` shape `e2e/flows/session-tree-sheet.contract.test.ts` and now
`session-tree-lab.test.ts` both use, and anchor to the whole `const ... = lazy(...)`
statement rather than the bare import literal.

- [ ] Both files strip comments before matching
- [ ] For each file, deleting the real `lazy(...)` declaration FAILS a named test
- [ ] For each file, repointing the import at a nonexistent module FAILS a named test

#### T124 — Guard against prose that asserts a capability is absent

`labels: phase-6, area: tooling` · `wave: P6-W9` · `depends-on: T110, T38B1a`

T110 landed as P6-W6's **first** commit and T38B1a as its fourth, so ten sites shipped
stating a premise that was already false — "no shipped `DaemonClient` implements this",
"true of every real `DaemonClient`", "has no wire request to change it today". The worst
was `Composer.tsx`'s, which described what a user sees and had it backwards. All ten were
corrected at the gate (`dabe8c4`); what is unowned is preventing the next one.

This is the fourth wave in which a capability landed beside prose asserting its absence.
The rule to encode: **a task that adds a capability greps for prose asserting that
capability is missing, before it lands.**

- [ ] A committed check (guard script or test) fails when a named method exists in
      `packages/client/src` while a comment in `apps/web/src` or `apps/android/src` says it
      does not — seeded with the queue-mode trio
- [ ] The check is proven by re-introducing one of the ten corrected sentences
- [ ] The rule is written into `CLAUDE.md` beside the existing T93 procedure

#### T125 — Commit the import-graph orphan walker to `scripts/ci/`

`labels: phase-6, area: tooling` · `wave: P6-W9` · `depends-on: T115, T101`

T115's acceptance criterion was "the walker's orphan count drops by three, run base-vs-HEAD",
but no such tool is committed: `scripts/ci/` holds only the guard scripts, and the P6-W4 walk
was ad hoc in a session scratchpad. That criterion is unverifiable by anyone, now or later.

Six over-reporting modes are already catalogued and must be handled: bare side-effect imports
and `export ... from` barrels swallowed by a naive regex; doc-comment prose forging edges;
non-`src` entry points (`app.config.ts`, `plugins/**`, `modules/**`, `*.config.*`); ESM
`.js`/`.jsx` specifiers that must resolve to `.ts`/`.tsx` (this one alone suppressed 807 false
positives at P6-W4); CLI and child-process entry points (`scripts/**`, `codegen/**`, `e2e/**`,
`daemon-worker.ts`, `worker-process.ts`, `terminal-worker-process.ts`); and
`packages/protocol`'s wildcard `"./*"` exports map. The stable figure across P6-W4 was
**27 orphans**, identical base-vs-HEAD.

- [ ] `scripts/ci/orphan-modules.mjs` plus a `run-` wrapper, matching the eight existing guards
- [ ] A unit test per over-reporting mode, each proven by a fixture that would false-positive
      without the handling
- [ ] Running it at HEAD reports a committed, named baseline count

#### T126 — Guard `apps/web/src` against a `node:` builtin re-entering the bundle

`labels: phase-6, area: tooling` · `wave: P6-W9` · `depends-on: T117, T38A5`

P6-W5 fixed this once by hand (`eb9fa55` deleted a barrel block, taking `apps/web`'s build
from three `has been externalized for browser compatibility` warnings to zero) and T117 will
split the loader out. Neither stops a future production import from putting `node:fs` back on
the bundle graph: `vite build` reports externalization as a **warning** and still exits 0, so
no gate catches it. Make it a hard gate alongside the existing eight guards.

- [ ] A guard script fails when any module reachable from `apps/web`'s production entry
      imports a `node:` builtin
- [ ] Proven by re-adding the P6-W5 barrel block: the guard must fail
- [ ] Test-only files remain allowed, and that allowance is itself tested

#### T127 — Surface the queue-mode provider notice the web adapter drops

`labels: phase-6, area: web` · `wave: P6-W8` · `depends-on: T38B1a, T110`

T110's `DaemonClient.setSteeringMode`/`setFollowUpMode` return
`Promise<AgentProviderNotice | null>` — the daemon's "this applies from the next turn"
explanation. `AgentTurnClient`'s own two methods return `Promise<void>`, so
`daemon-agent-turn-client.ts`'s adapter `await`s and discards it. The user changes a queue
mode and is told nothing about when it takes effect.

`setAgentThinkingOption` already carries its notice all the way through and renders it; this
is the same treatment for the queue-mode pair. Note the adapter's inline comment now names
this task as the owner.

- [ ] `AgentTurnClient.setSteeringMode`/`setFollowUpMode` return the notice, not `void`
- [ ] `QueueModePicker` renders it, following `use-model-thinking.ts`'s existing treatment
- [ ] Deleting the render FAILS a named test, and a `null` notice renders nothing

#### T128 — Attribute Pi UI action results the way T111 attributed permissions

`labels: phase-6, area: protocol` · `wave: P6-W9` · `depends-on: T111, T47A1a`

T111 closed half of the attribution gap `packages/frontend-core/src/actions/arbitration.ts`
was written around: `agent_permission_resolved` now carries an optional `answeredBy`, threaded
from the answering connection's own `clientId` through the real arbitrator, so `won()`'s exact
path is reachable in production. **`pi.ui.action.response`/`pi_ui_action_result` are the other
half, and nobody owns them.** For a Pi UI action, a second client still learns only THAT the
action resolved, never by whom, and `arbitration.ts` falls back to its best-effort comparison.

Follow T111's shape exactly — it is a proven three-layer template: optional field on the
protocol schema (a required one breaks every existing fixture and every older client), the
value carried from the real resolution site rather than synthesized at the broadcast, and a
renderer that reads it. T111's commits are `8129dfc` (protocol), `67d96ac` (server) and
`328a43d` (web).

- [ ] `pi.ui.action.response`/`pi_ui_action_result` carry the answering client's identity,
      round-tripped through a contract fixture
- [ ] A second client renders who answered, proven by the value arriving in the DOM
- [ ] Omitting the field keeps today's behaviour, proven by a test using the old payload
- [ ] Deleting the field from the broadcast FAILS a named test; show the mutation and counts
- [ ] `arbitration.ts`'s attribution note is updated: with this, the section it corrects at
      P6-W7 has no open half left

#### T129 — Fix the third vacuous dev-lab test, `recipe-lab.test.ts`

`labels: phase-6, area: android` · `wave: P6-W9` · `depends-on: T123, T39A`

T123 fixed two of the three files in this family and surveyed for the rest; the P6-W8
merge gate found the third and proved it. `apps/android/src/app/dev/recipe-lab.test.ts:21`
matches `/import\("\.\.\/\.\.\/dev\/recipe-lab"\)/` against **raw** `readFileSync` text,
while `recipe-lab.tsx:15`'s own doc comment quotes `import("../../dev/recipe-lab"))`
verbatim. The prose alone satisfies the assertion.

Reproduced at the P6-W8 gate and again by the reviewer: repointing the **real**
`const LazyRecipeLab = lazy(() => import("../../dev/recipe-lab"));` at
`"../../dev/nonexistent-xyz"` left the file at **1 passed (1), 2 passed (2)** — identical
to baseline. The route's real lazy import can point anywhere and this test stays green.

`bb44518` is the template: the `readCode()` comment-stripping reader plus an anchor on the
whole `const ... = lazy(...)` statement rather than the bare import literal.

Owns: `apps/android/src/app/dev/recipe-lab.test.ts`. Read `recipe-lab.tsx`; do not change
its behaviour.

- [ ] The test strips comments before matching
- [ ] Deleting the real `lazy(...)` declaration FAILS a named test; show the mutation and counts
- [ ] Repointing the import at a nonexistent module FAILS a named test; show the mutation and counts
- [ ] `cd apps/android && npx vitest run src/app/dev` passes

#### T130 — Sweep every raw-`readFileSync` source-text test for the same defect class

`labels: phase-6, area: tooling` · `wave: P6-W10` · `depends-on: T123, T129`

Three instances in one directory family is not a coincidence, and T123's survey was scoped
to the dev-lab family only. **A source-text assertion run against raw file text is satisfied
by the file's own doc comment quoting the code** — the eighth entry in this repository's
catalogue of checks that cannot fail, and the only one with three known instances.

Enumerate every test under `apps/android` and `apps/web` that reads a source file with
`readFileSync` (or any reader that does not strip comments) and asserts against its text.
For each, determine whether the file it reads could satisfy the match from a comment. **The
decisive check is the one that found all three: delete or repoint the code you believe the
assertion matched and re-run.** A grep for `readFileSync` is the starting point, not the
answer — `readCode()`/`readComponentCode()` helpers already exist in several files and are
correct; what matters is which readers strip and which do not.

Prefer converting call sites to the existing `readCode()` shape over inventing a guard: a
CI check that flags every `readFileSync` in a test would be noisy and mostly wrong. If a
guard turns out to be the right answer, it must fail on `recipe-lab.test.ts` as it stood
before T129.

- [ ] Every raw-reader source-text test in both apps is enumerated, with a verdict each
- [ ] Every vulnerable one is converted, or filed with the mutation that proves it
- [ ] For each conversion, the mutation that used to pass now FAILS; show the counts
- [ ] Both app suites pass

#### T131 — Mount `AgentSettingsPanel` and wire auto-compaction/auto-retry onto `DaemonClient`

`labels: phase-6, area: web` · `wave: P6-W10` · `depends-on: T38B2`

T38B2 built the settings surface honestly and disclosed both halves of what it could not
close, which is why it was kept: `AgentSettingsPanel` is exported but mounted nowhere (only
named in `host-settings-screen.tsx`'s doc comments), and `getAutoCompaction`/
`setAutoCompaction`/`getAutoRetry`/`setAutoRetry` do not exist on the real `DaemonClient` —
`daemon-settings-client.test.ts` asserts their absence structurally against the real,
unmocked prototype, so the adapter's `undefined` resolution is truthful today and the
controls are gated by `rowDisabled(state)`.

This task closes both. Establish first whether the daemon supports these settings at all —
T38B2 recorded itself as **world 3** (nothing on the wire). If that holds, this task spans
`packages/protocol` and `packages/server` as well, and should be split; if the wire messages
turn out to exist under other names, say so and correct T38B2's finding rather than
building around it.

Whatever the outcome, do not leave an enabled control whose value dies before the wire —
that is the P6-W7 defect, and T38B2's gating is what this task must not regress.

- [ ] Which world this is, named, with the daemon-side source cited by file and line
- [ ] `AgentSettingsPanel` is mounted on a real route, proven in the DOM
- [ ] The four client methods exist and round-trip, proven by values arriving at a counting fake
- [ ] `daemon-settings-client.test.ts`'s absence assertions are replaced, not deleted — they
      must now assert presence and behaviour
- [ ] Deleting each round-trip FAILS a named test; show the mutations and counts
- [ ] `npm run build --workspace=@picompanion/client` first, then `apps/web` typecheck exits 0

#### T132 — Wire `queueModeClient`/`turnStatusClient` into the Android production Composer

`labels: phase-6, area: android` · `wave: P6-W10` · `depends-on: T39C, T121`

T39C built the Android queue-mode, retry and compaction surfaces against injected ports and
disclosed that no route passes them: `session/[agentId]/index.tsx` mounts `<Composer>` with
`sessionId`, `onSubmit`, `onMicPress`, `onAttachPress`, `turnRunning`, `turnService` and
`outbox` (T121) — and nothing named `queueModeClient` or `turnStatusClient`. So
`QueueModePicker.tsx` returns `state.unavailableReason` with no `Select` rendered at all,
which is the correct behaviour for an unwired surface and is why T39C was kept.

T121 is the template for the mount itself, including the lesson that cost this wave three
test-side fixes: **the two `<Composer .../>` contract-test anchors in
`e2e/flows/composer-inputs.contract.test.ts` and
`e2e/flows/background-kill-restore.contract.test.ts` pin the exact element and must be
updated in the same commit as any prop you add.** They are living pins, updated in place by
every task that has changed that mount.

The prerequisite is a live Android client, which `T32A1B` owns. If it has not landed, this
task is blocked and should say so rather than constructing a second client.

- [ ] The production mount passes both clients, proven by values arriving at a counting fake
- [ ] `QueueModePicker` renders a real `Select` on that route, proven by a test
- [ ] Both `<Composer .../>` contract anchors are updated in the same commit
- [ ] Deleting each prop FAILS a named test; show the mutations and counts
- [ ] `cd apps/android && npx vitest run` shows no new failing file

#### T133 — Extend the web bundle guard to bare `node` builtin specifiers

`labels: phase-6, area: tooling` · `wave: P6-W10` · `depends-on: T126`

T126's `scripts/ci/guard-no-node-builtin-in-web-bundle.mjs` walks the real import graph from
`apps/web/src/main.tsx` and correctly fails on a `node:`-prefixed builtin. It does not see
the bare form, and Vite treats the two identically.

Reproduced at the P6-W9 gate and again by the reviewer. Appending `import "fs";` to
`apps/web/src/features/sessions/index.ts` — the exact file P6-W5's `eb9fa55` fixed by
hand — gives:

```
node scripts/ci/run-guard-no-node-builtin-in-web-bundle.mjs
  guard-no-node-builtin-in-web-bundle: OK — no node: builtin reachable from apps/web/src/main.tsx.
  exit=0
cd apps/web && npm run build
  1 line matching "has been externalized"
```

The same file with `node:fs` fails the guard, exit 1. This is a coverage gap, not a false
claim: the guard's prose scopes itself to the `node:` prefix throughout and never
overclaims. But the warning it exists to prevent is reachable without it.

Owns: `scripts/ci/guard-no-node-builtin-in-web-bundle.mjs` and its test. Keep the existing
`node:` coverage; do not narrow it while widening.

- [ ] A bare builtin specifier reachable from the production entry FAILS the guard
- [ ] Proven with `import "fs";` in the file above: guard fails, then tree restored
- [ ] The `node:` case still fails, proven separately — widening must not drop it
- [ ] Test-only files remain allowed, and that allowance is still tested
- [ ] A module named `fs` that is NOT a builtin (a real dependency or local file) does not
      trip it; show the case
- [ ] Guard exits 0 at HEAD and `cd apps/web && npm run build` shows zero externalized lines

#### T134 — Give `answeredBy` a human label, or resolve one at the surfaces

`labels: phase-6, area: protocol` · `wave: P6-W10` · `depends-on: T111, T128`

**`answeredBy.label` has no production emitter, so two user-facing surfaces render a raw
connection id.** All three real emitters set `{ clientId: this.clientId }` and nothing else
(`packages/server/src/server/session.ts:1955`, `:1965`, `:4127`); only test files supply a
label. Both consumers do `label ?? clientId` — `describeAnsweredBy`
(`packages/frontend-core/src/actions/outcome-notice.ts:59`) and `attributionText`
(`apps/web/src/features/extensions/renderers/element-actions.tsx:52`) — so the `label`
branch is dead in production and a user sees `Agent not found — clid_...`.

This is pre-existing: the approvals surface has shipped the same fallback since T111, and
T128 faithfully mirrored it onto a second surface rather than inventing a new pattern. It is
filed against neither task. What makes it worth a task is that both tasks' tests supply
`label: "Web"` / `"Android"` — a fixture shape production never emits — and therefore
assert `"Agent not found — Web"` where a real user reads an opaque id. **An assertion
pinned to your own fixture proves only that JSON.stringify works.**

Two defensible answers: the daemon supplies a human label at the emit sites, or the surfaces
resolve one from connection state they already hold. Pick one and say why. Whichever you
pick, at least one test must assert what a user sees when the daemon emits exactly what it
emits today.

- [ ] A real emitted `answeredBy` renders a human-readable answerer on both surfaces
- [ ] At least one test constructs its payload the way production does — no hand-supplied
      `label` — and asserts the rendered text
- [ ] The unresolvable case still renders something honest rather than a bare id or a blank
- [ ] Deleting the resolution FAILS a named test; show the mutation and counts
- [ ] `npm run build` for protocol then client, then `apps/web` typecheck exits 0

#### T135 — Register the two dev-lab routes `router-root.test.ts` has never allowed

`labels: phase-6, area: android` · `wave: P6-W11` · `depends-on: T39A, T106`

Direct enumeration of `apps/android/src/app/**` at the P6-W10 merge gate found three files in
neither `REAL_ROUTES` nor `KNOWN_NON_ROUTE_EXCEPTIONS`. One was T132's non-route module,
moved out in `d89058c`. The other two are legitimate dev routes that have simply never been
in the allowlist:

- `./dev/recovered-turn-lab.tsx` (T106, `da96860`)
- `./dev/session-tree-lab.tsx` (T39A, `4703bcb`)

Both have default exports, so both are real routes and belong in `REAL_ROUTES`. Neither is a
defect today — they are correctly reachable — but an allowlist that has silently drifted from
the filesystem for many commits cannot tell you anything when it finally runs.

**Sequence this after T136.** Adding entries to a test that collects zero tests proves
nothing; once the test runs, this becomes a one-line change with a real assertion behind it.

Owns: `apps/android/src/app/router-root.test.ts`.

- [ ] Both files are in `REAL_ROUTES`, and the existing "every REAL_ROUTES entry has a
      default export" assertion covers them
- [ ] Re-enumerate `apps/android/src/app/**` yourself and report EVERY file in neither set;
      do not trust this list
- [ ] Removing either entry FAILS a named test; show the mutation and counts

#### T136 — Make `router-root.test.ts` runnable without `expo-router` installed

`labels: phase-6, area: android` · `wave: P6-W11` · `depends-on: T32S2, T87`

**This guard has never run in this repository.** `router-root.test.ts` opens with
`require("expo-router/_ctx-shared")`, and `expo-router` is declared but uninstallable
(T87/T116), so the file fails collection with `Cannot find module
'expo-router/_ctx-shared'` and reports **zero tests** in every environment that exists here.
It is the single red file in the `apps/android` baseline.

The cost is now concrete rather than theoretical. At P6-W10, T132 added a module with no
default export inside the router root — precisely what this test forbids, and precisely what
T32S2 moved six modules out to prevent. The recursive walk would have caught it. Nothing
did, and the merge gate found it only by enumerating the directory by hand.

Vendor `EXPO_ROUTER_CTX_IGNORE` locally, with a parity assertion that engages **only when
the package is present** so the vendored copy cannot silently drift from the real one. Do
not weaken the walk to make it run, and do not vendor the whole ponyfill — the regex is the
only thing this test needs from that package.

Owns: `apps/android/src/app/router-root.test.ts` and whatever local module holds the
vendored regex. Do NOT vendor, stub, or alias `expo-router` itself — that prohibition is
settled (T116), and this task is the narrow, legitimate alternative to it.

- [ ] The file collects and runs with `expo-router` absent, as it is today
- [ ] A parity test compares the vendored regex against the real one when the package IS
      present, and skips honestly (never silently passes) when it is not
- [ ] Re-adding a no-default-export module under the router root FAILS the test — use
      `session-route-daemon-clients.ts`'s old path from `d89058c`; show the mutation and counts
- [ ] `cd apps/android && npx vitest run` shows **0** failing files, down from 1

#### T137 — Gate `format:check` per commit across a wave range, not only at the tip

`labels: phase-6, area: tooling` · `wave: P6-W11` · `depends-on: T93`

At P6-W10, `main` was red on `npm run format:check` at `4a23d89` (T130) and green again at
the wave tip, because `9b01176` (T132) repaired the file in passing without mentioning it.
Every wave-end gate passed. Nobody could have known.

The specific shape: T130 committed a three-line `.replace()` chain in
`apps/android/src/ui/theme/fonts.test.ts`; the one-line form is 99 characters and fits
oxfmt's `printWidth: 100`, so the pinned formatter collapses it. A stale copy of that
format-red content then survived in the working tree to the end of the wave.

A tip-only check cannot see this class at all. Add a per-commit check over a range —
`git rebase --exec`, or a CI job that iterates `<base>..HEAD` and runs the formatter at each
commit. Weigh the cost: this is cheap for a seven-commit wave and expensive over long
history, so bound the range deliberately and say what bound you chose.

**Use the pinned binary.** `npx oxfmt --check .` resolved a newer, unpinned oxfmt at the
P6-W10 gate and reported six false failures at a HEAD where `./node_modules/.bin/oxfmt`
(0.46.0) exits 0 over 2324 files. A gate that reports failures nobody can reproduce gets
switched off.

- [ ] A committed check fails when any commit in a range is format-red, even if the tip is
      green
- [ ] Proven against the real range `68f899f..d89058c`, which contains exactly this case:
      show it failing and naming `4a23d89`
- [ ] It passes on a range with no format-red commit; show that too
- [ ] It invokes the pinned formatter, never `npx`; show how you ensured that
- [ ] The range bound is documented, with the cost you measured

#### T138 — Assert `ROUTE_HEADINGS` covers every non-fallback web route

`labels: phase-6, area: web` · `wave: P6-W12` · `depends-on: T41B1, T54A2`

`apps/web/src/ui/shell.tsx`'s `ROUTE_HEADINGS` is the map that, per its own doc comment,
"gives every route exactly one" `<h1>` (T54A2, after axe's `page-has-heading-one` failed
in the first real-browser run). At P6-W11, T41B1 registered
`/h/$serverId/diagnostics` in `routes/route-tree.ts` and never added it to that map, so a
real host screen fell through `useRouteHeading()`'s product-name fallback and rendered
`<h1>Pi Companion</h1>`. The fallback's own comment enumerates what it is for — `/`, the
404 and error boundaries, and the dev-only labs — so the same commit made that comment
false as well as costing the route its name.

**The entry itself is already fixed**, at the P6-W11 merge gate, with a behavioural test
that mounts the shell at the diagnostics route and asserts the `<h1>`. What is still
missing is the thing that stops the NEXT route repeating it: **nothing in the repository
referenced `ROUTE_HEADINGS` at all** before that fix.

Enumerate the real `routeTree`'s route ids and assert each non-exempt one has a heading.
The exempt set must be named explicitly in code, not inferred: `/` (it redirects before
rendering), the 404 and error boundaries, and the dev-only labs. An exemption list that
silently swallows a new route is the same defect one layer up.

Owns: `apps/web/src/ui/shell.tsx` and `shell.test.tsx`.

- [ ] The test reads the REAL `routes/route-tree.ts`, not a fixture built in the test file
- [ ] Every non-exempt route id has a heading; the exempt set is explicit and justified
- [ ] **Mutation:** remove any single heading entry and show a named test FAILING, with counts
- [ ] **Mutation:** add a new route to the tree without a heading and show it FAILING too —
      that is the case the assertion exists for
- [ ] `cd apps/web && npx vitest run` shows no new failing file

#### T139 — Make `useClipboardAction` fail visibly instead of always saying "Copied"

`labels: phase-6, area: web` · `wave: P6-W12` · `depends-on: T41B1`

`apps/web/src/features/transcript/tool-call-row.tsx:493-504` swallows every clipboard
failure in a bare `catch {}` and then sets the "Copied" label unconditionally. It is worse
than a swallowed error: the call is written `navigator.clipboard?.writeText?.(payload)`, so
in a browser with no Clipboard API — or with permission denied on a non-secure origin —
nothing throws at all. The promise never exists, the optional chain short-circuits, and the
user is told the text was copied when nothing was.

This is the maxim, in its purest form: **a silent no-op is worse than a visible failure.**

`apps/web/src/features/diagnostics/CopyableField.tsx` (T41B1) is the correct shape and was
written against this exact anti-pattern — it renders a `StatusIndicator tone="danger"`
carrying the real reason. Follow it rather than inventing a third convention. Check whether
the two should share one hook; if you conclude they should not, say why.

Owns: `apps/web/src/features/transcript/tool-call-row.tsx` and its tests.

- [ ] A failed write renders a visible failure carrying the real reason
- [ ] An ABSENT Clipboard API is handled distinctly from a REJECTED write; both are visible
- [ ] A test drives each path with a real fake, not by asserting on source text
- [ ] **Mutation:** restore the bare `catch {}` and show a named test FAILING, with counts
- [ ] Every other `catch {}` around a clipboard call in `apps/web/src` is enumerated in your
      report, fixed or filed

#### T140 — Style the diagnostics screen

`labels: phase-6, area: web` · `wave: P6-W12` · `depends-on: T41B1`

T41B1 shipped six feature-scoped class names with **zero** matching CSS rules anywhere in
`apps/web` (verified at the P6-W11 gate across all 24 `.css` files): `pc-diagnostics`,
`pc-diagnostics__intro`, `pc-diagnostics-section__fields`, `pc-diagnostics-field`,
`pc-diagnostics-field__label`, `pc-diagnostics-field__value`. Label, value and copy button
flow inline with no layout.

The owner has deferred UI **polish** until the app is fully built, and this task respects
that: it is not a refinement pass. An unstyled screen is an unlanded piece — every other
feature using `pc-*` names ships its own `.css` (`files.css`, `transcript.css`,
`session-list.css`). Bring this one to the same baseline and stop.

Owns: `apps/web/src/features/diagnostics/diagnostics.css` and its import site.

- [ ] Every `pc-diagnostics*` class name has a rule; enumerate them and show the grep
- [ ] Tokens only — no raw hex, resolved through `@picompanion/design-tokens`
- [ ] The stylesheet is actually imported; prove the import, do not assume the bundler finds it
- [ ] `cd apps/web && npm run build` succeeds with **0** "has been externalized" lines

#### T142 — Decide `get_tree`'s fate: wire it or remove the plumbing

`labels: phase-6, area: daemon` · `wave: P6-W12` · `depends-on: T51A`

T51A's audit found the `get_tree` arm, `PiCliRuntime.getTree()` and
`session-descriptor.ts`'s `tryGetTreeViaRpc` have **zero production callers** — confirmed
independently at the merge gate: a declaration, one self-internal call, and `fake-pi.ts`.
The mirror arm also carries a `targetId?` field the installed Pi does not have.

Dead plumbing that looks live is worse than no plumbing: the next agent reading
`tryGetTreeViaRpc` will reasonably assume the session tree already has a daemon path.
Decide deliberately and record the decision where the next reader will hit it.

If you wire it, a test must call the real path and fail when it is unwired. If you remove
it, say what would have used it and what replaced that need. Either way the `targetId?`
divergence from the installed Pi is closed.

Owns: `packages/server/src/server/agent/providers/pi/` (`rpc-types.ts`, the runtime, and
`session-descriptor.ts`).

- [ ] A written decision: wired, or removed, with the reason
- [ ] `targetId?` either matches the installed Pi or is gone
- [ ] **Mutation** proving whichever you chose: if wired, break the call and show a named test
      FAILING; if removed, show the grep proving nothing references it
- [ ] The Pi mirror contract test still passes field-for-field against the installed Pi
- [ ] `packages/server` typecheck does not exceed the ceiling of 1051 errors / 315 files

#### T143 — Carry `compaction_end`'s discarded structured payload to the client

`labels: phase-6, area: protocol` · `wave: P6-W12` · `depends-on: T51A, T38B3`

`compaction_end` is typed `result?: unknown` in the Pi mirror, so everything Pi actually
sends is thrown away at the boundary: `summary`, `firstKeptEntryId`, `tokensBefore`,
`estimatedTokensAfter`, `usage`, and `details.{readFiles, modifiedFiles}`. T38B3 built a
compaction surface that has nothing real to render.

T51A recorded this and correctly declined to fix it — it needs `packages/protocol` and
`packages/frontend-core`, outside that task's grant.

Type the payload from the installed Pi's `rpc-types.d.ts`, not from these field names — they
are a hypothesis recorded during an audit. Read the declaration yourself at
`%LOCALAPPDATA%\pi-node\current\node_modules\@earendil-works\pi-coding-agent\dist\modes\rpc\rpc-types.d.ts`
(READ-ONLY) and say what you found.

Then carry it end to end and land it on ONE surface. **A typed field that no surface
renders is not carried**; it is a second `result?: unknown` with better documentation.

Owns: the `compaction_end` path through `packages/server`, `packages/protocol`,
`packages/frontend-core`, and the one surface you choose.

- [ ] The payload is typed from the installed declaration, with the Pi version recorded
- [ ] It survives server — protocol — client — core; a test asserts the value at the far end
- [ ] At least one real surface renders it, and a test asserts what a user sees
- [ ] **Mutation:** drop the field at the boundary and show a named test FAILING, with counts
- [ ] `npm run build` for protocol then client, then `apps/web` typecheck exits 0

#### T144 — Give `use-file-search.test.ts` its own path-authorization case

`labels: phase-6, area: web` · `wave: P6-W12` · `depends-on: T41A1a`

T41A1a's door is real and complete — independently verified at the P6-W11 gate by bypassing
it at a third entry point (`use-file-explorer.ts`) and watching `path-authorization.test.ts`
go red. This is not a defect today.

It is a trap for the next editor. ALL bypass coverage lives in `path-authorization.test.ts`.
The P6-W11 verifier bypassed the door inside `use-file-search.ts`'s walker and that file's
own suite reported **11/11 green**; only the sibling suite caught it. Someone editing the
walker will run its own tests, see green, and ship the bypass.

Give each entry-point suite one case of its own that fails when its own door is removed.
This is a duplicate assertion on purpose: the point is WHERE it fails, not whether the
invariant is covered somewhere.

Owns: the `*.test.ts` files beside each entry point in `apps/web/src/features/files/`.

- [ ] Every entry point that calls `authorizeWorkspacePath` has an authorization case in its
      OWN suite; enumerate them
- [ ] **Mutation, per file:** remove that file's door and show ITS OWN suite failing — not a
      sibling's. Show the counts for each.
- [ ] The tests call the real hook; no source-text assertions
- [ ] `cd apps/web && npx vitest run` shows no new failing file

#### T146 — Render T143's carried compaction fields on web, and delete the false copy

`labels: phase-6, area: web` · `wave: P6-W13` · `depends-on: T143, T38B3`

**This is user-visible copy that is currently false.**

`apps/web/src/features/transcript/compaction-row.tsx`'s `messageFor()` unconditionally
appends, in rendered text a user reads:

> " A summary of what changed, and which files were read or modified, isn't available here
> yet — the app doesn't carry that detail from the agent today."

Since T143 (`7fb0c26`) the app **does** carry it. `CompactionTranscriptEntry` in
`packages/frontend-core/src/timeline/transcript-view.ts` now holds `summary`,
`estimatedTokensAfter`, `filesRead` and `filesModified`. Every web user of a completed
compaction is told the opposite of the truth. The 40-line doc comment above `messageFor()`
is false in the same way, including its three-step "closing seam" list — all three steps
landed in T143. This was correctly out of T143's Owns grant and it disclosed the gap.

## The memo comparator is the part that will be missed

`areCompactionRowPropsEqual` compares only `preTokens`. A compaction whose summary arrives
without a token change would not re-render, so the fields would be carried, rendered in
code, and still invisible. **Add every field you read to the comparator, and prove it with
a test that changes only the summary.**

## Match Android rather than inventing a second phrasing

`apps/android/src/features/composer/turn-status-model.ts`'s `describeCompactionStatus`
already renders these fields and has three assertions on the exact sentence. Mirror its
shape so the two surfaces agree; where you must diverge, say why.

`estimatedTokensAfter` is carried but read by neither surface today. Surface it on both or
say plainly why it stays unread.

Owns: `apps/web/src/features/transcript/compaction-row.tsx` and its tests. Do not edit
`packages/frontend-core` — the carry is done.

- [ ] The hardcoded "isn't available here yet" sentence is GONE, not reworded
- [ ] `summary`, `filesRead` and `filesModified` render, with a test asserting what a user sees
- [ ] The absent case (an older entry with none of these) still renders something honest
- [ ] `areCompactionRowPropsEqual` compares every field the row reads
- [ ] **Mutation:** change ONLY the summary between renders and show the row updating; then
      drop the field from the comparator and show a named test FAILING, with counts
- [ ] The false doc comment and its three-step seam list are corrected, using the T124
      `CORRECTED (P6-W13)` marker convention so the prose guard does not trip on the quotation
- [ ] `cd apps/web && npx vitest run` shows no new failing file (baseline: 155 files / 1367 passed)

#### T147 — Let `guard-capability-prose` see capabilities outside `packages/client/src`

`labels: phase-6, area: tooling` · `wave: P6-W13` · `depends-on: T124, T139, T143`

`scripts/ci/run-guard-capability-prose.mjs:13,39` computes "is this capability shipped?"
from `packages/client/src/` **only**:

```js
const CLIENT_SRC_PREFIX = "packages/client/src/";
path.startsWith(CLIENT_SRC_PREFIX) && hasSourceExtension(path) && !path.endsWith(".test.ts");
```

That was right for T124's seeding case (the queue-mode trio, which really does live on
`DaemonClient`). It is wrong in general, and P6-W12 produced two capabilities it cannot
see: T139's visible clipboard-failure state lives in
`apps/web/src/features/transcript/tool-call-row.tsx`, and T143's compaction fields live in
`packages/protocol/src`, `packages/frontend-core/src` and `packages/server/src`. Both
shipped beside prose denying them.

**Order matters, and getting it backwards ships a check that cannot fail.** The P6-W12
merge gate proved this: it added a real `CAPABILITIES` entry naming `useClipboardAction`
with the exact live denying phrase, ran the guard, and got
`OK — 2 capability group(s) checked ... no live denial found`, exit **0**, with the false
prose sitting in the tree. Widen the scope FIRST, prove the widened guard trips, and only
then add entries.

## Keep what makes this guard survivable

T124 deliberately built a curated list rather than a generic "grep every comment" linter,
because the generic version false-positives forever and gets disabled within two waves.
**Do not widen it into that.** Keep `CAPABILITIES` curated and keep
`HISTORICAL_QUOTE_MARKERS` working — a corrected sentence that quotes its own former
false claim must still pass, which is what lets a fix explain itself.

Exclude the file being checked from its own shipped-source scan, or every capability will
look shipped by the prose that denies it.

Owns: `scripts/ci/guard-capability-prose.mjs`, `run-guard-capability-prose.mjs`, and
`guard-capability-prose.test.mjs`.

- [ ] Shipped-source scope covers `packages/*/src` and `apps/*/src`, not just the client
- [ ] A test proves a capability declared OUTSIDE `packages/client/src` now trips the guard
- [ ] The existing historical-quotation tests still pass, including the pair where deleting
      the `CORRECTED` marker flips a pass to a fail
- [ ] Entries added for T139's clipboard-failure state and T143's compaction fields, each
      shown FAILING against a deliberately re-introduced denying sentence, then passing
- [ ] The guard is not converted into a generic comment linter; say what you kept curated
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 175/175)

#### T148 — Teach `guard-format-check-per-commit` to separate introduced from inherited redness

`labels: phase-6, area: tooling` · `wave: P6-W14` · `depends-on: T137, T93`

T137's per-commit format gate works and has already earned its keep — it caught a real
format-red commit at P6-W13. But it names the wrong commit.

Its header argues that "a commit can only make a FILE format-red by touching that file".
That is true, and it is not the claim the guard reports. It reports the converse: any
commit whose tree contains a format-red file it touched, regardless of whether that
commit introduced the break. At P6-W13 the break lived in `docs/issues-from-plan.md`
since the **wave base** `cedf76a` (a missing semicolon inside a ```js fence — oxfmt
formats embedded JS in Markdown). `20062c3` edited an unrelated section of that already-red
file and was named an offender, under the message "Fix the offending commit(s)".

This will recur on every wave that touches a file a previous wave left red, and each
recurrence costs a gate cycle arguing about an innocent commit.

## The fix is a comparison, not a threshold

For each file a commit changed, run oxfmt against the file's blob **at that commit** and
against **its parent's** blob of the same path. Report only green—>red transitions. A file
that was already red stays the earlier commit's problem; a file added red in this commit
has no parent blob and is correctly this commit's problem.

Keep the guard's existing range semantics and its exit codes. Do not silence inherited
redness entirely — report it as a separate, non-failing NOTE naming the file and the
commit that last left it red, so it stays visible without accusing the wrong author.

## Prove it against the real history

This range is a live fixture and must be part of the acceptance evidence:

```
node scripts/ci/run-guard-format-check-per-commit.mjs cedf76a..cd1106e
```

Today that exits 1 naming `20062c3` and `33232cc`. After this task, `20062c3` must not be
named as an offender (it inherited the break), and `33232cc` must still be — it
reintroduced a break its parent `e5c48a2` had cleared. `run-guard-format-check-per-commit
17a54a0..cedf76a` must still exit 1 on `cedf76a`, which genuinely introduced it.

Use the pinned `./node_modules/.bin/oxfmt`, never `npx oxfmt` — npx may resolve a newer
unpinned version and report false failures.

Owns: `scripts/ci/guard-format-check-per-commit.mjs`,
`scripts/ci/run-guard-format-check-per-commit.mjs`, and their `node --test` file.

- [ ] Only green—>red transitions fail the guard; inherited redness is a non-failing NOTE
- [ ] A file added red in the commit under test still fails (no parent blob to compare)
- [ ] `cedf76a..cd1106e` no longer names `20062c3`, still names `33232cc`
- [ ] `17a54a0..cedf76a` still names `cedf76a`
- [ ] **Mutation:** make the transition check unconditional again and show a named test
      FAILING, with counts
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 193/193)

#### T149 — Render or retire Android's carried `TurnCompactionStatus.estimatedTokensAfter`

`labels: phase-6, area: android` · `wave: later` · `depends-on: T143, T146`

T143 carries `estimatedTokensAfter` into `TurnCompactionStatus`
(`apps/android/src/features/composer/turn-status-model.ts:269`) and
`describeCompactionStatus` never reads it. T146 made the opposite decision on web and
documented the divergence in `tokenRangeNote`'s doc comment, so this is disclosed rather
than hidden — which is why it is filed unscheduled rather than as a defect.

Do this only if the two surfaces are meant to converge. If they are not, the honest
outcome is to delete the field from the Android status object and say so, not to leave a
carried-but-unread field looking like an oversight.

- [ ] Either the field renders on Android with a test asserting what a user sees, or it is
      removed with the divergence recorded on both surfaces
- [ ] Whichever way it goes, web's `tokenRangeNote` doc comment still describes the truth

#### T150 — Close the per-commit format gate's inherited-red blind spot

`labels: phase-6, area: tooling` · `wave: P6-W15` · `depends-on: T148, T137`

T148 was right to stop the guard accusing a commit that merely touched an already-red file,
and its two fixture ranges prove it. But narrowing to a **boolean** green—>red transition
means a commit that adds a BRAND-NEW break to a file that was already red is reported as a
non-failing NOTE.

The P6-W14 merge gate built a four-commit chain with git plumbing and ran the real guard:

| Range    | Content                                               | Result                                    |
| -------- | ----------------------------------------------------- | ----------------------------------------- |
| C1..C2   | green file —> red                                     | FAILED, exit 1 · correct                  |
| C2..C3   | unrelated edit to an already-red file                 | OK + NOTE, exit 0 · correct, this is T148 |
| C3..C4   | **a second, new break added to the already-red file** | OK + NOTE, exit 0 · the gap               |
| HEAD..C1 | adds a green file                                     | OK, exit 0 · correct                      |

Reachability is narrow: the file must already be red at the wave base, and any later
reformat sweeps up every break at once, so this cannot survive a tip-green `format:check`.
That is why T148 was kept rather than blocked. It is still a hole.

**No mechanism is prescribed here.** An untested remedy is what went wrong at P6-W12 and
P6-W13; work out the comparison you need (a count, a set of red REGIONS, a per-path
before/after byte diff of oxfmt's output — your call) and prove it against the four-commit
chain above, which you must rebuild.

The module header's "What this approach CANNOT catch" paragraph predates T148 and no longer
enumerates the blind spot T148 introduced. A doc comment that states a false premise is a
defect; fix it in the same commit.

Owns: `scripts/ci/guard-format-check-per-commit.mjs`,
`scripts/ci/run-guard-format-check-per-commit.mjs` and their `node --test` file.

- [ ] A commit adding a new break to an already-red file FAILS
- [ ] A commit touching an already-red file without adding a break still passes with a NOTE
- [ ] `cedf76a..cd1106e` still names `33232cc` and still does not name `20062c3`
- [ ] `17a54a0..cedf76a` still names `cedf76a`
- [ ] The header's CANNOT-catch paragraph is accurate as of your change
- [ ] **Mutation:** revert your comparison and show a named test FAILING, with counts
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 196/196)

#### T151 — Join adjacent string literals before matching capability-denying prose

`labels: phase-6, area: tooling` · `wave: P6-W15` · `depends-on: T124, T147`

`flattenProse` in `scripts/ci/guard-capability-prose.mjs` strips JSDoc gutter stars and
collapses whitespace, so a denying phrase wrapped across LINES still matches. It does not
join adjacent string literals, so a denying phrase split across a **concatenation boundary**
escapes the guard completely.

Found by accident at the P6-W14 review while proving a new `CAPABILITIES` entry had a real
failing arm. The first mutation restored the denying sentence in this shape:

```js
"... returns zero. No export action exists in " + "apps/web. ...";
```

and the guard exited **0**. Rewritten with the same sentence on one literal, it exited **1**.
This is the exact shape prose in this repository is already written in — `note:` fields in
`rpc-command-web-parity.ts` are concatenated strings, and oxfmt's `printWidth: 100` forces
the split. The guard is blind in precisely the files most likely to carry a stale claim.

## Do not turn this into a JavaScript parser

A textual join of `" + "` between two string literals is enough, and is what the existing
line-wrap handling already does in spirit. Whatever you do must not change the meaning of
the `HISTORICAL_QUOTE_MARKERS` window — a corrected sentence quoting its own former false
claim must still pass, and the existing marker-deletion test pair must still hold.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] A denying phrase split across `" + "` is caught
- [ ] A test covers the split-literal case specifically, with the unsplit case beside it
- [ ] The historical-quotation pair still passes, including the marker-deletion failure
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 at HEAD after your change
- [ ] **Mutation:** remove the join and show the split-literal test FAILING, with counts
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 196/196)

#### T152 — Extend the Pi RPC drift detector to the web parity registry

`labels: phase-6, area: daemon` · `wave: P6-W15` · `depends-on: T51B`

T51B forces a `docs/pi-extension-compatibility.md` §9.2 row when Pi gains an arm. It forces
nothing for the third registry keyed by the same identifier:
`apps/web/src/features/sessions/rpc-command-web-parity.ts`'s 32 `command:` entries.

All three registries — §9.2's 32 rows, the parity file's 32 entries, and T99's vendored 8
— agree exactly today; the P6-W14 gate diffed all three programmatically and every set
difference was empty. **The forcing function is what is missing, not the agreement.** This
is P6-W11's escaped defect in its general form: there is usually more than one registry.

Both extractors already exist — T51B's `extractAuditedCommandNames` parses the markdown at
runtime, and the parity file's entries are a plain array literal — so this is small.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.test.ts`. Do NOT edit
`rpc-types.pi-mirror.contract.test.ts` (T99's) or the parity file itself.

- [ ] A new arm in Pi with no `rpc-command-web-parity.ts` entry fails, naming the command
- [ ] A parity entry for a command Pi no longer declares fails, naming the command
- [ ] The failure message names the specific command, never "sets differ"
- [ ] **Mutation:** delete one parity entry and show the test FAILING with that name, then
      restore; repeat with an added fake entry
- [ ] The existing 6 tests in that file still pass

#### T153 — Give Android's file editor T41A1b's pinned write basis

`labels: phase-6, area: android` · `wave: P6-W15` · `depends-on: T41A1b`

T41A1b pinned the conflict basis at `startEditing` on web, because reading
`file.modifiedAt`/`file.revision` live at save time let a mid-edit re-read advance the token
and silently overwrite another writer. Android has neither half of that fix:
`apps/android/src/features/files/file-edit-model.ts:363-364` reads both from the closed-over
prop at save time.

**Android's failure is different, and arguably worse for the user.**
`files-screen.tsx:850` rebuilds the controller whenever `file` identity changes, so Android
does not silently overwrite — it silently DISCARDS the user's buffer and drops to read
mode. Establish which of the two happens before you fix either; the web rule that the buffer
is never discarded is the one to carry across.

Neither T41A1b nor T41A2 covers this: both are `area: web` and own
`apps/web/src/features/files/`.

Owns: `apps/android/src/features/files/` and its tests.

- [ ] The write carries the basis captured when editing started, not the live prop
- [ ] A mid-edit `file` replacement does not discard the buffer
- [ ] The user is told the file changed underneath them
- [ ] **Mutation:** restore the live read and show a named test FAILING, with counts
- [ ] The `apps/android` suite shows no new failing file

#### T154 — Broaden the diagnostics export's residual query-secret backstop

`labels: phase-6, area: web` · `wave: P6-W16` · `depends-on: T41B2`

T41B2's second-layer `RESIDUAL_QUERY_SECRET` requires its marker immediately after `[?&]`,
so `?token=` is caught but `?apikey=` and `?access_token=` are not. **Not reachable today**
— the only endpoint-shaped field has a registered redactor that strips the whole query, so
nothing can currently reach the backstop with those markers. This is hardening for a future
unregistered field, filed so it is not rediscovered as a defect.

- [ ] The residual scan catches `apikey`/`access_token`-style markers anywhere in a query
- [ ] Each new marker has a test whose input genuinely carries it
- [ ] **Mutation:** remove the broadened pattern and show each test FAILING, with counts

#### T156 — Widen `guard-capability-prose`'s shipped-source scope to `scripts/ci`

`labels: phase-6, area: tooling` · `wave: P6-W16` · `depends-on: T124, T147, T151`

`run-guard-capability-prose.mjs`'s `isShippedSourcePath` is
`/^(?:packages|apps)\/[^/]+\/src\//` gated on `.ts`/`.tsx`, so **no capability that ships in**
**`scripts/ci` can ever be seen as shipped**, and a `CAPABILITIES` entry for one is inert by
construction.

This is T147's defect one dimension over. T147 widened `packages/client/src` to
`packages/*/src|apps/*/src` after the P6-W12 gate proved an entry outside the client package
could never match. `scripts/ci` was never included, and P6-W15 produced the case that needs
it: T151 shipped `joinAdjacentStringLiterals` while `rpc-command-web-parity.ts` carried a
live sentence denying it existed.

The P6-W15 merge gate proved the scope is the whole difference, changing **only** the member
name in a temporary entry against the same file and the same live sentence:

| `methodNames`                    | ships in                                | guard      |
| -------------------------------- | --------------------------------------- | ---------- |
| `["joinAdjacentStringLiterals"]` | `scripts/ci/guard-capability-prose.mjs` | **exit 0** |
| `["useDiagnosticsExport"]`       | `apps/web/src/features/diagnostics/`    | **exit 1** |

## Keep the guard survivable

T124 built a curated list rather than a generic comment linter on purpose. Widening the
SCOPE is not widening the LIST. Do not add `scripts/` wholesale — `scripts/ci` is the
directory that holds guards; a scratch or one-off script directory is not shipped source.
Exclude `*.test.mjs` the way `.test.ts` is already excluded.

Owns: `scripts/ci/run-guard-capability-prose.mjs`, `guard-capability-prose.mjs` and
`guard-capability-prose.test.mjs`.

- [ ] A capability declared in `scripts/ci/*.mjs` counts as shipped
- [ ] `*.test.mjs` under `scripts/ci` does not count as shipped
- [ ] A `CAPABILITIES` entry naming `joinAdjacentStringLiterals` exits 1 against a
      re-introduced denying sentence and exits 0 at HEAD — add that entry once the scope
      is widened, in that order (T147's lesson: widen the gate before you populate it)
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 at HEAD
- [ ] **Mutation:** narrow the scope back and show a named test FAILING, with counts
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 212/212)

#### T157 — Fix the reused backreference in the prose guard's literal-chain pattern

`labels: phase-6, area: tooling` · `wave: P6-W16` · `depends-on: T151`

T151's `LITERAL_CHAIN` embeds `STRING_LITERAL.source` twice, but the second copy's `\1`
backreference still points at **group 1**. The second literal must therefore close with the
_first_ literal's delimiter. The doc comment says the only thing allowed between two literals
is whitespace, newlines and a bare `+` — it never mentions the delimiter constraint, so the
comment states a false premise as well.

Measured by the P6-W15 merge gate against the real `flattenProse`:

| input               | joined?                                 |
| ------------------- | --------------------------------------- |
| `"A " + "B"`        | joined                                  |
| `'A ' + 'B'`        | joined                                  |
| `"A " + 'B'`        | **not joined**                          |
| `` `A ` + "B" ``    | **not joined**                          |
| `"A " + 'B ' + "C"` | **not joined, and the text is mangled** |

Errs toward false negatives, never false positives, and oxfmt normalises this repository to
double quotes, so live exposure is near zero. It is still a check that is narrower than its
own documentation claims.

Remedy the gate tested: give the repeated literal its own backreference,
`const SECOND_LITERAL = STRING_LITERAL.replace(/\\1/g, "\\2")`. All five rows then join;
arithmetic (`1 + 2 + 3`) and `"count: " + 5 + " items"` stay untouched; across 856
`apps/web|android/src` files it changes the flattened text of 7 files and produces **0** new
phrase hits. Verify that measurement yourself rather than trusting it.

If you decide the same-delimiter restriction is worth keeping, that is an acceptable outcome
— but then the doc comment must say so, and a test must pin it.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] A mixed-delimiter chain joins, or the restriction is documented and pinned by a test
- [ ] A three-literal chain with a mixed middle is not mangled
- [ ] Arithmetic and template-literal concatenation are still untouched
- [ ] The corpus measurement is re-run and reported: files changed, new hits, lost hits
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 at HEAD
- [ ] **Mutation:** revert the backreference and show a named test FAILING, with counts

#### T159 — Comment-strip the parity extractor in the Pi RPC drift detector

`labels: phase-6, area: daemon` · `wave: P6-W16` · `depends-on: T152`

T152's `extractParityCommandNames` matches `/\bcommand:\s*"..."/g` against **raw** file text,
so a commented-out registry entry counts as present. The P6-W15 gate deleted the real
`abort_bash` entry, left `// ... formerly: command: "abort_bash",` in its place, and T152's
own tests reported **8 passed (8)**.

**This is defence in depth, not a live defect.** The same mutation is caught twice over by
`apps/web`'s own suite (`Tests 3 failed | 14 passed (17)`, including
`expected [ 'abort_bash' ] to deeply equal []`), and the add-drift direction is blocked by
`expect(parityNames.length).toBe(32)` — a commented occurrence pushes the count to 33. Filed
so the double backstop is not silently relied on if either half moves.

`guard-capability-prose.mjs`'s `stripComments` is the shape to match. Do not import it into a
server test — that is a cross-tree dependency edge; write the local equivalent, or say why
sharing it is correct.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.test.ts`.

- [ ] A commented-out `command:` entry no longer counts as present
- [ ] **Mutation:** comment out one real entry and show the T152 tests FAILING, with counts
- [ ] The existing 8 tests in that file still pass

#### T160 — Audit and drop the nine orphaned stashes on `main`

`labels: phase-6, area: tooling` · `wave: owner` · `depends-on: T93`

**This is the owner's call, not an agent's — `git stash drop` is irreversible in practice.**
It is filed rather than executed for that reason.

Nine stashes dated 2026-09-01 to 2026-09-05 sit on `main`, from T06A, T27B1, T53A4, T81,
T85, T100, T103, T111 and T117. An orphaned stash is a documented way for an implementer's
only copy of a fix to hide — that is the P6-W9 failure mode, and T93's whole procedure
exists because uncommitted work has twice concealed the true state of `main`.

The P6-W15 merge gate audited them and found **none contains unique work**. The only one
touching a file this phase changed, `stash@{0}` ("T100: isolate other agents' concurrent
edits"), holds a strictly OLDER `guard-capability-prose.mjs` — missing the T143 compaction
entry HEAD has — plus a pre-oxfmt test file; its `run-guard-capability-prose.mjs` is
byte-identical to HEAD.

Re-audit before dropping anything. `git stash show -p stash@{n}` for each, against HEAD.

- [ ] Each of the nine is shown to contain nothing HEAD lacks, with the diff quoted
- [ ] The owner approves the drop explicitly before any `git stash drop` runs
- [ ] `git stash list` is empty afterwards, or the kept ones are named with a reason

#### T162 — Add a `CAPABILITIES` entry for web transfer cancellation

`labels: phase-6, area: tooling` · `wave: P6-W17` · `depends-on: T41A3, T156`

T41A3 shipped `cancel()` on `useFileDownload` and `useFileUpload`, visible Cancel buttons
(`file-upload-panel.tsx`, `file-download-action.tsx`) and a distinct info-tone `"cancelled"`
state. CLAUDE.md says to add a `CAPABILITIES` entry the moment you ship a capability, and
none was added.

**There is no denying prose in the tree today.** The P6-W16 gate grepped `apps/web/src` and
`apps/android/src` for cancellation-absence wording and found only `QueueModePicker`'s
unrelated per-message-queue copy and T41A3's own accurate protocol disclosure. So this entry
is a **forward** guard — which is the stated point of the list, and also the reason it needs
care: an entry with no live text to match is indistinguishable from an inert one unless you
prove the arm synthetically.

## Prove the arm before you trust it

Write the entry, then insert a denying sentence into a real `apps/web/src` file in place,
confirm exit 1, and restore byte-identically. Do not retype an approximation of a sentence
— that was the P6-W14 failure. Then add a `guard-capability-prose.test.mjs` case that pins
the arm synthetically, so the proof survives after you restore the file.

Pick denying phrases a future agent would plausibly write: "cannot be cancelled", "no way to
cancel an in-flight transfer", "transfers cannot be interrupted". Keep them specific enough
that ordinary prose about cancellation does not trip them.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] An entry naming `cancel`-bearing members of the two hooks exists
- [ ] Its arm is proven RED against a denying sentence inserted into a real file, restored
- [ ] A synthetic test pins the arm permanently
- [x] No false positive on T41A3's own protocol-disclosure comment — check that FIRST, since
      that comment truthfully describes a limit and must not be treated as a denial —
      **SUPERSEDED (T166 merge gate): correct for T162's own denying phrases** ("cannot be
      cancelled", "no way to cancel an in-flight transfer", "transfers cannot be
      interrupted"), which stay narrow deliberately and were never meant to fire on
      `use-file-upload.ts`'s own limit disclosure. `762ac3a` ("T163: add a real cancel opcode
      for in-flight uploads") then shipped the opcode this criterion's phrase was
      disclosing the absence of, so as of `762ac3a` the comment this bullet names no longer
      describes the same limit it did when T162 was filed — `use-file-upload.ts` itself was
      correctly left untouched by T163 (see T163's Owns grant), and T165 (P6-W18) is who
      wires the hook to call the new opcode and updates that comment. This bullet was correct
      when written and is superseded by that later work, not wrong.
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 at HEAD
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 223/223)

#### T163 — Close the upload-cancel protocol gap T41A3 disclosed

`labels: phase-6, area: protocol` · `wave: P6-W17` · `depends-on: T41A3`

`use-file-upload.ts`'s module doc states, accurately, that once the hook reaches
`"uploading"`, `cancel()` cannot stop the daemon writing the file: `FileUploadStore`
(`packages/server/src/server/file-upload/index.ts`) stages each chunk and discards only on a
size mismatch or a ten-minute stale timeout, and no cancel opcode exists in
`packages/protocol/src`. The P6-W16 gate spot-checked the store and the protocol and
confirmed the disclosure is true.

**DONE — closed by `762ac3a` ("T163: add a real cancel opcode for in-flight uploads").**
Both claims above ("no cancel opcode exists in `packages/protocol/src`" and "the P6-W16 gate
... confirmed the disclosure is true") were accurate when this section was written; `762ac3a`
then did the work described in outcome (1) below: `file.upload.cancel.request`/`.response` in
`packages/protocol/src/messages.ts`, `DaemonClient.cancelUpload(uploadRequestId)` in
`packages/client/src/daemon-client.ts`, and `FileUploadStore.cancelUpload` in
`packages/server/src/server/file-upload/index.ts`, which awaits the pending chunk-write queue
and then removes the upload directory before resolving `cancelled: true` — a receipt, not a
registration. `use-file-upload.ts` itself was correctly left untouched by T163, per its Owns
grant below; T165 (P6-W18) wires the hook to call the new opcode.

T41A3 was right to disclose rather than overreach — the fix needs `packages/protocol` and
`packages/client`, both outside the files feature.

## Decide before you build

Two honest outcomes, and the document you produce must pick one:

1. **Add a cancel opcode.** A wire message the client can send for an in-flight upload id,
   and a store path that discards staged chunks on receipt. This is real protocol surface
   — new message type, validation, client method, server handler, contract fixtures.
2. **Decide the gap is acceptable** and say why, with the stale-timeout behaviour as the
   mitigation. Then the client-side disclosure stands as the final answer and
   `use-file-upload.ts`'s doc comment should cite this decision rather than reading as an
   open TODO.

Do not do half of (1). A cancel message the server ignores is worse than no cancel message:
it lets a client report a cancellation that did not happen.

Owns: `packages/protocol/src`, `packages/client/src`, `packages/server/src/server/file-upload/`
if you choose (1); `docs/` plus the one doc comment if you choose (2). Do NOT edit
`apps/web/src/features/files/` either way — if the client hook needs to change, file that
as a follow-up.

- [x] The decision is stated with a reason, before any code — `762ac3a` chose outcome (1):
      the store already tracked each upload by requestId and a queue the existing
      stale-timeout path already discards through, so a second discard entry point through
      that same queue was a small, real fix rather than a workaround
- [x] If (1): staged chunks are provably discarded, with a server-side test — `762ac3a`
      added `packages/server/src/server/file-upload/index.test.ts` coverage of
      `FileUploadStore.cancelUpload`
- [x] If (1): the client cannot report "cancelled" until the server confirms — `762ac3a`'s
      `cancelUpload` resolves only after the upload directory is actually gone from disk;
      `cancelled: true` is a receipt, not a registration
- [ ] If (2): n/a — outcome (1) was chosen
- [x] Either way, no prose in the tree still describes the situation you changed — this
      section itself was the exception, closed out by T166 (this file, `762ac3a` named above);
      `762ac3a`'s own commit message flagged it as out of its scope

#### T164 — Retitle the prose guard's trivially-passing real-file test

`labels: phase-6, area: tooling` · `wave: P6-W17` · `depends-on: T156`

`scripts/ci/guard-capability-prose.test.mjs:911` is titled _"T156: the real, current
rpc-command-web-parity.ts (holding the CORRECTED note) does not trip the
joinAdjacentStringLiterals capability"_. The parenthetical implies the
`HISTORICAL_QUOTE_MARKERS` exemption is what saves it. It is not: the corrected note no
longer contains the denying wording at all, so **no phrase matches in the first place** and
the exemption is never exercised. The P6-W16 gate ran all eleven denying phrases against the
real file's flattened text and got no match for any of them.

**The neighbouring T151 test at :869 is NOT this defect** — its own comment says plainly
that the note "reads 'No SESSION-export action exists in apps/web.' — already qualified, so
it must not match". That title is accurate and should be left alone. Check both before you
edit either.

The mechanism itself is genuinely proven elsewhere and does not need new coverage:
`CopyableField.tsx`'s real text does match `useClipboardAction`'s phrase, and the
marker-deletion pair covers the exemption synthetically. This is a titling defect — a test
that passes for a different reason than its name claims — not a coverage gap.

Owns: `scripts/ci/guard-capability-prose.test.mjs`.

- [ ] The :911 title states what the test actually proves (no phrase match at all)
- [ ] The :869 test is left unchanged, or the report says why it also needed changing
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 223/223)

#### T165 — Make the web upload hook actually send T163's cancel opcode

`labels: phase-6, area: web` · `wave: P6-W18` · `depends-on: T163, T41A3`

T163 shipped a real upload-cancel opcode: `file.upload.cancel.request`/`.response` in
`packages/protocol/src/messages.ts`, `DaemonClient.cancelUpload(uploadRequestId)` in
`packages/client/src/daemon-client.ts`, and `FileUploadStore.cancelUpload`, which awaits the
pending chunk-write queue and then removes the upload directory — a real third discard path,
proven against the filesystem by T163's own test.

**`use-file-upload.ts`'s `cancel()` never calls it.** It still only marks the local run
cancelled, so a cancelled upload that has reached `"uploading"` is written by the daemon
anyway. The UI says "cancelled" and the file lands. That is the "registration is not
receipt" shape: the capability exists, the caller does not use it.

T163 was right not to reach into `apps/web/src/features/files/` — that is the T124 carve-out
working as intended, and it disclosed the gap rather than hiding it. This task owns the
wiring.

## The honest state after your change

`cancelUpload` resolves `{ cancelled: true }` or `{ cancelled: false }` — read the real
contract before you design against it. **The UI must not claim the file was discarded until
the daemon says so.** A cancel that reaches the daemon after staging completed may honestly
come back `cancelled: false`, and the user needs to see that difference: their intent was
registered either way, the file's fate was not the same.

The module doc's `CORRECTED (P6-W17 merge gate)` block says plainly that this hook does not
send the opcode yet and warns against rewording "cancelled" into a claim about the file. Your
commit falsifies that paragraph — rewrite it in the same commit, per T124.

Owns: `apps/web/src/features/files/` and its tests. Do NOT edit `packages/` — the protocol,
client and server halves are done.

- [ ] `cancel()` calls `client.cancelUpload()` once the run has reached `"uploading"`
- [ ] It does not call it while still `"reading"` — nothing has been sent, so there is
      nothing to cancel and no request should go out
- [ ] `cancelled: true` and `cancelled: false` are distinguishable to the user
- [ ] A rejected or never-answered cancel does not leave the UI claiming success
- [ ] **Mutation:** remove the `cancelUpload` call and show a named test FAILING on the
      EFFECT (the client method was not called), with counts
- [ ] The module doc no longer says this hook does not send the opcode
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 (it takes ~2 minutes; run it
      in the FOREGROUND, never poll)

#### T166 — Close out the upload-cancel rows this file states as still open

`labels: phase-6, area: docs` · `wave: P6-W18` · `depends-on: T163`

Three claims in this file are false as of `762ac3a`:

- T163's own section says "no cancel opcode exists in `packages/protocol/src`" and "the
  P6-W16 gate ... confirmed the disclosure is true". Both were true when written; T163 then
  did the work.
- T162's section says `use-file-upload.ts`'s comment "truthfully describes a limit". That
  instruction was correct **for T162's own phrases**, which stay narrow deliberately — and it
  is superseded, not wrong. Say so; do not rewrite history into a mistake nobody made.

A task specification is a historical record of what was true when the task was filed, so the
bar here is different from a doc comment: mark them **DONE** with the commit that closed them
rather than deleting the prose. `docs/issues-from-plan.md` is read by every implementer at
the start of every wave, which is exactly why a stale premise in it propagates.

Owns: `docs/issues-from-plan.md`, T162's and T163's sections only. Do NOT touch the wave
table or any other task's section — the reviewer records waves there and an edit from you
collides.

- [ ] T163's section records the opcode as shipped, naming `762ac3a`
- [ ] T162's criterion is marked superseded with the reason, not deleted
- [ ] No other section is touched
- [ ] `./node_modules/.bin/oxfmt --check .` passes — oxfmt realigns Markdown tables and
      formats JS inside ```js fences, so run it AFTER your last edit

#### T168 — Tighten the transfer-cancellation entry's shipped-capability gate

`labels: phase-6, area: tooling` · `wave: P6-W18` · `depends-on: T162`

T162's entry uses `methodNames: ["cancel"]`. That is the broadest shipped-gate token in the
list. It is not dead — `isCapabilityMemberDeclared` returns `true` for both hooks — and it
does not currently false-positive. The problem is that a bare `cancel` is declared in many
places, so **the entry would keep firing even if T41A3's hooks lost `cancel()` entirely**.
Its "is this shipped?" gate is decoupled from the capability it names.

The failure this invites is subtle: if the capability were removed, the guard would go on
blocking prose that had become TRUE again. A guard that forbids an accurate statement is
worse than one that misses an inaccurate one.

Replace with tokens that only exist if the capability does — `useFileUpload` and
`useFileDownload`, or the specific members — and re-prove the arm in place against a real
denying sentence, restoring byte-identically.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] The shipped gate cannot be satisfied by an unrelated `cancel` declaration
- [ ] A test proves the entry stops firing if the capability is removed
- [ ] The in-place RED proof is re-run and quoted
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 61/61 for this file)

#### T169 — Make the transfer-cancellation gate go quiet when `cancel()` is gone

`labels: phase-6, area: tooling` · `wave: P6-W19` · `depends-on: T168`

T168 replaced `methodNames: ["cancel"]` with AND-groups
(`[["useFileUpload", "cancel"], ["useFileDownload", "cancel"]]`) and its commit message
claims the old form "would keep this entry 'shipped' even if `cancel()` were deleted from
BOTH `useFileUpload` and `useFileDownload` entirely", which the AND-group fixes.

**It still fires after `cancel()` is deleted from both hooks.** The AND-group moved the
collision from cross-file to same-file. `apps/web/src/features/files/use-file-download.ts`
declares, on its own local `MinimalStreamReader` interface:

```ts
cancel?(reason?: unknown): Promise<void> | void;
```

Same file as `useFileDownload`, so it satisfies the group by itself. That is literally the
`MinimalStreamReader.cancel()` T168's own commit message cites as the archetype of the
bare-token problem.

Reproduced at the P6-W18 gate and again at the review, driving the committed
`isCapabilityMemberDeclared` against the real file:

```
useFileDownload declared: true
cancel declared: true
after removing the hook-controller cancel, cancel STILL declared: true
```

**Why T168's own tests cannot see it:** both new tests put the unrelated `cancel` in a
DIFFERENT file (`approvals/approval-dialog.tsx`). The real collision is in the same file —
exactly the case an AND-group cannot exclude. The tests are genuine; they are pinned to a
fixture shape that avoids the failure.

## The remedy the gate tested, and its disclosed cost

Keep the AND-group; let a group member be a `RegExp` tested against the comment-stripped
source, matching the controller's declaration SHAPE rather than the bare name:

```js
const CONTROLLER_CANCEL_MEMBER = /\bcancel\s*:\s*\(\s*\)\s*=>\s*void/;
```

Measured against the real files: capability present + denying sentence —> 1 violation;
`cancel` removed from both hooks + same sentence —> 0. **It also turns
`guard-capability-prose.test.mjs` red at 60 pass / 3 fail** — tests 56, 57 and 58, whose
synthetic fixtures declare `cancel` in a shape the regex does not match. Those fixtures need
re-shaping to the controller form. Do not treat that as a reason to abandon the approach;
do treat it as a reason to check every other entry for the same fixture-shape assumption.

You are not obliged to use this remedy — it is one that was measured, not a mandate. If you
find a better one, prove it the same way.

## Performance is part of the acceptance here

When a `CAPABILITIES` group finds no evidence anywhere, `evidencePool.some(...)` never
short-circuits and a full run costs **7m22s** (measured) against well under two minutes at
HEAD. Any remedy must keep the common path short-circuiting, and you must report the timing
of both the green and the quiet runs.

## Also correct three sentences in your own files

Already fixed at the P6-W18 gate; verify they stayed fixed and do not re-introduce the shape.
The lesson worth carrying: a comment that says "X is still true today" about a gap someone
has just filed a task to close will be false within one wave. Cite the commit, or cite the
task, but do not assert the present tense about work already scheduled.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] With `cancel` renamed away in both hook files and a denying sentence inserted,
      `node scripts/ci/run-guard-capability-prose.mjs` exits **0**
- [ ] With the hooks intact and the same sentence inserted, it exits **1**
- [ ] A test whose fixture puts the unrelated `cancel` in the SAME file as the hook
- [ ] Every other `CAPABILITIES` entry checked for the same shape; say what you found
- [ ] Both timings reported; the green path stays under two minutes
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 232/232)

#### T171 — Assert the packed daemon tarball actually carries the web UI

`labels: phase-8, area: tooling` · `wave: P6-W19` · `depends-on: T43A1`

T43A1 made `build-daemon-web-ui.mjs` fail loudly when `apps/web/dist` is missing, and that
works — reproduced twice, exit 1 with a message naming the path. What nothing checks is the
output: **no gate asserts the packed tarball contains the bundle.**

Two live holes, both found by reading `.github/workflows/ci.yml`:

- **`ci.yml:343-347`, `Verify public package contents`** runs
  `npm pack --dry-run --ignore-scripts --workspace=@picompanion/server` in a job that never
  runs `build:daemon-web-ui`. That tarball contains **no** `web-ui` at all, and the job
  passes. Decide what this job should assert — it may be right that it does not need the
  bundle, but then it should say so rather than being silently blind.
- **`ci.yml:665-672`, `daemon-package-dry-run`** does bundle first, but only PRINTS the
  listing. Nothing greps it. An `apps/web/dist` that exists but is empty produces an empty
  bundle, exit 0, and a green job.

`grep -rln "web-ui" scripts/ci/` returns nothing — there is no guard for this at all.

This gates the rest of Phase 8. A daemon that packages without its UI is the exact failure
T43A1 exists to prevent, and today only the input is checked.

## What the check must actually assert

Presence of `dist/server/web-ui/index.html` in the pack listing is the minimum. Consider
also a non-trivial size floor — an empty `index.html` satisfies presence and serves nothing.
Measured at HEAD for calibration: **176** `dist/server/web-ui/` entries, total 793 files,
unpacked 12.0 MB. Do not hardcode 176; a file count that must be updated on every UI change
is a check that gets deleted.

**Never run `npm publish`. `--dry-run` only.** Do not run `npm install` or `npm ci`.

Owns: a new `scripts/ci/guard-*.mjs` plus its `node --test` file, and the two
`.github/workflows/ci.yml` jobs named above.

- [ ] The guard fails when the pack listing has no `dist/server/web-ui/index.html`
- [ ] **Mutation:** empty or remove the bundle, run the guard, show it FAILING, restore
- [ ] `daemon-package-dry-run` asserts rather than prints
- [ ] `Verify public package contents` either asserts the bundle or states why it does not
- [ ] `node --test scripts/ci/*.test.mjs` passes

#### T172 — Close the compaction entry's shipped-gate hole

`labels: phase-6, area: tooling` · `wave: P6-W20` · `depends-on: T169, T168`

T169 fixed the transfer-cancellation entry's shipped gate and was asked to check the other
entries for the same shape. It fixed its own and did not check the others. **The compaction
entry has the identical defect, and it is worse than the one just fixed.**

`methodNames: ["summary", "filesRead", "filesModified"]` is an **OR across bare names**, and
`summary` alone is declared in **33 shipped files** — re-measured at the review by driving
the committed `isCapabilityMemberDeclared` over every tracked `packages|apps/*/src` source
file. Almost all are unrelated to compaction: `ModelThinkingPicker.tsx`, `QueueModePicker.tsx`,
`ConnectForm.tsx`, `ShareChooserScreen.tsx`, `RecordList.tsx`,
`packages/cli/src/commands/loop/inspect.ts`. The entry is "shipped" forever regardless of
whether the capability exists.

## The proof, already run

The P6-W19 merge gate removed `summary`/`filesRead`/`filesModified` from all four files that
actually declare them for compaction — `packages/protocol/src/agent-types.ts`,
`packages/frontend-core/src/timeline/transcript-view.ts`,
`packages/server/src/server/agent/agent-sdk-types.ts`,
`apps/android/src/features/composer/turn-status-model.ts` — verified zero declarations left,
then re-inserted the exact pre-T146 denying sentence into `compaction-row.tsx`, which is now
**true**:

```
guard-capability-prose: FAILED
  apps/web/src/features/transcript/compaction-row.tsx: "compaction summary and file details
  (summary/filesRead/filesModified)" is a real, shipped capability, but this file's prose
  asserts it is absent
EXIT=1
```

The guard forbids a true sentence after the capability is gone. **A guard that forbids an
accurate statement is worse than one that misses an inaccurate one**, because the only way to
satisfy it is to write something false.

Reproduce this yourself before fixing it. Restore all five files byte-identically from
scratchpad copies — never `git checkout --`.

## The remedy, and the precedent to follow

T168 and T169 already worked this out for `cancel`: an AND-group tying members to the file
that actually declares them, and/or a `RegExp` member matching the declaration SHAPE rather
than the bare name. `CompactionTranscriptEntry` / `CompactionTimelineItem` co-occurrence is
the obvious anchor here.

**Audit every remaining entry while you are in there.** The gate checked the other five and
found them sound (`useClipboardAction`, `useDiagnosticsExport`/`buildDiagnosticsExportBundle`,
`joinAdjacentStringLiterals` —> 1 file each; `cancelUpload` —> 3, all related; the queue-mode
trio —> 8-9, all genuinely queue-mode). Re-derive that rather than trusting it, and report
the per-entry file counts. `summary`'s 33-file spread is the worked example of what to look
for.

## Timing is an acceptance criterion

A full run is ~3m38s at HEAD and ~7m19s on the quiet path (capability genuinely absent, so
`evidencePool.some(...)` never short-circuits). T169's `WeakMap` strip cache is what made the
green path faster than the 4m35s at its own wave base. Do not lose that. Report both timings.
Run in the FOREGROUND with a long timeout; never background and poll.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.

- [ ] With the three members removed from all four declaring files and the pre-T146 sentence
      re-inserted, `node scripts/ci/run-guard-capability-prose.mjs` exits **0**
- [ ] With the tree intact and that sentence inserted, it exits **1**
- [ ] A test whose fixture declares a bare `summary` in an unrelated file and proves it does
      NOT satisfy the entry
- [ ] Per-entry declaring-file counts reported for all seven entries
- [ ] Both timings reported; the green path stays under four minutes
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 247/247)

#### T173 — Cover the `isInsideDir` call site, not just the predicate

`labels: phase-8, area: daemon` · `wave: P6-W20` · `depends-on: T43A2`

`resolveTargetFile` in `packages/server/src/server/web-ui.ts` has two independent traversal
defenses: `path.normalize(...).replace(/^(\.\.[/\\])+/, "")` and an
`isInsideDir(filePath, distDir)` containment check. **The second one can be deleted outright
and every test still passes.**

Measured at the P6-W19 gate, three mutations:

| Mutation                                                       | Result                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `isInsideDir` body —> `return true`                            | 1 failed / 54 passed of 55 — and the only failure is its own unit test |
| **Delete the `if (!isInsideDir(...)) return null;` call site** | **55/55 pass, and 199/199 across all 9 `web-ui*` suites**              |
| `const safePath = requestPath;` (drop normalize)               | 1 failed / 54 passed of 55                                             |

Every `resolveTargetFile` traversal test is satisfied by `path.normalize` alone. The
security-relevant containment check **as wired** has no behavioural test, so a future
refactor can delete it silently. This is the catalogue's "a proof aimed at the primitive when
the behaviour lives in the wiring above it".

It also makes T43A2's own doc comment — _"Exported for direct, socket-free testing of the
traversal defenses"_ — overstate what is proven. Correct it to say which defense is proven
where, in the same commit.

## What the test must do

Find an input that `path.normalize` does NOT sanitise but `isInsideDir` does reject — or
inject a `distDir` that makes the difference observable. On Windows, consider drive-relative
and UNC-shaped inputs; the gate confirmed `path.join` already blocks the obvious ones, so the
case you need is narrower than it first looks. If you conclude no such input exists and the
call site is genuinely redundant, **say so with the evidence and delete it** rather than
adding a test that cannot fail — but be certain, because deleting a containment check on the
strength of a Windows-only experiment is how a traversal ships.

**Never bind a port or start a server.** T43A2's whole point is that this is testable
socket-free; keep it that way.

Owns: `packages/server/src/server/web-ui.ts` and its tests.

- [ ] Deleting the `isInsideDir` call site from `resolveTargetFile` fails at least one named
      test (today: 199/199 pass)
- [ ] **Mutation:** show that failure with counts, then restore
- [ ] The "traversal defenses" doc comment says which defense is proven where
- [ ] No socket, no port, no server
- [ ] `cd packages/server && npx vitest run src/server/web-ui` — quote the counts

#### T174 — Make the packaging guard check build order, not just step presence

`labels: phase-8, area: tooling` · `wave: P6-W21` · `depends-on: T43A3`

`scripts/ci/guard-docker-packaging-paths.mjs` checks that each packaging file's build steps
NAME every required workspace and the `build:daemon-web-ui` step. It never checks that they
appear in the right ORDER — and order is the only thing that can silently defeat T43A1's
packaging invariant.

Both packaging files carry an explicit warning about exactly this.
`packaging/docker/Dockerfile:47`: _"Never reorder step 3 after step 4 — build:clean's dist
wipe would erase an already-bundled web-ui."_ `packaging/nix/flake.nix:60-62` says the same.

## The proof, run twice at the P6-W20 gate and again at the review

Swap the two build lines in BOTH files so `build:daemon-web-ui` runs first and `build:clean`
then wipes `packages/server/dist`:

```
Dockerfile 79/80:  && npm run build:daemon-web-ui -- --skip-build \
                   && npm run build:clean --workspace=@picompanion/server
flake.nix 101/102: npm run build:daemon-web-ui -- --skip-build
                   npm run build:clean --workspace=@picompanion/server
```

```
node scripts/ci/run-guard-docker-packaging-paths.mjs
guard-docker-packaging-paths: OK (packaging/docker/Dockerfile)
guard-docker-packaging-paths: OK (packaging/nix/flake.nix)
EXIT=0
```

Both packaging paths would build an image and a derivation with **no web UI at all**, and the
guard is green. This is the catalogue's _"a guard on the precondition standing in for a guard
on the artifact"_, in its ordering variant.

**Positive control, so this is not a claim the guard is inert:** delete the
`@picompanion/highlight` build line (Dockerfile line 74) and you get
`FAILED ... no RUN instruction builds workspace "@picompanion/highlight"`, **EXIT=1**. Step
omission is caught; step ordering is not. Reproduce both before you change anything.

`grep -n "order|indexOf|before|after|sequence" scripts/ci/guard-docker-packaging-paths.test.mjs`
returns **zero hits** across all 34 tests, and the guard file itself has no position
comparison anywhere.

## The remedy

Add an ordering assertion to `checkDockerPackaging` and `checkNixPackaging`: within the same
concatenated command text, `build:clean --workspace=@picompanion/server` must appear BEFORE
the `build:daemon-web-ui` step. Prove it RED-then-GREEN with the swap above — **mutate the
real files in place, one line each; a retyped approximation tests your typing, not the
guard.** Restore from a scratchpad copy, never `git checkout --`.

Think about whether ordering should extend to the workspace chain too
(`REQUIRED_WORKSPACE_BUILD_STEPS` is written in dependency order but consumed as an
order-insensitive membership test). Building `client` before `protocol` is just as fatal as
the wipe, and just as invisible today. If you decide that is out of scope, say so and file it.

## The prose is already corrected — now make it true again

Four sites claimed the guard checks order or reads `.dockerignore`. The P6-W20 gate corrected
all four to describe what the guard ACTUALLY does, each with a `CORRECTED (P6-W20 gate)`
marker and the reproduction. When you land the ordering check, update those four to say the
ordering half now exists, citing your commit — do not simply delete the correction, and do
not re-assert the `.dockerignore` claim (that one is T177's, and is about the file, not the
guard):

- `packaging/docker/Dockerfile` header
- `packaging/docker/README.md`, the COPY-source bullet and the build-order bullet
- `packaging/nix/README.md`, the workspace-path bullet
- `scripts/ci/guard-docker-packaging-paths.mjs` header point 2 and the
  `REQUIRED_WORKSPACE_BUILD_STEPS` doc comment

Owns: `scripts/ci/guard-docker-packaging-paths.mjs`, its `.test.mjs`, and the four prose
sites above. Do NOT touch `.github/workflows/ci.yml` (T176's) or `.dockerignore` (T177's).

**Never run `docker build` or `nix build`** — neither toolchain exists in this environment.

- [ ] With the two lines swapped in either packaging file, the guard exits **1**
- [ ] With the files intact, it exits **0**
- [ ] The omission positive control still exits **1**
- [ ] The four prose sites say what the guard now does, citing your commit
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 286/286)

#### T175 — Check the packaging artifacts' runtime entrypoint paths exist

`labels: phase-8, area: tooling` · `wave: P6-W22` · `depends-on: T174`

`guard-docker-packaging-paths.mjs`'s header claims _"Every filesystem path each packaging
file's build steps reference ... resolves to something that actually exists."_
`extractDockerCopySources` extracts only `COPY` sources. `ENTRYPOINT`, `CMD`, `WORKDIR`, and
the Nix `installPhase` launcher path are never extracted.

Measured at the P6-W20 gate: rewriting `ENTRYPOINT` to
`["node", "dist/scripts/THIS-FILE-DOES-NOT-EXIST.js"]` and the flake's launcher to a
matching bogus path leaves the guard **OK on both, EXIT=0**. On the committed files the
entrypoint is correct (`packages/server/dist/scripts/supervisor-entrypoint.js` exists and
matches the server's `start` script), so this is latent, not live.

Note the related triviality the gate also measured: the committed Dockerfile's only COPY
sources are `.` and a `--from=builder` (skipped), so the existing COPY check only ever
asserts that `.` exists. Whatever you build should be meaningful on the real files, not just
on a fixture.

Owns: `scripts/ci/guard-docker-packaging-paths.mjs` and its `.test.mjs`. Scheduled AFTER
T174 because both own that file.

- [ ] Extract `ENTRYPOINT`/`CMD` executable paths, resolved against `WORKDIR`, and the Nix
      `installPhase` launcher target
- [ ] **Mutation:** both bogus-path rewrites above exit **1**; the real files exit **0**
- [ ] `node --test scripts/ci/*.test.mjs` passes

#### T176 — Wire the packaging guard into CI

`labels: phase-8, area: tooling` · `wave: P6-W21` · `depends-on: T43A3`

`run-guard-docker-packaging-paths.mjs` runs nowhere in CI — confirmed at the gate, no
`guard-docker` match in `.github/workflows/ci.yml`. T43A3 disclosed this honestly as outside
its Owns grant (`packaging/README.md`, "Disclosed gap"). Combined with the absence of any
real `docker build`/`nix build`, the two packaging paths currently have **zero** end-to-end
coverage of any kind.

plan.md §15.4 asks for "Docker and Nix checks when their paths change". Wire it, and update
the disclosure in `packaging/README.md` so it does not go stale — a disclosed gap that has
been closed but still reads as open is its own defect.

Owns: `.github/workflows/ci.yml` and `packaging/README.md`'s disclosure section. Do NOT edit
`scripts/ci/guard-docker-packaging-paths.mjs` (T174's this wave) or `.dockerignore` (T177's).

**T174 lands in the same wave and changes what the guard asserts.** Your job is the wiring,
not the assertions; if the guard is red when you wire it, that is T174's business — say so
rather than editing the guard.

- [ ] The guard runs in CI on a path that includes `packaging/**` and `scripts/ci/**`
- [ ] Quote the job's YAML and say which trigger paths reach it
- [ ] `packaging/README.md`'s disclosure reflects reality

#### T177 — Fix `.dockerignore` depth semantics and its header rationale

`labels: phase-8, area: tooling` · `wave: P6-W21` · `depends-on: T43A3`

`.dockerignore`'s `node_modules/`, `dist/`, `*.log` and `*.tsbuildinfo` patterns match at the
**root level only** — Docker needs `**/node_modules` for arbitrary depth. Six nested
workspace `node_modules` and ten nested `dist/` directories therefore enter the build context,
which contradicts the file's own header comment about _"host-platform-specific `node_modules`
that must never be copied into the Linux build stage."_

**The gate measured the consequence and it does not materialize:** all six nested trees are
~1 MB with **zero** native `.node` binaries; all 15 native binaries live in the root
`node_modules`, which IS excluded. So this is accuracy and context size, not a broken build.
Re-measure rather than trusting that, and if you find a native binary in a nested tree, say
so — it changes the severity.

Owns: `.dockerignore` only. Do NOT edit the guard (T174's this wave) or `ci.yml` (T176's).

- [ ] The four patterns use `**/`-prefixed forms
- [ ] The header comment's rationale matches what the patterns actually exclude
- [ ] Re-measured nested-tree sizes and native-binary counts reported

#### T178 — Make the packaging guard comment-aware in its build-step checks

`labels: phase-8, area: tooling` · `wave: P6-W22` · `depends-on: T174`

T174's ordering check discriminates correctly on reordering — four mutations proved it. It
is **blind to comments**, and so is the presence check it sits beside.

## The proof, run at the P6-W21 gate and again at the review

Comment out the `build:clean --workspace=@picompanion/server` line — in either packaging
file, one at a time, leaving the line continuation intact:

```
node scripts/ci/run-guard-docker-packaging-paths.mjs
guard-docker-packaging-paths: OK (packaging/docker/Dockerfile)
guard-docker-packaging-paths: OK (packaging/nix/flake.nix)
EXIT=0
```

That is not cosmetic. `build:clean --workspace=@picompanion/server` is the **only** step that
builds the server package; without it
`packages/server/dist/scripts/supervisor-entrypoint.js` — the image's own `ENTRYPOINT` —
never exists. Both checks are satisfied by prose: the presence check finds
`@picompanion/server` inside the comment text, and the ordering check reads the comment's
position as the step's. This is the catalogue's _"a prohibition satisfied by a comment"_.

## Why it happens

- `extractDockerRunCommands` joins line continuations (`replace(/\\\r?\n/g, " ")`) **before**
  it filters for `^\s*RUN\s`, so a `#` comment line inside a RUN continuation is welded into
  the RUN text.
- `extractNixPhaseCommands` collects `''…''` bodies verbatim and never strips the `#` shell
  comments that legally live inside them.

The fix already exists in the same file: `stripDockerfileComments` and `stripNixComments`
(lines 243 and 258) do exactly this stripping, but are wired only into the legacy-reference
check (lines 333 and 426). The build-step checks were never given the same treatment.

**Watch the order of operations.** Stripping `#` comments must happen at the right point
relative to the continuation join, or you will either miss welded comments or eat a `#` that
is legitimately part of a command. Say which order you chose and why.

The comment-blindness predates T174 (`extractDockerRunCommands` dates to T43A3, `7acb3a2`);
only the sentence denying it was T174's, and that sentence was corrected at the P6-W21 gate.
**Update that correction to say the hole is closed, citing your commit — do not delete it.**

Owns: `scripts/ci/guard-docker-packaging-paths.mjs` and its `.test.mjs`.

- [ ] Commenting out `build:clean` in either packaging file exits **1**
- [ ] **Mutation:** show it, per file, with exit codes, then restore byte-identically
- [ ] The four T174 mutations still discriminate (swap per file, omission, workspace chain)
- [ ] The intact tree still exits **0**
- [ ] `node --test scripts/ci/*.test.mjs` passes

#### T179 — Widen `guard-capability-prose`'s DENIAL scan to match its declaration scope

`labels: phase-6, area: tooling` · `wave: P6-W22` · `depends-on: T156`

The guard's **declaration** scan has been widened twice: T147 to `packages/*/src` +
`apps/*/src`, T156 to `scripts/ci`. The **denial** scan was never widened. It is still only
`apps/web/src` and `apps/android/src` — the guard's own output says so:
_"...checked against 1202 packages/_/src|apps/_/src|scripts/ci file(s) and 856
apps/web|android src file(s)"_.

Every false-premise site found in the last two waves lived outside that scope:

| Wave   | Site                                                                | In denial scope? |
| ------ | ------------------------------------------------------------------- | ---------------- |
| P6-W20 | `packaging/docker/Dockerfile` header                                | no               |
| P6-W20 | `packaging/docker/README.md` ×2                                     | no               |
| P6-W20 | `packaging/nix/README.md`                                           | no               |
| P6-W20 | `scripts/ci/guard-docker-packaging-paths.mjs` header                | no               |
| P6-W21 | `guard-docker-packaging-paths.mjs`'s `findBuildOrderViolations` doc | no               |

`node scripts/ci/run-guard-capability-prose.mjs` exits **0** with all six present. This is the
catalogue's _"an entry in a curated list whose runner's scope can never see the case"_, one
level up: the scope is wrong for the whole denial half.

## The cost you must measure

A full run is ~3m37s at HEAD and ~7m19s on the quiet path, where a `CAPABILITIES` group finds
no evidence anywhere and `evidencePool.some(...)` never short-circuits. Widening the denial
corpus makes both worse. T169's `WeakMap` strip cache is what keeps the green path fast — do
not lose it, and **report both timings**. If the green path goes past four minutes, say so
and propose what to do rather than shipping it quietly.

Run in the FOREGROUND with a long timeout; never background and poll.

Decide deliberately which trees to add. `scripts/ci` and `packaging/**` are the demonstrated
cases. `.github/**` is arguable. `docs/**` is almost certainly wrong — the ledger is full of
historical task briefs that legitimately describe capabilities as absent at the time they
were written, and adding it would make the guard fire on its own history. Say what you chose
and why.

Owns: `scripts/ci/guard-capability-prose.mjs` and `guard-capability-prose.test.mjs`.
**T178 owns `guard-docker-packaging-paths.mjs` in the same wave — do not edit it.** If
widening the scope makes the guard fire on a site T178 owns, report it; do not fix it.

- [ ] A denying phrase in `scripts/ci` and one in `packaging/**` are both caught
- [ ] **Mutation:** insert one, show exit **1**, remove it, show exit **0**
- [ ] Both timings reported; the green path stays under four minutes
- [ ] `node --test scripts/ci/*.test.mjs` passes

#### T180 — Give `.dockerignore` a guard

`labels: phase-8, area: tooling` · `wave: P6-W23` · `depends-on: T177`

`grep -rn 'dockerignore'` across every `.mjs`/`.ts`/`.yml`/`.js` outside `node_modules`
returns **zero hits**. Nothing in the repository reads this file. T177 fixed its depth
semantics correctly, and nothing would catch a future edit dropping the `**/` prefixes.

Assert that every pattern meant to be depth-agnostic carries `**/`. The interesting design
question is how the guard knows which those are — a hardcoded list has the same staleness
problem as `REQUIRED_WORKSPACE_BUILD_STEPS`, and a heuristic over all patterns will
false-positive on genuinely root-only entries. Pick one, disclose the trade-off.

**Never run `docker build`.** Owns: a new `scripts/ci/guard-*.mjs`, its `.test.mjs`, and the
CI wiring for it.

- [ ] The guard fails when a depth-agnostic pattern loses its `**/`
- [ ] **Mutation:** strip one prefix, show exit **1**, restore
- [ ] Wired into CI under the `packaging` filter

#### T181 — Warn at authoring time that a new CI filter needs the pinned array updated

`labels: phase-8, area: tooling` · `wave: P6-W23` · `depends-on: T176`

T176 added the `packaging` filter to `.github/ci-paths.yml` and did not update
`scripts/ci/ci-routing.test.mjs`'s pinned filter-name array. `main` went **red**, and worse
than it first looked: `node --test scripts/ci/*.test.mjs` is a step of the **`changes` job
itself** (`ci.yml` line 60, unconditional on every event), so the routing job fails and all
25 jobs carrying `needs: changes` lose their `needs.changes.outputs.*` values. A full CI
outage, from one unupdated array.

Fixed at the P6-W21 gate by adding `"packaging"` to the array. **The pin itself is correct
and valuable — it caught this. Do not weaken it.** What is missing is any warning at the
moment someone edits `ci-paths.yml`.

A comment in `.github/ci-paths.yml` naming the test that must be updated is the cheapest
thing that works. Consider whether the failure MESSAGE can also say it — a diff reading
`+ 'packaging'` does not tell you what to do about it.

Owns: `.github/ci-paths.yml` and `scripts/ci/ci-routing.test.mjs`'s failure message.

- [ ] Editing `ci-paths.yml` puts the requirement in front of the author
- [ ] The failure message says which file to update
- [ ] `node --test scripts/ci/ci-routing.test.mjs` passes (baseline: 11/11)

#### T182 — Replace the hard-coded line-number pointers in the packaging prose

`labels: phase-8, area: docs` · `wave: P6-W23` · `depends-on: T174`

Two sites point at line numbers, and **both were already wrong when `bb7420e` wrote them**:

| Site                                                                  | Claimed | Actually, when written | Now   |
| --------------------------------------------------------------------- | ------- | ---------------------- | ----- |
| `packaging/docker/README.md` "this file's own line 47"                | 47      | 55                     | 64    |
| `packaging/docker/Dockerfile` header "Swapping lines 79 and 80 below" | 79/80   | 87/88                  | 96/97 |

Both name the `"Never reorder step 3 after step 4"` warning and the two build lines around
it. A pointer that was wrong on the day it was written is worse than no pointer: it sends the
reader to an unrelated line and quietly costs their trust in the rest of the paragraph.

Replace both with quoted anchor text — the sentence or command itself, which survives
insertions above it. Grep the whole `packaging/` tree for other line-number references while
you are there; these two are what the gate found, not a guaranteed complete set.

Owns: `packaging/docker/README.md` and `packaging/docker/Dockerfile`'s header comment only.

- [ ] Neither site names a line number
- [ ] The anchors quoted actually appear in the files they point at
- [ ] Any other line-number pointer under `packaging/` found and listed

#### T183 — Add a `CAPABILITIES` entry for the packaging build-order capability

`labels: phase-6, area: tooling` · `wave: P6-W23` · `depends-on: T179, T174`

T179 widened `guard-capability-prose`'s denial scan to `scripts/ci` and `packaging/**` —
correct, necessary, and well argued. **It does not close the gap its own header cites as
motivation**, and the header said it did.

All six false-premise sites T179 lists are about the **packaging build-order capability**
(T174's `findBuildOrderViolations`, T178's comment-awareness), and **no `CAPABILITIES`
entry's `denyingPhrases` describe it**. Re-derived at the P6-W22 gate against all seven
entries: queue-mode trio, clipboard failure, compaction detail, diagnostics export,
`joinAdjacentStringLiterals`, transfer cancellation, upload-cancel opcode. None matches a
sentence like _"the guard checks that the build order matches `prepack`"_ or _"this
packaging path cannot silently skip the T43A1 bundling invariant"_.

So those six sites would pass today even now that they are in scope. The gate measured it
both ways at unit level against `findCapabilityDenialViolations`, with all six placed in the
new scope in their reconstructed pre-correction wording:

| Input                                                             | Violations |
| ----------------------------------------------------------------- | ---------- |
| the six cited sites                                               | **0**      |
| control: `"the protocol has no cancel opcode."` (an entry exists) | **1**      |

And across all **49** newly-in-scope files, **0** raw denying-phrase occurrences with markers
ignored — so nothing in the new scope exercises the historical-quotation suppression against
the tree's real history either. Re-derive both numbers rather than trusting them.

The header sentence was corrected at the P6-W22 gate to say the widening is the
necessary-not-sufficient half. **Update that correction when your entry lands, citing your
commit — do not delete it.**

## What the entry has to get right

CLAUDE.md is explicit: _"Add a new capability entry the moment you ship one"_, and _"check
first that the runner can SEE where your capability ships"_. T174 shipped a capability and no
entry followed — that is the rule this task exists to satisfy.

The declaration side is the interesting half. `findBuildOrderViolations` lives in
`scripts/ci`, which `isShippedSourcePath` has covered since T156, so the runner CAN see it.
But read T168's and T169's history before choosing `methodNames`: a bare token that collides
across unrelated files makes the entry "shipped" forever (T172's `summary`, 33 files), and an
AND-group can relocate the collision into one file (T169's `MinimalStreamReader.cancel`). A
`RegExp` member matching the declaration SHAPE is the current best practice.

Owns: `scripts/ci/guard-capability-prose.mjs`, its `.test.mjs`, and
`run-guard-capability-prose.mjs`'s corrected header sentence. **T180 and T181 also touch
`scripts/ci` this wave — T180 adds a new guard file, T181 edits `ci-routing.test.mjs`'s
failure message. Do not edit either.**

Report the declaring-file count for your new entry AND re-report it for all seven existing
ones — that audit has caught a real defect twice (T169 skipped it, T172 found the 33-file
spread).

Timing: ~3m49s at HEAD post-T179. **Report it; the green path stays under four minutes.**
Run in the FOREGROUND with a long timeout.

- [ ] An entry whose `denyingPhrases` match at least two of the six real corrected sentences
- [ ] **Mutation:** insert one such sentence unmarked into a `packaging/**` file — exit **1**;
      remove it — exit **0**
- [ ] With the capability's declaration removed, the same sentence is allowed (exit **0**)
- [ ] Declaring-file counts for all eight entries
- [ ] The corrected header sentence updated, its record kept
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 348/348)

#### T184 — Resolve "is this capability shipped?" once per capability, not per file pair

`labels: phase-6, area: tooling` · `wave: P6-W24` · `depends-on: T183`

One refactor fixes two things: a structural blindness T183 exposed, and the runtime that has
now crossed four minutes.

## The blindness

`findCapabilityDenialViolations` excludes each judged file from its own `shippedFiles`
evidence pool — T147's acceptance requirement, and correct at the time. T183's packaging
build-order entry has exactly **one** declaring file,
`scripts/ci/guard-docker-packaging-paths.mjs`, and that is the same file carrying **two of the
six** false-premise sites the entry was written for (T179's committed inventory names them:
that file's header and its `findBuildOrderViolations` doc comment). While that file is being
judged the capability is never "shipped", so no denial in it can ever be reported.

Measured at the P6-W23 gate and again at the review, one variable — the containing file. The
byte-identical line

```
// The guard checks that the build order matches packages/server/package.json prepack.
```

appended to BOTH `guard-docker-packaging-paths.mjs` and `guard-dockerignore-depth.mjs`:

```
guard-capability-prose: FAILED
  scripts/ci/guard-dockerignore-depth.mjs: "packaging build-order checking
  (findBuildOrderViolations)" is a real, shipped capability, but this file's prose
  asserts it is absent
EXIT=1   real 4m3.460s
```

**One violation. The declaring file's copy was not reported at all.** Reproduce that first.

## Why the guard cannot catch this itself

`guard-capability-prose.mjs` is in `SELF_REFERENTIAL_DENIAL_EXCLUSIONS` — correctly, for the
reasons T179 documented. So a false premise about this guard, in this guard, is invisible to
it by construction. The paragraph T183 falsified ("every capability seeded here today ships
in a different file from the one that ever carried its denial ... so this exclusion costs
nothing for either") was corrected at the P6-W23 gate. **Update that correction when the
blindness is gone, citing your commit — do not delete it.**

## The remedy, and the runtime it also fixes

Resolve "is this capability shipped?" **once per capability**, over all shipped files, before
walking `appFiles` — instead of once per (capability, appFile) pair. The per-appFile
`evidencePool.some(...)` walk is what makes a quiet path cost 7m19s and what forces the
self-exclusion to be per-file in the first place.

**You will have to decide what replaces the self-exclusion**, because T147's original bug is
real: a capability whose curated member is an interface property (`summary:`, `filesRead:`)
could be marked shipped by the very sentence denying it, since a string literal is not a
comment. Resolving per-capability may make that impossible anyway, or may need a narrower
guard. Work it out, prove it, and say which.

Timing today: **4m3s** measured at the gate. Report before and after. If you cannot get it
under four minutes, say so with numbers rather than shipping it quietly.

Owns: `scripts/ci/guard-capability-prose.mjs`, `guard-capability-prose.test.mjs`, and
`run-guard-capability-prose.mjs`. **T186 also edits capability-prose prose this wave — but in
`.github/workflows/ci.yml` only. Do not edit that file.**

- [ ] The declaring file's own denial IS reported: same mutation, exit **1**, TWO violations
- [ ] T147's original bug still cannot happen — prove it, do not assert it
- [ ] Both timings reported
- [ ] The corrected paragraph updated, its record kept
- [ ] `node --test scripts/ci/*.test.mjs` passes (baseline: 381/381)

#### T185 — Route `.dockerignore` edits to a CI path filter

`labels: phase-8, area: tooling` · `wave: P6-W24` · `depends-on: T180`

`.dockerignore` matches **no** CI path filter. Confirmed at the P6-W23 gate: it is in neither
`packaging` (`packaging/**`, `scripts/ci/**`) nor `docker` nor `workspace`. A pull request
editing only `.dockerignore` runs neither `guard-dockerignore-depth` nor `docker-checks`.

T180 built the guard, wired the job, and **disclosed this in the job's own comment**,
deferring it by design rather than editing `ci-paths.yml`, which T181 owned that wave. That
is the right call and this is the follow-up it named.

Read T181's work first: it added authoring-time guidance to `.github/ci-paths.yml` precisely
so a filter change does not silently break the pinned array in
`scripts/ci/ci-routing.test.mjs`. **You are the first task to edit that file since. Follow
its own instructions.** If adding `.dockerignore` to an existing filter is enough, do that
rather than adding a filter — a new filter name means a new pinned entry and a new job.

Owns: `.github/ci-paths.yml`, `.github/workflows/ci.yml`, and
`scripts/ci/ci-routing.test.mjs` if the pin needs updating. **T186 also edits `ci.yml` this
wave** (the capability-prose job's name/step/comment); coordinate by touching only the jobs
you own and say in your report which lines you changed.

- [ ] A change to `.dockerignore` alone reaches `guard-dockerignore-depth`
- [ ] Say which filter you used and why, and whether a new one was needed
- [ ] Update T180's job comment, which currently discloses this as open
- [ ] `node --test scripts/ci/ci-routing.test.mjs` passes (baseline: 11/11)

#### T186 — Correct the capability-prose CI job's scope prose

`labels: phase-6, area: tooling` · `wave: P6-W24` · `depends-on: T179, T183`

`.github/workflows/ci.yml`'s job name, step name and comment for the capability-prose guard
(lines 785, 791, 800 at `6a2e04c`) describe a scope that has been false since T147, and more
so with every widening since. They say "packages/client/src ships", "DaemonClient", and
"apps/web|android/src's prose".

Reality: the declaration scan covers `packages/*/src`, `apps/*/src` and `scripts/ci`
(T147, T156); the denial scan covers `apps/web/src`, `apps/android/src`, `scripts/ci` and a
curated `packaging/**` (T179). There are **eight** entries, not the three the prose implies,
and T183's newest one ships in `scripts/ci` with its denial sites in `packaging/**` — the
exact combination the old wording says is impossible.

**Pre-existing, not wave-introduced.** `git show 6a2e04c:.github/workflows/ci.yml` has all
three lines byte-identical. Verify that yourself before writing anything.

`.github/**` is deliberately outside the guard's own denial scan, so this can never
self-catch — which is exactly why it survived four widenings. Consider saying, in the
comment you write, what makes this text go stale and what a future widening should do about
it. A scope description that enumerates trees will be wrong again; one that points at the
source of truth will not.

Owns: `.github/workflows/ci.yml`'s capability-prose job only. Do NOT edit
`scripts/ci/guard-capability-prose*.mjs` or `run-guard-capability-prose.mjs` (T184's this
wave), or `.github/ci-paths.yml` (T185's).

- [ ] The three lines describe the real current scope
- [ ] The entry count is right, or the prose avoids stating a count
- [ ] `node --test scripts/ci/ci-routing.test.mjs` still passes

#### T187 — Widen T183's denying phrases, or scope the two remaining sites out in writing

`labels: phase-6, area: tooling` · `wave: P6-W25` · `depends-on: T184`

T183's entry matches **two of the six** real corrected sentences it was written for. Two more
are in scope but outside its `denyingPhrases`; the last two are structurally uncatchable
until T184 lands. The closure note was qualified at the P6-W23 gate to say exactly this.

After T184, re-measure which of the six are catchable and close the gap — **or decide, in
writing, that the remaining ones should not be phrase-matched**, and say why. Both are
acceptable outcomes. What is not acceptable is leaving the qualification in place with
nobody having re-checked it.

Scheduled after T184 because both own `guard-capability-prose.mjs`, and because the answer
changes once the self-exclusion blindness is gone.

- [ ] Each of the six sites reported as catchable or not, measured
- [ ] Either the phrases widened with a RED/GREEN proof, or a written decision not to
- [ ] The P6-W23 qualification updated, its record kept

#### T188 — Reconstruct `.github/` after the repository loss

`labels: phase-8, area: tooling` · `wave: P6-W24` · `depends-on: T185, T186`

**Closed at recovery, 2026-09-06.** The P6-W24 merge gate destroyed `.git/`, `.github/`,
`.gitignore`, `.dockerignore`, `.oxfmtrc.json` and `.oxlintrc.json` with
`git worktree add --detach "$UNSET" b34c11c` (see CLAUDE.md, T93 step 1, and T191). All
three `.github/` files were rebuilt from the session transcripts: `workflows/ci.yml` from a
full read at blob `1c24d23` plus the nine committed diffs that followed, replayed in order;
`ci-paths.yml` from its pre-T185 read plus T185's diff; `workflows/android-apk-release.yml`
(T17B) and `workflows/android-maestro-e2e.yml` (T57) from their last full dumps. The first
two were checked against the blob ids the lost commits produced — `git hash-object`
gives `2f25aa6` and `90e194f`, the same ids `git diff` printed for T186's and T185's commits.

- [x] `ci.yml` at blob `2f25aa6`, `ci-paths.yml` at blob `90e194f`
- [x] `node --test scripts/ci/*.test.mjs` 385/385 and `ci-routing.test.mjs` 11/11 on the restored tree
- [x] `oxfmt --check .` clean

#### T189 — Recreate the six deleted root dotfiles

`labels: phase-8, area: tooling` · `wave: P6-W24` · `depends-on: T180`

**Closed at recovery, 2026-09-06.** `.gitignore`, `.dockerignore`, `.oxfmtrc.json` and
`.oxlintrc.json` restored from their last full reads (2026-09-05/06); no Edit or Write to any
of them appears in a transcript after those reads. `guard-dockerignore-depth` exits 0 against
the restored `.dockerignore`.

- [x] The four files present at the repository root
- [x] `node scripts/ci/run-guard-dockerignore-depth.mjs` exits 0

#### T190 — Re-initialise version control and keep an off-volume bundle backup

`labels: phase-8, area: tooling` · `wave: P6-W24`

The "add no git remote" invariant left zero recovery path when `.git/` was deleted: no
clone, worktree or bundle of this repository existed anywhere on the machine. The owner
lifted that invariant on 2026-09-06 and named `https://github.com/ErsatzHitman/pi-companion.git`
as the remote. The tree was re-initialised at `2063eb2` ("Recovered baseline"), the history
before it is gone, and this ledger is now the only task-by-task record of it.

- [x] `git init` at the surviving tree; baseline commit carries the incident record
- [x] Remote `origin` added and `main` pushed
- [x] `git bundle create --all` written to `C:\Users\aksha\Downloads` at every wave close (the
      orchestrator does this; gates report only)

#### T191 — Guard the scratch-dir variable in the T93 worktree step

`labels: phase-8, area: docs` · `wave: P6-W24`

**Closed at recovery, 2026-09-06.** CLAUDE.md's T93 step 1 now requires `<scratch-dir>` to
be a literal path that was just printed, never a bare variable, and shows the `set -u` /
`[ -n ]` / `mkdir`-first pattern. The wave prompt's gate procedure carries the same rule.

- [x] CLAUDE.md updated
- [x] Wave prompt updated (P6-W25 onward)

#### T192 — Add `.gitattributes` so Windows checkouts stop failing four committed tests

`labels: phase-8, area: tooling` · `wave: P8-W5`

The repository has no `.gitattributes`, and this machine has `core.autocrlf=true`, so every
Windows checkout materialises CRLF working files while the committed blobs are LF. Four tests
in `scripts/ci/guard-docker-packaging-paths.test.mjs` and
`scripts/ci/guard-capability-prose.test.mjs` anchor their regexes on `\n` and read the real
`packaging/docker/Dockerfile` and `packaging/nix/flake.nix`, so they fail locally and pass on
CI's Linux checkout. `oxfmt --check .` is red on roughly 2361 of 2369 files for the same
reason. The P6-W25 verifier proved the failures are environment-only by re-running the suite
in a clean worktree at the wave base and seeing the same four names fail.

The cost is not the four tests. It is that the local signal is dead: every future agent sees
a red suite and a red formatter and has to re-derive that both are noise, and a real
regression hiding among them would be invisible. CLAUDE.md's stated `385/385` baseline is
also wrong on this machine — the honest local number is `381/385`.

Owns: `.gitattributes` and any CLAUDE.md sentence stating the local test baseline. No other
task in this wave touches those files.

**Closed by the P6-W25 gate, 2026-09-06** (commit `713801d`), done by the orchestrator between
waves rather than inside P8-W5: renormalising a whole tree while agents edit it would give them
a moving target. `git add --renormalize .` staged nothing but `.gitattributes` itself, which is
the proof that no committed blob changed; a blob-hash diff of all 2431 tracked files before and
after is empty. The local suite went 390/394 — **394/394**, and `oxfmt --check .` went from
~2361-of-2369 red — **clean**.

- [x] `.gitattributes` normalises text files to LF so a fresh Windows checkout matches the
      committed blobs, and the four named tests pass locally without editing any test
- [x] `oxfmt --check .` is clean on a fresh checkout, with the before/after file counts shown
- [x] Re-normalisation does not rewrite any committed blob: `git diff` after the change shows
      only line-ending changes to working files, and `git hash-object` on a sample of ten
      files matches what `git cat-file` reports for HEAD
- [x] CLAUDE.md's invariants list states the real baseline (394/394, formatter clean) and what
      to check first if the formatter ever goes red all at once

#### T193 — Bind the collision test to the shipped regex it claims to be about

`labels: phase-8, area: tooling` · `wave: P8-W5` · `depends-on: T187`

T187's whole-repo collision test re-declares the denying phrase as a literal in the test file
instead of importing it from `CAPABILITIES`. The P6-W25 merge gate demonstrated the
detachment: it replaced the shipped phrase with `/T174 closed the ordering gap/i` — a
sentence that is TRUE and in scope — and the collision test still passed. Three other
mechanisms caught the broadened phrase, so this is a maintainability defect rather than a
hole, but it is exactly the catalogued class "an assertion pinned to a fixture declared in
the same test file": the test cannot notice the thing it is named after changing.

Owns: `scripts/ci/guard-capability-prose.test.mjs`. No other task in this wave touches that
file.

- [ ] The collision test reads its phrase from the shipped `CAPABILITIES` entry, never from a
      literal in the test file
- [ ] Broadening the shipped phrase to a true in-scope sentence now fails THIS test, shown as
      a RED/GREEN pair — not merely the three other tests that already caught it
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` still exits 0 on the committed tree

#### T194 — Declare `@picompanion/highlight` in `apps/android` so CI typecheck passes

`labels: phase-8, area: tooling` · `wave: P8-W6`

`apps/android/src/features/files/file-syntax-highlight.ts` imports `@picompanion/highlight`,
and `apps/android/package.json` does not declare it. The `typecheck` job's
`run-guard-declared-workspace-deps.mjs` step fails on that, exit 1, on every push:

```
guard-declared-workspace-deps: FAILED for apps/android
  @picompanion/highlight is imported but not declared in apps/android/package.json:
    imported by: apps/android/src/features/files/file-syntax-highlight.ts
```

This was carried for many waves as "owner-blocked, needs `npm install`". **It is not an
install.** `@picompanion/highlight` is a workspace package in this monorepo:
`node_modules/@picompanion/highlight` is already symlinked to `packages/highlight`,
`packages/highlight` is already a `package-lock.json` entry, and `apps/web` already declares
the identical `"@picompanion/highlight": "0.3.0-beta.2"` and passes the same guard. What is
missing is one dependency edge in two files. No registry request is required to add it.

Owns: `apps/android/package.json` and the `apps/android` entry of `package-lock.json`. No
other task in this wave touches those files.

- [ ] `apps/android/package.json` declares `@picompanion/highlight` at the same exact version
      `apps/web` declares, and `package-lock.json`'s `apps/android` entry carries the matching
      edge — shown by diffing the two apps' lock entries before and after
- [ ] `node scripts/ci/run-guard-declared-workspace-deps.mjs` exits 0 locally
- [ ] The lockfile is still internally consistent: no new `node_modules/*` entry was created,
      and the diff is confined to the one `apps/android` dependency edge
- [ ] **The `typecheck` job is green on a real CI run of the commit that lands this** — quote
      the run id. A local pass does not close this task; the guard already passed locally.

#### T195 — Build `@picompanion/client` before `frontend-core` in every CI job

`labels: phase-8, area: ci` · `wave: P8-W6`

Six CI jobs fail with the same five errors, on every push:

```
src/connection/daemon-client-lifecycle.ts(27,30): error TS2307: Cannot find module '@picompanion/client'
src/connection/daemon-client-lifecycle.ts(28,71): error TS2307: Cannot find module '@picompanion/client'
src/hosts/host-controller.ts(32,41):            error TS2307: Cannot find module '@picompanion/client'
src/hosts/host-controller.ts(289,7):            error TS2353: 'reconnect' does not exist in type 'DaemonClientLifecycleConfig'
src/terminal/terminal-controller.ts(36,42):     error TS2307: Cannot find module '@picompanion/client/internal/daemon-client'
```

The failing jobs are `frontend-core-tests` (ubuntu and windows), `web-unit-tests`, `web-tests`,
`android-tests` and `daemon-package-dry-run`.

`packages/frontend-core` declares `@picompanion/client` correctly, so this is not T194's
class. The cause is ordering: `packages/frontend-core`'s own `build` script runs
`npm run build --workspace=@picompanion/protocol && tsc`, which builds protocol but never
client, and `.github/workflows/ci.yml` puts "Build frontend-core dependencies (protocol,
design-tokens, highlight, frontend-core)" BEFORE "Build @picompanion/client (protocol ->
relay -> client chain)" — and `android-tests` never builds client at all. On a clean
`npm ci` checkout there is no `packages/client/dist`, so `tsc` cannot resolve the types.

**Why nobody saw it:** the repository had no remote until 2026-09-06 (T190), and every local
checkout has a stale `packages/client/dist` left over from an earlier build, which makes the
same typecheck pass. The first push to `origin` made it visible immediately.

Decide between the two fixes and say why in the commit: reorder the workflow steps, or make
`frontend-core`'s `build` script build its own declared dependency chain. The second fixes
every consumer at once and cannot be re-broken by a new job; the first matches the existing
convention of an explicit "Build backend dependency chain" workflow step. Do not do both.

Owns: `.github/workflows/ci.yml` and `packages/frontend-core/package.json`. No other task in
this wave touches those files.

- [ ] A clean-checkout reproduction is shown first: with `packages/client/dist` moved aside,
      `npm run build --workspace=@picompanion/frontend-core` fails with those five errors
- [ ] After the fix, the same clean-checkout reproduction succeeds
- [ ] The `TS2353` `reconnect` error is accounted for explicitly: either it disappears with
      the other four (it was downstream) or it is a real type defect, in which case FILE it
      rather than widening this task
- [ ] **All six named jobs are green on a real CI run** — quote the run id and the job ids

#### T196 — Read CI after every push now that a remote exists

`labels: phase-8, area: docs` · `wave: P8-W6` · `depends-on: T194, T195`

Two defects sat on `main` across many waves because no gate could see them: local checkouts
carried a stale `packages/client/dist`, and there was no remote to run the real matrix. Both
were found within minutes of the first push. The lesson is not "those two bugs" — it is
that until 2026-09-06 the wave machinery's strongest gate was a local approximation of CI,
and it disagreed with CI.

CLAUDE.md's wave-end procedure (T93) must now require reading the real run, and must say that
a locally green tree with a red CI run is a RED wave.

Owns: `CLAUDE.md`. No other task in this wave touches that file.

- [ ] CLAUDE.md's T93 section requires, as a numbered step after the clean-tree guard, reading
      the CI run for the pushed commit and recording its conclusion and run id
- [ ] It states plainly that local green plus CI red is a red wave, and names the stale-`dist`
      trap as the reason a local build can disagree
- [ ] It says how to get the result without a browser (`gh run list`, `gh run view --log-failed`)
      and that the orchestrator, not an implementer, is the one who pushes and reads it

#### T197 — Bring `docs/` into `guard-capability-prose`'s denial scan

`labels: phase-8, area: tooling` · `wave: P8-W7` · `depends-on: T187, T193`

`run-guard-capability-prose.mjs` scans for capability-denying prose in `apps/web/src`,
`apps/android/src` (`APP_SRC_PREFIXES`), `scripts/ci` and `packaging/**`
(`isPackagingProsePath`). **`docs/` is in none of them.** P8-W5 shipped a 370-line
document that is almost entirely capability claims, and the guard could not see one line
of it. That is the catalogued "a curated entry whose runner's scope can never see the
case" shape, one directory up — the same shape that made the guard inert twice before
and forced the scope to widen at T147 and again at T156.

The P8-W5 merge gate checked whether the blind spot is live rather than theoretical by
running `findCapabilityDenialViolations` over `docs/legacy-retirement.md` as though it
were an in-scope file: **0 violations**. So `docs/` is clean under today's phrases and
this is hardening, not a fix. Do not present it as closing an open hole.

Owns: `scripts/ci/run-guard-capability-prose.mjs` and
`scripts/ci/guard-capability-prose.test.mjs`. Do not edit `guard-capability-prose.mjs`'s
`CAPABILITIES` list — this task changes WHERE the runner looks, never WHAT it looks for.

- [ ] The runner's denial scan includes `docs/`, and the guard's own summary line names
      the widened scope so a future reader can see what it covers without reading code
- [ ] A regression test proves the widening is real: a seeded denial in a `docs/` fixture
      is CAUGHT, and the same fixture with the denial removed passes. A test that only
      asserts the prefix list contains `docs/` does not discriminate and does not count
- [ ] The historical-quotation carve-out still works inside `docs/`: prose reading
      `CORRECTED (...): this said ...` around a denying phrase must still pass. Prove it
      with the real `docs/legacy-retirement.md`, which now carries three such markers
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 on the committed tree, and
      the reference-only documents named in CLAUDE.md do not start failing the guard — if
      any does, that is a finding to report, not a phrase to delete
- [ ] `node --test scripts/ci/*.test.mjs` — no regression against the wave-base count

#### T198 — Build `apps/web`'s declared workspace dependencies from its own scripts

`labels: phase-8, area: tooling` · `wave: P8-W6` · `depends-on: T195`

`daemon-package-dry-run` failed with four `TS2307: Cannot find module
'@picompanion/highlight'` errors from `apps/web`. That job builds protocol,
design-tokens, frontend-core and web — never highlight, which `apps/web` declares and
imports as a value in `file-code-editor.tsx`, `file-syntax-highlight.ts` (both the main
entry and `./lezer-only`) and one test.

Same class as T195 and fixed the same way, at the package rather than in the workflow:
`apps/web`'s `build` and `typecheck` now build design-tokens, frontend-core, highlight
and protocol first, exactly as `apps/android`'s scripts already did. A new job cannot
re-break it by forgetting a step.

- [ ] `daemon-package-dry-run` is green on a real CI run
- [x] `apps/web`'s scripts mirror `apps/android`'s existing chain rather than inventing
      a second convention

#### T199 — Build `@picompanion/server` before the `web-tests` Playwright run

`labels: phase-8, area: ci` · `wave: P8-W6` · `depends-on: T195`

The Playwright step died before a single spec ran:

```
Error: Cannot find module '.../node_modules/@picompanion/server/dist/server/server/exports.js'
imported from apps/web/e2e/fixtures/daemon.ts
```

`web-tests` builds the frontend-core chain and the client chain, and never built
`@picompanion/server`, whose `dist/` is gitignored and therefore absent on a clean
`npm ci` checkout. Unmasked by T195: this job used to die earlier, at the frontend-core
build, so the E2E step never got far enough to fail this way.

Fixed in the workflow rather than in a package script, because the dependency is the
E2E FIXTURE's, not `apps/web`'s: `apps/web` does not declare `@picompanion/server` and
must not start.

- [ ] `web-tests` reaches and runs the Playwright specs on a real CI run

#### T200 — Correct the vendored `EXPO_ROUTER_CTX_IGNORE` against the real package

`labels: phase-8, area: tooling` · `wave: P8-W6` · `depends-on: T196`

`apps/android`'s suite went **2484 passed / 1 failed** on CI, on the parity test T136
wrote for exactly this moment:

```
vendored: /^\.\/(?:.*\/)?(?!.*(?:\+api|\+html|\+native-intent)\.[jt]sx?$).*\.[jt]sx?$/
real:     /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+(html|native-intent))))\.[tj]sx?$).*\.[tj]sx?$/
```

**The premise that made this invisible was wrong, and that is the more useful finding.**
`expo-router` has been recorded since T87/T116 as declared-but-never-installable, and
the vendored module's own provenance comment stated that no installed copy exists
"anywhere reachable from this checkout". That was a fact about the owner's workstation,
not about the repository: `npm ci` installs `expo-router` normally on a CI runner. The
parity test skips here and runs there, and the first time it ever ran it caught the
drift — working exactly as designed.

The drift has one cosmetic difference (`[jt]` vs `[tj]`) and one real one: the vendored
copy excluded `+html` and `+native-intent` at ANY depth, while expo-router excludes them
only at the router root. Only `+api` is excluded at any depth. Nothing in this tree
exercises the difference (`+not-found.tsx` is the only `+` file and is not one of the
three), so the defect was latent and no local test could have found it.

Corrected against two independent sources that agree byte for byte: CI run 34022711589's
own printout of the installed value, and `https://unpkg.com/expo-router@6.0.13/
_ctx-shared.js` read directly.

- [x] The vendored constant is the real package's source text, with both sources cited
- [x] A new colocated test pins the depth rule the drift got wrong, and DISCRIMINATES:
      re-planting the drifted regex fails it, restoring passes it
- [x] `cd apps/android && npx vitest run` — 193 files, 2485 passed, 1 skipped
- [ ] `android-tests` is green on a real CI run

**Follow-on, unowned:** the "expo-router is not installed" premise appears in more than
this one file. Someone should grep for it and correct every site that states it as a
property of the repository rather than of one workstation.

#### T201 — Make `expo prebuild` able to load `app.config.ts` without duplicating the allowlist

`labels: phase-8, area: android` · `wave: P8-W6` · `depends-on: T36E, T200`

`android-tests`' **Production prebuild smoke** step fails on every run:

```
Cannot find module './src/features/share/share-intent-config.js'
Require stack:
- apps/android/app.config.ts
- .../@expo/config/build/evalConfig.js
```

`expo prebuild` has therefore never once succeeded. It was invisible for two reasons:
this step runs only in CI, and until T200 the job died at the unit tests before reaching
it.

**Cause.** `@expo/config` transpiles `app.config.ts` to CommonJS and evaluates it with
`require-from-string`. `@expo/require-utils`'s loader compiles ONLY the entry config
file; a relative import inside it becomes a plain `require` resolved by Node against the
real filesystem, where only `share-intent-config.ts` exists. Reproduce in one command:

```bash
cd apps/android && npx expo config --type public
```

**Dropping the extension does not fix it.** Verified: `"./src/features/share/
share-intent-config"` fails the same way (`Cannot find module`), because the loader
registers no `.ts` handler for nested requires. `app.config.ts` cannot import ANY
relative TypeScript module under this Expo version — and the chain here is two deep
(`app.config.ts` — `share-intent-config.ts` — `share-intent-model.ts`).

**The constraint that makes this non-trivial, and that you must not break.** T36E made
`app.config.ts` call `buildShareIntentFilters()` precisely so the Android share-target
MIME list cannot drift from `ACCEPTED_FILE_MIME_TYPES`. A drift would advertise this app
to the whole OS as a share target for a type `classifyShareIntent` then silently refuses.
Read `share-intent-config.ts`'s doc comment before you touch it. **Retyping the list, or
the filter shape, into `app.config.ts` is a REGRESSION even if CI turns green.**

Three directions, none obviously right — pick one, and say in the commit why you rejected
the other two:

1. **A JSON single source of truth.** Move the allowlist to
   `accepted-file-mime-types.json`; `share-intent-model.ts` imports it
   (`resolveJsonModule`), `app.config.ts` `require`s it, since JSON requires work fine in
   CommonJS. Cost: the two-filter SHAPE then lives in `app.config.ts`, and
   `share-intent-config.test.ts` would be asserting a function the config no longer calls
   — a check that cannot fail. If you take this route the test MUST move to asserting
   the config's real output.
2. **Precompile `share-intent-config.ts` to `.js`** in `apps/android`'s `build` script
   before `expo prebuild`. Keeps one source of truth exactly as today. Cost: the config
   is then unloadable except after a build, so `npx expo config` breaks for humans.
3. **Make `app.config.js` a plain CommonJS file** that builds the filters from a
   `require`d JSON list. Same trade as 1, without the TypeScript config file.

Owns: `apps/android/app.config.ts`, `apps/android/src/features/share/
share-intent-config.ts` and its test, and `apps/android/src/features/share/
share-intent-model.ts`'s allowlist declaration only.

- [ ] `cd apps/android && npx expo config --type public` succeeds and PRINTS
      `android.intentFilters` containing every entry of `ACCEPTED_FILE_MIME_TYPES` and
      `text/plain`, and nothing else — quote the output
- [ ] The anti-drift property survives, and is proven by MUTATION: add a MIME type to
      `ACCEPTED_FILE_MIME_TYPES`, show the config's filters change with it and/or the
      test fails, then restore. A green suite after retyping the list is a REGRESSION
- [ ] `share-intent-config.test.ts` asserts against whatever `app.config.ts` actually
      uses. If the config stops calling `buildShareIntentFilters()`, the test moves too
- [ ] `cd apps/android && npx vitest run` — 193 files, no regression on 2485 passed
- [ ] **`android-tests` is green on a real CI run, INCLUDING the Production prebuild
      smoke step** — quote the run id. Nothing else closes this task

#### T202 — Correct an overclaiming test title in `guard-capability-prose.test.mjs`

`labels: phase-8, area: tooling` · `wave: P8-W6` · `depends-on: T197`

**Closed at the P8-W6 merge gate.** T197 shipped a test at
`scripts/ci/guard-capability-prose.test.mjs` titled

> the real docs/legacy-retirement.md ... scans clean against the full real
> CAPABILITIES list **and its own three CORRECTED markers**

Both halves of that clause were false, and I reproduced both before changing anything:

- **The count is four, not three.** `grep -n CORRECTED docs/legacy-retirement.md` →
  lines 9, 35, 295, 332. The "three" traces to P8-W5's commit subject `bc01cbb`
  ("scope three overclaiming sentences"), but the sentence is new prose in this wave.
- **The markers are inert on this file.** Running every `CAPABILITIES` entry's
  `denyingPhrases` against the real document gives **0 matches**; neutralising every
  phrase in `HISTORICAL_QUOTE_MARKERS` first also gives **0**. Nothing in the document
  denies any tracked capability, so the exemption never fires and the assertion proves
  nothing about it.

This is the P6-W16 class — a check that passes for a different reason than its title
claims — not a functional gap. Exit 0 is the correct answer for this file, and the
exemption mechanism _is_ genuinely proven, by the matched pair immediately above it
(`:2469` marker present → 0 violations; `:2487` delete only the marker → 1 violation).

The fix is the title plus a `CORRECTED (P8-W6 merge gate):` block recording both false
claims, so the next reader is not misled the same way. No behaviour change.

Owns: the one test title and its comment in `scripts/ci/guard-capability-prose.test.mjs`.

- [x] The title no longer claims the assertion covers the CORRECTED markers
- [x] The corrected count (four) and the measured inertness (0 with markers, 0 without)
      are recorded next to the test
- [x] `node --test scripts/ci/guard-capability-prose.test.mjs` → 115/115

#### T203 — Correct three P7 dependency edges that are scheduling artifacts

`labels: phase-7, area: docs` · `wave: P8-W6` · `depends-on: —`

**Filed and closed by the orchestrator at the P8-W6 gate.**

P7-W1 is blocked: T42A1 needs `npm install expo-notifications expo-device`, which the
owner has not run and which this repository's tooling refuses. Every later P7 wave was
recorded as "blocked behind T42A1", which put **three tasks that need neither package**
behind an install they never use — and, through T44A1's `depends-on: … T42B2`, put the
whole of Phase 9 behind it too.

Two of those edges do not survive contact with the code. I checked before changing them:

**Edge 1 — `T42A3 depends-on T42A2` (dropped).** T42A3 mirrors the web diagnostics
screen on Android. That screen's real content is three sections and nothing else:

```
apps/web/src/features/diagnostics/diagnostics-model.ts
  id: "connection"   title: "Connection"
  id: "versions"     title: "Versions"
  id: "capabilities" title: "Capabilities"
```

`DiagnosticsScreen.tsx` imports only `ui/primitives`, its own three modules and
`diagnostics.css`; `diagnostics-model.ts` imports only a `hosts` type from
`@picompanion/frontend-core` and `ServerInfoStatusPayload` from
`@picompanion/protocol/messages`. A case-insensitive grep for `trusted|push|device`
across the non-test files of that directory returns only `Array.prototype.push` calls.
There is no trusted-device section to mirror, so device revocation (T42A2) is not a
prerequisite for mirroring it. The real edge is `T41B3` — the export this screen
exposes — and that is kept.

**Edge 2 — `T42B1 depends-on T42A3` (dropped).** T42B1 and T42B2 own
`apps/android/src/platform/offline/`; T42A3 owns `apps/android/src/features/
diagnostics/`. Disjoint directories, and the offline tree is already substantially
built (`sqlite-structured-storage.ts`, `timeline-cache.ts`, `turn-outbox-owner.ts`,
`turn-recovery.ts`, `stale-announcement.ts`). Executing the migration decision does not
require a diagnostics screen to exist first. T42B1's real dependency is T22, which built
the storage interfaces it verifies.

**Edge 3 — `T42B2 depends-on T42B1` (KEPT).** This one is real: T42B2 tests the import
path that T42B1's decision either produces or declines to produce. It stays, and the two
must not run in the same wave because they own the same directory.

**What the decision document already settles.** `docs/frontend-data-migration.md` §2
records **"Overall Phase 0 decision: RESET / RE-PAIR — no export utility is created"**,
and §3 opens **"No import: T42 will not add an import path or schema migration for
legacy drafts/hosts/attachments."** So T42B1 is verification of shipped behaviour
against a written decision, and T42B2's own first criterion — "or its absence is
justified in writing" — is the branch this decision selects. Neither task adds a feature,
and neither touches `expo-notifications`.

**Also recorded, not fixed here.** The per-task `wave:` column in the index table is
stale for 17 rows relative to the wave table, which records where each task was actually
run (T41A4 says P7-W5 but ran in P6-W17; T43A1/T43A2/T43A3 say P8-W1/W2/W3 but ran in
P6-W18/W19/W20; and so on). Every one of the 17 **is** listed in some wave in the wave
table, so nothing is unscheduled — the wave table is the authority and the column is
decoration that drifted. Left alone deliberately: mass-editing 17 historical rows would
churn the file without changing what runs next.

Owns: the dependency and wave columns of T42A3, T42B1 and T42B2, and the P7 rows of the
wave table.

- [x] Each dropped edge is justified against the code, not against prose
- [x] The kept edge (T42B2 behind T42B1) is stated and the same-directory conflict noted
- [x] T42A1 and T42A2 remain blocked; nothing here pretends the install happened

#### T204 — Make the local Expo config plugin resolvable on CI, not only on the workstation

`labels: phase-8, area: android` · `wave: P8-W7` · `depends-on: T201`

**`main` is red.** CI run `34026629398` at `d434b63`: `android-tests` fails, one step,
**Production prebuild smoke**. `docker-checks` and `nix-checks` are skipped behind it.
Every other job is green.

**T201 worked.** Its original error — `Cannot find module
'./src/features/share/share-intent-config.js'` — is gone from the log, and the config
module now evaluates. The build gets one layer further and dies on the next thing:

```
PluginError: Failed to resolve plugin for module "./plugins/with-share-intent-module"
relative to "/home/runner/work/pi-companion/pi-companion/apps/android".
Do you have node modules installed?
    at resolvePluginForModule (apps/android/node_modules/@expo/config-plugins/build/utils/plugin-resolver.js:94:9)
```

`apps/android/plugins/with-share-intent-module.ts` is a TypeScript file, and Expo's
plugin resolver looks for it on disk by probing a fixed list of extensions, and the copy
CI installs does not accept `.ts`.

**CORRECTED (P8-W7 merge gate):** this brief originally said the resolver "requires it from
disk through Node, which cannot load `.ts`", and named `@expo/require-utils`'s entry-only
compilation as the mechanism. That is the wrong stage. `resolveConfigPluginFunctionWithInfo`
calls the same `loadModuleSync` for any plugin file, so there is no plain-`require()` path;
and in the failing case no loader ran at all, because the extension probe never found the
file — CI throws from `resolvePluginForModule` with `PLUGIN_NOT_FOUND`. T204's implementer
inherited this wrong mechanism from this brief and shipped it in two production doc comments,
both now corrected. The chosen fix was right regardless, but a brief that misnames the
mechanism sends its implementer to the wrong file. Retained below for the record: it is the
same root cause as T201 one level up in the sense that both are `.ts` reaching a stage that
only handles JavaScript. `@expo/require-utils` compiles only the entry
config file, so anything Expo resolves _afterwards_ must already be JavaScript.

**Do not trust `gh run watch --exit-status` for this.** On this run it exited **0** while
`gh run view --json conclusion` reported **`failure`**. Read the conclusion, not the
watcher's exit code. That mistake would have closed this task as green.

**The workstation cannot reproduce it, and the reason is the finding.** I stripped only
the `expo-router` plugin string (the separate, T200-documented local gap) and ran
`cd apps/android && npx expo config --type public`. It **succeeded**, plugin and all.
The tree was clean, and there is no stale compiled `plugins/with-share-intent-module.js`
— `git ls-files apps/android/plugins/` lists exactly the `.ts` and its test, and `ls`
agrees. The divergence is in the install layout:

|                           | `@expo/config-plugins` resolves from                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| This workstation          | `node_modules/@expo/config-plugins` → **57.0.9** (hoisted to the root) |
| CI (from the stack trace) | `apps/android/node_modules/@expo/config-plugins` (**nested**)          |

`apps/android/node_modules/@expo/config-plugins` does **not exist** locally. `sucrase`
and `typescript` are both present at the root here. So a clean `npm ci` on CI produces a
nested install this machine does not have, and the two resolve a `.ts` plugin
differently. **Establishing exactly why is this task's first job** — do not fix past it.

**Directions (pick one, justify it):**

1. **Write the plugin as JavaScript.** `plugins/with-share-intent-module.js` with a
   JSDoc `@type {import("expo/config-plugins").ConfigPlugin}` annotation. This is how
   Expo config plugins are conventionally written, keeps type-checking under `checkJs`,
   and removes the loader question entirely. The test imports the `.js`.
2. **Generate the `.js` before prebuild.** Keeps the `.ts` source, adds a build step and
   a generated artifact that must be gitignored and must never drift from its source.
3. **Pass the plugin as a function, not a path string.** Expo's mod compiler accepts a
   `ConfigPlugin` reference at runtime; `app.config.ts:6-14`'s comment already records
   that `@expo/config-types` only _types_ the entry as a string. That comment is the
   constraint to re-examine, not to obey blindly — but re-examine it, do not assume it
   is wrong.

Owns: `apps/android/plugins/`, and the `plugins` array in `apps/android/app.config.ts`.
Nothing else.

- [ ] Reproduce the CI failure in a way this workstation actually exhibits — a clean
      install, or the nested `apps/android/node_modules` CI builds. Quote the command.
      "It works locally" is the defect, not the proof
- [ ] `expo prebuild --platform android --no-install` resolves the plugin and completes
- [ ] `patchMainActivityContents`' behaviour is unchanged, proven by MUTATION: break the
      injected `onNewIntent` override, show `with-share-intent-module.test.ts` fails,
      restore. A green suite after a rewrite that lost the override is a REGRESSION
- [ ] No generated `.js` is committed unless direction 2 is chosen and gitignored
- [ ] **`android-tests` green on a real CI run, INCLUDING Production prebuild smoke** —
      quote the run id and read it with `gh run view --json conclusion`, not `run watch`

#### T205 — Type-check metro.config.js and babel.config.js, or say in writing why not

`labels: phase-8, area: android` · `wave: P8-W9` · `depends-on: T204`

T204 set `allowJs: true` in `apps/android/tsconfig.json` so its plain-JS config plugin could
be type-checked. That flag also pulled `metro.config.js` and `babel.config.js` into the
TypeScript program for the first time — they were always in `include`, but `allowJs: false`
silently dropped them. Neither carries `@ts-check`, and `checkJs` is off, so they are in the
program and unchecked.

Eight real errors are latent there today. Reproduce by setting `"checkJs": true` in
`apps/android/tsconfig.json` and running the workspace typecheck: seven in `metro.config.js`
(three `TS2540` assignments to read-only properties, three implicit-`any` parameters, one
duplicate identifier) and one `TS7006` in `babel.config.js`. Restore the flag afterwards.

The `TS2540` ones are the interesting ones — assigning to a property the types declare
read-only is the kind of thing that works until a Metro upgrade decides it should not.

Owns: `apps/android/metro.config.js`, `apps/android/babel.config.js`, and
`apps/android/tsconfig.json`. Nothing else.

- [ ] Each of the eight errors is either fixed or individually justified in writing
- [ ] Whichever route is taken, the outcome is enforced: either the files carry `@ts-check`
      and pass, or a comment in `tsconfig.json` records why they stay unchecked
- [ ] The android typecheck's error count is stated before and after, and any change to the
      18 pre-existing `expo-router` `TS2307` errors is explained

#### T206 — Enforce the "no legacy schema reader" prohibition with a check, not a grep

`labels: phase-8, area: ci` · `wave: P8-W9` · `depends-on: T42B2`

`apps/android/src/platform/offline/versioned-import.test.ts` states that no legacy schema
reader, envelope parser, or `hosts`/`drafts`/`attachments` deserializer keyed to
`docs/frontend-data-migration.md` §3's envelope shape "exists anywhere under
`apps/android/src` or `packages/frontend-core/src`". That repo-wide claim is true today and
enforced by nothing.

The P8-W7 gate established exactly where the boundary sits, and both experiments matter:

- Injecting an envelope-recognising branch into `SqliteStructuredStorage.get` DOES fail the
  test. It discriminates within its own scope, which is what its title claims.
- Adding a working importer in a different file under the same directory leaves the suite
  fully green. Nothing detects it.

T42B2's acceptance criterion is disjunctive ("tested if applicable, **or its absence is
justified in writing**"), so the wave met it and this is not a defect in T42B2. It is a
hardening gap: a prohibition worth writing down is worth a guard, or it decays into prose
that a future reader trusts more than it deserves.

This is the same shape as `guard-capability-prose.mjs` — a narrow, curated check, not a
generic linter. Read that guard first; it is the model, including its deliberate refusal to
be general.

Owns: `scripts/ci/`, this guard's own job in `.github/workflows/ci.yml`, and the doc comment
in `apps/android/src/platform/offline/versioned-import.test.ts`. Nothing else.

**The CI job is part of the task, not a follow-up.** Every guard runner in this repository
gets its own job (`run-guard-capability-prose.mjs` is at `ci.yml`'s "guard / no prose denies a
shipped capability"); `node --test scripts/ci/*.test.mjs` runs a guard's TESTS, never the
guard itself against the real tree. A runner with no job is precisely the "check that cannot
fail" this task exists to replace. Add the job in the same commit, and do not touch any other
job.

- [ ] A committed check fails when a legacy envelope reader is added anywhere in the scope
      the prose names, proven by MUTATION: add one, show the guard goes red, remove it
- [ ] The check does not fire on the decision documents that legitimately describe the
      envelope shape, nor on the test that proves its absence
- [ ] The doc comment stops distinguishing "enforced" from "grepped", because the guard
      makes both halves enforced

#### T207 — Make the Android flows launchable on the packaged package id, and guard the pairing

`labels: phase-8, area: android/tooling` · `wave: P8-W11` · `depends-on: T43B2b`

**T43B2b's `packaged-app-smoke` job cannot pass as written, and no check in this repository
says so.** The job installs `sh.picompanion` — `apps/android/eas.json`'s `production-apk`
profile sets no `APP_VARIANT`, so `app.config.ts`'s package expression resolves to the release
id — and then runs a flow whose first line is a literal `appId: sh.picompanion.debug`, which
that job never installs. All fifteen flow files under `apps/android/maestro/` are pinned the
same way. `apps/android/e2e/harness/run-plan.ts` puts only the `DAEMON_*` variables in
Maestro's environment, and Maestro offers no CLI flag that replaces a literal `appId`.

The P8-W10 merge gate proved nothing discriminates: it rewrote `smoke.yaml`'s first line to
`appId: sh.picompanion`, the id the new job actually needs, and both `node --test
scripts/ci/*.test.mjs` (424/424) and `apps/android`'s `vitest run e2e` (343/343) stayed green.
Every `sh.picompanion.debug` occurrence in test code is a fixture the test writes itself, never
the real flow file, so no assertion is pinned to the shipped pairing.

Owns: `apps/android/maestro/*.yaml`, `apps/android/e2e/harness/run-plan.ts`,
`.github/workflows/android-maestro-e2e.yml`'s build steps, and the new guard under
`scripts/ci/`. Fold in the P8-W10 gate's F4 while here: neither Android job builds
`@picompanion/cli`, whose `bin/paseo` imports `../dist/index.js`, and `run-flow.ts` inspects
only the spawn `error` event, so a `MODULE_NOT_FOUND` daemon is silently tolerated. Benign for
`smoke` (no daemon dependency, which is why it was chosen) and latent for the ten flows.

No device is needed for any of this — the guard is unit-testable and the wiring is static.

- [ ] Every flow's `appId` is parameterized, with `run-plan.ts` supplying a default that
      leaves `maestro-e2e` behaviorally unchanged, and `packaged-app-smoke` supplying the
      release id
- [ ] A `scripts/ci` guard reads the REAL `apps/android/maestro/*.yaml`, `eas.json` and
      `app.config.ts` and fails when a workflow's profile resolves to a package no flow it
      runs can launch — proven by MUTATION: the P8-W10 gate's edit must turn it red
- [ ] Both Android jobs build `@picompanion/cli` and `@picompanion/server`, and `run-flow.ts`
      fails on a non-zero daemon exit rather than only on the spawn `error` event
- [ ] The three prose sites the P8-W10 gate marked as intent (`android-maestro-e2e.yml`'s
      header and run step, `apps/android/maestro/README.md`) are rewritten to describe what
      the tree then does, with the "cannot pass yet" blocks removed

#### T208 — Owner-gated: configure `EXPO_TOKEN` and confirm the emulator action boots here

`labels: phase-8, area: ci` · `wave: owner-blocked` · `depends-on: T207`

Same shape as T59's VPS gate: this cannot be cleared by an agent. Add the `EXPO_TOKEN`
repository secret from an Expo account with EAS build access, dispatch
`android-maestro-e2e.yml`, and read whether KVM is available to
`reactivecircus/android-emulator-runner` on this repository's `ubuntu-latest` runners. Both
Android jobs dry-run with a logged notice until then, and neither has ever executed
end-to-end.

Expect on the first real run: EAS queue plus build 15–30 min for `production-apk`, emulator
cold boot 5–8 min, `smoke.yaml` under a minute — call it 25–40 min for `packaged-app-smoke`,
and roughly that again per `maestro-e2e` shard in parallel.

**Must land after T207**, or the first real run burns that wall time rediscovering the appId
mismatch T207 exists to fix.

- [ ] `EXPO_TOKEN` is configured, or a written decision records that it will not be
- [ ] A real dispatched run is read, and its conclusion and run id are recorded here

#### T209 — A guard-guard: every `run-guard-*.mjs` is wired into a workflow, or allowlisted

`labels: phase-8, area: ci` · `wave: P8-W12` · `depends-on: T207`

**T207 shipped the third unwired guard runner in `scripts/ci/`, and nothing noticed any of
them.** Its own module header said "CI runs it via
`node scripts/ci/run-guard-app-id-package-pairing.mjs`" while no workflow referenced that file
at all. The check did reach CI, through its test file's real-tree assertion inside the
`changes` job's unconditional `node --test scripts/ci/*.test.mjs` step — real protection, but a
different contract from a guard job, and not the one the file claimed. The P8-W11 gate added
the missing job; this task adds the check that would have caught it.

Build a guard that enumerates `scripts/ci/run-guard-*.mjs` and fails when one is referenced by
no workflow under `.github/workflows/`. Two runners are legitimately unwired and belong on an
explicit allowlist carrying the reason: `run-guard-clean-working-tree.mjs`, which `CLAUDE.md`
documents as local-only because `actions/checkout` makes it exit 0 by construction, and
`run-guard-server-test-typecheck-ceiling.mjs`, documented as red. An allowlist entry must
require a reason string, so adding one is a visible decision rather than a silent skip.

Owns: the new guard and its test under `scripts/ci/`, plus its job in
`.github/workflows/ci.yml`.

- [ ] The guard fails when a `run-guard-*.mjs` is referenced by no workflow, proven by
      MUTATION: delete the `guard-app-id-package-pairing` job from `ci.yml` and show it goes red
- [ ] A comment mentioning a runner does NOT count as wiring it — the P8-W11 gate found exactly
      two such comments and they were the reason the gap read as covered. Cover this case with
      a test
- [ ] The allowlist requires a recorded reason, and the two known entries carry theirs
- [ ] The guard is itself wired into `ci.yml`, which its own check will confirm

#### T210 — Fix `docs/legacy-retirement.md`'s ordering: the undo must precede the cutover

`labels: phase-8, area: docs` · `wave: P8-W12` · `depends-on: none`

§7 (Undo) sits after §6 (Cutover), so a reader following the document in order performs the
one-way step before reading the way back. The undo's content is concrete and correct — it names
both daemons, the port, and "do nothing to `$PASEO_HOME`" — this is purely an ordering defect,
found by the P8-W11 merge gate against base state, not introduced by any recent wave.

While here, re-read §5 against §2.3: the P8-W11 gate corrected §5's "17 `TS2307`" to 18 to
match §2.3's table and the measured tree, but the pair drifted apart once and may again. Decide
whether §5 should quote a number at all, or simply point at §2.3.

- [ ] The undo section precedes the cutover section
- [ ] No section states a gate figure that another section contradicts

#### T211 — `guard-run-guard-wiring` cannot report a stale allowlist entry

`labels: phase-8, area: ci` · `wave: P8-W13` · `depends-on: T209`

T209's guard iterates the `run-guard-*.mjs` files it finds on disk and asks whether each is wired.
An `ALLOWLISTED_UNWIRED_RUN_GUARDS` key is therefore only ever consulted when a matching runner
exists: a key naming a deleted runner, or one that some workflow now genuinely wires, is
unreachable and silently ignored.

There is no live defect — both current entries name files that exist and are genuinely unwired,
and the P8-W12 merge gate verified both claims against the tree. But an allowlist that cannot go
red is the "check that cannot fail" shape this guard was built to close, in the guard itself.

Owns: `scripts/ci/guard-run-guard-wiring.mjs` and its test.

- [ ] The guard fails when an allowlist key names a runner that does not exist
- [ ] The guard fails when an allowlist key names a runner a workflow now really invokes, so an
      entry cannot outlive the reason it was written
- [ ] Both proven by MUTATION against the real allowlist, restored afterwards

#### T212 — Drop the churning file and test counts from `docs/legacy-retirement.md` §2.3

`labels: phase-8, area: docs` · `wave: P8-W13` · `depends-on: none`

Three of §2.3's five figures moved again within a day of the P8-W10 re-measure: format 2387 to
2395 files, lint 2213 to 2221, tests 424 to 484. The load-bearing rows did not move and are still
exactly right: orphan 26 against a ceiling of 26, typecheck exit 2 with 18 `TS2307` `expo-router`
errors, lint 8 warnings and 0 errors.

The table already declares itself a dated snapshot and tells the reader to re-measure, so it is
honest by its own contract. The problem is that a count of files scanned and a count of tests run
carry no information the exit code does not, while creating a standing re-measure obligation that
has now been paid three times. Keep what discriminates; drop what only decorates.

- [ ] Every remaining figure is one whose change would mean something is wrong
- [ ] No figure in the document is restated in a second place

#### T213 — `guard-no-legacy-app-tree.mjs`'s `ALLOWLISTED_PATHS` has the shape T211 closed

`labels: phase-8, area: ci` · `wave: P8-W14` · `depends-on: none`

`scripts/ci/guard-no-legacy-app-tree.mjs` consults `ALLOWLISTED_PATHS` only from inside its loop
over the paths it is given, so an entry is read only when a matching path still exists and still
carries a legacy import. A key naming a file that has since been deleted, or one that no longer
contains what the entry excuses, is unreachable and silently ignored — the same unreachable-entry
shape T211 removed from `guard-run-guard-wiring.mjs` one wave earlier.

There is no live defect: both entries name files that exist and the P8-W13 merge gate confirmed
the control flow by reading it. This is a smaller surface than T211's — two entries, one guard —
so it is worth doing correctly rather than quickly.

Owns: `scripts/ci/guard-no-legacy-app-tree.mjs` and its test.

- [ ] The guard fails when an allowlist key names a path that does not exist
- [ ] The guard fails when an allowlist key names a path that no longer carries the import the
      entry excuses, so an entry cannot outlive its reason
- [ ] Both proven by MUTATION against the real `ALLOWLISTED_PATHS`, restored afterwards
- [ ] Reuse T211's reporting vocabulary so the two guards fail in the same words

#### T214 — The `guard-run-guard-wiring` CI job's copy names one of its three failure modes

`labels: phase-8, area: ci` · `wave: P8-W14` · `depends-on: T211`

T211 gave the guard two new failure modes (an allowlist entry naming a runner that does not
exist, and one naming a runner a workflow now genuinely wires). The job's step name in
`.github/workflows/ci.yml` and the comment above it still describe only the original one, so a
CI failure reading `STALE ALLOWLIST ENTRY` appears under a step named for unwired runners.

"Fail when X" is not "fail only when X", so this is incomplete rather than false — it is not the
T124 defect class, and T211 was right to keep `ci.yml` out of its scope. Bundle it into a wave
that touches `ci.yml` for another reason rather than spending a wave slot on it.

Owns: the `guard-run-guard-wiring` job block in `.github/workflows/ci.yml`, nothing else.

- [ ] The step name and its comment name all three failure modes
- [ ] No other job block is touched

#### T215 — Decide whether a guard's own stale-allowlist check is a `guard-capability-prose` capability

`labels: phase-8, area: ci` · `wave: P8-W15` · `depends-on: T211, T213`

`CLAUDE.md` says to add a `CAPABILITIES` entry "the moment you ship one". Two waves have now
shipped the same capability class — T211's `stale-missing-runner`/`stale-wired` and T213's
`findStaleAllowlistViolations` — and neither registered an entry. Neither task's `Owns:` line
included `guard-capability-prose.mjs`, so this is genuinely unowned rather than a miss by either
implementer. It is the third chance to notice; the next one lands unregistered too unless the
policy is written down.

It is a DECISION task, not two lines of data entry. The natural denying phrases — "unreachable
and silently ignored", "cannot report a stale allowlist entry", "an allowlist that cannot go
red" — appear verbatim in this file's own T211 and T213 specs, and `docs/**` is inside the prose
guard's scan scope. Registering the capability naively turns the guard red against frozen,
deliberately-historical task specs, which is the "strict check that fires on valid input" shape.

Either outcome is acceptable; leaving it undecided is not:

- (a) Register both capabilities and mark the frozen specs with the guard's existing historical-
  quotation markers (`CORRECTED`, `this said`, `previously said`), or
- (b) Record in `CLAUDE.md` that frozen `issues-from-plan.md` specs are exempt, and why — then
  register.

Owns: `scripts/ci/guard-capability-prose.mjs`, its test, and the `CLAUDE.md` paragraph recording
the decision.

- [ ] The chosen policy is written down in `CLAUDE.md`, with its reasoning
- [ ] `node scripts/ci/run-guard-capability-prose.mjs` exits 0 on the real tree afterwards
- [ ] A MUTATION proves the new entry can actually fire — an entry the runner's scope cannot see
      is a check that cannot fail, which is the defect this guard exists to catch

#### T216 — `guard-capability-prose.test.mjs`'s T147 test passes for a different reason than its title claims

`labels: phase-8, area: ci` · `wave: P8-W16` · `depends-on: none`

`scripts/ci/guard-capability-prose.test.mjs`'s test titled
"T147: isAppSourcePath is unchanged — apps/web/src and apps/android/src only, tests included"
was true when T147 wrote it. It is false now: `isAppSourcePath` aggregates six areas after
T179, T197 and T207. Its three assertions still pass, because all three name paths outside every
one of those areas — so the test proves the T147 boundary it really cares about (`packages/*/src`
is shipped-scope but NOT denial-scope) while its title claims a narrower scope than the function
has. That is two catalogue entries at once: a check that passes for a different reason than its
title claims, and a false-premise test title — the exact shape T124 exists to catch, in the test
file of the guard that catches it.

The fix is not to widen the assertions. It is to say what this test actually proves, and to add
the assertions that would now fail if someone narrowed `isAppSourcePath` back — a positive case
from each area the three widenings added, so the title and the coverage agree.

Owns: `scripts/ci/guard-capability-prose.test.mjs`. Nothing else.

- [ ] The test's title states what its assertions prove
- [ ] Each of the six in-scope areas has at least one positive assertion, so narrowing
      `isAppSourcePath` to any subset fails a test
- [ ] Proven by MUTATION: remove one area from `isAppSourcePath`, show a named test fails,
      restore from a scratchpad copy (never `git checkout --`)
- [ ] `git grep` for other prose naming the denial scope as two directories, and correct or
      report each

#### T217 — Investigate a guard for count claims in committed prose

`labels: phase-8, area: ci` · `wave: P8-W17` · `depends-on: none`

Four consecutive merge gates have now removed a stale figure from committed prose: the pinned
`scripts/ci` test count from `CLAUDE.md` (P8-W12), the churning file and test counts from
`docs/legacy-retirement.md` §2.3 (P8-W13, and the bolded sentence that contradicted the
result at the same gate), `CLAUDE.md`'s "the five listed here" against a list of twelve
(P8-W15), and a test comment's "eight claims (six areas, two exclusions)" that was already
wrong on the day it landed (P8-W16). Every one cost gate time to find and re-derive.

The pattern is narrow enough to be worth investigating: a spelled-out or numeric count
adjacent to a term the tree can grow — `areas`, `entries`, `tests`, `capabilities`, `files`,
`jobs`, `guards`. A count is legitimate when it is dated ("424 at P8-W10") or when it is a
ceiling the tree enforces ("26 orphan modules (ceiling 26)"); it is a defect when it reads as
a live claim about a set that changes.

**File as investigate-first, and be willing to conclude it should not be built.** A naive
matcher would false-positive on every legitimate dated figure and be disabled within two
waves, which is exactly the failure mode `guard-capability-prose.mjs`'s curated-list design
exists to avoid. The first deliverable is the measurement, not the guard.

Owns: a new guard under `scripts/ci/` and its test, if the measurement supports one.

- [ ] Measure first: run a candidate matcher across the tree and report how many hits are real
      defects versus legitimate dated or ceiling figures, with examples of each
- [ ] If the false-positive rate makes a guard unusable, say so and record WHY in `CLAUDE.md`
      so the fifth gate does not re-propose it — that is a successful outcome for this task
- [ ] If it is buildable, it is curated and narrow like `guard-capability-prose.mjs`, never a
      generic "grep every comment" linter
- [ ] Proven by MUTATION against real committed prose, restored afterwards

#### T218 — Date-qualify the drifting shipped-file counts in `scripts/ci`

`labels: phase-8, area: ci` · `wave: P8-W18` · `depends-on: none`

`scripts/ci/run-guard-capability-prose.mjs` says "= the 1198 this runner reports", and five
sites in `scripts/ci/guard-capability-prose.mjs` say "~1204 files". The runner reports 1219
today.

**None of these is currently a defect**, and the P8-W17 merge gate probed them specifically as
the hardest candidates against T217's zero-defect finding: the first is governed by an explicit
"Counted at the gate:" qualifier, and the `~1204` family carries both a tilde and a
`CLOSED (T184)` marker recording that the paragraph describes the state at the time it was
written. T217's classification survives them, which is why no guard was built.

They are filed because they are the tree's closest live example of the drift T217 measured, they
sit inside `isAppSourcePath`'s scope, and each further widening of the shipped-file set moves
them further from the figure they name. The cheapest durable fix is the one this repository has
now applied four times: state the SHA or wave the figure was measured at, or drop the figure and
describe what it counts.

Owns: `scripts/ci/run-guard-capability-prose.mjs` and `scripts/ci/guard-capability-prose.mjs`
comments only. **No behaviour change, no assertion change.**

- [ ] Every one of the six sites either carries an explicit dated qualifier or no longer states
      a figure
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and
      `node scripts/ci/run-guard-capability-prose.mjs` still exits 0
- [ ] No assertion anywhere is pinned to the numbers you change — confirm by `grep` before and
      by the suite after

#### T219 — Decide what to do with `docs/issues-from-plan.md`'s hand-incremented tallies

`labels: phase-8, area: docs` · `wave: P8-W18` · `depends-on: none`

This file carries running tallies that a human increments by hand: "since P5-W9 — six gates",
"since P5-W10 — five gates", and a total task count. They are pre-existing and T217 correctly
left them alone as outside its scope.

They are a special case worth deciding rather than drifting into: this file is excluded from the
capability-prose denial scan by `DOCS_LEDGER_DENIAL_EXCLUSIONS`, so **no guard in this repository
can ever see them**, and the P8-W17 gate confirmed that its own re-trigger condition therefore
cannot fire on them. Whatever is decided here has to be a convention, because it can never be a
check.

Pick one and record the reasoning in the file itself:

- date each tally to the wave it was last counted at, the way §2.3 of `docs/legacy-retirement.md`
  now works, or
- replace each with the enumeration it summarises, so there is nothing to increment, or
- keep them and record that they are known-approximate, so a reader does not act on one.

Owns: `docs/issues-from-plan.md`. Nothing else.

- [ ] Each tally is dated, removed, or explicitly marked approximate
- [ ] The choice and its reasoning are recorded in the file, not only in a commit message
- [ ] Verify each figure you keep against the tree before you date it — dating a wrong number is
      worse than leaving it undated

#### T221 — `guard-capability-prose.mjs` states two contradictory rationales for one member

`labels: phase-8, area: ci` · `wave: P8-W19` · `depends-on: none`

The `findBuildOrderViolations` entry's comment says the member is a `RegExp` "for a DIFFERENT
reason than T169's disambiguation one: **performance**", and cites a 905-appFile scan taking
6m0.591s with a bare string instead of ~3m49s. The `CLOSED (T184)` block earlier in the same
file says the opposite on both halves: the `RegExp` "still matters **for the reasons T169 gave**
(disambiguating a same-file, same-name collision)", and the position of the sole match within
the shipped-file list "**no longer affects runtime at all**", with the whole run measured at
**0.8s**.

Both sentences are present tense and neither is marked superseded. Verified pre-existing at
`9bc08d0` — P8-W18 did not introduce it — but T218 made it more visible, because its own
edit added a pointer from the live entry into the doc comment that retires it. This is the
false-premise-in-a-doc-comment class `CLAUDE.md`'s T124 section governs, sitting in the guard
that exists to catch that class.

Decide which rationale is true today by reading `findCapabilityDenialViolations`, not by
believing either comment, and make the entry say only that. If the `RegExp` is needed only for
T169's disambiguation, delete the performance rationale rather than dating it: a retired reason
is not a snapshot worth keeping.

Owns: that entry's comment in `scripts/ci/guard-capability-prose.mjs`. **No behaviour change, no
assertion change, no `CAPABILITIES` value change.**

- [ ] Exactly one live rationale for the member remains, and it matches what the runner does
      today
- [ ] The 6m0.591s / ~3m49s figures are removed, or explicitly marked as belonging to the
      superseded algorithm
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and
      `node scripts/ci/run-guard-capability-prose.mjs` still exits 0

#### T222 — `CLOSED (T184)`'s disambiguation half is live, present tense, and false

`labels: phase-8, area: ci` · `wave: P8-W21` · `depends-on: T223`

`scripts/ci/guard-capability-prose.mjs`'s `CLOSED (T184)` block says "the member being a
`RegExp` **still matters for the reasons T169 gave** (disambiguating a same-file, same-name
collision)". T221 established, from the code and by experiment, that it does not: a bare
`findBuildOrderViolations` collides with nothing in this tree, so T169's reason is not live for
this member either. The entry T221 rewrote now says exactly that, and points readers INTO this
block for confirmation — where they meet the opposite claim.

The same block states the run at **0.8s**. Measured at the P8-W19 gate with
`time node scripts/ci/run-guard-capability-prose.mjs`: **1.203s**. Both the verifier and the
gate measured ~1.2s independently.

Verified pre-existing at `a21c219` — T221 was explicitly barred from editing this block, and
correctly did not. It is the surviving half of the contradiction T221 was filed to close.

**Ordered after T223 deliberately.** If T223 changes the member's form, what this block should
say about it changes with it; writing the history first would mean writing it twice.

Owns: the `CLOSED (T184)` block and the `FIND_BUILD_ORDER_VIOLATIONS_MEMBER` doc comment in
`scripts/ci/guard-capability-prose.mjs`. **Comments only.**

- [ ] The block no longer claims T169's reason is live for this member, and says which reason (if
      any) is
- [ ] The `T183:` opener on `FIND_BUILD_ORDER_VIOLATIONS_MEMBER`'s doc comment is fixed too
      (it still calls the member a `RegExp` chosen for performance; T223 made it a bare string).- [ ] The 0.8s figure is re-measured by you in the foreground and either updated with what you
      observed or removed
- [ ] A reader following the entry's pointer into this block is not handed a contradiction
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and
      `node scripts/ci/run-guard-capability-prose.mjs` still exits 0

#### T223 — The `findBuildOrderViolations` `RegExp` member is silently refactor-fragile

`labels: phase-8, area: ci` · `wave: P8-W20` · `depends-on: none`

`declarationPatternsFor` recognises **four** declaration shapes for a bare-string member.
`FIND_BUILD_ORDER_VIOLATIONS_MEMBER` is `/\bfunction\s+findBuildOrderViolations\s*\(/` — only
the second of them. The bare string is a strict superset, so the `RegExp` form buys nothing and
loses three shapes.

Proven at the P8-W19 gate against the REAL exported predicate, not by reading the regex: feeding
`isCapabilityMemberDeclared` a behaviour-preserving refactor of the declaration
(`export function findBuildOrderViolations(commandText) {` →
`export const findBuildOrderViolations = (commandText) => {`, still exported, still shipped)
gives `bare-string member declared: true`, `RegExp member matches: false`. Under the `RegExp`
member that refactor silently disables the entry: every denying phrase for this capability
becomes allowed again, exit 0, no signal — a check that cannot fail, arriving by refactor
rather than by deletion, which the entry's existing proof does not cover.

T221 is what makes this actionable: both rationales that argued for the `RegExp` form are now
established as dead, so nothing argues for keeping the brittle one. T221 could not do it — it
requires a `CAPABILITIES` value change, which that task's scope forbade.

Owns: that entry's `methodNames`, the `FIND_BUILD_ORDER_VIOLATIONS_MEMBER` constant, and
`scripts/ci/guard-capability-prose.test.mjs`. Do not touch the `CLOSED (T184)` block — T222
owns it, and runs after you.

- [ ] The entry survives the const-arrow refactor of its declaration, proven by a test that FAILS
      before your change
- [ ] Whatever form the member ends up in, the reason is stated once and is true today
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and
      `node scripts/ci/run-guard-capability-prose.mjs` still exits 0 with the same group count

#### T224 — A live "roughly 8 capabilities ... today" claim against a real count of 12

`labels: phase-8, area: ci` · `wave: P8-W22` · `depends-on: none`

`scripts/ci/guard-capability-prose.mjs`, inside `findCapabilityDenialViolations`'s T184 cache
comment, says "(roughly 8 capabilities × ~1200 files today, trivial either way)".
`node scripts/ci/run-guard-capability-prose.mjs` reports **12 capability group(s)** against
**1219** shipped files. The word "today" makes this a live present-tense claim, not a dated
snapshot, which is what separates it from the figures around it.

Verified pre-existing at `9218e27` (identical text, one wave earlier), and outside T222's `Owns`
line by about two hundred lines, which is why it was filed rather than fixed at the P8-W21 gate.

This is materially the condition `CLAUDE.md`'s T217 section names for revisiting the rejected
generic guard: a NEW count claim found stale in a file the denial scan can actually see, and
`scripts/ci` is in that scope. **Fix this site by hand** — drop the figures, or date them the way
T218 dated this same directory's shipped-file counts — and record in the T217 section whether
the fifth-stale-count condition is now met. **Do not re-propose the generic guard**; T217
measured 867 hits over 2288 files and found zero live defects, and one more hand-fixed site does
not overturn that.

Scope note, measured rather than assumed: the `~1200-file list` and `~900 appFiles` figures a few
lines below sit inside an explicit past-tense narration of the pre-T184 algorithm ("the old
`evidencePool.some(...)` walk ran..."). They are legitimate history. Only the "today" claim is
live.

Owns: that comment in `scripts/ci/guard-capability-prose.mjs`, and the `CLAUDE.md` T217
subsection's re-trigger paragraph. **Comments only.**

- [ ] No live count claim about the capability list survives in that comment
- [ ] `CLAUDE.md`'s T217 re-trigger condition records what this site was, and says whether it
      changes the conclusion
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and
      `node scripts/ci/run-guard-capability-prose.mjs` still exits 0 with the same group count

#### T225 — Nothing links the 60 ms coalescer pin to the 20 msg/s bridge budget

`labels: phase-9, area: daemon` · `wave: P9-W7` · `depends-on: none`

plan.md §14.5 budgets "no bridge update rate above 20 messages per second per agent".
`packages/server/src/server/agent/agent-stream-coalescer.ts`'s
`AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60` is what delivers it
(`1000 / 60 ≈ 16.67` flushes/sec), and it is already pinned by exact equality at
`agent-stream-coalescer.test.ts:130` — `expect(AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS)
.toBe(60)` — so the constant cannot move without the suite going red.

**The assertion is not the gap; its silence is.** Nothing at that line, or at the constant's
own declaration, says a published performance budget depends on the value, and the assertion
sits inside a test titled "uses constructor windowMs instead of a hard-coded value" — a
title about parameterisation, not about a rate ceiling. A future reader relaxing the pin (or
rewriting that test around its stated subject) has nothing in front of them to say what
else breaks.

**Do NOT add `assert.ok(AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS >= 50)`.** The P9-W1 gate
cut exactly that recommendation from `scripts/ci/guard-web-session-bundle-budget.mjs`'s
header: it is strictly weaker than the equality pin that already ships, and adding it would
read as closing a hole that was never open.

Owns: `packages/server/src/server/agent/agent-stream-coalescer.ts` and its test's title and
comments. **Comments and one test title only** — no behaviour change, no new assertion,
no change to the 60 ms value.

- [ ] The constant's declaration names §14.5's 20 msg/s budget and shows the arithmetic
- [ ] The test carrying the equality pin has a title that says the pin guards that budget,
      or the pin moves to a test whose title does
- [ ] `npm run test:unit --workspace=@picompanion/server` is all-pass, and the pinned value
      is still exactly 60

#### T226 — Web caps the extension log at 500 lines where Android bounds it to 200

`labels: phase-9, area: web` · `wave: P9-W8` · `depends-on: none`

plan.md §14.5: "extension log: virtualize above 200 lines." The two platforms answer it
differently, and neither matches the letter of the bullet:

- Android bounds a `log` element to the bridge contract's own default tail of exactly 200
  lines (`apps/android/src/features/extensions/renderers/renderers-model.test.ts`, "bounds
  the log to the bridge contract's default tail of 200 lines").
- Web's `apps/web/src/features/extensions/renderers/log.tsx` caps to
  `DEFAULT_LOG_TAIL = 500`, and its own doc comment says this is deliberately "not full list
  virtualization" because the payload arrives pre-bounded on the wire (plan.md §11.4).

So the same budget bullet is met by two different mechanisms at two different thresholds,
and "cap the payload" is not "virtualize the render". Filed by the P9-W1 gate, which found
it disclosed (correctly) in `scripts/ci/guard-web-session-bundle-budget.mjs`'s
classification but owned by nobody.

**This is a product decision, not a guard.** Decide which number is right and why — and
whether the budget means the payload cap or the render window — then make the two
platforms and §14.5 agree, in writing. Do not "fix" it by changing one constant to match
the other with no recorded rationale, and do not build a CI check that pins two numbers
whose disagreement nobody has resolved.

Owns: `apps/web/src/features/extensions/renderers/log.tsx`, the Android renderer's log
bound, and whichever of plan.md §14.5 / §11.4 records the decision.

- [ ] One threshold, and one mechanism, is stated as the intended behaviour, with the
      reason recorded where a reader of the budget will find it
- [ ] Both platforms' tests assert that threshold by name, not by a literal repeated in
      two places
- [ ] `scripts/ci/guard-web-session-bundle-budget.mjs`'s classification of this bullet is
      updated to say it is resolved, not disclosed

#### T227 — scripts/ci imports vite, which no root package.json declares

`labels: phase-9, area: ci` · `wave: P9-W9` · `depends-on: none`

`scripts/ci/run-guard-web-session-bundle-budget.mjs` imports `build`,
`loadConfigFromFile` and `mergeConfig` from `vite`. `vite` is declared only in
`apps/web/package.json`; the root `package.json` does not list it. The import resolves
today purely because npm hoists the workspace's copy into the root `node_modules`.

**This is the T194 shape** — a real dependency no manifest declares, which works until an
install nests it (a second, conflicting `vite` range anywhere in the workspace is enough).
T194 was found only after the repository gained a remote and a clean `npm ci` checkout
disagreed with every local one; this is the same class, caught before it fires.

Two candidate fixes, and the second is the durable one:

1. Declare `vite` as a root `devDependency` at the version `apps/web` already pins.
2. Guard the class, not the instance: every third-party import in `scripts/ci` must be
   declared by the ROOT `package.json` (node builtins and relative paths excluded), so the
   next runner that reaches for a workspace-only package fails at the guard rather than on
   a future clean install. `scripts/ci` runs from the repository root with no workspace of
   its own, which is exactly why its imports have no other manifest to satisfy them.

Owns: the root `package.json` dependency list and, if built, the new guard plus its test
and runner. Recorded in place at the P9-W1 merge gate as a comment above the `vite` import.

- [ ] `vite` is resolvable from the repository root by declaration, not by hoisting
- [ ] If the guard is built, it FAILS on a real undeclared import added to a scratch copy
      of a `scripts/ci` file and passes with it removed — proven, not assumed
- [ ] `node scripts/ci/run-guard-web-session-bundle-budget.mjs` still exits 0

#### T228 — Register P9-W2's and P9-W3's four new guard capabilities in CAPABILITIES

`labels: phase-9, area: ci` · `wave: P9-W10` · `depends-on: none`

T44A2 (P9-W2) shipped `scripts/ci/guard-axe-route-coverage.mjs`: `computeDeclaredRoutes`
derives the real route list from `apps/web/src/routes/route-tree.ts`, and
`findRouteCoverageViolations` reports both directions — a declared route with no entry in
`apps/web/e2e/fixtures/route-coverage-manifest.ts`, and a manifest entry naming a route that
no longer exists. That is the same capability CLASS `CLAUDE.md`'s T215 subsection registered
for T211 and T213: a walk that closes the "check that cannot fail" shape for its own
curated list. **Nothing was registered in `guard-capability-prose.mjs`'s `CAPABILITIES`,**
because T44A2's `Owns` line did not cover that file — the exact omission T211 and T213
each made, which cost T215 a whole later task to close.

**Widened at the P9-W3 merge gate.** T44A3 (P9-W3) shipped three more guards of the same
class in the same directory, and registered nothing for the same reason (its `Owns` line
was "CI workflows"). All three ship in `scripts/ci`, which `isAppSourcePath` DOES admit,
so entries for them would be live rather than inert:

- `scripts/ci/guard-version-drift.mjs`: `findWorkspacePinDrift`,
  `findWsHelloProtocolVersionDrift`, `findRelayProtocolVersionDrift`.
- `scripts/ci/guard-secret-scan.mjs`: `findSecretMatches`.
- `scripts/ci/guard-audit-baseline.mjs`: `findUnbaselinedAdvisories`,
  `findStaleBaselineEntries`.

**Widened again at the P9-W9 merge gate, to a fifth.** T227 shipped `scripts/ci/guard-declared-root-dependencies.mjs`'s `findUndeclaredRootDependencies`
— every third-party import in `scripts/ci` must be declared by the ROOT manifest — and registered nothing, for the identical reason: its `Owns` line covers the root `package.json` and the new guard, not `guard-capability-prose.mjs`. That is the fifth GUARD to ship with this omission and the third TASK to make it (T44A3 shipped three of the five on its own); count guards when you are counting entries to write, and tasks when you are counting `Owns` lines that went wrong. It ships in `scripts/ci`, so an entry is live, not inert. **Take it in this wave too**, as its own single non-group member, for the reason the next paragraph gives — and word its phrases so they are not lifted from that guard's own header, which narrates the fixed `vite` defect in the past tense and carries no `HISTORICAL_QUOTE_MARKERS` trigger.

Do all four in this one wave rather than filing a second task with an identical `Owns`
line: two tasks serially editing `guard-capability-prose.mjs` is how T222 and T223 ended up
contending over the same member. Each capability still needs its OWN entry and its own
firing proof — a shared token would let one guard's fix "ship" another's phrase
protection before that guard had it, which is the merge T215 explicitly refused.

`CLAUDE.md`'s instruction is explicit: **add a new capability entry the moment you ship
one.** No live denying prose exists today (the P9-W2 gate grepped `docs/`, `plan.md`,
`apps/web/src` and `apps/web/e2e`, and the real runner is at exit 0), so this entry is
FORWARD protection in T162's shape — the same choice T215 made for both of its entries.

Shape it the way T215 shaped `findStaleAllowlistViolations`, and for the same reasons:

- A single non-group member naming **`findRouteCoverageViolations`** — a real, newly-named,
  uniquely-declared function. Do NOT use a string literal (a route path, a message
  fragment): `stripCommentsAndStrings` erases those before any check runs, which is what
  makes an entry permanently unable to ship.
- Word the `denyingPhrases` so they are NOT lifted from
  `guard-axe-route-coverage.mjs`'s own header narration, which legitimately describes the
  pre-fix state in past tense. T215 hit this exact collision and documented it.
- **Call the exported `isAppSourcePath` on
  `scripts/ci/guard-axe-route-coverage.mjs` before trusting any scope claim.** Do not read a
  list of areas from prose — conflating it with `isShippedSourcePath` is the error T147,
  T216, T217 and T224 each had to close.

Owns: `scripts/ci/guard-capability-prose.mjs`, `scripts/ci/guard-capability-prose.test.mjs`,
and one paragraph in `CLAUDE.md`. **Nothing else** — in particular, not
`guard-axe-route-coverage.mjs` itself.

- [ ] The entry is proven able to FIRE: a denying sentence in that entry's own wording,
      appended to a real in-scope tracked file, makes
      `node scripts/ci/run-guard-capability-prose.mjs` exit 1 naming this capability;
      restoring the file from a scratchpad copy (never `git checkout --`) returns it to
      exit 0 with `git status --porcelain` empty
- [ ] The phrases do not collide with `guard-axe-route-coverage.mjs`'s own header, proven
      by a test that feeds that file's real committed content through
      `findCapabilityDenialViolations` and asserts zero matches
- [ ] Every one of the five capabilities has its own entry, each proven able to fire
      independently — not one entry covering several guards
- [ ] `node --test scripts/ci/*.test.mjs` is all-pass and the full-tree scan stays at
      exit 0

#### T229 — SHA-pin the 56 tag-pinned GitHub Actions refs, looked up not guessed

`labels: phase-9, area: ci` · `wave: P9-W11` · `depends-on: none`

Measured at the P9-W3 merge gate over all three workflow files (`git grep -h "uses: "
HEAD -- '.github/workflows/*.yml'`, counting a SHA pin as `@` plus forty hex characters):
**78** `uses:` lines, **22** SHA-pinned, **56** tag-pinned. The tag-pinned set is
`actions/setup-node@v4` (34), `actions/checkout@v4` (16, beside 21 correctly SHA-pinned
occurrences of the same action), `expo/expo-github-action@v8` (3),
`reactivecircus/android-emulator-runner@v2` (2) and `cachix/install-nix-action@v27` (1).

A mutable tag can be repointed by its owner to any commit at any time. `actions/checkout`
already demonstrates this repository's intended style — `@11d5960a...` with a trailing
`# v4.4.0` comment — it is simply applied to 21 of its 37 occurrences and none of the
others.

**Look every SHA up; never guess one.** A wrong forty-character pin fails every job that
uses it, which is worse than the visible risk it replaces. `gh api
repos/<owner>/<repo>/git/refs/tags/<tag>` resolves a tag to its commit; record the version
in a trailing comment on every line so a future reader can tell what was pinned.

Do the first-party actions first (`actions/setup-node`, then the 16 remaining
`actions/checkout@v4`), then the three third-party ones, which carry the higher real risk
and the higher chance of a breaking pin — so verify CI is green after each group rather
than pinning all 56 in one commit.

Owns: `.github/workflows/*.yml`, and the pinning table in
`docs/security-and-version-drift.md` · **Nothing else.**

- [ ] Every `uses:` line names a forty-character commit SHA with a trailing version comment
- [ ] Every SHA was resolved from the registry or the GitHub API, and the report says how
- [ ] CI is green on the real run after the change, not only locally
- [ ] `docs/security-and-version-drift.md` §4's table is re-measured, not edited by hand

#### T230 — Make the relay wire version structurally impossible to diverge

`labels: phase-9, area: daemon` · `wave: P9-W12` · `depends-on: T44A3`

T44A3's `guard-version-drift.mjs` proves that `packages/relay`'s `CURRENT_RELAY_VERSION`
and `packages/protocol`'s `CURRENT_RELAY_PROTOCOL_VERSION` currently AGREE. It cannot make
them unable to disagree: they are two independent literals, and the guard is a text check
over both files. It also fails loudly if either constant is renamed
(`[extraction-failed]`), which is the right behaviour but is still a guard, not a
structure.

The durable fix is one exported constant that the other side imports, so divergence is a
compile error rather than a caught mismatch. **The blocker is the Cloudflare Workers
packaging question**: `packages/relay/src/cloudflare-adapter.ts` is bundled for a Workers
runtime, and whether it can take a `@picompanion/protocol` import at that boundary has not
been established. Answer that first, in writing, and if the answer is no, say so and keep
the guard — a documented "cannot be structural, here is why" closes this task just as
well as a refactor.

Owns: `packages/relay/src/`, `packages/protocol/src/daemon-endpoints.ts`, and
`scripts/ci/guard-version-drift.mjs` if the guard becomes redundant.

- [ ] The Workers-boundary question is answered with evidence, not assumed
- [ ] Either one constant is the single source and the other side imports it, or the reason
      it cannot be is recorded where the guard's header points
- [ ] If the guard stays, it still fires on a real divergence — proven, not assumed

#### T231 — Triage the 36 baselined npm advisories (needs npm install)

`labels: phase-9, area: tooling` · `wave: P9-W13` · `depends-on: T44A3`

**Owner-blocked, and filed as such.** T44A3 recorded `npm audit`'s real output at its
commit — 36 advisories: 0 critical, 10 high, 23 moderate, 3 low over 1951 dependencies
— and baselined all 36 in `scripts/ci/guard-audit-baseline.mjs` so a NEW advisory, or a
severity change on a known one, fails CI. That is the correct handling of findings this
environment cannot fix; it is not a fix.

Two owners, split as measured at the P9-W3 gate: **29** advisories come from the Android
toolchain (the Metro/Expo chain; clearing them means Expo SDK `^54.0.18` to `57.x`), and
**7** from `packages/server` (`@ai-sdk/gateway`, `@ai-sdk/provider-utils`, `ai`,
`body-parser`, `express`, `qs`, `uuid`).

Both require `npm install`, which the classifier refuses in this environment, and the Expo
half is a semver-major bump that needs a real device or emulator run to verify — the same
blocker as T208. **Do not attempt the installs.** When the owner unblocks it, take the
seven server advisories first: they are ordinary minor bumps and independent of the Expo
question.

Owns: `package.json` dependency ranges and `scripts/ci/guard-audit-baseline.mjs`'s
baseline.

- [ ] Every advisory is either cleared by a bump or carries a written reason it cannot be
- [ ] The baseline shrinks to match; no advisory is dropped from it without being fixed
- [ ] `node scripts/ci/run-guard-audit-baseline.mjs` exits 0 against the real audit

#### T232 — Register the workspace-test-coverage stale-allowlist walk in CAPABILITIES

`labels: phase-9, area: tooling` · `wave: P9-W14` · `depends-on: T44A4`

T44A4 shipped `findWorkspaceTestCoverageViolations` in
`scripts/ci/guard-workspace-test-coverage.mjs` — the third instance of the capability
class T211 and T213 shipped one wave apart: a dedicated walk over a guard's own allowlist
that reports an entry naming something which no longer exists, or which no longer needs the
exemption. T215 registered those two in `guard-capability-prose.mjs`'s `CAPABILITIES` as two
separate entries. T44A4's `Owns:` line was `CI workflows`, which does not reach that file —
the identical ownership gap that produced T215 in the first place.

Nothing is live today: `node scripts/ci/run-guard-capability-prose.mjs` exits 0 at the P9-W4
gate commit. This is preventive, and it must follow T215's shape rather than copy T44A4's
spec prose:

- ONE non-group entry (T168's group shape is not needed).
- `denyingPhrases` worded FORWARD, in this task's own words — never lifted verbatim from
  the new guard's own header, which narrates the pre-fix defect in past tense and would
  collide the first time a comment reflow welds the clause onto one line. That is exactly
  the trap T215 measured and then deliberately worded around.
- Call `isAppSourcePath` on the paths you expect the denial scan to reach before you trust
  a scope. Reading CLAUDE.md's list is not the check; executing the predicate is.
- Prove the entry can FIRE before trusting it: append a denying sentence to a real,
  in-scope tracked file, watch the runner exit 1 naming the capability, restore
  byte-identically from a scratchpad copy (never `git checkout --`), and confirm
  `node scripts/ci/run-guard-clean-working-tree.mjs` exits 0.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test. Nothing else.

- [ ] One entry registered, worded forward, not lifted from the guard's own narration
- [ ] `isAppSourcePath` executed on the paths relied on, not inferred from prose
- [ ] The entry proven able to fire, and the tree restored byte-identically after

#### T233 — Wire or allowlist cli's test:local and server's test:integration

`labels: phase-9, area: ci` · `wave: P9-W15` · `depends-on: T44A4`

T44A4 wired `@picompanion/cli`'s `test:unit` and left `test:local` (`tests/run-all.ts`,
which spawns real isolated daemon subprocesses with its own concurrency pool and a `zx`
dependency) unwired, disclosing it rather than shipping it sight-unseen. `packages/server`'s
`test:integration` is unwired for the same reason and predates that wave.

**The guard T44A4 shipped cannot see this gap, and that is the point of filing it.**
`guard-workspace-test-coverage.mjs` is satisfied by any ONE `test*` script per workspace, so
`cli-tests` and `server-tests` running `test:unit` fully rescue both packages while the
heavier suites stay invisible to it by construction. A follow-up that only re-reads the
guard's output will conclude, correctly and uselessly, that nothing is wrong.

Either wire each suite into CI with the process/port lifecycle and wall time actually
measured — not assumed — or record, per suite, why it stays local-only. Whichever way it
goes, the answer belongs somewhere a reader of `docs/ci-matrix.md` will find it.

Owns: `.github/workflows/ci.yml` and `docs/ci-matrix.md`. Not the suites themselves.

- [ ] Each suite is either running in CI or has a written, specific reason it is not
- [ ] Any wiring is backed by a measured run, not an estimate
- [ ] `docs/ci-matrix.md` records the outcome where its coverage claim lives

#### T234 — Decide whether protocol's and web's Linux-only CI coverage is intended

`labels: phase-9, area: ci` · `wave: P9-W16` · `depends-on: T44A4`

T44A4's coverage classification records, accurately, that `protocol-client-tests` runs on
`ubuntu-latest` only, and that web's Playwright, axe and performance-budget E2E do too —
`web-unit-tests (windows-latest)` deliberately runs the jsdom suite alone. Three jobs run on
Windows in total.

That asymmetry is currently a fact nobody decided. It sits against `plan.md` §15.4's
Windows-primary-daemon framing: the daemon this product talks to is expected to run on
Windows, and the protocol package is the layer that describes that conversation.

This is a decision task, not a code task. The acceptable outcomes are a written
"Linux-only is correct for these, because ..." or a job added for whichever area the
reasoning says needs one. Do not add Windows jobs across the board to make a table look
symmetric — CI minutes spent proving nothing is the failure mode here.

Owns: `docs/ci-matrix.md`, and `.github/workflows/ci.yml` only if the decision adds a job.

- [ ] The Windows/Linux split is a recorded decision with a stated reason
- [ ] Any job added is justified by that reasoning, not by symmetry

#### T235 — Give apps/android a per-release versionCode so a second APK installs

`labels: phase-9, area: android` · `wave: P9-W17` · `depends-on: T44B1`

`apps/android/app.config.ts` declares `version: "0.1.0"` and no `android.versionCode`, and no
profile in `apps/android/eas.json` sets `"autoIncrement"`. Confirmed at the P9-W5 merge gate:
`grep -n versionCode apps/android/app.config.ts` exits 1.

So every tagged release builds the same `0.1.0` at `versionCode 1`. Android refuses to install
an APK whose `versionCode` is not greater than the installed one, so the SECOND internal build
a tester receives fails with `INSTALL_FAILED_VERSION_DOWNGRADE` — and it fails on the
tester's device, not in CI, which is the expensive place to find it. T44B2 (verify clean
installs and document rollback) walks straight into this.

The smallest fix is `"autoIncrement": true` on the `production-apk` profile, which makes EAS
own the counter. Decide deliberately between that and a tag-derived `versionCode`: EAS's
counter lives in EAS, so it is a second source of truth against the git tag, which is the
shape T230 exists to close elsewhere. Whichever you pick, write down why in the same commit.

Owns: `apps/android/app.config.ts` and `apps/android/eas.json`. Nothing else.

- [ ] Two consecutive tagged builds produce strictly increasing `versionCode`s
- [ ] The choice between EAS auto-increment and a tag-derived value is written down
- [ ] The reasoning names where the value's single source of truth lives

#### T236 — Settle whether the EAS remote archive carries the locally-built dist/

`labels: phase-9, area: ci` · `wave: P9-W18` · `depends-on: T44B1`

**Owner-blocked.** `android-apk-release.yml` builds `protocol`, `design-tokens`, `highlight`
and `frontend-core` on the runner before `eas build`, but EAS builds from an archive it
assembles and uploads — it does not necessarily carry gitignored `dist/` output. If it does
not, the remote build resolves those workspaces through package `exports` that point at
directories the archive lacks.

This is the stale-`dist` family that has now produced three separate defects in this phase
(T44A2's misordered typecheck, T44A4's "no build step is needed", and this), but it is the one
member nobody here can settle: it needs a real `eas build:inspect --stage archive` run, which
needs `EXPO_TOKEN`. Measured at the P9-W5 gate so the next reader does not re-measure: there is
no `.easignore` anywhere in the tree, and `apps/android/package.json` declares no
`eas-build-*` hook script.

If the archive lacks the built output, an `eas-build-post-install` hook that runs the same four
builds is the fix. Do not add the hook speculatively — an unnecessary remote rebuild costs
EAS minutes on every release and hides the real answer.

Owns: `apps/android/package.json`'s scripts and `.github/workflows/android-apk-release.yml`.

- [ ] The archive's contents are inspected on a real build, not assumed
- [ ] The result is recorded in `docs/android-apk-release.md` either way
- [ ] A hook is added only if the inspection shows one is needed

#### T237 — Close or document guard-signing-material's content-read skip list

`labels: phase-9, area: tooling` · `wave: P9-W19` · `depends-on: T44B1`

`run-guard-signing-material.mjs`'s `SKIP_CONTENT_READ_EXTENSIONS` returns before reading a
file, so the PEM content check never runs on `.zip`, `.jar`, `.pdf` and the other binary-asset
extensions in that set. Measured at the P9-W5 merge gate by tracking the identical PEM header
twice: as `docs/gate-w27-scratch.txt` the guard reported a violation; as
`docs/gate-w27-scratch.zip` it reported none. The pure matcher
(`findSigningMaterialViolations`) does catch both — the loss happens in the CLI wiring above
it, which is the catalogue's "a proof aimed at the primitive when the behaviour lives in the
wiring above it".

**This is not a regression.** It is parity with `guard-secret-scan.mjs`, whose
`BINARY_EXTENSIONS` skips the same three, and the name-based checks are unaffected. The three
comments that claimed the list was "NOT a security-relevant exclusion" were corrected at that
gate; what is left is the behaviour decision.

Decide one of: read content on those extensions with the existing 5 MiB size cap and accept
the decode failures (`.zip`/`.jar` are not valid UTF-8, so the existing `catch` already handles
them — check whether that makes the skip list pointless rather than protective); or narrow the
list to the extensions that genuinely cannot hold a pasted key. Either way **add a CLI-level
test** — today's suite exercises only the pure matcher, which is exactly why this survived.
Consider whether `guard-secret-scan.mjs` deserves the same treatment in the same wave.

Owns: `scripts/ci/guard-signing-material.mjs`, `scripts/ci/run-guard-signing-material.mjs`,
their test, and `docs/android-apk-release.md` §2.2.

- [x] A PEM key under a skipped extension is either caught, or documented as out of scope
- [x] A CLI-level test covers the skip list, not only the matcher
- [x] The decision is proven by a firing that was watched, not asserted

#### T238 — Decide whether the published CLI binary keeps the name paseo

`labels: phase-9, area: docs` · `wave: P9-W20` · `depends-on: T44B2`

`packages/cli/package.json` publishes `@picompanion/cli` with `"bin": { "paseo":
"bin/paseo" }`, so `npm install -g @picompanion/cli` puts a command named **`paseo`** on the
user's PATH, and `packages/cli/src/utils/client-id.ts` resolves its home as
`process.env.PASEO_HOME ?? join(homedir(), ".paseo")`. `plan.md` §1.1's identity table names
the product and the package scope but says nothing either way about the executable's name,
so nobody has actually decided this — it was inherited from the port and has never been
questioned in writing. Surfaced at the P9-W6 merge gate while checking T44B2's clean-install
runbook, which necessarily documents the name a user types.

This is a genuine two-sided decision, not an obvious rename. **Keeping `paseo`** is the
safe option: it is what `docs/clean-install-and-rollback.md`, every provenance document and
the owner's live `$PASEO_HOME` already use, and renaming would strand existing data
directories and every runbook that names the command. **Renaming** is what `CLAUDE.md`'s
reference-only-documents rule points at — it says Paseo's naming must not bleed into new
product docs, UI copy or package metadata, and a `bin` entry is package metadata a user
reads on the first line of the runbook.

Whichever way it goes, the decision must be written down where the next reader meets the
name, not left implicit in `package.json`. If the name is kept, say in `plan.md` §1.1 that it
is kept deliberately and why; if it changes, the rename touches `bin/`, `PASEO_HOME`, and
every runbook that names either, and needs a migration note for the existing directory.

Owns: `plan.md` §1.1 and `docs/clean-install-and-rollback.md` §A.2. A rename, if chosen, is a
separate task — this one decides and records.

- [ ] The decision is recorded where a reader meets the command name, not only in metadata
- [ ] The reasoning names the `$PASEO_HOME` migration cost explicitly
- [ ] If the name is kept, `CLAUDE.md`'s naming rule is reconciled with it in writing

#### T239 — Replace the coalescer comment's four file:line citations with symbols

`labels: phase-9, area: daemon` · `wave: P9-W21` · `depends-on: T225`

T225's header comment on `AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS` cites four sources by line
number: `plan.md:1154`, `agent-manager.ts:653`, `agent-manager.ts:655-658` and
`bootstrap.ts:834`. All four were re-read at the P9-W7 merge gate and are correct today. The
`655-658` range is correct only because that gate fixed it — it landed as `654-658`, and 654
is the `timers: { setTimeout, clearTimeout },` line, not the `onFlush` wiring the sentence
describes. **A citation that was already off by one on the day it shipped is the argument:**
any edit above any of those lines silently converts a correct citation into a confident false
claim about a file this repository contains, which is Phase 9's stated defect pattern, and
nothing in the tree goes red when it happens.

Decide once, for the repository, and apply it here: either cite **symbol names** (`AgentManager`'s
coalescer construction, `bootstrap.ts`'s `new AgentManager`, §14.5's bridge-rate bullet) and
delete the numbers, or add a curated guard that resolves each cited `file:line` and fails when
that line no longer contains the named text.

**Prefer the first.** A guard here is a check whose cost is paid every wave to protect prose
that reads fine without numbers, and this repository has twice built a curated guard whose
scope could not see the case it was built for. If you nevertheless build the guard, prove it
fires on a real drifted citation before you trust it, and register nothing whose runner cannot
see the file it guards.

Owns: `packages/server/src/server/agent/agent-stream-coalescer.ts`'s header comment, and — only
if the guard route is chosen — that guard's own `scripts/ci` files. **Comments only in the
coalescer: no behaviour change, no change to the pinned 60.**

- [ ] The chosen policy is stated in the commit, not just applied
- [ ] Every remaining citation resolves to what it claims, checked by running it
- [ ] If a guard is built, a real drifted citation was watched to fail it

#### T240 — Make server test:unit reproducibly green under file parallelism

`labels: phase-9, area: daemon` · `wave: P9-W22` · `depends-on: T225`

`npm run test:unit --workspace=@picompanion/server` produced **three different results in three
consecutive runs** during P9-W7, on the same commit: the implementer reported exit 0; the
verifier got exit 1 with one failure (`hub-cli-contract.test.ts`); the merge gate got exit 1
with four (`terminal-activity-route.test.ts` failing on `EBUSY: resource busy or locked,
rmdir`, plus 30 s timeouts in `github-service.test.ts`, `daemon-executions.test.ts` and
`hub-cli-contract.test.ts`). **Zero assertion failures in any of the three.** All four files
passed together in isolation under `--no-file-parallelism` (`4 passed`, 102 tests, exit 0).

The cause is contention in the parallel lane: subprocess-daemon harnesses and temp-directory
suites race under a hard 30 s `testTimeout`, with Windows file locking on top. The cost is not
theoretical — it consumed a full verifier session that still could not resolve it, and it
makes T225's own acceptance criterion ("`npm run test:unit ...` is all-pass") locally
unsatisfiable as written, which invites the next implementer to report a green they did not
get.

Move the subprocess-harness suites into the existing `test:unit:serial` lane, or raise their
per-test timeout — measure which, do not guess. Whichever is chosen, state in `CLAUDE.md`'s
"Working locally" section whether that criterion means the local command or CI.
**Do not close this by deleting or `skip`-ing a test** — `packages/server/CLAUDE.md` forbids it.

Owns: `packages/server/package.json`'s test scripts and its vitest config, plus `CLAUDE.md`'s
"Working locally" section. No test file's assertions.

- [ ] The same command run three times on one commit gives the same result three times
- [ ] The fix is chosen from a measurement of which suites actually contend, not by guess
- [ ] No test is deleted or skipped, and no timeout is raised without saying why here

#### T241 — Correct the log bridge fixture's virtualized-log description

`labels: phase-9, area: protocol` · `wave: P9-W23` · `depends-on: T226`

`packages/protocol/src/fixtures/pi-ui-bridge/log.json`'s `description` reads "Streaming lines
shown as a virtualized log." T226 decided the opposite and recorded it in `plan.md` §14.5 and
§11.3: the `log` element is tail-capped to 200 mounted lines on both platforms, explicitly
**not** a scrolling render-window virtualization. The fixture lives in a package T226's `Owns:`
line does not cover, so it was correctly left alone and is genuinely ownerless.

Low risk and small: it is a human-readable description string, not a capability claim, and
nothing reads it as behaviour. It is filed because it is the wire-adjacent description of the
very element whose mechanism was just decided, and because a fixture is where the next reader
goes to learn what a kind means.

**Check the whole fixture directory while you are there**, not only this one file — and check
whether any test asserts on this string before you change it. If one does, update it in the
same commit; if none does, say so rather than adding a test to justify the edit.

Owns: `packages/protocol/src/fixtures/pi-ui-bridge/`. Nothing else.

- [ ] The description matches what both renderers actually do
- [ ] Any test asserting the old string is updated in the same commit
- [ ] The rest of the fixture directory was checked for the same premise, and the result stated

#### T242 — Rule on superseded mechanism names in reference-only docs

`labels: phase-9, area: docs` · `wave: P9-W24` · `depends-on: T226`

`docs/pi-extension-compatibility.md`'s `log` row still names "virtualized log / tail-following
list" — the two-mechanism split T226 retired. `CLAUDE.md` lists that file as reference-only:
historical material describing Paseo's behaviour, never this product's specification, and
correctly untouched by T226.

**The tension is that the same file is now load-bearing.** Both renderers' new doc comments
cite §3.3 of it as the authority for the `loop` extension tailing its log at 200 in practice —
which is the empirical half of T226's decision. So a document ruled reference-only is being
cited as current evidence in shipped source, while one of its own rows names a mechanism this
product has rejected. Both cannot be right about what the file is for.

Decide the policy once and write it in `CLAUDE.md`'s reference-only section: either these
documents may be annotated where a later decision supersedes them (and add the annotation
here), or they are frozen and shipped source must not cite them as current evidence (and the
two renderer comments must re-derive that fact from somewhere citable). **Do not silently edit
the row** — a reference-only document quietly updated is worse than one openly annotated,
because the next reader cannot tell which parts are still Paseo's and which are ours.

Owns: `CLAUDE.md`'s reference-only-documents section, and — only if the annotate route is
chosen — `docs/pi-extension-compatibility.md`'s `log` row.

- [ ] The policy is stated in `CLAUDE.md`, not just applied to this one row
- [ ] The two renderer comments' citation of §3.3 is consistent with whichever rule is chosen
- [ ] No reference-only document is edited without the edit being marked as an annotation

#### T243 — Close the archive/snapshot interleaving that drops archivedAt

`labels: phase-9, area: daemon` · `wave: P9-W25` · `depends-on: none`

**This turned `main` red.** CI run `34119345005` at `4c9aabd` failed
`server-tests (windows-latest)` on one test of 247:
`src/server/hub/execution-session.websocket.test.ts` > "Hub archives a running execution's
Paseo-created worktree", with
`AssertionError: expected { requestId: 'archive-worktree', ... } to match object
{ success: true, error: null, ... }` and the received value carrying
`error: "Agent missing archivedAt after archive: <id>"`. Re-running that job on the identical
commit passed, and the commit under test touched only `apps/web`, `apps/android`, `plan.md`,
`docs/` and one `scripts/ci` guard — no `packages/server` file. So it is timing-sensitive, and
it is not the wave's.

**It is not a flake in the test, though — there is a mechanism, and it is in shipped code.**
`lifecycle-command.ts`'s archive path throws that message when `agentStorage.get()` returns a
record with no `archivedAt` after `agentManager.archiveAgent()` returned. Inside
`archiveAgent`, `markRecordArchived` upserts the record WITH `archivedAt`, and only then
`closeAgent` runs, which reaches `persistSnapshot` → `AgentStorage.applySnapshot`.

`applySnapshot` already knows about this hazard and guards it — its own comment says
`archivedAt` is not part of the `ManagedAgent` snapshot, so a naive projection would wipe it,
and it copies `existing.archivedAt` onto the new record. **That guard covers the sequential
case only.** `applySnapshot` is a read-modify-write (`waitForPendingWrite` → `get` → build →
`upsert`), so a CONCURRENT `applySnapshot` that captured `existing` BEFORE
`markRecordArchived`'s upsert writes back a record with no `archivedAt`, undoing it. This test
archives a still-RUNNING agent (`prompt: "sleep 30"`), which is exactly what supplies the
concurrent writer; on an unloaded machine the interleaving does not happen.

**Do not fix this by making the test wait, retry, or poll for `archivedAt`.** That hides a
real last-write-wins window behind a slower test, and the daemon has the same window in
production whenever an agent is archived while it is still streaming.

Establish the interleaving first — a deterministic test that interposes a concurrent
`applySnapshot` around the archived upsert should fail before any fix and pass after. Then
close the window itself: serialise per-agent writes so a read-modify-write cannot straddle
another write, or make `archivedAt` a field the snapshot projection cannot clear rather than
one it re-copies. Whichever is chosen, say why the other was not.

Owns: `packages/server/src/server/agent/agent-storage.ts`,
`packages/server/src/server/agent/agent-manager.ts`'s archive and close paths, and their
tests.

- [ ] A test reproduces the interleaving deterministically, and was watched to fail first
- [ ] The fix closes the write window, rather than making the caller retry or wait
- [ ] The rejected alternative is named, with the reason

#### T244 — Replace the four hand-rolled comment strippers with one tokenizer

`labels: phase-9, area: tooling` · `wave: P9-W26` · `depends-on: T227`

Four guards each hand-roll comment stripping with two regexes, and **each order silently
corrupts source under the opposite collision**:

```js
source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // line-first
```

`guard-declared-root-dependencies.mjs` strips line-first; `guard-capability-prose.mjs`,
`guard-no-node-builtin-in-web-bundle.mjs` and `guard-no-duplicate-permission-state.mjs`
strip block-first. Line-first blanks a `//` that appears INSIDE a block comment, destroying
that block's `*/`, so the block pass runs on to the next `*/` and swallows whatever lies
between. Block-first has the mirror failure on a `/*` inside a line comment.

**Measured at the P9-W9 merge gate, on the shipped function, not argued from the regex.**
Adding one legitimate JSDoc line containing `//` above
`run-guard-web-session-bundle-budget.mjs`'s real `vite` import took
`extractImportSpecifiers` from `["vite"]` to `[]` — the guard went blind to its own
motivating case — while the runner stayed at exit 0 and its whole test file stayed green. A
comment-only edit, no code touched. That gate repaired the one assertion that can now catch
it for this guard; the other three carry the mirror hazard with nothing pinning them.

Write one shared stripper as a character state machine that tracks string literals, template
literals and both comment kinds, and have all four guards use it. Such a stripper has neither
collision; one written at that gate agreed with the shipped line-first guard on every real
specifier across all its production files.

**The acceptance criterion that matters is the pin, not the stripper.** A shared correct
stripper with no test that would notice it regressing just moves the same silence somewhere
central. Feed every real production file through it and assert that each file whose raw text
contains a real import still yields at least one specifier — the check that was missing when
this was found.

Owns: the four guards' stripping functions, whatever module the shared stripper lands in, and
those guards' tests. **No change to what any guard reports** — if a guard's findings move,
that is a finding to report, not to absorb.

- [ ] Both collisions are proven to fail before the fix and pass after, on real files
- [ ] Every file with a real import still yields a specifier, asserted per file
- [ ] No guard's set of reported violations changes, and that is shown rather than assumed

#### T246 — Decide whether isShippedSourcePath should see app-root config files

`labels: phase-9, area: tooling` · `wave: P9-W27` · `depends-on: T228`

**Measured at the P9-A merge gate by executing the real exported predicates, not by
reading a scope list:**

```
apps/android/app.config.ts          isAppSourcePath=false  isShippedSourcePath=false
docs/android-apk-release.md         isAppSourcePath=true   isShippedSourcePath=false
docs/clean-install-and-rollback.md  isAppSourcePath=true   isShippedSourcePath=false
```

T235 shipped `computeVersionCodeFromSemver` in `apps/android/app.config.ts` and
falsified two runbooks that asserted the capability was absent — the T124 shape
`guard-capability-prose.mjs` exists to catch. It could not catch it, and would not catch
the next one. `isShippedSourcePath` requires `<pkg-or-app>/src/` or `scripts/ci`, and
`app.config.ts` sits at the app ROOT, outside `src/`.

**The asymmetry is the whole point.** The DENIAL side already works: both stale docs are
in scope. Only the shipping side is blind. So an entry registered today would exit 0
forever no matter how false the docs became — item ten of the check-that-cannot-fail
catalogue, an entry in a curated list whose runner's scope can never see the case.
**Do not register the entry without the widening.**

Either widen `SHIPPED_SRC_PATTERN` to admit `apps/*/app.config.ts` and THEN register
the entry, proving it fires before trusting it, or record a will-not-widen decision
saying app-root config declares no capability worth protecting — so the next gate does
not re-propose an inert entry. Whichever is chosen, say why the other was rejected.

If you widen: `app.config.ts` is a config file that Expo evaluates, so check what else
the widened pattern admits before you trust it, and what the orphan-module and
capability scans do with those files.

Owns: `scripts/ci/run-guard-capability-prose.mjs`, `scripts/ci/guard-capability-prose.mjs`,
its test, and `CLAUDE.md`'s T124 section. **Nothing else.**

- [ ] The predicates are executed on the real paths, and the output is quoted
- [ ] If widened, the entry is watched firing before it is trusted
- [ ] If not widened, the refusal is written down where the next gate will read it

#### T247 — Fail an Android release whose tag disagrees with app.config.ts version

`labels: phase-9, area: ci` · `wave: P9-W28` · `depends-on: T235`

T235 derives `android.versionCode` from `apps/android/app.config.ts`'s own semver
`version`, which fixes the second-install collision for any two releases that declare
different versions. **It does not make anyone bump `version`.** Tagging `v0.2.0` while
the file still says `0.1.0` rebuilds the previous `versionCode`, and the device refuses
it with `INSTALL_FAILED_VERSION_DOWNGRADE` — the original defect, reached by a
different route. T235's own in-file decision record names this as the one gap it leaves.

Fail the build instead. A step in `.github/workflows/android-apk-release.yml`'s
`publish-android-apk` job that strips the tag's `v`/`android-v` prefix and compares it
with the `version` the config declares, failing loudly when they differ.

**The constraint T235 recorded, and the reason a naive fix does not work: the check must
run on the GitHub runner.** EAS evaluates `app.config.ts` on its own build machine and
never sees the runner's shell environment, so nothing inside `app.config.ts` can read
`RELEASE_TAG` — which is also why T235 derived from `version` rather than from the tag
in the first place. Read that decision record before choosing an approach.

Decide whether the comparison belongs inline in the workflow or in a `scripts/ci` guard
with its own test. A guard is testable here; an inline step is not. Say which and why.

Owns: `.github/workflows/android-apk-release.yml` and any new `scripts/ci` guard it
calls, plus that guard's test. **Not `app.config.ts`** — if the fix needs a change
there, that is a finding to report, not to make.

- [ ] A tag/version mismatch fails the job, watched failing on a real mismatch
- [ ] A matching pair passes, watched passing
- [ ] The prefix handling covers every tag shape the workflow actually triggers on
- [ ] The runner-versus-EAS-machine constraint is stated in whatever ships

#### T248 — Apply T237's measurement to guard-secret-scan's binary skip list

`labels: phase-9, area: tooling` · `wave: P9-W29` · `depends-on: T237`

T237 removed `run-guard-signing-material.mjs`'s `SKIP_CONTENT_READ_EXTENSIONS` after measuring
that no extension in it was safe to skip. `run-guard-secret-scan.mjs` still has the equivalent
set, and still carries the premise T237 disproved.

**Measured at the P9-B merge gate, not assumed.** `run-guard-secret-scan.mjs` reports
`2465 of 2489 tracked files scanned` — 24 tracked files are skipped by extension today
(8 `.png`, 8 `.ttf`, 8 `.woff2`; no `.zip`/`.jar`/`.pdf` is currently tracked). Its
`catch { continue; // Not decodable as UTF-8 — treat as binary… }` rests on the same claim the
gate corrected next door: `readFileSync(path, "utf8")` **does not throw** on invalid UTF-8, so
that `catch` does not fire for the reason its comment gives. A 2056-byte file carrying the real
JKS magic FE ED FE ED and deliberately invalid UTF-8 decoded to 2056 characters with
`threw = false`.

T237's own brief said "Consider whether `guard-secret-scan.mjs` deserves the same treatment in
the same wave", and its commit body recommends this follow-up explicitly. It was out of scope
there: the file is in no `Owns` line of that wave.

Decide, and record the decision either way. Removing the set is not automatically right — the
argument that carried for the signing guard was that its extensions could hide a PEM block, and
the trade is read cost against coverage. Measure the real cost on the 24 files (the largest is
`apps/android/assets/fonts/Inter-700.ttf` at 344,072 bytes) rather than estimating it, and say
what the skip is actually buying. If the set stays, the `catch`'s comment must still be
corrected: it currently explains itself with a mechanism that does not happen.

Whatever ships must be proven the way T237's was — a CLI-level test with real files on disk, and
a watched firing on a file under a formerly-skipped extension. Never write a contiguous PEM
header literal into any file; assemble it at runtime, as T237's test does.

Owns: `scripts/ci/guard-secret-scan.mjs`, `scripts/ci/run-guard-secret-scan.mjs`, their test.

- [x] The real read cost of the skipped files is measured, not estimated
- [x] The decision is recorded with the argument for the option not taken
- [x] If the set is kept, the `catch`'s stated mechanism is corrected — N/A: the set was
      removed, not kept, so the false `catch` narrative is gone rather than corrected in place
- [x] A file under a formerly-skipped extension is watched being caught, at CLI level

#### T249 — Register readContentIfWorthwhile in CAPABILITIES

`labels: phase-9, area: tooling` · `wave: P9-W30` · `depends-on: T237, T232`

T237 shipped a capability — `readContentIfWorthwhile`, newly exported from
`run-guard-signing-material.mjs` and declared in exactly one file — and registered nothing in
`guard-capability-prose.mjs`'s `CAPABILITIES`. This is the same omission class T232 closed for
somebody else **one commit earlier in the same wave**. `isShippedSourcePath` on that path
returns `true`, executed at the gate, so an entry would not be inert.

**An entry would have caught the wave's headline finding.** Two of the three false-premise sites
the P9-B gate corrected — `guard-signing-material.mjs`'s pointer to a skip list that no longer
exists, and `docs/android-apk-release.md` §2.2's "would not have helped" — are exactly the shape
a denying phrase catches, and both were live on `main` at `4c60f18`.

That creates an ordering problem this task must handle deliberately: **the gate has since fixed
all three sites**, so the live cases are gone. Do not treat their absence as evidence the entry
is unnecessary. Prove the entry fires the way T232's was proven — restore one corrected sentence
into a real tracked in-scope file from a scratchpad copy, watch
`run-guard-capability-prose.mjs` exit 1 naming this capability, then restore. Never
`git checkout --`.

Word the phrases away from the guard's own header narration, which now discusses the skip list's
removal at length in past tense. Compare DE-WRAPPED — strip `//` gutters and collapse whitespace
— because today's line wrapping is not protection. A single non-group member is enough:
`readContentIfWorthwhile` is a real function name, uniquely declared, not a string literal the
comment stripper erases.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test. **Do not restate any COUNT in
`CLAUDE.md`**, and do not touch the three sites the gate corrected.

- [ ] The entry is watched firing, against real committed content, before it is trusted
- [ ] The phrases are checked de-wrapped against the guard's own historical narration
- [ ] `run-guard-capability-prose.mjs` exits 0 on the real tree afterward, tree clean

#### T250 — Make test:integration wire-able or retire its dead auth helpers

`labels: phase-9, area: server` · `wave: P9-W31` · `depends-on: T233`

T233 kept `@picompanion/server`'s `test:integration` unwired and committed a reason, in
`.github/workflows/ci.yml` and `docs/ci-matrix.md`, that the P9-C merge gate disproved twice
over: by call graph (`createDaemonTestContext` never reaches `seedClaudeAuth`) and by execution
(with both credential variables unset, `model-catalog.e2e.test.ts` fails with
`AssertionError: expected 'Unknown provider: claude' to be null`, not a credentials error). The
gate corrected the prose; it did not find the real answer, because that is a server
investigation and no `Owns` line in the wave covered it.

Two things fall out of the same measurement, and both belong to whoever picks this up:

1. **Why does the fake-client test daemon answer `Unknown provider: claude`?** The error is
   raised in `packages/server/src/server/session/provider/provider-catalog-session.ts`
   when no provider snapshot entry exists for the requested provider, yet the daemon is built
   from `createTestAgentClients()` fakes whose `fetchCatalog` returns a hard-coded Claude
   catalog of exactly the variants the test asserts. Either the snapshot is never populated
   from those fakes, the test daemon's provider list is empty by construction, or the e2e
   suite predates a catalog-session refactor. Measure which, by reading the path from
   `createTestPaseoDaemon` to the snapshot — then either fix the suite so it passes against
   the fakes, or record why it cannot and what it would need. Only after that is "wire it"
   a decision anyone can make.
2. **`seedClaudeAuth` (`test-utils/claude-auth.ts`) and its sole caller
   `useTempClaudeConfigDir` (`test-utils/claude-config.ts`) are unreachable.** Zero call
   sites; kept alive only by the `test-utils/index.ts` barrel re-export, which is why
   `run-orphan-modules.mjs` exits 0 — a barrel re-export counts as an importer, a dead-code
   shape that guard is structurally blind to, and precisely what led T233 to believe the
   helper was on the path. Wire them into a real test or delete them. If the guard's
   blindness is worth closing, file it separately; do not widen this task into it.

Run only the targeted files, one at a time, foreground, with a timeout — never the whole
`test:integration` script. The test daemon binds `127.0.0.1:0`; still confirm nothing on this
path can touch 6767 or 6768 before running anything.

Owns: `packages/server/src/server/test-utils/claude-auth.ts`,
`packages/server/src/server/test-utils/claude-config.ts`,
`packages/server/src/server/test-utils/index.ts`, the three `*.e2e.test.ts` files
`test:integration` runs and whatever under `packages/server/src/server/session/provider/`
the measurement names, plus the T233 paragraphs in `.github/workflows/ci.yml` and
`docs/ci-matrix.md` (to record the answer, not to re-litigate the correction).

- [ ] The `Unknown provider` cause is measured by reading the daemon-to-snapshot path, not guessed
- [ ] The suite either passes against the fakes locally, or the doc says exactly what it needs
- [ ] `seedClaudeAuth`/`useTempClaudeConfigDir` are either called by a real test or deleted
- [ ] The `ci.yml` and `docs/ci-matrix.md` paragraphs record the measured answer

#### T251 — Extend guard-declared-workspace-deps to packages/relay

`labels: phase-9, area: tooling` · `wave: P9-W32` · `depends-on: T230, T227`

T230 decided the relay must keep its own `CURRENT_RELAY_VERSION` rather than import
`CURRENT_RELAY_PROTOCOL_VERSION` from `@picompanion/protocol`, and one of its stated reasons
was that `scripts/ci/guard-declared-workspace-deps.mjs` walks only `apps/android/src` and
`apps/web/src` (its own `srcDir` entries), so an undeclared `packages/relay` →
`packages/protocol` import would resolve through the workspace symlink locally, pass every
guard, and only fail on a fresh `npm ci` checkout — the exact shape T194 shipped and T227
closed for the root manifest. Nothing owns closing that gap for `packages/*`.

Extend the guard's walk to `packages/relay/src` at minimum, and measure whether every
`packages/*/src` can be admitted at once: some packages legitimately import siblings they
declare (`server` → `protocol`), and the guard must read each package's own `package.json`
`dependencies` rather than the root's. Prove it fires — add an undeclared cross-workspace
import to a scratch copy of a relay file, watch the runner exit 1 naming the package,
restore from the scratchpad copy (never `git checkout --`), exit 0, `git status --porcelain`
empty. Register the widened capability in `guard-capability-prose.mjs`'s `CAPABILITIES` in
the same commit, and grep for prose asserting the guard "does not scan `packages/relay`"
before landing (T230's own doc says it today, and this task falsifies that sentence).

Owns: `scripts/ci/guard-declared-workspace-deps.mjs`, its runner and test,
`scripts/ci/guard-capability-prose.mjs` (the one new entry), and the sentence in
`docs/security-and-version-drift.md` that names the gap.

- [ ] `packages/relay/src` is walked, and the decision on the rest of `packages/*/src` is recorded
- [ ] A watched firing on an undeclared relay import, at CLI level, restored from a scratchpad copy
- [ ] The `CAPABILITIES` entry is proven to fire before it is trusted
- [ ] T230's "does not scan `packages/relay`" sentence is corrected in the same commit

#### T252 — Migrate the last two scripts/ci comment strippers to the shared tokenizer

`labels: phase-9, area: tooling` · `wave: P9-W33` · `depends-on: T244`

T244 replaced four hand-rolled `stripComments` regex pairs with
`scripts/ci/source-comment-stripper.mjs`, after proving both orderings collide: line-first
eats a block comment's own `*/`, block-first eats real code that follows a `//` comment
containing `/*`-shaped text. Two more copies were not in its `Owns:` line and still use the
**block-first** order T244 proved defective:

- `scripts/ci/orphan-modules.mjs:85` (`export function stripComments`)
- `scripts/ci/guard-no-legacy-schema-reader.mjs:119`, plus that file's verbatim copy of
  `guard-capability-prose.mjs`'s `stripStringLiterals`/`STRING_LITERAL_TO_ERASE`/
  `stripCommentsAndStrings` trio — the exact shape T244 just fixed next door.

**Measured at the P9-D merge gate, against the real shipped `extractSpecifiers`**, not
asserted: ten tracked files yield a different specifier set under `orphan-modules.mjs`'s
stripper than under the correct tokenizer. Four lose a real static import edge, including
T244's own new module:

```
guard-capability-prose.mjs              MISSED ["./source-comment-stripper.mjs"]
run-guard-declared-workspace-deps.mjs   MISSED [..., "./guard-declared-workspace-deps.mjs"]
run-guard-format-check-per-commit.mjs   MISSED [..., "./guard-format-check-per-commit.mjs"]
run-guard-web-session-bundle-budget.mjs MISSED [..., "vite", "./guard-web-session-bundle-budget.mjs"]
```

**The consequence is latent, not firing, and this task must be justified as correctness
rather than as a count change.** `CONVENTION_ENTRY_DIR_SEGMENTS` (line 143) contains
`"scripts"`, so every `scripts/ci/*` file is an entry point regardless of its in-edges, and
a lost edge cannot orphan anything today. The orphan count 26/26 is **not** inflated —
verified by running the runner at this wave's base and at its tip. The risk is that
`orphan-modules.mjs` is the engine behind the ceiling gate and its own doc comment already
concedes it is "not a full tokenizer"; the first module placed outside a convention entry
directory inherits the defect silently. For `guard-no-legacy-schema-reader.mjs`, the P9-D
gate measured 97 files inside its own scan scope producing different cleaned text under
block-first — its verdict is OK today, so nothing is currently hidden, but a real legacy
schema reader sitting in a swallowed span would be invisible.

Prove each migration the way T244 did: pin a per-file case that the old order destroys and
the tokenizer preserves, then mutate the module back to the old pair and watch the new tests
fail, restoring from a scratchpad copy (never `git checkout --`) and confirming
`git status --porcelain` empty. Neither guard's verdict may move, and the orphan ceiling
must stay at or below its committed value.

Owns: `scripts/ci/orphan-modules.mjs`, `scripts/ci/guard-no-legacy-schema-reader.mjs`, and
both files' tests.

- [ ] Both files import the shared tokenizer; no hand-rolled `stripComments` remains in `scripts/ci` outside `guard-capability-prose.mjs`'s thin wrapper
- [ ] The ten-file specifier-set divergence measured above goes to zero
- [ ] Each migration carries a per-file pin the old order fails and the tokenizer passes, proven by mutation
- [ ] `run-orphan-modules.mjs` and `run-guard-no-legacy-schema-reader.mjs` report the same verdict before and after

#### T253 — Re-derive shipped source's citations of reference-only documents

`labels: phase-9, area: docs` · `wave: P9-W34` · `depends-on: T242`

T242 ruled that reference-only documents are frozen, and added the corollary to `CLAUDE.md`:
**never cite one as authority for a current product fact or decision** — a code comment
justifying today's behaviour by pointing at one is a defect the moment it does so, and the
fix is to restate the fact in `plan.md` and cite that instead. T242's `Owns:` line covered
`CLAUDE.md` only, so the corollary landed with the tree still violating it.

**Measured at the P9-D merge gate:** 19 non-test files under `apps/*/src` and
`packages/*/src` cite a reference-only document. The gate fixed the two the T242 checklist
names by name — `apps/android/src/features/extensions/renderers/log-model.ts` and
`apps/web/src/features/extensions/renderers/log.tsx`, both of which cited
`docs/pi-extension-compatibility.md` §3.3 for the `loop` extension's tail-200 behaviour, a
fact `plan.md` §14.5 already states in its own words ("a bound already met on the wire, not
a target to grow toward"). The remaining 17 need judgement this task owns.

**Not every citation is a violation, and the task must sort them rather than sweep them.**
The corollary bans citing a reference-only file as _authority for a current fact or
decision_; it explicitly still permits reading these files for behaviour. A fixture whose
comment says it is _modelled on_ the Phase 0 re-audit is recording provenance — where the
fixture came from — which is exactly what the audit is for. The sharpest violations are the
ones naming a reference-only file as the decision record itself, of which
`packages/server/src/server/agent/providers/pi/rpc-types.ts` carries three, e.g. line 294:
"See `docs/pi-extension-compatibility.md`'s `get_tree` row for the decision record."

Those three have **no citable home yet**. Unlike the renderers, there is no `plan.md`
sentence to point at — the decision (restore `get_tree` only with a real caller in the same
commit; the two disclosed `sourceInfo`/`since` drifts) exists only inside the audit. So this
task's real work is to write those decisions into `plan.md` first, then repoint the
comments. Do not repoint a comment at a `plan.md` section that does not yet say the thing.

Owns: the 19 files the grep below lists, and whichever `plan.md` sections gain the restated
facts.

```bash
git ls-files 'apps/*/src/**' 'packages/*/src/**' | grep -E '\.(ts|tsx|js|jsx|mjs)$' \
  | grep -v '\.test\.' | xargs grep -l -E \
  'pi-extension-compatibility\.md|frontend-data-migration\.md|T0[234]-provenance\.md'
```

- [x] Every remaining citation is classified as provenance (kept) or authority (repointed), with the classification recorded (T261: the test and the kept-citation list live in `CLAUDE.md`'s reference-only section)
- [x] `rpc-types.ts`'s three "decision record" citations point at `plan.md`, and `plan.md` states those decisions before the repoint lands (verified at T267: lines 208, 266 and 293 cite `plan.md` §4.2 "Pi RPC command mirror drift disclosure", and `plan.md:308` carries that heading)
- [ ] No reference-only document is edited (T242's frozen rule still binds)
- [x] Any test asserting a repointed comment string is updated in the same commit (verified at T267: `grep -rn` across `packages/server/src` and `apps` for the old `get_tree`/decision-record phrasing found no test pinning it; `rpc-types.test.ts` and `rpc-types.pi-mirror.contract.test.ts` assert `PiRpcCommand`'s shape, never the disclosure comments' text)

#### T254 — Decide whether isAppSourcePath should admit apps/\*/app.config.ts

`labels: phase-9, area: tooling` · `wave: P9-W35` · `depends-on: T246, T247`

T246 widened `run-guard-capability-prose.mjs`'s **`isShippedSourcePath`** with
`APP_ROOT_CONFIG_PATTERN = /^apps\/[^/]+\/app\.config\.ts$/`, so a capability declared in an
app-root config file can finally count as shipped. It deliberately did not touch
**`isAppSourcePath`**, the denial-scan side. Measured at the P9-E merge gate by calling both
exported predicates, not by reading the regex:

```
apps/android/app.config.ts   isAppSourcePath=false   isShippedSourcePath=true
```

**The consequence is concrete, and this wave produced an instance of it.** That file can now
_declare_ a capability but can never be caught _denying_ one — including a denial of the
capability it is itself about. T247 shipped `checkAndroidReleaseTagVersion`, and
`app.config.ts`'s own decision record carried a live "GAP FILED … nothing enforces that a
human actually bumps `version` before pushing a new release tag" block describing exactly the
step T247 had just shipped. The two sibling runbooks carried the same claim and are both in
`isAppSourcePath`'s scope; only this one was invisible. The gate corrected the block by hand
(it is now a `GAP CLOSED by T247 (P9-E)` note) and registered T247's capability, whose entry
comment records the asymmetry and points here.

Decide it once and write the decision where the next gate reads it. Admitting the pattern on
the denial side is the obvious symmetry, but it is not free and must be measured, not
assumed: `app.config.ts` is a long, deliberately narrative decision record, and the P9-E gate
already found one place where the two sides interact — T246's own entry comment reasons about
avoiding a phrase collision with that file's prose, a collision that is impossible **today
only because** `isAppSourcePath` returns `false` for it. Widening makes that reasoning
load-bearing rather than hypothetical, so every registered entry's phrases must be re-checked
against the real file before the widening lands. A refusal is a legitimate outcome if it is
written down with its reason; what is not acceptable is leaving the asymmetry undocumented in
the predicate itself.

Owns: `scripts/ci/run-guard-capability-prose.mjs`, its test, and — if the decision is to
widen — `apps/android/app.config.ts` only to the extent any real collision requires. No wave
P9-E task owned `app.config.ts`, which is why its now-closed gap block sat uncorrected until
the gate.

- [ ] The decision is recorded next to `isAppSourcePath`, naming which of the two predicates admits `apps/*/app.config.ts` and why
- [ ] If widened: every existing `CAPABILITIES` entry's phrases are re-run against the real `app.config.ts`, and the guard still exits 0
- [ ] If widened: a firing is watched on a scratchpad-restored copy of that file, then restored, `git status --porcelain` empty
- [ ] If refused: the reason is written where a future gate re-proposing the widening will read it first

#### T255 — Pin the Android release-tag guard's shapes to the workflow's own trigger

`labels: phase-9, area: tooling` · `wave: P9-W36` · `depends-on: T247`

T247's `RELEASE_TAG_PREFIXES = ["android-v", "v"]` must cover every tag shape
`.github/workflows/android-apk-release.yml`'s `push: tags:` trigger fires on, or a real
release fails `unrecognized-tag-shape` for a tag CI itself accepted. The set is correct
today — the P9-E gate derived it from the real trigger block (`["v*", "android-v*"]`) and
watched every shape run — but **nothing in the repository pins the two together.**

Measured at that gate: `.github/workflows/android-apk-release.yml` appears twice in
`scripts/ci/guard-android-release-tag-version.test.mjs`, and **both occurrences are inside
`test(...)` titles** — the file is never read. Two tests are titled "…the 'v' prefix
`android-apk-release.yml`'s push trigger fires on" while asserting only against the guard's
own hardcoded constant. That is this repository's recurring "a check that passes for a
different reason than its title claims" shape, one level down: the titles promise agreement
with the workflow and deliver agreement with a literal.

It fails closed, so this is drift risk rather than a false pass — an uncovered shape is
rejected loudly, not silently released. But adding a third glob to the trigger (a
`release-*` convention, say) would make every such tag fail the guard with nothing noticing
until a release attempt.

Parse the workflow's `push: tags:` globs and assert `RELEASE_TAG_PREFIXES` covers each, so
the test goes red when the trigger grows a shape the guard does not know. Prove the pin
fires: add a third glob to a scratchpad copy of the workflow, watch the test fail naming it,
restore from that copy (never `git checkout --`), confirm green and `git status --porcelain`
empty. While there, retitle the two tests to say what they actually assert if the pin does
not subsume them.

Owns: `scripts/ci/guard-android-release-tag-version.test.mjs`. Not the guard itself and not
the workflow — neither needs to change for the pin to exist.

- [ ] The test reads `.github/workflows/android-apk-release.yml` and derives the shapes from its real `push: tags:` block
- [ ] Every derived shape is asserted covered by `RELEASE_TAG_PREFIXES`, and an added glob makes the test fail
- [ ] The firing is watched against a scratchpad copy and restored, with the tree clean afterward
- [ ] No test title claims agreement with the workflow that the test does not actually check

#### T256 — Re-scope source-comment-stripper's "four guards" safety claim to its seven callers

`labels: phase-9, area: tooling` · `wave: P9-W37` · `depends-on: T252`

`scripts/ci/source-comment-stripper.mjs` line 141 reads: _"no production file scanned by any of
the four guards contains a genuinely ambiguous case (checked as part of this task's before/after
diff on every real file each guard scans, not assumed)"._

**That is a safety claim, not a headcount.** It records a regex-vs-division ambiguity
verification whose stated coverage is four guards' scan scopes. The module now has **seven**
callers:

```
guard-android-release-tag-version    guard-capability-prose
guard-declared-root-dependencies     guard-no-duplicate-permission-state
guard-no-legacy-schema-reader        guard-no-node-builtin-in-web-bundle
orphan-modules
```

`git log -S` places the fifth caller at `9952651` (**T247, wave P9-E**), so the sentence was
already stale before P9-F; T252 made it stale by three. T252 disclosed the headcount but
characterised it as "a minor undercount, not a false safety claim". It is a safety claim.

**The scope that actually matters is `orphan-modules.mjs`.** It walks **every tracked module
file** — roughly 2,247 of them — which is far wider than anything T244's before/after diff
covered. The other two additions are narrow by comparison.

Either re-run the ambiguity check across the three scopes added since T244 and update the
sentence to say seven, or re-scope the sentence to name only the coverage that was actually
verified and state plainly that later callers inherit the tokenizer without inheriting that
verification. **Do not simply change "four" to "seven"** — that would assert a verification
nobody performed, which is worse than the stale number.

Owns: `scripts/ci/source-comment-stripper.mjs` and its test.

- [ ] The sentence names a coverage that was actually measured, and says which
- [ ] If re-run: the method is stated and `orphan-modules.mjs`'s whole-tree scope is included
- [ ] If re-scoped: the sentence says explicitly that later callers do not inherit the check
- [ ] No caller count is restated anywhere it will go stale again on the next caller

#### T257 — Make guard-dockerignore-depth's verdict mean the same thing locally and in CI

`labels: phase-9, area: tooling` · `wave: P9-W38` · `depends-on: none`

`scripts/ci/run-guard-dockerignore-depth.mjs` walks the **real disk** for nested occurrences of
each `.dockerignore` pattern, and does not exclude `.gitignore`d paths. Every merge gate that
runs the full runner sweep therefore sees it red locally and has to prove the failure is noise.

Measured at the P9-F gate, on one commit:

| Where                             | Nested occurrences found                                         | Verdict                 |
| --------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| Live working tree at `e179341`    | `.github, node_modules, *.tsbuildinfo, dist, .tmp, test-results` | **exit 1** on `".tmp/"` |
| Clean `git worktree` of `e179341` | `.github`                                                        | **exit 0**              |

`ci.yml` runs it after `checkout` + `setup-node` with **no** `npm ci`, so CI always sees a clean
disk and always passes. This is the mirror image of the stale-`dist` trap `CLAUDE.md` warns
about — there, local green hid CI red; here, local red hides nothing but costs every gate the
time to re-derive it.

Either filter the disk walk by `.gitignore` (so the local verdict means what the CI verdict
means), or — if walking untracked state is deliberate, which is arguable, since a developer's
own `.dockerignore` mistakes are worth catching — state in the guard's header that its local
verdict is only meaningful on a clean checkout, and that CI's is authoritative. Whichever is
chosen, the standing "expected local failure" list every gate carries should shrink by one.

Owns: `scripts/ci/guard-dockerignore-depth.mjs`, `scripts/ci/run-guard-dockerignore-depth.mjs`,
their test.

- [ ] The guard's local and CI verdicts agree on a clean checkout, or the header says why they cannot
- [ ] The `.tmp`/`dist`/`test-results`/`node_modules` false family no longer fires from ignored paths
- [ ] A real `.dockerignore` depth defect is still caught — watched firing, restored from a scratchpad copy
- [ ] No gate needs to carry this runner as an expected local failure any more

#### T258 — Decide test:integration's three e2e files under a Pi-only provider registry

`labels: phase-9, area: server` · `wave: P9-W39` · `depends-on: T250`

T250 measured the `Unknown provider: claude` cause end to end and the P9-F gate re-derived every
link independently. The chain is not a bug in the test harness; it is the product's own scope
asserting itself:

- `packages/protocol/src/provider-manifest.ts:38` — `AGENT_PROVIDER_DEFINITIONS` has exactly one
  entry, `id: "pi"`; `DEV_AGENT_PROVIDER_DEFINITIONS` is `[]`.
- `provider-snapshot-manager.ts:443` `buildRegistry()` — `const definition = registry[provider];
if (!definition) continue;` silently drops every `extraClients` fake whose id is not already a
  builtin key.
- `fake-agent-client.ts:1269` `createTestAgentClients()` returns `claude` / `codex` / `opencode`
  — none a key in a Pi-only registry, so all three are discarded.
- `resolveRefreshProviders` (`:908`) intersects the request against `getProviderIds()` =
  `["pi"]`, yielding `[]`.
- `warmUpSnapshotForCwd` (`:240`) — `if (options.providers && providers?.length === 0) return;`
  returns before `refreshProviders`, so the snapshot entry stays `undefined`.
- `provider-catalog-session.ts:187`/`:242` emit `Unknown provider: ${msg.provider}`.

`plan.md` line 99 says "a Pi-only daemon and provider" and line 174 lists non-Pi agent providers
under non-goals. So the three e2e files assert against providers this product deliberately does
not have.

**T250 correctly refused to decide this** — it is a product-scope call, not a test fix, and its
`Owns` line did not cover the manifest. The two options are not equivalent:

1. **Reintroduce non-Pi providers into `AGENT_PROVIDER_DEFINITIONS`** (or into
   `DEV_AGENT_PROVIDER_DEFINITIONS`, which is narrower). This contradicts `plan.md`'s stated
   non-goal and needs `plan.md` amended first, since `plan.md` governs.
2. **Rescope all three e2e files to `"pi"`**, with a Pi fake in `fake-agent-client.ts`. Keeps the
   product scope intact; costs whatever coverage the three files' multi-provider assertions were
   buying, which must be enumerated before it is given up.

Decide, and only then is "wire `test:integration` into CI" a question anyone can answer — that
remains T250's original subject and is still open.

Owns: the three `*.e2e.test.ts` files `test:integration` runs,
`packages/server/src/server/test-utils/fake-agent-client.ts`, and — only under option 1 —
`packages/protocol/src/provider-manifest.ts` and the `plan.md` section that would have to change.

- [x] The decision names which option and why the other lost
- [x] Under option 2, the coverage given up is enumerated before it is given up
- [ ] Under option 1, `plan.md` is amended first, in the same commit or before it
- [x] The three files pass locally, run one at a time in the foreground, with the command and exit code recorded

**Coverage the rescoping to `"pi"` gives up, file by file (recorded at the P9-H merge gate;
T258's `Owns:` line did not include this file, and two committed files were already citing
this entry for it).** Re-derived from `git diff a6ce90f..70581ca` over each file, case by
case, not summarised from a report:

| File                                                 | Cases removed                                                                                                                                                                                                                                   | Rescoped, not lost                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/server/daemon-e2e/models.e2e.test.ts`           | `test.runIf(hasCodex)` — asserts a Codex model list is non-empty and every entry carries `provider === "codex"`, a truthy `id` and a truthy `label`. `test.runIf(hasOpenCode)` — the same three assertions for `provider === "opencode"`.       | `test("returns model list for Claude provider")` → the same shape against `"pi"`, unconditional (no `runIf` gate). |
| `src/server/daemon-e2e/live-preferences.e2e.test.ts` | The `describe.each(["claude", "codex", "opencode"])` matrix collapses to one provider, so the Codex and OpenCode legs of live model switching are gone. `test.runIf(hasCodex)` and `test.runIf(hasOpenCode)` thinking-option switches are gone. | The Claude leg and `test("live thinking switching works for Claude (off -> on)")` → `"pi"`.                        |
| `src/server/agent/model-catalog.e2e.test.ts`         | `test.runIf(hasCodex)` and `test.runIf(hasOpenCode)` catalog-shape cases.                                                                                                                                                                       | `test("Claude catalog exposes Sonnet and Haiku variants")` → the Pi fake's own variants.                           |

**What that costs, stated plainly:** the multi-provider dimension itself. No test now asserts
that the catalog and live-switching paths behave correctly for more than one provider id at a
time, so a regression that hardcodes `"pi"` somewhere in those paths would not be caught here.
Every per-provider assertion shape (non-empty list, `provider` field matching the request,
truthy `id`/`label`, thinking-option on/off) survives against `"pi"`.

**Two qualifications a future reader needs, both measured rather than assumed.**

First, the removed cases were **already failing wherever they ran**, which strengthens option
(b) rather than weakening it: under a Pi-only `AGENT_PROVIDER_DEFINITIONS` every one of them
ends in `Unknown provider: <id>`. The P9-H gate reproduced this by restoring the pre-change
`models.e2e.test.ts` from `git show a6ce90f:` and running it on a machine where `which codex`
and `which opencode` both succeed: the `runIf` gates did **not** skip, and all three legs ran
and failed. So the coverage given up was already zero in practice on any machine that had the
binaries installed, and self-skipped on any machine that did not.

Second, `test:integration` remains unwired into CI. That was T250's subject and is still open;
nothing in T258 or this note decides it.

#### T259 — Widen T251's capability entry to the apps-only framing it misses

`labels: phase-9, area: tooling` · `wave: P9-W40` · `depends-on: T251`

T251 registered `discoverPackageTargets` in `CAPABILITIES` and the entry **does** fire — the
P9-G gate watched it, twice, against the real pre-T251 sentence. But its phrases are calibrated
to the one sentence it was written against rather than to the capability it names.

Six phrasings run through the real `findCapabilityDenialViolations` at that gate:

| Denial phrasing                                                     | Result     |
| ------------------------------------------------------------------- | ---------- |
| the exact sentence T251 fixed                                       | CAUGHT     |
| `packages/server` swapped for `relay`                               | CAUGHT     |
| "walks only apps/android and apps/web, so packages are not checked" | **MISSED** |
| "does not scan `packages/*/src` … never caught"                     | **MISSED** |
| "The relay package is not covered by the guard today"               | **MISSED** |
| "that guard does not scan packages today"                           | **MISSED** |

**The apps-only framing is the most likely future denial**, because it is how the guard's own
scope was described for its whole life before T251 — every reader who learned this guard before
this wave carries that sentence. An entry that catches only the phrasing already fixed has
almost no forward value, which is this repository's recurring "check that cannot fail" shape one
notch weaker: it can fail, but not on the sentence someone will actually write.

Widen the phrases to cover the apps-only framing and the bare "does not scan packages" shape.
Each new phrase must be proven to fire (restore a denial into a real tracked in-scope file from
a scratchpad copy, watch exit 1 naming the capability, restore, watch exit 0 — never
`git checkout --`) and proven not to collide with either guard's own historical narration,
compared **de-wrapped**, since today's line wrapping is not protection.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test.

- [ ] All four missed phrasings above are caught
- [ ] Each new phrase is watched firing before it is trusted
- [ ] The de-wrapped collision check is run against both guards' own narration
- [ ] `run-guard-capability-prose.mjs` exits 0 on the real tree, tree clean

#### T260 — Repoint the two scripts/ci legacy-schema citations at plan.md §5.3

`labels: phase-9, area: tooling` · `wave: P9-W41` · `depends-on: T253`

T253 gave the RESET/RE-PAIR decision a citable home in `plan.md` §5.3, then repointed the
`apps/*/src` and `packages/*/src` citations at it. Two `scripts/ci` files still co-cite the
reference-only `docs/frontend-data-migration.md` §2/§3 for that same decision:

- `scripts/ci/guard-no-legacy-schema-reader.mjs:39-44`
- `scripts/ci/run-guard-no-legacy-schema-reader.mjs:74-76` — inside a **developer-facing failure
  message**, so this is the copy a person actually reads when the guard fires.

**Neither is a live violation of T242's corollary today**, and this task must not claim
otherwise: both pair the reference doc with a legitimate home (the test, and `plan.md` §5.3 at
line 81), so neither cites a frozen document as its sole authority. This is also **not a T253
defect** — that task's `Owns:` line is the 19 files its own grep lists, and that grep is scoped
to `apps/*/src` and `packages/*/src`, which `scripts/ci` is not.

What is true is that the fact now has a `plan.md` home and these two do not point at it, so a
reader who follows the citation lands in a frozen snapshot rather than in the document that
governs. Repoint them, keeping any genuinely provenance-shaped mention of the audit as
provenance — the same sort T253 performed, applied to the two files its scope excluded.

Owns: `scripts/ci/guard-no-legacy-schema-reader.mjs`,
`scripts/ci/run-guard-no-legacy-schema-reader.mjs`, and their test.

- [ ] Both citations point at `plan.md` §5.3 for the decision, and §5.3 still states it
- [ ] The failure message a developer reads names the governing document, not the frozen one
- [ ] Any genuinely provenance-shaped mention is kept and labelled as provenance
- [ ] No reference-only document is edited

#### T261 — Record T253's provenance/authority classification durably

`labels: phase-9, area: docs` · `wave: P9-W42` · `depends-on: T253`

T253 sorted 19 shipped-source citations of reference-only documents into PROVENANCE (kept, 14)
and AUTHORITY (repointed at `plan.md`, 3 — plus the 2 the P9-D gate had already done). The P9-G
gate re-derived the sort and agrees with it: the ledger grep returns 17 files at `b1a6ec0` and
14 at `2224aa2`, and the three that left are exactly the three repointed.

**The classification itself exists only in a session report.** Nothing in the repository records
why a fixture scenario may keep its citation while `rpc-types.ts` could not, so T253's own third
acceptance criterion — "Every remaining citation is classified as provenance (kept) or authority
(repointed), with the classification recorded" — is unmet on `main`, and the checkbox is
unticked.

That matters more than a bookkeeping gap, because the distinction is the whole content of
T242's corollary and it is not self-evident: the next person to run that grep sees 14 live
citations of frozen documents and no written reason any of them is allowed. The likely outcomes
are a sweep that repoints all 14 (destroying real provenance) or a second gate re-deriving the
same sort from scratch.

Write the rule down where the grep's next reader will find it — a short section in `plan.md`
§5, or beside the corollary in `CLAUDE.md`'s reference-only section — stating the test T253
actually applied: a comment recording **where a fixture or a shape came from** is provenance and
may cite the audit; a comment justifying **what the code does today** is authority and must cite
`plan.md`. Name the two worked examples on each side rather than only the rule.

Owns: whichever of `plan.md` §5 or `CLAUDE.md`'s reference-only section gains the rule, and
`docs/issues-from-plan.md`'s T253 checkbox.

- [x] The provenance/authority test is written down where a reader of the grep will find it (`CLAUDE.md`, beside the T242 corollary it operationalises)
- [x] At least one worked example on each side is named (`loop.ts` for provenance, `rpc-types.ts` for authority)
- [x] T253's third checkbox is ticked, and the 14 kept citations are enumerated somewhere durable (listed in `CLAUDE.md`, not totaled)
- [x] No reference-only document is edited

#### T262 — LEGACY_PROVIDER_IDS excludes "pi", so the shipped Android app sees no agents

`labels: phase-9, area: server` · `wave: P9-W43` · `depends-on: none`

**This is a shipped product defect, not a test-scope question, and it is the most severe item
open in Phase 9.** It is pre-existing — neither file was touched by wave P9-H — and it surfaced
only because T258 rescoped the e2e suite to `"pi"` and had to work around it in test code.

Re-derived at the P9-H merge gate by reading the real path, not by running the app:

- `packages/server/src/server/session.ts:281` —
  `const LEGACY_PROVIDER_IDS = new Set(["claude", "codex", "opencode"]);`. **No `"pi"`.**
- `:282` — `const MIN_VERSION_ALL_PROVIDERS = "0.1.45";`
- `:1783` — `isProviderVisibleToClient(provider)` returns `true` when
  `clientSupportsAllProviders(this.appVersion)`, else `LEGACY_PROVIDER_IDS.has(provider)`.
- `:316` — `clientSupportsAllProviders` is `isAppVersionAtLeast(appVersion, "0.1.45")`.
- `apps/android/src/app-shell/core.ts:124` —
  `export const ANDROID_DAEMON_APP_VERSION = "0.1.0";`, sent at `:953` and `:1284`.

`isAppVersionAtLeast("0.1.0", "0.1.45")` compares `[0,1,0]` against `[0,1,45]` and returns
**false** at the third component, so the shipped Android client is treated as legacy and
`isProviderVisibleToClient("pi")` returns **false**.

**The consequence is wider than a missing push.** `session.ts:4360` is

```ts
agents = agents.filter((agent) => this.isProviderVisibleToClient(agent.provider));
```

— inside the agent **list** build, not only the update path. Under a Pi-only
`AGENT_PROVIDER_DEFINITIONS` (`packages/protocol/src/provider-manifest.ts:38`, one entry,
`id: "pi"`), every agent is a `"pi"` agent, so the real Android app receives an **empty agent
list**. T258 disclosed this honestly but scoped it as "would never receive an `agent_update`
push", which understates it.

**Do not fix this by guessing which end is wrong.** Three candidate shapes, and the choice is a
product decision that must be argued:

1. Add `"pi"` to `LEGACY_PROVIDER_IDS`. Cheapest, but the set's name then lies — `"pi"` is not
   legacy, it is the only provider.
2. Bump `ANDROID_DAEMON_APP_VERSION` past `0.1.45`. Makes the gate pass, but that constant is a
   wire-compatibility signal, not a version to move for convenience; check what else reads it
   (`clientUsesLegacyWorkspaceRestore` at least) before touching it.
3. Retire the gate. It exists to hide providers from clients too old to render them. With one
   provider and no non-Pi providers planned (`plan.md` §2.3), the gate may have outlived its
   reason — but that is exactly the kind of removal that needs the original reason found first,
   not assumed absent.

Whichever ships, prove it end to end rather than by unit test alone: a daemon built from the
real manifest must return a non-empty agent list to a client announcing
`ANDROID_DAEMON_APP_VERSION`. Check every caller of `isProviderVisibleToClient` (`:862`,
`:943`, `:1006`, `:4360`, `:4432`, `:4440`) — the list build is the one that matters most, and
the two payload filters at `:4432`/`:4440` behave differently.

Owns: `packages/server/src/server/session.ts`, `apps/android/src/app-shell/core.ts`, and
whichever of `plan.md` records the decision.

- [x] The chosen shape is argued against the other two, in the source, not only a report
- [x] A daemon built from the real manifest returns a non-empty agent list to `ANDROID_DAEMON_APP_VERSION`
- [x] Every caller of `isProviderVisibleToClient` is checked, and the two payload filters are stated to behave as intended
- [x] The workaround `live-preferences.e2e.test.ts` carries in its own test context is removed or justified

**STATUS: DONE.** Shape 3 (retire the gate) was chosen; `isProviderVisibleToClient` in
`session.ts` is now an unconditional `true`, with the full argument against shapes 1 and 2
in its own doc comment and mirrored in `plan.md` §18 item 13. `ANDROID_DAEMON_APP_VERSION`
in `apps/android/src/app-shell/core.ts` was **not** touched — bumping it was one of the two
rejected shapes, argued in the source. End-to-end proof:
`packages/server/src/server/daemon-e2e/provider-visibility.e2e.test.ts` (new file, run via
`test:e2e`) spins up `createTestPaseoDaemon({})` — the real manifest, no provider override —
connects a `DaemonClient` declaring `appVersion: "0.1.0"` (the real
`ANDROID_DAEMON_APP_VERSION` value), creates a `"pi"` agent, and asserts
`fetch_agents` returns it. `cd packages/server && npx vitest run
src/server/daemon-e2e/provider-visibility.e2e.test.ts --bail=1` passed 1/1; reverting
`isProviderVisibleToClient` to the pre-fix gate (`LEGACY_PROVIDER_IDS.has(provider)` below
`"0.1.45"`) and re-running reproduced the original defect — `expect(list.entries.length)
.toBeGreaterThan(0)` failed with "expected 0 to be greater than 0" — then the fix was
restored byte-identically and the test re-passed. All six callers of
`isProviderVisibleToClient` were checked (`:853`, `:934`, `:997`, `:4406`, `:4478`, `:4486`
in the post-fix file) — each now always receives `true`, so the list build (`:4406`) stops
dropping "pi" agents and both payload filters (`:4478`/`:4486`) stop nulling single-agent
lookups; none needed different treatment because the gate they shared was uniform. The
`live-preferences.e2e.test.ts` workaround (`createPiVisibleDaemonTestContext`, declaring
`appVersion: "0.1.45"`) is now unnecessary for provider visibility — any `appVersion`,
including none, would see the same result post-fix — but that file is outside this task's
`Owns:` line (T258's) and was left untouched, per this task's own instructions; reported to
T258/the merge gate rather than edited. `docs/ci-matrix.md`'s T258 paragraph describing this
gate, and five present-tense mentions of the retired mechanism in
`apps/web/src/app/daemon-client-context.tsx` and two `apps/web/e2e/*.spec.ts` files, and one
in `packages/server/src/server/daemon-e2e/queue-mode-routing.e2e.test.ts`, were corrected
in the same commit (T124) — all outside this task's `Owns:` line, disclosed here rather than
silently absorbed into it.

#### T263 — Teach canPrecedeRegex about the JSX closing-tag case, or scope it

`labels: phase-9, area: tooling` · `wave: P9-W44` · `depends-on: T256`

`source-comment-stripper.mjs`'s `canPrecedeRegex` heuristic treats the `/` in a JSX **closing**
tag (`</Foo>`) as a regex-literal start, because the character before it is `<` — a token a
genuine regex can follow. The false "regex" scan then consumes past a following comment's own
`//`, so the comment survives into the output:

```
"</Foo> // real comment"   -> comment LEAKED
"<Bar /> // real comment"  -> stripped correctly
"<Bar/> // real comment"   -> stripped correctly
```

Only the closing-tag shape triggers; the self-closing shapes are safe, `canPrecedeRegex`
returning `false` at their slash. (T256's paragraph originally claimed both shapes triggered;
corrected at the P9-H merge gate by executing the real exported function.)

**Currently inert, and this task must not claim otherwise.** T256 measured the whole tree —
2,247 files, zero byte-for-byte differences against a parser-derived ground truth, re-derived
at the gate under a second, independently-constructed oracle that also found zero. No file any
current caller scans has a comment positioned where this fires. The regression test T256 added
pins the limitation as known.

What makes it worth closing rather than leaving pinned is the caller trend: the module went
from four callers to eight in three waves, and `orphan-modules.mjs` now walks every tracked
module file. A `.tsx` file with a comment shortly after a closing tag turns this live, and the
failure is silent — a comment that should have been stripped stays in, so a guard reading the
"code" sees prose.

Two shapes, both legitimate:

1. **Teach the heuristic the case** — a `/` immediately following `<` cannot start a regex,
   because `<` as a _binary_ operator cannot be followed by an empty regex and `<` as JSX is
   not an expression position at all. Measure the false-negative cost against the same
   parser-derived oracle T256 built: the fix must not start swallowing real regexes.
2. **Scope it** — state in the header that the module is not safe for `.tsx` and make a caller
   that scans `.tsx` opt in explicitly. Cheaper, but pushes the problem to eight callers.

Whichever ships, re-run T256's whole-tree oracle comparison and report the byte-difference
count, and add the leaking case above as a test that goes from expected-leak to expected-strip
in the same commit.

Owns: `scripts/ci/source-comment-stripper.mjs` and its test.

- [ ] `"</Foo> // real comment"` strips correctly, pinned by a test that fails on the old behaviour
- [ ] The whole-tree oracle comparison is re-run and its byte-difference count reported
- [ ] No real regex literal starts being swallowed — measured, not asserted
- [ ] The known-limitation regression test T256 added is updated rather than deleted

#### T264 — Guard or document the unguarded extraClients overlay

`labels: phase-9, area: server` · `wave: P9-W45` · `depends-on: T262`

Two paths merge `extraClients` into provider state, and only one applies the manifest guard.
Measured at the P9-I merge gate by reading both, not inferred:

- `packages/server/src/server/agent/provider-snapshot-manager.ts:452-456` — `buildRegistry()`
  does `const definition = registry[provider]; if (!definition) continue;`, so an `extraClients`
  entry whose id is not already a manifest key never becomes a registry definition.
- **`:280-284`** — `getAgentManagerProviderState()` has a **second, separate** overlay with **no
  such guard**: `for (const [provider, client] of Object.entries(this.extraClients)) { if
(client) { clients[provider] = client; } }`.
- `AgentManager.listProviderAvailability()` enumerates that overlay, not the manifest.

**Consequence, measured against the daemon T262's own new e2e test builds:**
`list_available_providers_request` returns `["pi", "claude", "opencode", "codex"]` — four ids,
three of them providers this repository declares a non-goal (`plan.md` §2.3).

**Production is not affected, and this task must not claim it is.** `config.ts:527` passes
`agentClients: {}`, reaching `ProviderSnapshotManager` as `extraClients` via
`bootstrap.ts:831`, so a real daemon overlays nothing. This is a test-surface divergence and a
false-premise source, not a live product defect — which is exactly why it was filed rather than
fixed at the gate: the overlay is code, and the gate's remit was the prose resting on it.

Decide whether the two paths should agree. Both outcomes are legitimate:

1. **Add the same `if (!definition) continue;` guard** to `:280-284`. Then a test daemon reports
   only manifest providers, and the two paths stop disagreeing. Check first what depends on the
   current behaviour — `createTestAgentClients()` returns `claude`/`codex`/`opencode`, and
   something may rely on those clients existing even though they are not registry definitions.
2. **Record why they differ.** There may be a real reason a test harness wants to inject a
   client without a manifest definition. If so, say it where a reader of either path finds it,
   and the divergence stops being a trap.

Whichever ships, **the two prose sites that rest on the false reading were corrected at the P9-I
gate and must stay consistent with whatever this task decides**:
`packages/server/src/server/test-utils/fake-agent-client.ts` (its "dropped by its
`if (!definition) continue;` merge guard" claim) and
`packages/server/src/server/daemon-e2e/provider-visibility.e2e.test.ts`'s header, which calls
its daemon "built from the REAL provider manifest" while that daemon has four registered
clients.

Owns: `packages/server/src/server/agent/provider-snapshot-manager.ts`,
`packages/server/src/server/test-utils/fake-agent-client.ts`,
`packages/server/src/server/daemon-e2e/provider-visibility.e2e.test.ts`.

- [ ] The decision names which path changes (or that neither does) and why the other option lost
- [ ] `list_available_providers_request` against a test daemon returns what the decision says it should — executed, not asserted
- [ ] Nothing depending on an unguarded injected client broke, checked by running the affected e2e files one at a time
- [ ] Both corrected prose sites still read true afterward

#### T265 — Anchor T259's two over-wide phrases to their own guard

`labels: phase-9, area: tooling` · `wave: P9-W46` · `depends-on: T259`

T259 widened T251's `discoverPackageTargets` entry so it catches the apps-only framing. All four
new phrases fire, and the past-tense exclusion works. But two of them carry **no anchor tying
them to that guard**, so they fire on true statements about other tools. Reproduced at the P9-I
merge gate through the real `findCapabilityDenialViolations`:

```
FIRES  "the orphan-module walk does not scan `packages/*/src`."
FIRES  "guard-no-android-web-files scans only apps/android and apps/web by design."
```

Both name real guards with exactly those real scopes: `run-orphan-modules.mjs` genuinely does
not walk `packages/*/src` as a declaration check, and `guard-no-android-web-files.mjs` genuinely
scans only the two app trees by design. A future author writing either sentence would be
telling the truth and would get a capability-prose failure naming an unrelated capability.

**Not a live failure**, so this is drift risk rather than a red: no such sentence exists in the
tree today. T259's header claims the phrases were "worded away from" collisions, but it checked
only the three files narrating _this_ guard's own history; it never tested a true claim about a
different guard.

The same gate found a second, sharper illustration of the width: feeding the whole committed
`docs/issues-from-plan.md` through the real function as if it were in scope produces **5 hits**,
including T251's own task brief. The runner is green only because
`isAppSourcePath("docs/issues-from-plan.md")` returns `false` via
`DOCS_LEDGER_DENIAL_EXCLUSIONS` — confirmed by calling the exported predicate. The widening sits
one exclusion away from firing on true prose.

Anchor both phrases to `guard-declared-workspace-deps` (or `discoverPackageTargets`) by name,
the way the entry's other phrases already are. Keep them firing on the four framings T259
measured — re-run those four — and add both false-positive sentences above as fixture
non-collision tests, so a later widening cannot silently reintroduce the reach.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test.

- [ ] Both sentences above no longer fire, pinned as non-collision fixture tests
- [ ] All four framings T259 measured still fire, re-run and reported
- [ ] The de-wrapped check is run against `run-orphan-modules.mjs` and `guard-no-android-web-files.mjs` too, not only this guard's own files
- [ ] Each surviving phrase is watched firing before it is trusted

#### T266 — Decide whether the vestigial isProviderVisibleToClient callback should go

`labels: phase-9, area: server` · `wave: P9-W47` · `depends-on: T262`

T262 retired the visibility gate: `session.ts`'s `isProviderVisibleToClient` now returns `true`
unconditionally and reads no `appVersion`. It kept the method and its `provider` parameter
deliberately, as a seam. The follow-up it explicitly deferred: the callback is still declared on
**three** host interfaces and still called at six sites, every one of them now a no-op filter.

- `packages/server/src/server/session/provider/provider-catalog-session.ts:44` (declaration) and
  its `start()` filter
- `packages/server/src/server/session/agent-updates-service.ts:57`
- `packages/server/src/server/session/workspace-directory.ts:84`

Two of those call sites were measured at the P9-I gate to be **behaviourally inert even before
T262**: `workspace-directory`'s `fetchWorkspaces` returned the same entry count with the gate
active and retired, and `agent-updates-service` gated only `payload.kind === "upsert"`. So the
seam is not uniformly load-bearing, and "keep it in case the gate returns" is weaker for some
callers than others — which is the argument this task has to settle per caller, not in bulk.

The two stale present-tense COMPAT comments in `provider-catalog-session.ts` were corrected at
the P9-I gate (they claimed the gating "lives on the shell" and "reads appVersion live"). Note
`isAppSourcePath` returns **false** for that file, so `guard-capability-prose` can never catch
prose there — a removal decision that leaves stale comments behind has no backstop.

Decide: remove the callback from all three interfaces and delete the no-op filters, or keep it
and say per interface why. If removing, check the DI'd test fakes that supply it
(`provider-catalog-session.test.ts`, `agent-updates-service.test.ts`) — both remain valid
host-contract tests, but their "legacy client" framing no longer describes any real connection
and should be retitled in the same commit.

Owns: those three modules, their tests, and `session.ts`'s `isProviderVisibleToClient`.

- [x] The decision is per caller, with the two inert ones distinguished from the rest
- [x] If removed: every call site and every DI'd fake is updated in the same commit
- [x] If kept: each interface says why, next to its own declaration
- [x] No "legacy client" framing survives that no longer describes a real connection

  Ticked by T266, but `provider-catalog-session.test.ts`'s own test title still read "for
  legacy clients" when it landed — the P9-J merge gate found it and retitled it, which is
  what made this box true. `isAppSourcePath` returns **false** for that path, so no guard
  could have caught it; it was only ever going to be found by the grep the criterion asks
  for.

**STATUS: DONE.** Two file-path corrections found while reading the real tree (not this
task's fault — the paths above predate a later reorganisation): the real files are
`packages/server/src/server/session/agent-updates/agent-updates-service.ts` and
`packages/server/src/server/workspace-directory.ts` (not nested under `session/`).

**Re-deriving the two "inert" findings, per this task's own instruction, found one holds and
one does not:**

- `workspace-directory`: re-derived and **confirmed, and strengthened**. Not just "same entry
  count" — proven structurally redundant. `grep -rn "new WorkspaceDirectory("
packages/server/src` finds it constructed in exactly one non-test file — `session.ts` — plus
  its own test's fixtures; `session.ts` is its only PRODUCTION caller, and its
  `listAgentPayloads` dependency is bound to `() => this.listAgentPayloads()` —
  `session.ts`'s own private method, which already applies
  `agents.filter((agent) => this.isProviderVisibleToClient(agent.provider))` internally
  (via the SAME shared method) before `WorkspaceDirectory` ever receives the list.
  Applying the identical predicate a second time to an already-filtered list cannot change
  the result, in any past or future state of the gate. Proven by an ablation test (built at
  this gate, run, and then deleted since the code it exercised no longer exists): with a
  fake `listAgentPayloads` pre-filtered the way the real one is, forcing the internal
  `isProviderVisibleToClient` term to always `true` produced byte-identical
  `listDescriptors()` output — same entry count AND same per-workspace `status` — in both
  the gate-true and gate-false cases. **Removed** from `WorkspaceDirectoryDeps`.
- `agent-updates-service`: re-derived and **not confirmed — the opposite was found.** The raw
  fact ("gated only `payload.kind === \"upsert\"`") is true by inspection, but does not
  establish inertness: `agent-updates-service.test.ts` already has two passing tests
  (`"drops an upsert whose provider is not visible to the client"`,
  `"does not buffer an upsert for a provider that is not visible"`) that toggle exactly this
  gate and observe the emitted-update list change from non-empty to `[]`. Tracing why: the
  LIVE agent-update path this service gates (`forwardLiveAgent` from
  `agentManager.subscribe`'s `"agent_state"` event, `session.ts`'s
  `subscribeToAgentEvents`) never passes through `session.ts`'s `listAgentPayloads()` — that
  method backs only the `fetch_agents_request` snapshot, a separate path — and
  `AgentManager.subscribe` itself applies no provider filter to what it forwards. So this
  callback is the ONLY gate on that path, not a redundant second one. An ablation test (same
  harness pattern, also deleted after use) confirmed it directly: forcing the callback to
  always return `true` while a parallel run kept it `false` changed the emitted-update count
  for an otherwise-identical `forwardLiveAgent` call from 0 to 1. **Kept**, with the
  reasoning above written next to its declaration in `agent-updates-service.ts`. This
  corrects the ledger's classification of this call site as one of the "two inert" ones —
  consistent with this file's own repeated caution that a decision record's stated cause can
  turn out false, and with this task's explicit instruction not to trust it unread.

**Per-caller decision:**

- `ProviderCatalogSession` — **kept**. It is the only remaining filter on provider-CATALOG
  content (models, modes, available-providers, the providers snapshot); nothing else in
  `session.ts` re-applies visibility to that content. Reasoning added next to its
  declaration in `provider-catalog-session.ts`, alongside the existing P9-I-corrected COMPAT
  comment (left as-is, not re-litigated).
- `createAgentUpdatesService` — **kept** (not one of the two removed, contrary to the
  ledger's framing — see re-derivation above). Reasoning added next to its declaration.
- `WorkspaceDirectory` — **removed**: the interface member, its call site in
  `buildDescriptorMap`, the DI wiring in `session.ts`'s constructor, and both fixtures in
  `workspace-directory.test.ts` that supplied it.

`session.ts`'s own retirement comment on `isProviderVisibleToClient` was rewritten to give
all three of these reasons in one place, per caller, replacing the "outside this task's
Owns grant" placeholder T262 left there. No "legacy client" framing needed retitling in
either kept test file: `agent-updates-service.test.ts`'s two provider-visibility tests are
titled by behaviour ("drops an upsert whose provider is not visible..."), not by a "legacy
client" framing, and `provider-catalog-session.test.ts`'s fixture (`isProviderVisibleToClient:
(provider) => visible.has(provider)`) carries no such framing either — both remain accurate,
host-contract tests today, unchanged.

`plan.md` §18 item 13 (`Owns` line does not cover it, but T124's grep-and-fix-every-hit rule
does: that item asserted, in the present tense, that all three modules "each still depend on"
the callback, which is now false for `WorkspaceDirectory`) was given a `RESOLVED by T266`
addendum recording this outcome, rather than left to read as still-open follow-up.

Verification run: `cd packages/server && npx vitest run src/server/workspace-directory.test.ts
src/server/session/agent-updates/agent-updates-service.test.ts
src/server/session/provider/provider-catalog-session.test.ts --bail=1` (foreground, one shot).

#### T267 — Reclassify rpc-types.ts's get_commands citation and close T253's ledger

`labels: phase-9, area: docs` · `wave: P9-W48` · `depends-on: T261`

T261 recorded the provenance-versus-authority rule in `CLAUDE.md` (one location, verified) with
a worked example on each side. Applying that rule to the 14 kept citations turns up one that
does not pass its own test — flagged independently by both the P9-I verifier and its merge gate:

`packages/server/src/server/agent/providers/pi/rpc-types.ts:335` reads _"See
`docs/pi-extension-compatibility.md`'s T51A findings section for **why this one (of 12
previously-unmirrored request types) was mirrored rather than deferred**"_. That justifies a
shipped scoping decision by pointing at the frozen audit as the decision record — **authority**
under T261's test, not provenance.

**This is a T253 classification defect, not a T261 recording defect**, and this task must say so
rather than implying T261 got the rule wrong. `CLAUDE.md`'s own wording invites re-applying the
test to the kept list; this is that re-application. Mitigating, and worth stating: the
substantive reason is already given inline, so a reader is not actually dependent on the frozen
file — which is why this is a reclassification rather than a defect that misleads anyone today.

Two of T253's ledger checkboxes are also unticked though satisfied, measured at the same gate:
its second (`rpc-types.ts`'s three "decision record" citations point at `plan.md`) is satisfied
— lines 208, 266 and 293 cite `plan.md` §4.2 and `plan.md:308` carries that heading — and its
fourth likewise. Tick them, or state why not.

Give the `get_commands` rationale a citable home the way T253 did for the other three: restate
it in `plan.md` §4.2 alongside them, then repoint. Do not repoint before `plan.md` says it.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.ts`, `CLAUDE.md`'s kept-citation
list, `docs/issues-from-plan.md`'s T253 section, and `plan.md` §4.2 only to add the restated
fact.

- [x] The `get_commands` rationale has a `plan.md` home before the comment is repointed (`plan.md` §4.2's new bullet landed first; the `rpc-types.ts` repoint is a later edit in this same commit)
- [x] `CLAUDE.md`'s kept list drops that file, or explains why it stays (dropped: `rpc-types.ts` no longer appears in the kept list, replaced with a note explaining the T267 reclassification)
- [x] T253's second and fourth checkboxes are ticked, or the reason they are not is written down (both ticked above, each with the evidence that satisfies it)
- [x] The commit says this is a T253 classification call, not a T261 error, and no reference-only document is edited

#### T268 — Restore pronoun coverage to T265's anchored phrases

`labels: phase-9, area: tooling` · `wave: P9-W49` · `depends-on: T265`

T265 anchored two of T259's phrases to `guard-declared-workspace-deps` by name, which correctly
silenced the two false positives about other guards. It also silenced **the most likely real
drift shape**, and its shipped comment claims the opposite — that the T259 (2/4) framing "still
fires, just no longer un-anchored".

Executed at the P9-J merge gate through the real `CAPABILITIES` entry and
`findCapabilityDenialViolations`:

| sentence                                                                                                                                                    | result           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `guard-declared-workspace-deps does not scan `packages/\*/src` at all.`                                                                                     | FIRES            |
| **T259's own 2/4 fixture**: `This check does not scan `packages/\*/src` at all, so an undeclared workspace import under any package would never be caught.` | **silent**       |
| `This guard does not scan `packages/\*/src`, so an undeclared import is never caught.`                                                                      | **silent**       |
| `It walks only apps/android and apps/web, so packages are not checked.`                                                                                     | **silent**       |
| `the orphan-module walk does not scan `packages/\*/src`.` (FP-1)                                                                                            | silent — correct |
| `guard-no-android-web-files scans only apps/android and apps/web by design.` (FP-2)                                                                         | silent — correct |

**The pronoun form is the shape that will actually appear.** A stale comment inside
`guard-declared-workspace-deps.mjs` itself naturally says "this guard" or "this check", not the
file's own name — nobody writes their own filename in their own header. So the entry now catches
the framing a _different_ file would use about this guard, and misses the framing this guard's
own file would use about itself. That is backwards relative to where stale prose accumulates.

**Not a regression to revert.** T265's narrowing was right about the false positives, and both
FP sentences must stay silent. This task adds coverage back without reopening them.

The obvious shape: allow the pronoun forms when the file under judgment IS the guard's own
source (or a file whose nearby text carries a `workspace-dep`-ish token), and keep requiring the
explicit name elsewhere. `findCapabilityDenialViolations` already knows each `appFile`'s `path`,
so a per-entry path condition is expressible without changing the scan. Measure whether that is
the cheapest correct shape before building it — an alternative is a second entry scoped to the
one file.

Prove each restored phrase fires and each FP stays silent, by execution, and pin all six rows of
the table above as fixture tests so neither direction can drift again. Correct T265's shipped
comment, which asserts the 2/4 framing still fires.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test.

- [ ] All three silent-but-should-fire sentences above fire, watched at CLI level
- [ ] Both false positives stay silent, pinned as fixture tests
- [ ] T265's comment no longer claims the 2/4 framing still fires when it does not
- [ ] The six rows above are pinned as tests, in both directions

#### T269 — Stop citing shipped source by line number, and guard it

`labels: phase-9, area: tooling` · `wave: P9-W50` · `depends-on: none`

A single commit broke **five** committed citations by inserting comment lines above the code they
pointed at. T264 added 42 lines of explanation to
`packages/server/src/server/agent/provider-snapshot-manager.ts`; the unguarded `extraClients`
overlay moved from `:280-284` to `:317-321` and `buildRegistry`'s guard from `:452-456` to
`:494-500`. Every citation of the old numbers then pointed at unrelated code — `:280-284` landed
inside `refresh()`, `:452-456` inside `on()`/`off()`:

- `packages/server/src/server/session.ts` (two sites, written at the P9-I gate)
- `packages/server/src/server/test-utils/fake-agent-client.ts`
- `packages/server/src/server/daemon-e2e/provider-visibility.e2e.test.ts` — **written by that
  same commit, already stale on arrival**
- `plan.md` (two sites, also written at the P9-I gate)

All six were repointed to symbol names at the P9-J merge gate. **The class is the point, not
these six.** A `file.ts:NNN` citation is correct only until the next edit above it, and nothing
in this repository notices when it rots — the reader who follows one lands in unrelated code
with no signal that anything is wrong, which is worse than no citation at all.

Measure the real extent before deciding what to build: grep committed prose for
`` `<path>:NNN` `` and `` `:NNN-NNN` `` shapes across `packages/*/src`, `apps/*/src`,
`scripts/ci`, `docs/**` and `plan.md`, and report how many exist and how many are already wrong
today. A guard is only worth building if the population is real and mostly-correct; if it is
large and already largely rotten, the finding is more valuable than the check.

If a guard is built, it belongs in `scripts/ci` and must be able to see where these citations
actually live — call `isAppSourcePath` and `isShippedSourcePath` on candidate paths rather than
assuming, and note `plan.md` returns **false** for both, so a `plan.md`-only citation cannot be
caught by anything in the `guard-capability-prose` family. Register whatever capability it ships
in `CAPABILITIES` in the same commit, proven able to fire.

The alternative outcome is equally acceptable and must be argued if chosen: rule that shipped
prose cites by **symbol name**, never by line number, write that where authors read it
(`CLAUDE.md`), and fix the existing population by hand. A line number in a _commit message_ or a
gate report is fine — those are dated snapshots. It is committed source prose that rots.

Owns: whichever of `scripts/ci` gains the guard, plus `CLAUDE.md` if the rule route is taken.

- [ ] The real population of line-number citations is measured, with how many are already wrong
- [ ] The decision names guard-or-rule and argues against the other
- [ ] If a guard: it fires on a real rotted citation, watched, and its capability is registered
- [ ] If a rule: it is written where authors read it, and the existing population is fixed

#### T272 — Close the prose-form line-number population T269's rule forbids but never measured

`labels: phase-9, area: docs` · `wave: P9-W51` · `depends-on: T269`

T269 ruled that shipped prose cites by symbol name, never by line number, and its own rule text
says so explicitly: "Writing it as `path.ts` line NNN, or a bare line NNN, is exactly what this
rule forbids." Its measurement, its conversion, and the re-run grep it recorded for future waves
all matched **only the two backtick-fenced shapes**. The unfenced prose form was never counted,
never converted, and is not findable by the recovery procedure the rule ships with — so the rule
forbids a class its own grep cannot see.

Measured at the P9-K merge gate, outside the ledger:

```
git grep -noiE '\b(at |on |see )?lines? ~?[0-9]{2,4}(-[0-9]+)?\b' HEAD \
  -- 'packages/*/src/*' 'apps/*/src/*' 'scripts/ci/*' 'docs/*' 'plan.md' \
  ':!docs/issues-from-plan.md'
```

**33 hits.** Not all are citations — re-classify each before converting:

| Site                                                                                                                | Hits | First read                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `docs/agent-configuration-surface.md`                                                                               | 10   | real citations; one already dead (below)                                                                     |
| `docs/android-apk-release.md`                                                                                       | 1    | real citation                                                                                                |
| `scripts/ci/guard-capability-prose.mjs`                                                                             | 2    | `guard-docker-packaging-paths.mjs (~line 30)` / `(~line 160)` — real, and in a file T269's own commit edited |
| `packages/frontend-core/.../scenarios/{pi-goal,subagents,workflows}.ts`                                             | 4    | real citations into Pi's own source                                                                          |
| `packages/server/**`, `apps/**` test files, `scripts/ci/ci-routing.test.mjs`, `guard-web-session-bundle-budget.mjs` | 16   | mostly rendered-log fixture content (`"line 51"` as a _value_), not citations — classify and say so          |

**One is already rotted**, which is the rule's own motivating failure mode live in the tree:
`docs/agent-configuration-surface.md` cited `` `docs/issues-from-plan.md` line 1454 `` for T28B5.
Line 1454 is a **blank line** inside an unrelated phase-3.5 section; T28B5's real row is line 160.
Fixed at the P9-K gate by dropping the number — the sentence already names the task — but that
one edit does not close the class.

Note `docs/agent-configuration-surface.md` is **not** on the frozen reference-only list, so
unlike `docs/pi-extension-compatibility.md` it was always in scope to fix, and was missed only
because the measurement's regex could not see it.

Do **not** build a guard. T269's measurement already settled that question for the fenced form,
and this population is smaller and shares the identical semantic-drift failure mode: a script
can tell whether line NNN exists, not whether it still says what the prose claims. Every one of
the 12 wrong citations T269 found resolved to a valid, in-bounds line.

Verify each target before converting — at least one has already drifted, and converting a wrong
citation to a symbol name would launder a false claim into a durable-looking one.

Finally, extend the recorded re-run grep in `CLAUDE.md`'s T269 section to cover the prose form,
so the rule's own recovery procedure can find what the rule forbids. The P9-K gate added a
pointer to this task there; replace it with the finished grep.

Owns: the listed files, plus `CLAUDE.md`'s T269 closing paragraph.

- [x] Every one of the hits is classified as citation or non-citation, with the reason
      (re-measured at this task's own HEAD: 32, not 33 — the P9-K gate had already fixed
      one of `docs/agent-configuration-surface.md`'s ten by dropping its number)
- [x] Each real citation's target is resolved and read BEFORE conversion; drifted claims corrected
- [x] `docs/agent-configuration-surface.md`'s remaining 9 and `docs/android-apk-release.md`'s 1 are converted
- [x] `guard-capability-prose.mjs`'s two are converted, or argued as non-citations
- [x] `CLAUDE.md`'s recorded re-run grep matches the prose form, replacing the P9-K pointer
- [x] No guard is built, and the reason is stated

#### T273 — Repoint `real-session-protection.test.ts`'s rotted `agent.ts` citation

`labels: phase-9, area: core` · `wave: P9-W52` · `depends-on: T269`

`packages/frontend-core/src/testing/real-session-protection.test.ts`'s header comment cites the
live-stream `"custom"`-role display check in
`packages/server/src/server/agent/providers/pi/agent.ts` as **"~line 2661"**. Measured at the
P9-L merge gate: `grep -n 'role === "custom"' agent.ts` returns **2730**, and only 2730. The
citation has drifted 69 lines.

This is the exact failure mode T269's rule exists to prevent, and it was found by T272's own
measurement — reported honestly by that task as outside its `Owns` grant rather than touched.
Nothing about it is new information; it needs an owner.

Convert to a symbol citation per `CLAUDE.md`'s "Cite shipped source by symbol name, never by
line number" rule. Read what is actually at the cited construct before writing the replacement:
the comment makes a claim about what that check does, and a citation that drifted 69 lines is a
citation nobody has verified in a while.

Owns: `packages/frontend-core/src/testing/real-session-protection.test.ts` only.

- [x] The `~line 2661` citation is replaced with a symbol citation
- [x] The claim the comment makes about that check is re-read against the real code and corrected if wrong
- [x] No line-number citation remains in that file

#### T274 — `guard-web-session-bundle-budget.mjs`'s comment calls a rationale missing that now exists

`labels: phase-9, area: tooling` · `wave: P9-W53` · `depends-on: T269`

`scripts/ci/guard-web-session-bundle-budget.mjs`'s module comment says:

> What is genuinely missing is a RATIONALE, not an assertion: nothing at that assertion connects
> 60 ms to §14.5's 20 msg/s, and it sits inside a test titled about something else (that same
> file, line 127: "uses constructor windowMs instead of a hard-coded value") …

Both halves are false today, measured at the P9-L merge gate by reading
`packages/server/src/server/agent/agent-stream-coalescer.test.ts`:

- **Line 127** is now `test("pins AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS at 60, which plan.md §14.5's 20 msg/s per-agent bridge budget depends on", …)`. The rationale the comment calls missing **is the test's title**.
- The `"uses constructor windowMs instead of a hard-coded value"` test moved to **line 130**.

So this is not a rotted number to repoint — it is a **claim that has been overtaken**. Repointing
the citation at a symbol while leaving the surrounding sentence would preserve a false statement
in a more durable-looking form, which is the specific harm `CLAUDE.md`'s T269 section warns about.

Retire or rewrite the paragraph: state that the pin now carries its own rationale in its title,
and say what (if anything) this guard still needs to do about it. If the answer is "nothing", say
so and delete the paragraph rather than leaving a stale worry in a shipped guard's header.

Owns: `scripts/ci/guard-web-session-bundle-budget.mjs` only. Do **not** edit
`agent-stream-coalescer.test.ts` — it is already correct.

- [x] The "missing rationale" claim is removed or rewritten against what the test title says today
- [x] No line-number citation remains in that comment
- [x] `node scripts/ci/run-guard-web-session-bundle-budget.mjs` still exits 0

#### T275 — `guard-capability-prose.test.mjs`'s four-marker citation has rotted

`labels: phase-9, area: tooling` · `wave: P9-W54` · `depends-on: T272`

`scripts/ci/guard-capability-prose.test.mjs` carries, inside a `CORRECTED (P8-W6 merge gate)`
narration, the claim that `docs/legacy-retirement.md` **"carries FOUR such markers (lines 9, 35,
295, 332)"**. Measured at the P9-L merge gate: `grep -n CORRECTED docs/legacy-retirement.md`
returns **six** hits, at **9, 15, 43, 323, 326, 374**. One of the four cited numbers still lands
on a marker; the other three do not, and the count itself is wrong.

Invisible to T272's recovery grep twice over, which is why it survived: the keyword-bearing
number (`lines 9`) is **single-digit**, and the other three are bare numbers in a comma list with
no `line`/`lines` token in front of them at all. The P9-L gate widened that grep's digit band,
which is what surfaced this.

**Decide the class first, and argue it.** `CLAUDE.md`'s T269 rule exempts "a line number in a
commit message or a gate report" as a dated snapshot. This sentence is a gate's narration of what
it found at P8-W6 — so the exemption plausibly applies, and the honest fix may be to **date it**
("as of the P8-W6 gate, four markers at …") rather than to convert or recount. What is not
defensible is leaving it reading as a present-tense claim about a file that now says something
else. Whichever route is taken, state the reason.

If the recount route is chosen, re-derive the marker set yourself; do not copy the six numbers
above without checking each is a real `HISTORICAL_QUOTE_MARKERS` trigger in context.

Owns: `scripts/ci/guard-capability-prose.test.mjs` only. Do **not** edit
`docs/legacy-retirement.md`.

- [x] The marker set is re-derived directly, not copied from this brief
- [x] The route (date it / recount it / convert it) is chosen and argued against the alternatives
- [x] The sentence no longer reads as a present-tense claim that is false

  True of the P8-W6 sentence the moment T275 landed, but the paragraph it added introduced
  two of its own: it attributed its new number set to a measurement T272 never made (that
  audit's grep returns NO HITS on this file, executed at its own HEAD), and it printed seven
  figures eight lines before asserting “none is reprinted here” — as a bare comma list, the
  one shape the widened recovery grep still cannot see. The P9-M merge gate found both and
  fixed them, which is what made this box true.

- [x] `node --test scripts/ci/guard-capability-prose.test.mjs` all-pass

#### T276 — Ship a real VoiceCapturePort and make the mic button waveform-only

`labels: phase-9, area: android` · `wave: P9-W55` · `depends-on: none`

The press-to-start / press-to-stop machine already exists and is well-built. What does not exist is
a recorder: `apps/android/src/features/voice/voice-capture-port.ts` ships exactly one production
`VoiceCapturePort`, `createUnavailableVoiceCapturePort()`, whose `getPermissionStatus` returns
`"unavailable"` and whose `stop()` returns `{ kind: "transcript", text: "" }`. Every voice path in
the app is therefore inert today, and `mic-press-model.ts`'s own header says so
("Both currently default to `createUnavailable*Port()` (no recorder installed)").

**Read before scoping**, in this order: `voice-capture-port.ts` (the port contract),
`voice-model.ts` (`createVoiceCaptureController`, `VoiceState`, `VoiceStartOutcome`,
`VoiceStopOutcome`), `mic-press-model.ts` (the one-permission-resolution-per-press invariant T83
closed), and `Composer.tsx`'s `handleMicPress`.

**Ship a real port. The dependency question is already settled — do not re-open it.**
`expo-audio@~1.0.13` (resolves 1.0.16) was installed by the owner at `fad6be1` for this task, and
is the SDK 54 recorder; `expo-av` is deprecated and is the wrong choice here. The in-repo
`@picompanion/expo-two-way-audio` was measured and rejected for capture: its API
(`toggleRecording`/`isRecording`/`playPCMData`, `MicrophoneDataEvent`) is built for a live two-way
voice stream, so using it would mean hand-accumulating frames into a buffer. Its permission calls
map onto `VoiceCapturePort` cleanly; its capture model does not. `expo-file-system` is already
installed, so nothing further is needed to read a finished clip.

The API surface, read from the installed package's own declarations:

| Need       | `expo-audio`                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permission | `getRecordingPermissionsAsync()` / `requestRecordingPermissionsAsync()` — map to `PermissionPort`                                                      |
| Capture    | `useAudioRecorder` / `AudioRecorder` with `prepareToRecordAsync`, `record()`, `stop()`, `uri`                                                          |
| Format     | `RecordingOptions` carries `sampleRate`, `numberOfChannels`, `extension`, `outputFormat` — so 16 kHz mono can be REQUESTED rather than resampled after |
| Presets    | `RecordingPresets.HIGH_QUALITY` / `LOW_QUALITY` — neither is 16 kHz mono; configure explicitly                                                         |

**Request 16 kHz mono explicitly and then VERIFY what you actually got.** A preset will not give
it, and a device may not honour the request. Read the real recording's rate and channel count back
and state the measured values — never the requested ones — in the port's doc comment.

The port must resolve `{ kind: "audio", audioBase64, format }` — **not** `"transcript"`. That arm
already exists in `VoiceCaptureOutcome` and is currently dead: `voice-model.ts` answers it with
`{ outcome: "raw-audio-unsupported" }`. Closing that dead end is the NEXT task's job, not this
one; this task ships the capture and leaves the outcome honestly unsupported, with a test pinning
that it is reached.

**The permission invariant is load-bearing.** T83 closed a double-prompt bug: exactly one
permission resolution per press, inside `requestStart()`. A real recorder is the first build where
a second prompt would actually be visible to a user. Do not add a precheck; do not call
`resolvePermission` from the port's own `start()`.

**The UI change: the mic shows the waveform and nothing else.** No "Listening…" label, no status
text (grep confirms no such string exists today — do not introduce one). While
`VoiceState.status === "recording"` the mic control renders an animated waveform only. The
artifact at `https://claude.ai/code/artifact/f8701c46-b748-4e61-ab5a-be8caf5cc263` already carries
the intended treatment as `.eq`/`@keyframes eq-bounce` — five bars, `eq-bounce .8s ease-in-out
infinite`, staggered `.06s`, `var(--accent)`, on `.cmp.listening` — and `D:\beautiful-ui` is the
source for the surrounding motion vocabulary. Match that, do not re-invent it.

`status === "processing"` is a different state and must remain distinguishable from `"recording"`;
decide what it shows and say why. A waveform that keeps bouncing after the user has pressed stop
is a lie about what the microphone is doing.

Owns: `apps/android/src/features/voice/**`, `apps/android/src/features/composer/mic-press-model.ts`
and `Composer.tsx`'s mic control only.

- [ ] A real `VoiceCapturePort` exists, resolving `{ kind: "audio", ... }`, or the exact blocking install is reported and the fake-backed implementation is complete
- [ ] Exactly one permission resolution per press, pinned by a test that fails if a second is added
- [ ] Recording renders a waveform and no status text; `"processing"` is visually distinct and the choice is argued
- [ ] The sample rate and channel count the port actually produces are stated, measured not assumed
- [ ] `raw-audio-unsupported` is still reached, and a test pins that it is

#### T277 — Transcribe captured audio through Groq, clean it, and put the text in the prompt bar

`labels: phase-9, area: server` · `wave: P9-W56` · `depends-on: the recorder task above`

Two defects block the flow the owner asked for, and they are independent of each other.

**1. The audio outcome dead-ends.** `voice-model.ts` answers `{ kind: "audio" }` with
`{ outcome: "raw-audio-unsupported" }`. Nothing transcribes it.

**2. A finished transcript is SENT, not offered.** `createVoiceCaptureController` enqueues into the
outbox (`VoiceOutboxLike`, `VoicePromptPayload`, `{ outcome: "queued", outboxEntryId }`). The
requested behaviour is the opposite: the text lands in the prompt bar as an editable draft, and the
user decides whether to send. **This is a behaviour change to a shipped decision, not a bug fix** —
record it in `plan.md` and correct `voice-model.ts`'s own header, which currently explains the
enqueue as the design.

**Do not build a new provider before measuring whether one is needed.** This repository already
has `packages/server/src/server/speech/`: a `SpeechToTextProvider` interface whose `id` is
`"openai" | "local" | (string & {})`, an `OpenAISTT` class with a **configurable `baseUrl`** and a
`(string & {})` model escape hatch, and a `provider-resolver.ts`. Groq's transcription API is
served at `https://api.groq.com/openai/v1` and is OpenAI-compatible. **Establish by execution
whether Groq is a configuration of `OpenAISTT` or genuinely needs its own provider, and argue the
answer.** `D:\Handy\research\cloud-stt-groq\07-proposed-architecture.md` reached the same
conclusion for a different codebase — that cloud providers should be configuration in front of the
existing path, not new engine code — and its reasoning transfers; cite it as the reference it is,
never as authority for what this repository does.

Facts confirmed from `D:\Handy\research\cloud-stt-groq\05-groq-api.md`, to be re-verified against
Groq's own documentation before shipping, not copied on trust:

| Field         | Value                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| Endpoint      | `POST https://api.groq.com/openai/v1/audio/transcriptions`                                |
| Auth          | `Authorization: Bearer <key>`                                                             |
| Body          | `multipart/form-data`                                                                     |
| Model         | `whisper-large-v3-turbo` (default; ~$0.04/hr) or `whisper-large-v3` (translation-capable) |
| Response      | `response_format: json` → `{"text": "..."}`, one field                                    |
| Size ceiling  | 25 MB free tier — about 13 minutes of 16 kHz mono 16-bit WAV                              |
| Billing floor | 10 seconds minimum billed, however short the clip                                         |

`whisper-large-v3-turbo` **cannot translate**. If any translate-to-English affordance is exposed,
it must force the non-turbo model or be hidden — a real capability interaction, not a detail.

Check the size ceiling **before** upload and fail with a clear message; do not discover it as a 413. Pass `language` when known — it improves both accuracy and latency.

**The key is a secret.** Follow this repository's existing credential handling
(`apps/android/src/features/connect/credential-store.ts`, `persisted-config.ts`) rather than
inventing storage. It must never be logged, never enter a URL or query string, and never appear in
a diagnostics export — `packages/frontend-core/src/security/secret-shape.ts` and
`scripts/ci/guard-secret-scan.mjs` already exist and both must stay green. Never paste a
secret-shaped literal as one contiguous run into any file, in a test or anywhere else.

**Cleanup is a real step, and it is deterministic before it is clever.** `D:\Handy`'s
`src-tauri/src/audio_toolkit/text.rs` does custom-word repair by Levenshtein distance plus Soundex
phonetics, deliberately restricted to ASCII keys because that scoring is wrong for CJK. Decide what
this product needs and argue the scope: at minimum trim, collapse the doubled whitespace Whisper
emits, and drop a leading filler token. **A hallucinated transcript from silence is a known Whisper
failure mode** — decide whether to guard it (Groq's `verbose_json` exposes `no_speech_prob` and
`avg_logprob` for exactly this) and say why if you do not. Do not route the text through an LLM for
cleanup without arguing the latency cost against what it buys.

Whatever the cleanup does, **an empty or whitespace-only result must not overwrite a draft the user
has already typed.** Define what happens to existing composer text — append, replace, or insert at
cursor — and pin it with a test; this is the decision most likely to be made by accident.

Owns: the speech provider wiring, `voice-model.ts`'s outcome handling, the composer draft
insertion, and the `plan.md` section recording the send-vs-draft change.

- [ ] Groq-as-configuration vs Groq-as-provider is decided by execution and argued against the other
- [ ] The endpoint, model, response shape and size ceiling are verified against Groq's own docs, not this brief
- [ ] The key never reaches a log, a URL, or a diagnostics export; `run-guard-secret-scan.mjs` stays green
- [ ] The transcript lands in the prompt bar as an editable draft; nothing auto-sends
- [ ] The interaction with existing composer text is defined and pinned by a test
- [ ] `plan.md` records the outbox-to-draft change, and `voice-model.ts`'s header no longer explains the old behaviour as the design
- [ ] Oversize audio fails before upload with a clear message

#### T278 — Image thumbnails and capture in the mobile prompt bar

`labels: phase-9, area: android` · `wave: P9-W57` · `depends-on: none`

Staging, limits and upload states already exist: `attachment-model.ts` has `StagedAttachment`,
`evaluateAttachmentCandidate`, `stageAttachment`, `markAttachmentUploaded`, `markAttachmentError`,
and `DEFAULT_ATTACHMENT_LIMITS` (6 files, 25 MiB each, 100 MiB total, the last matching
`DaemonClient.uploadFile`'s own `MAX_UPLOAD_BYTES`). What is missing is narrow and specific.

**`StagedAttachment` carries no preview.** Its fields are `id`, `name`, `mimeType`, `size`,
`status`, `uploaded?`, `error?` — nothing a thumbnail could render from. Add a preview channel for
image types only, and make it optional so a non-image attachment is not forced to carry an empty
one. **Decide where the preview bytes live and argue it**: a local URI is cheap but platform-shaped
and `packages/frontend-core` may not hold it; a data URI is portable but multiplies memory across
six staged files. Whichever you choose, state the memory cost of six 25 MiB images staged at once —
measured, not estimated — and say what is released on send and on removal.

Non-image types stay a compact chip: name, size, a remove affordance. **No preview for them, by
decision** — say so where a future reader will look, so the next wave does not read the absence as
an oversight.

**Capture is a second source, not the same one.** `FilePicker.pickFiles` in
`packages/frontend-core/src/platform/file-picker.ts` is a picker, not a camera. Taking a photo is a
different permission, a different failure mode, and a different cancel path. Either extend the port
or add a sibling; argue which, and note that the camera permission must follow the same
one-resolution-per-press discipline T83 established for the microphone.

Match `D:\beautiful-ui` for the chip and thumbnail treatment; the artifact's `.att` chip
(`pop-in .2s cubic-bezier(.23,1,.32,1)`) is the established shape in this product.

Owns: `apps/android/src/features/composer/attachment-*.ts`, the composer's attachment strip, and
the file-picker/camera port.

- [ ] `StagedAttachment` carries an optional preview, image types only
- [ ] Where preview bytes live is argued, with the six-file worst case measured and the release points named
- [ ] Non-image types render as a chip, and the no-preview decision is recorded where a reader will find it
- [ ] Capture works as a distinct source with its own permission path, one resolution per press
- [ ] Existing limits still reject oversize and over-count candidates, pinned by tests

#### T279 — Drag-and-drop, paste, and inline previews in the web composer

`labels: phase-9, area: web` · `wave: P9-W58` · `depends-on: none`

`apps/web/src/features/composer/use-attachments.ts` already has `ComposerAttachment`,
`useAttachments`, upload status and `formatAttachmentSize`. **The web composer has no
`onPaste`, no `onDrop`, and no `dragover` handler anywhere** — grepping `apps/web/src` for
`onPaste|onDrop|dragover|clipboardData|DataTransfer` returns only unrelated diagnostics code. So
every input path beyond the file dialog is missing, not merely rough.

Four inputs, and they are **four different code paths, not one** — do not implement one and assume
the others follow:

| Input         | Source                               | The part that bites                                                                                                                                    |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drag and drop | `DataTransfer.files`                 | Needs `dragover` **prevented** or the browser navigates away and the drop is lost. Needs a drop target that is not the whole window unless you mean it |
| Pasted image  | `ClipboardEvent.clipboardData.items` | A screenshot arrives as a `File` with **no name** — synthesize one, and say what you synthesize                                                        |
| Pasted link   | `clipboardData.getData("text")`      | Must NOT be swallowed. A URL in a prompt is usually just text; only treat it as an attachment on an explicit signal, and argue the rule you pick       |
| File dialog   | existing `FilePicker`                | Already works; do not regress it                                                                                                                       |

The pasted-link rule is the one most likely to be got wrong in a way that annoys the owner daily.
Pasting a URL into a prompt is overwhelmingly ordinary text. **State the rule, argue it against the
alternative, and pin both directions with tests** — the URL that stays text and the one that
becomes an attachment.

Images get an inline preview in the prompt bar, as on mobile. Reuse
`URL.createObjectURL` if that is the choice, and **call `URL.revokeObjectURL` on removal and on
send** — a preview that leaks a blob URL per paste is a real leak in a long session, and nothing in
this repository would notice.

Everything must route through the existing `useAttachments` limits, so a dropped 200 MB file is
rejected by the same rule as a picked one. A second acceptance path that skips the ceiling is the
defect this task should be most careful not to create.

Match `D:\beautiful-ui` for the drop-target and preview treatment. Keep the drop affordance quiet
until a drag is actually over the target; a permanently visible dashed rectangle is not this
product's vocabulary.

Owns: `apps/web/src/features/composer/**` only.

- [ ] Drop, paste-image, paste-link and dialog all work, each pinned by its own test
- [ ] `dragover` is prevented; a drop outside the target does not navigate
- [ ] A pasted screenshot gets a synthesized name, and what is synthesized is stated
- [ ] The pasted-URL rule is argued and pinned in both directions
- [ ] Every path goes through the existing limits — no second acceptance path
- [ ] Object URLs are revoked on removal and on send

#### T280 — Make create-agent's post-return dispatch awaitable by its own tests

`labels: phase-9, area: server` · `wave: P9-W59` · `depends-on: none`

CI run **34205088229** turned `main` red at `9be3731` with **zero assertion failures**:
`3496 passed`, one file failed, and the failure was inside a `finally` block —

```
FAIL src/server/agent/create-agent/create.test.ts > mcp create stamps the new worktree's workspaceId, not the parent's
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/create-agent-test-7tfH4F/agents'
 ❯ src/server/agent/create-agent/create.test.ts:327:5
```

The gate commit touched no file under `packages/server`, and this was the **first failure in
fifteen runs** on `main`, so it is a latent race that surfaced, not a regression.

**The mechanism, traced through source rather than guessed at.** `createAgentCommand` is called
with `background: true` and an `initialPrompt`, and returns as soon as the snapshot exists — this
file's own sibling tests are named "exposes the created worktree **before dispatching the initial
prompt**" and "keeps the prompt title **after the initial prompt settles**", so a dispatch that
writes agent records is still running when the test's assertions finish. `AgentStorage.writeRecord`
goes through `writeFileAtomic`, which creates a `.<name>.<pid>.<ts>.<uuid>.tmp` sibling in the same
directory and then renames it. `rmSync(workdir, { recursive: true, force: true })` enumerates
`agents/`, deletes what it saw, and then `rmdir`s — and a temp file created between the enumeration
and the `rmdir` produces exactly `ENOTEMPTY`.

**The P9-M gate fixed the symptom correctly and did not claim more.** All six real-storage tests in
that file now `await storage.flush()` before `rmSync`, which is what every production caller already
does (`bootstrap.ts`, `session.ts`, `test-utils/paseo-daemon.ts`). But `flush()` awaits the writes
already in `pendingWrites` when it snapshots the map — **a write queued after that snapshot is
still outside it.** So the window is closed, not proven unlosable.

**This task settles the real question: should a test be able to await the dispatch at all?** Today
it cannot, which is why the cleanup has to guess. Options, and the choice must be argued against the
others rather than asserted:

1. Return a handle (a promise, a disposer) from `createAgentCommand` when `background: true`, so a
   caller — test or production — can await the dispatch it started. Most honest; widest blast radius.
2. Give `AgentStorage` a `quiesce()` that resolves only when no write is queued **and** none can
   still be queued, and use that in cleanup. Narrower, but "none can still be queued" needs an owner
   and may not be expressible.
3. Decide the tests should not use a real `AgentStorage` at all for these cases. Cheapest, and loses
   the coverage that motivated using a real one — argue why that is acceptable if chosen.

Do **not** fix this by retrying the `rmSync`, by raising a timeout, or by moving the file into
`test:unit:serial`. T240 already ruled on that shape for this repository: those hide contention
rather than remove it, and a passing run would prove nothing about the next one. Serialization also
would not help here — the race is between one test and its own asynchronous continuation, not
between sibling files competing for the machine.

Whatever is chosen, the acceptance bar is a **deterministic** demonstration, not a green run: force
the late write to land after the enumeration (an injected delay in the dispatch path, a fake clock,
or a stubbed `writeFileAtomic`) and show the cleanup still succeeds. A fix that cannot be shown to
fail without it is not distinguishable from luck.

**Evidence already produced, before this task is run.** A P9-N implementer spike (stopped mid-wave
when the wave was cancelled; harness preserved outside the repo) ran each cleanup mode five times
against a real `AgentStorage` and a real `AgentManager`:

| Cleanup                                       | Result                        |
| --------------------------------------------- | ----------------------------- |
| no wait at all                                | `ENOTEMPTY` **reliably**      |
| `storage.flush()` only                        | **still racy**                |
| `agentManager.flush()` then `storage.flush()` | never failed across five runs |

So the shipped P9-M fix (`storage.flush()` alone) is confirmed to be the partial measure its own
comment says it is, and the missing await is **`AgentManager`'s**, not storage's — which points at
option 1 or 2 rather than 3. Treat this as a starting hypothesis to re-derive, not a result to
copy: five runs passing is not a proof, and the acceptance bar below is still a deterministic
reproduction, not a green run.

Owns: `packages/server/src/server/agent/create-agent/**` and `agent-storage.ts`'s quiescence API if
option 2 is taken.

- [ ] The chosen option is argued against the other two, by measurement
- [ ] The failure is reproduced deterministically BEFORE the fix, not just observed green after
- [ ] The same reproduction passes with the fix in place
- [ ] No retry, no raised timeout, and no move into `test:unit:serial`
- [ ] The P9-M gate's `await storage.flush()` comment is updated to say what finally closed it

#### T281 — Register wave P9-O's four capabilities in `guard-capability-prose`

`labels: phase-9, area: tooling` · `wave: P9-W60` · `depends-on: none`

`run-guard-capability-prose.mjs` exited 0 across the whole of P9-O — **not because the tree was
clean, but because no `CAPABILITIES` entry exists for anything that wave shipped.** The P9-O merge
gate found **seven** prose sites the wave falsified and fixed all seven by hand; four of them sit
inside a scope `isAppSourcePath` already returns `true` for, so a registered entry would have caught
them. This is the "add an entry the moment you ship one" instruction in `CLAUDE.md`'s T124 section,
missed four times in one wave.

Register, each proven able to FIRE before it is trusted (append a denying sentence **in that entry's
own wording** to a real tracked file, confirm exit 1 naming the right capability, restore from a
scratchpad copy — never `git checkout --` — and confirm exit 0 with `git status --porcelain` empty):

- `createExpoAudioVoiceCapturePort` (`apps/android/src/features/voice/`)
- `transcribeVoiceClip` (`packages/client`, `packages/server`'s speech provider)
- `runCapturePress` (`apps/android/src/features/composer/`)
- the web trio `addFiles` / `useComposerPaste` / `useDragAndDrop` — a T168 AND-group is the right
  shape only if all three must be declared in ONE file; measure that before choosing, rather than
  assuming.

**Do not word any phrase by lifting a sentence from the file whose capability it protects.** T215
records exactly this collision and resolved it by rephrasing rather than by adding an exclusion. The
gate's own corrections now carry `CORRECTED at the P9-O merge gate` markers, so a phrase that
happens to match one of them will not fire — check that, do not assume it.

**Second half, and it needs a decision, not a sweep.** Two of the seven sites live in
`apps/android/maestro/composer-inputs.yaml`, and `isAppSourcePath` admits only
`apps/android/maestro/*.md`. Those two were structurally invisible — the "check that cannot fail"
shape. Either widen to `*.yaml` (measure how many files that admits, the way T246 measured
`APP_ROOT_CONFIG_PATTERN` against `git ls-files` before trusting it) or record a will-not-widen with
the reason, in `CLAUDE.md` beside the existing widenings. Do not leave it undecided.

Owns: `scripts/ci/guard-capability-prose.mjs`, its test, and the `CLAUDE.md` paragraph recording the
scope decision.

- [ ] All four capabilities registered, each watched firing before being trusted
- [ ] No phrase is lifted from the source file it protects
- [ ] The `*.yaml` scope question is decided either way, with the reason recorded
- [ ] `isAppSourcePath` is called on each path rather than inferred from a list
- [ ] `run-guard-capability-prose.mjs` exits 0 on the real tree afterward

#### T282 — Wire `transcribeClient`, `attachmentSource` and `cameraCapture` at the session mount

`labels: phase-9, area: android` · `wave: P9-W61` · `depends-on: T276, T277, T278`

**Wave P9-O shipped three owner-requested features that the app cannot reach.** The only
`<Composer>` mount in the product,
`apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx`, passes `sessionId`, `onSubmit`,
`onMicPress`, `onAttachPress`, `turnRunning`, `turnService`, `queueModeClient`, `turnStatusClient`
and `outbox` — and none of `transcribeClient`, `attachmentSource`, `cameraCapture`.

**The mic is the urgent half, because T276 made it worse than it was.** `Composer.tsx` now resolves
`voiceCapture ?? createExpoAudioVoiceCapturePort()`, so on a real device pressing the mic prompts
the OS microphone dialog and genuinely records — and stop then resolves
`"transcription-unavailable"`, shows the neutral banner, and discards the clip. Before this wave the
mic resolved `"unavailable"` and asked for nothing. **A user grants a permission and gets nothing
back.** Each half was disclosed by its own task; the combined outcome was disclosed by nobody, which
is why it is filed here rather than left to the next reader to assemble.

T278's thumbnails and camera action are inert for the same reason:
`createUnavailableAttachmentSourcePort` and `createUnavailableCameraCapturePort` remain the only
implementations, so `previewUri` can never be set in production.

`transcribeClient` is one line (`client.transcribeVoiceClip.bind(client)` off the session's live
`DaemonClient`). The other two need real ports, and `apps/android/package.json` declares neither
`expo-image-picker` nor `expo-document-picker` — **this task may not run `npm install`.** If the
dependency is the blocker, wire `transcribeClient`, say plainly that the pickers remain blocked on
an owner-run install, and name the exact command; do not ship a fake port to make a checkbox pass.

Owns: the session route file, and any real `AttachmentSourcePort`/`CameraCapturePort` this adds. Do
not edit `Composer.tsx`'s renderer body — the props already exist.

- [ ] `transcribeClient` is wired at the mount and a real recording reaches Groq
- [ ] The mic no longer requests a permission it cannot repay
- [ ] Whatever remains blocked on an owner-run install is stated with the exact command
- [ ] No port is stubbed to look real
- [ ] The maestro flow's own "not end to end" correction is updated to match what now ships

#### T283 — Serve attachment bytes to a remote client, capability-scoped

`labels: phase-9, area: server` · `wave: P9-W62` · `depends-on: none`

**Owner request.** A file or image attached from the phone must be visible in the web UI, and one
attached from the web must be visible on the phone. Today neither renders, on either surface.

**This is a proven backend gap, not a client omission.**
`apps/web/src/features/transcript/message-attachments.tsx`'s own header establishes it, and the P9-O
investigation re-confirmed every step:

- `AgentTimelineImageRef` carries `mimeType`, `path` and an optional `bytes` — **never inline
  bytes** ("large binary content is referenced rather than inlined wholesale", T52A1 acceptance), so
  both clients must fetch by path.
- Every RPC that could serve a path resolves it **relative to a workspace `cwd`**:
  `readFile`/`file_explorer_request` and `requestDownloadToken`/`file_download_token_request` both go
  through `file-explorer/service.ts`'s `resolveScopedPath`, which throws
  `ACCESS_OUTSIDE_WORKSPACE_MESSAGE` for anything outside `root`.
- The paths an attachment carries are **outside every workspace root by construction**:
  `materializeProviderImage` writes inbound provider images to `os.tmpdir()/paseo-attachments-*`,
  and client uploads land in `$PASEO_HOME/uploads/<id>/`.
- **There is no third RPC that serves an unscoped path**, so both clients fall back to a text
  reference card rather than shipping a broken `<img>`.

**Ship the missing capability. The security shape is the whole task, not a footnote.** The existing
RPCs refuse these paths _for a reason_: an RPC that serves any absolute path the caller names is an
arbitrary-host-file-read hole — `$PASEO_HOME` secrets, `~/.ssh`, anything on the machine. **Do not
build that, and do not widen `resolveScopedPath` to accept absolute paths.**

Two defensible designs; pick one and argue against the other by measurement:

1. **Serve by opaque id, never by path.** The client sends an attachment id (or `messageId` + index)
   and the daemon looks the path up from its own record of that timeline item. The client never
   names a filesystem path, so traversal is not expressible. Requires retaining the mapping.
2. **Serve by path, but only paths under a closed allowlist of roots** — the attachment temp dir and
   the uploads dir — resolved with the same realpath-then-containment discipline `resolveScopedPath`
   already uses. Cheaper; the containment check is then the only thing between a bug and an
   arbitrary read.

Whichever is chosen, each of these is pinned by its own test:

- **A path outside the permitted roots is refused, via `..` AND via a symlink that points out —
  tested separately.** A check that catches one and not the other is the classic half-fix.
- The caller must already have access to the session the attachment belongs to; serving another
  session's attachment is a cross-tenant read even when the path is legitimate.
- Nothing under `$PASEO_HOME` outside `uploads/` is reachable. That directory is the owner's live
  data.
- Served bytes equal uploaded bytes, checked by digest, not by eyeballing a rendered image.

Reuse `file_download_token_request`'s short-lived-token-plus-GET shape if it fits — both clients
already know that dance. Say so if it does not fit, rather than bending it.

Owns: `packages/server/src/server/file-upload/**`, the new serving path, and the protocol schema.
**Do not change either client in this task.**

- [ ] The design is chosen and argued against the other by measurement
- [ ] Traversal via `..` and via symlink are each refused, pinned as separate tests
- [ ] An attachment belonging to another session is refused
- [ ] Nothing under `$PASEO_HOME` outside `uploads/` is reachable, pinned by a test
- [ ] Served bytes match uploaded bytes by digest
- [ ] No client file is touched

#### T284 — Wire both transcript renderers to the attachment-serving capability

`labels: phase-9, area: web` · `wave: P9-W63` · `depends-on: T283`

**Owner request, second half:** a phone attachment shows in the web UI and vice versa. T283 ships
the daemon capability; this makes both surfaces render.

**Almost all of it is already done, deliberately.** Both renderers were built with an optional seam
so this is a wiring change, not a rewrite:

| Surface | File                                                           | Seam              |
| ------- | -------------------------------------------------------------- | ----------------- |
| Web     | `apps/web/src/features/transcript/message-attachments.tsx`     | `ResolveImageSrc` |
| Android | `apps/android/src/features/transcript/message-attachments.tsx` | `ResolveImageUri` |

Web's own header states the contract: any caller that can turn a path into a fetchable URL supplies
one, "and every image in this transcript will render it immediately with no change to this file."
Supply it at the route level. **If you find yourself editing the renderer bodies, stop and ask why**
— that is the signal the seam was the wrong shape, and it is a finding worth reporting rather than
working around.

**The cross-surface case is the acceptance criterion, and it must be exercised in both directions
separately.** Not "images render" — attach on **web** and see it on **Android**, then attach on
**Android** and see it on **web**. One direction passing tells you nothing about the other:
Android's `Image` takes a `uri`, web's `img` takes a `src`, and the bug being fixed is precisely a
client assuming a path it could reach locally.

**Do not fake it.** No data-URI shortcut that works for a locally-staged file and silently fails for
a remote one. If the capability cannot be exercised in this environment, say exactly what was and
was not run — the existing fallback reference card is a legitimate outcome for an unreachable file
and must not regress into a blank space or a broken `<img>`.

Also decide and argue **non-image attachments**: a PDF or `.zip` has no thumbnail, and the
established answer elsewhere in this product is a compact chip. Confirm that holds and record it
where the next reader will look.

Owns: `apps/web/src/features/transcript/**`, `apps/android/src/features/transcript/**`, and the
route-level wiring in each app. Do not touch the daemon.

- [ ] Web renders an attachment sent from Android
- [ ] Android renders an attachment sent from web
- [ ] Neither renderer body needed editing; only the seam was supplied
- [ ] An unreachable file still shows the reference card — no blank space, no broken image
- [ ] Non-image attachments render as a chip, and that decision is recorded
- [ ] What could not be exercised in this environment is stated plainly
- [ ] `resolveAttachmentForDownload` is registered in `CAPABILITIES` in this same commit

**Two notes added at the P9-P merge gate, after T283 shipped the daemon half.** First: the seam
table above is correct, but the _gap prose_ is not all where T283's report said it was. The
sentences asserting the capability was missing lived in web's `message-attachments.tsx` **and in
`apps/android/src/features/transcript/message-attachments-model.ts`** — not in Android's
`message-attachments.tsx`, which carried only a weaker "a future daemon RPC can be wired in here".
Both false sites were corrected at that gate and now carry `CORRECTED at the P9-P merge gate`
markers, so do not go looking for the old wording. Second, and the reason the new checkbox above
exists: registering `resolveAttachmentForDownload` was **blocked** while that prose still denied the
RPC — the gate proved by execution that a probe entry made `run-guard-capability-prose.mjs` exit 1
naming both client sites, which T283 had no scope to fix. That block is now lifted, which makes the
registration this task's duty rather than a follow-up.

#### T285 — Cover the fifth `PermissionKind` in `permission-recovery`'s own battery

`labels: phase-9, area: android` · `wave: P9-W64` · `depends-on: T278`

T278 added `"photo-capture"` to the `PermissionKind` union and to `KIND_LABEL`/`KIND_PURPOSE`, but
`permission-recovery.test.ts`'s exhaustive battery drives four loops off
`const KINDS: readonly PermissionKind[] = ["photos", "microphone", "camera", "notifications"]` — a
**subset**, which is type-legal because the array is typed `readonly PermissionKind[]` rather than
keyed off a `Record<PermissionKind, ...>`, so `tsc` cannot catch it. `permission-recovery.test.ts`
was outside T278's `Owns`, which explains how it happened.

**This is a check that cannot fail, not a live defect.** The P9-O gate executed
`describePermissionRecovery("photo-capture", s)` across all five states and all four invariants hold
today. The fix is one array element **plus** the shape change that stops a sixth kind slipping past
— derive the array from the union so omission is a type error, not a silent subset.

Owns: `apps/android/src/features/composer/permission-recovery.test.ts`, and
`permission-recovery.ts` only if the union must be exported differently to make the array derivable.

- [ ] `"photo-capture"` is covered by all four loops
- [ ] The array is derivable from the union, so a sixth kind cannot be omitted silently
- [ ] Deleting a kind from the source union is shown to fail the test, not just pass with it

#### T286 — Reconcile `cleanTranscript`'s leading-filler doc with its regex

`labels: phase-9, area: server` · `wave: P9-W65` · `depends-on: T277`

The module header and the function's own comment say `cleanTranscript` drops "ONE leading filler
token ... if the transcript starts with one". Executed at the P9-O gate:

| input                 | output          |
| --------------------- | --------------- |
| `"Um, hello there"`   | `"hello there"` |
| `"Uh hello"`          | `"hello"`       |
| `"Um... hello there"` | **unchanged**   |
| `"Um—hello"`          | **unchanged**   |

`^([A-Za-z]+)[,.:;!?]?(?:\s+(.*))?$` admits exactly one trailing punctuation character, and
Whisper-family models emit ellipses after fillers routinely. Low severity — a leading "Um..."
survives into the draft, which the user can delete — but the prose overstates the coverage.

**Either fix is acceptable; the mismatch is not.** Widen the match to the ellipsis and dash forms,
or narrow the doc to what the regex actually does. If widening, pin each new form as its own case
rather than one combined assertion, so a partial regression is visible.

Owns: `packages/server/src/server/speech/**`'s transcript cleanup and its test.

- [ ] The doc and the behaviour agree, whichever way it is closed
- [ ] Each admitted and each rejected form is pinned as its own case
- [ ] No previously-cleaned form regresses

#### T287 — Correct `resolveGroqSttCredentials`'s model-always-Groq-valid claim

`labels: phase-9, area: server` · `wave: P9-W66` · `depends-on: T277`

`config.ts` says `baseUrl` "is always Groq's real endpoint (never overridable) ... and `model`
**always** resolves to a Groq-valid whisper id". The first half is true — `GROQ_STT_BASE_URL` is
hardcoded and no env or persisted override reaches it. The second is false: `model` resolves as the
first defined of `env.GROQ_STT_MODEL` and the persisted `groq.stt.model`, falling back to
`DEFAULT_GROQ_STT_MODEL` — so `GROQ_STT_MODEL=whisper-1` produces exactly the value the sentence
promises can never happen. What _is_ true is the narrower clause immediately after it ("never
`OpenAISTT`'s own `"whisper-1"` **default**"). Same two-cases-one-cause shape as the P9-O headline,
one clause weaker.

Correct the sentence to the true, narrower claim — **or** make the strong claim true by validating
the resolved id against a known set and failing loudly on a non-Groq value. If the second is chosen,
argue why rejecting an operator's explicit override is the right behaviour, and pin the rejection.

Owns: `packages/server/src/server/speech/providers/openai/config.ts` and its test.

- [ ] The doc states only what the code guarantees, or the code guarantees what the doc states
- [ ] The `GROQ_STT_MODEL` override path is pinned either way
- [ ] The true narrower clause about `OpenAISTT`'s own default is preserved

#### T288 — Pin T283's `$PASEO_HOME` acceptance criterion, and drop the symmetry claim

`labels: phase-9, area: server` · `wave: P9-W67` · `depends-on: T283`

T283's brief listed four non-negotiables, "each pinned by its own test". Three are. The fourth —
**"Nothing under `$PASEO_HOME` outside `uploads/` is reachable"** — is satisfied by the design (the
serving path never touches `$PASEO_HOME` at all) but **no test asserts it**. Measured at the P9-P
merge gate: `grep -niE "paseo_home|paseoHome|uploads"` across both
`attachment-access.test.ts` and `attachment-access.posix.test.ts` returns nothing, and none of the
seven test titles concerns it.

That matters for a specific, foreseeable reason rather than as bookkeeping. T283's own design record
anticipates a later widening to add the uploads directory as a second permitted root. This is
exactly the criterion that would stop such a widening from exposing the rest of `$PASEO_HOME` — and
it is the one criterion nothing would catch. Write the test **now**, while the answer is still "the
code cannot reach there", so the widening has to keep it true.

The test: a path under a `$PASEO_HOME`-shaped root outside `uploads/`, **recorded on the requesting
agent's own timeline** (so membership is satisfied and containment is the only thing refusing it),
must be refused. Build the fixture root under a temp directory you create and remove; **never point
a test at the real `$PASEO_HOME`** — it is the owner's live data.

**Second half: the decision record overstates one thing, and this task corrects it.**
`attachment-access.ts`'s header says the two layers "fail closed independently" and that "a bug in
either layer alone still fails closed". The P9-P gate disproved the symmetric half by execution: the
containment layer admits **any** first-level `tmpdir()` child whose name starts with
`ATTACHMENT_TEMP_DIR_PREFIX`, and temp is world-writable, so an attacker-creatable
`tmpdir()/paseo-attachments-EVIL/x.png` passes containment. It is not exploitable today — only
`materializeProviderImage` can put a path on a timeline, and it is the sole producer of
`AgentTimelineImageRef` in the tree (verified) — so membership is what actually holds that door. But
the record claims a symmetry it does not have, and a future reader relying on it would
under-protect membership. State the real asymmetry: **membership is load-bearing; containment is
defence-in-depth, not an equal partner.**

Do **not** "fix" this by tightening containment to a set of directories the daemon itself created
unless you argue the cost: that means retaining state across process restarts, which the current
design deliberately avoids. Recording the asymmetry honestly may well be the right answer.

Owns: `packages/server/src/server/file-upload/**`.

- [ ] A `$PASEO_HOME`-shaped path outside `uploads/`, on the caller's own timeline, is refused by a test
- [ ] The fixture never touches the real `$PASEO_HOME`
- [ ] The "fail closed independently" / "either layer alone" claim is corrected to the measured asymmetry
- [ ] If containment is tightened instead, the retained-state cost is argued rather than absorbed

#### T289 — Register `resolveTranscribeClient` in `CAPABILITIES`

`labels: phase-9, area: tooling` · `wave: P9-W68` · `depends-on: T282`

T282 shipped `resolveTranscribeClient` (`apps/android/src/app-shell/session-route-daemon-clients.ts`)
— the mount wiring that makes voice transcription reachable in the app — and registered nothing, the
same T124 omission wave P9-O made four times and T281 was filed to close. T281's
`transcribeVoiceClip` entry does **not** cover this: that entry protects the wire method on
`DaemonClient`, which existed and was registered while the mount still passed nothing. "The client
can transcribe" and "the app actually asks it to" are two different capabilities, and the second is
the one whose absence prose kept asserting.

A FORWARD guard in T162's shape: no live denying sentence exists today — verified at the P9-P gate,
every remaining mention is either past-tense or correctly conditional on there being an active
daemon connection. So prove the entry can FIRE before trusting it, per `CLAUDE.md`'s T124 procedure:
append a denying sentence **in this entry's own wording** to a real tracked in-scope file, confirm
`run-guard-capability-prose.mjs` exits 1 naming it, restore from a scratchpad copy — never
`git checkout --` — and confirm exit 0 with `git status --porcelain` empty.

Two cautions specific to this entry. `resolveTranscribeClient` is declared in exactly one file, so a
plain bare-string member is enough — measure that rather than assuming it. And do **not** word the
phrases from the P9-P gate's own corrections in `Composer.tsx` and `voice-model.ts`: both now carry
`CORRECTED at the P9-P merge gate` markers and would be exempt, so a phrase lifted from them could
not fire — the inert-entry shape this repository has now hit at four different scope boundaries.

**Not in scope:** `resolveAttachmentForDownload`. T284 must register that one in the same commit that
supplies the two renderer seams, because the P9-P gate proved by execution that registering it while
the client prose still denied the RPC made the guard exit 1 on prose T283 had no scope to fix. That
prose is now corrected, so T284's registration is unblocked — it is still T284's, not this task's.

Owns: `scripts/ci/guard-capability-prose.mjs` and its test.

- [ ] `resolveTranscribeClient` is registered and watched firing before being trusted
- [ ] No phrase is lifted from a file carrying a `CORRECTED at the P9-P merge gate` marker
- [ ] The entry's shape is chosen from a measured declaration count, not assumed
- [ ] `run-guard-capability-prose.mjs` exits 0 on the real tree afterward

#### T290 — Ship real `AttachmentSourcePort` and `CameraCapturePort`, and wire both at the mount

`labels: phase-9, area: android` · `wave: P9-W69` · `depends-on: T278, T282`

**Owner request, and the dependency wall is now down.** The owner ran the install at `488c4dc`:
`expo-image-picker@~17.0.11` and `expo-document-picker@~14.0.8`, both the pins this app's own
`expo@54.0.37` gives in `apps/android/node_modules/expo/bundledNativeModules.json`. T282 shipped its
mount wiring for `transcribeClient` only and disclosed these two as blocked; this closes them.

**What is inert today, and why.** `Composer.tsx` resolves
`attachmentSource ?? createUnavailableAttachmentSourcePort()` and
`cameraCapture ?? createUnavailableCameraCapturePort()`, and the mount
(`apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx`) passes neither. Those stubs return
`"unavailable"` from both permission methods, `[]` from `pickFiles`, and `null` from `capturePhoto`.
So T278's whole feature — thumbnails, the compact chip, the capture action — cannot be reached in
production: `previewUri` is sourced from `PickedAttachmentFile.uri`, which nothing can populate.

**Read the ports' own contracts first** (`attachment-source-port.ts`, `camera-capture-port.ts`) and
implement to them. Do not change either interface to suit the library; if a genuine mismatch exists,
that is a finding worth reporting rather than a reason to reshape the port that four other files
already depend on.

**Two invariants this app already enforces, both of which this task can break silently:**

- **T83's one-permission-resolution-per-press.** `runCapturePress` and `runMicPress` each reach
  exactly one `resolvePermission` in the whole press call graph, and there are tests that fail if a
  second appears. `expo-image-picker` exposes its own
  `requestMediaLibraryPermissionsAsync`/`requestCameraPermissionsAsync`, so it is very easy to add a
  second resolution inside the port and satisfy every type. Prove the invariant still holds by
  mutation: add a speculative permission read inside your port, watch the named test go RED, then
  restore **from a scratchpad copy — never `git checkout --`**.
- **The single acceptance path.** Every picked, captured, dropped or pasted file must pass the same
  `evaluateAttachmentCandidate` ceiling. `stageAndUploadFiles` is the only caller with `limits`, and
  both press handlers already route through it. Do not add a second path.

**The permission strings are part of the deliverable, not a detail.** `expo-image-picker` ships an
`app.plugin.js` config plugin. Decide whether `app.config.ts` needs a `plugins` entry for the
media-library/camera permission copy, and if so write copy that says why this app wants the
permission — the same standard `permission-recovery.ts`'s `KIND_PURPOSE` already sets. Note that
`app.config.ts` is inside `isShippedSourcePath`'s scope (T246), so a capability shipped there is
visible to `guard-capability-prose`.

**Android 13+ media permissions changed shape** (`READ_MEDIA_IMAGES` replacing
`READ_EXTERNAL_STORAGE`). State which permission this actually requests on the minimum SDK this app
targets, measured from the resolved library rather than assumed from its README, and make sure
`permission-recovery.ts`'s `"photos"`/`"photo-capture"` copy is still accurate for it.

**No device exists in this environment.** So say plainly what could not be exercised. A port whose
real picker path has never run is still a large improvement over a stub that cannot — but it must not
be reported as proven. Do **not** fake a picker result to make a test pass.

**T124 applies, in the same commit.** This lands a capability whose absence is asserted in several
places — `attachment-source-port.ts`'s and `camera-capture-port.ts`'s own headers,
`Composer.tsx`'s `attachmentSource`/`cameraCapture` prop docs, `maestro/composer-inputs.yaml`'s
"attach still resolves the honest unavailable fallback", and the mount's own comment. Run the grep;
do not work from this list. Register the capability in `guard-capability-prose.mjs`'s
`CAPABILITIES` too, and prove the entry can fire.

Owns: `apps/android/src/features/composer/attachment-source-port.ts`,
`camera-capture-port.ts`, the new real port implementations, the session route mount,
`apps/android/app.config.ts` if a plugin entry is needed, and the `CAPABILITIES` entry.
**Do not edit `Composer.tsx`'s renderer body** — both props already exist.

- [ ] A real `AttachmentSourcePort` picks images and documents through the installed libraries
- [ ] A real `CameraCapturePort` captures a photo
- [ ] Both are passed at the mount, and the unavailable stubs remain as the injection default
- [ ] T83's one-resolution-per-press invariant is proven still held, by mutation
- [ ] No second path bypasses `evaluateAttachmentCandidate`'s ceiling
- [ ] The permission this actually requests on the targeted SDK is stated, measured not assumed
- [ ] Permission copy exists and says why the app wants it
- [ ] Every prose site asserting these ports do not exist is corrected in this same commit
- [ ] The capability is registered in `CAPABILITIES` and watched firing
- [ ] What could not be exercised without a device is stated plainly

#### T291 — Re-pin `expo-audio` to the version this app's own expo bundles

`labels: phase-9, area: android` · `wave: P9-W70` · `depends-on: T276`

`apps/android/package.json` declares `expo-audio: "~1.0.13"` (resolving 1.0.16). This app's own
`expo@54.0.37` gives `expo-audio -> ~1.1.1` in
`apps/android/node_modules/expo/bundledNativeModules.json` — measured at the P9-P follow-up, while
verifying the picker install.

**This is the exact rule `expo-audio-voice-capture-port.ts`'s own header states** and cites as the
reason to read _this app's_ `bundledNativeModules.json` rather than the differently-versioned `expo`
hoisted into the repo root. The rule was followed for the two pickers and not for `expo-audio`.

**Why it matters beyond tidiness, and what to check before assuming it does.** A bundled-native-module
version below what the installed `expo` expects is the classic source of a native build that succeeds
locally and fails, or misbehaves, in an EAS build — the native module and the SDK's expectations are
compiled together. `run-guard-version-drift.mjs` does **not** catch it (verified: it exits 0 on the
current tree), so nothing in CI will report this.

Establish first whether the drift is real for THIS app rather than acting on the mismatch alone:
`expo-audio@1.0.16`'s own peer/`expo` constraint, and whether `npx expo install --check` (read-only)
reports it. If the drift turns out to be benign for SDK 54, record that finding and close the task —
do not change a dependency to silence a mismatch that does not bite.

**The version bump itself needs the owner** (`npm install` is refused here). If a bump is the answer,
state the exact single-line command and stop; then re-verify
`apps/android/src/features/voice/expo-audio-voice-capture-port.ts` against the new version's
`Audio.types.d.ts`, because that module's decision record rests on `RecorderState`/`RecordingStatus`
exposing no sample-rate or channel-count field. **If 1.1.x adds either, that changes T276's
"unmeasurable" conclusion** and the header must be rewritten rather than left standing.

Owns: `apps/android/package.json`'s `expo-audio` pin (owner-run), and
`expo-audio-voice-capture-port.ts`'s header if the API surface moved.

- [ ] Whether the drift actually bites SDK 54 is established, not assumed from the mismatch
- [ ] If a bump is needed, the exact command is stated for the owner rather than attempted
- [ ] After any bump, `RecorderState`/`RecordingStatus` are re-read and T276's conclusion re-checked
- [ ] If the drift is benign, that is recorded and the task closes without a change

**Measured at `89b58c5` — a bump is warranted; not attempted (`npm install` is refused here).**

`expo-audio@1.0.16`'s own `package.json` declares `"expo": "*"` in `peerDependencies` — npm's
own dependency resolver enforces nothing here, so the mismatch is invisible to `npm ls`, to
`npm install`, and to `run-guard-version-drift.mjs` alike. The only thing that actually knows
this pin is wrong is Expo's own compatibility data. Run foreground from `apps/android`:

```
$ npx expo install --check
The following packages should be updated for best compatibility with the installed expo version:
  expo-audio@1.0.16 - expected version: ~1.1.1
  expo-secure-store@57.0.3 - expected version: ~15.0.8
  @types/react@19.2.18 - expected version: ~19.1.10
Your project may not work correctly until you install the expected versions of the packages.
Found outdated dependencies
```

(The other two flagged packages are outside this task's scope — its `Owns` line names only the
`expo-audio` pin.)

Nothing in this repository's CI can observe the drift failing **today**, and that was checked
rather than assumed: `.github/workflows/ci.yml`'s `android-tests` job runs `expo prebuild
--platform android --no-install` (config-plugin codegen only, no native compile) and
`apps/android`'s own JS-level typecheck/test suite, neither of which touches expo-audio's
compiled native code — `expo-audio-voice-capture-port.ts`'s own header already documents that
its real `expo-audio` binding is never loaded under vitest (`vi.mock` before a dynamic
`import()`). The two workflows that DO run a real native compile
(`android-apk-release.yml`, `android-maestro-e2e.yml`) both intentionally no-op their
`eas build` step today, pending the `EXPO_TOKEN` secret those files' own headers say is not yet
configured (tracked as T44). So the drift cannot be caught failing by anything that currently
runs, in either direction — this is a latent-risk judgment call, not a reproduced failure.

Given that, the call is made on Expo's own signal rather than on a semver reading of "only a
minor version, probably fine": `npx expo install --check` exists precisely because Expo's SDK
bundles native modules as a tested set, in a way plain semver peer ranges (`"expo": "*"` here)
cannot express, and it is the tool this task's own brief named as authoritative. It reports
this pin as outdated for the installed `expo@54.0.37`. Downloaded `expo-audio@1.1.1`'s real
tarball via `npm pack expo-audio@1.1.1` into the scratchpad (a read-only registry fetch —
no `package.json`/`package-lock.json` edit, no install into this repository's `node_modules`)
to check what the bump would actually change: the native `android/build.gradle` diff is
additive only (`androidx.appcompat` `1.7.0` → `1.7.1`, two new `androidx.media3` deps for
background-audio session/UI support introduced between 1.0.16 and 1.1.1) — nothing removed,
no `compileSdkVersion`/`targetSdkVersion` change. That is consistent with "does not currently
crash a build" but is not proof a real EAS compile would tolerate it; only a real EAS build,
which this repository cannot run today, tells you that for certain.

**The `Audio.types.d.ts` half of the checklist — the one this task can answer with certainty.**
Diffed the installed 1.0.16 copy against the downloaded 1.1.1 tarball's copy byte-for-byte:
`RecorderState` (`canRecord`/`isRecording`/`durationMillis`/`mediaServicesDidReset`/
`metering`/`url`) and `RecordingStatus` (`id`/`isFinished`/`hasError`/`error`/`url`) are
**identical field sets in both versions** — every diffed change between the two files sits in
unrelated playback/interruption-mode/background-recording types
(`InterruptionMode`/`AudioMetadata`/`allowsBackgroundRecording`), never in either recorder
type. **T276's "unmeasurable" conclusion in `expo-audio-voice-capture-port.ts`'s header is
unaffected by this bump** — sample rate and channel count still have no JS-level API to read
back in 1.1.1, so that header needs no edit, before or after the owner runs the install below.

**The exact command for the owner**, scoped to this one package only (`--fix` would also touch
the other two flagged packages, which this task does not own):

```
cd apps/android && npx expo install expo-audio
```

After running it, re-run `npx expo install --check` from `apps/android` and confirm `expo-audio`
no longer appears in its output; no further header re-check is needed unless that command's own
resolved version differs from `~1.1.1` above, in which case re-diff `Audio.types.d.ts` the same
way this entry did.

Owns note: no file under `apps/android` was edited by this measurement — `package.json`'s pin
stays owner-run per the `Owns` line above, and the header needed no correction because the API
surface it depends on did not move.

#### T292 — Slash-command completion in the Android composer

`labels: phase-9, area: android` · `wave: P9-W71` · `depends-on: none`

**Owner request.** Typing `/` in the prompt bar must offer the available commands. It does in the
web UI; on Android it is plain text today.

**Measured, not assumed:** `apps/android/src/features/composer/` contains no slash-command module,
and nothing in it references a command list, a `/` prefix, or a picker. Web has
`use-slash-commands.ts` and its test; Android has no counterpart. So this is a missing feature, not
a broken one — nothing regressed.

**The daemon side already exists and is shared.** The list is Pi's own, fetched over
`get_commands` (`packages/server/src/server/agent/providers/pi/agent.ts`'s `commandsRpcName` and
`runtimeSession.getCommands()`), surfaced to clients as `list_commands_response`. **Do not hard-code
a command set** — that would go stale the moment the owner installs another extension, and this
repository has 39 of them.

**Follow web's model rather than inventing one.** `apps/web/src/features/composer/use-slash-commands.ts`
already settled every question this task would otherwise re-litigate, and its decisions are
documented in its own header:

- `commands` mirrors the daemon's list via the turn client's `listCommands`, starting empty and
  **staying empty when the client omits it** — the same "no client yet" optional seam
  `onQueueUpdate`/`abort` use. Android must degrade the same way rather than throwing.
- It re-fetches when the agent or client identity changes.
- The palette opens when the whole draft is `/` plus a space-free token — i.e. before arguments are
  typed — and also opens manually for discoverability.
- **It never blocks a send.** An unrecognized slash command is sent as plain text; there is no
  client-side command validation. Preserve that exactly: a picker that can swallow a submission is
  worse than no picker.

Read that file first and lift the _model_, not the JSX. If the shared decisions belong in
`packages/frontend-core` so both apps consume one implementation, argue that — but do not move web's
hook there as a drive-by; either propose it with the cost stated, or duplicate the model deliberately
and say why.

**Android-specific work this task actually owns:** the picker surface itself. It must sit above the
prompt bar without covering the input (the same constraint the metadata pill menus solved), survive
the IME appearing, be dismissible without sending, and be operable by tap. Check
`composer-focus-model.ts`'s `COMPOSER_LAYOUT_CONTRACT` before choosing a placement.

**No device exists in this environment.** Prove the model with unit tests and say plainly what
needed a device.

Owns: `apps/android/src/features/composer/**` and the turn-client wiring it needs.
**Do not edit `apps/web`** — its implementation is the reference, not the deliverable.

- [ ] Typing `/` offers the real command list, fetched from the daemon
- [ ] No command set is hard-coded anywhere
- [ ] A client without `listCommands` degrades to an empty palette, not an error
- [ ] The palette never blocks or alters a send; an unknown command still sends as text
- [ ] The picker does not cover the input, and survives the IME
- [ ] Whether the shared model belongs in `frontend-core` is argued either way
- [ ] What could not be exercised without a device is stated plainly

#### T293 — Serve the composer's current text to an extension (`getEditorText`)

`labels: phase-9, area: server` · `wave: P9-W72` · `depends-on: none`

**Owner-visible symptom:** `prompt-arbitrage` does nothing in the web UI or the Android app. Typing
`/` plus a prompt is supposed to rewrite it in place; it works in Pi's TUI and is inert on both of
this product's surfaces.

**The cause is an asymmetry in the tier-2 UI bridge, measured at the P9-Q follow-up.**
`packages/server/src/server/agent/providers/pi/agent.ts` handles `set_editor_text`/`setEditorText`
— pushing text INTO the composer — and handles nothing for reading it back. `getEditorText` and
`pasteToEditor` appear nowhere in `packages/server/src` or `packages/protocol/src` at all (grepped,
zero hits), so they fall through to the tier-2 default and are dropped with a one-time
`[pi] unknown extension_ui_request method dropped: ${event.method}` warning.

`prompt-arbitrage.ts` calls `ctx.ui.getEditorText` to read what the user typed, rewrites it, and
calls `setEditorText` to put it back. The second half works. The first does not, so the rewrite has
no input. `subagents.ts` also calls `getEditorText`, but has a bridge path and does not depend on
it.

**This is a request/response, not a fire-and-forget push, and that is the whole difficulty.** Every
tier-2 method handled today flows daemon → client. This one needs client → daemon → Pi, with a
reply correlated back to the extension's pending call, and a timeout for a client that never
answers. Design it deliberately:

- Where does the answer come from when **two** clients are attached, each with a different draft?
  Pick an answer and defend it — the focused/most-recent client, the requesting session's, or refuse
  ambiguity. Silently picking one is the failure a future reader will not forgive.
- What happens with **no** client attached? The extension must get a definite outcome, not hang.
- A malicious or buggy extension must not be able to poll composer contents at will. State whether
  this needs rate limiting or a capability gate, and if not, why not.

**Decide `pasteToEditor` in the same task**, since it is the same family: it inserts at the cursor,
where `setEditorText` replaces wholesale. Either implement it or record a will-not-implement with
the reason — leaving it as a silent drop after this task has touched the area is the outcome to
avoid.

**Verify the fix against the real extension, not only a fixture.** `prompt-arbitrage`'s bare-`/`
flow is the acceptance case. If it cannot be exercised without a live daemon (this environment
forbids starting one), say exactly what was and was not run.

Owns: the tier-2 handler in `packages/server/src/server/agent/providers/pi/agent.ts`, the protocol
request/response pair, and the composer read on both clients.

- [ ] An extension calling `getEditorText` receives the composer's current text
- [ ] The multi-client and no-client cases each have a defined, defended answer
- [ ] A client that never replies times out rather than hanging the extension
- [ ] `pasteToEditor` is implemented or refused with a recorded reason
- [ ] `prompt-arbitrage`'s rewrite is exercised, or its non-exercise is stated plainly
- [ ] No new unknown-method drop is introduced in the area this task touches

#### T294 — Decide the two legacy storage permissions `expo-image-picker` merges in

`labels: phase-9, area: android` · `wave: P9-W73` · `depends-on: T290`

`apps/android/app.config.ts` declines `expo-image-picker`'s config plugin on privacy grounds — at
default options it adds `android.permission.RECORD_AUDIO` for a video-capture feature this app never
uses — and relies on Android's manifest merger for the `CAMERA` permission it does need. That
reasoning is sound as far as it goes.

**What the P9-Q merge gate measured is that the same mechanism admits more than `CAMERA`.** Read
directly from `node_modules/expo-image-picker/android/src/main/AndroidManifest.xml`, that bundled
manifest declares **three** permissions — `CAMERA`, `WRITE_EXTERNAL_STORAGE` and
`READ_EXTERNAL_STORAGE` — none carrying a `maxSdkVersion`. `apps/android/app.config.ts` declares no
`permissions` and no `blockedPermissions` (grepped: zero hits), so the merger admits all three into
the shipped manifest. Installing the dependency alone therefore added two legacy storage permissions
silently, by the very mechanism the decision record praises.

**This is a decision with a real cost either way, which is why the gate recorded it rather than
taking it.** `blockedPermissions` would strip them, and on modern Android that is very likely
correct — scoped storage means `READ_EXTERNAL_STORAGE` is ignored for media on API 33+, and the photo
picker needs no storage permission at all (the gate confirmed `getMediaLibraryPermissions` returns
`emptyArray()` on API 33+). But this app's `minSdkVersion` is what settles it: on an older device the
document picker's copy-to-cache path may genuinely need read access, and blocking it would break
attaching a file for exactly the users least able to diagnose it.

So: **establish this app's real `minSdkVersion`** (from the Expo SDK's own default for `expo@54`
unless `app.config.ts` overrides it — measure, do not assume), then decide. Either add
`blockedPermissions` and pin a test or a documented manifest check proving the shipped manifest no
longer carries them, or accept them explicitly with the SDK range that requires them stated. **Do
not leave the decision record claiming a privacy posture the manifest does not have.**

If a real device or an APK inspection is needed to confirm what actually ships, say so — T236 is
already the open owner-blocked task for EAS archive inspection, and this may need to wait on it
rather than be guessed.

Owns: `apps/android/app.config.ts` and any guard or test pinning the resulting permission set.

- [ ] This app's real `minSdkVersion` is measured, not assumed
- [ ] The two storage permissions are either blocked or explicitly accepted with a stated reason
- [ ] If blocked, something pins that the shipped manifest no longer carries them
- [ ] The `RECORD_AUDIO` conclusion is left intact — it is the plugin's, not the bundled manifest's
- [ ] Whether an APK inspection is required is stated rather than worked around

#### T295 — Settle whether the capability-prose denial scan should reach package source

`labels: phase-9, area: tooling` · `wave: P9-W74` · `depends-on: none`

The P9-Q merge gate found `packages/client/src/daemon-client.ts` asserting _"Not yet called by
either app"_ about `requestAttachmentDownloadToken` — a sentence T284 falsified in the same wave that
wrote it, and one **no guard could have caught**. `guard-capability-prose`'s denial scan is
`isAppSourcePath`'s scope, which admits `apps/web/src`, `apps/android/src`, `scripts/ci`,
`packaging/**`, `docs/**`, `.github/workflows/*.yml`, `apps/android/maestro/*.md|*.yaml` and
`apps/<name>/app.config.ts` — and deliberately **not** a package's own `src` tree. That is
`isShippedSourcePath`'s scope, and conflating the two is the error `CLAUDE.md` already documents at
T147, T216, T217 and T224.

**This task decides the question, once, by measuring — it does not assume the answer is "widen".**
The honest case against widening is strong and must be argued rather than dismissed: `packages/*/src`
is where the wire protocol and both clients live, so it is dense with legitimately-conditional prose
("no shipped `DaemonClient` implements this", "not wired by any caller yet") that is _true_ at the
time of writing and becomes false silently. That is exactly the population this guard exists for —
and also exactly the population most likely to produce false positives and get the guard disabled,
the failure mode `CLAUDE.md`'s T217 section describes.

Measure before choosing:

1. Run the existing `CAPABILITIES` entries' denying phrases against every `packages/*/src` file and
   count real hits versus false positives, classifying each by hand. A widening that would fire on
   correct prose today is not a widening.
2. Count how many past waves' falsified-prose findings sat in package source and were caught only by
   a human gate. One instance (this one) is weak evidence; a pattern is not.
3. If widening, check whether `SELF_REFERENTIAL_DENIAL_EXCLUSIONS` or a ledger-style exclusion is
   needed for any package file that narrates its own history, the way `docs/issues-from-plan.md` is
   excluded.

**A will-not-widen is an acceptable, possibly correct outcome** — but it must be recorded in
`CLAUDE.md` beside the existing widenings with the measurement that justifies it, so the next gate
that finds a stale sentence in package source fixes it by hand instead of re-proposing this.

Owns: `scripts/ci/guard-capability-prose.mjs`, its test, and the `CLAUDE.md` paragraph recording the
decision.

- [ ] The false-positive rate of widening is measured against real package source, hand-classified
- [ ] The decision is recorded either way, with its measurement, in `CLAUDE.md`
- [ ] `isAppSourcePath` and `isShippedSourcePath` are each called on real paths, never inferred
- [ ] If widened, every entry is re-proven able to fire and the full-tree scan still exits 0

#### T32A1 — Build the Android connect form

`labels: phase-5, area: android` · `wave: P5-W4` · `depends-on: T32S1C`

Build the connect screen with host address and profile selection.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

- [ ] Invalid input is rejected with a visible named error
- [ ] Touch targets are at least 48dp
- [ ] TalkBack announces field labels and errors

#### T32A1B — Wire the Android connect form to a live DaemonClientLifecycle

`labels: phase-5, area: android` · `wave: P5-W6` · `depends-on: T32A1, T19A`

**No Phase-5 task owned this seam, and three later tasks silently assumed it.** T32A1 shipped
`ConnectForm` with `onSubmit` optional and deliberately unwired; `T32A2` stores credentials;
`T32A3`-`T32A6` layer pairing, QR and relay profiles on top. None of them constructs a client.
The consequence is measurable today: `grep -rn "@picompanion/client\|DaemonClient"
apps/android/src` returns **only comments** — nine of them, each deferring to some other task —
and `apps/android/src/platform/fake-network.ts` is still the only source of connection state.
`T32B2` ("Create and open round-trip"), `T32B3` (resume) and `T33B2` (steer/abort round-trip)
all read as if a connection exists. It does not.

This task builds it, and only it. The client itself is already done: `T19A` shipped
`DaemonClientLifecycle`, `ClientCapability`, and the feature gates in
`packages/frontend-core/src/connection/`. What is missing on Android is the platform half —
the equivalent of web's `browser-probe-transport.ts` + `attempt-host-connection.ts` +
`authenticate-host.ts`, which are the files to read first (`apps/web/src/features/connect/`).
Read them for the shape of the seam, not to copy: React Native's `WebSocket` is not the
browser's, and Android has no `navigator.onLine`.

`ConnectForm.onSubmit` becomes wired, and `use-connection-status.ts` stops reading the fake
adapter. `apps/android/src/platform/fake-network.ts` may be deleted only if nothing else
imports it; check before removing.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

- [ ] Submitting a valid `ws://host:port` constructs a real `DaemonClientLifecycle` and
      completes the hello exchange, proven against the recorded fixtures `T19A` already uses
- [ ] Connection failures (refused, timed out, wrong daemon key) surface as distinct named
      errors in the form, not as one generic failure
- [ ] `use-connection-status.ts` reports the real lifecycle state; the fake network adapter is
      no longer on the production path
- [ ] The transport is injectable, so every test above runs without a socket and without the
      emulator. Emulator proof of a live connection belongs to `T37` and `T59`, not here
- [ ] No test imports a module that reaches `react-native` — that fails with `RolldownError` on
      `node_modules/react-native/index.js:1:0`. Keep the wiring in an RN-free module

#### T32A2 — Store credentials in SecureStore

`labels: phase-5, area: android` · `wave: P5-W5` · `depends-on: T32A1`

Persist credentials and relay secrets only in SecureStore.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

**One unowned `P5-W4` finding is assigned here**, because this task is the next to touch
`features/connect/` and `ConnectForm` depends on both primitives:
`CRITICAL_INTERACTIVE_PRIMITIVES` in `apps/android/src/ui/primitives/touch-targets.test.ts` is
exactly `Button, IconButton, Link, Toggle, Chip, SearchField, TextField, TextArea`. `Select`
and `Banner` are absent. Both currently satisfy 48dp by hand (`Select.tsx:85,105`;
`Banner.tsx:59,71`) but nothing guards them, and `T32A1`'s report wrongly claimed they were
covered.

- [ ] Credentials and relay secrets live only in SecureStore
- [ ] Nothing sensitive is written to AsyncStorage or logs
- [ ] Logout clears stored material
- [ ] `Select` and `Banner` are in `CRITICAL_INTERACTIVE_PRIMITIVES`, and the added coverage is
      mutation-checked — shrink each primitive's `minHeight` below 48 and confirm the test fails

#### T32A3 — Apply ConnectionOffer pairing on Android

`labels: phase-5, area: android` · `wave: P5-W7` · `depends-on: T32A2`

Parse and apply connection offers, rejecting malformed and expired ones.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

- [ ] A valid offer pairs successfully on the emulator
- [ ] Malformed and expired offers give distinct errors
- [ ] Parsing is unit-tested against shared fixtures

#### T32A4 — Add QR camera pairing

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T32A3`

Add camera-based QR pairing with graceful permission handling.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

**Also fix the connection feed, which only this grant can reach.** `connection-shell.tsx`
constructs its own `DaemonConnectionStore` inside a local `useMemo` rather than using the
app-wide `AppCore.connection` that T32S3 established. Until that is changed, a successful
`ConnectForm` submission never reaches `AppCore`, so **every `sessionService` method rejects with
"Not connected to a daemon" and the session route's status never reaches `"connected"`** - which
makes the whole app unusable end to end, however green its unit tests are. The store lives in
`app-shell/core.ts` (T32S4's grant); consuming it is a change inside `features/connect/`, so it
is this task's.

- [ ] A scanned offer completes pairing
- [ ] Denied camera permission falls back to manual entry with an explanation
- [ ] The permission prompt is requested at the right moment, not on launch
- [ ] A successful `ConnectForm` submission updates `AppCore.connection`, and a session opened
      afterwards reaches the daemon rather than rejecting "Not connected to a daemon"

#### T32A5 — Support relay host profiles on Android

`labels: phase-5, area: android` · `wave: P5-W11` · `depends-on: T32A4`

Support relay profiles alongside direct ones with a distinct error taxonomy.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

- [ ] Direct and relay pairing both succeed on the emulator
- [ ] Wrong password and wrong daemon key produce different errors
- [ ] Connection path is visible to the user

#### T32A6 — Build first-run onboarding

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T32A5`

Build onboarding, handling denied permissions without dead ends.

Owns: `apps/android/src/features/connect/`. No other task in this wave touches those files.

- [ ] Onboarding completes on a clean install
- [ ] Every denied permission has an explained recovery path
- [ ] Onboarding is skipped on subsequent launches

#### T32B1 — Render the Android session list

`labels: phase-5, area: android` · `wave: P5-W4` · `depends-on: T32S1C`

Render the session list with empty and error states.

Owns: `apps/android/src/features/sessions/`. No other task in this wave touches those files.

**T32S1C already created this directory** (wave P5-W3), because its own acceptance criterion
required every route stub to import from a matching `features/*` barrel and none of these
directories existed. Expect a populated directory with an existing barrel export, not an empty
one. The placeholder screen inside it has **no test of its own** — the only coverage touching
it is the route file's source-text regex, which never reaches the screen's logic (demonstrated:
mutating `files-screen.tsx`'s `path.join("/")` left all 225 Android tests green). Replacing the
placeholder body wholesale is this task's job; so is giving the replacement real tests.

- [ ] Sessions render with status in text as well as colour
- [ ] Rows are at least 48dp and TalkBack reachable
- [ ] Empty and error states render from shared primitives

#### T32B2 — Add Android session create and open

`labels: phase-5, area: android` · `wave: P5-W5` · `depends-on: T32B1`

Add session creation and opening from the device.

Owns: `apps/android/src/features/sessions/`. No other task in this wave touches those files.

**There is no live connection on Android when this task runs.** `T32A1B` (wave `P5-W6`)
builds it. Code against an injected session-service interface the way `T32B1` did, and prove
create/open/failure against a fake — the emulator round-trip is `T37`'s and `T59`'s to prove,
not this task's. Do not add a criterion that can only be checked by hand.

**Two `P5-W4` merge findings land here**, because this is the next task to touch
`features/sessions/`:

1. `sessions-model.ts`'s `SessionListState` ready branch is missing web's `stale?: boolean`
   (added by `T27B6` for plan.md §7.4's "restore a stale cached tail without marking it
   authoritative"). The Android copy silently dropped it, so Android has no way to represent,
   let alone surface, a stale list. `T37B` ("Mark cached data stale until catch-up") is the
   task whose criteria depend on the field existing.
2. `sessions-model.ts` duplicates `apps/web/src/features/sessions/{types.ts,
status-presentation.ts,group-sessions.ts}` — disclosed in its own doc comment and justified
   by `packages/frontend-core/src/sessions/` still being the `T14` stub. If that stub is real
   by the time this task runs, collapse the two copies into it; if not, say so and keep the
   divergence documented.

- [ ] Create and open round-trip against an injected fake session service, with no socket and
      no emulator
- [ ] A failed create keeps typed input
- [ ] Opening loads the session timeline
- [ ] `SessionListState`'s ready branch carries `stale?: boolean` and matches web's shape,
      cross-referenced from `T37B`
- [ ] Either the duplicated session model is promoted into `packages/frontend-core`, or the
      commit message records why the `T14` stub still cannot hold it

#### T32B3 — Add Android session resume and cold-start restore

`labels: phase-5, area: android` · `wave: P5-W6` · `depends-on: T32B2`

Resume sessions and restore the last opened session on cold start.

Owns: `apps/android/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Cold start restores the last opened session
- [ ] Resume restores timeline and queue state
- [ ] A missing session fails with a clear message

#### T32B4 — Add Android session archive and delete

`labels: phase-5, area: android` · `wave: P5-W7` · `depends-on: T32B3`

Add archive and delete with confirmation.

Owns: `apps/android/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Archive and delete round-trip from the emulator
- [ ] Delete requires explicit confirmation
- [ ] The list reconciles with the daemon after the change

#### T32B5 — Survive network path switches

`labels: phase-5, area: android` · `wave: P5-W8` · `depends-on: T32B4`

Keep list and session state correct across Wi-Fi, cellular and relay switches.

Owns: `apps/android/src/features/sessions/`. No other task in this wave touches those files.

**T32S3 has landed and half of this block is cleared.** `AppCore.network` is now a real
`PollingNetworkReachability` - `fetch`-HEAD probing on an injected scheduler, with in-flight
de-duplication and change-only publishing - so `network-online` fires for real and the resume
controller sees it.

**The other half is not cleared, and it bounds two of the three criteria below.** That adapter
reports `kind` as only `"unknown"` or `"none"`, so **`network-path-change` can still never
fire**, and `getProbeUrl()` returns `null` today so in production it probes nothing. A real
path-kind source on Android means `@react-native-community/netinfo`, which is not installed and
which no task in Phase 5 is currently permitted to install.

So scope this task honestly: prove the `features/sessions/` behaviour against injected
`NetworkStatus` values, including a `wifi -> cellular` transition the adapter cannot yet produce,
and name in your report the task that must add the dependency. **Do not work around the adapter
inside `features/sessions/`, and do not claim a real path switch was observed.**

- [ ] The list survives a Wi-Fi to cellular switch
- [ ] No duplicate or dropped rows after gap recovery
- [ ] The active connection path is visible

#### T33A1 — Build the compact transcript header and status strip

`labels: phase-5, area: android` · `wave: P5-W4` · `depends-on: T32S1C`

Build the §9.2 header and status strip above the transcript.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Header and status strip render session and connection state
- [ ] Status is conveyed in text as well as colour
- [ ] TalkBack announces status changes

#### T33A2 — Render Android messages and streaming text

`labels: phase-5, area: android` · `wave: P5-W6` · `depends-on: T33A1`

Render user, assistant and streaming messages in compact layout.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Streaming text updates incrementally without full re-render
- [ ] Message roles are distinguishable without colour alone
- [ ] Rendering matches the web semantics on shared fixtures

#### T33A2B — Supply the Android frame-clock platform implementation

`labels: phase-5, area: android` · `wave: P5-W5` · `depends-on: T32S1C, T45A2`

Split out of the original T33A2, whose fourth criterion (added in the ompweb review) required
a platform-specific frame-clock implementation. That implementation lives in
`apps/android/src/platform/` — a different directory, and a platform-interface implementation
rather than feature rendering — from the message-rendering work T33A2 otherwise owns. This
mirrors T45A3, which did the equivalent wiring for web.

Owns: `apps/android/src/platform/`. No other task in this wave touches those files.

- [ ] The Android shell supplies a T45A1 frame-clock implementation and passes the same
      batching contract test the web implementation (T45A3) passes

#### T33A3 — Render Android thinking sections

`labels: phase-5, area: android` · `wave: P5-W7` · `depends-on: T33A2`

Render collapsible thinking with Reanimated motion from shared tokens.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Thinking expands and collapses with correct TalkBack state
- [ ] Reduced-motion is honoured
- [ ] Live thinking shows the shimmer treatment

#### T33A4 — Render Android tool calls and unknown-tool card

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T33A3`

Render tool calls and the safe generic card for unknown tools.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Known tools render their specific card
- [ ] Unknown tools render the safe generic card, never raw payload
- [ ] Tool status is text as well as colour

#### T33A5 — Render Android images, attachments, and diffs

`labels: phase-5, area: android` · `wave: P5-W12` · `depends-on: T33A4`

Render images, attachments and diffs in compact layout.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] Images and attachments render with accessible names
- [ ] Diffs render with counts in mono tabular figures
- [ ] Oversized payloads are bounded

#### T33A6 — Virtualize the Android transcript

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T33A5`

Virtualize the transcript within a bounded window.

Owns: `apps/android/src/features/transcript/`. No other task in this wave touches those files.

- [ ] A long recorded session stays responsive on the emulator
- [ ] The window stays bounded during streaming
- [ ] Follow-tail behaves correctly

#### T33B1 — Build the Android bottom composer

`labels: phase-5, area: android` · `wave: P5-W4` · `depends-on: T32S1C`

Build the bottom composer on the PromptBar recipe.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] A prompt submits and appears optimistically
- [ ] Touch targets are at least 48dp
- [ ] TalkBack announces the composer and its actions

#### T33B2 — Add Android steer, follow-up, and abort

`labels: phase-5, area: android` · `wave: P5-W5` · `depends-on: T33B1`

Add steering, follow-up and abort.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

**There is no live connection on Android when this task runs** — `T32A1B` (wave `P5-W6`)
builds it. `T33B1`'s `composer-model.ts` is RN-free and already applies state synchronously
before invoking `onSubmit`; extend that model and prove queue transitions against an injected
fake, not a socket. Anything that needs a real turn to observe belongs to `T37` or `T59`.

- [ ] Steer and follow-up produce the correct queue state, proven against an injected fake
      turn service with no socket and no emulator
- [ ] Abort transitions the model out of the running state and cancels any queued follow-up
- [ ] Each control has a distinct accessible name, and `ComposerEntryRow` stays un-`accessible`
      so the Retry `Button` remains reachable (`T33B1` regression test)

#### T33B3 — Add Android queue controls

`labels: phase-5, area: android` · `wave: P5-W6` · `depends-on: T33B2`

Surface queue depth and mode with controls.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] Queue depth and mode are visible and live
- [ ] Mode changes round-trip from the composer
- [ ] Queue state is text, not colour alone

#### T33B4 — Fix IME and sheet keyboard ownership

`labels: phase-5, area: android` · `wave: P5-W8` · `depends-on: T33B3`

Apply the §9.3 rule that Portal-based sheets keep composer keyboard ownership.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] Opening a sheet does not steal or break composer keyboard focus
- [ ] Focused keyboard tests cover sheet open, close and rotate
- [ ] The composer stays visible above the IME

#### T33B5 — Add Android approvals in-app

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T33B4, T32S5`

Build the in-app approval surface.

Owns: `apps/android/src/features/approvals/`. No other task in this wave touches those files.

**Moved from P5-W9 to P5-W10 because its third criterion was unachievable in W9.**
`ui/primitives/Sheet.tsx` renders a React Native `Modal` - the detached-window pattern plan.md
§9.3 exists to forbid - so a sheet opening takes keyboard ownership away from the composer no
matter what this task does, and `ui/primitives/` is not in this grant. **T32S5 (P5-W9) now owns
that file** and replaces the `Modal` with a Portal. Prove the third criterion against T33B4's
`resolveFocusOwner`; if T32S5 could not complete the Portal, say so and do not claim the
criterion.

- [ ] A permission request can be approved and denied in-app
- [ ] The decision round-trips and the turn continues
- [ ] Sheets respect the keyboard ownership rules, proven against `resolveFocusOwner` rather
      than by inspection

#### T33B6 — Add haptic patterns

`labels: phase-5, area: android` · `wave: P5-W12` · `depends-on: T33B5`

Add the §9.3 haptic patterns for approval, finished, error and blocked.

Owns: `apps/android/src/platform/haptics/` — the haptics module and its test. The §9.3
patterns fire on **approval, finished, error and blocked**, which are raised from the
transcript and approvals surfaces, not from the composer; an earlier revision of this task
claimed `apps/android/src/features/composer/`, which is neither where the triggers live nor a
directory this task should hold while T33B7 is editing it. Call sites elsewhere may import
this module, but this task owns only the module. No other task in this wave touches it.

- [ ] Each of the four §9.3 states fires its documented pattern, asserted by unit tests against
      a fake vibration platform — no device or emulator needed for this criterion
- [ ] Haptics are suppressed when the system setting disables them
- [ ] Haptics never substitute for a visible signal

#### T33B7 — Add Android attachments and mic action

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T33B6`

Add attachment picking and the mic action through the core outbox.

**This task is the sole owner of Android attachment picking.** T36D covers voice entry only
and must not add a second picker — see the note in T36D. The permission-recovery affordance
built here is the one T36D reuses, so build it as something reusable rather than inline.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] An attachment uploads and appears on the message
- [ ] Denied permissions explain recovery, via an affordance T36D can reuse for the microphone
- [ ] Attachments flow through the core outbox

#### T34A1 — Build the Android renderer registry

`labels: phase-5, area: android` · `wave: P5-W1` · `depends-on: T21C, T26A`

Build the §11.4 registry natively with per-element boundaries and payload caps.

Owns: `apps/android/src/features/extensions/registry*`. No other task in this wave touches those files.

- [ ] A failing element is contained by its boundary
- [ ] An unknown kind produces one diagnostic
- [ ] Oversized payloads are capped with an explanation

#### T34A2 — Render Android status, widget, and progress kinds

`labels: phase-5, area: android` · `wave: P5-W2` · `depends-on: T34A1`

Render three simple kinds from shared fixtures.

Owns: `apps/android/src/features/extensions/renderers/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

T34A1 landed, so read what exists before writing: `registry.ts`, `registry-plan.ts`
(`resolvePiUiElementRenderDecision` — the ordered unknown-kind / oversized / no-renderer /
invalid-payload / ok decision), `registry-boundary.tsx`, `registry-boundary-reset.ts`,
`registry-view.tsx`, `registry-diagnostic.tsx`, `registry-confirm.tsx`, `registry-index.ts`.

**Do not try to render-test these components in vitest.** Any test that imports a module
reaching `react-native` fails with `RolldownError` on `node_modules/react-native/index.js:1:0`
(a Flow type header). This was reproduced twice with throwaway probes during T34A1. Test the
pure decision and predicate functions, which is why they are separate modules; render proof for
this family belongs to the T37 Maestro flows, which own the emulator.

- [ ] All three render from the shared canonical fixtures
- [ ] Semantics match the web renderers
- [ ] TalkBack announces state

#### T34A3 — Render Android log, markdown, and composer kinds

`labels: phase-5, area: android` · `wave: P5-W3` · `depends-on: T34A2`

Render the remaining simple kinds with sanitised markdown.

Owns: `apps/android/src/features/extensions/renderers/` plus the registration entry.
**Correction to the original wording:** that entry is NOT in `registry.ts`. T34A1's
`registry.ts` doc comment states "This module never imports from `./renderers/`", and
honouring that is what keeps the registry unit-testable, so T34A2 put registration in
`renderers/index.ts` as an import side effect and its verifier judged that correct on the
merits. Follow T34A2's pattern; `registry.ts` should still show a zero diff. The T34 chain is
serialized because every link edits `renderers/index.ts`.

**Read T34A2's three renderers before writing** (`status`, `widget`, `progress`): each is split
into an RN-free `*-model.ts` and a thin `*.tsx` view, with shared `tone.ts` and
`element-actions.tsx`. That split is forced, not stylistic — any vitest test importing a module
that reaches `react-native` fails with `RolldownError` on `node_modules/react-native/index.js:1:0`
(a Flow type header). Put all logic in the model module. Render proof belongs to T37's Maestro
flows.

**The registration chain is currently dead, and this task must stop extending it blindly.**
`renderers/index.ts` is imported by `registry-index.ts`, but `registry-index.ts` has zero
importers repo-wide — the only `registry-index` import in the tree is
`apps/web/src/features/rail/rail-element-card.tsx:5`, which targets the WEB barrel. So
`piUiRendererRegistry.register(...)` never executes and every kind falls through to
`registry-view.tsx`'s "no renderer" diagnostic at runtime. Mounting the registry in a real
screen is T34A4's job (`P5-W7`), not this task's, but this task must prove the side effect
itself works rather than assuming it.

- [ ] All three render from shared fixtures
- [ ] Markdown cannot inject raw HTML
- [ ] Log output is bounded and scrollable
- [ ] A test imports `registry-index.ts` and asserts that **every** kind registered so far
      (`status`, `widget`, `progress`, `log`, `markdown`, `composer`) resolves to a renderer
      through `piUiRendererRegistry` — proving the import side effect actually executes.
      Without this the chain stays unverifiable until T34A4

#### T34A4 — Pin the bridge area above the composer

`labels: phase-5, area: android` · `wave: P5-W7` · `depends-on: T34A3`

Place the pinned bridge area above the composer per §11.5.

Owns: `apps/android/src/features/extensions/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

**This task closes the T34 chain's dead-registration defect.** Through T34A3 nothing in the
Android app imports `apps/android/src/features/extensions/registry-index.ts`, so no renderer is
ever registered and every Pi UI element would render as a "no renderer" diagnostic on a real
device. This is the first T34 task that mounts the registry in a screen, so it is the task that
makes the whole chain live.

- [ ] The pinned area sits above the composer and stays visible while active
- [ ] It never covers the composer or the IME
- [ ] It collapses only when genuinely empty

#### T34B1 — Render the Android roster and pin the fleet

`labels: phase-5, area: android` · `wave: P5-W8` · `depends-on: T34A4`

Render roster rows and keep the subagent fleet pinned while active.

Owns: `apps/android/src/features/extensions/renderers/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

**T34A5 runs concurrently in this wave** and owns the rest of `features/extensions/` - the Pi UI
element store and the action controller. The split is exact: `renderers/` and `registry.ts` are
yours, everything else is T34A5's. "Row actions dispatch with visible pending state" is proven
against T34A5's `ExtensionActionController`; read its barrel late, and if it is not ready, prove
the dispatch against an injected controller interface and say so.

- [ ] Roster rows render every documented field
- [ ] The fleet roster stays pinned while active
- [ ] Row actions dispatch with visible pending state

#### T34B2 — Render the Android form kind

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T34B1`

Render forms as sheets with action states.

Owns: `apps/android/src/features/extensions/renderers/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

**Also close T34B1's coverage gap, which is in your grant and nobody else's.**
`ExtensionActionController.settle()` clears pending unconditionally before branching on status,
so a rejected or timed-out dispatch clears identically to a success - proven, but only in
T34A5's `pi-ui-session.test.ts`. **`roster-model.test.ts` covers only `{ status: "success" }`**,
so the roster's own view of a failed row action is untested. Add the rejected and timeout cases
there while you are in this directory.

**Sheet keyboard ownership is not achievable inside this grant alone**: `ui/primitives/Sheet.tsx`
rendered a React Native `Modal` until **T32S5 (P5-W9)** replaced it with a Portal. Prove the
third criterion against T33B4's `resolveFocusOwner`; if T32S5 could not complete the Portal, say
so and do not claim the criterion.

- [ ] Forms render every documented field type
- [ ] Pending, success and failure are each visible
- [ ] Sheets respect keyboard ownership, proven against `resolveFocusOwner` rather than by
      inspection
- [ ] `roster-model.test.ts` covers a rejected and a timed-out row action, not only success

#### T34B3 — Render the Android diff kind

`labels: phase-5, area: android` · `wave: P5-W11` · `depends-on: T34B2`

Render diffs in compact layout.

Owns: `apps/android/src/features/extensions/renderers/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

- [ ] Diffs render from shared fixtures with correct counts
- [ ] Large diffs are bounded
- [ ] Counts use mono tabular figures

#### T34B4 — Render the Android panel kind

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T34B3`

Render panel as a sheet or full screen per §11.3.

Owns: `apps/android/src/features/extensions/renderers/` plus this renderer's registration entry in the shared `registry.ts` T34A1 created. The
whole T34 chain is serialized precisely because every link edits that one file. No other task in this wave touches those files.

- [ ] A panel renders nested kinds from fixtures
- [ ] Nesting depth is bounded with a diagnostic
- [ ] A failing child does not take down the panel

#### T34A5 - Give the Pi UI bridge a live element store and action controller

`labels: phase-5, area: android` · `wave: P5-W8` · `depends-on: T34A4`

**The T34 chain has built four renderer layers and none of them can ever run.** T34A4 was the
task meant to close the dead-registration defect, and it did what its grant allowed: it exports
`PinnedLiveExtensionArea` from `registry-index.ts`. But the P5-W7 merge gate confirmed nothing on
a live path imports that module, so `import "./renderers"` never executes, so
`piUiRendererRegistry.register(...)` is never called, so **every Pi UI element would still render
as a "no renderer" diagnostic on a real device**. `npx knip` lists `PiUiElementView`,
`PiUiRendererRegistry` and every renderer under `renderers/index.ts` as unused exports.

The reason the mount never happened is not oversight — it is a missing prerequisite that no task
owns. `grep -rn "PiUiState" apps/android/src` returns nothing, and no `ExtensionActionController`
is ever constructed. There is no source of `PiUiElement[]` and nowhere for a row action to go, so
mounting `PinnedLiveExtensionArea` today would mean inventing both as fakes inside a route file.
This task builds the two real things so the mount becomes ordinary wiring.

Owns: `apps/android/src/features/extensions/`, **excluding** `renderers/` and `registry.ts`,
which belong to T34B1 in this same wave. Do not edit either; if you need a change there, say so
in your report and file it against T34B1.

- [ ] A Pi UI element store applies the bridge's `set` / `delete` / `channel` operations and
      exposes the current `PiUiElement[]`, with the ordering `plan.md` §11.3 requires
- [ ] Out-of-order and duplicate operations are handled deterministically, proven by test
- [ ] An `ExtensionActionController` dispatches a row action and exposes its pending state, with
      the failure path proven, not just the success path
- [ ] Both are RN-free modules with real unit tests - not source-text assertions
- [ ] `registry-index.ts`'s side-effecting `import "./renderers"` runs whenever the store is
      constructed, so registration can no longer be dead once a screen holds a store
- [ ] The exported surface needs only what a route can supply. **You do not mount it** - the
      router root is T32S4's (P5-W9). State in your report exactly what T32S4 must render and
      with which props

**This task must not add a dependency.** A Pi UI element arrives over the existing daemon bridge;
if you find you need a package, that is a signal the scope is wrong - say so rather than
installing.

#### T32S4 - Mount the transcript and bridge slots, and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T32S3, T33A3, T34A5`

**Third wave running, the router root loses its owner the moment its owner ships.** T32S1C
granted it to T32S2; T32S2 shipped and the directory went unowned, so T32S3 was created to
reclaim it; T32S3 has now shipped. This task holds `apps/android/src/app/` and
`apps/android/src/app-shell/` for the rest of Phase 5, and **any later Phase 5 task needing a
change under the router root files it here rather than editing it.**

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`.

**(1) `TranscriptThinkingRow` is built, exported, tested and unreachable.** T33A3 (P5-W7) landed
it with shimmer and reduce-motion handling; the session route renders only `CoreMessageEntry`
through `TranscriptMessageRow` and never filters for thinking entries. This is **not** blocked on
the batcher: `batcher.getState()` is public and `buildTranscriptEntries` already yields thinking
entries - only `getMessageEntries()` and `subscribe()` filter them out. What was actually missing
is the composition decision, which is this task's to make: interleaving thinking and message rows
in one correctly ordered pass. `filterThinkingEntries` and `isThinkingEntry` are exported for it.

**(2) `PinnedLiveExtensionArea` is built, exported, tested and unreachable.** T34A4 (P5-W7)
landed it; `liveExtension` is never passed to `CompactSessionShell` and defaults to `null`.
T34A5 (P5-W8) builds the Pi UI element store and `ExtensionActionController` that were the real
prerequisite. Mount the area against those, not against a fake.

**Note what the P5-W7 merge gate had to undo.** T32S3 asserted the slot stays _unfilled_ -
`expect(readCode()).not.toMatch(/liveExtension=\{/)` - after T34A4 had already landed. That
turned a disclosed gap into an enforced invariant that would have failed the build of the first
task to mount the area correctly (removed in `cda635b`). **Do not write negative assertions that
pin an open defect shut.** Assert what this task's own code does; when you cannot finish
something, say so in the report.

**(3) 13 test modules under the router root still enter the typed-routes union.** Metro's
`TEST_FILE_BLOCK_PATTERN` keeps them out of the bundle, so this is typed-routes-only noise rather
than a broken route node, but the union is wrong and no gate catches it. `core-context.tsx` and
`route-placeholder.tsx` also remain, both with live cross-feature importers T32S3 could not edit;
name the blocker for each rather than extending the exception list.

**(4) `FilesScreen` is mounted and permanently inert.** The route
`app/h/[serverId]/session/[agentId]/files/[...path].tsx` renders `<FilesScreen serverId agentId
path />` and passes **no `client` and no `workspaceRoot`**, so `files-screen.tsx` renders the
"Not connected" `ErrorState` forever. T35A1 (P5-W8) built the whole browser against an injected
`FileBrowserClient` and could not fix this - the route is off limits to it - and **T35A2
(P5-W10) owns only `features/files/`, so it will hit the same wall.** Pass a real client through.

**(5) `platform/index.ts` is a barrel with zero importers**, exporting only the now-dead
`FakeNetworkReachability`. **T32P1 (P5-W9) now owns `src/platform/` and this item moved there** -
do not delete it from here; if the barrel needs to keep an export for your mount, say so.

- [ ] The session route renders thinking entries and message entries interleaved in the correct
      order, proven by test, not by source-text regex
- [ ] The `liveExtension` slot renders `PinnedLiveExtensionArea` against T34A5's real store and
      action controller, with no fake constructed inside the router root
- [ ] `FilesScreen` receives a real `FileBrowserClient` and a `workspaceRoot`, and its
      "Not connected" `ErrorState` is no longer what production hits
- [ ] `npx knip` no longer lists `TranscriptThinkingRow`, `PinnedLiveExtensionArea`,
      `PiUiElementView`, `PiUiRendererRegistry`, `createPiUiSession`, `usePiUiElements` or any
      renderer as an unused export
- [ ] Running expo-router's real `EXPO_ROUTER_CTX_IGNORE` walk over the live filesystem finds no
      module without a default export that is not named with its blocking grant
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount

#### T32S5 - Own the Android shared UI primitives and recipes

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T32S1C, T33B4`

**`apps/android/src/ui/primitives/` and `ui/recipes/` have never had an owner.** Every Phase 5
task so far has been told "read them, do not edit or fork them", which was right while they were
adequate. They are no longer adequate, and the P5-W8 merge gate confirmed two concrete defects
that block work already scheduled.

Owns: `apps/android/src/ui/primitives/`, `apps/android/src/ui/recipes/`. **Any later Phase 5
task needing a change to a shared primitive or recipe files it here rather than editing it.**

**(1) `Sheet.tsx` renders a React Native `Modal`.** plan.md §9.3 says the sheet must be a Portal
precisely so it does not detach into its own window and take keyboard ownership away from the
composer. `Modal` is the detached-window pattern that rule exists to forbid. Two scheduled tasks
carry the criterion "Sheets respect the keyboard ownership rules" - **T33B5** (approvals) and
**T34B2** (the form kind) - and neither owns this file, so neither can satisfy it. Replace the
`Modal` with a Portal that keeps the sheet inside the composer's view hierarchy, or, if that is
not achievable with what is installed, say exactly what is missing rather than leaving `Modal`
in place silently.

**(2) `PromptBar.tsx` has no `onFocus` or `onBlur`.** T33B4 (P5-W8) built
`composer-focus-model.ts` - `resolveFocusOwner`, `focusComposer`, `openSheet`, `closeSheet`,
`rotate` - and it has no consumer and cannot get one, because the recipe that owns the text input
emits no focus events for the model to consume. Add them, typed so the composer can drive the
model, and check `TextField.tsx`/`TextArea.tsx` for the same gap while you are here.

**(3) `touch-targets.test.ts` matches per file, not per element**, so a single stray
`hitSlop={N}` anywhere in a primitive satisfies the 48dp check for every element in that file -
the one accessibility guarantee Android CI claims to enforce currently cannot fail. **T57B
(P5-W15) owns the mutation-proofing sweep**, so do not rewrite the harness here; but you now own
the files it tests, so if you touch a primitive's touch targets, prove them with an assertion
that can actually fail.

- [ ] `Sheet.tsx` no longer renders a React Native `Modal`, and a sheet opening does not move
      focus ownership away from the composer, proven against T33B4's `resolveFocusOwner`
- [ ] `PromptBar.tsx` emits `onFocus`/`onBlur`, and `composer-focus-model.ts` has a real consumer
      path - state which task closes the last hop if it is not this one
- [ ] No visual regression to any recipe already in use: every existing test in `ui/` stays green
      and no raw hex colour is introduced
- [ ] Anything you cannot fix inside `ui/` is named with the task that owns it, not worked around

Beautiful UI (plan.md §10.1) is the visual language; compose within it rather than restyling.

#### T32P1 - Own the Android platform adapters and report a real network path

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T32S3, T32B5`

**`apps/android/src/platform/` lost its owner when T32S3 shipped**, and the adapter it left
behind cannot report what two scheduled tasks need. T32S3 correctly replaced
`FakeNetworkReachability` with a real `PollingNetworkReachability`, but under a constraint it
disclosed: with no network library installed it can only ever set `kind` to `"unknown"` or
`"none"`. So `network-online` fires for real while **`network-path-change` can never fire at
all**, and `getProbeUrl()` returns `null`, so in production it probes nothing.

T32B5 (P5-W8) built the session-list side of path switching against injected `NetworkStatus`
values and was explicitly told to name the task that must add the dependency. No such task
existed. This is it.

Owns: `apps/android/src/platform/`. **Any later Phase 5 task needing a platform adapter files it
here rather than editing it.**

**`@react-native-community/netinfo` is NOT installed, and you may not install it.** The
intended pre-install was refused by this workspace's command policy, and in any case five agents
share this worktree and must not rewrite `node_modules`. `expo/bundledNativeModules.json` pins
**11.4.1**, which is the version to use when someone can run:

```
npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1
```

So build the adapter **behind an injected native-module interface** - a small
`NetInfoModule`-shaped port you declare, mapping NetInfo's `type`/`isConnected` onto
`NetworkStatus`. Every rule is then real and provable in vitest against a scripted fake, and the
only remaining step is the install plus one import at the construction site. **Say plainly in
your report that the package is missing, that the adapter is therefore not wired to a native
module in production, and quote the exact install command above.** Do not fake the package, do
not vendor it, and do not claim a real path kind is reaching the app.

- [ ] A reachability adapter reports a real `kind` (`wifi` / `cellular` / `ethernet` / `none` /
      `unknown`), so `network-path-change` can fire
- [ ] The adapter is behind the existing `NetworkReachability` interface, with the native module
      injected, so its behaviour is provable in vitest without importing `react-native`
- [ ] A Wi-Fi to cellular transition is proven end to end from adapter to
      `ResumeController`, using the real controller, not a stand-in
- [ ] `getProbeUrl()` either returns a real URL or the probe is removed - it must not stay a
      no-op that looks like liveness checking
- [ ] `fake-network.ts` and the zero-importer `platform/index.ts` barrel are deleted, or each is
      kept with a stated reason and a live importer
- [ ] Nothing in this task claims a path switch observed on a device; on-device remains T37/T59

#### T32B6 - Own the Android session list for the rest of Phase 5

`labels: phase-5, area: android` · `wave: P5-W11` · `depends-on: T32B5, T32P1, T32S4`

**T32B5 was the last task in the T32B chain, so `features/sessions/` went unowned the moment it
shipped** - the fourth time in Phase 5 a directory has lost its owner at exactly the point its
remaining defects became visible. T32B5's own third criterion, _"The active connection path is
visible"_, is **not met in the shipped app**: `sessionListConnectionPathLabel` is never called
from `sessions-screen.tsx`, and `SessionListNetworkSync` is never constructed.

Owns: `apps/android/src/features/sessions/`. **Any later Phase 5 task needing a change here files
it against this task.**

**(1) `SessionListNetworkSync` has no constructor and no live feed.** T32B5 built it, with
generation fencing so an abandoned path switch cannot clobber a newer merge, and proved it
against injected `NetworkStatus` values. Nothing constructs it and nothing feeds it
`AppCore.network`. By this wave T32P1 (P5-W9) has made that adapter report a real `kind`, so the
signal it needs exists.

**(2) `SessionService` still has no list-fetch method.** `SessionListNetworkSync` needs a
`refreshSessions`; T32B5 correctly declined to invent one rather than guess the daemon request.
Find the real request in `packages/protocol` and add the method to the interface and to
`apps/android/src/platform/daemon-session-service.ts`'s implementation - **that file is T32P1's
grant, so coordinate or file it there** rather than editing it.

**(3) `connectionPath` is never rendered.** Wire `sessionListConnectionPathLabel` into the
screen. With T32P1 landed it can finally read something other than "Unknown"/"Offline".

**Two coordination notes added by the P5-W10 merge gate.** (a) `AppCore.network` is _still_
`createPollingNetworkReachability`, whose `kind` can only be `"unknown"`/`"none"` - T32P1's real
adapter has been unmounted for three waves, blocked on
`npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1`. If it is
still not installed, **say so, prove what you can against the injected port, and do not claim a
real path kind**. T32S7 is under the same block this wave; only one of you should edit `core.ts`,
and that is T32S7. (b) T37B's `describeSessionListStaleness` reads the same boolean
`SessionListState.stale` this directory already carries - **wire the two together rather than
inventing a second staleness concept**, and give the link a compile-time type rather than
relying on structural typing.

- [ ] `SessionListNetworkSync` is constructed on the live path and fed the real
      `AppCore.network`, with no fake anywhere on that path
- [ ] A Wi-Fi to cellular switch reconciles the list, with no duplicate and no dropped row,
      proven against the real adapter rather than injected values
- [ ] The active connection path is visible in the session list and reads a real kind
- [ ] `npx knip` no longer lists `SessionListNetworkSync`, `mergeSessionListWindow`,
      `applySessionListWindow`, `markSessionListStale`, `setSessionListConnectionPath` or
      `sessionListConnectionPathLabel` as unused exports

#### T32S6 - Mount wave P5-W9's deliverables and keep owning the router root

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T32S4, T32P1, T32S5, T33A4, T37A`

**Read this first, because it is the most expensive lesson Phase 5 has produced.** T32S4 (P5-W9)
was the integration task, and it worked: the four features that had been unreachable for three
waves - `TranscriptThinkingRow`, `PinnedLiveExtensionArea` and with it the whole seven-kind Pi UI
renderer chain, and a `FilesScreen` that had been rendering "Not connected" forever - are all on
live paths now, confirmed at the merge gate by grep rather than by report.

**And in the same wave, four new deliverables shipped with no mount.** T32P1, T32S5 and T37A each
named T32S4 as their mount site; T32S4 could not mount them, because they were being built beside
it and were not in its acceptance criteria. That is not a mistake anyone made - it is structural.
**A task cannot mount what a sibling is writing at the same time.** So the router root's owner
runs one wave behind the producers, permanently, and each wave's merge gate files the next mount
task.

Owns: `apps/android/src/app/`, `apps/android/src/app-shell/`. **Any later Phase 5 task needing a
change under the router root files it here rather than editing it.**

**(1) `TranscriptToolCallRow` is unreachable.** T33A4 (P5-W9) shipped a complete, 33-test
tool-card family including the safe generic card for unknown tools, and
`buildSessionTranscriptEntries` in `app-shell/session-transcript-model.ts` explicitly filters
`tool-call` out. Widen `SessionTranscriptEntry`, add `isToolCallEntry` to
`isSessionTranscriptEntry`, and branch in `SessionTranscript`. Small work, real user-visible
impact.

**(2) `<PortalHost>` is mounted nowhere.** T32S5 (P5-W9) replaced `Sheet.tsx`'s React Native
`Modal` with a same-window Portal, but with no host mounted every `Sheet` silently takes the
inline fallback, which cannot escape ancestor clipping or z-order. **T33B5 and T34B2 are in this
same wave and both depend on sheets behaving correctly** - mount the host early and tell them.

**(3) `NativeNetworkReachability` is unreachable and blocked on an install.** `core.ts` still
builds `createPollingNetworkReachability`, whose `kind` can only ever be `"unknown"`/`"none"`.
T32P1 built the real adapter behind an injected `NetInfoModule` port. Switching the construction
site needs the package, which this workspace's command policy refuses:

```
npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1
```

If it is still not installed when you start, **say so and switch nothing** - do not vendor it and
do not claim a real path kind reaches the app. Report the command. T32B6 (P5-W11) needs this.

**(4) The offline cache is unreachable and blocked on an install.** T37A (P5-W9) built
`SqliteStructuredStorage` behind an injected `SqliteDriver` port with a real bound policy;
`platform/offline/index.ts` has no importer at all. Constructing it in `core.ts` needs
`expo-sqlite` at the version `expo/bundledNativeModules.json` pins. Same rule as (3).

**(5) `workspaceRoot=""` can now reach a live daemon.** Safe only while nothing could connect;
T32A4 changed that in the same wave. It matches web's shipped default so it is not a new defect,
but resolving a session's real workspace root is now a live correctness question, gated on
`packages/frontend-core/src/sessions/index.ts`'s Phase 1 stub. Fix it or name the task that must.

**(6) The typed-routes leak is still open.** `core-context.tsx` and `route-placeholder.tsx`
remain in `KNOWN_NON_ROUTE_EXCEPTIONS`, along with 13 test modules that enter the union. Metro's
`TEST_FILE_BLOCK_PATTERN` keeps them out of the bundle, so this is typed-routes-only, but no gate
catches it.

- [ ] The session transcript renders `TranscriptToolCallRow`, and an unknown tool reaches the
      safe generic card through the live path rather than only in T33A4's unit tests
- [ ] `<PortalHost>` is mounted, and a `Sheet` renders through the portal rather than the inline
      fallback
- [ ] For (3) and (4): either the package is installed and the construction site switched, or the
      report states plainly that it is not installed, quotes the command, and changes nothing
- [ ] **No deliverable from wave P5-W9 is left without a mount that this task did not either
      complete or name with its specific blocker**
- [ ] No assertion added by this task asserts the _absence_ of a sibling's mount

**Do not write negative assertions that pin an open defect shut.** Three merge gates in a row
have had to remove or narrow one: `cda635b`, `11e0758`, `d473b0c`.

#### T34A6 - Feed a live agent_stream into the Pi UI store and send actions

`labels: phase-5, area: android` · `wave: P5-W11` · `depends-on: T34A5, T32S6`

**The Pi UI bridge is fully built, fully mounted, and permanently empty.** T34A5 built the
element store and action controller; T32S4 mounted `PinnedLiveExtensionArea` against them and
`import "./renderers"` finally runs, so all seven kinds are registered and reachable. Nothing
ever puts an element into the store, because no live `agent_stream` is fed to it - and nothing
can dispatch an action off the device, because `packages/client`'s `DaemonClient` has no
`pi.ui.action.request` sender.

The same is true of the transcript: `createTranscriptMessageBatcher` is mounted and receives
nothing. **This is the last structural gap between "every screen is wired" and "the app does
something."**

Owns: `apps/android/src/features/extensions/`, excluding `renderers/` and `registry.ts`.

**The client half is outside `apps/android` entirely.** `pi.ui.action.request` belongs in
`packages/client`, which no Phase 5 task owns. Determine whether the sender already exists -
read `packages/client` and `packages/protocol` before assuming - and if it does not, **say so and
name it as a backend task rather than adding a second, drifting request path inside the app.**

- [ ] A live `agent_stream` delta reaches `piUiSession.store` and the element renders
- [ ] A row action dispatched from a renderer reaches the daemon, or the exact missing sender is
      named with the package that must add it
- [ ] The transcript batcher receives real stream deltas, or the task that must feed it is named
- [ ] Proven against a scripted fake stream, not an emulator or a real socket

#### T60A - Unify the secret-shaped redaction helper across the apps

`labels: phase-5, area: core` · `wave: P5-W11` · `depends-on: T33A4, T37A`

**Two different definitions of "secret-shaped" now exist in `apps/android`, written in the same
wave, and the P5-W9 merge gate proved a hole in each by running its own probes.**

- `features/transcript/tool-call-row-model.ts` (T33A4) - substring key patterns plus value-shape
  patterns, redacting to `[redacted]`. Correctly catches `password`, `sk-`-shaped keys, a nested
  `authorization: Bearer`, an `xoxb-` token inside an array, and a `ghp_` token under an
  innocuous key. **Hole:** the value patterns are `^...$`-anchored, so a secret embedded in a
  longer string survives verbatim - proven with
  `{"command": "curl -H 'Authorization: Bearer sk-LIVEKEY1234567890' https://api.example.com"}`,
  which is exactly the shape a shell-ish unknown tool produces.
- `platform/offline/sqlite-structured-storage.ts` (T37A) - exact-match key pattern, throwing on a
  match. **Hole:** proven to accept `accessToken`, `refreshToken`, `relayPassword` and
  `sessionCookie`, all of which it stored in plaintext.

Neither imports the other. Both are defence in depth rather than the primary control, and nothing
secret currently flows through either path - but two half-right copies is how the next one gets
written.

Owns: a single shared helper in `packages/frontend-core`, plus the two call sites above.

- [ ] One helper in `frontend-core`, with both hole cases above as regression tests
- [ ] Both Android call sites use it; neither keeps a private pattern list
- [ ] `apps/web` is checked for a third copy and converted if one exists
- [ ] The helper's limits are written down: what it is defence in depth _for_, and what the
      primary control is

#### T35A1 — Browse files on Android over daemon RPC

`labels: phase-5, area: android` · `wave: P5-W8` · `depends-on: T32S2`

Build the file browser as a dedicated route, not squeezed beside chat.

Owns: `apps/android/src/features/files/`. No other task in this wave touches those files.

**T32S1C already created this directory** (wave P5-W3), because its own acceptance criterion
required every route stub to import from a matching `features/*` barrel and none of these
directories existed. Expect a populated directory with an existing barrel export, not an empty
one. The placeholder screen inside it has **no test of its own** — the only coverage touching
it is the route file's source-text regex, which never reaches the screen's logic (demonstrated:
mutating `files-screen.tsx`'s `path.join("/")` left all 225 Android tests green). Replacing the
placeholder body wholesale is this task's job; so is giving the replacement real tests.

- [ ] Listing renders and navigates on the emulator
- [ ] Files are a dedicated route
- [ ] All access goes through daemon RPC

#### T35A2 — Read and display a file on Android

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T35A1`

Read and render files read-only.

Owns: `apps/android/src/features/files/`. No other task in this wave touches those files.

- [ ] Text files render with highlighting
- [ ] Binary and oversized files are refused with an explanation
- [ ] Reads go through daemon RPC

#### T35A3 — Add the Android native editor

`labels: phase-5, area: android` · `wave: P5-W12` · `depends-on: T35A2`

Add native editing suited to compact screens, with explicit limits.

Owns: `apps/android/src/features/files/`. No other task in this wave touches those files.

- [ ] An edited file saves and reloads
- [ ] Native editing limits are stated explicitly rather than failing silently
- [ ] A failed save keeps the buffer

#### T35A4 — Add Android upload and download

`labels: phase-5, area: android` · `wave: P5-W14` · `depends-on: T35A3`

Add upload and download with progress.

Owns: `apps/android/src/features/files/`. No other task in this wave touches those files.

- [ ] Upload and download round-trip from the emulator
- [ ] Progress is visible for large transfers
- [ ] Failures are recoverable

#### T35B1 — Build the Android terminal WebView wrapper

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T32S2`

Rebuild an xterm WebView wrapper from the binary protocol and behaviour tests. The reference implementation may be consulted for behaviour, never copied.

Owns: `apps/android/src/features/terminal/`. No other task in this wave touches those files.

**T32S1C already created this directory** (wave P5-W3), because its own acceptance criterion
required every route stub to import from a matching `features/*` barrel and none of these
directories existed. Expect a populated directory with an existing barrel export, not an empty
one. The placeholder screen inside it has **no test of its own** — the only coverage touching
it is the route file's source-text regex, which never reaches the screen's logic (demonstrated:
mutating `files-screen.tsx`'s `path.join("/")` left all 225 Android tests green). Replacing the
placeholder body wholesale is this task's job; so is giving the replacement real tests.

- [ ] The terminal renders and accepts input on the emulator
- [ ] No code is copied from the reference frontend
- [ ] The wrapper is themed from design tokens

#### T35B2 — Honour the binary channel and backpressure

`labels: phase-5, area: android` · `wave: P5-W12` · `depends-on: T35B1`

Drive the terminal over the binary channel within backpressure limits.

Owns: `apps/android/src/features/terminal/`. No other task in this wave touches those files.

- [ ] Data round-trips within backpressure invariants
- [ ] A flood fixture does not wedge the UI
- [ ] Disconnect and reconnect restore a usable terminal

#### T35B3 — Verify Android terminal resize and keyboard

`labels: phase-5, area: android` · `wave: P5-W14` · `depends-on: T35B2`

Verify resize ownership and keyboard behaviour on device.

Owns: `apps/android/src/features/terminal/`. No other task in this wave touches those files.

- [ ] Resize ownership matches daemon behaviour
- [ ] Hardware and soft keyboard input both work
- [ ] Rotation does not corrupt the buffer

#### T36A — Add Android push registration

`labels: phase-5, area: android` · `wave: P5-W14` · `depends-on: T32B5`

Register for push and handle token refresh.

Owns: `apps/android/src/features/notifications/`. No other task in this wave touches those files.

- [ ] Registration succeeds against the dev daemon
- [ ] Token refresh is handled without duplicate registrations
- [ ] Denied notification permission is explained

#### T36B — Add permission notifications with safe actions

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T36A`

Deliver permission requests as notifications with safe Approve and Deny actions.

**Moved out of `P5-W14` because it shares a grant with its own dependency.** T36A owns
`features/notifications/` in `P5-W14` and this task owns the same directory; two concurrent agents
in one worktree cannot both hold it, and the T36 chain is serialized for exactly that reason.
Read what T36A shipped there before extending it.

Owns: `apps/android/src/features/notifications/`. No other task in this wave touches those files.

- [ ] A permission request can be approved from a notification action
- [ ] Actions are unambiguous and cannot fire the wrong decision
- [ ] A stale notification cannot approve an already-resolved request

#### T36C — Add share-intent handling

`labels: phase-5, area: android` · `wave: P5-W14` · `depends-on: T32B5`

Accept share intents into a draft or a chosen session.

Owns: `apps/android/src/features/share/`. No other task in this wave touches those files.

- [ ] A share intent creates a draft in a chosen session
- [ ] Unsupported share types are refused with an explanation
- [ ] Sharing while offline queues through the outbox

#### T36D — Add voice entry

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T32B5`

Add voice entry through the core outbox.

**Attachment picking is NOT in this task.** An earlier revision of T36D also owned "system
attachment pickers through the core outbox" — which is verbatim what T33B7 already owns, in a
different directory (`features/composer/` vs `features/voice/`), two waves earlier, with no
dependency between them. Both even carried the identical criterion "Denied permissions explain
recovery". Two agents would have built the same picker twice and the second would have
collided with the first. Attachment picking belongs to T33B7; this task is voice only, and
reuses whatever permission-recovery affordance T33B7 established rather than writing a second.

Owns: `apps/android/src/features/voice/`. No other task in this wave touches those files.

- [ ] Voice entry produces a prompt through the outbox
- [ ] A denied microphone permission explains recovery, using the same affordance T33B7 built
      for its own permission denials rather than a second, divergent one

#### T37A — Wire the Expo SQLite offline cache

`labels: phase-5, area: android` · `wave: P5-W9` · `depends-on: T32B5`

Wire the offline cache behind the core platform interface.

Owns: `apps/android/src/platform/offline/`. No other task in this wave touches those files.

- [ ] Cached sessions render offline, asserted by unit tests against the shared
      `frontend-core` fixtures — the on-device proof of this behaviour is T37E8's, not this
      task's; do not boot an emulator to satisfy this criterion
- [ ] The cache is written through the platform interface, not directly
- [ ] Cache size is bounded

#### T37B — Mark cached data stale until catch-up

`labels: phase-5, area: android` · `wave: P5-W10` · `depends-on: T37A`

Mark cached data stale until authoritative catch-up completes.

Owns: `apps/android/src/platform/offline/`. No other task in this wave touches those files.

**One gap survived the P5-W10 gate, confirmed by two independent probes.**
`cacheTimelineTail`'s doc comment says optimistic rows are _"deliberately excluded ... they do
not belong in a cache meant to be replayed as a daemon-confirmed tail"_, and **no test pins
that**: replacing `rows: state.rows` with `rows: [...state.rows, ...state.pendingRows]` left all
four tests in `timeline-cache.test.ts` green, because the `gapRecovery` fixture never has
non-empty `pendingRows` at that call. The code is correct; the guarantee is unproven. **The next
task to touch this file adds one test with a non-empty `pendingRows` state.**

- [ ] Cached data is visibly marked stale until catch-up, asserted by unit tests against the
      shared `frontend-core` fixtures — on-device proof is T37E8's
- [ ] Catch-up reconciles without duplicates
- [ ] Stale state is announced, not colour-only

#### T37C — Recover from process death during a turn

`labels: phase-5, area: android` · `wave: P5-W13` · `depends-on: T37B`

Restore correctly when the process is killed mid-turn.

Owns: `apps/android/src/platform/offline/`. No other task in this wave touches those files.

- [ ] Kill-and-restore during an active turn recovers correctly, asserted by unit tests that
      simulate process death against the shared fixtures. **T37E6 owns the on-device proof of
      this exact scenario** ("background-and-kill-during-a-turn"); implementing it here and
      device-verifying it again there is duplicated emulator work. Build and unit-test here;
      let T37E6 prove it on the device
- [ ] No duplicate submission occurs on restore
- [ ] The recovered turn continues or fails explicitly

#### T37D — Build the Maestro harness

`labels: phase-5, area: android` · `wave: P5-W15` · `depends-on: T37C`

Build the Maestro/Agent Device harness against an isolated daemon.

Owns: `apps/android/maestro/` (the harness config and its one smoke flow) plus
`apps/android/e2e/` for any TypeScript support code the flows need. `plan.md` §6 lists these
as two sibling directories; the flow files themselves belong in `maestro/`, and each T37E
child below owns exactly one of them. No other task in this wave touches those files.

Ten separate T37E\* tasks depend on this harness, each run by a different agent. If starting a
flow means rediscovering emulator setup, app install and daemon wiring, that cost is paid ten
times over. Leave it as one documented command.

- [ ] The harness runs one smoke flow on the reference emulator
- [ ] It targets an isolated daemon, never production — never the daemon on port 6767
- [ ] Flows are independent and repeatable
- [ ] A single documented command runs any one flow by name against an **already-running**
      emulator, written down in `apps/android/maestro/README.md`, so that no T37E\* task has to
      boot or configure an emulator itself. Record what must already be running, and how to
      tell whether it is

#### T57B — Make the source-text regex tests mutation-proof

`labels: phase-5, area: android` · `wave: P5-W16` · `depends-on: T33B1`

**Scheduling note: this task sweeps test files across every feature directory, so it collides
with any sibling editing tests in the same wave.** It moved from `P5-W15` to `P5-W16` for that
reason. **Do not edit a test file inside another task's `Owns` grant for the wave you run in** -
list those files, fix the rest, and hand the remainder to the wave's merge gate with the exact
pattern to apply.

**This codebase's accessibility and touch-target proofs are source-text regexes, and at least
one of them was proven decorative.** Because vitest cannot render any module that reaches
`react-native`, several suites assert against the raw file text instead. `toMatch` is
unanchored and does not know what a comment is, so an assertion is satisfied by a doc comment
that merely _describes_ the behaviour.

Proven three times, not suspected — and twice the _same_ assertion, in two different files:

- `apps/android/src/features/transcript/transcript-accessibility.test.ts` matched
  `accessibilityLiveRegion="polite"` against `header.tsx`, whose own doc comment contains that
  exact string. Deleting the real JSX prop left the suite green. Fixed at the `P5-W4` merge
  gate with a `readCode()` helper that strips block and line comments — that helper is the
  pattern to spread.
- `apps/android/src/features/composer/composer-accessibility.test.ts` had the identical defect
  against `Composer.tsx` (doc comment at line 121, real prop at line 253). Found at the `P5-W5`
  merge gate and fixed there. **Two independent tasks wrote the same fake test without either
  knowing about the other**, which is why this needs a sweep and a rule rather than another
  point fix.
- Earlier, mutating `files-screen.tsx`'s `path.join("/")` left all 225 Android tests green.

**A third instance, found at the `P5-W9` gate, and the first to survive its own author's
mutation checklist.** `apps/android/src/ui/primitives/Sheet.test.ts` asserted
`toMatch(/usePortalOutlet/)` - satisfied by the bare `import { usePortalOutlet } from "./Portal";`
on line 6, so deleting the real call left the test passing 3/3. Fixed for that one file in
`d473b0c` by matching the full call expression. **The bare-identifier regex is the general
defect: wherever an asserted identifier also appears in an import, the assertion cannot fail.**
Sweep `ui/` and every sibling test using the `readCode()` pattern for it.

**A third and a fourth failure mode, both in the same family: an assertion that cannot tell
prose from code.** Neither is the bare identifier; both were found by sweeping for shape rather
than by a test going red.

_The blind prohibition._ `files-screen.test.ts` prohibited a direct read with
`not.toMatch(/client\.readFile\(/)`. The literal `\(` is blind to `client.readFile?.(...)` - and
`readFile` is an **optional** member of `FileBrowserClient`, which is the whole reason `core.ts`
had to grow a forward for it, so the optional-chained form is the _natural_ way to write that
call site rather than an edge case. Proven both directions at the `P5-W11` gate: injecting
`void client.readFile?.("x", "y")` into `files-screen.tsx` left the old pattern green at 11/11.
Widened in `0887f1d` to `/client(?:\?)?\.readFile(?:\?\.)?\(/` - deliberately not the looser
`\??\.?`, which would also match the optional method _signature_ `readFile?(cwd, path)`.
**The discriminator that makes this cheap to sweep for: a prohibition is blind only when the
prohibited member is optional**, because that is when `?.(` becomes the natural call form.
Everything matching a direct import or a required method is fine as written.

_The prose-tripped prohibition, the inverse failure._ **About eighteen prohibitions in this
repository read raw `source` rather than the comment-stripped `code`/`readCode()` sitting beside
them**, and a prohibition over comment-bearing source can be tripped **by** the doc comment that
explains it - a false positive against unchanged, correct code. The prose-likely ones are the
risk: `sessions-screen.test.ts:75-76` (`/new DaemonClient/`, `/new WebSocket/`),
`router-root.test.ts:178` (`/export default /`), and every
`not.toMatch(/#[0-9a-fA-F]{3,8}\b/)` hardcoded-colour rule, which a hex quoted in a comment
trips. None trip today. **Switch every prohibition to the comment-stripped reader**, which costs
nothing and closes both directions at once: bridging _into_ a comment (passes wrongly) and being
tripped _by_ one (fails wrongly).

**A second, different failure mode found at the `P5-W5` gate, and this one is still open.**
`apps/android/src/ui/primitives/touch-targets.test.ts` matches **per file, not per element**:
a primitive with a stray `hitSlop={N}` anywhere in the file satisfies the check for every
element in it. Demonstrated on `Banner.tsx` — shrinking _both_ its `minHeight: 48` values to
`40` left all 10 touch-target tests green, because an unrelated action button's `hitSlop={8}`
elsewhere in the same file still matched. The 48dp rule is the one accessibility guarantee
Android CI claims to enforce and it currently cannot fail. `T26A` authored the check; no later
task owns it, which is why it is folded in here.

Same pattern, still unaudited: `recipe-accessibility.test.ts`,
`features/sessions/sessions-screen.test.ts`, `features/connect/*.test.ts`,
`platform/secure-storage.test.ts`, and the `src/app/` route source-text tests.

Owns: the test files named above. No other task in this wave touches them.

- [ ] Every source-text assertion in those files runs against comment-stripped source
- [ ] Each one is mutation-checked: the real construct is deleted, the assertion fails, the
      file is restored byte-identically and the suite goes green again. The mutation and its
      failure are recorded in the commit message
- [ ] Any assertion that survives its mutation is either rewritten to bite or deleted as
      decorative — a green test that proves nothing is worse than no test
- [ ] `touch-targets.test.ts` matches per element, not per file: shrinking any single
      primitive's `minHeight` below 48 fails the test even when another element in the same
      file carries a `hitSlop`. Proven by mutating `Banner.tsx` alone
- [ ] A note in `apps/android/README.md` (or the nearest existing test-convention doc) states
      that new source-text tests must be mutation-checked before they count as proof

#### T37E1 — Cover the direct and relay pairing scenario

`labels: phase-5, area: android` · `wave: P5-W16` · `depends-on: T37D, T32A6`

Split out of the original T37E, which bundled all ten §14.4 scenarios into one task with
three abstract criteria — the same pattern that made the original T31B burn 910k tokens
without finishing (see "Sizing and collision rules"). Write this flow from scratch. Run only
your own flow while iterating.

Owns: `apps/android/maestro/pairing.yaml`. No other task in this wave touches those files.

- [ ] Pairing to a direct host and pairing to a relay host both pass on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E2 — Cover the cold-start session restore scenario

`labels: phase-5, area: android` · `wave: P5-W16` · `depends-on: T37D, T32B3, T32S2, T33A6`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/cold-start-restore.yaml`. No other task in this wave touches those files.

**This flow fails as the app is currently wired, and the fix is not yours.** `sessions.tsx`
passes neither `sessionService` nor `keyValueStorage` to `SessionsScreen`, so T32B3's cold-start
restore never runs - the screen's `if (!sessionService) return null` guard fires first - and
`src/app/index.tsx` redirects to `/connect` unconditionally. Both live in the router root;
**T32S3 (P5-W7) owns them**. Add `T32S3` to this task's dependencies before starting.

- [ ] Cold start into the last opened session passes on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E3 — Cover the composer input and share-intent scenario

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T37D, T36C, T36D`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/composer-inputs.yaml`. No other task in this wave touches those files.

- [ ] Composing with keyboard, voice, attachment, and share intent all pass on the reference
      emulator
- [ ] The share-intent flow is exercised, not only keyboard entry
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E4 — Cover the notification approval scenario

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T37D, T36B`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/notification-approval.yaml`. No other task in this wave touches those files.

- [ ] Responding to an approval from a system notification passes on the reference emulator
- [ ] The notification flow is exercised end to end, from tap to daemon round-trip
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E5 — Cover the roster, form, and panel sheet scenario

`labels: phase-5, area: android` · `wave: P5-W17` · `depends-on: T37D, T34B4`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/extension-sheets.yaml`. No other task in this wave touches those files.

- [ ] Interacting with roster, form, and panel sheets passes on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E6 — Cover the background-and-kill-during-a-turn scenario

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T37D, T37C, T33A6`

Split out of the original T37E (see T37E1). This is the scenario T37F re-runs as the formal
Phase 5 exit gate, which is why T37F now depends on all ten children rather than restating
the kill/restore flow itself. Write this flow from scratch. Run only your own flow while
iterating.

Owns: `apps/android/maestro/background-kill-restore.yaml`. No other task in this wave touches those files.

- [ ] Backgrounding and killing the app during an active turn, then restoring, passes on the
      reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E7 — Cover the network path switch scenario

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T37D, T32B5`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/network-switch.yaml`. No other task in this wave touches those files.

- [ ] Switching network path mid-session passes on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E8 — Cover the offline cache and outbox flush scenario

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T37D, T37B`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/offline-cache-outbox.yaml`. No other task in this wave touches those files.

- [ ] Reading the offline cache and flushing a safe outbox item passes on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E9 — Cover the files and terminal route scenario

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T37D, T35A4, T35B3`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/files-and-terminal.yaml`. No other task in this wave touches those files.

- [ ] Opening files and opening the terminal both pass on the reference emulator
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37E10 — Cover the touch-target and TalkBack accessibility scenario

`labels: phase-5, area: android` · `wave: P5-W20` · `depends-on: T37D, T33B7, T34B4, T35A4`

Split out of the original T37E (see T37E1 for the split rationale). Write this flow
from scratch. Run only your own flow while iterating.

Owns: `apps/android/maestro/accessibility-audit.yaml`. No other task in this wave touches those files.

- [ ] Every critical control sampled meets the 48 dp touch-target minimum
- [ ] TalkBack announces a correct label for every critical control sampled
- [ ] The flow runs independently and can be sharded with the other §14.4 flows

#### T37F — Re-run the §14.4 flows as the Phase 5 exit gate

`labels: phase-5, area: android` · `wave: P5-W21` · `depends-on: T37E1, T37E2, T37E3, T37E4, T37E5, T37E6, T37E7, T37E8, T37E9, T37E10`

Run all ten §14.4 flows together, sharded, as the formal Phase 5 exit gate. This task writes
no new flow: its former criteria ("kill-and-restore during a turn", "offline-then-reconnect")
duplicated T37E6 and T37E8 almost verbatim, so it now depends on those children instead of
re-implementing them. What it adds is the thing no individual child can prove — that the ten
flows are reproducible _as a suite_, sharded, on the reference emulator.

Owns: `apps/android/maestro/` shard configuration and the CI invocation only; no flow file.
No other task in this wave touches those files.

- [ ] All ten flows pass in one sharded run on the reference emulator
- [ ] The suite is reproducible across runs, with no flow order dependence
- [ ] A single flow can still be run alone, unchanged, for local iteration

### Phase 6 — Advanced Pi parity

#### T38A0 — Mirror Pi's session fork, clone, naming, and auto-retry commands

`labels: phase-6, area: daemon` · `wave: P6-W1` · `depends-on: T10`

Add `fork`, `clone`, `set_session_name` and `set_auto_retry` to our hand-written mirror of
Pi's RPC surface, so the Phase 6 tasks that need them have something to call.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.ts` (these four commands
only). No other task in this wave touches that file.

**Why this task exists.** T38A3 (fork/clone), T38A4 (session naming) and T38B2 (auto-retry)
all have acceptance criteria that require these commands to round-trip against a daemon, but
none of the four is mirrored — verified: zero non-test occurrences of `fork`, `clone`,
`set_session_name` or `set_auto_retry` in `rpc-types.ts`, while all four exist in the
installed Pi's `dist/modes/rpc/rpc-types.d.ts` `RpcCommand` union. The task that would have
mirrored them (T51A) sits in Phase 7, _after_ Phase 6 completes, so Phase 6 as previously
ordered was unbuildable: three of its tasks depended on work scheduled to happen after them.
This is the same failure the queue modes produced in batch B, where a missing mirror entry
was mistaken for a missing Pi capability.

T51A still runs in Phase 7 and still audits the full surface; this task only unblocks the
four commands Phase 6 already committed to.

- [ ] `fork`, `clone`, `set_session_name` and `set_auto_retry` are mirrored, each matching
      Pi's real signature in `rpc-types.d.ts`
- [ ] Each is exercised against a dev daemon, not only type-checked
- [ ] The four are recorded as already-decided in whatever list T51A later produces, so the
      audit does not re-open them

#### T38A1a — Add the session tree model to core

`labels: phase-6, area: core` · `wave: P6-W1` · `depends-on: T27B6`

Model parent/child session relationships framework-neutrally.

Owns: `packages/frontend-core/src/sessions/tree.ts` and `tree.test.ts`. No other task in this wave touches those files.

- [ ] The tree models fork and clone relationships correctly
- [ ] Cycles are impossible by construction
- [ ] Covered by plain-Node tests

#### T38A1b — Add an edit-from-here branch shortcut

`labels: phase-6, area: core` · `wave: P6-W3` · `depends-on: T38A1a`

Give a one-step "edit from here" on a user message a way to express itself as a shortcut
through the branch tree built by T38A1a (ompweb review). Split out of the original T38A1,
whose fourth criterion was an independently shippable affordance on top of the tree model
rather than part of it.

Owns: `packages/frontend-core/src/sessions/tree-edit-shortcut.ts` and its test. No other task in this wave touches those files.

- [ ] "Edit from here" on a user message is expressible as a shortcut through the branch tree
- [ ] It composes with T38A1a's fork/clone model rather than duplicating it
- [ ] Covered by plain-Node tests

#### T38A2 — Render the session tree on web

`labels: phase-6, area: web` · `wave: P6-W2` · `depends-on: T38A1a`

Render parent/child relationships in the session rail.

Owns: `apps/web/src/features/sessions/session-tree.tsx` and its test. No other task in this wave touches those files.

- [ ] The tree renders parent/child relationships correctly
- [ ] Deep trees stay bounded and navigable
- [ ] Keyboard navigation works

#### T38A3 — Add session fork and clone

`labels: phase-6, area: web` · `wave: P6-W3` · `depends-on: T38A2, T38A0`

Add fork and clone operations.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

**You also own mounting T38A2's `SessionTree`.** The P6-W2 merge gate's import-graph walk
found it reachable from nothing but its own colocated test: it is not exported from
`apps/web/src/features/sessions/index.ts` and no screen renders it. T38A2's Owns grant
forbade touching the barrel, so this was a scope bind, not misconduct - but "the new session
appears in the tree" cannot be proven while the tree is on no screen.

- [ ] Fork and clone round-trip against a dev daemon
- [ ] The new session appears in the tree in the right place
- [ ] Failure leaves the original untouched
- [ ] `SessionTree` is exported from the feature barrel and rendered by a real screen, proven
      by the tree appearing in that screen's own test - registration is not receipt

#### T38A4 — Add session naming and metadata

`labels: phase-6, area: web` · `wave: P6-W4` · `depends-on: T38A3, T38A0`

Add renaming and session metadata editing.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Renaming round-trips and persists
- [ ] Names are validated and bounded
- [ ] Concurrent renames reconcile predictably

#### T38A5 — Check §11.1 command parity on web

`labels: phase-6, area: web` · `wave: P6-W5` · `depends-on: T38A4`

Verify the §11.1 command parity list is fully covered on web.

Owns: `apps/web/src/features/sessions/`. No other task in this wave touches those files.

- [ ] Every §11.1 command has a working web path
- [ ] Gaps are listed explicitly rather than assumed covered
- [ ] Parity is asserted by tests

#### T38B0a — Define queue-mode and per-message routing protocol types

`labels: phase-6, area: protocol` · `wave: P6-W1` · `depends-on: T10`

Define the protocol-level schema for reading and setting Pi's steering and follow-up queue
modes, and for routing an individual message as a steer or a follow-up. Split out of the
original T38B0, which had five criteria and owned three files across two packages — the same
shape the doc already split into T07A → T07B.

Owns: `packages/protocol/src/messages.ts` (the queue-mode and per-message-routing message
types only). No other task in this wave touches that file.

Pi already implements all of this; our mirror simply does not carry it. Verified in the
installed Pi: `set_steering_mode` / `set_follow_up_mode` are handled at
`dist/modes/rpc/rpc-mode.js:405-412`; `get_state` returns `steeringMode` and `followUpMode`;
`prompt` accepts an optional `streamingBehavior: "steer" | "followUp"`
(`rpc-types.d.ts:17-19`).

- [ ] Steering-mode and follow-up-mode get/set request and response types are added to the protocol schema
- [ ] The prompt message type gains an optional per-message steer/follow-up routing field; omitting it preserves today's behaviour
- [ ] Types round-trip through a schema fixture test

#### T38B0b — Mirror Pi's steering and follow-up mode RPC commands

`labels: phase-6, area: daemon` · `wave: P6-W2` · `depends-on: T38B0a`

Add `set_steering_mode` and `set_follow_up_mode` to our hand-written mirror of Pi's RPC
surface, and read current modes from `get_state` rather than caching them.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.ts` (these two commands only;
T38A0 owns the other four this phase adds). No other task in this wave touches that file.

- [ ] `set_steering_mode` and `set_follow_up_mode` are mirrored, matching Pi's real signatures
- [ ] Current modes are readable through the mirrored `get_state`, sourced from Pi rather than cached optimistically

#### T38B0c — Wire queue-mode changes and per-message routing through the daemon session

`labels: phase-6, area: daemon` · `wave: P6-W3` · `depends-on: T38B0b`

Make both mode changes take effect on the live session, keep every connected client's view of
the mode current, and route an individual message as a steer or a follow-up.

Owns: `packages/server/src/server/session.ts` (the queue-mode and per-message-routing handling
only). No other task in this wave touches that file.

**The mode is global to the agent session and Pi emits no event when it changes** (verified:
`dist/core/agent-session.js:1340-1341,1348,1356` — a plain property set, no emit), so a second
connected client would silently hold a stale value. This task closes that gap rather than
leaving each client to re-poll.

T97 (P6-W2, `e036ce8`) unblocked the third checkbox: `PiRuntimeSession.prompt` and
`PiCliRuntime.prompt` now carry Pi's optional `streamingBehavior`, and `rpc-types.ts`'s
`prompt` arm mirrors it. **But `test-utils/fake-pi.ts`'s `FakePiSession.prompt()` still
neither records nor exposes the argument**, so a fixture driving both routings has nothing to
assert against. Extending the fake is yours - no other task owns it.

Note also that `PiRpcCommand`'s trailing `| { id?: string; type: string }` catch-all arm makes
a dropped or mis-shaped field typecheck silently, so a type-only change proves nothing here.
Show the mutation.

- [ ] Both mode changes take effect on the live session end-to-end through the daemon
- [ ] After any mode change the daemon re-reads state and broadcasts it, so a second connected client is never stale
- [ ] A client can route an individual message as a steer or as a follow-up using T38B0a's field, covered by a contract fixture driving both modes and both routings against a dev daemon
- [ ] `FakePiSession.prompt()` records the `streamingBehavior` it received, and a test asserts
      the recorded value - not merely that the call did not throw

#### T38B1a — Add the steer and follow-up mode control

`labels: phase-6, area: web` · `wave: P6-W6` · `depends-on: T38A5, T38B0c`

Let the user see and change the current steering/follow-up mode, kept live across clients.
Split out of the original T38B1, which carried five criteria covering two independently
verifiable surfaces. See the T28B3 note for why an earlier revision wrongly dropped the mode
control entirely.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

The **mode** decides whether several queued messages are delivered together (`all`) or one per
cycle (`one-at-a-time`, the default for both) — distinct from the per-message steer/follow-up
choice built in T38B1b. Wording must make that distinction obvious, since it is easy to
conflate.

- [ ] The steering and follow-up modes can be changed, and the current value is visible without opening a menu
- [ ] A mode changed by another client is reflected here without a manual refresh
- [ ] No control offers to cancel or reorder an already-queued message, because Pi exposes no such command

#### T38B1b — Add per-message steer/follow-up routing to the composer

`labels: phase-6, area: web` · `wave: P6-W7` · `depends-on: T38B1a`

Let the user choose, per message, whether it steers the running turn or queues behind it.

Owns: `apps/web/src/features/composer/`. No other task in this wave touches those files.

**Steer** means "interrupt the running turn", **follow-up** means "run once it goes idle" —
independent of the T38B1a mode setting.

- [ ] While a turn is running, the user can send a message as a steer or as a follow-up, with a sensible default
- [ ] The resulting queue position is reflected in the T28B3 display

#### T38B2 — Add auto-compaction and auto-retry settings

`labels: phase-6, area: web` · `wave: P6-W8` · `depends-on: T38B1b, T38A0`

Add the auto-compaction and auto-retry settings surfaces.

Owns: `apps/web/src/features/settings/`. No other task in this wave touches those files.

- [ ] Settings round-trip and persist
- [ ] Defaults match daemon behaviour
- [ ] Changes take effect without a reload

#### T38B3 — Surface compaction, retry, and extension errors

`labels: phase-6, area: web` · `wave: P6-W9` · `depends-on: T38B2`

Make compaction, retry and extension-error states visible.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

**We currently throw away everything Pi tells us about a compaction.** Pi's
`CompactionResult` carries a structured `summary` plus
`details.{readFiles, modifiedFiles}`, but our mirror types `compaction_end`'s payload as
`result?: unknown` (`packages/server/src/server/agent/providers/pi/rpc-types.ts`) and
`transcript-view.ts` forwards only `status`, `trigger` and `preTokens`. So a compaction
today can only ever render as "something was compacted", never as what was summarised or
which files survived it. Closing this needs a small typing change in the daemon mirror and
`transcript-view.ts` — **outside this task's owned directory** — so treat it as a
prerequisite to raise with whoever owns those files, and record it in T51A's audit rather
than editing them from here. If the payload is still `unknown` when this task runs, say so
in the criterion below rather than rendering a placeholder that implies there is nothing to
show.

- [ ] Compaction and retry states render from fixtures, including the compaction summary and
      affected-file details where the daemon supplies them
- [ ] Extension errors surface as diagnostics, never silent drops
- [ ] Each state is explained in plain language

#### T40A1 — Cover the core extension fixtures

`labels: phase-6, area: core` · `wave: P6-W1` · `depends-on: T29B5`

Add payload fixtures for the first half of the §11.7 UI-bearing extensions.

Owns: `packages/frontend-core/src/testing/fixtures/extensions/`. No other task in this wave touches those files.

- [ ] Each covered extension has a canonical payload fixture
- [ ] Fixtures are shared by web and Android
- [ ] Fixtures round-trip through the schema

#### T40A2 — Cover the remaining extension fixtures

`labels: phase-6, area: core` · `wave: P6-W2` · `depends-on: T40A1`

Add fixtures for the rest of §11.7, including /btw, switchboard, workflows and rich ask-user.

Owns: `packages/frontend-core/src/testing/fixtures/extensions/`. No other task in this wave touches those files.

- [ ] Every §11.7 extension has a fixture
- [ ] The four named extensions are covered explicitly
- [ ] Fixtures round-trip through the schema

#### T40A3 — Verify web renderers and action round-trips

`labels: phase-6, area: web` · `wave: P6-W3` · `depends-on: T40A2`

Verify every §11.7 extension renders and its actions round-trip on web.

Owns: `apps/web/src/features/extensions/`. No other task in this wave touches those files.

**Known blocker you must close or escalate, found by T40A2 and confirmed at the P6-W2 gate:**
`packages/protocol`'s `ui-bridge/state.ts:579-600` handles `workflow:progress` by spreading
`...payload` raw and never lifting `step`/`total` into the typed `progress` payload's
`value`/`max` - `V1_PAYLOAD_FIELDS.progress` (`payload-compat.ts:58`) lifts only
`label|detail|value|max|indeterminate`. A renderer reading the typed payload therefore sees
`{ kind: "progress" }` with no numeric progress. `state.test.ts:454`'s existing case never
sends `step`/`total`, so nothing catches it. Fixing it is a protocol-side edit outside this
task's Owns grant: either get the grant widened or file it with the exact seam.

- [ ] Every §11.7 extension has a working web renderer
- [ ] Action round-trips are verified per extension
- [ ] Unknown channels produce one diagnostic
- [ ] The `workflow:progress` renderer shows real numeric progress, or the gap is filed with
      the exact lines above and the reason it could not be closed in scope

#### T40A4 — Verify the published channels

`labels: phase-6, area: web` · `wave: P6-W4` · `depends-on: T40A3`

Verify the subagents:fleet, workflow:progress and pi-goal:status channels end to end.

Owns: `apps/web/src/features/rail/`. No other task in this wave touches those files.

- [ ] All three published channels are verified live
- [ ] Channel state renders in the rail
- [ ] A dropped channel degrades visibly rather than silently
- [ ] **`pi-goal:status` carries `startedAt` through to the synthesized element.** Today
      `packages/server/src/server/agent/providers/pi/ui-bridge/state.ts` (case `"pi-goal:status"`)
      reads only `status`, `detail`/`text`, `tone` and `active`/`running`, so `startedAt` — which
      pi-goal already puts on the wire — never reaches a renderer. The extension is dropping the
      baked-in duration from its `detail` string (it was frozen: pi-goal publishes only on
      state-change and has no ticker, so elapsed time sat stale on screen until the next state
      change). Once it does, elapsed time can only be shown if the client computes it per frame from
      `startedAt`. Payload shape is unchanged either way, so nothing breaks — the display simply
      loses a stale number until this lands. **Ownership note:** that mapping is in
      `packages/server`, outside this task's `apps/web/src/features/rail/` grant and owned by no
      other task; take it here and say so in the commit

#### T39A — Add the Android session tree sheet

`labels: phase-6, area: android` · `wave: P6-W6` · `depends-on: T38A5, T33B7`

Bring the session tree to Android as a sheet.

Owns: `apps/android/src/features/sessions/session-tree-sheet.tsx` and its test. No other task in this wave touches those files.

- [ ] The tree renders and navigates on the emulator
- [ ] Fork, clone and rename round-trip
- [ ] No .web.\* file is introduced

#### T39B — Add Android model and thinking selectors

`labels: phase-6, area: android` · `wave: P6-W7` · `depends-on: T39A`

Add model and thinking-level selection to the compact composer.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] Selection changes round-trip and persist
- [ ] The current selection is visible without opening the picker
- [ ] Touch targets stay at least 48dp

#### T39C — Add Android queue, retry, and compaction surfaces

`labels: phase-6, area: android` · `wave: P6-W8` · `depends-on: T39B`

Bring queue controls and the retry and compaction surfaces to Android.

Owns: `apps/android/src/features/composer/`. No other task in this wave touches those files.

- [ ] Queue mode changes round-trip from the composer
- [ ] Compaction and retry states are visible
- [ ] Parity checks matching T38B pass on the emulator

#### T40B1 — Verify the Android extension matrix

`labels: phase-6, area: android` · `wave: P6-W5` · `depends-on: T40A4, T34B4`

Verify every §11.7 extension on Android.

Owns: `apps/android/src/features/extensions/`. No other task in this wave touches those files.

- [ ] Matrix complete: every §11.7 extension across fixture, web, android and action
- [ ] Unknown channels produce one diagnostic
- [ ] Gaps are listed explicitly

#### T40B2 — Add real-session transcript-protection tests

`labels: phase-6, area: core` · `wave: P6-W6` · `depends-on: T40B1`

Add the real-session tests that close the Phase 6 exit, re-checking project-memory and clarity protections end to end.

Owns: `packages/frontend-core/src/testing/real-session-protection.test.ts` (new file). The
rest of `src/testing/` is a shared tree — `fixtures/`, `recipe-lab.ts`, `host-profiles.ts` are
all used elsewhere — so this task must not claim it wholesale. No other task in this wave
touches that file.

- [ ] Hidden messages stay hidden end to end
- [ ] A final correction replaces in place rather than appending
- [ ] Both protections are asserted against a real session

### Phase 7 — Operational features

#### T41A1a — Enforce a single path-authorization door for file access

`labels: phase-7, area: web` · `wave: P7-W1` · `depends-on: T31D`

Ensure there is exactly ONE path-authorization door for `features/files/`: no secondary route
(for example, scanning transcript text for path-shaped strings) may grant access bypassing
canonicalization and the symlink check (ompweb review). Split out of the original T41A1: this
is a foundational security invariant that conflict detection is then built on top of, not one
of conflict detection's own criteria, and no such file exists in `features/files/` yet.

Owns: `apps/web/src/features/files/path-authorization.ts` and its test. No other task in this
wave touches those files.

The daemon side of this invariant is already implemented and tested — `file-explorer`'s
service resolves with `O_NOFOLLOW`, `realpath`s, and fstats the open handle rather than the
path, closing the TOCTOU window. This task is about the web app never opening a second door
around it.

- [ ] Every file-access entry point in `features/files/` routes through one canonicalization-and-symlink check
- [ ] No secondary route bypasses it
- [ ] The check cannot be bypassed accidentally, asserted by a test that tries

#### T41A1b — Detect file write conflicts

`labels: phase-7, area: web` · `wave: P7-W2` · `depends-on: T41A1a`

Detect concurrent modification before overwriting, built on T41A1a's single path check.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] A conflicting write is detected rather than silently overwriting
- [ ] Detection works across reconnects

#### T41A2 — Build the conflict resolution flow

`labels: phase-7, area: web` · `wave: P6-W15` · `depends-on: T41A1b`

Give the user a way to resolve a detected conflict.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] A conflicting write surfaces a resolution flow
- [ ] Both versions are viewable before choosing
- [ ] Cancelling leaves the file untouched

#### T41A3 — Add transfer progress and cancellation

`labels: phase-7, area: web` · `wave: P6-W16` · `depends-on: T41A2`

Show upload and download progress and allow cancelling.

Owns: `apps/web/src/features/files/`. No other task in this wave touches those files.

- [ ] Progress is visible and accurate
- [ ] Transfers can be cancelled cleanly
- [ ] A cancelled transfer leaves no partial file

#### T41A4 — Keep terminal latency within budget

`labels: phase-7, area: web` · `wave: P6-W17` · `depends-on: T41A3`

Measure and hold terminal latency and resize handling within budget.

Owns: `apps/web/src/features/terminal/`. No other task in this wave touches those files.

- [ ] Terminal latency stays within the §14.5 budget
- [ ] Resize ownership stays correct under load
- [ ] The measurement is repeatable in CI

#### T41B1 — Build the web diagnostics screen

`labels: phase-7, area: web` · `wave: P7-W1` · `depends-on: T31D`

Show versions, capabilities and connection path.

Owns: `apps/web/src/features/diagnostics/`. No other task in this wave touches those files.

- [ ] Version, capability and connection-path detail are shown
- [ ] The screen works while disconnected
- [ ] Values are copyable

#### T41B2 — Add the redacted diagnostics export

`labels: phase-7, area: web` · `wave: P7-W2` · `depends-on: T41B1`

Export a redacted log bundle.

Owns: `apps/web/src/features/diagnostics/`. No other task in this wave touches those files.

- [ ] The export contains no passwords, keys, prompts or file content
- [ ] A redaction test asserts each forbidden category
- [ ] Redaction failures fail the build, not just warn

#### T41B3 — Bound and stabilise the export

`labels: phase-7, area: web` · `wave: P6-W15` · `depends-on: T41B2`

Make the export reproducible and bounded.

Owns: `apps/web/src/features/diagnostics/`. No other task in this wave touches those files.

- [ ] The export is reproducible for the same state
- [ ] Its size is bounded with explicit truncation
- [ ] Truncation is disclosed inside the bundle

#### T42A1 — Add Android push and trusted devices

`labels: phase-7, area: android` · `wave: P7-W1` · `depends-on: T10, T37F`

Add push registration and trusted-device management.

Owns: `apps/android/src/features/devices/`. No other task in this wave touches those files.

- [ ] Registration and the trusted-device list work against the dev daemon
- [ ] Devices are identified without exposing secrets
- [ ] The list survives reinstall correctly

#### T42A2 — Add device revocation

`labels: phase-7, area: android` · `wave: P7-W2` · `depends-on: T42A1`

Allow revoking a trusted device.

Owns: `apps/android/src/features/devices/`. No other task in this wave touches those files.

- [ ] Revoking a device stops its notifications
- [ ] Revocation is confirmed explicitly
- [ ] A revoked device cannot silently re-register

#### T42A3 — Build the Android diagnostics screen

`labels: phase-7, area: android` · `wave: P7-W7` · `depends-on: T41B3`

Mirror the web diagnostics content and redaction guarantees.

Owns: `apps/android/src/features/diagnostics/`. No other task in this wave touches those files.

- [ ] Diagnostics mirror web content
- [ ] The same redaction guarantees hold, asserted by tests
- [ ] The screen works while disconnected

#### T42B1 — Execute the client data migration or reset

`labels: phase-7, area: android` · `wave: P7-W7` · `depends-on: T22`

Execute the draft and outbox migration or the explicit reset exactly as decided in docs/frontend-data-migration.md. Any export utility lives in the legacy checkout, never here.

Owns: `apps/android/src/platform/offline/`. No other task in this wave touches those files.

- [ ] Migration or reset is executed per the written decision
- [ ] No daemon password or private relay key is imported unencrypted
- [ ] The decision document matches what was actually done

#### T42B2 — Test versioned-JSON import

`labels: phase-7, area: android` · `wave: P7-W8` · `depends-on: T42B1`

Test the versioned-JSON import path if the decision requires it.

Owns: `apps/android/src/platform/offline/`. No other task in this wave touches those files.

- [ ] Versioned-JSON import is tested if applicable, or its absence is justified in writing
- [ ] A malformed import is rejected safely
- [ ] Import is idempotent

### Phase 8 — Cutover

#### T43A1 — Cut daemon packaging over to the new web app

`labels: phase-8, area: tooling` · `wave: P6-W18` · `depends-on: T11, T18, T31D, T37F`

Make apps/web/dist the daemon's bundled web UI in every packaging path.

Owns: `scripts/ and the daemon package`. No other task in this wave touches those files.

- [ ] A daemon package dry-run contains the new web app
- [ ] No packaging path still references the legacy bundle
- [ ] The build fails loudly if the artifact is missing

#### T43A2 — Verify the bundled UI serves correctly

`labels: phase-8, area: tooling` · `wave: P6-W19` · `depends-on: T43A1`

Verify the packaged daemon serves the bundled UI.

Owns: `scripts/`. No other task in this wave touches those files.

- [ ] The bundled UI serves correctly from the packaged daemon
- [ ] Bootstrap injection works from the package
- [ ] The check runs one-shot in CI

#### T43A3 — Add Docker and Nix packaging paths

`labels: phase-8, area: tooling` · `wave: P6-W20` · `depends-on: T43A2`

Add Docker and Nix packaging where those deployment paths are wanted.

Owns: `packaging/`. No other task in this wave touches those files.

- [ ] Docker and Nix paths build when enabled
- [ ] Both produce a working daemon with the bundled UI
- [ ] Both are skippable without breaking the default build

#### T43B1 — Re-verify provenance and notices

`labels: phase-8, area: docs` · `wave: P6-W25` · `depends-on: T05, T43A3`

Re-verify provenance records and confirm no unrecorded reference code drifted in.

Owns: `THIRD_PARTY_NOTICES.md and docs/T0*-provenance.md`. No other task in this wave touches those files.

- [ ] `rg "packages/app"` finds only reference notes
- [ ] The provenance audit finds no unrecorded reference code
- [ ] Every third-party dependency has a recorded licence

#### T43B2a — Retire the legacy install and pass the static gates

`labels: phase-8, area: tooling` · `wave: P8-W5` · `depends-on: T43B1`

Retire the legacy installs against the same $PASEO_HOME, and prove the repository is clean
under every gate that does not need a browser or a device.

Split from the original single task, which bundled seven gates — four of them static and
fast, two of them (web E2E, Android smoke) requiring a real browser and a running emulator.
Bundling a fast edit-fix-recheck loop with a multi-minute suite means every trivial lint fix
pays the full suite's latency. The slow half is now T43B2b.

Owns: the legacy-retirement documentation under `docs/` and any CI job wiring the static
gates. Not the E2E or smoke jobs — those are T43B2b's. No other task in this wave touches
those files.

- [ ] knip, typecheck, format, lint and the targeted unit tests all pass
- [ ] The legacy install is no longer needed for daily use
- [ ] The retirement steps are written down, including how to undo the retirement if the new
      install turns out to be missing something

#### T43B2b — Pass the browser and device suites as the packaging exit gate

`labels: phase-8, area: tooling` · `wave: P8-W10` · `depends-on: T43B2a`

**Where the two suites actually stand today (measured at `89717dd`, not assumed).** The web
half exists but points at the wrong artifact: `ci.yml`'s `web-tests` job builds `apps/web` with
`npm run build --workspace=@picompanion/web` and runs Playwright against that, with the E2E
fixture spawning a daemon out of `@picompanion/server/dist`. That is a dev build, not the
packaged daemon-served UI this task's first criterion names — T43A1 made `apps/web/dist` the
daemon's bundled UI in every packaging path, and `daemon-package-dry-run` plus
`run-guard-daemon-web-ui-bundled.mjs` already prove the artifact is produced. Pointing the
existing suite at that artifact is the work.

The Android half does not exist at all. `apps/android/maestro/` holds ten flows, and the only
Maestro-related CI job is `guard / apps/android/maestro never names port 6767`, which reads the
YAML and never runs it. There is no emulator job, and no job builds an APK.

Run the two slow suites against the packaged build produced by T43A1-T43A3 — the ones that
need a real browser and a real emulator, and which therefore must not be interleaved with a
fast edit-recheck loop.

Read `CLAUDE.md` "Working locally" before starting: run each suite in the FOREGROUND, once,
with a generous timeout. Do not background either and poll it.

Owns: the CI job wiring for the web E2E and Android smoke runs against the packaged artifact.
No other task in this wave touches those files.

- [ ] The web E2E suite passes against the packaged daemon-served UI, not just a dev build
- [ ] The Android smoke flow passes against the packaged app
- [ ] Neither suite was weakened, skipped, or retried into passing; any flake is fixed at its
      cause and the cause is written down

#### T59 — Deploy the daemon to a public VPS behind TLS

`labels: phase-8, area: tooling` · `wave: P8-W7` · `depends-on: T43A3, T43B2b`

**Owner decision, recorded so it is not rediscovered:** the daemon will run on a VPS reachable
from the public internet rather than on the owner's laptop. **Deliberately scheduled last.**
The owner's instruction was to build the apps first and deploy afterwards, so nothing in
Phases 5-7 may take a dependency on this task.

**TLS is a functional requirement here, not a hardening preference.**
`apps/web/src/platform/secure-storage.ts:51` calls `window.crypto.subtle.generateKey`, and
`crypto.subtle` is `undefined` outside a secure context — so on a plain-HTTP origin the
`plan.md` §16 requirement to keep relay key material "Web Crypto-wrapped in IndexedDB" does not
degrade, it throws. Android 9+ additionally blocks cleartext traffic by default. Neither client
works without TLS.

**Shape.** "Public IP" does not mean the daemon listens publicly. `bootstrap.ts:65` already
defaults to `127.0.0.1`; keep it there. Terminate TLS in a reverse proxy on 443 and proxy to
the loopback daemon. The owner still reaches one HTTPS origin from anywhere; the daemon is
never directly addressable. `plan.md` §16 already has the daemon serving static web assets with
`/api`, WebSocket and file routes authenticated, so this is one origin and one certificate for
both the UI and the API.

`plan.md` §16 states the daemon "grants full machine control to an authenticated client", and
the product ships a terminal. On a public host its existing defences — password auth, host
allowlist, DNS-rebinding protection, file path scoping — are the entire perimeter rather than a
second layer behind NAT. Treat them as load-bearing.

Owns: the deployment configuration and `docs/deployment-vps.md`. No application source.

- [ ] The daemon binds loopback only on the VPS; a reverse proxy terminates TLS on 443 with a
      certificate that validates in a stock mobile browser, and WebSocket upgrade is proxied
      correctly — a proxy that serves pages but drops the socket fails this task
- [ ] The host firewall exposes only SSH and 443; the daemon port is closed from off-host,
      verified by scanning from another machine
- [ ] SSH is key-only, and the daemon runs as a non-root user with no passwordless sudo
- [ ] Repeated failed authentication attempts are rate-limited or banned
- [ ] A physical Android device on mobile data, WiFi off, holds a live session against the
      deployment: a prompt streams a reply back token by token, backgrounding the app for 60
      seconds and returning either keeps the session live or recovers it, and rotation during
      an active session does not drop it. **This is the first time any of this is proven on
      real hardware** — Phase 5 is built and verified on the emulator, which shares the host's
      network stack and cannot show these failures. Whatever backgrounding actually does is
      recorded here; if it breaks the session, that is a `T46A2` resume-controller defect to
      file, not something to work around in a screen.
- [ ] `docs/deployment-vps.md` records the provider, sizing, exact bind and proxy config, the
      firewall rules, how certificates renew, and how to verify each of the above after a reboot
- [ ] The production daemon on port 6767 on the owner's laptop is untouched by any of this

### Phase 9 — Release hardening

#### T44A1 — Run the performance checks

`labels: phase-9, area: ci` · `wave: P9-W1` · `depends-on: T40B2, T41A4, T41B3, T42B2, T43B2b`

Complete the §14.5 performance checks across both platforms.

Owns: `CI workflows`. No other task in this wave touches those files.

- [ ] Every §14.5 budget is measured and met
- [ ] Measurements are recorded with numbers, not pass/fail alone
- [ ] Regressions fail CI

#### T44A2 — Run the accessibility gates

`labels: phase-9, area: ci` · `wave: P9-W2` · `depends-on: T44A1`

Complete the §10.5 accessibility gates.

Owns: `CI workflows`. No other task in this wave touches those files.

- [ ] Web axe gates pass across every route
- [ ] An Android TalkBack pass is recorded for the release candidate
- [ ] No gate was weakened to pass

#### T44A3 — Run security and version-drift checks

`labels: phase-9, area: ci` · `wave: P9-W3` · `depends-on: T44A2`

Complete security and version-drift checking.

Owns: `CI workflows`. No other task in this wave touches those files.

- [ ] Version drift between protocol, client and daemon is checked and documented
- [ ] Dependency and secret scans pass
- [ ] Findings are documented rather than silently waived

#### T44A4 — Run the full CI matrix

`labels: phase-9, area: ci` · `wave: P9-W4` · `depends-on: T44A3`

Run the complete CI matrix rather than the full suite locally.

Owns: `CI workflows`. No other task in this wave touches those files.

- [ ] The full CI matrix is green
- [ ] The matrix covers protocol, core, web, Android and backend
- [ ] Flaky jobs are fixed, not retried away

#### T44B1 — Produce the signed APK

`labels: phase-9, area: ci` · `wave: P9-W5` · `depends-on: T44A4`

Produce a signed internal sh.picompanion APK from the release workflow.

Owns: `the release workflow`. No other task in this wave touches those files.

- [ ] A signed APK is produced by the release workflow and attached to a release
- [ ] Signing material is not present in the repository
- [ ] The build is reproducible from a clean checkout

#### T44B2 — Verify clean installs and document rollback

`labels: phase-9, area: docs` · `wave: P9-W6` · `depends-on: T44B1`

Verify a clean laptop daemon install and a clean Android install, and document rollback and support.

Owns: `docs/`. No other task in this wave touches those files.

- [ ] A clean install of daemon and app is verified end to end
- [ ] The rollback procedure is documented, including which binaries run and that $PASEO_HOME is untouched
- [ ] Support steps are written for a non-expert reader

#### T45A1 — Add a frame-clock platform interface to frontend-core

`labels: phase-4, area: core` · `wave: P4-W4` · `depends-on: T14`

Define the platform frame-clock interface core uses to pace work, with a deterministic test implementation.

Owns: `packages/frontend-core/src/platform/frame-clock.ts`. No other task in this wave touches those files.

- [ ] The interface schedules and cancels a single pending callback with no DOM or React import
- [ ] A deterministic test clock drives it without timers or a browser
- [ ] A hidden or background state is representable so the host can pace differently
- [ ] The T14 import guard still passes

#### T45A2 — Batch streaming timeline updates onto the frame clock

`labels: phase-4, area: core` · `wave: P4-W5` · `depends-on: T45A1, T28A1`

Apply streaming timeline rows in one batch per frame tick so paint cost is bounded, without ever dropping a row.

Owns: `packages/frontend-core/src/timeline/coalescer.ts`. No other task in this wave touches those files.

**Our stream is delta-based — this was verified, not assumed.** `packages/server/src/server/agent/agent-stream-coalescer.ts`
already coalesces on a 60 ms window by **concatenation** (`previous.text += entry.text`) and flushes an
item carrying only that window's text. `packages/frontend-core/src/timeline/reducer.ts` never concatenates:
each flush becomes its own row keyed by `(epoch, seqStart)`. So **dropping any update permanently loses
text**, and latest-wins replacement is unsafe here. Batch the render, never the data.

- [ ] Pending rows are applied in one batch per frame tick; no row is ever discarded or replaced
- [ ] A test asserts that the concatenation of batched rows equals the unbatched sequence, character for character
- [ ] Any non-batchable event flushes the pending batch before it, so ordering is preserved
- [ ] Epoch and sequence handling from T20B is unchanged by batching

#### T45A3 — Wire the web frame clock and assert the paint budget

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T45A2, T28A2`

Provide the browser frame-clock implementation and prove the §14.5 paint budget under a high update rate.

Owns: `apps/web/src/platform/frame-clock.ts`. No other task in this wave touches those files.

- [ ] The web implementation uses `requestAnimationFrame` and a fallback cadence when the document is hidden
- [ ] A test drives 100 updates per second and asserts live-event-to-paint p95 under 100 ms
- [ ] Committed transcript items do not re-render while only the streaming item is updating

#### T46A1 — Fence asynchronous responses with a run generation

`labels: phase-4, area: core` · `wave: P4-W4` · `depends-on: T20B`

Give each prompt run a monotonic generation and discard any response that belongs to an older one.

Owns: `packages/frontend-core/src/timeline/run-generation.ts`. No other task in this wave touches those files.

- [ ] Every run carries a monotonic generation that increments on each new prompt
- [ ] A response tagged with an older generation is discarded and never mutates the replica
- [ ] A fixture proves a late response from an aborted run cannot restore a finished streaming row

#### T46A2 — Add a resume-reconciliation controller to core

`labels: phase-4, area: core` · `wave: P4-W5` · `depends-on: T46A1, T19A`

Reconcile against the authoritative timeline when the host reports it has resumed or the connection may be stale.

Owns: `packages/frontend-core/src/connection/resume-controller.ts`. No other task in this wave touches those files.

Closes a real gap: we handle a socket that **closes** (§7.4) and an app that **dies** (§12.5), but not a
socket that stays open and goes **silent** because the tab was backgrounded or the phone slept.

- [ ] A host-supplied resume signal triggers an authoritative fetch, not a blind trust of cached state
- [ ] While a run is active a bounded periodic check also runs, and it stops when the run settles
- [ ] Reconciliation reuses the T20B gap-detection path rather than adding a second recovery route
- [ ] Results are gated by run generation so a slow reconcile cannot clobber newer state

#### T46A3 — Trigger resume reconciliation from web lifecycle events

`labels: phase-4, area: web` · `wave: P4-W6` · `depends-on: T46A2`

Feed browser visibility and connectivity changes into the core resume controller.

Owns: `apps/web/src/platform/lifecycle.ts`. No other task in this wave touches those files.

- [ ] Returning to a backgrounded tab triggers reconciliation within one second of visibility
- [ ] Regaining network connectivity triggers the same path
- [ ] A test backgrounds the page during a run and asserts the transcript is correct on return

#### T47A1a — Define single-answer semantics for approvals and dialogs

`labels: phase-6, area: core` · `wave: P6-W2` · `depends-on: T21C`

Make an approval or dialog answerable exactly once across all connected clients, with a
defined outcome for the loser.

Owns: `packages/frontend-core/src/actions/arbitration.ts` and its test. No other task in this
wave touches those files.

We ship two clients by design. The action identity tuple
`(agentId, namespace, elementId, actionId, requestId)` (plan.md §12.3) is the right
foundation, but the plan never said what the losing client sees.

- [ ] A second answer to an already-answered request resolves as superseded, not as an error and not silently
- [ ] The superseded outcome carries who answered and what was chosen, where the daemon supplies it
- [ ] A fixture covers two clients answering the same request and both reaching a consistent final state

#### T47A1b — Guard prompt submission during a running turn against a new arbitration path

`labels: phase-6, area: core` · `wave: P6-W4` · `depends-on: T47A1a`

Confirm a prompt submitted while another client's turn is running follows the existing
steer-or-queue rules rather than acquiring a second path through T47A1a's arbitration logic.
Split out of the original T47A1, whose fourth criterion was a regression guard on an adjacent
code path rather than part of single-answer semantics.

Owns: `packages/frontend-core/src/actions/arbitration.ts` and its test. No other task in this
wave touches those files.

- [ ] A prompt submitted while another client's turn is running follows the existing steer or queue rules rather than a new path
- [ ] Covered by a regression test alongside T47A1a's fixture

#### T47A2 — Show contested and superseded state in the web dialog

`labels: phase-6, area: web` · `wave: P6-W4` · `depends-on: T47A1a, T28B7`

Tell the user when another client answered the request they are looking at.

Owns: `apps/web/src/features/approvals/`. No other task in this wave touches those files.

- [ ] A superseded dialog closes with a readable explanation rather than vanishing
- [ ] The explanation states the outcome and, where known, which client answered
- [ ] The state is conveyed in text, not by colour alone

#### T48A1 — Derive turn and session cost in core

`labels: phase-4, area: core` · `wave: P4-W4` · `depends-on: T29C1`

Derive monetary cost from the token and model fields already carried on the timeline.

Owns: `packages/frontend-core/src/telemetry/cost.ts`. No other task in this wave touches those files.

- [ ] Cost is derived per turn and accumulated per session from protocol fields, not guessed
- [ ] A model with no known rate yields an explicit unknown rather than zero
- [ ] Cached and uncached tokens are priced separately where the provider distinguishes them
- [ ] The rate table is data, not logic, so it can be corrected without touching the derivation
- [ ] Covered by unit tests in plain Node

#### T48A2 — Show session cost alongside the context meter

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T48A1, T29C2`

Display accumulated session cost next to the existing context-window meter.

Owns: `apps/web/src/features/telemetry/`. No other task in this wave touches those files.

- [ ] Session cost is visible without opening a panel and uses tabular mono figures
- [ ] An unknown rate renders as unknown, never as zero or a blank
- [ ] The value updates during a turn without re-rendering the transcript

#### T49 — Extend the Windows CI gate to core and web unit suites

`labels: phase-4, area: ci` · `wave: P4-W14` · `depends-on: T17A, T31D`

Run the frontend-core and web unit suites on Windows as well as Linux.

Owns: `.github/workflows/ci.yml` job definitions only, and only the jobs this task adds. No
other task in this wave touches that file. T31D lands first and owns the E2E and
performance-budget steps; build on the file as T31D leaves it.

Our daemon's primary host is a Windows laptop, and §15.4 currently runs only targeted server
tests there.

**Correction to an earlier revision of this task.** It claimed `packages/server`'s unit suite
"runs nowhere today". That is false and was false when written: `server-tests-ubuntu` and
`server-tests-windows` both exist in `ci.yml` and both already exclude `*.e2e.test.ts` through
the package's own `test:unit` script. Do not re-add them. The real gaps are the two below.

- [ ] The frontend-core suite runs on Windows in CI and is required, not advisory
- [ ] The `apps/web` unit suite runs on Windows in CI and is required, not advisory
- [ ] Path-handling assertions cover a drive-letter path, a path with mixed casing, and a long path
- [ ] `@picompanion/design-tokens` gets a test job on at least one platform. It has none today,
      so `contrast.test.ts` — the WCAG AA guard added by T54A1 after a real-browser axe run found
      shipped failures — currently gates nothing in CI
- [ ] Total added CI wall time is recorded in the pull request description

**This task cannot be run.** There is no git remote and none may ever be added, and no local
runner is installed, so no agent can execute these jobs. Verify what is verifiable — YAML
parses, every `run:` command exists as a real script in the workspace it names, matrix and
`needs:` wiring is consistent — and say plainly in the report that the jobs themselves were
never executed. Do not claim a green CI gate.

#### T57 — Anchor the transcript on the user's own prompt after sending (OPTIONAL)

`labels: phase-4, area: web` · `wave: P4-W14` · `depends-on: T53A2`

**Attempted once and reverted. Read this before attempting it again.**

The first attempt was merged-reviewed `broken` on two counts and never committed — its output
is preserved outside the repository, not in git history:

1. **The feature did not work.** `apps/web/e2e/prompt-anchor.spec.ts` failed deterministically,
   reproduced twice against real Chromium: `Expected: >= -2 / Received: -2900`. The just-sent
   row settled ~2900px above the viewport top, meaning true tail-following was still winning
   and the anchor never took effect. The implementing agent reported a clean passing run; that
   was not reproducible in the working tree it left behind.
2. **Undisclosed MIT adaptation — the licence requirement below was not met.**
   `getPromptAnchorSpacerHeight` was mathematically identical to pi-web's function of the same
   name in `D:\pi-web\lib\chat-lazy-load.ts` (same parameter order and meaning, same
   `target<=0` short-circuit, same formula, same rounding), and its unit test reused pi-web's
   test vectors verbatim. It was reported as independent derivation. None of
   `THIRD_PARTY_NOTICES.md`, an attribution header, or `docs/T57-provenance.md` were added.

A second attempt must therefore treat this as **adaptation, not derivation**, from the first
commit: write the attribution before the code. The pure arithmetic itself was sound — 15 unit
tests passed — so the work that remains is the transcript wiring, which is where the failure
actually was, plus the licence paperwork.

This task also cost 623 turns and 397k peak context, almost entirely polling a backgrounded
Playwright run. See `CLAUDE.md` "Working locally": run it in the foreground, once.

**Optional UX polish. Not a `plan.md` requirement and not a performance-budget item** —
schedule only if the product owner wants pi-web's send-then-anchor-to-top behaviour. Listed
here so the option is recorded rather than rediscovered.

Today `Transcript` always follows to the true bottom, so after sending, the reply grows
beneath the user's own message rather than that message settling at the top of the viewport.
Confirmed absent: no `prompt.*anchor`, `anchorPrompt` or `scrollUserMsgToTop` anywhere under
`apps/web/src`.

Owns: a new pure prompt-anchor helper under `packages/frontend-core/src/timeline/`
(implementation plus its test) and its narrow wiring into
`apps/web/src/features/transcript/transcript.tsx`. No other task in this wave touches those
files. **Do not touch the existing follow-tail threshold or effect** (`isNearBottom`,
`FOLLOW_TAIL_THRESHOLD_PX`) — see the pi-web findings section for why that half needs no work.

- [ ] After the user sends a message, the transcript scrolls so that message's row settles at
      or near the top of the viewport once it renders, using a pure, unit-tested
      spacer/offset calculation with no fixed guess at eventual reply length
- [ ] The calculation lives in `packages/frontend-core/` as framework-neutral, DOM-free
      arithmetic, with unit tests, and is exercised by a real-browser E2E assertion rather
      than jsdom alone
- [ ] The existing follow-tail behaviour is unmodified: prompt-anchor is a distinct state
      that applies only to the just-sent message, and normal tail-following resumes once its
      reply settles

If this adapts pi-web's `getPromptAnchorSpacerHeight` arithmetic rather than reimplementing
it, pi-web is MIT: `THIRD_PARTY_NOTICES.md` needs a new section, the adapted file needs an
attribution header, and `docs/T57-provenance.md` must record what was copied versus rewritten.

#### T58 — Lazy-load the two chunks blowing the session-route bundle budget (PARTIALLY DONE)

`labels: phase-4, area: web` · `wave: P4-W15` · `depends-on: T31D`

**Status: shipped as a partial fix; the budget is still not met. The remainder is T58B.**
Commit `76b4fef` took the session route from 772.1 KiB to **537.9 KiB gzip (550,850 bytes)**
against the 500 KiB (512,000 byte) budget — a real 234 KiB win, still 38,850 bytes over. CI
stays red until T58B lands. Do not re-attempt this task's remaining gap inside `apps/web`; the
weight is not there.

**The figure below was wrong, and a follow-up sized against it will fail the same way.** The
chunk the original table named `browser-probe-transport-*.js` at 401.8 KiB was a _bundler
naming artifact_ — the shared chunk had merely been named after one of its entry modules.
`browser-probe-transport.ts` is 76 lines; deferring it was correct and saved ~0.4 KiB.
Sourcemap inspection of the 399.6 KiB chunk that actually remains shows 105 sources:
`packages/protocol` (29), `packages/frontend-core` (26), `zod` (19), `packages/client` (7).
The lezer half of the table was accurate and is fully fixed — that chunk is now absent from
both `index.html`'s modulepreload list and the captured session-route payload, and the
234.2 KiB drop matches it exactly.

**CI is red until this lands.** T31D's bundle-size budget is not a speculative gate — it fails
today, honestly, on the current build.

Measured against a real `npm run build --workspace=@picompanion/web`, reproduced identically
across three separate runs: the session route ships **772.1 KiB gzip (790,581 bytes) against
the 500 KiB (512,000 byte) §14.5 budget**. Two chunks are eagerly `modulepreload`ed into every
route's `index.html` rather than being loaded on demand:

| chunk                          | gzip      | why it should be lazy                                                       |
| ------------------------------ | --------- | --------------------------------------------------------------------------- |
| `browser-probe-transport-*.js` | 401.8 KiB | Only needed once a connection is being probed, not on every route           |
| `lezer-highlighter-*.js`       | 225.3 KiB | CodeMirror/lezer syntax highlighting — only the files/editor route needs it |

Together they are 627.1 KiB gzip, so making both lazy brings the route comfortably under
budget without shrinking any feature. `vite build` independently warns
`(!) Some chunks are larger than 500 kB after minification` on the same build.

T31D deliberately did not fix this: the app source sits outside its owned files, and raising
the budget to make the test pass would have destroyed the only signal that the regression
exists. Do not raise the budget here either.

Owns: the route-level dynamic-import boundaries and any Vite `manualChunks` /
`modulePreload` configuration needed to move these two chunks off the session route. No other
task in this wave touches those files.

- [ ] `browser-probe-transport` and `lezer-highlighter` no longer load on the session route,
      and load on demand where they are actually needed
- [ ] `apps/web/e2e/performance-budgets.spec.ts`'s bundle assertion passes against a real
      build, with the measured figure recorded in the commit message
- [ ] No feature is removed or deferred to reach the number, and the 500 KiB budget is unchanged
- [ ] The event-to-paint p95 budget still passes — lazy chunks must not push first paint of a
      streaming reply past 100 ms

#### T58B — Keep the generated outbound validator out of browser bundles

`labels: phase-4, area: core` · `wave: P4-W16` · `depends-on: T58`

**This is the rest of T58, in the files that actually own the weight.** T58 could not close
because the remaining 399.6 KiB gzip is not in `apps/web` at all.

**Measured, not inferred.** `packages/client/src/daemon-client.ts:18` has a static
`import { validateWSOutboundMessage } from "@picompanion/protocol/validation/ws-outbound";`.
That reaches `packages/protocol/src/validation/ws-outbound.ts:2`, which statically imports the
generated `packages/protocol/dist/generated/validation/ws-outbound.aot.js` — measured directly
at **12,346,977 bytes raw / 517,546 bytes gzip unminified**, roughly **84% of the remaining
chunk** after minification. A 12 MB generated AJV validator is currently shipped to every
browser that opens the session route.

`DaemonClient` is constructed on mount by the always-mounted `DaemonClientProvider`, so this
edge is on the critical path for every route. No amount of route-level lazy loading in
`apps/web` can move it — that was proven by T58, which tried and reverted two such attempts.

**Do not weaken validation to win bytes.** Outbound messages must still be validated; this is
about _where the validator comes from in a browser build_, not whether validation happens.
Options worth measuring before choosing: loading the generated validator lazily on first
outbound send, shipping a compact runtime validator to browsers while the daemon keeps the
generated one, or splitting the generated module so only the message types a client can
actually send are reachable.

Owns: `packages/protocol/src/validation/`, the protocol build's validator generation, and
`packages/client/src/daemon-client.ts`. No other task in this wave touches those files.

Two dead ends already measured — do not repeat them:

- A dynamic `import("@picompanion/frontend-core")` makes things **worse** (409.78 → 417.96 KiB)
  because `packages/frontend-core/package.json` exposes only a `"."` export, so the dynamic
  import resolves the whole barrel and defeats per-export tree-shaking. Subpath exports would
  have to come first.
- A `manualChunks` split in `apps/web/vite.config.ts` shrinks the main chunk but leaves the new
  chunk `modulepreload`ed — net zero bytes on the wire.

- [ ] The session route measures at or under 512,000 bytes gzip, proven by
      `apps/web/e2e/performance-budgets.spec.ts` against a real build, with the figure recorded
      in the commit message
- [ ] Outbound message validation still happens on every send in both the daemon and browser
      builds, asserted by a test that fails if validation is skipped
- [ ] The 500 KiB budget, the spec and the `budget-*` fixtures are unchanged
- [ ] The event-to-paint p95 budget still passes — a validator fetched on first send must not
      push first paint of a streaming reply over 100 ms

#### T50 — Decide how the agent's configured surface is exposed

`labels: phase-7, area: docs` · `wave: P7-W2` · `depends-on: T10`

Decide whether, and how, the frontend shows what the agent currently has loaded — models, skills, MCP servers, extensions and subagent definitions.

Owns: `docs/agent-configuration-surface.md`. No other task in this wave touches those files.

This is deliberately a decision, not a build. The real need behind a settings surface is usually
diagnostic ("why isn't my skill firing"), and a read-only view answers it far more cheaply than editors —
but none of Pi's 32 RPC commands expose skills, MCP servers or plugins, so even that needs daemon work
we have not scoped.

- [ ] The document records which of these the daemon can already report, and which would need new RPC or daemon work
- [ ] It states a decision between three options: nothing, a read-only "what is loaded" diagnostics view, or editors — with a reason
- [ ] If the answer is anything other than nothing, it lists the follow-up tasks at the same granularity as the rest of this file

#### T52A1 — Stop dropping inbound image and attachment content

`labels: phase-4, area: daemon` · `wave: P4-W9` · `depends-on: T10`

Carry the image and attachment content Pi already sends through to the timeline instead of discarding it.

Owns: `packages/server/src/server/agent/providers/pi/history-mapper.ts` and the message variants of
`AgentTimelineItem` in `packages/protocol/src/agent-types.ts`. No other task in this wave touches those files.

Found by T28A5 in batch C. `getUserMessageText` accepts `(PiTextContent | PiImageContent)[]` and
keeps only the text blocks, so an image a user pasted is gone before any client sees it.

- [ ] Image and attachment blocks survive the mapping instead of being silently skipped
- [ ] The timeline item type can express them, and existing text-only items are unaffected
- [ ] Large binary content is referenced rather than inlined wholesale into every timeline fetch
- [ ] A fixture proves a message with mixed text and image content round-trips

#### T52A2 — Carry attachments through the transcript view model

`labels: phase-4, area: core` · `wave: P4-W10` · `depends-on: T52A1`

Expose message images and attachments on the transcript entry so any platform can render them.

Owns: `packages/frontend-core/src/timeline/transcript-view.ts`. No other task in this wave touches those files.

- [ ] `user-message` and `assistant-message` entries can carry images and attachments alongside text
- [ ] Entries without them are unchanged, so existing renderers keep working
- [ ] Covered by shared fixtures that both platforms can consume
- [ ] No React, DOM or platform import is introduced

#### T52A3 — Render message images and attachments in the transcript

`labels: phase-4, area: web` · `wave: P4-W11` · `depends-on: T52A2`

Completes the criterion T28A5 could not.

Owns: `apps/web/src/features/transcript/`. No other task in this wave touches those files.

- [ ] A message's images render with a meaningful accessible name, not a filename alone
- [ ] Non-image attachments show type and size and are keyboard reachable
- [ ] Oversized content stays bounded with a visible note, consistent with T28A5's existing bounding
- [ ] axe is called and asserted on a message carrying both

#### T53A1 — Construct a live DaemonClient and provide it to routes

`labels: phase-4, area: web` · `wave: P4-W9` · `depends-on: T19A, T27A3`

Give the web app a real daemon connection. **Nothing in `apps/web` constructs a `DaemonClient`
today**, so every feature runs against fixtures only and the app cannot talk to a daemon at all.

Owns: `apps/web/src/app/daemon-client-context.tsx` (new) and the provider wiring in
`apps/web/src/app/App.tsx`. No other task in this wave touches those files.

- [ ] A `DaemonClient` is constructed from the stored/paired connection and provided to the tree
- [ ] Routes and feature containers can obtain it without prop-drilling through screens
- [ ] Its lifecycle follows T19A: connect, reconnect, and dispose without leaking sockets
- [ ] Absence of a connection is a normal state, not a crash — the app still renders
- [ ] No token or daemon key is placed in a URL query string

#### T53A2 — Mount the transcript into the session screen

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T53A1, T52A3`

The transcript feature is fully built and tested but **no screen renders it**.

Owns: `apps/web/src/routes/screens/host-session-screen.tsx`. No other task in this wave touches that file.

- [ ] The real transcript renders in the session screen's centre region, above the composer
- [ ] It is fed by the live client from T53A1 and updates as the session streams
- [ ] The stale doc comment claiming the transcript is "not-yet-built" is corrected
- [ ] The screen's existing resume, approvals and composer behaviour is unchanged

#### T53A3 — Mount the session and extension rails into the shell

`labels: phase-4, area: web` · `wave: P4-W10` · `depends-on: T53A1, T29R2`

`Shell` accepts `sessionRail` and `extensionRail`, but `root-route.tsx` passes **neither**, so both
regions have shown their empty-state fallback since the shell was built.

Owns: `apps/web/src/routes/root-route.tsx`. No other task in this wave touches that file.

- [ ] The real session rail fills the `sessionRail` slot
- [ ] The real Pi extension rail (and context/cost meters) fills the `extensionRail` slot
- [ ] The plan §8.3 three-region layout is genuinely visible, not just structurally possible
- [ ] The compact fallback still collapses correctly at narrow widths

#### T53A4 — Give the sessions list screen the live client

`labels: phase-4, area: web` · `wave: P4-W10` · `depends-on: T53A1`

Proven broken by the E2E suite: `host-sessions-screen.tsx` never passes `SessionsScreen` a `client`, so "New session" never reaches a daemon even with an authenticated connection open. Found and documented by the T31B agent rather than hidden.

Owns: `apps/web/src/routes/screens/host-sessions-screen.tsx` and the `client` plumbing of `apps/web/src/features/sessions/SessionsScreen`. No other task in this wave touches those files.

- [ ] Creating a session from the UI reaches the live daemon
- [ ] The list reflects the daemon's real sessions, not fixture data
- [ ] Absence of a connection stays a normal rendered state, not a crash

#### T53A5 — Give the files, terminal and settings screens the client

`labels: phase-4, area: web` · `wave: P4-W10` · `depends-on: T53A1`

The same assembly gap as T53A4, on the remaining screens. Only the session screen and the rails received the live client; every other screen still runs against fixtures only.

Owns: `apps/web/src/routes/screens/host-session-files-screen.tsx`, `host-session-terminal-screen.tsx`, `host-settings-screen.tsx` and `host-screen.tsx`. No other task in this wave touches those files.

- [ ] Each screen obtains the live client from the T53A1 context
- [ ] Files and terminal operate against the real daemon over RPC
- [ ] Each screen renders a sensible state when no connection exists

#### T54A1 — Bring the palette to WCAG AA contrast

`labels: phase-4, area: design` · `wave: P4-W12` · `depends-on: T13C`

Raise the failing token pairs to WCAG AA. **User decision, 2026-09-03: accessibility wins over
byte-exact fidelity to Beautiful UI.** Nudge the values; keep them visually as close as possible.

Owns: `packages/design-tokens/` (both themes, both platforms) and `docs/beautiful-ui-reference.md`.
No other task in this wave touches those files.

Found by the first axe run in a REAL browser (jsdom never caught it). Measured pairs:

| pair                                      | now    | needs |
| ----------------------------------------- | ------ | ----- |
| light `ink-3` `#9a9da3` on page `#fafafb` | 2.61:1 | 4.5:1 |
| light `ink-3` `#9a9da3` on surface `#fff` | 2.72:1 | 4.5:1 |
| dark `ink-3` `#6c6f75` on page `#17181a`  | 3.53:1 | 4.5:1 |
| white on light accent `#0285ff`           | 3.62:1 | 4.5:1 |
| white on danger red `#e3474c`             | 3.98:1 | 4.5:1 |

Suggested minimal moves: light `ink-3` -> `#707377` (4.57:1), light accent -> `#0275e0` (4.54:1).

- [ ] Audit EVERY token pair actually used as text-on-background, not only the five axe happened to
      render — compute the ratios programmatically for both themes
- [ ] Every such pair meets 4.5:1 for normal text (3:1 is acceptable only for large text and
      non-text UI boundaries, and each such case is named)
- [ ] A test asserts the ratios so the palette cannot silently regress
- [ ] Web and Android stay in step; no raw hex is introduced at any call site
- [ ] `docs/beautiful-ui-reference.md` records the old value, the new value and the measured ratio
      for each change, so the deviation from the reference is deliberate and reviewable

#### T54A2 — Give the app shell a level-one heading

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T27S1`

axe's `page-has-heading-one` fails: the assembled shell renders no `<h1>` on any route.

Owns: `apps/web/src/ui/shell.tsx` and its stylesheet. No other task in this wave touches those files.

- [ ] Every route exposes exactly one level-one heading naming the current view
- [ ] It is meaningful to a screen reader and not visually intrusive (visually-hidden is acceptable)
- [ ] The existing heading hierarchy below it is not broken (no skipped levels)
- [ ] axe's `page-has-heading-one` passes in the real browser, asserted by the E2E keyboard spec

#### T54A3 — Feed browser offline events into connection status

`labels: phase-4, area: web` · `wave: P4-W12` · `depends-on: T53A1`

Nothing feeds the browser's offline signal into connection status, so the only exit from
"connected" is `DaemonClient`'s liveness heartbeat — up to ~50s (10s interval, 15s timeout, two
consecutive failures). `e2e/reconnect-and-catch-up.spec.ts` fails waiting for the stale banner.

Owns: the web platform network adapter under `apps/web/src/platform/` and its wiring into the
connection controller. No other task in this wave touches those files.

Do NOT fix this by lengthening the spec's timeout; the heartbeat is a backstop, not the signal.

- [ ] `navigator.onLine` and the `online`/`offline` events reach connection status promptly
- [ ] Going offline marks the session stale quickly; coming back online triggers catch-up
- [ ] The heartbeat still covers the silent-socket case (plan.md §7.4) where no browser event fires
- [ ] The listener is removed on teardown, leaking nothing across route changes

#### T51A — Audit the Pi RPC mirror and decide what to carry

`labels: phase-7, area: daemon` · `wave: P7-W1` · `depends-on: T10, T38A0, T38B0c`

Reconcile our Pi RPC mirror against what Pi actually accepts, and decide deliberately what to
carry.

Owns: `docs/pi-extension-compatibility.md` (the findings section only). No other task in this
wave touches that file.

`packages/server/src/server/agent/providers/pi/rpc-types.ts` is a hand-written mirror of Pi's
RPC surface inherited from the reference implementation, and it has silently drifted.

**Corrected counts.** An earlier revision of this task said Pi accepts 35 request types and
the mirror omits 19, counting `extension_ui_response` among them. Both numbers were wrong.
Verified against the installed Pi's `dist/modes/rpc/rpc-types.d.ts`: the `RpcCommand` union
(`:14-132`) has **32** request types, and `RpcExtensionUIRequest` (`:385`) and
`RpcExtensionUIResponse` (`:443`) are two separate types _outside_ that union — the first is
server→client, the second is the client's reply to it, so neither is a client request. The
correct framing is **32 request types plus 2 extension-UI message types**, which is what
`plan.md` already says. Our mirror covers 14 of the 32, so **18** are omitted, not 19.

By the time this task runs, T38A0 will have mirrored `fork`, `clone`, `set_session_name` and
`set_auto_retry`, and T38B0b will have mirrored `set_steering_mode` and `set_follow_up_mode`,
leaving these outstanding: `abort_bash`, `abort_retry`, `bash`, `cycle_model`,
`cycle_thinking_level`, `export_html`, `get_available_thinking_levels`, `get_commands`,
`get_fork_messages`, `get_last_assistant_text`, `new_session`, `switch_session`.

This is not a request to mirror all of them — some are deliberately out of scope (we own our
own terminal, so `bash` and `abort_bash` are not ours to expose). `get_last_assistant_text` is
one to record as **deliberately excluded**, not deferred: it solves a problem a client-side
mirror has when it holds no transcript state of its own, and our daemon already owns the full
timeline. It is a request to stop discovering the gap one feature at a time, as happened with
the queue modes in batch B, where a missing entry was mistaken for a missing capability and a
working feature was nearly designed out of the product — and again with fork/clone/naming/
auto-retry, which three Phase 6 tasks committed to before anything mirrored them (see T38A0).

Also record here the discarded compaction payload T38B3 depends on: `compaction_end` is typed
`result?: unknown` in the mirror, so Pi's structured `summary` and
`details.{readFiles, modifiedFiles}` never reach a client.

- [ ] Every Pi request type is listed with a decision: mirrored, deliberately excluded with a reason, or deferred to a named task
- [ ] Anything a planned task already depends on is mirrored, not deferred
- [ ] The findings section records the Pi version audited against, and the corrected 32/2 count

#### T51B — Add a drift-detection test for the Pi RPC mirror

`labels: phase-7, area: daemon` · `wave: P7-W3` · `depends-on: T51A`

Fail a test if Pi gains or renames a request type our mirror does not account for, so the gap
T51A closes cannot silently return. Split out of the original T51: the test is a distinct
deliverable in a different file from the audit document, and shipping the audit without it is
how the drift returns.

Owns: `packages/server/src/server/agent/providers/pi/rpc-types.test.ts` (new file). No other
task in this wave touches that file.

- [ ] A test fails if Pi's installed RPC command set diverges from T51A's recorded decision list
- [ ] The test names the specific new, renamed, or removed type in its failure message

---

## Coverage verification

### Plan §13 phase exits → tasks

| Phase exit criterion                                                 | Covered by                              |
| -------------------------------------------------------------------- | --------------------------------------- |
| P0: ported backend builds, targeted tests pass                       | T02, T03, T04                           |
| P0: protocol/bridge fixtures round-trip without payload loss         | T06A, T06B, T07A, T07C                  |
| P0: compatibility tags and gates present                             | T07A, T07C                              |
| P0: incremental live-tail benchmark passes                           | T09A, T09B                              |
| P0: extension and license inventories exist                          | T05, T10                                |
| P0: no frontend code imported                                        | T01, T17A                               |
| P1: both apps show connected/disconnected shell from shared state    | T15, T16                                |
| P1: no production import references legacy frontend code             | T14, T17A                               |
| P1: workspaces recognized by install/typecheck/knip/CI               | T12A, T17A                              |
| P1: daemon packages cleanly with or without web artifact             | T18                                     |
| P2: recorded session driven fully in Node without React              | T24                                     |
| P3: primitives/recipes with matching semantics + a11y, no variants   | T25A, T25B, T26A, T26B                  |
| P4: web runs real session, approvals, fleet, reconnect, safe tools   | T27S1-T31D (all of Phase 4)             |
| P5: Android same scenario over Wi-Fi/relay, notification, proc-death | T32S1-T37F (all of Phase 5)             |
| P6: every UI-bearing extension has fixture/renderer/action/test      | T40A1-T40A4, T40B1, T40B2               |
| P7: apps diagnose failures without exposing secrets                  | T41B1-T41B3, T42A3                      |
| P8: packaging contains new web app; legacy retired                   | T43A1-T43A3, T43B1, T43B2a, T43B2b, T59 |
| P9: release candidate usable daily on web and Android                | T44A1-T44A4, T44B1, T44B2               |

### Plan §19 Definition of Done → tasks

| DoD item                                                      | Covered by                      |
| ------------------------------------------------------------- | ------------------------------- |
| No legacy `packages/app` code anywhere                        | T01, T17A, T43B1                |
| Web and Android connect via `@picompanion/client`             | T19A, T27A1-T27A6, T32A1-T32A6  |
| frontend-core has no React/DOM/RN/Expo imports                | T14 (enforced guard)            |
| Recorded session → equivalent domain state on both platforms  | T24, T31B, T37E1-T37E10         |
| All Pi RPC lifecycle states visible                           | T28A1-T28A7, T33A1-T33A6        |
| All ten bridge kinds render, actions round-trip               | T21C, T29A1-T29B5, T34A1-T34B4  |
| Every §11.7 UI-bearing extension has parity evidence          | T40A1-T40A4, T40B1, T40B2       |
| Unknown tools and unknown elements fail safely                | T23, T28A4, T29A1, T33A4, T34A1 |
| Web responsive wide and compact layouts                       | T27S1, T28A7                    |
| Android notification/process-death/keyboard/offline scenarios | T33B4, T36A-T36D, T37A-T37F     |
| Daemon bundles `apps/web/dist`                                | T18, T43A1, T43A2               |
| Signed `sh.picompanion` APK pipeline                          | T17B, T44B1                     |
| Protocol/core/web/Android/backend CI gates pass               | T17A, T44A4                     |
| Accessibility and performance budgets met                     | T25B, T26B, T31D, T44A1, T44A2  |
| Docs no longer describe Paseo's old frontend as the product   | T12B, T43B1                     |

### Constraint checks

- **frontend-core purity:** enforced by T14's guard; every core task (T19A-T24, T28A1,
  T29C1, T30A1, T38A1a, T40A1, T40A2, T40B2) runs under it.
- **Web DOM-first Vite:** T15 (no Next/SSR), T25A/B, and every `area: web` task in Phases
  4, 6 and 7.
- **Android android-only, no `.web.*`:** T16 guard; T26A/B, and every `area: android` task
  in Phases 5, 6 and 7.
- **Bridge payload fix before any renderer:** T07A → T07B precede T21B, and T21C precedes
  T29A1 and T34A1. No renderer task depends on anything earlier in that chain.

### Sizing and collision rules (added after two failed Phase 4 attempts)

The first two attempts at Phase 4 were abandoned because the tasks were far too large.
Measured from the aborted run: tasks that finished comfortably produced 40-70K output
tokens, while T27A (224K) and T30B (184K) both hit the 45-minute agent timeout **without
finishing**. Every task in Phases 4-9 is now scoped to the smaller shape. This is a sizing
guideline, not a hard cap.

Two structural rules follow from those failures:

- **Each family owns a directory.** Every task above declares the files it owns. Within a
  family, tasks run serially; across families they run in parallel. Two tasks in the same
  wave therefore never touch the same file.
- **The shell and route table are owned by dedicated tasks** (T27S1/T27S2 on web,
  T32S1/T32S2 on Android) that land first and expose named slots. Feature tasks mount into
  a slot rather than editing the shell, which is where the earlier attempts collided.

---

## Findings folded in from the ompweb review

`D:\ompweb` (MIT, © 2026 agegr) is a shipped web GUI for a different agent. It was read as an
**architectural reference only**; no code was adopted, so it needs no `THIRD_PARTY_NOTICES.md`
row. Full review: `D:\ompweb-review\`.

The central insight is that ompweb is a **mirror** of state something else owns: the agent CLI
owns a `.jsonl` file on disk, and when anything goes wrong ompweb re-reads it. That is why it
needs no reducer, no store, no sequence numbers and no replay buffer. We cannot make that
trade, because our daemon is authoritative and `frontend-core` is a **replica** that must stay
correct across a network, a reconnect, two clients and Android process death. Their architecture
is therefore not evidence against ours.

**Accepted as new tasks:** T45A1–T45A3 (streaming rate control), T46A1–T46A3 (staleness fencing
and resume), T47A1a/T47A1b–T47A2 (multi-client arbitration), T48A1–T48A2 (cost), T49 (Windows CI),
T50 (configuration-surface decision).

**Reshaped before acceptance.** The review proposed adopting ompweb's latest-wins coalescing,
on the premise that update frames carry the full accumulated message. That premise is **false
for us**, and it was checked rather than assumed: our server coalescer concatenates
(`previous.text += entry.text`) and flushes only that window's text, and the client reducer
never concatenates, so each flush is its own `(epoch, seqStart)` row. Dropping any update would
permanently lose text. T45A2 therefore batches the **render** without ever dropping a **row**.
Note also that server-side coalescing already exists, so only the client half was missing.

**Folded into existing tasks as extra criteria, with no new task:** payload bounding (T28A6),
large-markdown degradation (T28A5), roster reconstruction after reload (T29B1), edit-from-here
(T38A1b), the Android frame clock (T33A2B), Android lifecycle feeding (T32S1B), and the
single-authorization-door rule (T41A1a).

**Deliberately not built.** MCP, skills and plugin editors: the real need behind them is
diagnostic, and none of Pi's 32 RPC commands expose those surfaces, so T50 decides before
anything is built. Also declined: subagent authoring, git worktree management, session export,
a global command palette, a chat minimap (it interacts badly with our virtualized transcript),
and a tray/autostart wrapper (desktop wrappers are a non-goal under §2.3). **Transcript search**
is the strongest deferred candidate and should be revisited once the Phase 4 slice is usable.

**Localization is deferred, not rejected.** There are zero mentions in `plan.md`; ompweb carries
~1,260 keys across three languages. Deferred because no need is stated and our user-facing
strings sit in features rather than primitives, which keeps the cost of reversing this bounded.
Worth a deliberate decision before the component set grows much further.

**Where we are already ahead of ompweb:** tool approvals, transcript virtualization against real
budgets, epoch and sequence gap recovery, authenticated remote access, and testing — their
central 3,334-line session hook has no test at all, in a repository with 94 test files, because
it cannot be tested without a browser. That is the strongest argument for our T14 purity rule.

---

## Findings folded in from the pi-web review

`D:\pi-web` is a **read-only reference checkout**, reviewed the same way `D:\paseo` is: for
behaviour, never for code. It is MIT-licensed (unlike Paseo), so adaptation is possible with
attribution — but nothing has been adopted, and the review produced exactly one optional task
(T57). It is not a fork source and no code from it is in this repository.

**Safety note before anyone experiments with it.** Opening a pi-web tab cold-starts an
in-process agent. If you try it against a live host, the session-corruption risk begins the
moment the tab opens, before you type anything — point it at a scratch session, never one the
production daemon on port 6767 is serving.

What the review changed in this file:

- **T51's counts were wrong and are now corrected** (see T51A): 32 request types plus 2
  separate extension-UI message types, 18 omitted — not "35 request types, 19 omitted".
- **A dependency inversion was found and closed** (see T38A0): three Phase 6 tasks required
  `fork`, `clone`, `set_session_name` and `set_auto_retry`, none of which is mirrored, and
  the task that would have mirrored them sat in Phase 7. Phase 6 as previously ordered was
  unbuildable.
- **`get_last_assistant_text` is now recorded as deliberately excluded**, not deferred. It
  solves a problem pi-web's architecture has — a client mirror holding no transcript state of
  its own. Our daemon already owns the full timeline.
- **The discarded compaction payload is now named** in T38B3 and T51A: `compaction_end` is
  typed `result?: unknown`, so Pi's structured summary and read/modified file details never
  reach a client.

What the review explicitly did **not** change, and why:

- **Transcript follow-tail hysteresis: already handled.** The proposed "T56/T57 hysteresis"
  work is already implemented in `transcript.tsx` via `isNearBottom` and
  `FOLLOW_TAIL_THRESHOLD_PX`. No task.
- **The path-authorization TOCTOU pattern pi-web is credited for: we already implement it.**
  `file-explorer`'s service resolves with `O_NOFOLLOW`, `realpath`s, and fstats the open
  handle rather than the path. T41A1a exists to stop the _web app_ opening a second door
  around that, not to build the daemon-side check.

#### T296 — `wrapSessionProvider` drops six optional `AgentSession` methods

`labels: phase-9, area: server` · `wave: P9-W75` · `depends-on: T293`

T293 shipped `respondToEditorTextRequest` and disclosed, correctly, that
`wrapSessionProvider` does not proxy it. The P9-R merge gate traced the escape and it is
narrower than "always broken" but wider than "never hit":
`createResolvedProviderClient` returns `inner` **unwrapped** when
`inner.provider === provider && !hasModelOverrides`, so the plain builtin `pi` provider keeps
every method. **A provider profile carrying model overrides, or an aliased provider, goes
through the wrapper and silently loses the method.**

This is not a T293 defect — the shape predates it and is shared with five sibling optional
methods (`setSteeringMode`, `getQueueModes`, `setFollowUpMode`, `setFeature` and the
transfer-cancellation member). T293 is simply the sixth, and the first whose loss the owner
would notice: `prompt-arbitrage` would work on the default provider and be inert on a profile,
with no error anywhere.

**The fix must be structural, not another hand-added passthrough.** Six additions in a row
made by hand is the evidence that a seventh will be forgotten. Options, and the choice must be
argued:

1. Proxy the whole object (`Proxy`, or a generated forwarder) so an optional method added
   later is carried without an edit here.
2. Keep the explicit list but add a test that enumerates `AgentSession`'s optional members
   from the type and fails when one is not forwarded.
3. Decide the wrap should not exist for these members at all and say why.

Whichever is chosen, the acceptance bar is a test that would FAIL if a seventh optional
method were added and not forwarded — prove it by adding a throwaway seventh member, watching
the failure, and removing it.

Owns: `packages/server/src/server/agent/provider-registry.ts` and its test.

- [ ] Every optional `AgentSession` method survives the wrap, proven per member
- [ ] The proof fails when a new optional member is not forwarded, demonstrated
- [ ] The unwrapped fast path (`inner.provider === provider && !hasModelOverrides`) is stated
      accurately wherever it is described
- [ ] `getEditorText` is exercised through a model-override profile specifically

#### T297 — Land T280's deterministic `ENOTEMPTY` reproduction as a real test

`labels: phase-9, area: server` · `wave: P9-W76` · `depends-on: T280`

T280's fix is sound and its limit was disclosed honestly. The limit is that **nothing in the
committed tree can fail if the fix is removed.** Measured twice independently at the P9-R
gate: reverting `waitForBackgroundDispatchToSettle` to the pre-T280 `storage.flush()`-only
body leaves `create.test.ts` at `10 passed (10)`, five runs out of five. A future task can
undo the fix and every gate stays green — the exact "a fix that no test can fail is not a fix"
shape `CLAUDE.md` names.

The gate measured why, and the reason matters for how this is closed:

- **`createAgentCommand` returns a real handle only when it dispatched an initial prompt**
  (`create.ts` assigns it under `if (initialPromptStarted)`). Two of the file's six
  real-storage cases create without a prompt, so what they await is the
  `() => Promise.resolve()` default and closes nothing. `AgentStorage.pendingWrites.size` is
  0 at that point in both, so there is no live window there — but the coverage is narrower
  than the file's own comment reads.
- For the four prompt-bearing cases, `backgroundTasks` and `pendingWrites` were both **0** at
  the pre-fix point and after the full settle, in all four invocations. The fix is strictly
  stronger than what it replaced and provably inert at today's timings.

So the reproduction must **force** the late write, not wait for it: stub or monkey-patch
`writeFileAtomic` (or `AgentStorage.writeRecord`) to land after the `rmSync` enumeration, show
`ENOTEMPTY` without the fix, and show it gone with the fix. A prompt-bearing case must be part
of it so the handle under test is never the no-op default.

**Do not close this by raising a timeout, retrying the `rmSync`, or moving the file into
`test:unit:serial`** — T240 rules that out for this repository, and the race here is between
one test and its own asynchronous continuation, not between sibling files.

Owns: `packages/server/src/server/agent/create-agent/create.test.ts` and any test-only helper
it needs.

- [ ] Removing the fix makes a committed test FAIL, demonstrated both ways
- [ ] The forced-ordering mechanism is explicit, not a sleep or a timing assumption
- [ ] At least one prompt-bearing case is covered, so the handle is a real one
- [ ] No retry, no raised `testTimeout`, no new `test:unit:serial` member
- [ ] `create.test.ts`'s own comment about coverage matches what the tests actually cover

#### T298 — Pin `app.config.ts`'s permission decision as a registered capability

`labels: phase-9, area: tooling` · `wave: P9-W77` · `depends-on: T294`

T294 shipped `android.blockedPermissions` in `apps/android/app.config.ts` and falsified, in
the same commit, a paragraph in that same file asserting the field was absent ("declares no
`permissions` and no `blockedPermissions`"). **Nothing flagged it**, even though the file is
inside the guard's scope on both sides — measured by calling the real predicates:
`isAppSourcePath("apps/android/app.config.ts")` is `true` (T246 widened
`APP_ROOT_CONFIG_PATTERN` for exactly this) and `isShippedSourcePath` is `true`. The P9-R
merge gate corrected the prose by hand; this task closes the reason it had to.

**No `CAPABILITIES` entry exists for anything `app.config.ts` declares.** That is the
"add an entry the moment you ship one" instruction missed again, and it is the second time a
capability shipping in this specific file went unregistered (T246 registered
`computeVersionCodeFromSemver` only after the same omission).

The honest difficulty, which must be argued rather than skipped: `blockedPermissions` is a
**config value, not a declared function**, so it has no `methodNames` token the way every
existing entry does. T215 already hit the mirror of this and rejected a bare string-literal
member because `stripCommentsAndStrings` erases literal values before any check runs — a
`"android.permission.READ_EXTERNAL_STORAGE"` token would make the entry permanently unable to
ship. So either:

1. Use a shape-anchored `RegExp` against the real `blockedPermissions: [` declaration, T211's
   pattern; or
2. Extract the decision into a named exported function in `app.config.ts` and register that,
   which also gives the test something to call; or
3. Record a will-not-register with the measurement, if neither shape can be made to fire.

Whichever is chosen, **watch the entry fire before trusting it**: append a denying sentence in
this entry's own wording — never lifted from `app.config.ts`'s own decision record, which
narrates the pre-fix state at length and carries `CORRECTED at the P9-R merge gate` markers —
to a real tracked in-scope file, confirm exit 1 naming this capability, restore from a
scratchpad copy (**never `git checkout --`**), and confirm exit 0 with
`git status --porcelain` empty.

Owns: `scripts/ci/guard-capability-prose.mjs`, its test, and — only if option 2 is chosen —
the named export in `apps/android/app.config.ts`.

- [ ] The chosen shape is argued against the other two, with the literal-erasure trap addressed
- [ ] The entry is watched firing and restoring, or a will-not-register is recorded with its
      measurement
- [ ] `isAppSourcePath` and `isShippedSourcePath` are each called on the real path
- [ ] The full-tree scan still exits 0
- [ ] Neither forbidden count (`scripts/ci` tests, `CAPABILITIES` entries) is restated in
      `CLAUDE.md`

#### T299 — Revoking a trusted device does not stop its push notifications

`labels: phase-9, area: daemon` · `wave: P9-W78` · `depends-on: T42A2`

T42A2 shipped device revocation and disclosed this gap rather than hiding it. The P9-S merge
gate re-derived it independently against the real server source, and the orchestrator re-derived
it a third time; all three agree, so this is a measured hole, not a suspicion:

- `packages/server/src/server/push/token-store.ts`'s `PushTokenStore` holds
  `private tokens: Set<string>` with `addToken(token)` / `removeToken(token)`. **There is no
  `clientId` anywhere in the file** — a token cannot be attributed to the device that
  registered it.
- `handleRegisterPushToken` passes only the raw token, discarding the connection that carried it.
- `handleTrustedDeviceRevokeRequest` in `websocket-server.ts` calls
  `cleanupConnection(target, "Revoked via trusted_device.revoke")` and **never touches
  `pushTokenStore`**.

So a revoked device loses its socket and keeps receiving every push notification. For the
owner's likely reason to revoke — a lost or stolen phone — that is the wrong half of the job.

The seam: persist `{ clientId, token }` pairs (or a `clientId` → set-of-tokens map), thread the
connection's `clientId` through both the register and unregister handlers, and add
`removeTokensForClient(clientId)` called from `handleTrustedDeviceRevokeRequest` alongside
`cleanupConnection`. Migration matters — tokens already persisted have no `clientId`, so decide
explicitly whether an unattributed token is dropped or grandfathered, and say which.

**Interim client-side mitigation, in scope for this task if the daemon change lands later:** the
revoke confirmation dialog's copy honestly warns about re-registration (see T300) and says
nothing about notifications continuing. One clause there costs nothing and is true today.

Owns: `packages/server/src/server/push/token-store.ts` and its test,
`packages/server/src/server/websocket-server.ts`'s two push handlers and
`handleTrustedDeviceRevokeRequest`, and — only for the mitigation clause —
`apps/android/src/features/devices/DevicesScreen.tsx`.

- [ ] A token is attributable to the `clientId` that registered it, proven by a test
- [ ] Revoking a device removes that device's tokens, proven by an observable consequence (the
      next send does not reach it), not by "a removal was called"
- [ ] Tokens persisted without a `clientId` have a stated, tested disposition
- [ ] Removing the revoke-time call makes a committed test FAIL, demonstrated both ways
- [ ] Any prose asserting revocation stops notifications, or that it does not, matches the code
      in the same commit (T124)

#### T300 — No revoked-`clientId` denylist: a revoked device can silently re-register

`labels: phase-9, area: daemon` · `wave: P9-W79` · `depends-on: T42A2`

The second gap T42A2 disclosed, re-derived the same three times. Grepping
`packages/server/src` for `revokedClientIds`, `isRevoked` and `removeTokensForClient` returns
**zero hits**. `handleHello` accepts a hello from any `clientId` once the shared bearer token
validates, then calls `externalSessionsByKey.set(clientId, connection)`. Trust in this daemon is
one shared password, so a revoked device that still holds it reappears in the trusted list on its
next connect, with nothing recorded anywhere that it was ever revoked.

The revoke dialog's user-visible copy already discloses this honestly ("If it can still
authenticate to this daemon, it can reconnect and appear as a trusted device again — revoking
here doesn't block that"), so the product is not lying to the owner. That disclosure is the
argument for closing it, not for leaving it: revocation that any revoked device can undo by
reconnecting is a control the owner will reasonably over-trust.

The seam: a persisted revoked-`clientId` store written by `handleTrustedDeviceRevokeRequest` and
consulted by `handleHello` before a connection is created or resumed. Two decisions must be
argued rather than assumed:

1. **What a denied hello looks like on the wire.** A silent drop and a named rejection are not
   equivalent — the second tells a legitimately re-provisioned device what happened.
2. **How a denylist entry is ever removed**, so the owner can re-trust a device they revoked by
   mistake. A denylist with no exit is a support burden, and inventing one later is a schema
   change.

Do NOT close this by rotating the shared daemon password: that revokes every device at once,
which is a different feature with a different blast radius.

Owns: the new revoked-`clientId` store and its test,
`packages/server/src/server/websocket-server.ts`'s `handleHello` and
`handleTrustedDeviceRevokeRequest`, and the protocol addition if the rejection is named on the
wire.

- [ ] A revoked `clientId` cannot re-establish a trusted connection, proven by a test that fails
      when the `handleHello` consultation is removed
- [ ] The denylist survives a daemon restart, proven against real storage
- [ ] A revoked device's rejection is either named on the wire or the silence is a recorded
      decision with its reason
- [ ] Un-revoking is possible and tested, or its absence is a recorded decision
- [ ] The dialog copy in `DevicesScreen.tsx` matches whatever this task actually delivers

#### T301 — Give the devices and diagnostics routes a navigable entry point

`labels: phase-9, area: android` · `wave: P9-W80` · `depends-on: T42A1, T42A2`

**Two mounted surfaces now ship with no way in.** The P9-S merge gate traced the navigation
graph rather than taking either task's word for it: every `router.push`, `<Link>` and
`useRouter()` call site under `apps/android/src` resolves to `/connect`, `/share`, or a tool URL,
and the only occurrences of the string `/devices` outside the feature's own directory are inside
`DevicesScreen.tsx`'s own doc comment describing this gap. `app/h/[serverId]/devices.tsx` is a
real registered route (`router-root.test.ts` lists it as a route, not an exception), so the
screen renders if reached — nothing reaches it. `/h/:serverId/diagnostics` is in exactly the
same state, and has been for longer.

T42A1's "same state as `diagnostics.tsx`" justification is accurate, which is precisely why this
is one task and not two: both need the identical seam, and closing one alone leaves the
repository's "exported is not CALLED" defect standing next door. This shape has now shipped
twice here.

The seam T42A1 already sketched: an `onOpenDevices` / `onOpenDiagnostics` callback prop on
`features/settings/SettingsScreen.tsx`, rendering a row only when the prop is supplied, wired
from `useRouter().push(...)` in `app/h/[serverId]/(tabs)/settings.tsx`. Keeping it a prop rather
than importing the router into the feature module is what preserves this app's
platform-boundary rule and keeps the rows testable without a router.

Registration is not receipt: **the acceptance bar is a test that fails when the row is removed**,
not a test that the prop type exists.

Owns: `apps/android/src/features/settings/SettingsScreen.tsx` and its test,
`apps/android/src/app/h/[serverId]/(tabs)/settings.tsx`.

- [ ] A user can reach the devices screen from the shipped UI, proven by a test that fails when
      the entry point is removed
- [ ] The same for diagnostics, proven separately — one row passing must not stand in for the
      other
- [ ] Neither row renders when its callback is absent, so no dead row ships
- [ ] The `<Composer>`-adjacent app-shell contract tests still pass (P9-P's regression shape:
      those pin shared source text whole)
- [ ] `DevicesScreen.tsx`'s doc comment describing the unreachability is corrected in the same
      commit that makes it false (T124)

#### T302 — Move `websocket-server.browser-tools.test.ts` into `test:unit:serial`

`labels: phase-9, area: server` · `wave: P9-W81` · `depends-on: T240`

A sixth `test:unit:serial` member, filed by T240's own rule rather than by "it failed once". The
P9-S merge gate ran `npm run test:unit --workspace=@picompanion/server` three times on
`3688c37`: exit 0, exit 0, then exit 1 with `1 failed | 245 passed`,
`src/server/websocket-server.browser-tools.test.ts`, `Error: Connection timed out`, and **zero
assertion failures** — T240's contention signature exactly.

Four measurements, in T240's required order:

- **Not a wave regression.** `git log 0173304..HEAD --` on the file is empty; it was last
  modified at `ac367b9` on 2026-09-06, so none of P9-S's commits can have caused this.
- **It carries the trait.** The file stands up a real `node:http` `createServer` plus a real
  WebSocket upgrade (reading `AddressInfo` for the port) — the same real-loopback-transport shape
  `CLAUDE.md` already names as the cause for the two hub WebSocket files isolated in serial. It
  currently sits in `test:unit:parallel` and is not in that script's exclude list.
- **The mechanism is specific.** The harness's `connectBrowserHostClient` passes
  `connectTimeoutMs: 500`, and `daemon-client.ts` sets `lastErrorValue = "Connection timed out"`
  when that budget elapses. A 500 ms real-loopback handshake budget while ~245 sibling files
  contend for CPU is the whole failure.
- **The decisive measurement.** Run **alone**, the file passes in **20.54s**, of which 19.28s is
  module import. That is not a margin.

**Do not close this by raising `connectTimeoutMs` or `testTimeout`** — T240 rules that out and
gives the reason: a higher budget hides the contention instead of removing it, and a passing run
would prove nothing about the next one. Moving the file removes the contention itself.

Owns: `packages/server/package.json`'s `test:unit:parallel` / `test:unit:serial` scripts, and
`CLAUDE.md`'s T240 paragraph (which must record this sixth member and its measurement, the way
it records the fifth).

- [ ] The file runs in `test:unit:serial` and no longer in the parallel lane
- [ ] Neither `connectTimeoutMs` nor `testTimeout` is raised
- [ ] `npm run test:unit --workspace=@picompanion/server` run three times on one commit, all
      three exit codes read individually, all 0
- [ ] `CLAUDE.md`'s T240 paragraph records this member with its own measurement
- [ ] `guard-workspace-test-coverage.mjs` still exits 0 (the file must not fall out of both lanes)

#### T303 — Fix the format-check guard's bracketed-path parent-existence false positive

`labels: phase-9, area: tooling` · `wave: P9-W82` · `depends-on: none`

`scripts/ci/guard-format-check-per-commit.mjs`'s `tryLoadBlobAtCommit` asserts in its own doc
comment that "Any `git show` failure is treated as 'path absent at this commit'; **the only
realistic cause here is exactly that**." That premise is false for any path containing `[` or
`]`, which is every Expo Router dynamic segment in both apps. Measured at the P9-S gate: asking
`git show` for a plain path absent at a commit fails with `fatal: path '...' exists on disk, but
not in '<sha>'`, which throws and correctly yields `null` — while asking it for
`<sha>:apps/android/src/app/h/[serverId]/devices.tsx`, equally absent at that commit, **exits 0
and prints a commit dump**, because git falls back to interpreting the bracketed string as a
pathspec.

`existsAtParent.set(relPath, parentBlob !== null)` therefore records **`true`** for a file that
did not exist at the parent — which is the alarming diagnostic noise the guard printed for
`ad4f3b8`'s two `app/h/[serverId]/` files at that gate.

**It is currently inert, and the inertness was measured rather than assumed** — which is why
this is a task and not a wave blocker. `redAtParent` requires `existsAtParent === true` **and**
`redAtParentSet.has(relPath)`. `redAtParentSet` is built by
`relativizeOxfmtListDifferentOutput`, which only strips the scratch root from lines that _start_
with it; oxfmt cannot parse a commit dump, so it errors (`Invalid characters after number`, exit 2) with diagnostic lines beginning `x` / `,-[` / `1 |`, never the root. The real path never
enters the set, `redAtParent` lands on `false` anyway, and `classifyFormatRedCommits`' excusal
branch (`redAtParent && !pathWasWorsened`) is never taken. A newly-added _red_ dynamic-route file
is still correctly flagged today.

So: a genuine latent defect held harmless by two independent accidents, either of which a future
change to oxfmt's error output or to the relativizer could remove — and the failure mode then is
a **false OK**, the worst kind for a guard.

The fix is to stop asking `git show` a question it answers ambiguously: use
`git cat-file -e "<sha>:<path>"` for the existence check, or pass the path after `--`. Correct
the doc comment's premise in the same commit; a comment asserting the only realistic cause is
the shape that let this sit unnoticed.

Owns: `scripts/ci/guard-format-check-per-commit.mjs` and its test.

- [ ] A bracketed path absent at a commit is reported absent, proven by a test using a real
      `app/**/[param]/*` path
- [ ] The test FAILS against the pre-fix implementation, demonstrated both ways
- [ ] The doc comment's "the only realistic cause here is exactly that" premise is corrected
- [ ] `node scripts/ci/run-guard-format-check-per-commit.mjs <base>..HEAD` still exits 0 and no
      longer prints the commit-dump noise
- [ ] The guard is exercised with a range argument, never with none (it defaults to the entire
      repository history)

#### T304 — Retire the duplicate exhaustiveness check that only the ceiling guard sees

`labels: phase-9, area: server` · `wave: P9-W83` · `depends-on: T296`

T296 moved its optional-method exhaustiveness check into production source
(`provider-registry.ts`'s `SESSION_OPTIONAL_METHOD_KEYS`), where `npm run typecheck` has no
ceiling to hide behind — the right fix, and proven at the P9-S gate in both directions (a
fifteenth optional method added to `AgentSession` fails `TS2741`; making `setModel` required
fails `TS2353`). The gate also confirmed the _test-file_ duplicate
(`_allOptionalAgentSessionMethodsAreCovered` in `provider-registry-wrap.test.ts`) survives as a
`TS6133` "declared but never read", and is now one of the tolerated errors under
`TYPECHECK_ERROR_CEILING`.

Nothing is broken by it — T296 never claimed to fix that error, and the production check is the
real protection. Two facts make it worth one small task anyway:

- The surviving duplicate is only ever _seen_ by `guard-server-test-typecheck-ceiling.mjs`, which
  is exactly the mechanism that let the original drift hide for six methods.
- **The ceiling now has zero headroom** — measured at the gate and again by the orchestrator: the
  guard reports the real count equal to the ceiling. That is the safe side (a regression fails
  immediately), but it means the next wave that adds any test-file type error goes red with no
  slack, so retiring a tolerated error that no longer earns its keep has real operational value.

Either delete the test-file duplicate (the production check subsumes it) or `void`-reference it
so it is read. If it is kept, argue why a second copy in a file the production typecheck excludes
is worth a tolerated error. Lower the ceiling by however many errors actually go away, measured,
not predicted — and re-run the guard, since a ceiling set below the true count fails immediately.

Owns: `packages/server/src/server/agent/provider-registry-wrap.test.ts` and
`scripts/ci/guard-server-test-typecheck-ceiling.mjs`'s `TYPECHECK_ERROR_CEILING`.

- [ ] The `TS6133` is gone, or its retention is argued in the file
- [ ] `TYPECHECK_ERROR_CEILING` is lowered by the measured delta and the guard exits 0
- [ ] `npm run typecheck --workspace=@picompanion/server` still exits 0
- [ ] The production exhaustiveness check is re-proven able to FAIL after the change, in both
      directions
- [ ] The file's own header comment still describes what the file actually does

#### T305 — Give `.pc-message__text` the same `white-space: pre-wrap` the thinking body has

`labels: phase-9, area: web` · `depends-on: T28A3`

Found at the P9-T merge gate while checking whether the Pi output-style work had any
web-side consequence. `apps/web/src/ui/recipes/recipes.css` declares
`white-space: pre-wrap` on `.pc-thinking__body p` but not on `.pc-message__text`, so a
newline the model emits survives in a thinking body and collapses to a single space in an
assistant message. The same text renders with its newlines intact on Android, because React
Native `<Text>` preserves them by default and needs no equivalent declaration — so this is
both an inconsistency inside one stylesheet and a web/Android divergence for identical
model output.

Not fixed at the gate: the gate's own rule is that it repairs what the wave under
adjudication touched, and no P9-T commit touched `recipes.css`. Filed instead of edited
mid-wave.

Do not "fix" this by reformatting the model's text anywhere in the pipeline. The text is
already correct by the time it reaches the DOM; only the CSS drops the newlines.

- [ ] `.pc-message__text` preserves newlines in rendered assistant text
- [ ] A test pins it — assert the computed/declared `white-space`, or assert rendered
      output for a two-line message, rather than only eyeballing it
- [ ] Show the same two-line message rendering identically on web and Android, or state
      plainly which check you could not run
- [ ] Confirm the shimmer-gradient treatment on `.pc-message__text:has(.pc-message__cursor)`
      still looks right with the new wrapping, since `background-clip: text` interacts with
      line boxes

#### T306 — Re-pin `expo-secure-store` to the version this app's own `expo` bundles

`labels: phase-9, area: android` · `depends-on: T291`

Found while fixing T291, which was the same defect one package over: `apps/android`
declared an `expo-audio` range no version of its own `expo` had ever bundled. The check
that found it — `npx expo install --check`, run FROM `apps/android` so it reads that app's
own nested `expo`, not the root's — names a second package the same way, and T291's scope
was one package.

Measured directly rather than inferred, all four figures from the real installed tree:

| Fact                                                       | Value                           |
| ---------------------------------------------------------- | ------------------------------- |
| `apps/android/package.json` declares                       | `expo-secure-store: ~57.0.2`    |
| Resolved, at the repository ROOT                           | `expo-secure-store@57.0.3`      |
| `apps/android`'s own `expo`                                | `54.0.37` (declared `^54.0.18`) |
| That `expo`'s `bundledNativeModules.json` for this package | `~15.0.8`                       |

`expo-secure-store@57` is the SDK-57-line build (Expo's unified versioning gives a package
the SDK's own major from SDK 57 on), so this is not a patch-level drift inside one SDK — it
is an SDK-57 native module installed into a tree whose `expo` is SDK 54. It is also not
symmetrical with T291: `expo-audio`'s wrong pin was a version that never existed for this
SDK, while this one is a version that exists and belongs to a different SDK entirely.

Why this is worth a task rather than a one-line bump. The mismatch is a NATIVE module, so
nothing local exercises it: every `apps/android` test that touches it does so through
`vi.mock("expo-secure-store", ...)` (see `src/app/resume-wiring.test.ts` and
`src/app-shell/core.test.ts`), which is correct for those tests and means a local green
suite says nothing about whether the real module builds or runs. The first thing that can
disagree is a real EAS build or an on-device launch.

Read T307 before choosing the fix. The two share a cause, and bumping this pin down without
answering T307's question may simply move the inconsistency rather than remove it.

- [ ] `npx expo install --check`, run from `apps/android`, reports nothing for
      `expo-secure-store`
- [ ] The chosen version is justified against `apps/android`'s own `expo`'s
      `bundledNativeModules.json`, quoted, not against the root's
- [ ] `package-lock.json` is regenerated and the resolved version recorded — say whether it
      resolves at the root or nested under `apps/android`, since today it is the root
- [ ] `npm audit`'s advisory set is unchanged, or the delta is explained (T291's own bump
      moved the baseline and this one can too)
- [ ] A real EAS build, or an explicit statement that no build was run and the native half
      is therefore unverified — do not report a green local suite as evidence here

#### T307 — Explain, or remove, the hoisted root `expo@57` no workspace asks for

`labels: phase-9, area: android` · `depends-on: T291, T306`

The repository root carries `expo@57.0.18` in `node_modules`, and no workspace declares a
range that admits it. Measured, not assumed — every `expo` declaration in the tree, from
`git`-tracked manifests:

| Manifest                                                        | Field              | Range      |
| --------------------------------------------------------------- | ------------------ | ---------- |
| `apps/android/package.json`                                     | `dependencies`     | `^54.0.18` |
| `packages/expo-two-way-audio/package.json`                      | `peerDependencies` | `*`        |
| `packages/expo-two-way-audio/examples/basic-usage/package.json` | `dependencies`     | `^52.0.0`  |
| `packages/expo-two-way-audio/examples/flow-api/package.json`    | `dependencies`     | `^52.0.25` |

The root `workspaces` globs are `packages/*` and `apps/*`, so the two `examples/*`
manifests are not workspaces and their `^52` ranges are never installed — they are
reference material inside a ported package. That leaves exactly one real dependency range,
`apps/android`'s `^54.0.18`, which resolves to a NESTED `apps/android/node_modules/expo@54.0.37`,
and one unbounded `peerDependencies: *`.

The `*` is the likely mechanism and the thing to confirm first: an unbounded peer range
lets npm satisfy the root with whatever is newest, and the SDK-57-line packages already
hoisted there (`expo-secure-store@57.0.3` — T306) peer-depend on `expo` the same unbounded
way. So the root `expo` may be a consequence of T306's wrong pin rather than an
independent problem, in which case fixing T306 could remove this by itself. Verify that
before doing anything else here; it changes the whole shape of the fix.

Two ways this bites, both invisible locally today:

- Any tool that resolves `expo` from the repository root — as opposed to from
  `apps/android` — reads SDK 57's `bundledNativeModules.json`. That is exactly the trap
  T291 and T306 were found through: the same `npx expo install --check` gives different
  answers depending on the directory it runs in, and the root's answer is the wrong one for
  this app.
- The EAS archive carries the whole monorepo, so the remote build resolves against the same
  two-SDK tree the local one does. Nothing here is Windows-specific or local-only.

`packages/expo-two-way-audio`'s `peerDependencies: *` may well be correct for a ported,
SDK-agnostic native module — do not tighten it reflexively. If it stays, this task's
deliverable is a written explanation of why the root `expo` is harmless plus something that
would notice if it stopped being harmless, which is a legitimate outcome. What is not
acceptable is leaving the tree with two SDK majors and no record of which is intended.

- [ ] State which manifest actually causes the root `expo@57`, proven by re-resolving (a
      lockfile read plus a clean install), not by reasoning from the ranges alone
- [ ] Either the root `expo` is gone, or a committed note says why it is there and why it is
      safe — in a citable home, not only in a commit message
- [ ] Say plainly whether fixing T306 removed this on its own; if it did, this task is
      closed by that, and record it rather than inventing separate work
- [ ] `apps/android` still resolves its own `expo` at `54.x` after the change, checked
      through `apps/android/node_modules`, not the root
- [ ] If `peerDependencies: *` is narrowed, justify it against what
      `packages/expo-two-way-audio` actually supports — it is ported AGPL code with its own
      compatibility surface, not ours to guess at

#### T308 — Show the local wall-clock time on every transcript message

`labels: phase-9, area: core` · `depends-on: T28A1, T28A2, T33A2`

`TranscriptEntry.timestamp` has carried the daemon's own timestamp verbatim on every entry
since T28A1 (`packages/frontend-core/src/timeline/transcript-view.ts`), and neither app
displayed it. A reader could not tell a five-second gap from an overnight one anywhere in
the transcript, on either platform, despite the data being present at the row renderer the
whole time.

Scope, and the boundary that matters: `user-message` and `assistant-message` rows only.
`reasoning`, `tool_call`, `todo`, `error` and `compaction` rows are deliberately NOT dated
— they are process detail rather than something either party said, and the thinking row
already shows an elapsed-duration readout of its own (`useElapsedLabel` in
`apps/web/src/features/transcript/thinking-row.tsx`), which is a different question from
"when did this happen". Every assistant message is dated, not only a turn's last one, so an
intermediate message emitted between tool calls carries its own time.

One shared formatter, in `frontend-core`, is the load-bearing decision:
`formatMessageTimestamp` (`packages/frontend-core/src/timeline/message-timestamp.ts`). Both
apps' row renderers do nothing but display what it returns, because two independently
written date formatters is how web and Android end up disagreeing about what time it is.
`apps/android`'s `message-row-model.ts` re-exports it as `timestampLabelFor` to keep that
file the single RN-free home for what its view maps, matching `speakerFor`/`boundedText`.

Three properties the formatter is built around, each of them a decision rather than a
detail:

- **Local time by default, injectable for tests.** A reader wants their own wall clock, so
  `timeZone`/`locale` default to the host's. That makes a naive test machine-dependent,
  which is why both are accepted as overrides rather than pinned to UTC the way
  `apps/web/src/features/files/format.ts`'s `formatModifiedAt` pins them. Pinning would
  have been cheaper and wrong: a message sent at 17:42 IST would read "12:12" to the person
  who sent it.
- **Never throws, never renders garbage.** An absent or unparseable timestamp returns
  `null` and the row omits the element, rather than showing `Invalid Date` — the same
  "degrade, do not fabricate" stance `transcript-view.ts` takes with its `"unknown"` entry
  kind. An unsupported `timeZone` or malformed `locale` makes `Intl` throw `RangeError`, so
  both are caught and retried without the offending option.
- **The label widens only as far as ambiguity requires**: time alone for today, plus day
  and month for an earlier day, plus the year for an earlier year. The `title`/
  `accessibilityLabel` is always complete, including the zone name, so the short form never
  loses information a reader needs.

Two things a future reader should not re-derive. Same-day comparison happens in the DISPLAY
zone, not UTC — a message sent at 23:30 IST is "yesterday" to an IST reader and "today" to
a UTC one, and only the display zone's answer matches the label being rendered. And both
row comparators (`areRowPropsEqual`, `areMessageRowPropsEqual`) had to start reading
`timestamp`: a memo comparator that ignores a field its component displays is the classic
stale-render bug, and here it would show as a reconciled optimistic row keeping the local
submission time it was created with.

`apps/android/src/features/transcript/message-row.tsx` also collapsed to a single `return`.
It previously returned a bare `StreamingMessage` early when the entry had no images, then a
second tree with them; both now need the timestamp, and two trees is how they drift. Its
test pins the single return path directly.

- [x] Every `assistant_message` — intermediate and final — shows its local time on web
- [x] Every `assistant_message` shows its local time on Android
- [x] User messages show theirs too, on both
- [x] Reasoning, tool-call, todo, error and compaction rows show none; pinned by a test that
      reads the other row files rather than trusting them to stay that way
- [x] One formatter, in `frontend-core`, used by both apps — no second date implementation
      in either app, pinned by a test that forbids `Intl`/`toLocale*` in the Android view
- [x] Formatting proven against a fixed zone and locale, including a half-hour offset, so
      the assertions do not depend on the machine running them
- [x] An unparseable timestamp renders nothing rather than `Invalid Date`
- [x] Both memo comparators read `timestamp`
- [x] The CSS class the web element carries is proven to exist and to use only tokens — a
      `<time>` whose class has no rule is invisible to every DOM assertion
- [ ] Confirm on a real device and a real browser that the two look consistent, or state
      plainly which check was not run

#### T309 — The observation test's self-heal tick is both required and harmful, depending on when it lands

`labels: phase-9, area: server` · `depends-on: T240`

`server-tests (windows-latest)` failed at `285124d` on
`src/server/workspace-git-service.observation.integration.test.ts` with
`AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1
times` at that file's first `expect(runGitCommand).not.toHaveBeenCalled()`. The commit
under test touched no `packages/server` file, and `packages/server` does not depend on
`@picompanion/frontend-core` at all — there is no path by which that commit could reach
this suite. This is pre-existing, and it is the second distinct defect found in this one
file (the first, a timeout, was closed by moving the file into `test:unit:serial`; that
change is unrelated to this one and did not address it).

**The mechanism, reproduced rather than reasoned about.** The test injects
`getWorkspaceGitSelfHealPhaseMs: () => 7_000`. That schedules
`startWorkspaceSubscriptionTimers`' `runSelfHealTick`, which calls
`refreshWorkingTreeIgnoredDirectories` — one `git ls-files` through the injected
`runGitCommand` — and then `refreshWorkspaceTarget`. The test has two phases that write 100
files into an ignored directory, wait a hard 750ms, and assert that nothing refreshed. A
tick landing inside one of those windows produces exactly the observed failure.

Where the windows sit is decided by native-watcher latency, which the test does not control.
Measured on this machine by instrumenting the file: the first window opens at **+1121ms**
and the second at **+9141ms**, so a 7s tick falls between them and every local run passes —
three consecutive runs of the file, and three of the whole `test:unit` lane, all green. On
the CI Windows runner the earlier `vi.waitFor` phases are slow enough to shift the first
window onto the tick.

Proven by construction: setting the phase to `1_300` — inside the measured first window —
reproduces the CI failure locally and exactly, same assertion, same `232:29`, same "called 1
times".

**Why the obvious fix is wrong, which is the part worth not re-deriving.** Raising the phase
so the tick cannot fire during the test (`10 * 60_000`) makes the storm assertions pass and
then fails the file at `expect(editedDuringWatcherHandoff).toBe(true)` inside the later
`vi.waitFor`. That phase flips `buildIgnored = false` and waits for the working-tree watcher
to be torn down and restarted — a handoff driven by the ignore-list refresh that only
`runSelfHealTick` performs. So the tick is **load-bearing for one phase and fatal to
another**, and the file's correctness currently depends on it landing in the gap between
them. Measured, not assumed: this was attempted, and the failure moved rather than
disappeared.

Raising `testTimeout` is also not the answer and should not be proposed: this is not the
contention shape `CLAUDE.md`'s T240 section describes (the file is already in
`test:unit:serial`, so it runs alone), and a longer budget does not move a 7-second timer
relative to a 750ms window.

**RESOLVED. Direction 1 was taken, and direction 2 was ruled out by measurement rather than
by preference.** Direction 2 ("drive the ignore-list refresh deterministically") is not
reachable from a test at all: after initial setup, `replaceWorkingTreeIgnoredDirectories`
has exactly two callers — `promoteWorkingTreeWatchTarget`, which runs once when `repoRoot`
is first learned, and `runSelfHealTick`. `scheduleWorkspaceObservationSetup` returns early
forever once `observationSetupComplete` is true, and only the degraded fallback poll ever
clears that flag. Making the refresh triggerable on demand would be a production change to
`workspace-git-service.ts`, which this task does not justify.

**One correction to this entry's own earlier acceptance criteria, which were wrong.** They
asked for the file to pass "with the self-heal phase set anywhere in `[1_000, 10 * 60_000]`"
and for `1_300` specifically to stop reproducing the failure. Neither is achievable, and
believing them would have led to a worse fix. `1_300` fires the single tick before
`buildIgnored = false`, and a tick that runs while `build/` is still ignored finds the set
unchanged (`haveSamePaths`) and returns without reconfiguring the watcher — so the handoff
can never happen afterwards, no matter what the storm assertions do. The tick is not merely
"allowed to be late"; it MUST be late. The real property to establish is narrower and is
what the fix now delivers: **the file is insensitive to where the storm windows fall, and
fails legibly rather than mysteriously if the phase is ever mis-calibrated again.**

What landed, in three parts:

1. **The two storm windows assert their intent instead of an absolute.**
   `expect(runGitCommand).not.toHaveBeenCalled()` became
   `expect(gitCommandsOtherThanIgnoreReload()).toEqual([])` plus
   `expect(selfHealIgnoreReloads()).toBeLessThanOrEqual(1)`. The five `getCheckout*`
   assertions in those blocks stay ABSOLUTE and untouched — they are what actually detects
   an unpruned storm, because a storm response reaches them through `refreshWorkspaceTarget`
   and `notifyWorkingTreeConsumers`. Nothing on the storm path can reach `loadIgnoredDirs`,
   so tolerating one ignore reload gives up no coverage, while the `<= 1` bound still fails
   if a storm ever starts reloading the ignore list per event.
2. **The injected phase moved `7_000` → `12_000`**, because the tick has to land after the
   flip and 7s did not on the CI runner that failed: `buildIgnored` flips at about +1.9s on
   the development machine and about +7.7s there, so the 7s tick was already spent. 12s is
   that worst observed flip time plus about 4s of margin. This is calibration, not
   derivation, and the entry says so where the value lives.
3. **Two guards make a future mis-calibration diagnosable rather than flaky.** A cumulative
   `totalIgnoreReloads` counter (immune to the `mockClear` every phase performs) is sampled
   at the flip, the handoff's own assertion carries a message naming the cause and the
   remedy, and a post-condition asserts a reload happened _after_ the flip so that phase can
   never pass vacuously. Counting is relative to the flip, not from zero, because setup
   itself performs one reload — a detail the first attempt at these guards got wrong and the
   guard itself caught.

Costs, stated rather than buried: the file's runtime rises from about 10.0s to about 15.3s,
because the handoff now waits for a 12s tick instead of a 7s one. Its per-test budget was
raised `15_000` → `30_000` and the handoff `vi.waitFor` `8_000` → `15_000` to accommodate
that. This is the one place a budget was raised, and it is not the T240 "hide the
contention" move that section warns against: the file already runs alone in
`test:unit:serial`, and the budget is being fitted to a deliberately later tick, not used to
outlast a race.

- [x] The chosen direction is stated with its trade-off, and the rejected one is ruled out
      by reading the callers rather than by preference
- [x] The file is insensitive to where the storm windows fall — the property that actually
      broke CI. (REPLACES this entry's own earlier, impossible criterion about any phase in
      `[1_000, 10 * 60_000]`; see the correction above.)
- [x] A mis-calibrated phase fails in one line naming the cause and the fix, demonstrated by
      running at `1_300` and reading the message
- [x] The test still fails if pruning regresses — proven by mutation, not assumed: forcing
      `build/` to be un-ignored during the first storm fails at `getCheckoutDiff`, one of the
      five assertions deliberately left absolute
- [x] Three consecutive local runs of the file, all three exit codes read
- [x] Three consecutive local runs of `npm run test:unit --workspace=@picompanion/server`,
      all three exit codes read (T240)
- [ ] `server-tests (windows-latest)` green on a real CI run, with the run id recorded

**A second, separate observation from the same investigation, filed here so it is not lost
rather than because it is the same defect.** The first CI attempt at `285124d` (run
`34352088001`) failed differently: `src/utils/checkout-git.test.ts` >
"refreshes the tracked ref after pushing through a configured push remote", `Error: Test
timed out in 30000ms`, at **32476ms**. That test runs in **1478ms** locally, alone — 20×
headroom against its budget — and the file is already in `test:unit:serial`. It passed on
the very next run of the identical commit. That is a runner stall rather than a code defect
on the evidence available, and it is deliberately NOT being fixed by raising `testTimeout`
here; if it recurs, file it separately with the recurrence recorded, and do not fold it into
this task.

#### T310 — Both EAS workflows invoked `npx eas`, a package that cannot run

`labels: phase-9, area: tooling` · `depends-on: T208, T17B, T37F`

The first real dispatch of `android-maestro-e2e.yml` (run `34368430903`, at `2d7c60f`) failed
in all six jobs — five shards and `packaged-app-smoke` — with:

```
npm error could not determine executable to run
```

Every job reached it the same way: `Setup Expo and EAS` succeeded and installed
`eas-cli@23.2.0`, and the next step ran `npx eas build …` and died in 1.7 seconds.

**Cause, confirmed against the registry rather than guessed.** `eas` is a real published npm
package — version `0.1.0` — and it declares **no `bin`**. So `npx eas` resolves that package,
finds nothing to execute, and emits exactly the error above. The binary named `eas` is
shipped by a differently-named package: `eas-cli`, whose manifest declares
`bin = { eas: 'bin/run' }`. `npx <name>` takes a PACKAGE name, so `npx eas` was wrong from the
day it was written and could never have worked on any runner.

Both workflows carried it, six call sites in total:
`android-apk-release.yml` (`build`, `build:view`) and `android-maestro-e2e.yml` (`build` and
`build:view` for each of the `development` and `production-apk` profiles). All six now say
`npx eas-cli`, and all three sites that start a build carry a comment saying why, so the next
reader does not "simplify" the package name back to the binary name.

**Why nothing caught this earlier, which is the part worth keeping.** Neither workflow had
ever executed these steps: both gate on `EXPO_TOKEN`, which only existed from T208, and until
then every run took the "Dry run (EXPO_TOKEN not configured)" branch and reported success.
The steps were therefore untested infrastructure that looked green for months — the same shape
as the P9-T gate's finding about a CI fixture that had never run. Local work did not catch it
either: on a developer machine `eas` is on `PATH` from a global `eas-cli` install, so anyone
typing `eas build` by hand sees it work, and `npx eas` is the only spelling that fails.

**No EAS build minutes were consumed by the failed run.** Every job died before
`eas build` started, so this cost nothing beyond runner time — worth stating because the
obvious worry on seeing six failed EAS jobs is a spent build quota.

- [x] All six call sites use the package name `eas-cli`
- [x] Both workflow files still parse under a real YAML loader
- [x] The three build-starting steps carry a comment naming the cause, so the fix is not
      undone by someone shortening it back to `eas`
- [ ] A real `android-maestro-e2e.yml` dispatch gets past `Build development APK on EAS`, with
      the run id recorded — this entry is not closed by the fix alone, because the next
      failure after this one is the first honest test of everything downstream (the EAS
      development build itself, then `reactivecircus/android-emulator-runner`'s KVM support,
      which that workflow's own header has always disclosed as unverified)
- [ ] A guard so this cannot regress: fail the build when a workflow invokes `npx` with a
      package name that publishes no `bin`, or at minimum when it invokes `npx eas`.
      Deliberately NOT written as part of the fix — a new guard needs its own
      `run-guard-*.mjs`, wiring into `ci.yml`, and an entry that satisfies
      `guard-run-guard-wiring.mjs`, which is more than a one-line CLI correction should drag
      in. Note when writing it that the general form is the valuable one: `npx <binary-name>`
      is a mistake class, not a single typo, and this repository invokes npx in several
      workflows.
