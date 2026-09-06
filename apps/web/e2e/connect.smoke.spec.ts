/**
 * T31A's required smoke scenario: "connect to an isolated daemon"
 * (plan.md §14.3's first bullet). Drives the real `/connect` screen —
 * `ConnectFormContainer` -> `ConnectForm` -> `attempt-host-connection.ts`
 * / `authenticate-host.ts` — against the real, isolated daemon
 * `global-setup.ts` started for this run, over a real browser and a
 * real static production build. Nothing here is mocked: a passing run
 * proves the harness (isolated daemon fixture, static build/preview
 * server, and the port-6767 guard) actually works end to end.
 */
import { expect, test } from "./fixtures/test.js";

test.describe("connect to an isolated daemon", () => {
  test("reaches the isolated daemon and persists the connection", async ({
    page,
    daemonConnection,
  }) => {
    await page.goto(`${daemonConnection.webBaseUrl}/connect`);

    // T54A2 added the shell's single visually-hidden `<h1>`, which on this
    // route reads "Connect to a host". Playwright's `name` is a
    // case-insensitive SUBSTRING match unless `exact` is set, so the bare
    // name below now also matches that `<h1>`. `exact: true` pins this back
    // to the screen's own `<h2>Connect</h2>` -- a tightening, not a
    // loosening: it asserts one specific element instead of "any heading
    // whose name contains Connect".
    await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();

    await page.getByLabel("Host label").fill("E2E Daemon");
    await page.getByLabel("Host address").fill(daemonConnection.address);
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    const statusBanner = page.getByTestId("connect-status-banner");
    // Playwright's `toContainText` polls, so this rides out the
    // transient "Connecting to E2E Daemon…" state to the final,
    // authenticated outcome instead of racing it.
    await expect(statusBanner).toContainText("Reached E2E Daemon", { timeout: 15_000 });
    await expect(statusBanner).toHaveAttribute("role", "status");

    // A successful attempt persists the profile (T27A2) and offers to
    // forget it — proving the round trip went through
    // `hosts.HostProfileStore`, not just a probe.
    await expect(page.getByRole("button", { name: "Forget saved credentials" })).toBeVisible();
  });
});
