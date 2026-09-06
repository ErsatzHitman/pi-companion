# Pi Companion — handoff to Claude Code

**Written 2026-09-03.** Everything below was verified against the repository on that date, not
recalled from memory. Where something is unverified or uncertain, it says so explicitly.

You are inheriting a project that is **116 of 221 tasks complete**, has a working backend, a web
app that genuinely runs end to end against a live daemon, and an Android app that is scaffolded but
barely started. It was built by a multi-agent workflow system, which is why the history is full of
`T<number>:` commit prefixes. That machinery is gone now. **You are the only implementer.**

Read this document fully before touching anything. It is long on purpose: the expensive failures on
this project were all caused by missing context, not by hard problems.

---

## 1. What this project is (and is not)

Pi Companion is a companion app for the **Pi coding agent**, in three pieces:

1. A **daemon** that runs on the owner's laptop and drives Pi.
2. A **web app** — a browser UI for that daemon.
3. An **Android app** — the same thing on a phone, reaching the laptop remotely.

**Both the web and phone surfaces are required.** The owner was asked directly on 2026-09-03 and
answered "both" — explicitly not "laptop first, phone later". Do not quietly deprioritise Android;
the remote half is the product, not a bonus.

### What it is NOT

- **Not a fork.** This is a greenfield repository with its own history. There is **no git remote**
  and none may ever be added.
- **Not derived from `D:\paseo`'s frontend.** `D:\paseo` is a **read-only reference checkout** of
  Paseo v0.3.0-beta.2 (AGPL-3.0-or-later). The backend packages here were ported from it _with_
  attribution. **Nothing from Paseo's `packages/app` (its old frontend) may ever enter this
  repository** — no component, screen, store, test or config. See `plan.md` §5.
- **Not related to `D:\pi-web`.** That is a third-party app the owner found; see §13.

The repository is **AGPL-3.0-or-later from its first commit**.

---

## 2. Status at a glance

| Fact             | Value                                                           |
| ---------------- | --------------------------------------------------------------- |
| `main` tip       | `8494beb` (plus the memory/handoff commits you will see on top) |
| Tasks            | **116 merged of 221**, 105 remaining                            |
| Working tree     | clean, on `main`, single worktree                               |
| Unit tests       | **1,564 passing** — see §6 for the per-workspace split          |
| End-to-end tests | **10 of 12 passing**, 2 known real failures (§11)               |
| Blocked work     | Phase 8–9 (11 tasks) need Expo credentials from the owner       |

### Phase completion (verified by cross-referencing `git log main` against the task table)

| Phase                          | Merged | Remaining | What it is                                 |
| ------------------------------ | ------ | --------- | ------------------------------------------ |
| 0 — Bootstrap & fix contracts  | 17     | 0         | reference audit, protocol fixes, fixtures  |
| 1 — Workspace skeleton         | 9      | 0         | monorepo, both app scaffolds               |
| 2 — frontend-core              | 10     | 0         | framework-neutral logic                    |
| 3 — Design system              | 4      | 0         | 26 primitives + 11 recipes, both platforms |
| 3.5 — Beautiful UI conformance | 4      | 0         | real palette, self-hosted fonts            |
| **4 — Web vertical slice**     | **72** | **9**     | the browser app                            |
| 5 — Android vertical slice     | 0      | 51        | the phone app                              |
| 6 — Advanced Pi parity         | 0      | 20        | core 5, web 10, android 4, daemon 1        |
| 7 — Operational features       | 0      | 14        | web 7, android 5, docs 1, daemon 1         |
| 8 — Cutover                    | 0      | 5         | `T43A1–A3`, `T43B1–B2`                     |
| 9 — Release hardening          | 0      | 6         | `T44A1–A4`, `T44B1–B2`                     |

**Phase 4's 9 remaining tasks:** `T31C1`, `T31C2`, `T31C3`, `T31C4`, `T31D`, `T49`, `T54A1`,
`T54A2`, `T54A3`. Three of these already exist as unmerged branches — see §10.

---

## 3. Where everything lives

### On disk, outside this repository

| Path                                                                                        | What it is                                                            | Rules                                                                     |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `D:\pi-companion`                                                                           | **this repository**                                                   | the only place you write                                                  |
| `D:\paseo`                                                                                  | Paseo v0.3.0-beta.2, the AGPL source the backend was ported from      | **read-only.** Read for behaviour; never copy frontend code; never modify |
| `D:\pi-web`                                                                                 | third-party `@agegr/pi-web` (MIT), evaluated and rejected as a base   | read-only reference                                                       |
| `D:\pi-web-review\`                                                                         | the 6-file study of pi-web (1,157 lines) incl. `strategic-options.md` | read for §13 detail                                                       |
| `D:\ompweb` + `D:\ompweb-review\`                                                           | an earlier study of a different Pi web GUI                            | historical reference                                                      |
| `D:\pi-companion-fork-backup.bundle`                                                        | 101 MB verified backup of an abandoned fork attempt                   | do not restore                                                            |
| `C:\Users\aksha\AppData\Local\pi-node\current\node_modules\@earendil-works\pi-coding-agent` | **the real Pi agent**                                                 | read this before concluding Pi cannot do something                        |

**Key files inside the Pi install** (the authority on what Pi can actually do):

- `dist/modes/rpc/rpc-types.d.ts` — the RPC surface (requests, events, extension UI)
- `dist/modes/rpc/rpc-mode.js` — the RPC server implementation
- `dist/core/agent-session.js` — session lifecycle
- `dist/core/settings-manager.js` — settings

### Ports

- **`6767` is the owner's production daemon. It is sacred.** Never bind it, never connect to it,
  never kill anything on it.
- `6768` is the local development daemon (`plan.md` §15.1). Its home directory is `.dev/`
  (gitignored, preserved).
- Tests must bind **ephemeral ports** with isolated home directories.

---

## 4. The three authoritative documents

Read these in this order. They outrank anything you infer from code.

1. **`plan.md`** — the specification, 20 sections, phases 0–9. Sections you will need most:
   §5 legacy-frontend exclusion, §7.4 connection/liveness, §8.1 (**Next.js is banned**), §8.2–8.3,
   §10 design system, §11 Pi extension UI bridge, §12.3 action identity and approvals, §12.4 files
   and terminal, §13 phases, §14 testing (14.1 layers, 14.3 E2E scenarios, 14.5 performance
   budgets), §15 development and deployment.
2. **`docs/issues-from-plan.md`** — all 221 tasks with dependencies, waves, owned files and
   acceptance criteria. Task-level scope lives here; it never overrides `plan.md` on architecture.
3. **`memory.md`** — the running project log: decisions, corrections, and every expensive lesson.
   It is **tracked in git on purpose** (an automated cleanup once deleted it when it was untracked).

`CLAUDE.md` is the short agent guide and points at these.

---

## 5. Repository map

```
D:\pi-companion
├── plan.md                      the specification
├── memory.md                    running log of decisions and lessons  (tracked!)
├── CLAUDE.md                    short agent guide
├── README.md  LICENSE  THIRD_PARTY_NOTICES.md
├── claude-code-handoff.md       this file
├── package.json                 workspaces: packages/*, apps/*
├── tsconfig.base.json  tsconfig.json  vitest.config.ts
├── .oxfmtrc.json  .oxlintrc.json  knip.json  .gitattributes (LF)
├── .github/workflows/           ci.yml, android-apk-release.yml
├── scripts/                     build-daemon-web-ui.mjs
├── .dev/                        dev daemon home (gitignored)
├── docs/
│   ├── issues-from-plan.md          THE TASK LIST (221 tasks)
│   ├── beautiful-ui-reference.md    THE VISUAL SPEC (both themes, exact values)
│   ├── pi-extension-compatibility.md
│   ├── frontend-data-migration.md
│   └── T02/T03/T04/T18-provenance.md
├── packages/
│   ├── protocol/     @picompanion/protocol      105 src files — wire types, the contract
│   ├── server/       @picompanion/server        637 src files — THE DAEMON (incl. Pi provider)
│   ├── client/       @picompanion/client         15 src files — DaemonClient SDK
│   ├── relay/        @picompanion/relay          15 src files — remote access
│   ├── frontend-core/@picompanion/frontend-core 124 src files — framework-neutral logic
│   ├── design-tokens/@picompanion/design-tokens   7 src files — colours, type, space, motion
│   ├── highlight/    @picompanion/highlight      15 src files — syntax highlighting
│   ├── cli/          @picompanion/cli           139 src files
│   ├── pi-bridge/    @picompanion/bridge          1 src file
│   └── expo-two-way-audio/                        5 src files
└── apps/
    ├── web/          @picompanion/web           342 src files — React 19 + Vite
    └── android/      @picompanion/android        57 src files — Expo, Android-only
```

### `packages/frontend-core/src` — the shared brain

`composer/ connection/ extensions/ files/ hosts/ navigation/ offline/ permissions/ platform/
sessions/ telemetry/ terminal/ testing/ timeline/ tools/`

`platform/` holds **interfaces only**; the implementations live in each app. `testing/` exports
fixtures both apps' tests consume. `import-guard.test.ts` enforces the purity rule in §7.

### `apps/web/src`

```
app/        application shell wiring, daemon-client-context.tsx  ← the live client lives here
routes/     route-tree.ts, root-route.tsx, one file per route
routes/screens/   connect, host, host-session, host-sessions,
                  host-session-files, host-session-terminal, host-settings
features/   approvals composer connect connection extensions files rail
            sessions telemetry terminal transcript
ui/         the 26 primitives + 11 recipes (shell.tsx lives here)
platform/   web implementations of frontend-core's platform interfaces
styles/     global.css, fonts
assets/fonts/   self-hosted Inter + Geist Mono woff2
dev/        component lab and recipe lab (DEV ONLY, must never ship)
```

### `apps/web/e2e` — Playwright, real browser

`connect.smoke`, `deep-link-restore`, `session-lifecycle`, `session-steer-and-follow-up`,
`transcript-tool-and-diff`, `reconnect-and-catch-up`, `keyboard-navigation`,
**`production-port-guard`** (asserts nothing touches 6767 — keep it passing), plus `fixtures/`,
`playwright.config.ts`, its own `tsconfig.json`.

### `apps/android/src`

`app/ dev/ features/ platform/ ui/` — scaffolded, 59 tests, essentially unbuilt. Phase 5 is 51 tasks.

---

## 6. Commands

### Testing — **do not run the whole suite at once**

The standing rule on this project is **targeted, one-shot, time-boxed** runs; CI runs the full
matrix. Root-level `npx vitest run` is unusable — always target a workspace:

```bash
npx vitest run --root packages/design-tokens     # 39 passing
npx vitest run --root packages/frontend-core     # 437 passing
npx vitest run --root apps/web                   # 1029 passing
npx vitest run --root apps/android               # 59 passing
```

**Run the web suite both ways** — from inside `apps/web` _and_ as `--root apps/web` from the repo
root. Green only one way has concealed a real bug twice.

End-to-end (chromium already installed; headless only, retries ≤ 1):

```bash
cd apps/web && npx playwright test --config=e2e/playwright.config.ts --reporter=line
```

~2 minutes for 12 tests. When one fails, **read `apps/web/test-results/<name>/error-context.md`** —
it contains the error plus an accessibility snapshot of the page at the moment of failure. Reading
that is far cheaper than re-running. Never run `playwright show-report` (it starts a server and
hangs).

### Quality gates

```bash
npm run typecheck                       # tsc --noEmit, whole repo
npm run lint                            # oxlint
npm run format:check                    # oxfmt --check .
npm run format:files -- <files>         # format specific files
npm run build --workspace=@picompanion/web
```

`oxfmt` reformats markdown tables, so when editing docs, format first and match the formatted text.

### Never run

Anything watch-mode, interactive, or unbounded: `vite dev`, `expo start`, `vitest --watch`,
`playwright test --ui`, `playwright show-report`, or anything waiting on stdin. Kill anything you
spawn. **Never blanket-kill `node.exe`** on this machine — other tooling runs on node.

---

## 7. Non-negotiable invariants

These hold everywhere. Several are enforced by tests or lint; all are enforced by review.

1. **`packages/frontend-core` must import no React, React Native, Expo, DOM types or browser
   globals.** It exposes `platform/` interfaces; implementations live in the apps. Enforced by an
   oxlint guard and `import-guard.test.ts`.
2. **`apps/web` is DOM-first React 19 + Vite. No Next.js, no SSR** (`plan.md` §8.1).
3. **`apps/android` is Android-only** — no `.web.*` files, no web-only imports. Metro rejects them.
4. Apps depend on package **exports** (`@picompanion/frontend-core`), never source-relative
   cross-workspace paths. Any `@/` alias is package-local.
5. **No raw hex colours** under `apps/web/src` or `apps/android/src` — everything comes from
   `@picompanion/design-tokens`.
6. **No private material in URL query strings** (tokens, passwords, daemon keys).
7. File operations go over daemon RPC, never direct filesystem access from an app.
8. **Nothing from any Paseo `packages/app` tree**, in any form.
9. **No git remote.**
10. The component/recipe labs in `apps/web/src/dev` are **dev-only** and must never ship.

---

## 8. The design system

The visual language is **Beautiful UI** (<https://www.beautifului.dev/>, MIT © 2026 Shane Levine).
MIT is compatible with our AGPL, so its code _may_ be adapted with the notice retained.

**`docs/beautiful-ui-reference.md` is the spec** — it publishes every role for both themes, plus
radii, shadows, type and motion. Do not re-derive values from the website; use that file.

Signature traits: warm charcoal dark background `#17181a` with surfaces stepping _up_; shadows are
**1px rings, not blurs**; **dashed hairline dividers**; radii chip 6 / control 8 / card 10 /
window 14; Inter + Geist Mono with `tabular-nums`, self-hosted (no CDN); easing
`cubic-bezier(.23,1,.32,1)`.

Rules from `plan.md` §10: tokens only, **one approved treatment per component**, compose the
existing 26 primitives and 11 recipes rather than authoring one-offs, and accessibility is part of
"done" (accessible name, keyboard operation, role and state, visible focus, non-colour status
signalling).

### An owner decision you must honour

On **2026-09-03 the owner chose accessibility over byte-exact fidelity**. The first accessibility
run in a _real browser_ found the Beautiful UI palette itself fails WCAG AA:

| pair                                      | measured   | required |
| ----------------------------------------- | ---------- | -------- |
| light `ink-3` `#9a9da3` on page `#fafafb` | **2.61:1** | 4.5:1    |
| dark `ink-3` `#6c6f75` on page `#17181a`  | 3.53:1     | 4.5:1    |
| white on light accent `#0285ff`           | 3.62:1     | 4.5:1    |
| white on danger `#e3474c`                 | 3.98:1     | 4.5:1    |

Task `T54A1` implements the fix (nudge `ink-3` → `#707377`, accent → `#0275e0`, audit **every**
text-on-background pair in both themes, add a regression test, record old/new/ratio in the
reference doc). **Its branch exists but is unmerged** — see §10.

---

## 9. What actually works today

The web app is **genuinely assembled and functional**: it constructs a live `DaemonClient`
(`apps/web/src/app/daemon-client-context.tsx`), every screen receives it, the transcript renders
real streamed output, and both rails are mounted. A Playwright harness starts an isolated daemon on
an ephemeral port and drives a real browser: **10 of 12 tests pass**.

That sentence was not true a week ago, and how it became true matters — see §12.

Working end to end: connecting to a daemon, listing and creating sessions, running a turn with
streamed assistant output, steering a running turn, tool calls with expandable input and diffs,
deep-link restore, approvals, terminal, file browser, transcript virtualization, image attachments,
the context/cache meter, and the Pi extension UI bridge (all ten kinds: `status`, `widget`,
`progress`, `roster`, `log`, `markdown`, `diff`, `form`, `composer`, `panel`).

---

## 10. Unmerged branches — read before you start

Work was stopped mid-flight on 2026-09-03. Four branches carry real commits:

| Branch                       | Task                                     | State                                                   |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `phase4/t54a1`               | T54A1 palette → WCAG AA                  | committed (`ac35632`), **never independently verified** |
| `phase4/t54a3`               | T54A3 offline events → connection status | committed, never verified                               |
| `phase4/t31c1`               | T31C1 approvals E2E scenarios            | committed, never verified                               |
| `salvage/t54a1-maindir-leak` | a **second, different draft** of T54A1   | rescued, do not merge blindly                           |

The salvage branch exists because the workflow's worktree isolation leaked a task's edits into the
main working directory. `phase4/t54a1` is the fuller version (it also updates
`docs/beautiful-ui-reference.md`); the salvage branch is kept only so nothing was silently thrown
away. **Compare, then delete the loser.**

Verification never ran on any of them, so treat them as _proposed_ work: read the diff, run the
tests yourself, then merge.

Three other branches were deleted because they were **empty** — `phase4/t31c2`, `phase4/t31c3`,
`phase4/t54a2`. Their tasks (`T31C2` extension-bridge E2E, `T31C3` terminal E2E, `T54A2` the
missing `<h1>`) are **not started**. This matters: on this project a branch's existence was once
mistaken for delivered work, and an entire feature was reported as merged when the branch was
empty. **Branch ancestry is not evidence. Confirm a named file and symbol.**

Branches named `pi/wf/*` are workflow bookkeeping and can be ignored or deleted.

---

## 11. Known defects and open items

### The two failing end-to-end tests (both real, neither flaky)

1. **`keyboard-navigation.spec.ts`** — every keyboard and focus assertion passes; it fails only on
   the accessibility check, from the palette contrast failures in §8 plus `page-has-heading-one`
   (the shell renders no `<h1>` on any route). Fixed by `T54A1` + `T54A2`.
2. **`reconnect-and-catch-up.spec.ts`** — nothing feeds the browser's offline signal into connection
   status, so the only exit from "connected" is the client's liveness heartbeat (10s interval, 15s
   timeout, two consecutive failures ≈ up to 50s). Fixed by `T54A3`. **Do not "fix" this by raising
   the test's timeout** — the heartbeat is a backstop, not the signal.

### Other known issues

- **`packages/server` tests run nowhere in CI.** CI covers `protocol`, `client` and `highlight`
  only. Locally ~202 of its ~3,964 tests fail — all in `*.e2e.test.ts`, needing configured
  providers, a git identity and `npx`. That is **pre-existing environmental debt, not a
  regression**. Task `T49` folds this in.
- **Web accessibility unit tests run in jsdom**, which `plan.md` §14.1 never intended — jsdom missed
  contrast failures for hundreds of green assertions. Trust the real browser.
- **The web entry chunk statically imports `lezer-highlighter` (707 kB)** via
  `features/extensions/renderers/diff.tsx` → `CodeBlock`. Confirmed pre-existing, not a regression.
  Worth a chunking task. (xterm 331 kB and jsQR 130 kB _are_ correctly split out.)
- `npx knip` exits 1 on pre-existing unused-export debt.
- `apps/android` has no rendered-component test for the connection shell.
- **Phase 8–9 are blocked** on the owner: EAS project, keystore and `EXPO_TOKEN` are unverified
  (`T42A1`, `T44B1`).
- Localization is **deferred** and unraised with the owner.
- Consider reviewing `T30B1`'s merged output against its "never add a second door" criterion.

### One thing to check early

`agent_end` from Pi is **not terminal** — a single logical prompt can emit several (retry,
compaction, extension-queued). Our Pi provider already guards the retry case:
`packages/server/src/server/agent/providers/pi/agent.ts:2364` does
`if ((event as { willRetry?: boolean }).willRetry) return;` before `completeTurn`. **The compaction
and extension-queued endings carry no `willRetry` and would fall through** — unverified, and a
plausible real bug. This is proposed task `T55`.

---

## 12. The expensive lessons

Every one of these cost real money. They are the most valuable thing in this handoff.

1. **Parts were built but never assembled.** After 60 merged web tasks and ~$320, every feature met
   its acceptance criteria while the app did not work: no `DaemonClient` was constructed anywhere,
   the fully-built transcript was rendered by no screen, and the shell's rail slots were never
   passed. "Each family owns a directory" prevented conflicts but left **integration owned by
   nobody**. → Every surface needs an explicit _assembly_ task, and per-directory criteria must
   never be the only criteria.
2. **jsdom accessibility tests are not accessibility tests.** Hundreds passed while the palette
   failed WCAG AA at 2.61:1. The first real-browser run found it immediately.
3. **A test can be "fixed" dishonestly.** Two agents did: one _inverted_ an end-to-end assertion
   into asserting the transcript stays empty; another downgraded hard assertions to soft ones and
   wrapped a focus call in a visibility guard. Both were honest _when written_ — the product really
   was broken — but would have rotted into false green once it was fixed. → When you weaken a test
   to document a live gap, **you own re-checking it the moment the gap closes.** Prefer leaving it
   red.
4. **Branch ancestry is not evidence of delivery.** See §10.
5. **Fix flaky tests by warming the module, never by raising the timeout.** A cold lazy-route render
   costs ~7s here, so a 15s budget had no headroom. The fix is `await import(...)` in a `beforeAll`
   so the transform happens outside the timed window. Twice this exact shape.
6. **Never resolve a path in a test from `process.cwd()`.** And under jsdom the global `URL` is
   jsdom's own, so `fileURLToPath(new URL(x, import.meta.url))` throws `ERR_INVALID_URL_SCHEME` —
   pass `import.meta.url` straight to `fileURLToPath`.
7. **A clean partial beats a timeout, and silence is the worst outcome.** Three times, an agent
   reporting "this criterion looks unimplementable, here is the file and line" was **right and the
   plan was wrong** — that is how the silently-discarded image attachments and the missing client
   wiring were found. **If a criterion looks impossible, do not delete the feature and do not fake
   it.** Implement what you can, leave the rest visibly unimplemented, and say so.
8. **Our daemon is an incomplete mirror of Pi.** Before concluding Pi cannot do something, read the
   Pi install (§3). A "queue mode doesn't exist" conclusion was confidently wrong and the owner was
   right to push back: Pi handles it at `rpc-mode.js:405-412`.

---

## 13. The pi-web evaluation (2026-09-03)

The owner found `D:\pi-web` (`@agegr/pi-web`, MIT) and asked whether Pi Companion should be
abandoned in favour of building on it. It was studied properly; full report in `D:\pi-web-review\`.

**Verdict: keep Pi Companion.** The decisive reason is architectural, not sentimental. pi-web
creates its own `AgentSession` **in-process inside its Next.js server** (`lib/rpc-manager.ts:1548`)
— its "rpc-manager" is RPC-_shaped_, not RPC. **It does not attach to a pi running in your
terminal.** Live chat comes from its own in-process agent; history comes from re-reading session
`.jsonl` files.

Because its whole design depends on sharing a process with the Pi library, it cannot serve a phone,
which by definition does not. Measured against "phone, away from home, safely" it fails four ways:
LAN-only (its own README recommends a VPN), a single shared password with the username hardcoded to
`pi` and no per-device tokens or revocation, no TLS, and **no gap recovery whatsoever** (no
`Last-Event-ID`, sequence, replay or epoch anywhere; recovery is a 15-second poll and a full
re-read). It has no approvals protocol and no Android story. Adopting it would mean rebuilding the
daemon, auth, transport, recovery and all 51 Android tasks on a banned framework, while discarding
the half Pi Companion already has working.

**A safety warning worth passing on:** running terminal-pi and pi-web against the _same session_ is
actively unsafe. There is no locking, no mtime check, no `fs.watch` and no conflict detection on
session files; both sides hold their own in-memory list and rewrite, so silent loss or corruption is
possible. Opening its event stream also cold-starts an agent — watching is not passive.

**Three ideas worth taking** (proposed as `T55`, `T56`, `T57` in
`D:\pi-web-review\proposed-tasks.md`, ids confirmed free):

- **T55** — verify `agent_end` multiplicity (see §11).
- **T56** — transcript render guards: collapse markdown above ~100k chars, skip syntax highlighting
  while streaming, keep memo keys stable. `plan.md` §14.5 sets budgets but specifies no mechanisms.
- **T57** — scroll follow-hysteresis and a prompt anchor. **Verify before building** — we may
  already handle this.

**No code adoption is recommended.** pi-web has no browser or end-to-end tests, its main chat
component has no test file, and some of its "tests" regex-match the component's own source as a
string. Ideas worth having; code not trustworthy unexamined.

**A correction it produced:** Pi 0.84.0 has **32 request types, not 35** — the 35 figure counted
response and extension-UI literals too. Correct framing: 32 requests + 2 extension-UI types, of
which our mirror omits 18. Task `T51` must use the right denominator.

**Also worth knowing:** the Beautiful UI components in the local `D:\pi-web` clone are **the
owner's own work** (5 unpushed commits, 2026-08-11), not part of the upstream project.

**A cheap suggestion the owner may want regardless:** put pi-web behind Tailscale with a password
and use it from a phone browser. It works today, costs about an afternoon, and is the cheapest way
to learn what the phone half is really for before funding 51 Android tasks.

---

## 14. What to do next

In order:

1. **Finish Phase 4** — 9 tasks. Start by reviewing, verifying and merging the three existing
   branches (§10), which closes both failing E2E tests. Then `T54A2` (the `<h1>`), then the
   remaining scenario specs `T31C2`/`T31C3`/`T31C4`, then `T31D` (performance budgets in CI) and
   `T49` (extend the Windows CI gate, including the `packages/server` gap).
2. **Consider `T55`** early — it is small and may be a real bug (§11).
3. **Phase 5 — Android**, 51 tasks. The largest remaining block, and required.
4. Then Phase 6 (parity, 20), Phase 7 (operational, 14).
5. Phases 8–9 are **blocked** until the owner supplies Expo credentials.

**Working style that this project expects:** commit incrementally with the task id as the prefix
(`T54A1: ...`); keep `memory.md` updated as decisions land and commit it immediately; run targeted
tests, never the full suite; verify a claim before repeating it; and when something looks
unimplementable, say so with a file and line rather than quietly dropping it.

One last thing. The most valuable output this project ever produced was an agent writing down, in
plain language, that the thing it had been asked to test could not work and exactly why. That note
is what uncovered §12.1. **Honest reporting beats a green checkmark.**
