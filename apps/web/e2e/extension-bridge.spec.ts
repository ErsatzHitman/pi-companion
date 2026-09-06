/**
 * T31C2 — Pi extension bridge scenarios (plan.md §11, the ten-kind Pi UI
 * Bridge renderer registry, and §11.5's rail placement rules; §12.3 for
 * action-dispatch identity/confirmation).
 *
 * Two of this spec's three prompts are driven through
 * `fake-pi-agent-client.ts`'s T31C2 additions — `"emit ui widget
 * element"` and `"emit ui malformed element"` — which emit a real
 * `pi_ui_state` `AgentStreamEvent` carrying one `PiUiElement`, keyed to
 * the real daemon-assigned `agentId` (see that file's own doc comment
 * for why `agentId`, not the fake session's own persistence id, is what
 * `PiUiElementStore`/`usePiUiRailElements` actually key by). Nothing here
 * touches `packages/server/.../pi/ui-bridge/decoder.ts` — that module
 * only parses the real Pi runtime's raw `/PIUI` marker text off `notify`
 * events (`providers/pi/agent.ts:2033`), a path this fake fixture never
 * exercises; it bypasses the wire entirely and emits an already-typed
 * `AgentStreamEvent` directly. So "malformed" below means malformed
 * relative to `@picompanion/frontend-core`'s own canonical-payload
 * normalization (`normalizePiUiElement`), the one boundary this harness
 * can actually reach — not a decoder-level rejection test.
 *
 * **Third acceptance criterion, left honestly untested — "an extension
 * action round-trips to the daemon and back":** this cannot be written as
 * a passing scenario today; the round trip does not exist yet.
 * `ExtensionRailContent`'s `sendRequest` (`apps/web/src/routes/
 * root-route.tsx:253-261`, with the gap spelled out in that component's
 * own doc comment at :209-241) never calls anything on `DaemonClient` —
 * it only logs a warning ("Pi UI action dispatch is not supported yet")
 * and returns. `packages/client/src/daemon-client.ts` has no method that
 * sends a `pi.ui.action.request` message at all (grep the file for
 * `pi.ui`/`pi_ui`: zero matches), and no generic/raw session-message
 * sender is exposed as an escape hatch either. Even with a client-side
 * sender, this harness's fake `pi` session could not service the request
 * server-side: `packages/server/src/server/session.ts`'s
 * `getPiUiStateStore` (:265-271) requires `agent.session
 * .getUiBridgeStateStore()`, a method only the real `PiAgentSession`
 * implements — `FakePiAgentSession` (`fixtures/fake-pi-agent-client.ts`)
 * has no such method, so `dispatchPiUiMessage` (`session.ts:1913-1925`)
 * would reject with `"Pi UI bridge is not active for agent <id>"` before
 * ever reaching the fake session's own turn logic. Both the client-side
 * sender and the fake provider's server-side routing are missing pieces
 * this task does not own (`root-route.tsx`'s own comment names
 * `packages/client` and points at T51). The only real, observable
 * behavior an E2E test could assert today is: click an action button ->
 * its state goes `"pending"` ("Working…", `element-actions.tsx:82`) ->
 * stays pending until `ExtensionActionController`'s hardcoded 60s default
 * timeout (`packages/frontend-core/src/extensions/action-controller.ts:225`)
 * -> settles `"Timed out"`. That is a failure outcome, not a round trip —
 * asserting it as this criterion's expected result would be asserting
 * failure-as-success, and asserting it honestly would need ~60 real
 * seconds against this harness's default Playwright test timeout. Rather
 * than fabricate a passing round trip or silently drop the criterion,
 * this file leaves it unwritten: fixing it requires a real
 * `pi.ui.action.request` sender in `packages/client` and real
 * `getUiBridgeStateStore()` support in the fake provider, neither of
 * which `apps/web/e2e/extension-bridge.spec.ts` (the one file this task
 * owns) can add.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";
import type { Page } from "@playwright/test";

/**
 * Same real "the live client this screen needs is ready" wait every
 * other T31B/T31C spec uses before touching the composer (see
 * `approvals.spec.ts`'s own copy of this helper for the full race this
 * guards against: the composer input renders unconditionally, but a
 * message sent before `SessionResumeScreen`'s resume call actually
 * resolves is silently dropped into a local-only outbox and never
 * reaches the transcript).
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

test.describe("Pi extension bridge", () => {
  test("a live Pi extension renders through the bridge into the extension rail", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Extension Rail Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);
      const { composerInput, sendButton } = await waitForReadySession(page);

      const extensionRail = page.getByTestId("shell-extension-rail");
      await expect(extensionRail).toBeVisible();
      // Positive proof of the "before" state, not just an absence check on
      // its own: the rail starts genuinely empty for this fresh session,
      // so the list that appears below is a real transition this element
      // actually caused, not content that was already there.
      await expect(page.getByTestId("pi-extension-rail-empty")).toBeVisible();

      await composerInput.fill("emit ui widget element");
      await sendButton.click();

      // The full bridge path: fake session -> AgentManager.dispatchStream
      // -> `agent_stream` WS message -> DaemonClient -> ExtensionRailContent's
      // PiUiElementStore.ingestFullState -> usePiUiRailElements ->
      // PiExtensionRail -> RailElementCard -> PiUiElementView -> WidgetRenderer.
      const railList = page.getByTestId("pi-extension-rail-list");
      await expect(railList).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("pi-extension-rail-empty")).toHaveCount(0);

      const card = page.getByTestId("pi-rail-element-e2e-demo");
      await expect(card).toBeVisible();

      const widget = page.getByTestId("pi-widget-e2e-demo");
      await expect(widget).toBeVisible();
      // The element's real title, and its `payload.rows` content
      // (`WidgetBody` prefers `rows` over `text`/`lines` when rows are
      // present — `fake-pi-agent-client.ts`'s "widget" branch sends both a
      // `rows` entry and a `text` fallback, so asserting the row content
      // is what actually distinguishes "the real payload rendered" from
      // "some placeholder rendered").
      await expect(widget.locator("h3")).toHaveText("E2E Demo Widget");
      await expect(widget).toContainText("Status");
      await expect(widget).toContainText("ready");

      // The element's declared action ("Acknowledge") renders in a real,
      // labeled action group — proving the bridge carried the element's
      // `actions` array through intact, not just its display payload.
      const actionsGroup = page.getByRole("group", { name: "E2E Demo Widget actions" });
      await expect(actionsGroup).toBeVisible();
      await expect(actionsGroup.getByRole("button", { name: "Acknowledge" })).toBeVisible();
    } finally {
      await session.close();
    }
  });

  test("an unknown or malformed payload degrades visibly instead of crashing the rail", async ({
    page,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Malformed Extension Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);
      const { composerInput, sendButton } = await waitForReadySession(page);

      await composerInput.fill("emit ui malformed element");
      await sendButton.click();

      // The element is still wire-valid (`PiUiElementSchema.rows` is a
      // loose `z.array(z.unknown())`, so DaemonClient's outbound-message
      // validation lets it through) — it reaches the rail as a real
      // pinned element, not a dropped message. The rail's structure
      // survives intact around it: the list mounts, and it is this
      // element's own card, not an empty rail or a blank pane.
      const railList = page.getByTestId("pi-extension-rail-list");
      await expect(railList).toBeVisible({ timeout: 10_000 });

      const card = page.getByTestId("pi-rail-element-e2e-demo-malformed");
      await expect(card).toBeVisible();

      // `normalizePiUiElement` lifts the legacy top-level `rows: ["not-an-
      // object"]` into a `widget` payload candidate, `PiUiWidgetPayloadSchema`
      // rejects it (rows must be row objects), and normalization returns
      // the element with no `payload` attached -- `PiUiElementView` then
      // renders the registry's own "payload could not validate" fallback
      // instead of throwing or rendering nothing (`registry-view.tsx`'s
      // `ExtensionDiagnostic`, `role="status"` per `Banner`).
      const diagnosticView = page.getByTestId("pi-rail-element-e2e-demo-malformed-view");
      await expect(diagnosticView).toBeVisible();
      const banner = diagnosticView.getByRole("status");
      await expect(banner).toHaveText(
        "Element payload could not be validated — This \"widget\" element's payload does not match its kind's shape.",
      );
      // The diagnostic names its own source (namespace, element id, kind)
      // so a real malformed element is distinguishable from any other --
      // this is not a generic "something went wrong" message.
      await expect(diagnosticView).toContainText("source: e2e:demo-malformed (widget)");
      // The raw wire payload stays reachable behind a disclosure rather
      // than being discarded -- degrade, don't destroy the evidence.
      await expect(diagnosticView.getByRole("button", { name: "Show raw details" })).toBeVisible();

      // "Degrades visibly instead of crashing the rail" is a claim about
      // the whole rail, not just this one card: the enclosing `aside`
      // never unmounted (an uncaught render error here would have taken
      // the parent tree with it, since `ExtensionElementBoundary` only
      // catches inside its own subtree), and the app around it kept
      // working -- the composer that produced this turn is still live and
      // accepts more input.
      await expect(page.getByTestId("shell-extension-rail")).toBeVisible();
      await expect(composerInput).toBeEditable();
    } finally {
      await session.close();
    }
  });
});
