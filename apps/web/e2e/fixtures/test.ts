/**
 * Extended Playwright `test`/`expect` every T31A+ spec imports instead
 * of `@playwright/test` directly. Adds two things every scenario needs:
 *
 * - `daemonConnection`: the isolated daemon's address (`global-setup.ts`
 *   published it to `process.env`/the `.tmp` info file; `ports.ts`
 *   reads it back) so a spec never hardcodes a port.
 * - an auto-fixture that wraps every test's `context` with the T31A
 *   port-6767 guard (`production-port-guard.ts`): it watches every
 *   request this browser context issues and fails the test if any of
 *   them targeted the production daemon port. Automatic (`{ auto: true }`)
 *   so no spec can forget to opt in.
 */
import { test as base, expect } from "@playwright/test";

import { createProductionPortGuard } from "./production-port-guard.js";
import { readPublishedE2EPorts } from "./ports.js";

export interface DaemonConnection {
  daemonPort: number;
  webPort: number;
  /** `host:port`, ready to type into the `/connect` form's address field. */
  address: string;
  /**
   * The static web build's own origin, e.g. `http://127.0.0.1:54321`.
   * There is deliberately no config-level `use.baseURL` (see
   * `playwright.config.ts`'s file header), so specs build absolute
   * URLs from this instead of calling `page.goto("/relative/path")`.
   */
  webBaseUrl: string;
}

export interface PicompanionFixtures {
  daemonConnection: DaemonConnection;
  /** Not meant to be used directly by specs; runs automatically. */
  productionPortGuard: void;
}

export const test = base.extend<PicompanionFixtures>({
  // Playwright's fixture runtime statically parses this function's
  // source and requires the first parameter to literally be a
  // destructuring pattern — `daemonConnection` doesn't depend on any
  // other fixture, so that pattern is empty.
  // eslint-disable-next-line no-empty-pattern
  daemonConnection: async ({}, use) => {
    const { daemonPort, webPort } = await readPublishedE2EPorts();
    await use({
      daemonPort,
      webPort,
      address: `127.0.0.1:${daemonPort}`,
      webBaseUrl: `http://127.0.0.1:${webPort}`,
    });
  },

  productionPortGuard: [
    async ({ context }, use) => {
      const guard = createProductionPortGuard();
      const onRequest = (request: { url: () => string }): void => guard.observe(request.url());
      context.on("request", onRequest);
      try {
        await use();
      } finally {
        context.off("request", onRequest);
      }
      // Checked after `use()` returns so a violation fails the test
      // itself, not just this fixture's teardown log.
      guard.assertClean();
    },
    { auto: true },
  ],
});

export { expect };
