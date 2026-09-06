/**
 * plan.md §14.3: "restore a deep link" (§8.2: "Deep links must survive
 * static SPA fallback"). A full, non-SPA browser navigation straight to
 * `/h/:serverId/session/:agentId` -- the harness's static preview server
 * (`preview-server.ts`) must serve the SPA shell for that path (not a
 * 404), and the freshly-booted app must then restore the connection on
 * its own: `DaemonClientProvider`'s initial-connect effect
 * (`daemon-client-context.tsx`) reads the most recently connected saved
 * profile back out of this browser context's own storage
 * (`hosts.HostProfileStore`, persisted by the earlier `/connect` step)
 * with no further user action, and the session route resumes and
 * streams live from there.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("restore a deep link", () => {
  test("a cold full-page load straight at a session URL reconnects and restores the session", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    // Persists a saved host profile into this browser context's storage
    // (T27A2) -- the precondition every deep link restore depends on.
    await connectViaUi(page, daemonConnection, "Deep Link Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      const deepLinkUrl = `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`;

      // A second, fully independent full navigation -- not an in-app
      // `<Link>` click -- so this genuinely exercises a cold boot at the
      // deep link, the same as a bookmark, a shared URL, or a page
      // refresh would.
      await page.goto(deepLinkUrl);
      await expect(page).toHaveURL(deepLinkUrl);

      // No manual reconnect step: the composer (only reachable once
      // `SessionResumeScreen` resolves the session and a live client
      // exists) appears purely from the restored connection.
      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });

      // The restored connection is live, not a stale placeholder: a
      // fresh send still round-trips.
      await composerInput.fill("Please say 'timeline test'.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const transcript = page.getByTestId("host-session-transcript");
      await expect(transcript).toContainText("timeline test", { timeout: 15_000 });
    } finally {
      await session.close();
    }
  });
});
