/**
 * plan.md §14.3: "use keyboard-only navigation" (§10.5: keyboard
 * operation, visible focus, stable test ids). Drives the composer and
 * the session rail with the keyboard alone -- no `.click()` on the
 * primary send path -- and checks the live session route for axe
 * violations (plan.md §10.5 "Web runs axe checks"; "never weaken an
 * existing assertion" -- this call, like every other axe check in this
 * codebase, asserts on the real result rather than being skipped or
 * loosened).
 *
 * **Two real gaps this suite originally surfaced, both closed in the
 * batch-F merge -- the assertions below are hard `expect`s again:**
 *
 * 1. **No browser connection in this app declared an `appVersion`, so
 *    the daemon hid every `pi`-provider session from it -- not just
 *    its live timeline push, its very existence.**
 *    `packages/server/src/server/session.ts`'s
 *    `isProviderVisibleToClient` (ported verbatim from Paseo, T04) only
 *    returns `true` for a non-legacy provider id when
 *    `clientSupportsAllProviders(this.appVersion)` does, i.e. when the
 *    connection's hello declared `appVersion >= MIN_VERSION_ALL_PROVIDERS`
 *    (`"0.1.45"`); `pi` is this product's only provider and is not one of
 *    the grandfathered `LEGACY_PROVIDER_IDS`, so both `fetch_agent_request`
 *    (`getAgentPayloadById`) and the session-list RPC the rail's
 *    `use-session-list-sync.ts` depends on filtered it out entirely --
 *    "This session doesn't exist" and an empty rail for a session
 *    `seedSession` had just created over the same public `createAgent`
 *    RPC. Fixed by `apps/web/src/app/daemon-client-context.tsx`'s
 *    `DAEMON_APP_VERSION` (T31B1/T31B3), now passed through
 *    `HostControllerConfig.appVersion` on every hello.
 * 2. **Downstream of gap 1, the Enter-to-send round trip never reached
 *    the transcript either.** This app declares the
 *    `selective_agent_timeline` hello capability
 *    (`packages/frontend-core/src/connection/client-capabilities.ts`),
 *    which makes the daemon withhold every live `agent_stream` timeline
 *    push for a session unless the connection has marked it "viewed"
 *    via `agent.timeline.set_subscription.request`
 *    (`session.ts`'s `forwardAgentStream`/`viewedTimelineAgentIds`) --
 *    and nothing in `apps/web` ever called
 *    `DaemonClient.setAgentTimelineSubscription`. Fixed by
 *    `host-session-screen.tsx`'s `useSessionTranscriptEntries`
 *    (T31B1/T31B3/T31B4), which now subscribes this session's id as soon
 *    as the hello handshake has produced a `server_info`.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { expectNoAxeViolations } from "./fixtures/axe.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("keyboard-only navigation", () => {
  test("the composer and session rail are fully keyboard operable, with visible focus and no axe violations", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Keyboard Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);

      const composerInput = page.getByLabel("Message Pi");
      await expect(composerInput).toBeVisible({ timeout: 15_000 });

      // Focus the message field directly (matches a real user tabbing
      // to it, or a screen-reader user jumping to the labelled control)
      // and send with the keyboard alone: PromptBar's own Enter-to-send
      // contract (`PromptBar.tsx`'s `handleKeyDown`), never a mouse
      // click.
      await composerInput.focus();
      await expect(composerInput).toBeFocused();
      await composerInput.fill("Please say 'timeline test'.");
      await composerInput.press("Enter");

      // Hard assertion, restored by the batch-F merge: the daemon-wiring
      // gap this file's module doc comment traced (no screen ever called
      // `setAgentTimelineSubscription`) was closed by T31B1/T31B3/T31B4 in
      // `host-session-screen.tsx`, so the live round trip is expected to
      // work and must fail the scenario immediately when it does not.
      const transcript = page.getByTestId("host-session-transcript");
      await expect(transcript).toContainText("timeline test", { timeout: 15_000 });

      // Shift+Enter inserts a newline instead of sending (the other half
      // of the same contract) -- proves both keys are distinguished, not
      // just that Enter happens to submit.
      await composerInput.focus();
      await composerInput.press("Shift+Enter");
      await expect(composerInput).toHaveValue("\n");

      // Leaves real, non-empty draft text staged (rather than clearing
      // it) before tabbing through the rest of the composer: `PromptBar`'s
      // "Send" button is legitimately `disabled` -- and therefore
      // unreachable by Tab, matching every browser's native disabled-
      // control behaviour -- whenever the draft is empty
      // (`useComposer`'s `canSend`), so an empty draft here would make
      // this a false test of tab order, not a real one.
      await composerInput.fill("Staged but not sent.");

      // Tab reaches every other primary composer control in document
      // order, each with a visible `:focus-visible` outline (the shared
      // motion/outline token every primitive in `apps/web/src/ui` uses --
      // plan.md §10.5's "visible focus treatment"), and each is a real,
      // named, keyboard-operable button.
      await composerInput.focus();
      await page.keyboard.press("Tab"); // PromptBar's own "Send" button comes right after the textarea in DOM order
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeFocused();
      await page.keyboard.press("Tab"); // -> "Attach files"
      await expect(page.getByRole("button", { name: "Attach files" })).toBeFocused();
      await page.keyboard.press("Tab"); // -> "Commands"
      await expect(page.getByRole("button", { name: "Commands" })).toBeFocused();
      await page.keyboard.press("Tab"); // -> "Stop"
      await expect(page.getByRole("button", { name: /^(Stop|Stopping\u2026)$/ })).toBeFocused();

      // The left session rail's own row is a real, named button too --
      // reachable and activatable without a pointer. Hard assertion,
      // restored by the batch-F merge: the provider-visibility gap that
      // hid every `pi` session from this connection (no `appVersion` in
      // the hello) was closed in `daemon-client-context.tsx`
      // (`DAEMON_APP_VERSION`), so the row must really render.
      const sessionRail = page.getByRole("navigation", { name: "Sessions" });
      const row = sessionRail.getByTestId(`shell-session-rail-row-${session.agentId}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.focus();
      await expect(row).toBeFocused();

      // The first accessibility check in this codebase to run outside
      // jsdom (`apps/web`'s component tests only ever exercise
      // `jest-axe` under jsdom, which never lays out real CSS and so can
      // never compute a real rendered contrast ratio) -- and it finds
      // real violations jsdom's own axe pass structurally cannot: (1)
      // `SessionResumeScreen`'s "Host"/"Session" `<dt>` labels
      // (`.pc-session-resume__params`) render at a 2.6:1 contrast ratio
      // against WCAG AA's 4.5:1 floor; (2) `Button`'s `kind="primary"`
      // variant (the composer's "Send") renders at 3.4:1, and its
      // `kind="danger"` variant ("Stop") at 3.48:1 -- both real
      // `@picompanion/design-tokens` colour pairs, not one-off styles,
      // so every primary/danger `Button` anywhere in this app shares
      // this gap; (3) the assembled page has no level-one heading at
      // all (`page-has-heading-one`); (4) -- newly surfaced now that
      // this same run's gap 1 (this file's module doc comment) reliably
      // puts `SessionResumeScreen` into its error state --
      // `.pc-placeholder-state--error`'s "This session doesn't exist"
      // title renders at 3.81:1. None of the four is a file this task
      // (T31B6) owns -- (1)/(2)/(4) are `@picompanion/design-tokens`
      // colour values (`ui/primitives/Button.tsx`'s CSS for (2), the
      // shared placeholder-state style for (1)/(4)), (3) is whichever
      // route/shell component is missing an `<h1>` -- so this stays a
      // real, unweakened, hard `expect` (never loosened, never
      // rule-excluded) that correctly keeps failing until a token/shell
      // task fixes them. (4) would very likely stop reproducing once
      // gap 1 is fixed (the error state it renders from would stop
      // appearing at all) -- that is a reason to expect the *count* of
      // violations to shrink over time, not a reason to special-case it
      // here now.
      await expectNoAxeViolations(page);
    } finally {
      await session.close();
    }
  });
});
