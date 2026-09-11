# CI matrix record (T44A4)

This is the classification T44A4 (`plan.md` §13 phase 9, "Run the complete
CI matrix rather than the full suite locally"; `docs/issues-from-plan.md`
T44A4) produces. It records, plainly, what "the matrix" actually is today,
what each job does and does not prove, and the guard that keeps the
workspace-coverage half of this record from silently rotting. Measured
against this tree at commit `8a90eb1c16722c2e22624b07006a07e461b26c87` (`git
rev-parse HEAD` — never the harness's own `gitStatus` snapshot, per this
repository's CLAUDE.md) before this task's own three new jobs were added,
and re-measured after.

**Real CI data for this exact commit, supplied by the orchestrator (this
task never pushes, fetches, or reads a live run itself — CLAUDE.md/this
task's brief):** run `34083431130`, event `push` to `main`, conclusion
**success**. 35 jobs total: 33 success, 2 skipped (`nix-checks`,
`docker-checks`, both path-conditional by design — see §4). Three of the 35
ran on `windows-latest`: `frontend-core-tests (windows-latest)`,
`web-unit-tests (windows-latest)`, `server-tests (windows-latest)`. The
other 32 are declared `ubuntu-latest` — "declared", not "ran": the two
skipped jobs named above are among them.

---

## 1. There is no `strategy:`/`matrix:` block in `ci.yml`

`grep -c "strategy:" .github/workflows/ci.yml` returns `0`. What the T44A4
acceptance criteria call "the full CI matrix" is **39 independently-declared
jobs in one workflow file** (35 at the commit above; T44A4 added three —
`relay-tests`, `cli-tests`, `guard-workspace-test-coverage` — see §3 and
§5, and T44B1 added `guard-signing-material`), not a `matrix:` axis.
**Re-derive this rather than trusting it** — every wave that adds a job moves
it, and it moved one wave after this sentence was written.
(CORRECTED at the P9-W5 merge gate: this said **38**. It was exact
when written and was falsified by the very next wave, by a job this document
does not own. The two "35" figures elsewhere in this file are dated to run
`34083431130` at `8a90eb1` and remain correct historical records — they are
not this claim, and were deliberately left alone.) A real `strategy: matrix:` block does exist, but
in a different workflow entirely: `android-maestro-e2e.yml`'s `maestro-e2e`
job (`matrix: shard: ${{ fromJSON(needs.shard-matrix.outputs.shards) }}`,
`fail-fast: false`) — see §2.

## 2. Three workflows, three different triggers

| Workflow                  | `on:`                                                                    | Runs on a push to `main`? |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `ci.yml`                  | `push:[main]`, `pull_request:[main]`, `merge_group`, `workflow_dispatch` | **Yes**                   |
| `android-maestro-e2e.yml` | `workflow_dispatch` only                                                 | **No**                    |
| `android-apk-release.yml` | tags `v*`/`android-v*`, `workflow_dispatch`                              | **No**                    |

Only `ci.yml` is "the matrix" in the sense the acceptance criteria mean —
the thing that gates every push to `main`. The other two never run
automatically:

- **`android-maestro-e2e.yml`** is the workflow that owns real, on-device
  Android coverage — all ten §14.4 Maestro flows (`maestro-e2e`, sharded by
  its own real `matrix:` block) plus a packaged-APK smoke test
  (`packaged-app-smoke`). It has **never run on a push**, and its own header
  comment discloses why: it needs an `EXPO_TOKEN` secret this repository
  does not have configured, and an emulator boot
  (`reactivecircus/android-emulator-runner`) that has never been verified
  here (T208, owner-gated). Every job dry-runs with a logged `::notice::`
  instead of failing until both exist. **This is the one and only on-device
  Android coverage anywhere in this repository, and it does not run
  automatically on any push or pull request** — see §4's Android row for
  what `ci.yml` covers instead.
- **`android-apk-release.yml`** produces the signed release APK (T44B1's
  job, not this task's). Tag-triggered only, also `EXPO_TOKEN`-gated and
  currently a dry run for the identical reason.

This task does not touch either trigger — CLAUDE.md and this task's own
brief are explicit that both are owner-blocked, and arming them is out of
scope here. They are classified, not activated.

## 3. Job-by-job classification (`ci.yml`)

Every job in `ci.yml` at commit `8a90eb1` (the wave base), plus the three
this task adds. "Ran in `34083431130`" is the orchestrator-supplied real
result for the 35 jobs that existed at that commit; the three new jobs are
marked "added by T44A4" with the outcome this task expects on the next
push (stated as a prediction, not a claim of having observed it — this
task never reads a live run).

| Job                                           | Gate                                   | Ran in `34083431130`?             |
| --------------------------------------------- | -------------------------------------- | --------------------------------- |
| `changes`                                     | always (routing)                       | success                           |
| `guard-legacy-paths`                          | always (unconditional)                 | success                           |
| `guard-android-no-web-files`                  | always                                 | success                           |
| `guard-android-no-duplicate-permission-state` | always                                 | success                           |
| `guard-maestro-no-production-daemon-port`     | always                                 | success                           |
| `guard-no-wave-self-revert`                   | always                                 | success                           |
| `guard-format-check-per-commit`               | always                                 | success                           |
| `format`                                      | always                                 | success                           |
| `lint`                                        | always                                 | success                           |
| `typecheck`                                   | always                                 | success                           |
| `protocol-client-tests`                       | `full \|\| protocol \|\| backend`      | success                           |
| **`relay-tests`** (T44A4)                     | `full \|\| backend`                    | added by T44A4 — expected success |
| `frontend-core-tests`                         | `full \|\| frontend-core`              | success                           |
| `frontend-core-tests (windows-latest)`        | `full \|\| frontend-core`              | success                           |
| `design-tokens-tests`                         | `full \|\| frontend-core`              | success                           |
| `web-tests`                                   | `full \|\| web`                        | success                           |
| `web-unit-tests (windows-latest)`             | `full \|\| web`                        | success                           |
| `android-tests`                               | `full \|\| android`                    | success                           |
| `server-tests (ubuntu-latest)`                | `full \|\| backend`                    | success                           |
| `server-tests (windows-latest)`               | `full \|\| backend`                    | success                           |
| **`cli-tests`** (T44A4)                       | `full \|\| backend`                    | added by T44A4 — expected success |
| `daemon-package-dry-run`                      | `full \|\| backend \|\| web`           | success                           |
| `guard-docker-packaging-paths`                | `full \|\| packaging`                  | success                           |
| `guard-packaging-entrypoints`                 | `full \|\| packaging`                  | success                           |
| `guard-dockerignore-depth`                    | `full \|\| packaging`                  | success                           |
| `docker-checks`                               | `docker` only — dormant by design (§6) | **skipped**                       |
| `nix-checks`                                  | `nix` only — dormant by design (§6)    | **skipped**                       |
| `guard-capability-prose`                      | always                                 | success                           |
| `guard-no-legacy-schema-reader`               | always                                 | success                           |
| `guard-app-id-package-pairing`                | always                                 | success                           |
| `guard-axe-route-coverage`                    | always                                 | success                           |
| `guard-no-node-builtin-in-web-bundle`         | always                                 | success                           |
| `guard-orphan-modules`                        | always                                 | success                           |
| `guard-run-guard-wiring`                      | always                                 | success                           |
| **`guard-workspace-test-coverage`** (T44A4)   | always                                 | added by T44A4 — expected success |
| `guard-version-drift`                         | always                                 | success                           |
| `guard-secret-scan`                           | always                                 | success                           |
| `guard-audit-baseline`                        | always (needs `npm ci`)                | success                           |
| **`guard-signing-material`** (T44B1)          | always                                 | added by T44B1 — expected success |

`full` is `true` on every push to `main` (see `changes` job's own comment:
`github.event_name != 'pull_request'` already makes it true, before even
checking the routing/workspace/ci filters), so every path-filtered job in
this table ran on push `34083431130`, and the three T44A4 jobs — gated the
same way (`full || backend`, or unconditional) — will run on every push
too, not just when their own files change.

## 4. Coverage claim, checked area by area

For each area the T44A4 acceptance criteria name, the job(s) that cover it,
the exact command each runs, and — the actual finding this section exists
to write down rather than smooth over — where that coverage stops.

### Protocol

- `protocol-client-tests` (ubuntu-latest only): `npm run test --workspace=@picompanion/protocol`.
- **Finding: Linux-only.** No Windows job runs the protocol suite directly
  (`frontend-core-tests-windows` and `server-tests-windows` exist, but
  neither invokes `@picompanion/protocol`'s own test script). Pure-TypeScript
  schema/codec logic is less platform-sensitive than the daemon/CLI's
  filesystem and process code that does have Windows jobs, but this is a
  real, disclosed gap in the letter of "the matrix covers protocol" on
  Windows specifically.
- **Decided at T234 (§9): this is deliberate, not an oversight.** See §9 for
  the reasoning and the evidence behind it.

### Core (`@picompanion/frontend-core`)

- `frontend-core-tests` (ubuntu-latest) **and** `frontend-core-tests
(windows-latest)`, sharing one step list via a YAML anchor: `npm run
typecheck --workspace=@picompanion/frontend-core` then `npm run test
--workspace=@picompanion/frontend-core`.
- **Both platforms.** This is the one area with no disclosed gap in this
  section — T49's own header comment records it was added specifically
  because frontend-core "had no Windows coverage at all before this," given
  plan.md §15.4's daemon-on-Windows-primary-host framing.

### Web (`@picompanion/web`)

- `web-tests` (ubuntu-latest only): typecheck, `npm run test
--workspace=@picompanion/web` (unit/component, jsdom), `npm run build`,
  `npx tsc -p apps/web/e2e/tsconfig.json --noEmit`, then `npm run test:e2e`
  (the full Playwright suite, including `accessibility.spec.ts`'s
  axe-route sweep and `performance-budgets.spec.ts`'s §14.5 budgets).
- `web-unit-tests (windows-latest)`: **narrower on purpose** — only the
  jsdom unit/component suite, not typecheck, not the production build, not
  Playwright.
- **Finding: the real-browser E2E suite (Playwright, axe, performance
  budgets) is Linux-only.** Web's typecheck, build and E2E/axe/perf
  coverage exist on exactly one platform; Windows gets unit/component
  coverage only. This mirrors the daemon-primary-host framing above (the
  daemon plan.md §15.1 cares about runs on the owner's Windows laptop; the
  browser client itself is not platform-pinned the same way), but it is
  still real, single-platform coverage for the heaviest part of this
  suite, not "the matrix covers web" without qualification.
- **Decided at T234 (§9): this is deliberate, not an oversight.** See §9 for
  the reasoning and the evidence behind it.

### Android (`@picompanion/android`)

- `android-tests` (ubuntu-latest only): typecheck, `npm run test
--workspace=@picompanion/android` (unit tests, no device), and a
  production prebuild smoke (`expo prebuild --platform android
--no-install`, gated on an app config file existing).
- **Finding, stated plainly rather than smoothed over: this is unit-only
  and simulator/device-free.** The only real on-device Android coverage
  this repository has — all ten §14.4 Maestro flows, and the
  packaged-APK smoke test — lives in `android-maestro-e2e.yml`, which is
  `workflow_dispatch`-only (§2), so **nothing in `ci.yml` runs a device
  test automatically**. "The matrix covers Android" is true only for
  typecheck/unit/prebuild-smoke coverage on Linux; it is false for
  anything resembling a real device run on a push. This gap is disclosed,
  not silently accepted, and T234's own task did not attempt to arm
  either gated workflow (explicitly out of scope per that task's brief).
  CORRECTED (T373): this bullet used to say the Maestro workflow "has
  **never executed end-to-end** for lack of `EXPO_TOKEN` and a verified
  emulator boot (T208, owner-blocked)". All three clauses are now false.
  `EXPO_TOKEN` was configured at T208 and neither job in that workflow
  needs it any more (T315 and T330 moved both APK builds onto the runner);
  the emulator boot was verified at T324, which found `/dev/kvm` present
  but the runner user outside the `kvm` group; and dispatch 34558058662 at
  `51e2fa8` was green in every job, with all ten §14.4 flows reporting
  `PASS`. T371 corrected four files carrying this same claim and missed
  this one, which is the fifth. What survives is the `workflow_dispatch`
  half, restated above on its own footing: a dispatch is a real device run,
  and a push still is not.

### Backend (`packages/server`, `relay`, `client`, `cli`, `pi-bridge`/`bridge`, `highlight`, `expo-two-way-audio`, `protocol`)

- `server-tests (ubuntu-latest)` and `server-tests (windows-latest)`: `npm
run test:unit --workspace=@picompanion/server` — **not** the package's own
  `"test"` script (`test:unit && test:integration`). `test:integration`
  (`src/server/daemon-e2e/models.e2e.test.ts` et al.) is real-model-provider
  integration coverage this task did not wire and does not claim; it was
  already unwired at the wave base and stays that way here — filed as a
  disclosed gap, not this task's to close (its `Owns:` line is CI workflow
  files, not a new integration-suite verification).
  **T233 closed the investigation, not the gap: `test:integration` stays
  unwired for a specific reason, read from source, not run.** It executes
  `src/server/daemon-e2e/models.e2e.test.ts`,
  `src/server/daemon-e2e/live-preferences.e2e.test.ts` and
  `src/server/agent/model-catalog.e2e.test.ts`. The Codex/OpenCode cases in
  each file are gated behind `test.runIf(isBinaryInstalled("codex"/
  "opencode"))` and would simply skip on a runner without those CLIs, but
  the Claude-provider cases are **not** gated the same way — every one
  calls `createDaemonTestContext`. **CORRECTED at the P9-C merge gate.** This
  said `createDaemonTestContext` "calls `test-utils/claude-auth.ts`'s
  `seedClaudeAuth`, and that function's own body throws `"Claude credentials
  not found in environment..."`" without `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY`, and that provisioning one as a repository secret was
  the blocker. Neither is true. `daemon-test-context.ts` calls only
  `createTestPaseoDaemon` and `new DaemonClient`; `seedClaudeAuth`'s one
  caller, `useTempClaudeConfigDir`, has no callers of its own. Executed at
  the gate with both variables unset, `npx vitest run
  src/server/agent/model-catalog.e2e.test.ts` fails with
  `AssertionError: expected 'Unknown provider: claude' to be null`, raised by
  `provider-catalog-session.ts` because the fake-client test daemon has no
  provider snapshot entry — a credential is consulted nowhere on that path,
  and the daemon's `createTestAgentClients()` catalog is hard-coded. The
  decision survives (the suite fails as-is); the remedy did not, and T250
  owns finding the real one. Ports are not the blocker:
  `test-utils/paseo-daemon.ts`'s `prepareTestDaemonConfig` sets
  `listen: "127.0.0.1:0"`, an OS-assigned ephemeral port, every time — read
  directly, never run, per this task's hard constraint on the two daemon
  ports. This task never executed `test:integration` or any file inside
  it, consistent with "never run the full server suite." A process/port
  runner for exactly this lane already exists —
  `packages/server/scripts/e2e-sandbox/run-e2e-lane.ts` (T101,
  `docs/server-e2e-sandbox.md`)
  wires `npm run test:integration:sandboxed`, bounds it with
  `terminateWithTreeKill`, and re-rolls off 6767/6768 if either is ever
  allocated — but T101's own doc says it "was not permitted to exercise it
  for real" and its 8-minute timeout is "a starting estimate, not a
  measured budget." That runner solves the process/port half of wiring
  this suite; the other half — why the fake-client daemon answers
  `Unknown provider` — is the open question the correction above hands to
  T250.
  **T250 measured the answer, by reading the path from
  `createTestPaseoDaemon` to the snapshot, not by guessing.** This
  repository's provider registry is Pi-only: plan.md §1.2 calls it "a
  Pi-only daemon and provider" and §2.3 lists "non-Pi agent providers" as
  a stated non-goal, and `AGENT_PROVIDER_DEFINITIONS` in
  `packages/protocol/src/provider-manifest.ts` has exactly one entry,
  `"pi"`. `ProviderSnapshotManager.buildRegistry()` only lets an
  `extraClients` fake override a provider already present in that builtin
  registry (`if (!definition) continue;` in its merge loop) —
  "claude"/"codex"/"opencode" never are keys in it, so the three fakes
  `createTestAgentClients()` builds are silently discarded and no
  snapshot entry for them is ever created. The read path then confirms
  it: `getProviderSnapshotEntryForRead`'s warm-up passes the requested
  provider through `resolveRefreshProviders`, which intersects it against
  `getProviderIds()` (`["pi"]` only) and gets back an empty list, so
  `warmUpSnapshotForCwd` returns before calling `refreshProviders` at
  all — the entry stays undefined and the handler emits
  `Unknown provider: <id>`. Both of the brief's other candidates are
  ruled out, not merely disbelieved: the provider list is not empty by
  construction (it has one real member, `"pi"`), and nothing here is a
  catalog-session refactor — the three `test:integration` files test only
  "claude"/"codex"/"opencode" and never "pi", which is a leftover premise
  from Paseo's multi-provider daemon that was never updated when this
  repository's registry narrowed to Pi-only.
  **The suite still does not pass against the fakes, and cannot without a
  scope decision outside this task**: fixing it would mean either
  reintroducing non-Pi providers into `AGENT_PROVIDER_DEFINITIONS`
  (contradicts the §2.3 non-goal directly) or rewriting all three files
  to exercise the one real provider with a new fake added to
  `fake-agent-client.ts` — a file T250's `Owns:` line does not cover, and
  a decision about what this suite should assert once it is Pi-only, left
  to whoever picks that up. Confirmed still red at T250:
  `cd packages/server && npx vitest run --maxWorkers=1
  src/server/agent/model-catalog.e2e.test.ts` exits non-zero with the
  same three `Unknown provider: <id>` failures observed above.
  `test-utils/claude-auth.ts` (`seedClaudeAuth`) and
  `test-utils/claude-config.ts` (`useTempClaudeConfigDir`) are deleted by
  T250 rather than wired: nothing in this repository spawns a real
  "claude"-provider `AgentClient` that would need seeded credentials, and
  the one real Claude integration test this repository has
  (`src/terminal/agent-hooks/claude/claude.real.e2e.test.ts`) exercises
  the ambient, already-configured `claude` CLI directly rather than an
  isolated temp `CLAUDE_CONFIG_DIR`.
  **T258 decided the scope question this section left open, and took option (b):**
  all three `test:integration` e2e files (`src/server/daemon-e2e/models.e2e.test.ts`,
  `src/server/daemon-e2e/live-preferences.e2e.test.ts`,
  `src/server/agent/model-catalog.e2e.test.ts`) were rescoped to exercise "pi", the
  one real provider, against a new `pi` fake added to `fake-agent-client.ts` —
  rather than reintroducing non-Pi providers into `AGENT_PROVIDER_DEFINITIONS`, which
  would have contradicted plan.md §2.3's non-goal directly. Run individually,
  foreground, one at a time (never through this unwired script):
  `cd packages/server && npx vitest run --maxWorkers=1 <file>` exits 0 for all three.
  Rescoping cost real coverage — the multi-provider assertions (Codex/OpenCode model
  and thinking-option shapes, and every Claude-specific model id) are gone, enumerated
  file by file in T258's entry in `docs/issues-from-plan.md`, not merely asserted away.
  T258 also found and filed, but did not fix (outside its `Owns:` line), a second,
  independent gate: `session.ts`'s `isProviderVisibleToClient` used to treat a client
  whose `appVersion` was null or below `"0.1.45"` as legacy and only show it
  `LEGACY_PROVIDER_IDS` (`"claude"/"codex"/"opencode"`) — a set that never contained
  "pi". CORRECTED (T262): that gate is now retired — `isProviderVisibleToClient` is an
  unconditional `true` regardless of `appVersion` (`plan.md` §18 item 13) — because
  this product's provider registry has always been pi-only and its own wire schema was
  never the restrictive `z.enum` the gate existed to protect against. The rescoped
  `live-preferences.e2e.test.ts`'s `appVersion: "0.1.45"` workaround is consequently no
  longer necessary for provider visibility (T258 does not own that file; unchanged
  here). The real Android app still declares `ANDROID_DAEMON_APP_VERSION = "0.1.0"`
  (`apps/android/src/app-shell/core.ts`), which now sees every "pi" agent correctly.
  `test:integration` is still not wired into this job — that remains T250's original,
  still-open subject.
- `protocol-client-tests` (ubuntu-latest only): `@picompanion/client` and
  `@picompanion/highlight`, alongside protocol.
- **`relay-tests` (T44A4, new).** `@picompanion/relay` had a real `"test":
"vitest run"` script and 7 test files (34 tests, 4 self-skipped by
  design — see below) with **no CI job running them**, despite `relay`
  being listed under the `backend` path filter in `.github/ci-paths.yml`.
  This was measured directly, not assumed:
  `npm run test --workspace=@picompanion/relay` → `5 passed | 2 skipped
(7)`, `34 passed | 4 skipped (38)`, 1.55s. The two skipped files
  (`e2e.test.ts`, `live-relay.e2e.test.ts`) both stay skipped in this job,
  but on two different gates. `live-relay.e2e.test.ts` is genuinely
  env-gated: `RUN_LIVE_RELAY_E2E === "1"`, which nothing sets, and it is
  the file that would otherwise dial the real `wss://relay.paseo.sh`.
  `e2e.test.ts` is not env-gated in any effective sense: its real
  condition is `(FORCE_RELAY_E2E === "1" || nodeMajor < 25) &&
  wranglerCliPath !== null`, and `ci.yml` pins `NODE_VERSION: "22"`, so
  the left disjunct is already true and the env var changes nothing. The
  only thing keeping that file skipped is `wrangler` being absent from
  the tree. Adding it as a devDependency would arm a 90 s-startup
  wrangler dev server in `relay-tests` without any workflow edit. Closed in this same commit — see §5.
  (CORRECTED at the P9-W4 merge gate: this said both files "self-gate
  behind `FORCE_RELAY_E2E=1`/`RUN_LIVE_RELAY_E2E=1` env vars this new job
  never sets". That is true of one of the two, and it named the wrong
  mechanism for the file whose e2e run is the heavier of the pair.)
- **`cli-tests` (T44A4, new).** `@picompanion/cli` had a real `"test:unit":
"vitest run src"` script and 21 test files (173 tests) with **no CI job
  running them**, also despite being listed under `backend`. Measured:
  `npm run test:unit --workspace=@picompanion/cli` → `21 passed (21)`, `173
passed (173)`, ~75s (after the same protocol→relay→highlight→client→server
  build chain the `typecheck` job already builds). Closed in this same
  commit for the unit half only — see the disclosed gap below.
  **Disclosed, not closed: `cli`'s own `"test"` script is `test:unit &&
test:local`, and `test:local` (`tests/run-all.ts`) is a materially
  different, heavier suite** — it spawns real, isolated daemon subprocesses
  per test file (its own header: "Runs all test phases as separate
  subprocesses with a bounded worker pool") using `zx`. `cli-tests`
  deliberately runs only `test:unit`.
  **T233 investigated `test:local` rather than re-stating this as an open
  question, and kept it unwired.** Unlike `test:integration` above, no
  credential is missing here: `grep -rn
  "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" packages/cli/tests` finds
  zero hits, and none of the 39 numbered test files under
  `packages/cli/tests/` (`^\d{2}-.*\.test\.ts$`, counted directly —
  `KNOWN_HEAVY_TESTS` in `run-all.ts` had cited only five of them) invokes
  a real provider completion the way `agent-lifecycle.test.ts` under
  `tests/e2e/` would; the ones checked (help/flag parsing, daemon-not-
  running handling, `provider models` against the static catalog, `daemon
  pair`/`restart`/`stop` lifecycle, `schedule create` registration) do not
  need one. Ports are OS-assigned throughout, read directly from source:
  `tests/helpers/network.ts`'s `getAvailablePort()` binds `127.0.0.1:0`
  and releases it; `tests/setup.ts`'s `getRandomPort()` returns
  `10000 + random*50000`; `tests/helpers/test-daemon.ts`'s own
  `getRandomPort()` returns `20000 + random*10000`. None of the three ever
  produces 6767 or 6768, and every daemon-spawning test in this suite goes
  through one of them — confirmed by reading, not by running the suite,
  per this task's hard constraint. What remains genuinely unmeasured is
  wall time and shared-runner behavior: `run-all.ts` runs `npm run
  build:server` before any test file starts, then schedules 39 files
  across a concurrency-4 worker pool, and its own `KNOWN_HEAVY_TESTS`
  comment names five files (05-agent-run, 06-agent-send, 11-agent-wait,
  13-permit-allow-deny, 14-worktree) as slow enough to need deliberate
  shard placement. This task has no way to trigger a real GitHub Actions
  run to time it there, and judged a full local run on the machine
  available to it unsafe to attempt blind — a single-file measurement
  attempt outside the documented `npm run test:local` entry point hit
  environment-specific friction (a `zx` shell-quoting failure tied to how
  this Windows workstation resolves `bash`) before any daemon actually
  started, which is disclosed here as what was tried, not as a claim about
  the suite's own portability. **Wiring `test:local` into CI is still a
  distinct, disclosed gap for a future task with access to measure it on a
  real runner — not silently folded into this one, and not wired on the
  estimate above.**
- **Allowlisted, not a gap:** `@picompanion/bridge` (`packages/pi-bridge`)
  declares no `"test"` script and has zero test files anywhere under
  `packages/pi-bridge/` — there is no command any CI job could invoke.
  `@picompanion/expo-two-way-audio` declares a `"test": "expo-module
test"` script but has zero test files under its `src`/`examples`/
  `android`/`ios` directories, and running it would need the
  react-native/jest-expo toolchain this environment's permission
  classifier already refuses to install. Both are recorded, with these
  exact reasons, in `scripts/ci/guard-workspace-test-coverage.mjs`'s
  `ALLOWLISTED_UNTESTED_WORKSPACES` (§5) rather than silently having no
  job and no explanation.

---

## 5. The new guard: `guard-workspace-test-coverage`

**File:** `scripts/ci/guard-workspace-test-coverage.mjs` (pure check
functions) + `scripts/ci/run-guard-workspace-test-coverage.mjs` (CLI entry
point) + `scripts/ci/guard-workspace-test-coverage.test.mjs` (`node:test`).
Wired, unconditional, as the `guard-workspace-test-coverage` job in
`ci.yml` (§3).

**What it checks.** Every workspace resolved from the root `package.json`'s
`workspaces` field (`packages/*`, `apps/*` — expanded against the real
directory listing, not a hand-typed copy, matching
`guard-axe-route-coverage.mjs`'s "derive it from the real tree" discipline)
must either:

1. be tested by a real `run:` step in some `.github/workflows/*.yml` file —
   `npm run test --workspace=<name>` or `npm run test:<anything>
--workspace=<name>` (reusing `guard-run-guard-wiring.mjs`'s
   `extractRunStepContents`, so a shell comment merely quoting a workspace
   name inside a real `run: |` block does not count, matching that file's
   own "a comment mentioning it is not wiring it" rule); or
2. carry a reasoned entry (≥20 non-placeholder characters) in
   `ALLOWLISTED_UNTESTED_WORKSPACES`.

**T211/T213-shaped stale-allowlist detection**, same as
`guard-run-guard-wiring.mjs` and `guard-no-legacy-app-tree.mjs`: an
allowlist entry is independently checked for naming a workspace that no
longer exists (`stale-missing-workspace`) or one a workflow now genuinely
tests (`stale-tested`), walked over the allowlist's own keys rather than
folded into the main loop — so a stale entry cannot go unreported just
because the main loop never happens to revisit it.

**Proven to fire, both directions, against the real committed tree** (not
just synthetic fixtures — `guard-workspace-test-coverage.test.mjs` has both
kinds of test):

- Removed the real `@picompanion/bridge` allowlist entry (in memory, via a
  scratchpad-backed edit, never `git checkout --`) →
  `node scripts/ci/run-guard-workspace-test-coverage.mjs` exited **1**:
  `UNTESTED WORKSPACE: "@picompanion/bridge" is tested by no \`run:\` step
  in any .github/workflows/\*.yml file`. Restored byte-identically from the
scratchpad backup; `diff` confirmed identical; guard back to exit 0.
- Added a scratch allowlist entry naming `@picompanion/relay` (now
  genuinely tested by `relay-tests`) → exited **1**: `STALE ALLOWLIST
ENTRY: ... names "@picompanion/relay" as legitimately untested ...
but a real \`run:\` step ... now genuinely tests it`. Restored the same
  way; confirmed identical; guard back to exit 0.
- `guard-workspace-test-coverage.test.mjs` pins both firing shapes at the
  fixture level too, plus a real-tree assertion (`"the real tree has zero
workspace-test-coverage violations today"`) that would have failed before
  `relay-tests`/`cli-tests` were wired — it did fail, naming
  `@picompanion/relay` and `@picompanion/cli`, until those two jobs were
  added in this same commit.

`node scripts/ci/run-guard-clean-working-tree.mjs` was run after each
restore in the proof above and exited 0 both times, per this repository's
T93 procedure.

**What this guard deliberately does not catch** (see the module's own
header for the full reasoning): a workspace tested only indirectly through
another script's internal `npm run` calls; a workspace whose only coverage
is a differently-shaped command (`npx playwright test`, `npx maestro test`,
an EAS build) rather than `npm run test... --workspace=...` — every
workspace with such coverage today also has a matching unit/typecheck job,
so this has not needed exercising yet, but a future workspace relying
solely on such a suite would need its own allowlist entry.

---

## 6. The two skipped jobs stay conditional — not a gap, a design choice

`docker-checks` and `nix-checks` gate on the `docker`/`nix` path-filter
outputs in `.github/ci-paths.yml`, which — per that file's own long-standing
comment — are reserved for a possible future root-level `Dockerfile`/
`flake.nix` and currently match nothing, because T43A3 put the real
packaging inputs under `packaging/docker/` and `packaging/nix/` instead.
Neither toolchain (`docker`, `nix`) is installed in this development
environment either. The real static checks against the actual packaging
inputs (`guard-docker-packaging-paths`, `guard-packaging-entrypoints`,
`guard-dockerignore-depth`) run unconditionally/on the `packaging` filter
and are not affected by this. **This task makes no change here** — widening
either filter or making the two jobs unconditional was explicitly out of
scope and would turn two legitimately-dormant jobs into failures in an
environment with no Docker/Nix toolchain, exactly the "red matrix" this
task exists to avoid, not fix.

---

## 7. The retry question (`apps/web/e2e/playwright.config.ts`)

Investigated and decided; the full reasoning now lives in that file's own
doc comment (searched for first, per this repository's own "a comment
warning about a hazard is a specification for a test" and "record where the
config lives" conventions) rather than only here. Summary:

- **The port-reservation problem the old doc comment's wording could be
  read as describing is not live.** Read `fixtures/global-setup.ts` and
  `fixtures/ports.ts` directly: `reserveE2EPorts` is called exactly once,
  inside `global-setup.ts`, which Playwright guarantees runs once per
  invocation (not once per worker, and not again on a retry — that
  guarantee is `global-setup.ts`'s own reason for existing, per its header
  comment). A retried test re-reads the already-published ports through
  `readPublishedE2EPorts`; it never re-reserves them. So `retries: 1` is
  not compensating for a port race today.
- **The real, disclosed reason it stays at 1:** a retry was observed
  actually masking a first-attempt failure at the P9-W2 merge gate (`axe: /
— no violations (retry #1)` — supplied as fact, not re-derived here).
  This task's own verification could not reproduce that failure: one full
  foreground run of `accessibility.spec.ts` (all 10 specs, `--retries=0`)
  passed 10/10, and a targeted foreground run of the specific `axe: /` case
  repeated four times (`--repeat-each=4 --retries=0`) passed 4/4 — 14/14
  clean, zero failures, in this task's own environment.
- **Decision: kept at `retries: 1`, not dropped.** 14 clean local runs is
  not proof the failure mode is gone — it is evidence the failure mode is
  intermittent/environment-sensitive (real-browser timing under headless
  Chromium, possibly worse under a loaded CI runner than this workstation),
  which is exactly the situation the T44A4 wave brief warns about: a retry
  removed while its cause is live turns a masked flake into a red matrix.
  (CORRECTED at the P9-W4 merge gate: this attributed that sentence to
  CLAUDE.md as a direct quotation. It appears in no CLAUDE.md in this
  tree, at HEAD or at the wave base — it is the orchestrator's wording in
  the task brief. The decision it supports is unaffected; the citation
  was not something a reader could have checked and found.)
  Dropping it could not be shown safe from the evidence gathered here. The
  config's own doc comment now states this precisely — what closed
  (ports), what did not (the real, rare axe-timing race), and what a future
  fix needs to do (diagnose the actual mechanism and drop the retry in the
  same change, not raise the retry count as a way to keep tolerating a
  growing flake rate).

This is the "keep it and record exactly what failure mode it absorbs"
branch the task brief itself names as an acceptable outcome, chosen over
"fix the cause and drop the retry" because the cause was not reproducible
enough to confirm fixed, and this task must not gamble a real CI matrix
turning red on unconfirmed evidence.

---

## 8. What this task did not touch

Per its own `Owns:` line: no `apps/*/src`, no `packages/*/src`, no
`CLAUDE.md`, no `docs/issues-from-plan.md`. `android-maestro-e2e.yml` and
`android-apk-release.yml` triggers are unchanged — both stay
`workflow_dispatch`/tag-only, exactly as owner-blocked as they were before
this task (§2). `nix-checks`/`docker-checks` stay path-conditional (§6). No
job anywhere had a `continue-on-error`, `|| true`, widened `if:`, narrowed
path filter, skipped test, or loosened assertion added to reach green.

---

## 9. T234: the protocol/web Linux-only split is a decision — KEEP

`docs/issues-from-plan.md` T234, filed against §4's Protocol and Web findings
above: two areas run Linux-only while `plan.md` §15.4 frames the daemon this
product talks to as Windows-primary. This section is the recorded decision
those findings pointed at as still open. **Re-derived fresh, not trusted from
this file's own older numbers** (§1 already warns that every prior job count
here was exact only for its own commit): at `cc3980ae45f7d8991a04243588782a5ebd50b7a8`
(`git rev-parse HEAD`), `grep -c "runs-on:" .github/workflows/ci.yml` → **40**
(up from 35 at T44A4's commit, 38 and 39 at later gates — the count keeps
moving, per §1, and none of those older figures should be restated as
current). `grep -n "runs-on: windows-latest"` still names exactly three:
`frontend-core-tests-windows`, `web-unit-tests-windows`,
`server-tests-windows`. `protocol-client-tests` and `web-tests` (the
Playwright/axe/performance-budget suite) are still `ubuntu-latest`-only, and
`web-unit-tests-windows` still runs the jsdom suite alone. The asymmetry is
unchanged in shape since T44A4 recorded it; only the surrounding job count
has moved.

**Decision: KEEP. Linux-only is correct for both `protocol-client-tests` and
`web-tests`'s Playwright/axe/performance-budget suite. No job added, and
`.github/workflows/ci.yml` is untouched by this task.** This is not
"symmetry doesn't matter" — CLAUDE.md's own task brief explicitly rules out
adding Windows jobs to make the table look even. It is that neither suite's
test surface can reach any of the three concrete Windows-only failure
classes this repository has real, catalogued evidence for (its own
CLAUDE.md: hardcoded path separators, CRLF surviving from committed content,
and file-locking races from a real subprocess racing a temp-directory
delete), checked directly against each package's source rather than assumed.

### `packages/protocol`

- **No subprocess, ever.** `grep -rn "child_process\|spawn(" packages/protocol/src --include="*.ts" | grep -v "\.test\.ts"`
  returns nothing — the one raw hit for those keywords anywhere in the
  package (`branch-slug.test.ts`) is a regex literal inside a test that
  asserts `branch-slug.ts` does _not_ import `child_process`, the opposite
  of real usage. The file-locking/`EBUSY` class needs a real spawned process
  racing a `rmSync`/`rm` of a temp directory (see CLAUDE.md's
  `HubRelationshipHarness`/`terminal-activity-route.test.ts` paragraph); this
  package never spawns anything, so that class cannot occur here.
- **Exactly one file touches the filesystem at all**: `src/fixtures/index.ts`,
  and it only _reads_ static, committed JSON fixtures
  (`readFileSync`/`readdirSync`), built through `node:path`'s `dirname`/
  `join` — the OS-aware functions — never a hand-built `` `${a}/${b}` ``
  string. It never writes and never creates or deletes anything, so there is
  no reachable "hardcoded `/` breaks on Windows" bug of the kind this
  repository has actually hit elsewhere: `path.join`'s Windows output
  (backslash-joined) is exactly what Windows `fs.readFileSync` expects
  natively.
- **The one file that models Windows console behavior in the domain
  sense is still platform-independent to run.** `src/terminal-key-input.ts`'s
  `WIN32_LEFT_ALT_PRESSED`, `win32ControlKeyState`, and
  `encodeWin32EnterKeyInput` encode real ConPTY win32-input-mode escape
  sequences, but every one of them is pure string/number computation gated
  by a caller-supplied `options.inputMode.win32InputMode` flag — never by
  `process.platform` or any other OS query. `ubuntu-latest` executes the
  identical JavaScript `windows-latest` would; the function's _subject_ is
  Windows, but its _execution_ has no OS dependency for a test runner to
  exercise differently.
- **CRLF is not reachable either.** The fixtures `src/fixtures/index.ts`
  reads are plain JSON, kept LF by `.gitattributes`' `* text=auto eol=lf`
  regardless of checkout platform, and `JSON.parse` does not care about line
  endings in whitespace outside string literals in any case.

None of the three classes apply. Linux-only protocol coverage was already
correct; it is now a recorded decision instead of an unexamined fact.

### `web-tests` (Playwright, axe, performance budgets)

- **The product code under test is a guarded impossibility for this class of
  bug.** `guard-no-node-builtin-in-web-bundle` already fails the build if any
  module _reachable from_ `apps/web/src/main.tsx` imports a Node builtin — it
  is a real import-graph walk from the production entry, not a whole-directory
  scan, which is exactly the right scope here: reachable-from-the-entry is
  precisely where a path-separator or `os.EOL`-flavored bug would have to live
  to reach the shipped bundle a Playwright spec drives in a real Chromium
  browser. (CORRECTED at the P9-D merge gate: this said "if any `apps/web/src`
  file imports a Node builtin", which overstates the guard — its own output
  reads "no node: builtin reachable from `apps/web/src/main.tsx`", and an
  unreachable file would not be caught. The argument is unaffected, because an
  unreachable file is by definition not in the bundle the specs drive.) A platform-specific
  defect in the code these specs actually exercise is not merely unlikely;
  CI already refuses to let it exist.
- **The daemon-on-Windows surface plan.md §15.4 actually names already has
  Windows coverage, in the layer that owns it.** The E2E fixtures spin up
  `@picompanion/server` (`apps/web/e2e/fixtures/daemon.ts`'s
  `createPaseoDaemon`) and serve the packaged web-UI bundle
  (`preview-server.ts` via `scripts/build-daemon-web-ui.mjs`). That package's
  static-asset-serving code — `packages/server/src/server/web-ui.ts`, covered
  by `web-ui.test.ts` and `web-ui-serve.test.ts` — is not excluded from
  `test:unit:parallel`, so both `server-tests-ubuntu` **and**
  `server-tests-windows` already run it today. Adding a second, far heavier
  browser-driven path to Windows would re-prove the same daemon-serving
  surface a second time, not cover something new.
- **The E2E harness's own real-subprocess/temp-directory shape is the exact
  pattern CLAUDE.md's own test-count paragraph names as a source of
  Windows-only flakiness — infra risk to accept for no matching benefit, not
  a reason to add the job.** `startIsolatedDaemon` in `daemon.ts` calls
  `mkdtemp`/`rm` on real temp directories every run (checked: it already
  passes `{ maxRetries: 3, retryDelay: 100 }` to `rm`, evidence its authors
  already anticipated exactly this Windows file-handle-release race), and
  `preview-server.ts` shells out via `execFile` to run
  `scripts/build-daemon-web-ui.mjs`. That is the same "a real spawned
  subprocess and/or a temp directory it then deletes... contending... for
  CPU and (on Windows) file-handle release" shape CLAUDE.md's paragraph
  documents, in this exact repository, as producing failures with **zero
  assertion failures** — the signature of contention, not a caught defect.
  The retries lower that risk without removing it. Running the single
  heaviest, slowest job in this workflow a second time on `windows-latest`
  would add real CI minutes and a non-zero chance of exactly that
  contention-flavored noise, in exchange for coverage of a surface (the
  bullet above) that already has a correctly-scoped Windows job.
- **The layer that would actually catch an accidental OS-sensitive
  assumption creeping into `apps/web/src` already runs on Windows.**
  `web-unit-tests-windows` (T49) is the jsdom half of this same suite, fast
  and free of the subprocess/tempdir shape above, and it already runs on
  `windows-latest` today for exactly the daemon-primary-host reasoning T49's
  own header cites.

What makes all three classes unreachable through these two layers, stated
directly: neither does hand-built path-string concatenation with a hardcoded
separator; neither depends on the line endings of any file it reads at test
time; and the one place either suite spawns a real subprocess against a real
temp directory (`web-tests`'s own E2E harness) is test infrastructure whose
Windows-only failure mode is noise CLAUDE.md already catalogues, not a
product defect this suite exists to catch — and the product-facing surface
that harness depends on (`@picompanion/server`'s static-asset serving) is
already covered on Windows, correctly, by `server-tests-windows`.

No job was added. This section, and the two `Decided at T234` cross-
references in §4, are the only changes T234 makes to this file;
`.github/workflows/ci.yml` is untouched.
