import { describe, expect, it } from "vitest";

import { extensions, testing, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * T40A3 — "Action round-trips are verified per extension."
 *
 * For every §11.7 fixture that exposes an action (ten of the twelve; see
 * `NO_ACTION_EXTENSIONS` below for the two that don't and why), replays the
 * fixture's own `client_to_daemon` request through a real
 * `extensions.ExtensionActionController` and feeds back the fixture's own
 * `daemon_to_client` acknowledgment(s), proving the round trip end to end:
 *
 * 1. `controller.dispatch(...)` sends the *exact* wire message the fixture
 *    recorded as the daemon-bound request (byte-for-byte `toEqual`, not
 *    "some request was sent") — the same real `ExtensionActionController`
 *    every renderer's bound `dispatchAction` closes over
 *    (`apps/web/src/features/extensions/registry-view.tsx`).
 * 2. The fixture's own `pi.ui.action.response` and, where present, its
 *    `pi_ui_action_result` are ingested through the controller's real
 *    `ingestActionResponse`/`ingestAgentStreamEvent` methods.
 * 3. The dispatch promise settles to the outcome the fixture's own
 *    acknowledgment(s) declare (`ok: true` -> `"success"`).
 *
 * Uses T40A2's real fixtures (`testing.extensions`, T98) throughout — no
 * hand-rolled payloads.
 */

/**
 * `minimal-status` is read-only status text (plan.md §11.7: "native status
 * information") and `pi-goal` only ever carries an informational
 * `status`/`progress` pair (plan.md §11.7: "goal status, rounds, budget,
 * blocked/waiting state") — neither fixture includes a `client_to_daemon`
 * frame because plan.md's own required-UI text for both rows names no
 * action. `docs/pi-extension-compatibility.md` §3.3 agrees: `minimal-status`
 * is explicitly "Actions none — read-only footer"; `pi-goal`'s only listed
 * actions are model-side tool calls and a separate `/goal` CLI command, not
 * a bridge element action.
 */
const NO_ACTION_EXTENSIONS = ["minimal-status", "pi-goal"];

const ACTION_EXTENSIONS = testing.extensions
  .listExtensionFixtures()
  .filter((extension) => !NO_ACTION_EXTENSIONS.includes(extension));

it("every §11.7 fixture not listed as action-free actually has no client_to_daemon frame, and every other one does", () => {
  for (const extension of testing.extensions.listExtensionFixtures()) {
    const scenario = testing.extensions.loadExtensionFixture(extension);
    const hasRequest = scenario.frames.some((frame) => frame.direction === "client_to_daemon");
    expect(
      hasRequest,
      `${extension}: expected client_to_daemon presence to match NO_ACTION_EXTENSIONS`,
    ).toBe(!NO_ACTION_EXTENSIONS.includes(extension));
  }
});

/** Deterministic no-op `Clock` — no timer ever needs to fire in these tests. */
class NullClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

/** Every top-level upserted element across a scenario's frames, in order. */
function upsertElements(extension: string): PiUiElement[] {
  const scenario = testing.extensions.loadExtensionFixture(extension);
  const elements: PiUiElement[] = [];
  for (const frame of scenario.frames) {
    if (!frame.wireType.includes("agent_stream:pi_ui_delta")) continue;
    const event = testing.extensions.agentStreamEventFromFrame(frame);
    if (event.type !== "pi_ui_delta" || event.delta.op !== "upsert") continue;
    elements.push(event.delta.element);
  }
  return elements;
}

/**
 * `namespace` never travels on a `pi.ui.action.request` (plan.md §12.3: the
 * wire carries only `elementId`/`actionId`; the daemon resolves `ns`
 * server-side against its own state). A renderer always has it because it
 * read the element it is rendering — this mirrors that by finding the
 * fixture's own upserted element with a matching bare id.
 */
function namespaceOf(extension: string, elementId: string): string {
  const owner = upsertElements(extension).find((el) => el.id === elementId);
  if (!owner) {
    throw new Error(`fixture "${extension}" has no upserted element with id "${elementId}"`);
  }
  return owner.ns;
}

describe.each(ACTION_EXTENSIONS)("§11.7 action round-trip — %s", (extension) => {
  const scenario = testing.extensions.loadExtensionFixture(extension);
  const requestFrame = scenario.frames.find((frame) => frame.direction === "client_to_daemon");
  if (!requestFrame)
    throw new Error(`fixture "${extension}" is in ACTION_EXTENSIONS but has no request frame`);

  const requestMessage = testing.extensions.sessionInboundMessageFromFrame(requestFrame);
  if (requestMessage.type !== "pi.ui.action.request") {
    throw new Error(
      `fixture "${extension}"'s client_to_daemon frame was not a pi.ui.action.request`,
    );
  }

  const responseFrame = scenario.frames.find(
    (frame) => frame.wireType === "session(pi.ui.action.response)",
  );
  const resultFrame = scenario.frames.find(
    (frame) => frame.wireType === "session(agent_stream:pi_ui_action_result)",
  );

  it("dispatch sends exactly the fixture's own pi.ui.action.request", () => {
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: (message) => sent.push(message),
    });

    void controller.dispatch({
      agentId: requestMessage.agentId,
      namespace: namespaceOf(extension, requestMessage.elementId),
      elementId: requestMessage.elementId,
      actionId: requestMessage.actionId,
      payload: requestMessage.payload,
      requestId: requestMessage.requestId,
    });

    expect(sent).toEqual([requestMessage]);
  });

  it("settles to the outcome the fixture's own acknowledgment(s) declare", async () => {
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: () => {},
    });
    const namespace = namespaceOf(extension, requestMessage.elementId);

    const settled = controller.dispatch({
      agentId: requestMessage.agentId,
      namespace,
      elementId: requestMessage.elementId,
      actionId: requestMessage.actionId,
      payload: requestMessage.payload,
      requestId: requestMessage.requestId,
    });

    if (responseFrame) {
      const responseMessage = testing.extensions.sessionOutboundMessageFromFrame(responseFrame);
      if (responseMessage.type !== "pi.ui.action.response") {
        throw new Error(`fixture "${extension}"'s response frame was not a pi.ui.action.response`);
      }
      controller.ingestActionResponse(responseMessage.payload);
    }

    if (resultFrame) {
      const resultEvent = testing.extensions.agentStreamEventFromFrame(resultFrame);
      if (resultEvent.type !== "pi_ui_action_result") {
        throw new Error(`fixture "${extension}"'s result frame was not a pi_ui_action_result`);
      }
      const outcome = controller.ingestAgentStreamEvent(requestMessage.agentId, resultEvent);
      expect(
        outcome,
        `ingestAgentStreamEvent did not settle a pending action for "${extension}"`,
      ).not.toBeNull();

      const resolved = await settled;
      expect(resolved.status).toBe(resultEvent.result.ok ? "success" : "rejected");
      expect(resolved.requestId).toBe(requestMessage.requestId);
      expect(resolved.target).toEqual({
        agentId: requestMessage.agentId,
        namespace,
        elementId: requestMessage.elementId,
        actionId: requestMessage.actionId,
      });
    } else if (responseFrame) {
      // Two fixtures (`todo`'s collapse, `plan-mode`'s toggle) record only
      // the synchronous `pi.ui.action.response` on the wire, with no
      // `pi_ui_action_result` frame — this is exactly what those fixtures
      // show, not an assumption. Per `ExtensionActionController`'s own
      // documented contract (`action-controller.ts`'s header comment:
      // "`ok: true` only marks the request as routed; the action stays
      // pending until the matching `pi_ui_action_result`"), the action
      // is legitimately still `"pending"` after only a routed response —
      // asserted here so a future change to either the fixture or the
      // controller's settlement rule is caught, rather than silently
      // treating an unresolved promise as trivially "verified".
      const responseMessage = testing.extensions.sessionOutboundMessageFromFrame(responseFrame);
      if (responseMessage.type !== "pi.ui.action.response") {
        throw new Error(`fixture "${extension}"'s response frame was not a pi.ui.action.response`);
      }
      const state = controller.getActionState({
        agentId: requestMessage.agentId,
        namespace,
        elementId: requestMessage.elementId,
        actionId: requestMessage.actionId,
      });
      expect(state.status).toBe(responseMessage.payload.ok ? "pending" : "rejected");
    } else {
      throw new Error(`fixture "${extension}" has a request frame but no response or result frame`);
    }
  });
});

describe("§11.7 action round-trip — mutation sentinel", () => {
  // "A fix that no test can fail is not a fix": prove the exact-match
  // assertion above actually discriminates, by corrupting one fixture field
  // and confirming the dispatched message no longer equals it.
  it("fails the request-equality assertion when the fixture's payload is mutated", () => {
    const scenario = testing.extensions.loadExtensionFixture("loop");
    const requestFrame = scenario.frames.find((frame) => frame.direction === "client_to_daemon")!;
    const requestMessage = testing.extensions.sessionInboundMessageFromFrame(requestFrame);
    if (requestMessage.type !== "pi.ui.action.request")
      throw new Error("expected an action request");

    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: (message) => sent.push(message),
    });
    void controller.dispatch({
      agentId: requestMessage.agentId,
      namespace: namespaceOf("loop", requestMessage.elementId),
      elementId: requestMessage.elementId,
      actionId: requestMessage.actionId,
      payload: requestMessage.payload,
      requestId: requestMessage.requestId,
    });

    const corrupted = { ...requestMessage, actionId: "not-the-real-action" };
    expect(sent).not.toEqual([corrupted]);
    expect(sent).toEqual([requestMessage]);
  });

  // Proves `ingestAgentStreamEvent` really is load-bearing for settlement —
  // without feeding it the result frame, the same dispatch never resolves
  // to "success" (it would still be pending), so the round-trip assertion
  // above is not vacuously true regardless of what is fed back.
  it("stays pending forever if the result frame is never ingested, for a fixture that has one", async () => {
    const scenario = testing.extensions.loadExtensionFixture("loop");
    const requestFrame = scenario.frames.find((frame) => frame.direction === "client_to_daemon")!;
    const requestMessage = testing.extensions.sessionInboundMessageFromFrame(requestFrame);
    if (requestMessage.type !== "pi.ui.action.request")
      throw new Error("expected an action request");
    const responseFrame = scenario.frames.find(
      (frame) => frame.wireType === "session(pi.ui.action.response)",
    )!;
    const responseMessage = testing.extensions.sessionOutboundMessageFromFrame(responseFrame);
    if (responseMessage.type !== "pi.ui.action.response") throw new Error("expected a response");

    const namespace = namespaceOf("loop", requestMessage.elementId);
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: () => {},
    });
    void controller.dispatch({
      agentId: requestMessage.agentId,
      namespace,
      elementId: requestMessage.elementId,
      actionId: requestMessage.actionId,
      payload: requestMessage.payload,
      requestId: requestMessage.requestId,
    });
    controller.ingestActionResponse(responseMessage.payload);

    const state = controller.getActionState({
      agentId: requestMessage.agentId,
      namespace,
      elementId: requestMessage.elementId,
      actionId: requestMessage.actionId,
    });
    expect(state.status).toBe("pending");
  });
});
