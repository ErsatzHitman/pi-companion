/**
 * T31D — plan.md §14.5 performance budgets, enforced as a real
 * Playwright gate against a real production build and a real browser,
 * rather than numbers written down and never checked.
 *
 * Two independent budgets, two independent tests:
 *
 * 1. **Session route bundle size** — the real gzipped network payload a
 *    fresh navigation to `/h/:serverId/session/:agentId` downloads from
 *    this run's real `vite build` output (`fixtures/budget-bundle-size.ts`),
 *    must stay under 500 KiB gzip.
 * 2. **Live event-to-paint p95** — the real client-side latency from a
 *    real `agent_stream` WebSocket push arriving to its content being
 *    painted (`fixtures/budget-event-to-paint.ts`), measured across many
 *    real round trips against the isolated daemon, must stay under
 *    100 ms at the 95th percentile.
 *
 * Both budgets are logged with the measured number via `console.info`
 * regardless of pass/fail, and every failure message repeats the
 * measured number rather than just naming which budget was exceeded —
 * this task's own requirement, and plan.md §14.5's "Measure before
 * changing a budget. Do not silence a regression by raising the limit
 * without written rationale."
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";
import {
  SESSION_ROUTE_BUNDLE_BUDGET_BYTES,
  formatKiB,
  measureSessionRoutePayload,
} from "./fixtures/budget-bundle-size.js";
import {
  EVENT_TO_PAINT_P95_BUDGET_MS,
  computeP95,
  installEventToPaintInstrumentation,
  waitForAssistantPaint,
} from "./fixtures/budget-event-to-paint.js";

test.describe("performance budgets (plan.md §14.5)", () => {
  test("session route bundle stays within the 500 KiB gzip budget", async ({
    page,
    daemonConnection,
  }) => {
    await connectViaUi(page, daemonConnection, "Budget Bundle Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      const sessionUrl = `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`;
      const payload = await measureSessionRoutePayload(page, sessionUrl);

      const breakdown = payload.assets
        .slice()
        .sort((a, b) => b.gzipBytes - a.gzipBytes)
        .map((asset) => `  ${formatKiB(asset.gzipBytes)}  ${asset.url}`)
        .join("\n");
      console.info(
        `[budget] session route initial payload: ${formatKiB(payload.totalGzipBytes)} gzip ` +
          `(budget ${formatKiB(SESSION_ROUTE_BUNDLE_BUDGET_BYTES)})\n${breakdown}`,
      );

      expect(
        payload.totalGzipBytes,
        `session route initial JS+CSS measured ${formatKiB(payload.totalGzipBytes)} gzip, ` +
          `over the ${formatKiB(SESSION_ROUTE_BUNDLE_BUDGET_BYTES)} budget (plan.md §14.5).\n` +
          `Assets, largest first:\n${breakdown}`,
      ).toBeLessThanOrEqual(SESSION_ROUTE_BUNDLE_BUDGET_BYTES);
    } finally {
      await session.close();
    }
  });

  test("live event-to-paint p95 stays within the 100 ms budget", async ({
    page,
    daemonConnection,
  }) => {
    // 30 real sequential round trips against the isolated daemon, each
    // waited out fully before the next begins — comfortably over the
    // default 30s per-test timeout on a cold run.
    test.setTimeout(120_000);

    // Must be armed before the very first navigation (this test's own
    // `connectViaUi` call below) — see `installEventToPaintInstrumentation`'s
    // doc comment for why.
    await installEventToPaintInstrumentation(page);

    await connectViaUi(page, daemonConnection, "Budget Paint Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);

      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });

      // Settle on the empty state first (same race `session-lifecycle.spec.ts`
      // documents for its own turn-round-trip test) so every sample below
      // is measuring this test's own live pushes, not a resume snapshot
      // that happened to already contain them.
      const transcript = page.getByTestId("host-session-transcript");
      await expect(transcript).toContainText("No messages yet", { timeout: 15_000 });

      const SAMPLE_COUNT = 30;
      const samples: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        const marker = `budget-paint-${i}-${randomUUID().slice(0, 8)}`;
        // Registered before the send that will produce it — see
        // `waitForAssistantPaint`'s doc comment for why the ordering
        // matters.
        const paintPromise = waitForAssistantPaint(page, marker);

        await composerInput.fill(`respond with exactly: ${marker}`);
        await page.getByRole("button", { name: "Send", exact: true }).click();

        const delta = await paintPromise;
        expect(
          delta,
          `sample ${i} (marker "${marker}") never painted inside an assistant row within the wait window`,
        ).not.toBeNull();
        samples.push(delta as number);
      }

      const p95 = computeP95(samples);
      const sortedSummary = [...samples]
        .sort((a, b) => a - b)
        .map((value) => value.toFixed(1))
        .join(", ");
      console.info(
        `[budget] event-to-paint samples (ms, sorted): ${sortedSummary}\n` +
          `[budget] event-to-paint p95: ${p95.toFixed(1)} ms (budget ${EVENT_TO_PAINT_P95_BUDGET_MS} ms)`,
      );

      expect(
        p95,
        `live event-to-paint p95 measured ${p95.toFixed(1)} ms across ${SAMPLE_COUNT} samples, ` +
          `over the ${EVENT_TO_PAINT_P95_BUDGET_MS} ms budget (plan.md §14.5).\n` +
          `Samples (ms, sorted): ${sortedSummary}`,
      ).toBeLessThanOrEqual(EVENT_TO_PAINT_P95_BUDGET_MS);
    } finally {
      await session.close();
    }
  });
});
