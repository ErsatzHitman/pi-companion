# Retiring the legacy Paseo install (T43B2a)

This document is for the owner. It explains what the legacy Paseo daemon (the
one still running against `$PASEO_HOME` from the `D:\paseo` reference
checkout) provided, what in **this** repository now provides each piece, the
exact steps to cut over, and — first, because it matters more — exactly how
to go back if the new install turns out to be missing something.

**Read the safety statement in §0 below before running anything in this
document.**

Nothing in this document is a claim that the cutover has already happened on
the owner's machine. It is the written procedure T43B2a's acceptance
criteria require; T43B2a itself only produced this document and confirmed
what §2 below describes from the repository, offline. Running the cutover,
and deciding when to stop running the legacy daemon, are the owner's
actions.

## 0. Safety statement — read this first

- **`$PASEO_HOME` (default `~/.paseo`, or wherever the owner's `PASEO_HOME`
  environment variable points) is the owner's live data.** No command in
  this document writes to it, moves it, or deletes anything under it. The
  verification procedure in §4 explicitly operates on a **copy**, never the
  original.
- **The production daemon on port `6767` is never stopped, rebound, or
  connected to by any step in this document.** Every check T43B2a itself ran
  was performed offline, from the repository, against build output on disk
  — never against a live process. The one live check this document describes
  (§4) is written as a procedure for the _owner_ to run by hand, later, on
  their own schedule, against a copy of their data, on a scratch port that
  is neither `6767` nor `6768` (the dev daemon port — see `CLAUDE.md`
  "Working locally").
- Retiring the legacy install means the owner stops _relying on_ the
  `D:\paseo` checkout for daily use once §4 succeeds. It does not mean
  deleting `D:\paseo`, `$PASEO_HOME`, or any data. Nothing is deleted by
  this task or by following this document.

## 1. What the legacy install provided, and what replaces it

One row per capability the owner's `D:\paseo` daemon install provides today,
and the file or package in this repository that now provides the same
capability.

| Capability                                              | Legacy install (`D:\paseo`)                                                  | This repository                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon process (auth, WS/HTTP API, agent runs)          | `packages/server` (Paseo `v0.3.0-beta.2`)                                    | `packages/server` (`@picompanion/server`) — ported under AGPL-3.0-or-later, see `THIRD_PARTY_NOTICES.md` and `docs/T04-provenance.md`                                                                                                                    |
| `$PASEO_HOME` resolution (`~/.paseo` default)           | `packages/server/src/server/paseo-home.ts` (reference)                       | `packages/server/src/server/paseo-home.ts` — **same resolution rule, same default path**, so the new daemon reads the owner's existing data with no migration step                                                                                       |
| Config, password, relay-key storage                     | `packages/server/src/server/persisted-config.ts`, `auth.ts` (reference)      | `packages/server/src/server/persisted-config.ts`, `auth.ts`                                                                                                                                                                                              |
| Web UI served by the daemon                             | Paseo's old frontend (`packages/app`, Pi UI renderer + Beautiful components) | `apps/web` (DOM-first React + Vite), bundled into the daemon by `scripts/build-daemon-web-ui.mjs` into `packages/server/dist/server/web-ui/`, served when enabled (see §2) — **never** built from anything in Paseo's `packages/app` tree (`plan.md` §5) |
| Enabling/disabling the bundled web UI                   | `PASEO_WEB_UI_ENABLED`, `PASEO_WEB_UI_DIST_DIR`, `--web-ui` / `--no-web-ui`  | Same env vars and CLI flags, unchanged — `packages/server/src/server/config.ts`'s `resolveWebUiConfig`, `packages/cli/src/commands/daemon/start.ts`                                                                                                      |
| CLI (`paseo` command: start/stop daemon, agent control) | `packages/cli`                                                               | `packages/cli` (`@picompanion/cli`), same `paseo` bin name (`packages/cli/package.json`)                                                                                                                                                                 |
| Relay (remote pairing/tunnelling)                       | `packages/relay`                                                             | `packages/relay` (`@picompanion/relay`)                                                                                                                                                                                                                  |
| Pi provider / Pi UI bridge                              | `packages/server`'s Pi provider, `packages/pi-bridge`                        | `packages/server/src/server/agent/providers/pi/`, `packages/pi-bridge` (`@picompanion/pi-bridge`)                                                                                                                                                        |
| Syntax highlighting (server + CLI)                      | `packages/highlight`                                                         | `packages/highlight` (`@picompanion/highlight`)                                                                                                                                                                                                          |
| Native two-way audio (Android)                          | `packages/expo-two-way-audio`                                                | `packages/expo-two-way-audio` (`@picompanion/expo-two-way-audio`) — module ported; see §5, it has no working Android app to mount into yet                                                                                                               |
| Mobile client app                                       | Paseo's Expo Router app (`packages/app`)                                     | `apps/android` — **new, blank-scaffold app; see §5, not a drop-in replacement yet**                                                                                                                                                                      |

Every "this repository" package above is either a from-scratch new app
(`apps/web`, `apps/android`, `packages/frontend-core`) or a ported backend
package with recorded AGPL provenance (`docs/T0*-provenance.md`,
`THIRD_PARTY_NOTICES.md`, re-confirmed current as of T43B1, `b420806`).
Nothing from Paseo's `packages/app` tree is present in any row on the right
(`plan.md` §5; verified again in §2 below).

## 2. What T43B2a verified offline, and exactly how

All of this was run from the repository, on the machine this session is on,
never against the owner's running daemon or `$PASEO_HOME`.

### 2.1 The packaged daemon actually contains the new web app, not the old one

```bash
npm run build --workspace=@picompanion/protocol
npm run build --workspace=@picompanion/design-tokens
npm run build --workspace=@picompanion/frontend-core
npm run build --workspace=@picompanion/web
node scripts/build-daemon-web-ui.mjs --skip-build
npm pack --dry-run --ignore-scripts --workspace=@picompanion/server
```

Result: `npm pack` reported **793 files**, package size **7.1 MB**,
unpacked **12.0 MB**, and the listing includes `dist/server/web-ui/index.html`
plus 175 other `dist/server/web-ui/**` entries (176 total under that
directory: compressed `.br`/`.gz` variants and source maps included) — the
built `apps/web` output, not a placeholder. This is exactly what T43A1's
acceptance criterion ("a daemon package dry-run contains the new web app")
and T171's `guard-daemon-web-ui-bundled` CI check assert on every push; this
task re-ran the same shape by hand and read the file list rather than
trusting the exit code alone.

### 2.2 No packaging path still references the legacy bundle

```bash
rg -n "packages/app" .
```

Classified every hit outside the reference-only docs `CLAUDE.md` already
lists (`docs/T0*-provenance.md`, `THIRD_PARTY_NOTICES.md`,
`docs/frontend-data-migration.md`, `docs/pi-extension-compatibility.md`,
`docs/issues-from-plan.md`):

- `packaging/docker/Dockerfile:8`, `packaging/nix/flake.nix:7` — prose
  explaining the exclusion boundary (plan.md §5), not a path reference.
- `scripts/build-daemon-web-ui.mjs:7` — a comment documenting that this
  script's source is `apps/web/dist`, _unlike_ the reference script's
  `packages/app/dist` — again prose about the exclusion, not a live path.
- `scripts/ci/guard-no-legacy-app-tree.mjs`, `guard-docker-packaging-paths.mjs`
  and their `*.test.mjs` files — this is the **guard implementation** that
  detects a `packages/app` path or `@getpaseo/*` import if one ever
  reappears, plus its test fixtures (seeded strings the tests assert the
  guard catches). None of these are packaging inputs.
- `packages/protocol/src/messages.workspaces.test.ts`,
  `messages.pull-request-timeline.test.ts` — unrelated fixture data (a
  sample workspace directory path and a sample PR-diff file path used to
  exercise protocol message schemas), not packaging or bundling code.

**No hit is a real packaging reference to the legacy bundle.** Confirmed
separately by reading the actual packaging inputs directly:

```bash
grep -n "COPY\|apps/web\|packages/app" packaging/docker/Dockerfile packaging/nix/flake.nix
```

Both files' real `COPY apps/web/dist` / build commands reference `apps/web`
only; the only `packages/app` lines in either file are the plan.md §5
exclusion comments quoted above.

### 2.3 The four gates T43B2a owns

Run in the foreground, once each, from a clean tree (`git status --porcelain`
empty before and after every command below):

| Gate                                                                                                                                                 | Command                                              | Result                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Import-graph orphan ceiling (this repository's knip replacement — see `CLAUDE.md` "Do not trust knip", and `scripts/ci/orphan-modules.mjs`'s header) | `node scripts/ci/run-orphan-modules.mjs`             | `26 orphan module(s) (ceiling 27)` — exit 0                                                                                                                                                                                          |
| Typecheck                                                                                                                                            | `npm run typecheck --workspaces --if-present`        | Exit 2 from exactly **17** `TS2307: Cannot find module 'expo-router'` errors under `apps/android`, and nothing else — this is the documented, owner-blocked `expo-router` gap (T116: declared but never installed), not a new defect |
| Format                                                                                                                                               | `npm run format:check` (root `oxfmt 0.46.0`, pinned) | `All matched files use the correct format.` — 2369 files, exit 0                                                                                                                                                                     |
| Lint                                                                                                                                                 | `npm run lint`                                       | `Found 8 warnings and 0 errors.` — 2197 files, exit 0                                                                                                                                                                                |
| Targeted CI-guard unit tests                                                                                                                         | `node --test scripts/ci/*.test.mjs`                  | `# tests 394` / `# pass 394` / `# fail 0` — exit 0, matching the documented 394/394 baseline                                                                                                                                         |

**Why `npx knip` itself is not one of these gates, and not wired into CI:**
run directly, `npx knip` exits **1** with ~2600 lines of output dominated by
exactly the false-positive shapes `CLAUDE.md`'s "Do not trust knip" section
already catalogues for this repository — worker/CLI entry scripts it can't
see are real entries, default+named export pairs on nearly every
`apps/web`/`apps/android` component it reports as "duplicate exports", and
so on. This is not a new finding; it is the same signal that led T125 to
build `scripts/ci/orphan-modules.mjs` as a deliberately more careful
import-graph walker (six catalogued over/under-reporting modes, each with a
regression test) and wire _that_ into CI (`guard-orphan-modules`,
unconditional job in `.github/workflows/ci.yml`) instead of `npx knip`. That
guard is what this document treats as "knip, passing" above, per the task
brief's own allowance ("or the repository's knip script if one is wired").
Wiring bare `npx knip` as a second, blocking CI job on top of it would only
reintroduce the noise the repository already moved away from — filed here
as a considered non-action, not an oversight.

**Typecheck, format, and lint were already wired in CI before this task**
(`.github/workflows/ci.yml`'s `typecheck`, `format`, and `lint` jobs — all
unconditional or `full`-gated, none behind a path filter this task needed to
widen). **`guard-orphan-modules` was already wired** (T125, unconditional
job). **Nothing was added to CI by this task** — all four static gates, and
the targeted `scripts/ci/*.test.mjs` suite, were already exercised on every
push; T43B2a's job here was to run them, read the real output, and write
this document, not to wire anything new.

## 3. What this task did **not**, and could not, verify

The third acceptance criterion — "the legacy install is no longer needed for
daily use" — cannot be fully proven from this machine, because proving it
for real means running the new daemon against the owner's actual data and
actually using it. This task proved everything that can be proven **without**
touching `$PASEO_HOME` or the production daemon (§2 above: package contents,
the absence of any legacy-bundle reference, config resolution reading the
same `$PASEO_HOME` path, and the four static gates). It did **not** run the
new daemon, did not open the bundled web UI in a browser, and did not
exercise a real agent session against it. That is §4 below, written as a
procedure for the owner — **not something this task claims already happened.**

## 4. Owner verification procedure (under 10 minutes, against a COPY of `$PASEO_HOME`)

Run this once, when ready to judge whether the new build covers daily use.
It never touches the real `$PASEO_HOME` or the port-`6767` daemon.

1. **Find your real `$PASEO_HOME`.** If you have not set `PASEO_HOME`
   yourself, it is `~/.paseo`. Do not `cd` into it or modify anything in it
   in the steps below — you are about to copy it, read-only.
2. **Copy it, never touch the original:**

   ```bash
   cp -r ~/.paseo /tmp/paseo-home-verify-copy   # or wherever $PASEO_HOME points
   ```

   (Windows PowerShell: `Copy-Item -Recurse $HOME\.paseo $env:TEMP\paseo-home-verify-copy`.)

3. **Build this repository's daemon package and its bundled web UI**, from
   the repository root:

   ```bash
   npm run build --workspace=@picompanion/protocol
   npm run build --workspace=@picompanion/design-tokens
   npm run build --workspace=@picompanion/frontend-core
   npm run build --workspace=@picompanion/web
   npm run build:daemon-web-ui
   npm run build:clean --workspace=@picompanion/server
   npm run build --workspace=@picompanion/cli
   ```

4. **Start the new daemon against the COPY, on a scratch port — never `6767`
   or `6768`:**

   ```bash
   node packages/cli/bin/paseo daemon start \
     --foreground --web-ui \
     --home /tmp/paseo-home-verify-copy \
     --port 6769
   ```

   (Substitute your copy's path from step 2. `6769` is a scratch port
   chosen only for this check — pick any free port that is not `6767`
   or `6768`.)

5. **Open `http://127.0.0.1:6769` in a browser.** Confirm the bundled
   `apps/web` UI loads, shows your copied agents/sessions list (proving it
   read the copied `$PASEO_HOME` correctly), and that you can open an
   existing session's transcript.
6. **Start (or resume) one real agent turn** through the UI, using a
   throwaway workspace/project you don't mind an agent touching, to confirm
   the daemon's agent-run path works end to end against this build.
7. **Stop the daemon** (`Ctrl+C` in the foreground terminal, or
   `node packages/cli/bin/paseo daemon stop --home /tmp/paseo-home-verify-copy`)
   and delete the scratch copy:

   ```bash
   rm -rf /tmp/paseo-home-verify-copy
   ```

If steps 5-6 work as expected against the copy, the new install covers the
data and daemon behavior the legacy install provides for daily use, and the
legacy `D:\paseo` daemon can be stopped per §6 below. If anything is
missing or behaves differently, **do not proceed to §6** — the legacy
install stays the daily driver; file what broke against the row in §1 it
maps to (or, if it maps to nothing in §1, that is a real gap in this
repository, not in this document).

## 5. What is NOT retired by this task

- **The Android mobile app.** `apps/android` cannot yet ship a working
  build: `expo-router` is declared in `apps/android/package.json` but was
  never installed (T116, `npm install` for it is refused by this
  environment's permission classifier) — the 17 `TS2307` typecheck errors
  in §2.3's table are that gap surfacing at typecheck time, not a new
  regression. Until that is resolved, any daily mobile use still depends on
  the legacy install's Android app.
- **The two suites that prove the packaged build under real conditions**:
  the web E2E suite against the packaged, daemon-served UI, and the Android
  smoke flow against a packaged app. These are explicitly **T43B2b's**
  scope (next wave, depends on this task) — this task's static gates (§2.3)
  do not exercise a real browser or a real emulator, by design (see this
  task's brief and `CLAUDE.md` "Working locally": no interactive/long-running
  verification here).
- **Public reachability.** `T59` (deploying the daemon behind TLS on a
  public VPS) has not happened. Today, both the legacy and the new daemon
  are reachable only on the owner's laptop (loopback / LAN), so retiring the
  legacy install does not change how the daemon is reached from outside the
  laptop.
- **`$PASEO_HOME` itself.** Nothing about this task, or about running the
  cutover in §6, migrates, converts, or deletes any file under
  `$PASEO_HOME`. The new daemon reads the exact same directory the legacy
  daemon reads (`packages/server/src/server/paseo-home.ts`'s resolution
  rule is unchanged from the reference), so there is nothing to migrate.
- **AGPL provenance and third-party notices** are T43B1's scope, already
  re-verified at `b420806` (`rg "packages/app"` finds only reference notes,
  every dependency has a recorded license) — this document does not repeat
  that audit, only cites its result.

## 6. Cutover steps (only after §4 has passed)

Do these in order. Each is reversible; see §7 (below) for the undo of each
numbered step here, in the same order.

1. Run the owner verification procedure in §4 in full, and confirm both
   steps 5 and 6 there worked as expected. Do not proceed if they did not.
2. Stop relying on the `D:\paseo` daemon for new work: stop starting it for
   fresh sessions. **Do not delete `D:\paseo`, and do not stop a daemon
   instance that is mid-session on real work** — let any in-flight agent
   run finish or be cleanly stopped through its own UI/CLI first, the same
   way you would with any daemon restart.
3. Build and start this repository's daemon against the **real**
   `$PASEO_HOME`, on the **production** port, replacing the legacy process
   in that role:

   ```bash
   npm run build:clean --workspace=@picompanion/server
   npm run build --workspace=@picompanion/cli
   node packages/cli/bin/paseo daemon start --web-ui
   # uses $PASEO_HOME (or ~/.paseo) and port 6767 by default — the same
   # home directory and port the legacy daemon used.
   ```

4. Point your usual entry point (browser bookmark to `http://localhost:6767`,
   or the Android app once T43B2b/its own release pipeline exists) at this
   daemon. Confirm your real session list and agents appear (they will —
   it is the same `$PASEO_HOME`), and use it for a day before considering
   the legacy install retired.
5. Once satisfied, stop starting the legacy `D:\paseo` daemon going forward.
   Keep the `D:\paseo` checkout on disk — it remains the read-only reference
   this repository's `CLAUDE.md` says to consult for undocumented behavior,
   and it is your fallback (§7).

## 7. Undo — how to go back to the legacy install

Written before the cutover steps above, at the same level of detail, because
the reader most likely to need this is reading it under pressure, with the
new daemon already misbehaving.

**What would tell you that you need this:** the new daemon fails to start
against your real `$PASEO_HOME`; it starts but a session, agent, or
attachment that worked under the legacy daemon errors, hangs, or shows data
that doesn't match what the legacy web UI showed for the same
`$PASEO_HOME`; or any behavior in §1's capability table that the legacy
install had and the new one visibly does not.

To go back:

1. **Stop the new daemon.** If you started it in the foreground
   (`--foreground`), `Ctrl+C`. If you started it detached
   (`paseo daemon start` without `--foreground`), stop it the same way you
   would stop any local daemon started by this CLI —
   `node packages/cli/bin/paseo daemon stop`, or your platform's normal
   process-stop for the PID the start command printed.
2. **Do nothing to `$PASEO_HOME`.** Both daemons resolve the exact same
   directory with the same rule (`paseo-home.ts`, unchanged from the
   reference), and this repository's `packages/server` is a direct port of
   the code that reads and writes that directory's on-disk format, not a
   reimplementation with a different schema — so there is nothing to
   convert or revert here. (This is a claim about the ported code, not a
   live-data test this task ran; §4's procedure, run against a copy, is
   exactly what confirms it for the owner's own data before any real
   cutover.)
3. **Start the legacy daemon again**, the same way you started it before
   this task (`npm start` / whatever your existing process is under
   `D:\paseo`, on port `6767`). It will read the same `$PASEO_HOME` and
   pick up anything the new daemon wrote while you were using it, for the
   same reason as step 2 — nothing done by the new daemon should be
   invisible to the old one.
4. **Report what broke.** Note the exact §1 row (or, if nothing in §1
   matches, describe the gap directly) so the failure is a filed,
   named gap rather than a repeated surprise the next time someone attempts
   this cutover.

The legacy install is not deleted, disabled, or made harder to run by any
step in §6 above — cutover only changes which daemon you start by habit, and
this undo is exactly "start the other one instead."

## 8. Traceability

- `plan.md` §5 (legacy frontend policy), §15 (development and deployment),
  §16 (security and privacy)
- `docs/issues-from-plan.md`: T43A1, T43A2, T43A3 (the packaging path this
  document retires the legacy install in favor of), T43B1 (provenance
  re-verification this document cites), T43B2a (this task), T43B2b (the
  slow-suite gate this document explicitly defers)
- `THIRD_PARTY_NOTICES.md`, `docs/T0*-provenance.md` (AGPL attribution for
  every ported package named in §1's right-hand column)
- Measured at `3cc8382` (`git rev-parse HEAD`, T193's commit — the last
  commit on `main` before this task's own commit; see `CLAUDE.md` "Never
  quote a SHA from the harness's `gitStatus` block" for why this is sourced
  from `git rev-parse` and not the session's stale `gitStatus` snapshot)
