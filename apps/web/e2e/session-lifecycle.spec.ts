/**
 * plan.md §14.3: "create and run a Pi session".
 *
 * This suite used to document a live gap first, before proving the
 * rest of the lifecycle worked: the "New session" UI on
 * `/h/:serverId/sessions` never reached a live daemon
 * (`host-sessions-screen.tsx` never passed `SessionsScreen` a `client`
 * prop), even once a browser had a fully authenticated connection
 * open. T53A4 closed that gap (`host-sessions-screen.tsx` now builds
 * its `client`/`discoveredClient` from `useDaemonClientContext()`), so
 * this suite's first two tests now drive the real "New session" UI
 * affordance end to end: fill in the dialog, submit it against the
 * live daemon, and follow the create-then-open navigation
 * `SessionsScreen.handleCreated` performs.
 *
 * The third test proves this file's third acceptance criterion for
 * real: a turn sent from the composer runs end to end on the live
 * daemon and both halves of the exchange (the user row and the fake
 * provider's deterministic reply) arrive in the rendered transcript
 * over the real `agent_stream` socket.
 *
 * That test was, briefly, an inverted "documents the known gap" test:
 * while T31B2 was in flight, no screen in `apps/web` ever called
 * `DaemonClient.setAgentTimelineSubscription()`, and this app's hello
 * declares the `selective_agent_timeline` capability
 * (`frontend-core`'s `PI_COMPANION_CLIENT_CAPABILITIES`), so the daemon
 * (`packages/server/src/server/session.ts`'s
 * `usesSelectiveTimelineDelivery`/`forwardAgentStream`) withheld every
 * live `agent_stream` push even though the turn really ran
 * (`send_agent_message_response { accepted: true }` plus an
 * `agent_attention_required` carrying the reply text). T31B1/T31B3/T31B4
 * closed exactly that gap in `host-session-screen.tsx`
 * (`useSessionTranscriptEntries` now subscribes this session's id once
 * the hello handshake has produced a `server_info`), so the original,
 * stronger assertions are restored here rather than left inverted.
 *
 * Two determinism fixes, both inside this file's own scope: (1) this
 * run's `global-setup.ts` starts exactly one daemon shared by every
 * spec file, so by the time this suite's first two tests run,
 * earlier specs have already seeded sessions on host id `e2e-host` --
 * an unscoped `getByRole("heading", { name: "Sessions" })` then
 * matches both the left rail's own "Sessions" heading
 * (`root-route.tsx`) and this screen's, tripping Playwright strict
 * mode. Every heading lookup below is scoped to `shell-center` (the
 * routed screen body, `shell.tsx`) to name the one this suite
 * actually means. (2) the third test now waits for the transcript to
 * settle on "No messages yet" *before* sending, closing a separate,
 * unrelated race where `host-session-screen.tsx`'s mount-time
 * `resumeSession` snapshot fetch can still be in flight when this
 * test's own send completes on a busy shared daemon, so it resolves
 * with that exchange already inside it -- a resume-snapshot timing
 * race, not the live-stream-forwarding gap this test documents.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("session lifecycle", () => {
  test("creates a session from the UI against the live daemon", async ({
    page,
    daemonConnection,
  }) => {
    await connectViaUi(page, daemonConnection, "Lifecycle Daemon");

    // A real directory on the machine the isolated daemon runs on --
    // the daemon's `createAgent` RPC validates `cwd` exists before it
    // will create the agent (see the "Working directory does not
    // exist" error this same dialog surfaces for a bad path, covered
    // by this suite's second test).
    const cwd = await mkdtemp(path.join(os.tmpdir(), "picompanion-e2e-ui-session-"));
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/sessions`);
      // Scoped to `shell-center` (the routed screen body, `shell.tsx`),
      // not the whole page: earlier spec files in this run's one shared
      // daemon (`global-setup.ts` starts it once per invocation) already
      // seed sessions on this same host id, so by the time this test
      // runs, the *left* rail (`root-route.tsx`'s own `Section
      // title="Sessions" id="shell-session-rail"`) also renders a
      // "Sessions" heading alongside this centre screen's -- an
      // unscoped `getByRole("heading", { name: "Sessions" })` matches
      // both and trips Playwright strict mode. This screen's own
      // heading is the one this test actually means to assert on.
      const centerScreen = page.getByTestId("shell-center");
      await expect(centerScreen.getByRole("heading", { name: "Sessions" })).toBeVisible();

      await page.getByTestId("create-session-trigger").click();
      await expect(page.getByTestId("create-session-dialog")).toBeVisible();
      await page.getByTestId("create-session-cwd-field").fill(cwd);
      await page.getByRole("button", { name: "Create", exact: true }).click();

      // A successful create closes the dialog and navigates straight
      // into the session it just made (`SessionsScreen.handleCreated`)
      // -- proof the click reached the live daemon's `createAgent` RPC,
      // not a client-only stub.
      await expect(page.getByTestId("create-session-dialog")).toBeHidden({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/h\/e2e-host\/session\/[^/]+$/);

      // The session route itself resolves against the same live
      // daemon (`SessionResumeScreen`, T27B3/T53A2): the composer
      // renders instead of an error/loading state.
      await expect(page.getByLabel("Message Pi")).toBeVisible({ timeout: 15_000 });
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  test("surfaces a clear daemon-side error when the working directory is invalid, without losing typed input", async ({
    page,
    daemonConnection,
  }) => {
    await connectViaUi(page, daemonConnection, "Bad Cwd Daemon");

    await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/sessions`);
    // Scoped to `shell-center`; see the first test's comment above for
    // why an unscoped heading locator trips Playwright strict mode once
    // earlier spec files have seeded sessions on this run's one shared
    // daemon.
    await expect(
      page.getByTestId("shell-center").getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();

    await page.getByTestId("create-session-trigger").click();
    await expect(page.getByTestId("create-session-dialog")).toBeVisible();
    const badCwd = path.join(os.tmpdir(), "picompanion-e2e-does-not-exist");
    await page.getByTestId("create-session-cwd-field").fill(badCwd);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // The click reached the live daemon (not a client-only stub): the
    // daemon's own `createAgent` validation rejected the path, and the
    // dialog stays open with the typed value intact rather than
    // silently swallowing the click or pretending to have succeeded.
    const errorBanner = page.getByTestId("create-session-error-banner");
    await expect(errorBanner).toContainText("Working directory does not exist", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("create-session-dialog")).toBeVisible();
    await expect(page.getByTestId("create-session-cwd-field")).toHaveValue(badCwd);
  });

  test("runs a turn end to end and streams the whole exchange into the transcript", async ({
    page,
    daemonConnection,
  }) => {
    await connectViaUi(page, daemonConnection, "Turn Round Trip Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);

      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });

      // Wait for `useSessionTranscriptEntries`'s own mount-time
      // `resumeSession` snapshot fetch (`host-session-screen.tsx`) to
      // resolve and settle on "no messages yet" *before* sending --
      // otherwise, on a busy shared daemon (this run's one daemon
      // accumulates sessions and history across every earlier spec
      // file), that one-shot snapshot request can still be in flight
      // when the send below completes, so it resolves with this
      // exchange already inside it and the assertions below would pass
      // without the live `agent_stream` path ever having delivered
      // anything. Confirming the snapshot is applied and empty first
      // closes that race: everything asserted after this point can only
      // have arrived over the real live socket.
      const transcript = page.getByTestId("host-session-transcript");
      await expect(transcript).toContainText("No messages yet", { timeout: 15_000 });

      await composerInput.fill("Please say 'timeline test'.");
      await page.getByRole("button", { name: "Send", exact: true }).click();

      // The submit is registered locally (the outbox write + optimistic
      // row happen before any daemon round trip -- `use-composer.ts`),
      // so the draft clears immediately.
      await expect(composerInput).toHaveValue("");

      // The user turn itself comes back over the live `agent_stream`
      // socket (the daemon synthesizes a `user_message` timeline row for
      // every accepted send) and is reconciled by `TimelineCoalescer`
      // (T45A2/T45A3) into the rendered transcript.
      await expect(transcript).toContainText("Please say 'timeline test'.", {
        timeout: 15_000,
      });

      // The fake provider's deterministic reply
      // (`fake-pi-agent-client.ts`'s assistant text) for this exact
      // phrasing, streamed back over that same real socket.
      await expect(transcript).toContainText("timeline test", { timeout: 15_000 });

      // No send error surfaced (`StatusIndicator` only renders a "Send:"
      // label when `sendError` is set -- see `Composer.tsx`).
      await expect(page.locator(".pc-status__label", { hasText: "Send:" })).toHaveCount(0);
    } finally {
      await session.close();
    }
  });
});
