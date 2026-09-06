/**
 * plan.md §14.3: "open tool details and diff" (§11.6 tool renderer
 * registry, §7.4 timeline invariants). Drives two of `fake-agent-
 * client.ts`'s deterministic special-cased prompts against a seeded,
 * `bypassPermissions` session so both land as *completed* tool calls
 * with no approvals dialog in the way (T31C's surface, not this one's):
 *
 * - a generic shell tool call (`tool-call-row.tsx`'s `UnknownToolCard`)
 *   whose collapsible "Input" `<details>` disclosure is this row's
 *   "open tool details" affordance;
 * - the `emit N byte diff agent stream payload` special prompt
 *   (`buildLargeTimelineItem`'s `"diff"` branch), which produces an
 *   `apply_patch`/edit-family tool call carrying a real `unifiedDiff` --
 *   rendered inline as `EditBody`'s `DiffSummary` + `DiffLines`
 *   (`role="group" aria-label="Diff"`), plan.md §14.5's "diffs render
 *   for a changed file" budget line.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("tool call details and diffs", () => {
  test("a tool call's collapsible input can be opened, and a diff-bearing tool call renders its diff", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Tool Diff Daemon");

    const session = await seedSession({
      address: daemonConnection.address,
      provider: "pi",
      modeId: "bypassPermissions",
    });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);

      // `page.goto` is a full navigation: it tears down the `/connect`
      // page's already-open `DaemonClient` and forces this fresh page
      // load to reconnect from its persisted host profile
      // (`daemon-client-context.tsx`'s `runInitialConnect`) before
      // `SessionResumeScreen`'s resume-side `client` prop (and, from the
      // very same `useDaemonClient()` value, `ComposerContainer`'s
      // turn-control `client` prop) stop being `undefined`. The
      // composer's own input renders unconditionally either way (its
      // `aria-label` never depends on a live client), so waiting on it
      // alone races that reconnect: a message sent before it resolves is
      // accepted into `use-composer.ts`'s local outbox only (`if
      // (!client) return;`, never retried once a client later appears)
      // and never reaches the transcript. `SessionResumeSummary`'s own
      // `data-testid="session-resume-ready"` node only renders once
      // `useResumeSession` has actually resolved a live `resumeSession`
      // call, which is this screen's real, product-level proof the same
      // `client` the composer needs is now live.
      await expect(page.getByTestId("session-resume-ready")).toBeVisible({ timeout: 15_000 });

      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });
      const sendButton = page.getByRole("button", { name: "Send", exact: true });
      const transcript = page.getByTestId("host-session-transcript");

      // `buildClaudeToolCall`: "echo hello" -> a completed `Bash` tool
      // call, rendered through the safe generic card (T28A4).
      await composerInput.fill("Please run echo hello for me.");
      await sendButton.click();
      await expect(transcript).toContainText("Please run echo hello for me.", { timeout: 10_000 });

      const toolCard = page.locator(".pc-tool-call", { hasText: "Bash" }).first();
      await expect(toolCard).toBeVisible({ timeout: 15_000 });
      await expect(toolCard.getByText("Completed")).toBeVisible({ timeout: 15_000 });

      const inputDisclosure = toolCard.locator("details", { hasText: "Input" });
      await expect(inputDisclosure).toBeVisible();
      // Collapsed by default (native `<details>`): its payload is not
      // yet in the accessibility tree.
      await expect(inputDisclosure.locator("summary")).toHaveText("Input");
      await inputDisclosure.locator("summary").click();
      await expect(inputDisclosure).toContainText("echo hello");

      // The diff-bearing special prompt (`parseLargeAgentStreamPayloadPrompt`).
      await composerInput.fill("emit 3072 byte diff agent stream payload");
      await sendButton.click();

      const diffGroup = page.getByRole("group", { name: "Diff" });
      await expect(diffGroup).toBeVisible({ timeout: 15_000 });
      // The fake provider's synthetic payload (`buildLargeTimelineItem`'s
      // `"diff"` branch) is a real `unifiedDiff` string headed by a
      // literal `diff --git` line -- `DiffLines` renders it verbatim,
      // line by line, inside this `role="group"`.
      await expect(diffGroup).toContainText("diff --git a/src/large-diff.ts");
      // `DiffSummary`'s at-a-glance path label, alongside the full
      // `DiffLines` rendering.
      await expect(page.getByText("src/large-diff.ts").first()).toBeVisible();
    } finally {
      await session.close();
    }
  });
});
