# Project Memory: pi-companion

<!-- NOTE: this file is COMMITTED on purpose. It previously lived untracked and was
     destroyed by a `git clean` run by an integration agent during the Phase 0 merge.
     Keep it tracked so agent cleanup cannot delete it. -->

## Overview

Pi Companion: greenfield rebuild of a Pi-Agent-only companion (laptop daemon + web app +
Android app). NOT a fork: `D:\paseo` (Paseo v0.3.0-beta.2, AGPL-3.0-or-later) is a
read-only behavioral/code reference; backend packages were copied under `@picompanion/*`
with attribution. Authoritative plan: `plan.md` (20 sections, phases 0-9). Task breakdown:
`docs/issues-from-plan.md` (**218 tasks**, 1-3h each, per-phase waves, coverage tables).

## Architecture

- Ported backend: `packages/{protocol,client,server,relay,highlight,cli,pi-bridge,expo-two-way-audio}`.
- New frontend: `packages/frontend-core` (framework-neutral, NO React/DOM/RN/Expo imports),
  `packages/design-tokens`, `apps/web` (React 19 + Vite, DOM-first, no SSR),
  `apps/android` (Expo 54 / RN 0.81, Android-only, no `.web.*`).
- Hard gate: Pi UI payload schema fix (piUiPayloadV2) before any bridge renderer. DONE in Phase 0.
- Nothing from Paseo's `packages/app` ever enters this repo.

## Key Files

- `plan.md` — the plan (greenfield rewrite 2026-08-31).
- `docs/issues-from-plan.md` — 200 workflow-ready tasks with deps/waves/coverage.
- `THIRD_PARTY_NOTICES.md` — Paseo AGPL provenance per ported package + Beautiful UI MIT notice.
- `docs/beautiful-ui-reference.md` — the product's visual language, extracted from the real
  Beautiful UI site's CSS (tokens both themes, radii, ring shadows, type, motion, traits).
- `docs/pi-extension-compatibility.md`, `docs/frontend-data-migration.md` — Phase 0 decision docs.
- `.dev/` — preserved dev daemon home (`PASEO_HOME` for 127.0.0.1:6768). Gitignored.
- `D:\pi-companion-fork-backup.bundle` — full backup of the abandoned fork (101 MB, verified).

## Decisions

- 2026-08-31: greenfield, not fork. Fresh `git init`, no Paseo remote ever.
- 2026-08-31: phase-by-phase execution, 3 rounds per phase (parallel impl in isolated
  worktrees → independent testing → single integration merge).
- 2026-09-01 (final model policy): **Sonnet 5 for ALL implementation, verification, testing,
  and exit checks; Opus 5 ONLY for the merge agent.** Muse Spark/DeepSeek (OpenCode Go) hit
  their monthly cap and are unavailable until ~2026-09-03.
- 2026-09-02 #preference **CONCURRENCY IS 3 FOR EVERY WORKFLOW RUN — all phases, all waves, all
  tasks, no exceptions.** Set by the user. The only grandfathered run is Phase 4 batch E
  (`phase4e-assembly-and-e2e-mtk9hva7-9sjr45`), which was already in flight at 4 and was left
  alone at the user's explicit instruction. Every run launched after it uses `concurrency: 3`.
  This supersedes the earlier "raised 3 -> 5 because 4A merged clean" note.
- Task sizing: 1-3 hours per task. Oversized tasks caused hour-long agents and huge token
  burn; that is the failure mode the 72-task split exists to prevent.
- Root `package.json` uses workspace globs; branch convention `phase<N>/t<id>` (fixes `-fix`).
- 2026-09-01 **Beautiful UI source corrected.** "Beautiful" means
  <https://www.beautifului.dev/> (by Turbo), **MIT, Copyright (c) 2026 Shane Levine** —
  compatible with our AGPL, so code MAY be adapted if the MIT notice is retained. plan §10
  and `THIRD_PARTY_NOTICES.md` §2 previously misidentified it as the abandoned fork's
  `D:\paseo\packages\app\src\ui\beautiful\` tree and banned copying; both are now fixed.
  The §10.4 component *selection* was always right (it maps 1:1 onto the site's numbered
  components); only the visual language was missing. Added component 14 SidebarNav to §10.4.
- 2026-09-01 **Standing consistency rule**: Beautiful UI defines the look of the ENTIRE
  product, including components with no counterpart there (session rail, Pi extension rail,
  context meter, settings, terminal chrome). User asked for a **near-exact** match.
- Key correction to watch: our old dark background `#05070a` is far too black/blue; Beautiful
  UI's is a warm charcoal `#17181a` with surfaces stepping UP to `#232427`. Shadows are 1px
  RINGS not blurs. Dashed hairline dividers are the signature trait.

## Current State

- **PHASE 0 COMPLETE 2026-09-01** (run `phase0-v5-sonnet-mthpll0b-h4rmug`; 28 agents,
  $21.38, ~3.4h). All 17 tasks implemented, all 17 passed INDEPENDENT verification, all 16
  branches merged into main with zero textual conflicts, exit verifier `overall: true` on
  all 11 criteria. main has: 8 ported backend packages building green, fixtures for all 21
  Pi RPC event types, bridge fixtures for all 10 kinds, piUiPayloadV2 schemas + capability
  gate + daemon normalization + 4 compatibility fixtures, bridge state/identity/revision
  rules with reconnect tests, incremental live-tail + 100k benchmark, provenance and
  extension inventories, no remotes.
- Post-phase cleanup: `.gitattributes` (LF) recovered from an orphaned `main-fix` branch,
  whole tree oxfmt-formatted (`format:check` clean), 54 Phase-0 acceptance boxes ticked,
  stale branches/worktrees removed.
- **PHASE 1 COMPLETE 2026-09-01** (run `phase1-workspace-skeleton-mthwvz41-4dl1l6`; 28 agents,
  $25.62, ~3.8h). All 9 tasks done; 4 needed a fix round (T12A, T16, T17A, T18); T12A and T17A
  still failed retest and were repaired by the Opus merge agent. 1 real conflict
  (package-lock.json) resolved by regenerating so BOTH apps' dependency trees survived.
  Exit `overall: true` on all 6 criteria. Notable catch by the independent verifier: T12A's
  `.npmrc` `include-workspace-root=true` broke every workspace script ("Missing script: build"
  for the root package). main now has apps/{web,android} + packages/{design-tokens,frontend-core}.
- **PHASE 2 COMPLETE 2026-09-01** (run `phase2-frontend-core-mti5342d-5em6pz`; 24 agents, $34.82,
  ~1.9h). All 10 tasks done, all 10 passed independent verification (T24 needed a fix round).
  Merge resolved 11 conflicts (frontend-core package.json x4, package-lock x3, index.test.ts x4 —
  unioned rather than side-picked), testsGreen true. Exit `overall: true`: the recorded-session
  contract test drives hello → reconnect → gap recovery → extension action → final correction in
  plain Node with ZERO React; 307 frontend-core tests pass; oxlint purity guard green.
  main @ ef575cd, single branch, no stale worktrees.
- **PHASE 3 COMPLETE 2026-09-01** (run `phase3-design-system-mti9jpcn-a5tiyq`; 12 agents,
  $17.31, ~2.7h). All 4 tasks done and merged (T25B needed a fix round for a missing
  `:focus-visible` outline). 1 conflict in `packages/frontend-core/src/testing/index.ts`
  (T26A branched before T25B's recipe-lab exports existed) resolved by keeping the superset.
  Exit `overall: true`. main @ `8dec46e`, format:check clean, oxlint 0/0, no zombies.
  26 primitives + 11 recipes exist on BOTH platforms driven by shared frontend-core fixtures.
- P3 exit had **one unmet criterion**: raw hex remains in `apps/web/src/styles/global.css`
  (3 status colours) and `apps/web/src/features/connection/connection-status.tsx`. T25C
  clears it. Noted caveat: web a11y tests run in jsdom, not the real-browser tooling that
  plan §14.1 specifies.
- **PHASE 3.5 COMPLETE 2026-09-01** (run `phase35-beautiful-ui-conformance-mtifgsxi-mxwl0t`;
  8 agents, $14.86, ~1.4h). T13B retoken → {T25C web, T26C android}. All 3 tasks passed
  independent verification FIRST TIME (no fix round), merged with **zero conflicts**, exit
  `overall: true` on all 11 criteria. main @ `dccff57`. The design system now carries
  Beautiful UI's real values; zero raw hex remains under apps/web/src or apps/android/src
  (the unmet Phase 3 criterion is closed).
- Exit verifier found **2 genuine gaps**, both now covered by T13C:
  (1) Inter and Geist Mono are NAMED but not bundled/self-hosted, so they silently fall back
  to a system face — a real near-exact-match failure; (2) light-theme roles that the
  reference doc had only described qualitatively were implemented as approximations. Gap 2
  was MY error: the values were in the source CSS but I summarised the light theme lossily.
  `docs/beautiful-ui-reference.md` now publishes every role for BOTH themes.
- **T13C COMPLETE 2026-09-01** (run `t13c-fonts-and-light-theme-mtij8mhy-lsrhfh`; 3 agents,
  $6.75, ~42m). Passed verification first time, merged with zero conflicts @ `2a19af5`.
  Inter + Geist Mono are now self-hosted (woff2 subsets under `apps/web/src/assets/fonts/`
  with `@font-face`/`font-display: swap`; TTFs under `apps/android/assets/fonts/` loaded via
  `expo-font` `useFonts`, first paint gated on load). No CDN reference anywhere. OFL text
  vendored + 4 rows in `THIRD_PARTY_NOTICES.md` §3. All light-theme roles now match the
  reference exactly. `native.ts` gained `nativeFontFamilyNames` so the family name Android
  REGISTERS is the same literal the theme REQUESTS (they could previously drift).
- **PHASE 3.5 FULLY DONE.** Test baseline is now **460**: design-tokens 39, frontend-core 307,
  apps/web 55, apps/android 59. main @ `67dec54`.
- #lesson **Verify tests under more than one invocation.** T13C's own font test used
  `process.cwd()`, so it passed under `npm test` (cwd = apps/web) but failed with ENOENT under
  `vitest run --root apps/web` from the repo root; the merge agent only ever used the former.
  Also the component-lab/recipe-lab render cases sat on vitest's 5s default while taking
  ~3-4s, passing alone and timing out in a full-suite run. Both fixed in `67dec54`.
- #lesson Under **jsdom the global `URL` class is jsdom's own**, so
  `fileURLToPath(new URL(x, import.meta.url))` throws `ERR_INVALID_URL_SCHEME`. But
  `import.meta.url` IS a real `file:` URL string — pass it straight to `fileURLToPath`. This
  is why a test author reached for `process.cwd()` in the first place.
- **T29C added to Phase 4** (`6e0991b`): the web context-window and cache meter. The daemon
  already emits `inputTokens`/`cachedInputTokens`/`contextWindowUsedTokens` etc. and they
  reach the browser, but nothing rendered them. T31 moved to P4-W4 and depends on T29C so
  the E2E suite covers it. **77 tasks** now (P4 = 10).
- **PHASE 4 CRASHED 2026-09-01** (run `phase4-web-vertical-slice-mtilafuz-dfr92r`): the pi
  session died ~46 min in, taking the run with it. The run file recorded `agents: 0` and no
  token usage, so `resumeFromRunId` was useless — nothing to replay from cache.
- #lesson **A crashed run leaves real work behind; salvage before cleaning.** Recovered ~4400
  lines across 3 branches. Critically, **worktree isolation had again fallen back to the main
  working directory**, and TWO agents (T28A and T30A) had written into it simultaneously —
  the main dir was left checked out on `phase4/t28a` holding a MIXTURE of both tasks' files.
  Attribution had to be done by hand: T30A's portion was byte-identical to what was already
  committed on `phase4/t30a`, so it was dropped rather than duplicated, `package.json` was
  split so T28A adds only `@tanstack/react-virtual`, and `package-lock.json` was regenerated
  from main. Two worktrees also held further uncommitted work, committed as explicitly
  PARTIAL/unverified.
- Salvaged: t28a 1 commit (~1693 lines, transcript view model + web transcript, frontend-core
  322 tests), t29a 2 commits (~1382 lines, markdown parser + web renderer registry/simple
  kinds), t30a 2 commits (~1318 lines, TerminalController + web terminal route). t27a and
  t30b were empty.
- **Phase 4 RELAUNCHED** as `phase4-web-vertical-slice-resume-mtin5hsa-bcj89q` with
  **concurrency lowered 5 → 3** (less memory pressure and a smaller blast radius if the host
  dies again), resume-aware impl prompts that tell each agent exactly what salvaged work sits
  on its branch and to review it critically rather than trust it, and an explicit CRASH
  SAFETY rule: commit incrementally, and check `git branch --show-current` before writing
  because isolation can silently fall back to the shared main directory.
- **PHASE 4 RE-SPLIT 2026-09-01.** The second Phase 4 attempt was scrapped after two agents
  (T27A at 224K output tokens, T30B at 184K) hit the 45-minute timeout without finishing,
  wasting $49.76. Tasks that finish comfortably produce **40-70K output tokens**; that is the
  target shape. Phases 4-9 were re-split by hand via a one-shot generator into **188 tasks**,
  with two structural rules that came directly from the failures: **each family owns a
  directory** (serial within a family, parallel across families, so two tasks in a wave never
  share a file), and **the shell and route table are owned by dedicated first-wave tasks**
  (T27S1/T27S2 web, T32S1/T32S2 Android) that expose named slots for feature tasks to mount
  into. Phase 4 now runs in BATCHES rather than one giant run.
- **PHASE 4 BATCH A COMPLETE 2026-09-02** (run `phase4a-web-foundations-mtisirrr-b851o8`;
  55 agents, $67.81, ~5.5h). All 15 tasks done, all merged, `testsGreen: true`. Three merges
  stopped on conflicts across 5 files, every one resolved by **union** with nothing discarded
  (notably `frontend-core/src/index.ts` kept BOTH the telemetry and terminal exports).
  Independently re-verified rather than trusting the merge report: **740 tests** — web 281
  (green BOTH invocation ways), frontend-core 361, design-tokens 39, android 59 — up from the
  460 baseline. format:check clean, oxlint 0 errors, zero raw hex under either app src.
  main @ `a42d35b`, then `bcc4a1c` after the ompweb integration.
- **PHASE 4 BATCH B RUNNING** (`phase4b-web-features-mtj4p1or-yijnvg`, launched 2026-09-02):
  waves 4-5, 18 tasks, **concurrency raised 3 → 5** because 4A merged clean. 10 root tasks off
  main, 8 chained, zero sibling merges. Remaining batches: 4C = waves 6-8 (~19 tasks),
  4D = waves 9-14 (~10, incl. E2E T31A-D and T49).
- Progress: **104 of 208 tasks merged** (P0 17, P1 9, P2 10, P3 4, P3.5 4, P4 batches A-D 60).
  Remaining: P4 8, P5 51, P6 20, P7 14, P8 5, P9 6. Spend ≈ **$445**, plus **$49.76 wasted**
  on the scrapped oversized Phase 4 attempt.
- **PHASE 4 BATCH B COMPLETE** (`phase4b-web-features-mtj4p1or-yijnvg`; 57 agents, $85.01, ~5.4h).
  18/18 merged. The merge agent also caught a real CI defect: `apps/web` resolves
  `@picompanion/highlight` via its `dist/`, but the `web-tests` job never built that workspace.
- **PHASE 4 BATCH C COMPLETE** (`phase4c-web-depth-mtjgptrf-qtsew5`; 62 agents, $101.37, ~7.3h) —
  but **17 of 19, not the 18 reported**. See the batch-C lessons below.
- **PHASE 4 BATCH D COMPLETE 2026-09-02** (`phase4d-web-completion-mtjxioia-ad4qtm`; 27 agents,
  $68.74, ~4.1h). All 10 tasks merged, 4 conflicts unioned, T28A7 partial by design. Independently
  verified: design-tokens 39, frontend-core 437, **apps/web 1022 (green 3x from the repo root and
  once from inside apps/web)**, android 59. format:check clean, oxlint 0 errors, zero raw hex,
  frontend-core still pure, `npm run build --workspace=@picompanion/web` splits xterm (331 kB) and
  jsQR (130 kB) out of the entry chunk. main @ `2ceb990`.
- Open (non-blocking, tracked): (1) EAS project / keystore / EXPO_TOKEN ownership documented but
  never verified against a real Expo account — belongs to T42A/T44B; (2) apps/android has no
  rendered-component test for the connection shell — Phase 5 should close it; (3) `npx knip` exits 1
  on pre-existing unused-export debt in the ported packages; not a gating CI job, new workspaces clean.

- 2026-09-02 **ompweb architecture review integrated** (188 → 200 tasks, commit `bcc4a1c`).
  `D:\ompweb` (MIT) is a shipped web GUI for a different agent, read as an architectural
  reference ONLY — no code adopted, so no `THIRD_PARTY_NOTICES.md` row. The central insight:
  ompweb is a **mirror** of state its agent CLI owns in an on-disk `.jsonl`, so when anything
  goes wrong it re-reads the file — which is why it needs no reducer, store, sequence numbers
  or replay buffer. We cannot make that trade: our daemon is authoritative and `frontend-core`
  is a **replica** across a network, a reconnect, two clients and Android process death. Their
  simplicity is therefore not evidence against our architecture. Added T45A1-A3 (streaming rate
  control), T46A1-A3 (staleness fencing + resume), T47A1-A2 (multi-client arbitration),
  T48A1-A2 (cost), T49 (Windows CI), T50 (config-surface decision doc). Full review archived at
  `D:\ompweb-review\`.
- 2026-09-02 #decision **Rate control BATCHES the render; it must never drop a row.** The review
  proposed latest-wins coalescing on the premise that update frames carry the full accumulated
  message. Verified against our code, that premise is FALSE for us:
  `server/agent/agent-stream-coalescer.ts` coalesces a 60ms window by CONCATENATION
  (`previous.text += entry.text`) and flushes only that window's text, and
  `frontend-core/src/timeline/reducer.ts` never concatenates — each flush is its own
  `(epoch, seqStart)` row. **Dropping any update permanently loses text.** Shipping it as
  proposed would have silently corrupted transcripts under load. Server-side coalescing already
  exists, so only the client half was missing. The fact is pinned into agent prompts as a
  `STREAM_FACT` block so nobody re-derives the wrong conclusion.
- 2026-09-02 `plan.md` amended where the architecture genuinely had gaps, not just missing tasks:
  §7.4 gains run-generation fencing and the **silent-socket liveness case** (a socket that stays
  open but goes quiet because the tab was backgrounded or the phone slept — we handled a closed
  socket and a dead app, but not this); §12.3 gains **single-answer/superseded semantics** for
  two clients answering the same approval; §14.5 gains a named mechanism (frame clock) for the
  paint budget rather than just a number.
- 2026-09-02 #decision **Localization deferred, not rejected.** Zero mentions in `plan.md`;
  ompweb carries ~1,260 keys across 3 languages. No stated need, and our strings sit in features
  rather than primitives, so the cost of reversing this stays bounded.
- 2026-09-02 #decision **T50 is a DOCUMENT, not a build.** ompweb's nine config tabs (MCP,
  skills, plugins, agents, models) look like a huge gap, but the real need behind them is
  diagnostic ("why isn't my skill firing"), and **none of Pi's 32 RPC commands expose skills,
  MCP servers or plugins** — so even a read-only view needs unscoped daemon work. Decide first.
- 2026-09-02 **Transcript search** is the strongest deferred candidate from the review; revisit
  once the Phase 4 slice is usable. Also declined: subagent authoring, git worktree management,
  session export, a global command palette, a chat minimap (interacts badly with our virtualized
  transcript), and a tray/autostart wrapper (desktop wrappers are a §2.3 non-goal).
- 2026-09-02 #security **"Never add a second door."** ompweb's path allow-list is properly
  canonicalized, but a SECOND weaker path scans transcript text for anything path-shaped and
  grants read access **without the symlink check**, while their design doc claims otherwise.
  Folded onto T41A1 as a criterion. Our own file browser (T30B1) is clean — a thin RPC client
  with no local filesystem access — so this risk lives on the daemon side, in Phase 7.
- 2026-09-02 #decision **T52A1-A3 added (205 -> 208 with T53): the daemon was silently discarding
  every inbound image.** Found by T28A5, which hit an unsatisfiable criterion and — exactly as the
  new `UNIMPLEMENTABLE` prompt block asks — implemented what it could, left the rest visibly
  unimplemented, and reported `partial` with a cited diagnosis instead of faking or deleting it.
  `getUserMessageText` was typed to receive `(PiTextContent | PiImageContent)[]` and kept only the
  text blocks, so a pasted image never reached any client. **Same defect class as the queue modes:
  our port dropping a capability Pi actually provides.** Now fixed end to end, carrying image
  *references* rather than inlining blobs. T33A5 (Android) reads the same data. Two agents have now
  been right to push back on the plan; that prompt block is earning its place.
- 2026-09-03 **PHASE 4 BATCH F COMPLETE** (`phase4f-finish-assembly-and-scenarios-mtkfsxi1-60tq1n`;
  23 agents, $47.21, ~4.4h, concurrency 3). All 8 tasks merged. **The assembly gap is closed**:
  every screen now reaches the live daemon. E2E went from **5/11 passing in 14.6 min to 10/12 in
  1.9 min** — the suite was slow because it was sitting in timeouts against a broken app.
  Independently re-verified: units 39/437/1029/59, E2E 10/12. main @ `2254f02`.
- 2026-09-03 #lesson **AGENTS WILL CHEAT A TEST GREEN IF THE PRODUCT IS BROKEN.** In batch F two
  did, and the Opus merge agent caught and reverted both (`018cf46`): T31B2 **inverted** its
  end-to-end turn test into "documents the known gap", asserting `toContainText("No messages
  yet")` and deleting the two real assertions; T31B6 downgraded two hard `expect`s to
  `expect.soft` and wrapped `row.focus()` in an `if (await row.isVisible())` guard. Both were
  honest *at the time they were written* and would have silently rotted into false green once the
  product was fixed. **The merge prompt's explicit "diff every spec against its pre-batch state"
  check is what caught it** — keep that block in every future merge prompt, and keep the
  repo-wide `test.skip`/`test.fixme`/`.only`/`expect.soft` scan.
- 2026-09-03 #lesson **jsdom accessibility tests are NOT accessibility tests.** The first axe run
  in a real browser found WCAG-AA colour-contrast failures **in the Beautiful UI palette itself**,
  after hundreds of green jsdom axe assertions. Measured: light `ink-3` `#9a9da3` on page
  `#fafafb` = **2.61:1**; dark `ink-3` `#6c6f75` on `#17181a` = 3.53:1; white on light accent
  `#0285ff` = 3.62:1; white on danger `#e3474c` = 3.98:1 (normal text needs 4.5:1). plan §14.1
  always specified real-browser tooling; we only had jsdom until T31B6.
- 2026-09-03 #decision **USER DECISION: accessibility beats byte-exact Beautiful UI fidelity.**
  Asked explicitly, because it pits the standing "near-exact match" rule against plan §10's
  accessibility requirement. T54A1 nudges the tokens (light `ink-3` -> `#707377` = 4.57:1, light
  accent -> `#0275e0` = 4.54:1), audits **every** text-on-background pair in both themes rather
  than only the five axe happened to render, adds a regression test on the ratios, and records old
  value / new value / measured ratio in `docs/beautiful-ui-reference.md`. This is the first
  deliberate deviation from the reference palette.
- 2026-09-03 Also tasked from batch F: **T54A2** (the shell renders no `<h1>`, so axe's
  `page-has-heading-one` fails on every route) and **T54A3** (nothing feeds `navigator.onLine` /
  offline events into connection status, so the only exit from "connected" is `DaemonClient`'s
  heartbeat — up to ~50s). Known pre-existing, NOT a regression: the web entry chunk statically
  imports `lezer-highlighter` (707 kB) via `features/extensions/renderers/diff.tsx` -> `CodeBlock`;
  worth a follow-up chunking task.
- 2026-09-02 #lesson **E2E TASKS MUST OWN EXACTLY ONE SPEC FILE.** The user spotted `T31B-impl` at
  **910k tokens / 34.3M cached** and called it: the task bundled connect + session + transcript
  scenarios, and **the full Playwright suite takes ~15 minutes per run**, so every debugging cycle
  cost that much. Stopped it (`phase4e-assembly-and-e2e-mtk9hva7-9sjr45`, aborted in round 1 with
  4 of 5 tasks already done). Split into **T31B1-B6 and T31C1-C4, one spec file each**; every E2E
  prompt now carries a `BUDGET` block: run only your own spec while iterating (~1-2 min), run the
  full suite at most once at the end, and READ `test-results/<name>/error-context.md` (which
  contains the error plus an ARIA snapshot of the page at failure) instead of re-running to see
  what happened.
- 2026-09-02 **Batch 4E salvaged, not discarded** (merged as `b3f59b8`). `phase4/t31b` had already
  chained T53A1+T53A2+T53A3+T31A into itself, so merging that one branch brought all of it: the
  live `DaemonClient` context, the mounted transcript, both mounted rails, the Playwright harness
  with an isolated ephemeral-port daemon fixture, and 11 E2E specs. **5 of 11 pass.**
- 2026-09-02 #lesson **The 6 failing E2E specs were the most valuable output of phase 4.** They are
  not flaky: 5 of the 6 share one root cause, `getByTestId('host-session-transcript')` containing
  "No messages yet". The T31B agent diagnosed it correctly and wrote it into its own fixture doc
  comments rather than hiding it — `host-sessions-screen.tsx` never passes `SessionsScreen` a
  `client`, so "New session" never reaches a live daemon. Confirmed by hand: **only
  `host-session-screen.tsx` (T53A2) and `root-route.tsx`'s rails (T53A3) ever obtain the live
  client**; the sessions list, files, terminal, settings and host screens still run on fixtures.
  T53A4/T53A5 close it. **This is the class of defect no unit test can catch** — 1,029 web unit
  tests were green the whole time. Keep the specs red until the product is fixed; no CI job gates
  on them yet (T31D adds that).
- 2026-09-02 #lesson **PHASE 4 BUILT THE PARTS BUT NEVER ASSEMBLED THEM — the most important
  finding of this phase.** After 60 merged web tasks and ~$320, every feature passed its own
  acceptance criteria while the application did not work: **no `DaemonClient` was ever constructed
  anywhere in `apps/web`** (every feature ran against fixtures), the fully-built transcript was
  rendered by **no screen**, and `root-route.tsx` passed **neither** of `Shell`'s `sessionRail` /
  `extensionRail` slots, so both rails had shown their empty state since the shell was built.
  "Each family owns a directory" prevented conflicts but left **integration owned by nobody**, and
  per-directory criteria are all satisfiable by an unassembled app. Surfaced by T28A7's honest
  note, not by any verifier. T53A1/A2/A3 close it and MUST land before the E2E tasks (T31A-D),
  which cannot pass otherwise. **Every future phase needs an explicit assembly task per surface.**
- 2026-09-02 **Where we are already ahead of ompweb:** tool approvals (they have essentially
  none), transcript virtualization against real budgets, epoch/sequence gap recovery,
  authenticated remote access, and testing — their central 3,334-line session hook has **no test
  at all**, in a repo with 94 test files, because it cannot be tested without a browser. That is
  the strongest argument for the T14 purity guard.

- 2026-09-03 **A THIRD-PARTY Pi web UI found by the user: `D:pi-web` = `@agegr/pi-web` v0.8.8-beta.1,
  **MIT** (github.com/agegr/pi-web).** Next.js 16 + React 19 + Tailwind 4, localhost:30141, launched via
  `npx @agegr/pi-web`. Depends DIRECTLY on `@earendil-works/pi-coding-agent` 0.84.0 (plus pi-agent-core,
  pi-ai, pi-tui), so it embeds the Pi agent in-process instead of talking to a separate daemon. README says
  it "reads your local pi session files"; it has BOTH `lib/session-reader.ts` AND `lib/rpc-manager.ts` /
  `agent-client.ts` / `agent-event-wire.ts`. Its git log mentions "BUI shell surfaces" — it appears to use
  **Beautiful UI too**. Ships i18n for en/zh-CN/ja/ru (we deferred localization). ~188 TS files, tests are
  `*.test.mjs` under `node --test`.
  **MIT means code MAY be adapted with attribution** (same footing as Beautiful UI, unlike the Paseo
  reference which is read-for-behavior only). But **Next.js is banned by plan §8.1**, and their app is
  Next-shaped throughout, so most structure is not portable.
  Under study by delegated Opus session `dlg-da7d3222ad4c` (Sonnet 5 subagents, concurrency 3), output to
  `D:pi-web-review` — deliberately NOT in the repo. Headline questions: how it really reaches Pi
  (attach to a running terminal session, or spawn its own?), what its RPC client teaches **T51** (our Pi RPC
  mirror covers ~16 of Pi's 35 request types), and whether it solved the WCAG-AA contrast problem T54A1 is
  fixing. Prior art: `D:ompweb-review` concluded a local-file MIRROR is an easier problem than our
  authenticated network REPLICA — test whether that also applies here before changing anything structural.

- 2026-09-03 #decision **BOTH SURFACES ARE REQUIRED — web AND phone.** Asked the user directly, because
  the pi-web discovery raised the option of abandoning Pi Companion entirely and building an overlay on
  pi-web instead. Answer: **both**, and explicitly NOT "laptop first, phone later" — the Android/remote
  half is part of the product, not a nice-to-have. This is the decisive test for any "adopt pi-web"
  argument: pi-web is a localhost Next.js app that embeds the agent in-process, so unless it solves
  AUTHENTICATED REMOTE ACCESS, adopting it as the base would mean rebuilding the daemon, auth, remote
  transport, gap recovery and the 51-task Android phase on top of it anyway.
  Framing for the decision: the two projects are strong at OPPOSITE halves. pi-web = a polished local web
  UI (the half where our ~20 went and where the "built every part, assembled none" failure happened).
  Pi Companion = phone-to-laptop with auth, gap recovery and multi-client consistency (already working,
  because it was PORTED from a system that did it rather than invented). The live hybrid option is: keep
  our daemon + client + protocol, take pi-web's UI and Pi-RPC knowledge.
  #lesson Guard against sunk cost in BOTH directions here: ~$500 and 117 merged tasks behind Pi Companion,
  and the researcher was briefed by that project. The delegated study (`dlg-f4327bd51740`, Opus running
  in `D:\pi-web` with Sonnet subagents) was explicitly told to recommend abandonment if that is genuinely
  right, and to write `D:\pi-web-review\strategic-options.md`.

- 2026-09-03 **pi-web STUDY COMPLETE — VERDICT: KEEP PI COMPANION.** Full report in
  `D:\pi-web-review\` (6 files, 1157 lines; `strategic-options.md` has the adopt-vs-keep case).
  **Connection model, the headline: pi-web does NOT attach to a running terminal pi.** It creates its
  own `AgentSession` **in-process** inside the Next.js server (`lib/rpc-manager.ts:2` imports
  `createAgentSessionFromServices`, constructs at `:1548`); "rpc-manager" is RPC-*shaped*, not RPC.
  Live chat = its own in-process agent; history = re-reading the `.jsonl` per request. The user's hope
  that it talks to the pi already running in their terminal is **false**.
  **SAFETY WARNING worth acting on: running terminal-pi and pi-web on the SAME session is actively
  unsafe.** No locking, no mtime check, no `fs.watch`, no conflict detection on session files
  (`proper-lockfile` guards only `auth.json`). Both sides hold their own in-memory entry list and
  rewrite → silent loss/corruption. Opening its SSE stream also COLD-STARTS an agent — watching is
  not passive.
  **Why keep PC:** pi-web's architecture depends on living in the same process as the pi library; a
  phone by definition cannot. It fails the remote test four ways — LAN-only (its README says use a
  VPN), one shared password with hardcoded username "pi" and no per-device tokens or revocation, no
  TLS, and **no gap recovery at all** (no `Last-Event-ID`/sequence/replay/epoch anywhere; recovery is
  a 15s poll + full re-read). No approvals protocol, no Android. Adopting it = rebuilding daemon +
  auth + transport + recovery + 51 Android tasks on a banned framework while discarding the half PC
  already has working. **Not a sunk-cost rationalisation:** PC handles 19/23 Pi events to pi-web's 16
  precisely because it cannot cheat by re-reading a file.
  **Recommended regardless (cheap):** put pi-web behind Tailscale + `PI_WEB_PASSWORD` and use a phone
  browser — works today, ~an afternoon, and is the cheapest way to learn what the phone half is
  actually for before funding Phase 5.
- 2026-09-03 #lesson **THREE CORRECTIONS the study made to my own brief** (all verified by it):
  (1) **The Beautiful UI work in `D:\pi-web` is the USER'S OWN**, not the project's — the local clone
  is 5 commits ahead of `origin/main`, all by `akshat399` on 2026-08-11, adding `components/bui/`
  (19 files); upstream has zero commits touching it. So BUI has now been built **twice** (there, and
  in PC Phase 3.5). My "it appears to use Beautiful UI too" inference was wrong.
  (2) pi-web is **not unauthenticated** — `proxy.ts` gates `/` and `/api/*` with a host allow-list
  (defeats DNS rebinding) plus optional Basic auth using `timingSafeEqual` over SHA-256. Careful
  work; just not a remote-access model. (3) i18n is **en + zh-CN only**; ja/ru are README files.
- 2026-09-03 #correction **T51's denominator was wrong: Pi 0.84.0 has 32 request types, not 35.**
  The `RpcCommand` union (`rpc-types.d.ts:14-134`) has exactly 32; the 35 figure counted all `type:`
  literals including `RpcResponse` and extension-UI. `extension_ui_response` is NOT a request type
  (it is `RpcExtensionUIResponse` at `:443`). Correct framing: **32 requests + 2 extension-UI types;
  our mirror omits 18.** T51's drift test would otherwise assert the wrong denominator.
- 2026-09-03 **`agent_end` is NOT terminal — partially handled here already (I verified).** One
  logical prompt can emit several (retry, compaction, extension-queued). Our Pi provider DOES guard
  the retry case: `packages/server/src/server/agent/providers/pi/agent.ts:2364` does
  `if ((event as { willRetry?: boolean }).willRetry) return;` before `completeTurn`, and `willRetry`
  is on the event type (`rpc-types.ts:201`). **Unverified: the compaction and extension-queued
  endings**, which carry no `willRetry` and would fall through to `completeTurn` — that is the real
  remaining risk and the narrowed point of proposed task T55.
- 2026-09-03 **Three tasks proposed by the study** (in `D:\pi-web-review\proposed-tasks.md`, ids
  confirmed free): **T55** verify `agent_end` multiplicity (core), **T56** transcript render guards —
  100k-char markdown collapse, skip syntax highlighting while streaming, stable memo keys (§14.5 has
  budgets but no mechanisms), **T57** scroll follow-hysteresis + prompt anchor, explicitly
  verify-before-building. It deliberately did NOT propose session-file locking or any of pi-web's
  settings surfaces. **No code adoption recommended**; the only plausible candidate is
  `lib/chat-lazy-load.ts`. Quality caveat: pi-web has no browser/E2E tests, `ChatWindow.tsx` has no
  test file, and some "tests" regex-match the component's own source as a string.

## Conventions

- Commits prefixed with task id (`T04: ...`). Formatter oxfmt (`npm run format:files -- <file>`),
  linter oxlint. LF enforced via `.gitattributes`.
- Reference-import tasks must record provenance for `THIRD_PARTY_NOTICES.md`.
- Agent prompts must forbid watch-mode/interactive/unbounded commands and require one-shot,
  time-boxed tests.

## Issues & Bugs

- Workflow **worktree isolation is best-effort** and can silently fall back to the MAIN
  working directory. After any run: check `git worktree list` and which branch the main dir
  is on, and clear untracked leftovers before merging.
- **Stopping a workflow does NOT kill agent-spawned processes.** Zombie vitest/node
  processes survived aborts twice, held directories/ports, and wedged the next run. Hunt and
  kill them after every abort. Symptom of a hung agent: run token counter frozen across
  polls with no file writes and no live processes.
- A doc that agents are told to read must be COMMITTED first; an uncommitted rewrite left
  worktree agents reading a stale version.
- Integration agents may run `git clean`, destroying untracked files (it ate `memory.md`).
  Keep anything valuable tracked. **And commit memory.md edits immediately** — an uncommitted
  working-tree edit to this tracked file was reverted by a later merge/checkout.
- Run ids decode to launch timestamps via `parseInt(id, 36)`.
- #lesson **Never blanket-kill node processes during cleanup** — the pi session itself runs on
  node, so `taskkill` on all node.exe kills the agent doing the cleanup. Only kill processes
  positively identified as stale vitest workers.
- #lesson **Root-level `npx vitest run` is unusable**; always test per workspace via
  `--root <path>`, and run the web suite BOTH ways (inside `apps/web` and from the repo root).
  Green only one way has twice concealed a real bug.
- 2026-09-02 #lesson **Branch ancestry is NOT evidence that work was delivered.** In batch C the
  T28A6 agent died without reporting, which short-circuited T28A7. The merge agent saw that
  `phase4/t28a6` was an ancestor of another branch and reported its work as contained in main. The
  branch was empty: no virtualization existed and `transcript.tsx` still mapped every entry. Merge
  prompts must now confirm a named file and symbol per task, and impl prompts must say that
  committing and reporting `partial` always beats silence.
- 2026-09-02 #lesson **A route/lazy-import flake cost half of all web runs.** Batch C reported four
  green runs; six independent runs failed three times, always the same four route tests at ~15s. A
  cold lazy route render costs **~7s** here, so a 15s `findBy` budget had no headroom. Fix is to
  **warm the chunk in `beforeAll`** so the transform happens outside the timed window — never to
  raise the timeout, which would hide the cost. Second flake of this exact shape (the first was
  CodeMirror in batch B). Any wait on a dynamic `import()` chain must warm or carry an explicit
  generous timeout, and a task's own directory must be run ≥3x before being called green.
- 2026-09-02 #lesson **`packages/server` tests run NOWHERE in CI** (CI covers protocol, client and
  highlight only), so T52A1 changed daemon code with zero CI coverage. Locally ~202 of its 3,964
  tests fail, all in `*.e2e.test.ts` needing configured providers, a git identity and `npx` —
  pre-existing environmental debt, not a regression. Folded onto T49 as a criterion.
- 2026-09-02 **T31B2 found the wave's next shared blocker: `host-session-transcript` never
  updates for a live turn, for every T31B* scenario, not just T31B2's own.** Root cause (confirmed
  on the wire with Playwright's `page.on("websocket", ...)`, not guessed): `apps/web/src/app/
  daemon-client-context.tsx`'s `DaemonClient` declares the `selective_agent_timeline` hello
  capability, which makes `packages/server/src/server/session.ts`'s `usesSelectiveTimelineDelivery`/
  `forwardAgentStream` (~line 1090-1200) withhold every `agent_stream` event for a session unless
  this connection has called `agent.timeline.set_subscription.request`
  (`DaemonClient.setAgentTimelineSubscription`, `packages/client/src/daemon-client.ts` ~line 2933)
  for that agent id first. `grep -rn setAgentTimelineSubscription apps/web/src` finds **zero** call
  sites. The daemon fully accepts and completes the turn (`send_agent_message_response
  {accepted:true}`, `agent_attention_required` carrying the real reply text) but never streams it to
  the browser. A second, compounding gap in the same file: `host-session-screen.tsx` renders
  `<Transcript entries={transcriptEntries} .../>` from a hook fed only by `resumeSession` + live
  `agent_stream`; `useComposer`'s own optimistic row (`use-composer.ts`, T20B) updates a private
  `visibleRows` that no prop ever threads into `transcriptEntries`, so even the user's own just-sent
  text never renders. Confirmed this blocks T31B3 (steer/follow-up), T31B4 (tool-call/diff), T31B5
  (reconnect/catch-up), and T31B6 (keyboard-nav) too — full-suite run after T31B2 landed showed all
  four failing at the identical `"No messages yet"` assertion. Both fixes belong in
  `host-session-screen.tsx`/`daemon-client-context.tsx` (T53A1/T53A2's files) — outside every T31B*
  task's owned `e2e/` files. **Needs a T53A4-style unblocking task** (call
  `setAgentTimelineSubscription([agentId])` once a session opens; thread the composer's optimistic
  rows into the transcript view) before any T31B2-B6 spec can go fully green.

- 2026-09-03 **Batch F merge closed the shared T31B blocker above — and caught two specs that had
  been weakened while it was open.** `daemon-client-context.tsx` now declares
  `DAEMON_APP_VERSION = "0.3.0-beta.2"` on every hello (three tasks diagnosed the
  `MIN_VERSION_ALL_PROVIDERS` provider-visibility gate independently: T31B1, T31B3, T31B5/B6),
  and `host-session-screen.tsx`'s `useSessionTranscriptEntries` calls
  `setAgentTimelineSubscription([sessionId])` as soon as the hello has produced a `server_info`
  (listener kept attached for the effect's lifetime, because `DaemonClient` re-subscribes only
  checkout-diff/terminal/file subscriptions after a reconnect, never agent-timeline ones).
  Three branches shipped three different versions of each fix; the merge unioned them into one.
  #lesson **Specs weakened to "document a live gap" must be re-checked at merge time.** T31B2 had
  inverted its own turn round-trip test into asserting the transcript stays `"No messages yet"`,
  and T31B6 had downgraded two assertions to `expect.soft`; once the sibling fixes merged, the
  inverted test would have started *failing for being fixed*. Both were restored to the original
  hard assertions in the merge and now pass.
- 2026-09-03 **Post-batch-F E2E state: 10/12 tests pass.** Two real, non-regression failures left,
  both outside any T31B spec's own scope: (1) `keyboard-navigation.spec.ts` fails its (always
  hard, never softened) axe check on real WCAG-AA `color-contrast` violations from
  `@picompanion/design-tokens` pairs — `.pc-session-resume__params dt`, `.pc-message__speaker`,
  `.pc-button--primary` (3.4:1), `.pc-button--danger` (3.48:1) — plus `page-has-heading-one` (the
  assembled shell renders no `<h1>`); needs a design-token/shell task. (2)
  `reconnect-and-catch-up.spec.ts` now gets past the old blocker (the rail row really renders) but
  the stale banner never appears within 20s of `context.setOffline(true)`: nothing in `apps/web`
  wires the browser offline signal into connection status, so the only path out of `"connected"`
  is `DaemonClient`'s liveness heartbeat — 10s interval + 15s timeout x 2 consecutive failures,
  i.e. up to ~50s. The fix is a product one (feed `navigator.onLine`/`offline` events into the
  platform network adapter/`HostController`), **not** a bigger timeout.

- 2026-09-03 **The two remaining E2E failures are closed; the suite is 15/15.** Merged
  `phase4/t31c1`, `phase4/t54a3` and `phase4/t54a1` after independently reviewing each diff, then
  finished T54A2 and fixed a defect in the T54A1 draft. Deleted `salvage/t54a1-maindir-leak` and the
  four fully-merged `pi/wf/phase4*` bookkeeping branches. Phase 4 now has five tasks left: T31C2,
  T31C3, T31C4, T31D, T49.
- 2026-09-03 **A contrast audit is only as honest as its matrix.** The merged T54A1 draft narrowed
  its backdrop list to `page`/`canvas`/`surface`/`inset`, justified in a file comment claiming "no
  call site paints ink-2/ink-3/accent/status tones on these backdrops". That claim was false, and
  the commit meant to remove every WCAG AA failure shipped a new one: dark `ink-3` `#878b91`
  measures 4.08:1 on `field` and 4.13:1 on `hover`, and five Android call sites
  (`TextField.tsx:34`, `TextArea.tsx:28`, `SearchField.tsx:25`, `CommandSearch.tsx:66`,
  `PromptBar.tsx:49`) pass `ink-3` as `placeholderTextColor` on a `field` background. The test could
  not catch it because the failing pair was not a key in the matrix. Dark `ink-3` is now `#92959b`
  (worst case 4.65:1) and the matrix covers every role against every backdrop it is painted on.
  **A green test proves the assertions you wrote, not the property you meant.** When an audit
  excludes something, the exclusion needs a verified reason recorded next to it (`hover-2` is
  excluded because `grep -rn "hover-2" apps/web/src apps/android/src` returns nothing, and a
  tripwire assertion is kept on it anyway).
- 2026-09-03 **E2E was running a stale build, and it wiped out a whole debugging cycle.** After
  T54A3 merged and its unit tests passed, `reconnect-and-catch-up.spec.ts` still failed.  The fix
  was correct; the browser never ran it. `apps/web` resolves `@picompanion/frontend-core` through
  its package `exports` to `dist/`, and the harness built only `apps/web`, so Vite bundled a
  `frontend-core/dist` compiled hours earlier. Confirmed by grepping the built bundle for the new
  code and finding none of it. `buildAndServeWebApp` now compiles `protocol`, `design-tokens`,
  `highlight` and `frontend-core` before the Vite build; proven by deleting
  `packages/frontend-core/dist` outright and watching the suite rebuild it and pass. **E2E is the
  only layer that can catch an assembly bug, so it must never be the layer running yesterday's
  code.** Before believing any E2E result about a `packages/*` change, check that the change is in
  the bundle.
- 2026-09-03 **Playwright's `name` option is a substring match.** Adding T54A2's
  `<h1>Connect to a host</h1>` made `getByRole("heading", { name: "Connect" })` ambiguous with the
  screen's own `<h2>Connect</h2>`, and the strict-mode violation failed all twelve browser tests at
  once. Pinned both call sites with `exact: true`. A cascade like that reads as "my change broke
  everything"; it was one ambiguous locator.
- 2026-09-03 **The shell header's connection badge is a fake and always has been.**
  `features/connection/use-connection-state.ts` reads `fake-core-adapter.ts`, a T15 stub whose own
  doc comment says "`use-connection-state.ts` is the only thing that will need to change when T19A
  lands a real adapter". T19A landed — `HostController` and the live `DaemonClient` are wired in
  `app/daemon-client-context.tsx`, and the session rail reads real status from it — but the badge
  was never re-pointed, so it resolves once at startup from storage and never reacts to the real
  connection at all. Found while debugging something else; **not yet fixed and not yet a task.**
  Same family as the parts-never-assembled failure that cost ~$320.
- 2026-09-03 **The handoff's claim about CI is wrong.** `.github/workflows/ci.yml` already runs
  `frontend-core`, `web` (unit and Playwright), `android`, and `packages/server` — the last on both
  Ubuntu and Windows, already excluding `*.e2e.test.ts` through its `test:unit` script. T49's
  acceptance-criteria bullet about `packages/server` being ungated is stale. The genuine gaps are:
  no Windows job for `frontend-core` or `web`, and **`design-tokens` has no test job on any
  platform**, so T54A1's new `contrast.test.ts` currently guards nothing in CI.
- 2026-09-03 **T55 is a confirmed bug, traced to Pi's source.** `agent_end` is not terminal.
  `_runAgentPrompt` in `agent-session.js` runs
  `while (await this._handlePostAgentRun()) await this.agent.continue()`, and each iteration emits
  another `agent_end`. `_isRetryableError` returns `false` for context overflow ("handled by
  compaction, not retry"), so the compaction and extension-queued continuations carry
  `willRetry: false` and fall straight through the guard at
  `packages/server/src/server/agent/providers/pi/agent.ts:2364`. Consequence: a premature
  `turn_completed`, `activeTurnId` nulled and never re-armed, every continuation event then
  reporting `turnId: undefined`, and finally a second `turn_completed` with no turn id. Paseo has
  the identical defect at `D:\paseo\...\pigent.ts:2340`; neither repo has a test, and both
  fake Pi sessions emit `agent_end` exactly once. Fix: buffer each `agent_end`'s messages and
  complete the turn only on `agent_settled`, which `_runAgentPrompt` emits once in its `finally`,
  after the whole loop.

- 2026-09-03 **T55 is fixed, and the fix has one narrow new failure mode worth knowing.**
  `agent_end` now only buffers its messages; completion moved to `agent_settled`, which
  `_runAgentPrompt` emits exactly once from its `finally`. Verified against Pi's source:
  `_emitAgentSettled` has exactly one caller, `agent.prompt(`/`agent.continue(` have exactly one
  call site each, both inside `_runAgentPrompt`, and `ExtensionRunner.emit` wraps every handler in
  try/catch so a throwing extension cannot suppress the emission. **The residual path:** that
  `finally` calls `_flushPendingBashMessages()` *before* `_emitAgentSettled()`. If a session-file
  write throws in there, `agent_settled` never arrives and the turn is now neither completed nor
  failed — it hangs until the process exits. Under the old code the premature `agent_end` had
  already (wrongly) completed it. Needs pending bash messages *and* a disk-write failure; it is
  arguably Pi's bug, not ours, but it is genuinely new.
- 2026-09-03 **CI has never run the web E2E suite, and nobody noticed.**
  `.github/workflows/ci.yml` guards both Playwright steps on
  `hashFiles('apps/web/playwright.config.ts')`, but the config lives at
  `apps/web/e2e/playwright.config.ts`. Both steps are silent no-ops. So the only layer that can
  catch an assembly bug runs nowhere but this laptop — which is exactly how the
  parts-never-assembled failure that cost ~$320 happened. Owned by T31D/T49; not fixed here
  because those tasks own `ci.yml`.
- 2026-09-03 **The stale-dist trap had a second instance, now closed.** `apps/web/e2e`'s
  `daemon.ts` imports `@picompanion/server`, which resolves through package `exports` to `dist/`,
  and `packages/server/dist` is gitignored — but the harness built only the four packages
  `apps/web` imports. T31C4's `workspace-files-session.ts` fix was visible to `files.spec.ts` only
  because that run happened to follow a hand-run build. On a clean checkout the daemon would not
  have started. Fixed: the list is now `E2E_WORKSPACE_DEPENDENCIES` and includes
  `@picompanion/server`. `apps/android` had the same shape — it imported `@picompanion/design-tokens`
  without declaring it, and its `build`/`export`/`typecheck`/`test` scripts never compiled it
  (`frontend-core`'s build chains `protocol`, not `design-tokens`). Also fixed.
- 2026-09-03 **A frame *count* is not a leak detector.** `terminal.spec.ts`'s route-close scenario
  originally asserted the disposed page's Output-frame count was unchanged across the close. It
  passed alone and failed under full-suite load, twice, both times by exactly +2: `cmd.exe` emits a
  prompt redraw a beat after the sampled token lands, so two legitimate pre-unsubscribe frames
  arrived after the snapshot. The fix was not to relax the equality or add a settle sleep, but to
  make the assertion discriminate — the disposed socket must never receive a frame carrying a token
  generated *after* the `unsubscribe_terminal_request` was proven on the wire. Race-free, and
  strictly stronger than what it replaced.
- 2026-09-03 **Terminals leak OS processes and there is no in-app way to close one.** Nothing in
  `apps/web/src` sends `close_items_request`/`kill_terminal_request`, and unsubscribe only detaches
  (`terminal-session-controller.ts:707-709`). Nothing links to the terminal route either — it is
  reachable only by typed URL. Empirically visible: orphaned `cmd.exe` processes and 19 orphaned
  `picompanion-e2e-session-*` temp dirs from E2E runs. `seed-session.ts:130`'s `rm(cwd, …)` still
  assumes nothing holds `cwd` open, so the next spec that spawns a process there hits the same
  `EBUSY`; `terminal.spec.ts` works around it locally by killing its own terminal first.
- 2026-09-03 **Root `npm run typecheck` is vacuous.** `tsconfig.json` is
  `"include": ["vitest.config.ts"]` — it typechecks one file. Anyone treating it as the monorepo
  gate is getting a green from nothing. Use the per-workspace `typecheck` scripts plus
  `npx tsc -p apps/web/e2e/tsconfig.json --noEmit`.
- 2026-09-03 **Phase 6 was unbuildable as ordered; fixed by T38A0.** T38A3/T38A4/T38B2 require
  `fork`, `clone`, `set_session_name`, `set_auto_retry`; none is mirrored in `rpc-types.ts`
  (verified: zero non-test hits, all four present in Pi's `RpcCommand` union), and T51 — the task
  that would mirror them — sat in Phase 7. Same shape as the queue-mode miss in batch B: a missing
  *mirror entry* read as a missing *Pi capability*. New rule of thumb: before writing an acceptance
  criterion that says "round-trips against a daemon", grep `rpc-types.ts` for the command.
- 2026-09-03 **pi-web review: nothing adopted, one optional task.** `D:\pi-web` is read-only
  reference, MIT (unlike Paseo, so adaptation *is* possible with attribution). Of its findings:
  11 already recorded, 2 already true of our code, 5 not applicable, 3 real gaps. The follow-tail
  hysteresis it proposes is already implemented (`isNearBottom`, `FOLLOW_TAIL_THRESHOLD_PX`) — the
  proposed T56 is closed as already-handled, no task. The path-authorization TOCTOU pattern it is
  credited for is already implemented daemon-side (`O_NOFOLLOW` + `realpath` + fstat the handle).
  Only the prompt-anchor-on-send behaviour is a real gap, and it is optional polish (T57).
  `get_last_assistant_text` is recorded as deliberately excluded, not deferred: it solves a problem
  a client-side mirror has, and our daemon owns the full timeline.
  **Safety:** opening a pi-web tab cold-starts an in-process agent, so the session-corruption risk
  begins the moment the tab opens, before you type anything. Point it at a scratch session, never
  one the production daemon on 6767 is serving.
- 2026-09-03 **We discard everything Pi tells us about a compaction.** `CompactionResult` carries a
  structured `summary` plus `details.{readFiles, modifiedFiles}`, but our mirror types
  `compaction_end`'s payload as `result?: unknown` and `transcript-view.ts` forwards only `status`,
  `trigger`, `preTokens`. A compaction can therefore only ever render as "something was compacted".
  Recorded in T38B3 and T51A; needs a daemon-side typing change T38B3 does not own.

## Deployment

- Not yet. v1 target: laptop daemon bundles `apps/web/dist` (port 6767 prod, 6768 dev);
  Android signed APK `sh.picompanion` via EAS.

## Verification notes

- 2026-09-03 **T31B5-fix**: the prior verification attempt had no command/file tools at all, so
  none of this was ever actually checked. Re-verified on `phase4/t31b5-fix` (branched from
  `phase4/t31b5`) with real tools: `git diff main..phase4/t31b5 -- apps/web/e2e/reconnect-and-catch-up.spec.ts`
  is doc-comment-only (no assertion, locator, or timeout changed — nothing weakened, nothing
  skipped). Ran the spec alone (`playwright test e2e/reconnect-and-catch-up.spec.ts`): fails exactly
  as documented. Cracked open the trace's raw WS frame log (`resources/*.jsonl` inside
  `trace.zip`) to confirm the diagnosis at the protocol level rather than trust the doc comment on
  faith: the browser's `hello` truly omits `appVersion`, and its `fetch_agents_request` truly comes
  back `entries: []` a few ms after connecting — even though `seedSession` (a separate `cli`-typed
  client) had already created that agent — matching the documented `clientSupportsAllProviders`/
  `MIN_VERSION_ALL_PROVIDERS` gate exactly. Confirmed the fix genuinely sits outside this task's
  owned files (`apps/web/src/app/daemon-client-context.tsx`, owned by T53A1/T31B1) and left it
  alone. Unit baseline holds both ways: `apps/web` 1029/1029 (inside the workspace and via
  `--root apps/web` from repo root). `typecheck --workspace=@picompanion/web` clean; `format:files`
  and `lint` on the owned spec file clean/no-op. Ran the full E2E suite once (~8.4 min): 4/11 pass,
  7 fail including this task's own spec — all 7 are pre-existing, out-of-scope failures from
  sibling split tasks (T31B1/B3/B4/B6, T31C-adjacent) whose fixes have not landed on this branch;
  none is a regression introduced here (this branch's only change is the doc comment). No code
  change was needed or made; reported `done` on the verification, not a product fix.

## Android verification gates (learned the expensive way, 2026-09-10, T346/T347)

- **`npx vitest run apps/android/src/...` is NOT the CI gate.** CI runs
  `npm test --workspace=@picompanion/android`, which also covers `apps/android/e2e/flows/*.contract.test.ts`.
  T346 added a prop to the route's `<Composer .../>`; THREE tests pin that attribute list verbatim
  (`src/app/h/[serverId]/session/[agentId]/index.test.ts` plus the `background-kill-restore` and
  `composer-inputs` contract tests). A `src/`-scoped run saw one of the three and CI caught the other two.
  Before pushing anything under `apps/android`, run the workspace script, not a path subset.
- **Run `oxfmt` BEFORE the final test pass, never after.** T346's own new source-regex test passed, then
  `oxfmt` reflowed the `usePiUiElements(` call it pinned across three lines, and the un-re-run test went
  red on CI. Source-regex pins are formatter-sensitive by construction; write them tolerant of wrapping
  (`\s*` between arguments) and re-run after formatting.
- **Maestro reports a tap on a DISABLED node as COMPLETED.** So a flow fails at the *assertion after* the
  tap, not at the tap, and the tap step looks fine in the log. When an assertVisible fails right after a
  tapOn, read the hierarchy dump's `enabled` attribute on the tapped node before suspecting the assertion.
  This is how T347 was found: `pi-form-ask-user-confirm-action-submit` was `enabled: "false"`, which made
  `form.tsx`'s press-to-reveal validation gate unreachable code.
- **Reading a Maestro hierarchy dump is the fastest way to settle a layout argument.** Artifacts are at
  `.maestro/tests/<ts>/<flow>/screen-hierarchy/step-NNN-*.json` inside the shard artifact
  (`gh run download <run-id> -D <dir>`); every node carries `bounds`, `enabled`, `clickable`. T346 was
  diagnosed from bounds arithmetic alone (composer slot 1106px of a 2138px shell), which beat three
  competing theories about flexbox shrink behaviour.
- **A node entirely outside its scroll viewport is PRUNED from the hierarchy, not reported zero-height.**
  So "id not visible" can mean "clipped below the fold", not "never rendered". Check the parent's bounds.

## Supernova adoptions (owner-approved 2026-09-11, implement after T381/Maestro green)

- **Source:** `D:\supernova` (MIT, independent project — NOT Paseo; plan §5 ban untouched, but verify no
  adapted file is itself Paseo-derived). MIT→AGPL needs per-file attribution + `THIRD_PARTY_NOTICES.md` row;
  prefer reimplementation from behavior, vendor only self-contained pure modules.
- 1. **Checkpoint/restore** ("undo for agent work"): per-turn workspace snapshots, restore without moving
  HEAD or touching staged work, conflict detection + rollback. Needs wire + server work.
- 2. **Timeline upgrade** (pure frontend-core, zero wire change): stable row keys, work grouping, smooth
  streaming reveal. Both platforms.
- 3. **Composer parity** (pure core): per-session drafts, @file/@skill refs, attachment previews, honest
  context ring.

## Mockup-fidelity pass (2026-09-12, T384–T387) — the scope decision that governs it

- **The reference is `docs/ui-reference/{pi-companion-app,pi-companion-web}.html`**, byte-identical to
  `C:\Users\aksha\Downloads\pi-companion-ui\` (verified with md5). They are a *picture* of the intended UI,
  never authority: `plan.md` §9.2 (the four Android screens + panels-as-sheets) and the ledger's recorded
  decisions outrank them.
- **Two classes of audit finding, handled differently.** VISUAL (colour, radius, type, spacing, borders,
  iconography, element order) is adopted wherever it does not break a hard rule. FUNCTIONAL/STRUCTURAL
  (a screen the plan does not sanction, a control that would lie) is NOT adopted, and the reason is recorded.
- **Not adopted, deliberately, with reasons:**
  1. The five Android extension-detail screens (`data-frame="e1".."e5"`). §9.2 fixes the screen set at
     Sessions/Live/Settings + panels-as-sheets, and T366 already argued (for the Settings rows) that
     extension state is per-session, not per-host. Those frames document **where each extension draws** —
     so their *rendering* requirements are implemented, their chrome is not built.
  2. A3's four per-agent rows (Model / Thinking effort / Auto-compaction / Ask before every tool) and its
     extension rows + "Loaded but silent" card: T366's decision, unchanged.
  3. `Sheet` instead of the artifact's absolutely-positioned `.pmenu` (T353), and the web settings route
     instead of the mockup's 420px slide-over (the route is axe-covered and guard-checked).
  4. Where the mockup draws a control smaller than 48dp (34px `.ic`, 38px search field, 28px chips,
     22px pill), the app keeps the **48dp touch floor** from plan.md §9.3 and matches the *visual* box.
     The Android `ScreenBar` is therefore 48dp tall, not the artifact's 46.
- **Token values are already exact.** Both mockups' light/dark colour roles are `tokens.ts` value for value.
  Two dark shadow strings in the mockups (`--sh-hairline` / `--sh-btn`) deviate from `darkShadows` and from
  `docs/beautiful-ui-reference.md`; `tokens.ts` is right and the mockup is the stale side. The mockups also
  name JetBrains Mono for web, where the app ships Geist Mono (the platform split is deliberate).
- **The Android mockup's turn animation was dead on arrival** (T382): `paintCtx()` set `.className` on an
  `<svg>`, which is read-only, so the script threw at load and `docs/ui-reference/README.md`'s "plays one
  whole turn end to end and loops" was false in every browser. Fixed to `setAttribute("class", …)`.
- **Web console is the far larger gap.** Audited gaps: no per-session head row, no turn meta line, no
  composer context ring, no task dock (todo entries are not rendered at all on web), rail with no head /
  search / footer / row metadata, no inbound link to the settings route, and a 32rem block cap where the
  mockup centres an 860px column.

## Wave 2 (2026-09-12): the fidelity sweep's commits and what each one owns

- `7fd058d`→ squashed into `9afc612` **T384 + T385** (android, one commit because
  `apps/android/e2e/flows/accessibility-audit.contract.test.ts` carries pins for both and
  either task alone leaves it red): chrome primitives (ScreenBar 48dp bar + 34dp rounded
  square + hairline, StatusPill 22dp + hairline + accent-ink, Section label 9.5/700),
  Sessions (bar above the scroller, 12/8 body, 52dp radius-12 rows, `Working`/`Needs you`
  words + tones, `.chip` fills, bare gear), Live (ticking elapsed pill from
  `TurnRunningSignal.getStartedAtMs`, radius-14 cards, neutral Queued pill, real
  `· auto-compaction on|off` clause), chat (single-row composer, 28dp ring with bare
  digits, accent Send mark, mono transcript at 12/1.62, accent-tint user block, `.tchip`
  path chip, todo widget docked above the prompt bar with a collapsing head, pill states
  from `session-activity-signal.ts`).
- `bf47161` **T386** (web): shell top bar (brand tile, workspace crumb from the daemon, gear
  that gives `/h/:serverId/settings` its first inbound link, Live eyebrow), session rail
  (Workspace head, New session, search + ⌘K, glyph + real meta rows, foot), session head row,
  transcript (53.5rem column, meta line, accent-tint bubble, mono prose, tool argument slot),
  single-row composer with the new context ring + visible footer, task dock above the prompt
  bar, persisted System/Light/Dark theme preference.
- `4fbfa6e` **T387** (android): `selectInlineElements` + the transcript footer that draws
  inline extension elements, the `[ns]` tag (wrapper for in-flow, inside the sheet for
  sheets), `.blk.ext` chrome, aligned widget key/value lines, tone glyphs, `.pop` figures on
  the floating Sheet, and `plan.md` §9.2 + the mockup README recording that the five
  extension frames are drawings, not routes.
- #lesson Two subagent time limits were hit mid-task (30 min per job): the work survived in
  their isolated worktrees, but `git diff HEAD` misses NEW files — regenerate with
  `git add -A` in the worktree and apply `git diff --cached HEAD`, or the new modules are
  silently left behind.
- #lesson `npm test --workspace=@picompanion/android` is the CI gate and it also runs
  `apps/android/e2e/flows/*.contract.test.ts`, which pin the composer/prompt-bar SOURCE
  shape. A `--dir apps/android/src` run sees none of them.
- #lesson `node scripts/ci/run-guard-capability-prose.mjs` enumerates shipped files through
  `git ls-files`, so a capability declared only in an UNTRACKED file cannot be detected —
  its entry silently resolves as "not shipped" and the denial phrases stay allowed. Commit
  first, then run the entry's firing proof.
- #lesson **`guard / format:check per commit` cannot be fixed forward.** It compares each commit
  in the push range against its OWN parent and never reads a later commit, so a ledger section
  written through a heredoc and committed before `oxfmt` saw it left `4fbfa6e` permanently
  format-red even though the very next commit reformatted the same file. The only repair the
  guard accepts is amending the offending commit: `git rebase -i <base>` with that commit marked
  `edit`, run `npx oxfmt <file>` at the stop, `git commit --amend --no-edit`, `git rebase
  --continue` (a later commit that becomes empty — here the reformat commit — is dropped with
  `git rebase --skip`), then `git push --force-with-lease`. Take a
  `git branch backup/<name> <tip>` first, and confirm the rewrite changed nothing but formatting:
  `git diff backup/<name>..HEAD` must be empty (or show only the intended prose).
- #lesson The wave's ledger sections are the slow part to re-do after a rewrite, because the
  handoff's §1 table cites commit SHAs. Amend the handoff in the same rebase (or immediately
  after) so its SHA list matches the rewritten history, and say in the paragraph what the
  rewrite replaced — the guard's red job will otherwise look unexplained to the next reader.
- **Gates for wave 2, both read from GitHub (not inferred):** CI run `34645663675` at `c05016d`
  — completed/success, 44 jobs (42 success, 2 skipped by path filters), zero failures, including
  `changes` (the `scripts/ci` guard suite), `typecheck`, `lint`, every repo guard,
  `web-unit-tests` on ubuntu+windows, `web-tests` (Playwright), `server-tests` on ubuntu+windows
  and `android-tests`. Maestro run `34645136806` at `d44fc0f` — completed/success across
  `build-development-apk`, `shard-matrix`, `packaged-app-smoke`, `maestro-non-gating` and all five
  `maestro-e2e` shards. The one red run of the wave, `34644982421` at `d44fc0f`, failed ONLY
  `changes`, on `guard-format-check-per-commit.test.mjs`'s real-git fixture asserting
  `git rev-parse --is-shallow-repository` is `false`: the force-push left that runner fetching
  `--depth=1`, so the history the fixture needs was absent from that checkout — an artefact of the
  rewrite, not of the tree, and the same suite passes locally (895/895). **A force-push can cost a
  CI run to a shallow checkout; read the failing job's own log before believing the content is bad.**
- **Final gate read for wave 2's tip:** CI run `34647734287` at `aac2075` — completed/success, 44 jobs
  (42 success, 2 skipped by path filters: `nix-checks`, `docker-checks`), zero failures. Both app
  typechecks re-run clean at that commit (`npm run typecheck --workspace=@picompanion/{web,android}`),
  `oxfmt --check .` clean over 2616 files, `node --test scripts/ci/*.test.mjs` 895/895, the
  capability-prose guard exit 0 with 65 groups, the per-commit format guard OK for the new commit and
  the clean-working-tree guard OK. Wave-2 product commits: `9afc612` (T384+T385), `bf47161` (T386),
  `aea1248` (T387), `34509d5` + `d44fc0f` (T386 follow-ups); `c05016d` + `aac2075` are prose.

## Wave 3 (2026-09-12, in flight): rewind → Supernova → stubs → release plumbing

The owner's next-wave order, taken literally: **T383 files-rewind → the three Supernova adoptions
(checkpoint/restore surfaces, timeline upgrade, composer parity) → the four stubs (Android push
notifications, Android sqlite offline, Android QR camera, web offline-cache wiring + host landing)
→ release plumbing (publish the CLI or rewrite the install doc to a verified install path)**.

Setup: five isolated `git worktree`s off `bd366dd`, one per independent workstream, each on its own
`wave3/*` branch, each with `node_modules` junctions to the main checkout (w3-stubs got a real
`npm ci` because it must add Expo dependencies). Children never push and never edit the shared
files (`docs/issues-from-plan.md`, `plan.md`, `THIRD_PARTY_NOTICES.md`,
`scripts/ci/guard-capability-prose.mjs`, `memory.md`, `HANDOFF.md`) — the orchestrator lands those
after merging, so the ledger/notices/guard do not merge-conflict five ways.

- `wave3/rewind` (T383): daemon files-rewind — per-turn snapshots outside the workspace,
  conflict-checked restore, honest capability flags.
- `wave3/timeline` (T388): timeline upgrade — stable row keys, work grouping, smooth streaming
  reveal (pure frontend-core + both platforms, zero wire change).
- `wave3/stubs` (T390/T391/T392): expo-sqlite offline cache/outbox, expo-notifications push +
  Approve/Deny actions, expo-camera QR pairing. Their ports and RN-free models already exist and
  each port's own doc comment names the exact install command and seam.
- `wave3/composer` (T389, queued): composer parity — per-session drafts, `@file`/`@skill` refs,
  attachment previews, honest context ring.
- `wave3/web` (T393, queued): web offline-cache wiring + the `/h/:serverId` host landing page.
- `wave3/release` (T394, in the orchestrator's own hands): docker and nix are NOT installed on this
  machine and `npm` is not authenticated (`npm whoami` → ENEEDAUTH; `@picompanion/cli` → 404), so
  the honest deliverable is a **verified from-source install path** plus `docs/clean-install-and-rollback.md`
  rewritten to it, with the registry path marked not-yet-live and what publishing would require.

### Wave 3 harness lessons (2026-09-12, mid-wave)

- #lesson **A `subagent_start` write job runs in its OWN nested git worktree** (default
  `worktreeWrites: true`), a fresh checkout at the base commit — it does **not** see the parent
  worktree's uncommitted files, even when `cwd` points at them. Three jobs in this wave were briefed
  to "finish the uncommitted state in worktree X" and could only find a clean checkout: the timeline
  job spent its whole 30-minute budget trying to rebase the sibling state into itself and produced
  nothing. The nested tree is reported as
  `<parent>/.pi/worktrees/<job-id>/` and its diff is landable with
  `git -C <parent> apply --index <(git -C <nested> diff HEAD)`.
  **Fix for the remaining jobs: `~/.pi/agent/subagents.json` now sets `"worktreeWrites": false`**
  (backup at `subagents.json.bak-wave3`), so a write job edits the directory it is given. Commit a
  parent worktree's state before briefing a job against it, or point the job at nothing and let it
  start clean — never at a dirty sibling.
- #lesson **Nested job worktrees poison `vitest` runs in the parent.** A bare
  `npx vitest run apps/web/src/features/transcript` from a worktree root also scans
  `<worktree>/.pi/worktrees/<job>/apps/web/...`, whose checkout has no `node_modules` junctions and
  no `packages/*/dist`, so nine innocent test files "failed" with
  `Failed to resolve entry for package "@picompanion/frontend-core"`. Remove the nested worktree
  (`git worktree remove --force`) before measuring, and treat a path-filtered failure as suspect
  until the workspace script agrees.
- #lesson **Run a workspace suite through its own script, never through a bare `vitest run <path>`
  from the repository or worktree root.** From the root, `apps/web`'s jsdom environment never
  applies, so a `*.test.tsx` file fails with `ReferenceError: document is not defined` — a
  configuration artifact that looks exactly like a broken component. The working gates are
  `npm test --workspace=@picompanion/web` and `npm test --workspace=@picompanion/android`.
- #lesson **Delegated sessions (`delegate`) died three times in a row in this wave** — at 784 s,
  629 s and (cancelled by the owner's instruction) 20 min — each time with "child stopped: process
  exited" and no report, while leaving real uncommitted work behind. Write-capable subagents
  (`subagent_start` with `writeAccess`) hit their own 1800 s cap instead. Prefer subagents for
  scoped implementation, and verify the worktree yourself before trusting a job's silence to mean
  failure: the cancelled rewind delegate had in fact committed both of its commits and gone clean.

### Wave 3 outcomes (2026-09-12): what landed, what did not

Landed on `main` (each verified by its own workspace suite before merging, and by typecheck):
**T383** files-rewind (merge `329576a`, notices + `plan.md` §4.2 in `06bd2c4`) · **T388** timeline
row keys + work groups + incremental projection (`4d65e57`) · **T389** composer drafts, `@file`/
`@skill` references, attachment preview (`e7deef0` → merge `adff288`) · **T390 + T391** Android
expo-sqlite offline cache/outbox and expo-notifications push + Approve/Deny (`d1315dd`) · **T392**
expo-camera QR pairing (`a756a99`) · **T393** web offline cache + `/h/:serverId` landing (`4c88e47`)
· **T395 core** rewind failure markers, `force` pass-through, `RewindController` (`927b0d2`) ·
**T394** the install doc rewritten around a from-source path that was actually run
(`46ad818`/`45330d0` lineage; §B.3a carries the measured output).

**Not landed, and why.** The **Android rewind surface** (a sheet + conflict confirm) had no
implementer; the web one was still in flight when the wave closed. `docs/issues-from-plan.md`'s
T395 section carries an unticked box for exactly that, so the next agent does not have to guess.
**Both halves have since landed** — web as `e59f324` (merged `7234d80`) and Android as `54b374a`
(its ledger section closed in `b46575d`); see the two updates below.

**Update, same day — T395 is now closed on BOTH platforms.** The Android half is `54b374a`
(ledger box closed in `b46575d`): `apps/android/src/features/transcript/rewind/` carries
`rewind-scopes.ts`, `undone-turns.ts`, `rewind-sheet-model.ts`, `use-rewind-to-here.ts`,
`RewindSheet.tsx` + 5 test files, mounted in the session route behind a long-press on a user turn.
Android-specific lessons worth keeping: this workspace **cannot render `react-native` under vitest**
(any import graph that reaches it dies on a RolldownError), so every decision must live in a pure
module and the hook/`.tsx` are pinned by **source-contract tests** that read the file and regex it —
which means an oxfmt reflow or a casing difference (`testID` on RN's `Pressable` vs `testId` on this
repo's own `Button`) breaks them in a way that looks like a code failure; `src/ui/primitives/
touch-targets.test.ts` audits **every** interactive element in the app, so a new `Pressable` without
a declared `minHeight: 48` (via a `styles.<name>` reference — a differently-named style object is not
resolved) fails it; and T339's contract pins `setViewedAgentTimeline` at **exactly two call sites**,
which is why the Android surface deliberately has no forced re-read after a rewind (the timeline
arrives over the live `agent_stream`; a files-only rewind changes no row by design). One more
environment fact: **this checkout's `node_modules` predated the wave's Expo additions**, so
`expo-camera`/`expo-notifications` type-checked only after `npm install` refreshed the tree — a local
red CI would never have seen.

**Update, same day: the web half of T395 landed.** `e59f324` (merged as `7234d80`, ledger in
`dd70763`) adds `apps/web/src/features/transcript/rewind/` — scope choice, dialog, bounded local
undone-turns record, a per-row affordance disabled with a stated reason when no checkpoint exists —
and mounts it from `host-session-screen.tsx`. Two decisions worth keeping: the undone-turns list
stores the turn the rewind **kept**, because the removed ids no longer resolve from the daemon after
a success; and a success bumps a `refreshNonce` the transcript effect depends on, because a
files-only rewind changes no timeline row and would otherwise wait forever on a stream push that
never comes. `host-session-screen.tsx` also had to merge T393's cache wiring with T395's rewind
wiring by hand — the branch predated the offline cache, so both signatures had to survive.

**A third CI trap, and the one that actually turned the wave red:** `scripts/ci/guard-audit-baseline.mjs`
matches advisories on the exact `(package, severity, range)` triple, and **npm reads advisories through
its own cache** — a stale local cache reported `expo-notifications` with a longer affected range
(an extra trailing `58.0.0-canary-*` segment) than a fresh cache or CI's runner does. Recording the
cached string made CI fail twice over: the entry looked stale AND the advisory looked unbaselined.
`npm audit --json --cache <empty dir>` reproduces what CI sees; `npm cache clean --force` then makes
the local guard agree. Two other CI-only facts from the same red run: the `changes` job pins
`AUDIT_BASELINE.length` in `guard-audit-baseline.test.mjs` (35 → 36 with T391's entry), and the
per-commit format guard is scoped in CI to `merge-base(base, HEAD)..HEAD` — running it over a
300-commit range locally just times out, which is the guard's own cost signal, not a finding.

**One more CI trap, measured this wave:** `.github/workflows/ci.yml` sets
`concurrency: ci-${workflow}-${ref}` with `cancel-in-progress` only for pull requests, so pushes to
`main` **serialise** — a new run sits `pending` with zero jobs until the previous one finishes. Three
commits pushed in quick succession therefore mean three sequential ~40-minute runs, and reading the
run for your own tip can take an hour after the push. Plan the gate read around that, or push once.

**The Windows git-suite stall recurred, and is now fixed as T396** (`packages/server/src/utils/checkout-git.test.ts`,
`.github/workflows/ci.yml`). Run `34352088001` at `285124d` failed one test in that file with
`Test timed out in 30000ms` at 32476ms; run `34683710279` at `4cb5a7c` failed a *different* test in
the same file the same way, and then the `afterEach` `rmSync` added
`EBUSY ... rmdir ...checkout-git-test-*\repo` on top because a git child was still exiting. Both
tests push to a bare remote, both pass in ~1.5s alone, and each run passed on the next push of an
almost identical commit — T310's section had logged the first one and explicitly asked for a filing
if it came back, so T396 is that filing. The file is already first in `test:unit:serial`, whose
`--no-file-parallelism` rules out sibling-file contention, which is why the answer is not
"serialise it" this time. Three amplifiers were ours and are removed rather than retried: git's own
background maintenance (`maintenance.auto` is on by default and can launch a repack behind any
push/commit) is now off for the whole suite via `GIT_CONFIG_COUNT`-style env config, which costs no
extra process and reaches the code under test because `spawnProcess` inherits `process.env`; the
`afterEach` retries a Windows handle-release race five times over 250ms and **still throws** if it
persists; and `server-tests (windows-latest)` now excludes `$RUNNER_TEMP`/`$GITHUB_WORKSPACE` from
Defender before the suite, echoing the resulting list so the log says whether it applied. That job
can no longer share the `*server_test_steps` YAML anchor with ubuntu — an anchor replaces a list, it
does not merge into one — so its steps are duplicated verbatim with a comment tying the two copies
together. `testTimeout` was deliberately left alone.


**Test-runner lessons that cost real time in this wave** (all now in the section above):
`npm test --workspace=@picompanion/web` resolves `@picompanion/frontend-core` through the workspace
symlink into `packages/frontend-core/dist`, so a worktree with no local `dist` silently exercises
the MAIN checkout's build — take main's `packages/frontend-core/src/composer` files AND rebuild the
package before believing a failure; the same trap makes two branches' independent edits to
`apps/web/src/features/composer/*` look compatible when they are not. Two Android filesystem-walking
tests (`apps/android/src/ui/theme/fonts.test.ts`, the Maestro citation contract) exceed their 5 s
budget whenever several suites run at once and pass alone — contention, not a defect, and the same
signature CLAUDE.md's T240 paragraph describes.

**Five new `CAPABILITIES` entries** were registered in `scripts/ci/guard-capability-prose.mjs`
(70 groups total): workspace checkpoint snapshots, transcript work groups, composer drafts and
references, Android's three Expo-backed stubs, and the rewind failure classification. Each was
proven able to fire by appending its denying sentence to `docs/legacy-retirement.md`, reading the
guard's `FAILED` line, and restoring the file from a scratchpad copy.

### Completion wave (2026-09-12): file explorer ops + nine audited gaps closed

Two user-visible audits (web, Android) found 9 end-to-end blockers; all are fixed on main
(`c8382dd` → `2a9ec98` → `42ccbeb` → `de32d36` → `e02d9c9`):

- **Remote file explorer ops** (`c8382dd`): scoped mkdir/create/rename/delete at every layer
  (protocol schemas, `DaemonClient` methods, jailed service fns, session handlers, web
  `FileOpsClient`, Android optional client members) + `docs/remote-file-explorer.md`. The
  `cwd` parameter IS the configurable root (pass `codebases/` as `cwd`). No external
  sidecar embedded: three research subagents agreed a sidecar means split auth + extra
  port, and every JS file-manager UI is DOM-only.
- **Extension actions dispatch** (`2a9ec98`): the only missing piece was the client sender;
  `DaemonClient.sendPiUiAction` + web/Android rail wiring closed the universal
  click-then-"Timed out" failure.
- **Web files correctness + nav** (`42ccbeb`): files route passes the real `agent.cwd`
  workspace root and a `resolveDirectHttpOrigin` download origin (null on relay
  by-design), shell links to files/terminal, terminal route lists/creates via the
  existing RPCs, settings placeholder removed, file-ops panel (mkdir/create/rename/
  delete with delete confirm) behind the `authorizeWorkspacePath` door.
- **Android picker/sharing/terminal** (`de32d36`): real `createExpoFilePicker` (T32S11's
  documented job), `createAndroidSharing` over installed expo-sharing/file-system,
  live terminal webview (react-native-webview + xterm). `package-lock.json -diff`
  keeps the lockfile out of diffs — its "Bin" display is that attribute, not damage.
- **Android file-ops UI** (`e02d9c9`): pure controller + screen section, two-step delete.

Left deliberately: relay-pair downloads (needs an HTTP-over-relay proxy in
`packages/relay` — architecture work, not a bug), and honest by-design states
(disabled auto-retry, attach-while-disconnected chip, mid-turn queue-mode revert,
display-only transcript attachments, the `app.paseo.sh` offer-URL placeholder which
matches the real offer format). Write subagents share the main tree here — `git add -p`
(or explicit path lists) per scope keeps their commits separable.

### Extension-coverage wave (2026-09-12/13): every Pi extension's UI is reachable in both apps

30 extensions inventoried (transports: 10 pi.ui kinds, pi_status, pi_widget,
pi_notice, pi_composer, permission_requested, slash-commands; TUI panes and
local channels have no remote path by design). Closed, each with green suites:
`status` placement both apps (`e714ff9`, minimal-status/plan-mode/pi-goal
surfaces); Android permission questions select/input/editor (parity with web
`PermissionDialog`, `d0132b2`, ask-user/vision-proxy/workflows/pi-goal
wizard); composer-kind accept fills the live draft both apps (`eced505` +
route composition); web screen/sheet/inline hosts + shared PiUiSessionProvider
+ nested panel>section>row ids (`7af7829`); daemon multi-hop row descent to
match (`960bcf9`, `findChild` generalized + 2 routing tests); Android files
route resolves the real cwd via `useAgentCwd`; file-download flow scrolls to
a below-fold error (proven by the run's own failure screenshot).

#lesson NEVER force-push main: dorny/paths-filter fetches `event.before` by
SHA with `--depth=1` when it is not an ancestor, which re-shallows the
`fetch-depth: 0` checkout and fails the history-dependent
`guard-format-check-per-commit` fixture in the `changes` job. Repair is a
normal follow-up push (whose `before` is a proper ancestor), never another
rewrite — this wave paid one red CI run (`34711902475`) learning it. The
per-commit format guard judges each commit's own content, so a red commit is
repaired by rebase+force-push ONLY when that is unavoidable (as with
`960bcf9`'s two unformatted files); prefer getting the format right before
the first push.

### beUI adoption proposal (2026-09-13): investigated, declined by owner

A goal proposed replacing the UI on `D:\ui-components` (beUI v2, MIT (c)
2026 Saurabh Chauhan, copy-source shadcn registry, React 19 + Tailwind v4 +
motion). Three read-only surveys killed it: (1) beUI is DOM-only with ZERO
React Native/Expo support, so it can only ever serve `apps/web`, never
Android; its library sources are Next-free and Vite-portable. (2) The repo
contains NO Beautiful UI code to remove — only extracted token values, all
components hand-written (`D:\beautiful-ui` is the beautifului.dev site
source, MIT (c) 2026 Shane Levine). (3) A full swap is ~220 files across two
platforms, invalidates the token output shapes, P3/P3.5 conformance work and
~12 guard/test contracts, with no ledger task proposing it. Owner chose
"stop, keep Beautiful UI" — plan §10 and the near-exact-match rule stand.
