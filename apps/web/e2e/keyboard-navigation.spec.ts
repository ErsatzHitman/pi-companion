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
 *    `isProviderVisibleToClient` (ported verbatim from Paseo, T04) used to
 *    return `true` for a non-legacy provider id only when
 *    `clientSupportsAllProviders(this.appVersion)` did, i.e. when the
 *    connection's hello declared `appVersion >= MIN_VERSION_ALL_PROVIDERS`
 *    (`"0.1.45"`); `pi` is this product's only provider and was not one of
 *    the grandfathered `LEGACY_PROVIDER_IDS`, so both `fetch_agent_request`
 *    (`getAgentPayloadById`) and the session-list RPC the rail's
 *    `use-session-list-sync.ts` depends on filtered it out entirely --
 *    (CORRECTED, T262: that gate is now retired -- `isProviderVisibleToClient`
 *    is an unconditional `true` -- but declaring `appVersion` below is still
 *    required for `session.ts`'s separate, still-real
 *    `clientUsesLegacyWorkspaceRestore` gate; see `plan.md` §18 item 13.)
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
 *
 * 3. **FIX-CI5: the Stop-button Tab-order assertion below was itself a
 *    stale spec.** `Composer.tsx`'s Stop control used to render on
 *    every connected session regardless of turn state (`canAbort` never
 *    consulted turn status at all); `be45254` (FIX-L2) fixed that real
 *    live-deployment defect by gating it on `useAgentTurnStatus`'s live
 *    `AgentSnapshotPayload.status` signal too, so Stop is now correctly
 *    ABSENT on the idle session this spec seeds -- exactly what
 *    `Composer.test.tsx` already asserted was right. The idle Tab walk
 *    below now asserts that absence explicitly instead of tabbing into a
 *    control that is no longer there. A route that instead sent this
 *    spec's own `/sleep/i` message (the same fixture
 *    `session-steer-and-follow-up.spec.ts` uses) to drive a genuinely
 *    active turn *inside this spec* was tried and measured, not assumed:
 *    the tool call ran and completed (visible in the transcript) while
 *    `getByRole("button", { name: "Stop" }).toBeVisible()` never once
 *    observed it across a 10s poll, meaning the daemon's live
 *    `agent_update`/`status: "running"` push this hook depends on does
 *    not surface reliably for a turn this short-lived within this
 *    harness -- a real timing property of the daemon/harness, not a bug
 *    in the assertion. Reachability, focus, and keyboard activation of
 *    Stop during a real turn are instead asserted in
 *    `session-steer-and-follow-up.spec.ts`, which already drives one
 *    that stays open long enough for its own steer assertions.
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
      // named, keyboard-operable button. There is no standalone "Commands"
      // toggle any more: `Composer.tsx`'s own doc comment records that
      // typing "/" as the entire draft already opens the slash palette
      // (`useSlashCommands`'s `isBareSlashPrefix`), so after "Attach files"
      // Tab instead reaches the metadata row's three popover-trigger chips
      // (Model, Routing, Queue -- each a real button with
      // `aria-haspopup`/`aria-expanded`, opening the same picker the old
      // UI kept in a sheet). The "Stop" icon button used to come right
      // after Queue in this same idle walk; FIX-L2 (`be45254`, this
      // file's module doc item 3) fixed a real defect where it rendered
      // on every connected session regardless of turn state, so it now
      // renders only while `useAgentTurnStatus` reports a genuinely
      // active turn -- this idle session correctly has no Stop control to
      // tab into at all. The two blocks below assert that absence
      // explicitly, then drive a real turn to prove Stop's active
      // contract instead.
      await composerInput.focus();
      await page.keyboard.press("Tab"); // PromptBar's own "Send" button comes right after the textarea in DOM order
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeFocused();
      await page.keyboard.press("Tab"); // -> "Attach files"
      await expect(page.getByRole("button", { name: "Attach files" })).toBeFocused();
      // UI-X1 moved the model, routing and queue pickers OFF the chip row
      // this walk used to Tab through and back inside the context ring's
      // popover, restoring the reference's ring-opens-the-menu design. The
      // three chips no longer exist as standalone buttons, so the old three
      // `toBeFocused()` steps here failed with "element(s) not found" — the
      // controls did not lose keyboard reachability, the ROUTE to them
      // changed, and this contract has to follow it rather than pin a DOM
      // shape the product deliberately left behind.
      //
      // The ring sits BEFORE the textarea in `.pc-prompt-bar__row` (ring →
      // textarea → send → attach, see `PromptBar`'s own module doc), so it is
      // reached by tabbing BACKWARD from the input, not forward past attach.
      const contextRing = page.getByRole("button", { name: /^Session controls/ });
      await composerInput.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(contextRing).toBeFocused();
      await expect(contextRing).toHaveAttribute("aria-haspopup", "dialog");
      await expect(contextRing).toHaveAttribute("aria-expanded", "false");

      // Opened from the keyboard alone, the popover exposes the same controls
      // the chip row used to — which is what this block always cared about.
      //
      // They are COMBOBOXES here, not buttons. That is not a detail worth
      // glossing: on the chip row each chip was itself a popover trigger
      // (`aria-haspopup="dialog"`), so the old assertions matched buttons by
      // the chip's summary text ("E2E Fake Model", "Routing: Auto"). Inside
      // the popover the same pickers render their `<select>` directly, with no
      // second popover layer, so matching a button here finds nothing at all
      // — which is exactly how the first version of this fix failed. Asserted
      // against the real, current shape rather than the one this walk
      // remembered.
      await page.keyboard.press("Enter");
      await expect(contextRing).toHaveAttribute("aria-expanded", "true");
      const popover = page.getByRole("dialog", { name: "Session controls" });
      for (const name of [
        "Send this message as",
        "Model",
        "Thinking level",
        "Steering queue delivery",
        "Follow-up queue delivery",
      ]) {
        await expect(popover.getByRole("combobox", { name })).toBeVisible({ timeout: 15_000 });
      }

      // POPOVER-1: this is now an ANCHORED, UNDIMMED popover -- never the
      // app's modal `Sheet` -- which drops the modal scrim and the Tab trap
      // by definition. `Composer.tsx`'s own module doc comment states what
      // the rest of the modal contract does instead; the two
      // keyboard-observable halves of it are asserted directly below,
      // rather than the "the keypress alone proves it" reasoning this test
      // used to lean on for the (now-removed) focus trap.
      //
      // Focus on open: moved into the popover's first focusable control.
      // Unlike `ui/primitives/Popover.tsx` (whose trigger and content are
      // DOM siblings, so an unforced Tab from the trigger already reaches
      // the content next), this panel is not a DOM sibling of the ring --
      // it renders at the end of `.pc-composer`, positioned purely by CSS
      // -- so leaving focus on the trigger would force a keyboard user to
      // tab through the rest of the prompt row first.
      const firstControl = popover.getByRole("combobox", { name: "Send this message as" });
      await expect(firstControl).toBeFocused();

      // No trap: Shift+Tab from the popover's first control leaves the
      // popover entirely rather than wrapping to its own last control --
      // the direct, disclosed consequence of not using
      // `ui/primitives/use-modal-behavior.ts`. It lands on "Attach files",
      // the real control `PromptBar`'s own DOM order (ring -> textarea ->
      // send -> attach, see that recipe's own module doc) puts immediately
      // before this popover; Stop is absent on this idle session (FIX-L2,
      // this file's module doc item 3), so nothing sits between them. The
      // popover itself stays open (no auto-close-on-blur either) -- only
      // Escape, an outside click, or a control inside it closes it.
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "Attach files" })).toBeFocused();
      await expect(popover).toBeVisible();

      // Focus restoration on close: PRESERVED, not dropped along with the
      // trap -- losing it would be a regression, not a simplification. It
      // is conditional on focus still being inside the popover at the
      // moment it closes (`Composer.tsx`'s own `closeSessionControls`), so
      // this moves focus back into the popover deliberately first, rather
      // than pressing Escape from "Attach files" above (where it would
      // correctly NOT restore focus, since nothing inside the popover was
      // focused when the popover closed).
      await firstControl.focus();
      await expect(firstControl).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(contextRing).toHaveAttribute("aria-expanded", "false");
      await expect(contextRing).toBeFocused();

      // FIX-CI5: Stop is honestly ABSENT here -- this session is idle
      // (FIX-L2, see this file's module doc item 3) -- a hard assertion
      // of that absence rather than tabbing into a control that no
      // longer exists on an idle session. Stop's *active*-turn contract
      // (present, keyboard-reachable, focus-visible) is asserted instead
      // in `session-steer-and-follow-up.spec.ts`, which already drives a
      // real turn that stays open long enough to assert against -- see
      // this file's module doc item 3 for why that turn could not be
      // driven reliably inside this spec itself.
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);

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
