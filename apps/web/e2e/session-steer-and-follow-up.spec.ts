/**
 * plan.md §14.3: "send during a turn as steer and follow-up".
 *
 * `agent-turn-client.ts`'s module doc explains the real classification
 * rule this exercises: sending while a turn is already producing
 * output steers it; the daemon (not the composer) decides. On the wire
 * this is `AgentManager.replaceAgentRun`
 * (`packages/server/src/server/agent/agent-manager.ts`): while a turn
 * is active it interrupts the session (`session.interrupt()`) and
 * starts a fresh turn for the new prompt, rather than rejecting the
 * second submission outright — see `fake-pi-agent-client.ts`'s
 * `runSleepTool`, this suite's own fake `pi` provider's `/sleep/i`
 * side effect, which gives a real ~300ms window in which a turn is
 * genuinely still active (and genuinely interruptible) for a second,
 * real browser-driven send to land as a mid-turn submission rather than
 * racing a same-tick fake timer. The session is seeded in
 * `bypassPermissions` mode so this test exercises steering, not the
 * separate approvals surface T31C owns (this fake provider never emits
 * a `permission_requested` event at all — see that file's module doc).
 *
 * FIX-CI5: also asserts `Composer.tsx`'s "Stop" control's active-turn
 * contract (present, reachable by keyboard from the composer, and
 * focus-visible) against the mid-sleep window this test already opens.
 * `keyboard-navigation.spec.ts`'s own module doc (item 3) records
 * measuring that driving a fresh turn just for this check could not
 * reliably observe the daemon's `agent_update` `status: "running"` push
 * within this same ~300ms window; this assertion inherits that same
 * risk rather than resolving it, since this is the one spec that
 * already needs, and already reliably gets, that window open.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("send during a turn", () => {
  test("a second submission while a turn is active is accepted as a steer/follow-up, not rejected", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Steer Daemon");

    const session = await seedSession({
      address: daemonConnection.address,
      provider: "pi",
      modeId: "bypassPermissions",
    });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);

      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });
      const sendButton = page.getByRole("button", { name: "Send", exact: true });
      const transcript = page.getByTestId("host-session-transcript");

      // Triggers this suite's fake `pi` provider's `/sleep/i` `Bash`
      // tool call (`fake-pi-agent-client.ts`'s `runSleepTool`), which
      // this fixture's `bypassPermissions` mode lets run straight
      // through without a permission dialog (the fake never requests
      // one anyway).
      await composerInput.fill("Please sleep for a moment before replying.");
      await sendButton.click();
      await expect(transcript).toContainText("Please sleep for a moment before replying.", {
        timeout: 10_000,
      });

      // FIX-CI5: while this turn is genuinely active, "Stop" is present,
      // reachable by keyboard from the composer (the same Tab-order
      // property `keyboard-navigation.spec.ts` proves for every other
      // composer control on an idle session, which no longer includes
      // Stop -- see that file's module doc item 3), and focus-visible.
      const stopButton = page.getByRole("button", { name: "Stop", exact: true });
      await expect(stopButton).toBeVisible({ timeout: 5_000 });
      await composerInput.focus();
      await page.keyboard.press("Tab"); // "Send"
      await page.keyboard.press("Tab"); // "Attach files"
      await page.keyboard.press("Tab"); // Model chip
      await page.keyboard.press("Tab"); // Routing chip
      await page.keyboard.press("Tab"); // Queue chip
      await page.keyboard.press("Tab"); // -> "Stop"
      await expect(stopButton).toBeFocused();

      // A second submission, sent while that turn is still genuinely
      // running (the tool call is mid-`sleep`) -- this is the
      // steer/follow-up path itself. `useComposer.canSend` never checks
      // turn state (`agent-turn-client.ts`'s module doc: "the daemon,
      // not the caller" decides), so the composer accepts it exactly
      // like any other submission.
      await composerInput.fill("Steer: please also say hello.");
      await sendButton.click();
      await expect(transcript).toContainText("Steer: please also say hello.", { timeout: 10_000 });

      // Both submissions were accepted -- no send error banner appeared
      // for either (`Composer.tsx` only shows one when `sendError` is
      // set): the daemon never rejected the mid-turn send outright.
      await expect(page.locator(".pc-status__label", { hasText: "Send:" })).toHaveCount(0);

      // The steer interrupts the first (sleeping) turn and starts a
      // fresh one for the steer prompt (`replaceAgentRun`); that fresh
      // turn settles with the fake provider's deterministic default
      // reply (`FakePiAgentSession.replyFor`'s fallback) -- the mid-turn
      // submission was not silently dropped.
      await expect(transcript.getByText("Hello world").first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await session.close();
    }
  });
});
