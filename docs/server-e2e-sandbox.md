# packages/server: the e2e/integration sandbox runner (T101)

`packages/server` has 312 test files as of this writing, 56 of them
`*.e2e.test.ts` / `*.real.e2e.test.ts`. They spawn real daemon and terminal
processes and open real (loopback, ephemeral-port) sockets, so no agent can
run them under this repository's port rules, and none ever has.

## The workspace is verifiable — only the e2e/integration lanes are not

A recurring misreading (corrected once already at the P6-W1 merge gate,
re-corrected here): **CI does not run the full server test suite.** The
`server-tests-ubuntu` / `server-tests-windows` jobs in
`.github/workflows/ci.yml` run exactly one command:

```bash
npm run test:unit --workspace=@picompanion/server
```

`test:unit` **excludes** `**/*.e2e.test.ts`. It is a real, foreground-able,
already-passing command — do not report the server workspace as
unverifiable on the basis of the 56 excluded e2e files.

### Measured foreground time (T101, this task, Windows, this machine)

Run once, in the foreground (`time npm run test:unit`, real wall clock):

```
real    6m15.271s
```

Broken down by the two phases `test:unit` now chains:

| Phase                                                           | Files                       | Tests                           | Result |
| --------------------------------------------------------------- | --------------------------- | ------------------------------- | ------ |
| `test:unit:parallel` (`--fileParallelism`)                      | 248 passed, 9 skipped (257) | 3343 passed, 180 skipped (3523) | exit 0 |
| `test:unit:serial` (`--no-file-parallelism`, the 7 files below) | 7 passed (7)                | 226 passed, 21 skipped (247)    | exit 0 |

**Exit 0 overall.** 264 files / 3770 tests combined (201 skipped total,
matching the 201 already recorded at the P6-W1 gate for the pre-split
command — confirming the split changed _how_ the files run, not _which_
tests exist or skip). Prior waves measured the pre-split single command at
270s / 252 files / 3498 tests (P6-W1 gate) and 140-220s across earlier runs;
this task's own file count (257+7=264 vs. the prior 252) is higher because
it includes this task's own 3 new spec files plus the pre-existing
`scripts/*.test.ts` files, not because the split changed what runs.

The takeaway for the next verifier: **`npm run test:unit` is a normal
foreground command with a roughly six-minute budget on Windows (faster on
Linux, where the serialized phase's git/pty spawns are cheaper) — not an
unverifiable one.** Re-measure and update this table if a future change
moves the needle meaningfully.

Caveat on this specific measurement: it was run in a working tree that also
carried one file outside this task's scope,
`packages/server/src/server/agent/providers/pi/ui-bridge/state.test.ts`
(staged, +147 lines, from unrelated concurrent work never touched by this
task). All 264 files still passed with it present; nothing here depended on
it. Re-run on a clean `main` if a byte-exact reproduction is needed.

**CORRECTED (T240, P9-W22 gate):** the "seven" below is now eleven. T240 measured
that four more files share one of the causes this section describes — real
subprocess spawns and/or temp-directory teardown racing under `--fileParallelism`
(the section also lists a disk-bound module load and a real WebSocket transport;
the P9-C gate corrected "the identical cause" to "one of") — and moved them from
`test:unit:parallel` to `test:unit:serial`:
`src/server/hub/daemon-executions.test.ts` and `src/server/hub/hub-cli-contract.test.ts`
(both drive the same `HubRelationshipHarness` as this section's own
`relationship-controller.test.ts` / `execution-session.websocket.test.ts` rows),
`src/server/terminal-activity-route.test.ts` (a real per-test child process plus
`rmSync` of its temp `cwd`), and `src/services/github-service.test.ts` (a real `git`
subprocess per fixture invocation). This was measured, not guessed — see
`CLAUDE.md`'s "Working locally" section for the full account and the file-list
evidence — and confirmed by three consecutive `npm run test:unit
--workspace=@picompanion/server` runs on one commit all exiting 0. The `<7 files
above>` / `<the same 7 files>` command text and the "251 (of 258 non-e2e)" /
"264 files" counts below are T101's own dated measurement and are left as historical
record; they no longer match the current `packages/server/package.json`, which is
the source of truth for the current split.

## The two (really seven) Windows parallelism flakes

Across separate full runs of the pre-split `test:unit`, these files were each
observed to fail exactly once, always passing again in isolation:

| File                                                 | Symptom                                   |
| ---------------------------------------------------- | ----------------------------------------- |
| `src/utils/checkout-git.test.ts`                     | `EBUSY` removing a Windows temp directory |
| `src/server/hub/relationship-controller.test.ts`     | 30000ms test timeout                      |
| `src/terminal/terminal.test.ts`                      | 30000ms test timeout                      |
| `src/utils/spawn.launch-regression.test.ts`          | 30000ms test timeout                      |
| `src/server/bootstrap-provider-availability.test.ts` | 30000ms test timeout                      |
| `src/server/exports.test.ts`                         | 30000ms test timeout                      |
| `src/server/hub/execution-session.websocket.test.ts` | 30000ms test timeout                      |

### The cause

All seven perform a real, OS-level operation whose wall-clock cost is
sensitive to how many other processes are competing for the CPU and disk at
that instant, not to anything the test asserts:

- `checkout-git.test.ts`, `bootstrap-provider-availability.test.ts` — spawn
  real `git` subprocesses (`execFileSync`) and `rm`/rmdir real temp
  directories afterward.
- `terminal.test.ts`, `spawn.launch-regression.test.ts` — spawn real shells /
  `node-pty` processes, including Windows-specific `ComSpec` resolution and
  spawn-helper handling.
- `exports.test.ts` — dynamically imports `./exports.js`, which pulls in the
  full daemon module graph (including native modules such as
  `sherpa-onnx-node` and `node-pty`) — a large, disk-bound module load, not a
  logic-heavy test.
- `relationship-controller.test.ts`, `execution-session.websocket.test.ts` —
  exercise real (loopback, non-forbidden-port) WebSocket transports.

`test:unit`'s pre-split form ran with `--fileParallelism` (explicitly
overriding `vitest.config.ts`'s own `fileParallelism: false` default) and
`pool: "forks"`, so dozens of these files' vitest worker processes run
concurrently, each itself spawning further real child processes. Windows
process creation and file-handle release are markedly more expensive than
POSIX `fork()`, so under load from that many concurrent forked workers, a
subset of the files whose own correctness depends on a real subprocess or a
real filesystem handle releasing within a bound (the shared 30000ms
`testTimeout` in `vitest.config.ts`, or a real `rmdir` racing a process that
has not yet released its file handle) occasionally cross that bound. This is
resource contention from concurrent parallelism, not a logic defect in any
of the seven files — which is exactly why every one of them passes
individually, every time.

### The fix: explicit serialization, not a retry

A retry converts a real future failure (a test that legitimately hangs)
into silence, so it was not used. Instead, `test:unit` was split into two
npm scripts that always run in sequence:

```bash
# packages/server/package.json
"test:unit": "npm run test:unit:parallel && npm run test:unit:serial",
"test:unit:parallel": "vitest run --fileParallelism --exclude \"**/*.e2e.test.ts\" --exclude <7 files above>",
"test:unit:serial": "vitest run --no-file-parallelism <the same 7 files>",
```

`test:unit:parallel` covers the remaining 251 (of 258 non-e2e) test files at
full parallelism, unchanged from before. `test:unit:serial` then runs
exactly the 7 contention-sensitive files with file parallelism disabled —
removing them from the pool of dozens of concurrently forked workers is a
direct fix for the cause identified above (contention), not a workaround
bolted on top of it. The union of the two scripts' file sets is identical to
the original single command's — no file is dropped or run twice (verified:
`comm` over the two file lists reproduces the original 258).

## The e2e/integration sandbox runner

`scripts/e2e-sandbox/` (this task) gives the two lanes CI does not run a
bounded, sandboxed way to be invoked by a human or a future CI job that is
allowed to open real sockets — **something that has never existed in this
repository before**, and this task's implementer was not permitted to
exercise it for real (see "What was and was not executed" below).

- `sandbox-env.ts` — `PRODUCTION_DAEMON_PORT` (6767) and `DEV_DAEMON_PORT`
  (6768) are the two ports this repository may never bind or connect to
  (plan.md §15.1). `buildSandboxEnv()` allocates a real ephemeral port
  (bind-port-0-then-close, the same pattern already established and tested
  by `apps/android/e2e/harness/daemon-endpoint.ts` and
  `apps/web/e2e/fixtures/ports.ts`), re-rolling if it ever lands on a
  forbidden port; creates a fresh `mkdtemp`-based `PASEO_HOME` under the OS
  temp directory; and strips `PORT` / `PASEO_PORT` / `DAEMON_PORT` from the
  inherited environment if any of them names a forbidden port. This is
  defense in depth at the process level — individual daemon-e2e test files
  already do their own per-test ephemeral-port and temp-home allocation via
  `src/server/test-utils/paseo-daemon.ts` (`listen: "127.0.0.1:0"`).
- `bounded-runner.ts` — `runBounded()` spawns a command and, if it has not
  exited by a hard `timeoutMs`, kills the whole process tree via this
  repository's existing `terminateWithTreeKill` (`src/utils/tree-kill.ts`,
  already used by `bootstrap.ts`) rather than leaving a hang in a spawned
  daemon/terminal process to wait forever.
- `run-e2e-lane.ts` — the CLI entry point, wired into
  `npm run test:e2e:sandboxed` and `npm run test:integration:sandboxed`
  (`--dry-run` variants also wired). It resolves a sandbox environment, then
  runs the corresponding pre-existing `npm run test:e2e` /
  `npm run test:integration` script inside it, bounded by a 15-minute /
  8-minute wall clock respectively (chosen conservatively, **not measured
  against a real run** — see below; adjust once one exists).

### What was and was not executed

Per this task's hard constraint, **the agent that wrote this runner never
invoked it with `--execute`** (the default; it actually spawns
`npm run test:e2e` / `test:integration`, which spawn real daemon and
terminal processes). Only `--dry-run` was run — confirmed live during this
task:

```
$ npx tsx scripts/e2e-sandbox/run-e2e-lane.ts e2e --dry-run
[e2e-sandbox] lane=e2e npmScript=test:e2e port=61049 paseoHome=...\.paseo timeoutMs=900000
[e2e-sandbox] --dry-run: not spawning npm/vitest. No daemon or terminal process was started.
```

`--dry-run` calls `buildSandboxEnv()` for real (so the port-allocation and
temp-home logic in the printed plan above is real, not a stub), but never
calls `runBounded`, so no daemon or terminal process was ever started by
this task. The port-selection and isolation logic is proven instead by real
unit tests (`sandbox-env.test.ts`, `bounded-runner.test.ts`,
`run-e2e-lane.test.ts` — 27 tests, all real: real ephemeral port binds, real
`mkdtemp` directories, real child processes for the bounded-runner tests,
none of them the actual e2e/integration lane).

**No lane was actually executed as part of this task.** The 15-/8-minute
timeouts above are therefore a starting estimate, not a measured budget;
whoever first runs `test:e2e:sandboxed` / `test:integration:sandboxed` for
real should record the actual duration here and adjust `LANES` in
`run-e2e-lane.ts` accordingly.
