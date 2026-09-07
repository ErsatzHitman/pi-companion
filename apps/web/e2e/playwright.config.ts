/**
 * Playwright configuration for the T31A E2E harness (plan.md §14.1,
 * §14.3). Run via `npm run test:e2e --workspace=@picompanion/web`
 * (`package.json`'s `test:e2e` script points here explicitly), never
 * `npx playwright test` from `apps/web` bare — this file, not
 * `vitest.config.ts`, owns `apps/web/e2e/**`.
 *
 * Deliberately has **no** static `use.baseURL` and reserves no ports
 * itself: Playwright reloads this config module once per worker
 * process (and, empirically, again on a retry), so anything reserved
 * at config-evaluation time is not the single source of truth
 * `global-setup.ts` needs. `global-setup.ts` — which Playwright
 * guarantees runs exactly once per invocation — owns port reservation
 * instead, and every spec reads the result back through the
 * `webBaseUrl`/`daemonConnection` fixtures in `fixtures/test.ts`,
 * built on `fixtures/ports.ts`'s published values, rather than through
 * `page.goto("/relative/path")` against a config-level `baseURL`.
 *
 * Headless only, a bounded per-test timeout — never UI mode, never the
 * HTML report server (`playwright show-report` is never invoked by
 * anything in this harness).
 *
 * ## `retries: 1` (T44A4) — investigated, kept, and what it actually absorbs
 *
 * The paragraph above's "reloads once per worker process (and,
 * empirically, again on a retry)" is about why PORT RESERVATION must
 * live in `global-setup.ts` rather than here — it does not, by itself,
 * explain why `retries: 1` exists. That was checked directly, not
 * assumed: `global-setup.ts`'s own doc comment records that Playwright
 * guarantees it runs exactly ONCE per invocation, and `reserveE2EPorts`
 * (`fixtures/ports.ts`) is called exactly once, inside it — a retried
 * test re-reads the already-published ports through
 * `readPublishedE2EPorts`, it never re-reserves them. So the
 * port-reservation race this file's own history once worried about is
 * closed by that architecture, not by this retry, and is NOT the
 * failure mode `retries: 1` is absorbing today.
 *
 * The real, disclosed reason this stays at 1 rather than 0: a retry was
 * observed actually masking a first-attempt failure at the P9-W2 merge
 * gate (`axe: / — no violations (retry #1)` — the first attempt failed
 * a real axe check, the retry passed). That is a genuine, if rare,
 * real-browser timing race in the axe-sweep specs (`accessibility.spec.ts`),
 * most plausibly a late microtask/paint settling after the route's own
 * "visible" wait resolves but before axe-core's DOM snapshot, though the
 * exact mechanism was not isolated. T44A4's own verification could not
 * reproduce it: one full `accessibility.spec.ts` run (all 10 specs,
 * `--retries=0`) and four repeats of the specific `axe: /` case that
 * flaked at P9-W2 (`--repeat-each=4 --retries=0`) all passed clean —
 * 14/14, zero failures — which means the failure mode is real but
 * intermittent/environment-sensitive (headless Chromium scheduling,
 * CI-runner load) rather than a reproducible defect this task could
 * isolate and fix directly. Given that, dropping the retry could not be
 * shown safe from local evidence, and CLAUDE.md's own warning applies
 * literally: "a retry removed while its cause is live turns a masked
 * flake into a red matrix." Kept at 1, documented here instead of
 * silently relied on — if a future run reproduces this with a
 * diagnosable cause, fix that cause and drop this retry in the same
 * change; do not raise it further as a way to keep tolerating a growing
 * flake rate.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./fixtures/global-setup.ts",
  use: {
    headless: true,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
