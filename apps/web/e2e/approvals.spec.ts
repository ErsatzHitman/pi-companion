/**
 * plan.md §14.3 approvals scenarios, §12.3 "Pi UI action" (single-answer
 * semantics) and §11.6/§21A's `PermissionsController`.
 *
 * `fake-pi-agent-client.ts` was, before this task, deliberately built to
 * "never emit a `permission_requested` event at all" (see its own
 * module doc, and `session-steer-and-follow-up.spec.ts`'s header, which
 * both used to say "approvals are T31C's surface, not this one's") --
 * every other T31B scenario ran its tool calls straight through
 * unconditionally. T31C1 closes that gap: the fake session now
 * recognizes two deterministic prompts, `"request permission"` and
 * `"request dangerous permission"`, that emit a real
 * `permission_requested` stream event for a `Bash` tool call and block
 * the turn until `respondToPermission` resolves it -- see that file's
 * own doc comment for the exact wire shape.
 *
 * The approvals surface itself (`ApprovalsContainer`/`ApprovalsHost`/
 * `PermissionDialog`, T28B7) was already mounted on
 * `host-session-screen.tsx` wired to a live `DaemonClient`
 * (`daemon-permissions-client.ts`, T53A2) before this task; this spec
 * drives it end to end against the real isolated daemon for the first
 * time.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession, type SeededSession } from "./fixtures/seed-session.js";
import type { Page } from "@playwright/test";

/**
 * Waits for `page`'s session route to reach the same real,
 * product-level "the live client this screen needs is ready" signal
 * every other T31B/T31C spec waits on (see e.g.
 * `transcript-tool-and-diff.spec.ts`'s own comment on why the composer
 * input's mere visibility is not enough to race a fresh navigation's
 * reconnect safely), then returns the composer input and send button
 * `page`'s own tests will drive.
 */
async function waitForReadySession(page: Page): Promise<{
  composerInput: ReturnType<Page["getByLabel"]>;
  sendButton: ReturnType<Page["getByRole"]>;
}> {
  await expect(page.getByTestId("session-resume-ready")).toBeVisible({ timeout: 15_000 });
  const composerInput = page.getByLabel("Message Pi");
  await expect(composerInput).toBeVisible({ timeout: 15_000 });
  const sendButton = page.getByRole("button", { name: "Send", exact: true });
  return { composerInput, sendButton };
}

test.describe("approvals", () => {
  test("a blocking permission request appears and can be answered from the browser", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Approvals Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);
      const { composerInput, sendButton } = await waitForReadySession(page);
      const transcript = page.getByTestId("host-session-transcript");

      await composerInput.fill("Please request permission before running that.");
      await sendButton.click();

      // The turn is genuinely blocked on this dialog: the tool call
      // shows up "running" in the transcript before the permission
      // request resolves either way (`fake-pi-agent-client.ts`'s
      // `runPermissionTool` emits the running `tool_call` timeline item
      // first, then the `permission_requested` event).
      await expect(transcript.getByText("Bash").first()).toBeVisible({ timeout: 10_000 });

      const dialog = page.getByTestId("approvals-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // A plain (non-dangerous) request renders as `role="dialog"`, not
      // `"alertdialog"` (`PermissionDialog.tsx`).
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(dialog).toContainText("Run shell command needs your approval");
      await expect(dialog).toContainText("echo ok");

      const approveButton = dialog.getByRole("button", { name: "Approve" });
      await expect(approveButton).toBeVisible();
      await approveButton.click();

      // Answered: the dialog closes on its own client without a page
      // reload or further user action, and the queue is empty again.
      await expect(dialog).toHaveCount(0);

      // The turn is unblocked and the tool call the permission gated
      // completes (not "Canceled" -- an allow answer really let it run,
      // not merely closed the dialog -- `tool-call-row.tsx`'s
      // `STATUS_TEXT`, a non-colour status signal).
      await expect(transcript.getByText("Completed").first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await session.close();
    }
  });

  test("a dangerous action requires its explicit confirmation", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Dangerous Approvals Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);
      const { composerInput, sendButton } = await waitForReadySession(page);

      await composerInput.fill("Please request dangerous permission for this one.");
      await sendButton.click();

      const dialog = page.getByTestId("approvals-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // Non-colour dangerous signalling (plan.md §10.5): a real
      // `role="alertdialog"` (not just `"dialog"`) and a visible warning
      // sentence, not merely a colour change on the button.
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expect(dialog).toContainText("rm -rf ./build");
      await expect(dialog).toContainText("Requires extra caution — this cannot be undone.");

      const denyButton = dialog.getByRole("button", { name: "Deny" });
      const approveButton = dialog.getByRole("button", { name: "Approve" });
      await expect(denyButton).toBeVisible();
      await expect(approveButton).toBeVisible();

      // Explicit confirmation, not an accidental default: `ApprovalForm`
      // auto-focuses Deny, never Approve, specifically so a keyboard
      // user cannot Tab+Enter into approving a dangerous action by
      // accident (`ApprovalForm.tsx`'s own doc comment). A dangerous
      // request is answered by clicking a specific, correctly-labeled
      // button -- there is no keyboard-accessible default "yes".
      await expect(denyButton).toBeFocused();

      // The dialog stays open and blocking until that explicit click --
      // it is not auto-dismissed and it does not resolve on its own.
      await page.waitForTimeout(200);
      await expect(dialog).toBeVisible();

      await denyButton.click();
      await expect(dialog).toHaveCount(0);

      // Denying the dangerous action really stopped it -- the tool call
      // resolves "Canceled", not "Completed" (non-colour status text,
      // same signal as the previous test's allow path).
      const transcript = page.getByTestId("host-session-transcript");
      await expect(transcript.getByText("Canceled").first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await session.close();
    }
  });

  test("an answer from one client marks the request superseded for the other", async ({
    page,
    context,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Multi Client Approvals Daemon");

    let session: SeededSession | undefined;
    let page2: Page | undefined;
    try {
      session = await seedSession({ address: daemonConnection.address, provider: "pi" });
      const sessionUrl = `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`;

      await page.goto(sessionUrl);
      const { composerInput, sendButton } = await waitForReadySession(page);

      // A second, independent page in the *same* browser context: it
      // reconnects on its own from this context's already-persisted host
      // profile (`connect-ui.ts`'s own doc comment; proven for a fresh
      // navigation by `deep-link-restore.spec.ts`), so this is a second,
      // genuinely independent `DaemonClient` connection watching the
      // exact same live session -- not a second tab sharing one socket.
      page2 = await context.newPage();
      await page2.goto(sessionUrl);
      await waitForReadySession(page2);

      await composerInput.fill("Please request permission from two clients.");
      await sendButton.click();

      const dialogOnFirstClient = page.getByTestId("approvals-dialog");
      const dialogOnSecondClient = page2.getByTestId("approvals-dialog");

      // The daemon broadcasts the pending permission request to every
      // client watching this session, not only the one that sent the
      // prompt (plan.md §12.3 "Web and Android can be live on the same
      // session at once").
      await expect(dialogOnFirstClient).toBeVisible({ timeout: 10_000 });
      await expect(dialogOnSecondClient).toBeVisible({ timeout: 10_000 });

      // The first client answers.
      await dialogOnFirstClient.getByRole("button", { name: "Approve" }).click();
      await expect(dialogOnFirstClient).toHaveCount(0);

      // The daemon's resolution always wins over local state
      // (`PermissionsController.applyResolution`'s own doc comment) --
      // the second client's dialog for the exact same request closes on
      // its own once the daemon's `agent_permission_resolved` broadcast
      // reaches it, with no double-answer error and no action from that
      // client's own user: the request is superseded for it, not merely
      // ignored. There is nothing left to answer on the second client --
      // that is this scenario's own proof, not just its consequence.
      await expect(dialogOnSecondClient).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await page2?.close();
      await session?.close();
    }
  });
});
