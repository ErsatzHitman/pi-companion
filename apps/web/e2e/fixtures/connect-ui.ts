/**
 * Shared "connect via the real `/connect` UI" step for every T31B
 * scenario that needs a live, browser-driven connection before it
 * exercises a session route — the same `ConnectForm` flow
 * `connect.smoke.spec.ts` (T31A) already proves end to end, factored
 * out so later specs don't re-implement it.
 *
 * A successful attempt persists the profile through
 * `hosts.HostProfileStore` (`authenticate-host.ts`) into this browser
 * context's own storage, so `DaemonClientProvider`'s initial-connect
 * effect (`daemon-client-context.tsx`) picks it back up automatically
 * on every later navigation *in the same context* — including a full,
 * non-SPA page load — without repeating this step. That auto-reconnect
 * is exactly what `deep-link-restore.spec.ts` and
 * `reconnect-catchup.spec.ts` exercise.
 */
import type { Page } from "@playwright/test";

import { expect } from "./test.js";
import type { DaemonConnection } from "./test.js";

export async function connectViaUi(
  page: Page,
  daemonConnection: DaemonConnection,
  label = "E2E Daemon",
): Promise<void> {
  await page.goto(`${daemonConnection.webBaseUrl}/connect`);
  // T54A2 added the shell's single visually-hidden `<h1>`, which on this
  // route reads "Connect to a host". Playwright's `name` is a
  // case-insensitive SUBSTRING match unless `exact` is set, so the bare
  // name below now also matches that `<h1>`. `exact: true` pins this back
  // to the screen's own `<h2>Connect</h2>` -- a tightening, not a
  // loosening: it asserts one specific element instead of "any heading
  // whose name contains Connect".
  await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();

  await page.getByLabel("Host label").fill(label);
  await page.getByLabel("Host address").fill(daemonConnection.address);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const statusBanner = page.getByTestId("connect-status-banner");
  await expect(statusBanner).toContainText(`Reached ${label}`, { timeout: 15_000 });
}
