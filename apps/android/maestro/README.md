# apps/android/maestro

Maestro/Agent Device flows for the Android app (plan.md §6, §14.4). This directory owns the
flow files themselves; `../e2e/` owns the TypeScript support code that resolves a flow name,
allocates an isolated daemon endpoint, and drives the child processes. T37D built the harness
and the one smoke flow below; each `T37E*` task owns exactly one further flow file here and
must not touch another task's flow.

## What T37D proved, and what it did not

**This wave has no emulator, no device, and no Maestro binary.** T37D never ran `maestro`,
`adb`, or an emulator, and did not install the app. Of the harness's four acceptance criteria:

- **"The harness runs one smoke flow on the reference emulator" — NOT proven here.** `smoke.yaml`
  below is written, reviewed as text, and its supporting TypeScript typechecks and is
  unit-tested, but it has never executed against a real emulator. The first real run belongs to
  whichever `T37E*` task first has a device.
- **"It targets an isolated daemon, never production" — proven.** See "Isolation" below: this is
  enforced in code (three independent checks against one shared constant — see
  `../e2e/harness/production-daemon-port.ts`), unit-tested in both directions
  (`../e2e/harness/*.test.ts`, `../../../scripts/ci/guard-no-production-daemon-port.test.mjs`),
  and wired into CI as an unconditional guard.
- **"Flows are independent and repeatable" — proven as a design property, not by executing two
  flows back to back.** See "Flow independence" below for the mechanism and what a flow author
  must not do.
- **"A single documented command runs any one flow by name against an already-running emulator"
  — the command exists and is documented below; running it requires an emulator and Maestro,
  neither of which exists in this wave.**

## Prerequisites — what must already be running

This harness never boots or configures an emulator; that is a precondition, not something it
does for you. Before running a flow:

1. **An Android emulator (or device) must already be running and unlocked.** Check with:

   ```bash
   adb devices
   ```

   It must list exactly one device in the `device` state (not `offline`, not empty). If more
   than one is listed, set `ANDROID_SERIAL` to the one you mean.

2. **The `sh.picompanion.debug` development build must already be installed on it.** Check with:

   ```bash
   adb shell pm list packages sh.picompanion.debug
   ```

   It must print `package:sh.picompanion.debug`. If it prints nothing, build and install it
   first (`npm run android:development --workspace=@picompanion/android`, per plan.md §15.3) —
   this harness does not build or install the app.

3. **The Maestro CLI must already be installed and on `PATH`.** Check with `maestro --version`.
   Installing Maestro is out of scope for this harness and for this wave.

4. **Node and `tsx` must be available**, which they already are at the repository root
   (`node_modules/.bin/tsx`) — no extra install needed for this part.

Nothing above is a step this harness performs. If any of them isn't true, `run-flow.ts` will
fail loudly (Maestro will report "no device", `adb` will report nothing) rather than silently
booting something for you.

## The one documented command

```bash
npx tsx apps/android/e2e/run-flow.ts <flow-name>
```

Run from the repository root. `<flow-name>` is a `.yaml` file's basename in this directory
(e.g. `smoke` for `smoke.yaml`). Running with no argument prints the list of available flow
names instead of guessing one.

This one command is the entire contract every `T37E*` task needs: it resolves the flow, starts
an isolated daemon on an ephemeral port with a fresh home directory, points Maestro at it, runs
the flow, and tears the daemon down again — win or lose. No `T37E*` task should ever hand-roll
its own daemon start/stop or its own emulator/port bookkeeping; if starting a flow ever requires
more than this one command plus the prerequisites above, that is this harness's bug to fix, not
a cost each of the ten flows should pay separately.

## Isolation — never port 6767

Port `6767` is the owner's real, running production daemon (plan.md §15.1). A flow that reached
it would act on real sessions on the owner's machine. This harness makes that structurally
impossible rather than merely documented:

- `../e2e/harness/production-daemon-port.ts` is the one place that defines the number `6767`.
- `../e2e/harness/daemon-endpoint.ts` allocates an OS-assigned ephemeral port for every run (the
  same free-port-probe pattern `apps/web/e2e/fixtures/ports.ts` already uses for the Playwright
  harness) and asserts the result isn't `6767` before returning it.
- `../e2e/harness/run-plan.ts` asserts again, immediately before turning the endpoint into the
  `paseo start --listen ...` command line that actually binds a socket.
- `scripts/ci/guard-no-production-daemon-port.mjs` is a **third, independent** check: it fails
  CI if the literal string `6767` ever appears in any `.yaml` file in this directory (flows or a
  future `config.yaml`), for any reason, including a comment. A flow can therefore not name port
  6767 even by accident — the guard doesn't try to distinguish "prose about 6767" from "a real
  reference to it" the way a comment-aware check would; in this one directory, the string simply
  may never appear. (This README is the one place allowed to mention the number, because it has
  to explain the rule — the guard excludes `README.md` for exactly that reason.)

The daemon a flow talks to is always the one `run-flow.ts` just started, at
`${DAEMON_ADDRESS}` / `${DAEMON_HOST}`:`${DAEMON_PORT}` (env vars `run-flow.ts` passes to
Maestro — `10.0.2.2:<port>`, the AVD's fixed alias for the host machine's loopback interface,
never `localhost` or a hardcoded number). A flow that needs to reach the daemon should read
those vars rather than typing an address in.

### The daemon's `pi` is scripted (T334)

The isolated daemon has no real `pi` on its PATH and no model credentials, and it never will
here. Before starting it, `run-flow.ts` writes the daemon's own config file into the fresh
`PASEO_HOME` (`../e2e/harness/scripted-pi-provision.ts`), pointing `agents.providers.pi.command`
at `../e2e/harness/scripted-pi.mjs` — a plain-JavaScript stand-in that speaks the Pi JSONL RPC
the daemon's provider already uses. The daemon resolves, spawns, probes and drives it exactly
as it would a real `pi`; only the model is missing. Each flow gets one scenario
(`scenarioForFlow`): `notification-approval` gets `approval` (a prompt raises two `confirm`
dialogs in turn, which the daemon's Pi provider maps to `agent_permission_request`),
`extension-sheets` gets `extension-sheets` (a prompt raises a pinned roster and a pinned panel; a
prompt containing the word "form" raises a pinned form), and every other flow gets `echo` (each
prompt is a one-message turn). A flow drives it through the real composer — type a prompt, tap
send — never through a side channel the app does not have.

`run-flow.ts` also mints one host-side working directory per run (`../e2e/harness/flow-cwd.ts`)
and hands it to the flow as `${FLOW_CWD}`: the daemon refuses a session whose `cwd` does not
exist on the host, and the emulator cannot create one there. A flow that creates a session types
`${FLOW_CWD}` into the "New session" form — never a literal path; `flow-cwd.test.ts` fails on one.

## Flow independence

Every flow gets its own port and its own `PASEO_HOME` (a fresh `mkdtemp` directory,
`../e2e/harness/daemon-endpoint.ts`) — nothing is shared across runs or across flows, and
nothing here reuses a directory a previous run left behind. On the app side, every flow must
start with:

```yaml
- launchApp:
    clearState: true
    clearKeychain: true
```

as `smoke.yaml` does below — this resets the app's own persisted state (onboarding completion,
paired hosts, cached sessions) before the flow's first real command, so a flow can never depend
on state an earlier flow — or an earlier run of itself — happened to leave behind.

**Rules for a new flow file** (each `T37E*` task, when it adds its own):

- Start with `launchApp: { clearState: true, clearKeychain: true }`. Do not assume any prior
  app state, paired host, or cached session.
- Never hardcode a daemon address; read `${DAEMON_HOST}` / `${DAEMON_PORT}` / `${DAEMON_ADDRESS}`.
- Never write, read, or depend on another flow's file, tag, or run order. Flows must be runnable
  individually, in any order, any number of times.
- Never reference port `6767` — see "Isolation" above; the guard will fail CI if you do, even in
  a comment.
- Clean up anything the flow creates outside the app itself (e.g. a paired-host record on the
  daemon) by relying on the daemon's own fresh, throwaway home directory — never by adding
  teardown steps to the _next_ flow.
- Never type a literal working directory into the "New session" form; use `${FLOW_CWD}`. Never
  assume a real `pi`: the provider is the scripted one above, and only its three scenarios
  exist — add a scenario to `scripted-pi.mjs` (and a test) before a flow depends on new
  behaviour from it.

## Files here

- `smoke.yaml` — T37D's one smoke flow: launches the app and asserts the onboarding welcome
  screen renders. Touches no daemon.
- One `.yaml` file per `T37E*` task (`T37E1`-`T37E10`), each owning exactly one of the ten
  scenarios from plan.md §14.4: `pairing.yaml`, `cold-start-restore.yaml`,
  `composer-inputs.yaml`, `notification-approval.yaml`, `extension-sheets.yaml`,
  `background-kill-restore.yaml`, `network-switch.yaml`, `offline-cache-outbox.yaml`,
  `files-and-terminal.yaml`, `accessibility-audit.yaml`.
- `shards.json` — T37F's shard assignment for those ten flows (below). Owned by T37F, not a
  flow file itself.
- `file-download.yaml` — T77's flow, added after T37F's ten-flow set closed. Covers the
  download path T32S14 made reachable (real direct pairing, the real listing round trip, and
  the honest state it reaches today — see the flow's own header comment for a disclosed gap it
  found and filed rather than fixed). Deliberately **not** one of the ten and **not** in
  `shards.json` / the sharded exit gate (`../e2e/harness/shard-plan.ts`'s
  `NON_EXIT_GATE_FLOW_NAMES` excludes it the same way it excludes `smoke`) — run it the same
  one documented way: `npx tsx apps/android/e2e/run-flow.ts file-download`.

## T37F — the Phase 5 exit gate: sharding and CI

T37F (plan.md §14.4, §15.4) re-runs all ten `T37E*` flows above together, sharded, as the
formal Phase 5 exit gate. It writes no flow file — it owns exactly `shards.json` and the CI
workflow that reads it.

- `shards.json` partitions the ten flows into five shards of two flows each. Every flow
  belongs to exactly one shard; no shard is empty. `../e2e/harness/shard-plan.ts` reads and
  validates the file (`loadShardConfig`, `validateShardConfig`, `resolveShardFlows`);
  `../e2e/harness/shard-plan.test.ts` proves the real file is valid today and that eight
  specific corruptions of it (a flow in two shards, a flow in no shard, an empty shard, a
  shard naming an unknown flow, a flow missing from `flows`, a duplicate in `flows`, two
  shards sharing a name) are all caught, by mutating a fixture config and — separately, as a
  mutation proof against the real file — by editing the real `shards.json` in place, watching
  the real test fail, and restoring it byte-identically (see that task's report).
- `../e2e/harness/flow-independence.ts` and its test structurally verify the exit gate's
  reproducibility claim: every one of the ten flows' FIRST `launchApp` step sets
  `clearState: true` (checked against real top-level YAML steps, `^- launchApp:` at column 0,
  never against a doc-comment's prose mention of "launchApp" — every flow file's own header
  comment contains that phrase, which is exactly the false-positive this check is built not to
  fall for). That is what makes running the five shards, or the two flows inside one shard, in
  parallel or in any order safe.
- `../../.github/workflows/android-maestro-e2e.yml` is the CI invocation: a `workflow_dispatch`
  workflow (not part of the push/pull_request `ci.yml` gate — plan.md §15.4's required-job list
  does not include an emulator-backed run) whose matrix has one job per shard name in
  `shards.json`. Each shard job calls the exact same single-flow command documented above
  (`npx tsx apps/android/e2e/run-flow.ts <flow-name>`) once per flow in its shard, in order —
  it adds no second way to run a flow. It needs a development-variant build of
  `sh.picompanion.debug` (since T315, assembled by Gradle on the runner — no
  `EXPO_TOKEN`, no EAS queue) and a booted emulator with Maestro installed
  (`reactivecircus/android-emulator-runner`, unverified against this repository's runners); when
  the secret is absent it dry-runs with a logged notice instead of failing, the same pattern
  `android-apk-release.yml` already uses for its own EAS gate.
  CORRECTED (T311): this said that secret was "unconfigured", which T208 made false — it has
  been set as a repository secret since then, and run 34369364166 is the first dispatch that
  actually took the real branch rather than the dry-run one. What that run then proved is
  recorded as T311: the `development` profile carried `developmentClient: true` while
  `apps/android/package.json` declares no `expo-dev-client`, so `eas build` refused before
  starting. The flag is gone; the package this job installs is unchanged.
- **What this does NOT prove.** This wave has no emulator and no device (same as every
  `T37E*` task before it). The ten-flow sharded run on the reference emulator — the exit
  gate's actual acceptance criterion — has never been performed and remains the one
  outstanding step. Everything above is proven structurally and by unit test, not by a real
  run.

## T43B2b — the phase-8 packaging exit gate's Android half

`../../.github/workflows/android-maestro-e2e.yml` also carries a second, separate job,
`packaged-app-smoke`, added for the phase-8 packaging exit gate (docs/issues-from-plan.md
T43B2b) rather than the Phase 5 exit gate above. It answers a different, narrower question:
not "do all ten §14.4 scenarios pass on a development build", but "does the app launch at all
on the real PACKAGED build" — `apps/android/eas.json`'s `production-apk` profile
(`sh.picompanion`, the same profile a real release uses, plan.md §15.3), not `development`'s
`sh.picompanion.debug` variant. It runs only `smoke.yaml` — the one flow
`../e2e/harness/shard-plan.ts`'s `NON_EXIT_GATE_FLOW_NAMES` already excludes from the ten-flow
set because it has no daemon dependency and no paired-host precondition, making it the right
size for "does the packaged artifact boot" rather than "do all ten scenarios work."

**CORRECTED (T207): this said the job "cannot pass yet" because it was a wiring defect —
it installed `sh.picompanion`, then ran a flow whose first line was a literal `appId:
sh.picompanion.debug`, a package the job never installed, and `../e2e/harness/run-plan.ts`
put only the `DAEMON_*` variables in Maestro's environment with no way to reconcile the two.**
That is fixed. Every flow's `appId:` line (including `smoke.yaml`'s) is now the variable
`${APP_ID}`, resolved at Maestro invocation time via the `-e APP_ID=<value>` flag
`run-plan.ts`'s `buildRunPlan` adds to the `maestro test` argv — the mechanism
docs.maestro.dev's "Parameters and constants" page documents for exactly this "appId varies
by target" case. The Phase 5 gate above never overrides it, so it keeps getting
`run-plan.ts`'s `DEFAULT_APP_ID` (`sh.picompanion.debug`, unchanged); this job's own workflow
step passes `APP_ID=sh.picompanion` before invoking `run-flow.ts`, so `smoke.yaml` launches
the exact package `packaged-app-smoke` just installed.
`../../../scripts/ci/guard-app-id-package-pairing.mjs` is the CI check that a job's resolved
EAS package and the appId(s) its flows launch can never drift apart again — it reads the real
`eas.json`, `app.config.ts`, every flow file, and this workflow, and fails the moment they
disagree (reverting the fix on any one flow file reproduces the original failure — see that
guard's own test file for the mutation proof).

Same disclosure as the Phase 5 gate above: this job has never executed end-to-end either (no
`EXPO_TOKEN`, no verified emulator boot in this repository), dry-runs with a logged notice
until `EXPO_TOKEN` is configured, and stays `workflow_dispatch` for the identical reason —
that part of the original disclosure stands (T208, owner-gated).
