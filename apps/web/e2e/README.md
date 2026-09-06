# apps/web E2E harness (T31A)

Real browser, real (isolated) daemon, real static production build. No mocks.

## Isolation guarantees

- The daemon (`fixtures/daemon.ts`) binds an **ephemeral port** chosen by this
  harness (`fixtures/ports.ts`, `net.createServer().listen(0, ...)`), never
  `6767`. Every code path that could bind a port (`ports.ts`, `daemon.ts`,
  `preview-server.ts`) independently refuses `6767` and throws instead.
- The daemon's `PASEO_HOME` is a fresh `mkdtemp` directory per run, never the
  real `~/.paseo` or the local dev daemon's `.dev/paseo-home`.
- Every test's browser `context` is wrapped in an auto-fixture
  (`fixtures/test.ts`) that watches every outgoing request and fails the test
  if any of them targeted port `6767` on any host
  (`fixtures/production-port-guard.ts`). `production-port-guard.spec.ts`
  proves the guard's predicate works without ever dialing port `6767` itself.
- The web app under test is a real production build (`vite build`, the same
  artifact `npm run build` produces — plan.md §15.2), served by Vite's own
  `preview()` API on its own ephemeral port. Never the Vite dev server.
- The daemon and the preview server are both started once, in
  `fixtures/global-setup.ts`, and always torn down by the teardown function it
  returns — including when a test fails (Playwright calls global teardown
  unconditionally once the run finishes).

## Running

```bash
# one-shot; installs the matching Chromium build if it is missing
npx playwright install chromium

# from apps/web
npm run test:e2e

# a single scenario
npm run test:e2e -- --grep "connect to an isolated daemon"
```

Always headless, one retry, a bounded per-test timeout (`playwright.config.ts`).
Never run `--ui`, `--debug`, or `playwright show-report` here — those start an
interactive server that blocks.

## Why these files never run under `vitest`

`apps/web/vitest.config.ts` excludes this directory outright, so
`npx vitest run` (from `apps/web` or the repo root) never attempts to load a
`*.spec.ts` file here as a unit test, and this harness never attempts to run
a `*.test.ts` unit test as an E2E scenario.

## Adding a scenario

Import `test`/`expect` from `./fixtures/test.js` (not `@playwright/test`
directly) so the port-6767 guard and the `daemonConnection` fixture apply
automatically. Keep new specs independent: each one gets its own browser
context and must not depend on state a previous spec left behind (T31A
acceptance criteria carried forward into T31B/T31C: "shardable and
independent", "no scenario depends on another's leftover state").
