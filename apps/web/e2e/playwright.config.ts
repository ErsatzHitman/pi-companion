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
 * Headless only, one retry, a bounded per-test timeout — never UI
 * mode, never the HTML report server (`playwright show-report` is
 * never invoked by anything in this harness).
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
