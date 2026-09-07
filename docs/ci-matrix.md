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
other 32 ran on `ubuntu-latest`.

---

## 1. There is no `strategy:`/`matrix:` block in `ci.yml`

`grep -c "strategy:" .github/workflows/ci.yml` returns `0`. What the T44A4
acceptance criteria call "the full CI matrix" is **38 independently-declared
jobs in one workflow file** (35 at the commit above; this task adds three —
`relay-tests`, `cli-tests`, `guard-workspace-test-coverage` — see §3 and
§5), not a `matrix:` axis. A real `strategy: matrix:` block does exist, but
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

### Android (`@picompanion/android`)

- `android-tests` (ubuntu-latest only): typecheck, `npm run test
--workspace=@picompanion/android` (unit tests, no device), and a
  production prebuild smoke (`expo prebuild --platform android
--no-install`, gated on an app config file existing).
- **Finding, stated plainly rather than smoothed over: this is unit-only
  and simulator/device-free.** The only real on-device Android coverage
  this repository has — all ten §14.4 Maestro flows, and the
  packaged-APK smoke test — lives in `android-maestro-e2e.yml`, which is
  `workflow_dispatch`-only (§2) and has **never executed end-to-end** for
  lack of `EXPO_TOKEN` and a verified emulator boot (T208, owner-blocked).
  "The matrix covers Android" is true only for typecheck/unit/prebuild-smoke
  coverage on Linux; it is false for anything resembling a real device run,
  and nothing in `ci.yml` runs one automatically. This gap is disclosed,
  not silently accepted: T208 already tracks the owner-side blocker, and
  this task does not attempt to arm either gated workflow (explicitly
  out of scope per this task's own brief).

### Backend (`packages/server`, `relay`, `client`, `cli`, `pi-bridge`/`bridge`, `highlight`, `expo-two-way-audio`, `protocol`)

- `server-tests (ubuntu-latest)` and `server-tests (windows-latest)`: `npm
run test:unit --workspace=@picompanion/server` — **not** the package's own
  `"test"` script (`test:unit && test:integration`). `test:integration`
  (`src/server/daemon-e2e/models.e2e.test.ts` et al.) is real-model-provider
  integration coverage this task did not wire and does not claim; it was
  already unwired at the wave base and stays that way here — filed as a
  disclosed gap, not this task's to close (its `Owns:` line is CI workflow
  files, not a new integration-suite verification).
- `protocol-client-tests` (ubuntu-latest only): `@picompanion/client` and
  `@picompanion/highlight`, alongside protocol.
- **`relay-tests` (T44A4, new).** `@picompanion/relay` had a real `"test":
"vitest run"` script and 7 test files (34 tests, 4 self-skipped by
  design — see below) with **no CI job running them**, despite `relay`
  being listed under the `backend` path filter in `.github/ci-paths.yml`.
  This was measured directly, not assumed:
  `npm run test --workspace=@picompanion/relay` → `5 passed | 2 skipped
(7)`, `34 passed | 4 skipped (38)`, 1.55s. The two skipped files
  (`e2e.test.ts`, `live-relay.e2e.test.ts`) self-gate behind
  `FORCE_RELAY_E2E=1`/`RUN_LIVE_RELAY_E2E=1` env vars this new job never
  sets, so wiring the package's plain `test` script never opens a real
  network connection (the second file would otherwise dial the real
  `wss://relay.paseo.sh`). Closed in this same commit — see §5.
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
  subprocesses with a bounded worker pool") using `zx`, with its own
  process/port lifecycle this task did not verify is CI-safe (wall time,
  concurrency, cleanup on a shared runner). `cli-tests` deliberately runs
  only `test:unit`. Wiring `test:local` into CI is a distinct, disclosed
  gap for a future task, not silently folded into this one.
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
  which is exactly the situation CLAUDE.md warns about directly: "a retry
  removed while its cause is live turns a masked flake into a red matrix."
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
