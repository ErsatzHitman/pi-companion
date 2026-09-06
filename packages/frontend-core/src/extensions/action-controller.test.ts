import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";
import type { Clock, TimerHandle } from "../platform/clock.js";
import {
  ExtensionActionConfirmationRequiredError,
  ExtensionActionController,
  extensionActionTargetKey,
  getActionConfirmation,
  requiresConfirmation,
  type ExtensionActionTarget,
  type PiUiActionRequestMessage,
  type PiUiActionResponseMessage,
} from "./action-controller.js";

/**
 * Extension action controller (T21C, plan.md §12.3). Acceptance criteria
 * exercised here:
 *
 * - "Action round-trip, rejection, timeout, and stale-revision fixtures
 *   pass" — the round-trip describe block below replays every recorded
 *   `packages/protocol/src/fixtures/pi-ui-bridge/*.json` action sequence
 *   (composer, form, panel, roster) through `dispatch` ->
 *   `ingestActionResponse` -> `ingestAgentStreamEvent`; the rejection,
 *   timeout, and stale-revision describe blocks cover the paths no recorded
 *   fixture demonstrates (every recorded fixture happens to succeed).
 * - "Composite identity prevents cross-element action collisions" — the
 *   dedicated describe block dispatches the same bare `elementId`/`actionId`
 *   from two different namespaces and proves their pending/settled state
 *   never leaks into each other.
 * - "Dangerous-action confirmation hook is exposed to renderers" — the
 *   confirmation describe block covers the pure `getActionConfirmation`/
 *   `requiresConfirmation` hook and `dispatch`'s enforcement of it, using
 *   the recorded `panel.json` fixture's `stop` action (which carries a real
 *   `confirm` message per plan.md §11.3/§11.7).
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(here, "../../../protocol/src/fixtures/pi-ui-bridge");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

type FixtureFrame = { id: string; wireType: string; message: unknown };
type PiUiBridgeFixture = { frames: FixtureFrame[] };

function loadPiUiBridgeFixture(kind: string): PiUiBridgeFixture {
  return readJson(join(PI_UI_BRIDGE_FIXTURES_DIR, `${kind}.json`)) as PiUiBridgeFixture;
}

function findFrame(fixture: PiUiBridgeFixture, wireTypeIncludes: string): FixtureFrame {
  const frame = fixture.frames.find((f) => f.wireType.includes(wireTypeIncludes));
  if (!frame) throw new Error(`fixture frame not found: ${wireTypeIncludes}`);
  return frame;
}

/** Unwraps one recorded frame's `{type: "session", message: <T>}` envelope. */
function sessionMessage<T>(frame: FixtureFrame): T {
  return (frame.message as { message: T }).message;
}

function requestOf(fixture: PiUiBridgeFixture): PiUiActionRequestMessage {
  return sessionMessage<PiUiActionRequestMessage>(findFrame(fixture, "pi.ui.action.request"));
}

function responsePayloadOf(fixture: PiUiBridgeFixture): PiUiActionResponseMessage["payload"] {
  return sessionMessage<PiUiActionResponseMessage>(findFrame(fixture, "pi.ui.action.response"))
    .payload;
}

function actionResultEnvelopeOf(fixture: PiUiBridgeFixture): {
  agentId: string;
  event: AgentStreamEvent;
} {
  const message = sessionMessage<{ payload: { agentId: string; event: AgentStreamEvent } }>(
    findFrame(fixture, "agent_stream:pi_ui_action_result"),
  );
  return message.payload;
}

/** Finds a `PiUiAction` definition (with its `confirm`/`variant` metadata) inside a fixture's first delta. */
function findActionDefinition(fixture: PiUiBridgeFixture, actionId: string): PiUiAction {
  const deltaFrame = fixture.frames.find((f) => f.wireType.includes("pi_ui_delta"));
  const message = sessionMessage<{
    payload: { event: Extract<AgentStreamEvent, { type: "pi_ui_delta" }> };
  }>(deltaFrame!);
  const delta = message.payload.event.delta;
  if (delta.op !== "upsert") throw new Error("expected an upsert delta");
  const action = (delta.element as { actions?: PiUiAction[] }).actions?.find(
    (a) => a.id === actionId,
  );
  if (!action) throw new Error(`action not found: ${actionId}`);
  return action;
}

/** Deterministic, manually-advanced `Clock` (no real timers; plan.md §7.3). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.setTimeout(callback, intervalMs);
  }

  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }

  /** Advances time and synchronously fires every timer now due, in id order. */
  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[0] - b[0])) {
      if (timer.at <= this.time && this.timers.has(id)) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

describe.each([
  { kind: "composer", namespace: "prompt-arbitrage" },
  { kind: "form", namespace: "ask-user" },
  { kind: "panel", namespace: "loop" },
  { kind: "roster", namespace: "subagents" },
])("recorded fixture round trip: $kind.json", ({ kind, namespace }) => {
  it("sends the exact recorded wire request and resolves success from response + result", async () => {
    const fixture = loadPiUiBridgeFixture(kind);
    const request = requestOf(fixture);
    const responsePayload = responsePayloadOf(fixture);
    const resultEnvelope = actionResultEnvelopeOf(fixture);

    const sent: PiUiActionRequestMessage[] = [];
    const clock = new FakeClock();
    const controller = new ExtensionActionController({
      clock,
      sendRequest: (message) => sent.push(message),
    });

    const target: ExtensionActionTarget = {
      agentId: request.agentId,
      namespace,
      elementId: request.elementId,
      actionId: request.actionId,
    };

    const promise = controller.dispatch({
      agentId: request.agentId,
      namespace,
      elementId: request.elementId,
      actionId: request.actionId,
      payload: request.payload,
      requestId: request.requestId,
    });

    // The exact recorded client-to-daemon wire message, byte-for-byte.
    expect(sent).toEqual([request]);
    expect(controller.getActionState(target)).toMatchObject({
      status: "pending",
      requestId: request.requestId,
    });

    // The RPC-level ack (`ok: true`) only confirms routing; it must not
    // settle the action on its own.
    controller.ingestActionResponse(responsePayload);
    expect(controller.isPending(target)).toBe(true);

    const settled = controller.ingestAgentStreamEvent(resultEnvelope.agentId, resultEnvelope.event);
    expect(settled).toMatchObject({
      status: "success",
      source: "result",
      requestId: request.requestId,
      staleRevision: false,
    });
    expect(controller.isPending(target)).toBe(false);

    await expect(promise).resolves.toMatchObject({
      status: "success",
      requestId: request.requestId,
    });
  });
});

/**
 * T128 — `pi.ui.action.response`/`pi_ui_action_result` now carry an
 * optional `answeredBy`, the same shape `agent_permission_resolved` has
 * carried since T111. The `composer.json` fixture's `action-response-1`
 * and `action-result-1` frames both carry
 * `answeredBy: { clientId: "clid_fixture_0002" }` (T128) — this proves the
 * value actually reaches a settled action via the controller's real
 * `ingestActionResponse`/`ingestAgentStreamEvent` methods, not merely that
 * the schema accepts it (that is `messages.wire-compat.test.ts`'s job).
 */
describe("ExtensionActionController — answeredBy (T128)", () => {
  it("carries the composer fixture's answeredBy from ingestActionResponse into the settled action", () => {
    const fixture = loadPiUiBridgeFixture("composer");
    const request = requestOf(fixture);
    const responsePayload = responsePayloadOf(fixture);
    expect(responsePayload.answeredBy).toEqual({ clientId: "clid_fixture_0002" });

    // This fixture's response is `ok: true`, which never settles the
    // action on its own (only `ok: false` does — see the "rejection"
    // describe block below) — so this test exercises the `ok: false`
    // branch directly with the fixture's own `answeredBy`, the one path
    // where `ingestActionResponse` alone settles anything.
    const rejectedPayload = { ...responsePayload, ok: false as const, error: "boom" };
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    void controller.dispatch({
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
      payload: request.payload,
      requestId: request.requestId,
    });

    controller.ingestActionResponse(rejectedPayload);

    const target: ExtensionActionTarget = {
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
    };
    expect(controller.getActionState(target)).toMatchObject({
      status: "rejected",
      answeredBy: { clientId: "clid_fixture_0002" },
    });
  });

  it("carries the composer fixture's answeredBy from ingestAgentStreamEvent into the settled action", async () => {
    const fixture = loadPiUiBridgeFixture("composer");
    const request = requestOf(fixture);
    const responsePayload = responsePayloadOf(fixture);
    const resultEnvelope = actionResultEnvelopeOf(fixture);
    expect(
      resultEnvelope.event.type === "pi_ui_action_result" && resultEnvelope.event.answeredBy,
    ).toEqual({ clientId: "clid_fixture_0002" });

    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    const promise = controller.dispatch({
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
      payload: request.payload,
      requestId: request.requestId,
    });
    controller.ingestActionResponse(responsePayload);

    const settled = controller.ingestAgentStreamEvent(resultEnvelope.agentId, resultEnvelope.event);
    expect(settled).toMatchObject({
      status: "success",
      answeredBy: { clientId: "clid_fixture_0002" },
    });
    await expect(promise).resolves.toMatchObject({ answeredBy: { clientId: "clid_fixture_0002" } });
  });

  it("omits answeredBy from the settled action when the response payload carries none (pre-T128 behavior)", () => {
    const fixture = loadPiUiBridgeFixture("composer");
    const request = requestOf(fixture);
    const responsePayload = responsePayloadOf(fixture);
    // biome-ignore lint: constructing a deliberately pre-T128 payload for this test
    const { answeredBy: _drop, ...oldShapePayload } = { ...responsePayload, ok: false as const };

    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    void controller.dispatch({
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
      payload: request.payload,
      requestId: request.requestId,
    });

    controller.ingestActionResponse(oldShapePayload);

    const target: ExtensionActionTarget = {
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
    };
    const state = controller.getActionState(target);
    expect(state.status).toBe("rejected");
    expect(Object.prototype.hasOwnProperty.call(state, "answeredBy")).toBe(false);
  });

  it("omits answeredBy from the settled action when the result event carries none (pre-T128 behavior)", async () => {
    const fixture = loadPiUiBridgeFixture("composer");
    const request = requestOf(fixture);
    const responsePayload = responsePayloadOf(fixture);
    const resultEnvelope = actionResultEnvelopeOf(fixture);
    if (resultEnvelope.event.type !== "pi_ui_action_result") throw new Error("expected a result");
    // biome-ignore lint: constructing a deliberately pre-T128 event for this test
    const { answeredBy: _drop, ...oldShapeEvent } = resultEnvelope.event;

    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    void controller.dispatch({
      agentId: request.agentId,
      namespace: "prompt-arbitrage",
      elementId: request.elementId,
      actionId: request.actionId,
      payload: request.payload,
      requestId: request.requestId,
    });
    controller.ingestActionResponse(responsePayload);

    const settled = controller.ingestAgentStreamEvent(resultEnvelope.agentId, oldShapeEvent);
    expect(settled?.status).toBe("success");
    expect(settled && Object.prototype.hasOwnProperty.call(settled, "answeredBy")).toBe(false);
  });
});

describe("ExtensionActionController — rejection", () => {
  it("settles rejected immediately on an RPC-level pi.ui.action.response ok:false (never routed)", async () => {
    const clock = new FakeClock();
    const sent: PiUiActionRequestMessage[] = [];
    const controller = new ExtensionActionController({ clock, sendRequest: (m) => sent.push(m) });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "ask-user",
      elementId: "pick-approach",
      actionId: "submit",
      requestId: "req_1",
    });

    controller.ingestActionResponse({ requestId: "req_1", ok: false, error: "unknown element" });

    const settled = await promise;
    expect(settled).toMatchObject({
      status: "rejected",
      source: "response",
      error: "unknown element",
    });

    // A late result for the same target, after an RPC-level rejection, has
    // nothing left to resolve.
    const late = controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: true,
    });
    expect(late).toBeNull();
  });

  it("settles rejected on an extension-level pi_ui_action_result ok:false, after a successful routing ack", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_2",
    });

    controller.ingestActionResponse({ requestId: "req_2", ok: true, error: null });
    const settled = controller.ingestActionResult("agt_1", {
      actionId: "stop",
      elementId: "run-4",
      ok: false,
      error: "loop already stopped",
    });

    expect(settled).toMatchObject({
      status: "rejected",
      source: "result",
      error: "loop already stopped",
    });
    await expect(promise).resolves.toMatchObject({
      status: "rejected",
      error: "loop already stopped",
    });
  });
});

describe("ExtensionActionController — timeout", () => {
  it("settles timeout when neither response nor result arrive before the deadline", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({
      clock,
      sendRequest: () => {},
      timeoutMs: 5_000,
    });

    const target: ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet",
      actionId: "cancel",
    };
    const promise = controller.dispatch({ ...target, requestId: "req_timeout" });

    clock.advance(4_999);
    expect(controller.isPending(target)).toBe(true);

    clock.advance(1);
    const settled = await promise;
    expect(settled).toMatchObject({
      status: "timeout",
      source: "timeout",
      requestId: "req_timeout",
    });
    expect(controller.getActionState(target)).toMatchObject({ status: "timeout" });
  });

  it("a response or result arriving before the deadline cancels the pending timer", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({
      clock,
      sendRequest: () => {},
      timeoutMs: 1_000,
    });

    controller.dispatch({
      agentId: "agt_1",
      namespace: "ask-user",
      elementId: "pick-approach",
      actionId: "submit",
      requestId: "req_early",
    });
    controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: true,
    });

    // Advancing well past the original deadline must not re-settle or throw.
    expect(() => clock.advance(10_000)).not.toThrow();
  });
});

describe("ExtensionActionController — stale revision", () => {
  it("flags staleRevision when the element's revision changed between dispatch and settlement", async () => {
    const clock = new FakeClock();
    let revision = 3;
    const controller = new ExtensionActionController({
      clock,
      sendRequest: () => {},
      getElementRevision: () => revision,
    });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_stale",
    });

    // A concurrent pi_ui_delta bumped the agent's revision while the action
    // was still in flight.
    revision = 4;

    controller.ingestActionResult("agt_1", { actionId: "stop", elementId: "run-4", ok: true });

    const settled = await promise;
    expect(settled.status).toBe("success"); // still resolves normally
    expect(settled.staleRevision).toBe(true);
  });

  it("leaves staleRevision false when the revision never moved", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({
      clock,
      sendRequest: () => {},
      getElementRevision: () => 7,
    });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_fresh",
    });
    controller.ingestActionResult("agt_1", { actionId: "stop", elementId: "run-4", ok: true });

    await expect(promise).resolves.toMatchObject({ staleRevision: false });
  });

  it("defaults staleRevision to false without a getElementRevision dependency", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_no_revision",
    });
    controller.ingestActionResult("agt_1", { actionId: "stop", elementId: "run-4", ok: true });

    await expect(promise).resolves.toMatchObject({ staleRevision: false });
  });
});

describe("ExtensionActionController — composite identity prevents cross-element action collisions", () => {
  it("tracks two namespaces' identical bare elementId/actionId as independent pending entries", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });

    const loopTarget: ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "loop",
      elementId: "main",
      actionId: "stop",
    };
    const advisorTarget: ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "advisor",
      elementId: "main",
      actionId: "stop",
    };
    expect(extensionActionTargetKey(loopTarget)).not.toBe(extensionActionTargetKey(advisorTarget));

    controller.dispatch({ ...loopTarget, requestId: "req_loop" });
    controller.dispatch({ ...advisorTarget, requestId: "req_advisor" });

    expect(
      controller
        .listPending()
        .map((p) => p.requestId)
        .sort(),
    ).toEqual(["req_advisor", "req_loop"]);

    // Settling the loop namespace's action (unambiguous: keyed by requestId
    // via the RPC-level response) must never touch the advisor namespace's
    // still-pending entry sharing the same bare elementId/actionId.
    controller.ingestActionResponse({ requestId: "req_loop", ok: false, error: "nope" });

    expect(controller.getActionState(loopTarget)).toMatchObject({ status: "rejected" });
    expect(controller.getActionState(advisorTarget)).toMatchObject({ status: "pending" });
    expect(controller.isPending(advisorTarget)).toBe(true);
  });

  it("resolves an ambiguous pi_ui_action_result (no ns on the wire) against the oldest matching pending request (FIFO)", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });

    const target: ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "ask-user",
      elementId: "pick-approach",
      actionId: "submit",
    };
    const first = controller.dispatch({ ...target, requestId: "req_first" });
    clock.advance(1);
    const second = controller.dispatch({ ...target, requestId: "req_second" });

    // The wire event cannot say which requestId it is for; it resolves the
    // oldest still-pending match first.
    controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: true,
    });
    await expect(first).resolves.toMatchObject({ requestId: "req_first", status: "success" });
    expect(controller.isPending(target)).toBe(true); // req_second is still in flight

    controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: false,
      error: "duplicate submit",
    });
    await expect(second).resolves.toMatchObject({ requestId: "req_second", status: "rejected" });
  });
});

describe("ExtensionActionController — dangerous-action confirmation hook", () => {
  it("getActionConfirmation reports required:false for an action without confirm", () => {
    const action: PiUiAction = { id: "details", label: "Details" };
    expect(getActionConfirmation(action)).toEqual({ required: false });
    expect(requiresConfirmation(action)).toBe(false);
  });

  it("getActionConfirmation reports required:true with the recorded confirm message for panel.json's stop action", () => {
    const fixture = loadPiUiBridgeFixture("panel");
    const stopAction = findActionDefinition(fixture, "stop");
    expect(stopAction.variant).toBe("danger");

    const confirmation = getActionConfirmation(stopAction);
    expect(confirmation).toEqual({ required: true, message: "Stop the running loop?" });
    expect(requiresConfirmation(stopAction)).toBe(true);
  });

  it("getActionConfirmation reports required:false for an undefined action", () => {
    expect(getActionConfirmation(undefined)).toEqual({ required: false });
  });

  it("dispatch throws ExtensionActionConfirmationRequiredError instead of sending when a confirm-bearing action is dispatched unconfirmed", () => {
    const fixture = loadPiUiBridgeFixture("panel");
    const stopAction = findActionDefinition(fixture, "stop");
    const request = requestOf(fixture);

    const sent: PiUiActionRequestMessage[] = [];
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: (m) => sent.push(m) });

    expect(() =>
      controller.dispatch({
        agentId: request.agentId,
        namespace: "loop",
        elementId: request.elementId,
        actionId: request.actionId,
        action: stopAction,
      }),
    ).toThrow(ExtensionActionConfirmationRequiredError);
    expect(sent).toEqual([]);
  });

  it("dispatch sends the request once the caller passes confirmed:true", () => {
    const fixture = loadPiUiBridgeFixture("panel");
    const stopAction = findActionDefinition(fixture, "stop");
    const request = requestOf(fixture);

    const sent: PiUiActionRequestMessage[] = [];
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: (m) => sent.push(m) });

    expect(() =>
      controller.dispatch({
        agentId: request.agentId,
        namespace: "loop",
        elementId: request.elementId,
        actionId: request.actionId,
        payload: request.payload,
        action: stopAction,
        confirmed: true,
        requestId: request.requestId,
      }),
    ).not.toThrow();
    expect(sent).toEqual([request]);
  });
});

describe("ExtensionActionController — cancel", () => {
  it("settles a pending action locally as cancelled and stops its timeout", async () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({
      clock,
      sendRequest: () => {},
      timeoutMs: 1_000,
    });

    const promise = controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_cancel",
    });

    const settled = controller.cancel("req_cancel");
    expect(settled).toMatchObject({ status: "cancelled", source: "cancel" });
    await expect(promise).resolves.toMatchObject({ status: "cancelled" });

    expect(controller.listPending()).toEqual([]);
    // Advancing past the original timeout must not re-settle (already gone).
    expect(() => clock.advance(2_000)).not.toThrow();
  });

  it("cancelling an unknown requestId is a no-op", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    expect(controller.cancel("does-not-exist")).toBeNull();
  });
});

describe("ExtensionActionController — ingestAgentStreamEvent dispatch", () => {
  it("ignores every event type other than pi_ui_action_result", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });

    const unrelated: AgentStreamEvent = { type: "turn_started", provider: "pi" };
    expect(controller.ingestAgentStreamEvent("agt_1", unrelated)).toBeNull();
  });

  it("routes pi_ui_action_result to ingestActionResult", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_evt",
    });

    const event: AgentStreamEvent = {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "stop", elementId: "run-4", ok: true },
    };
    const settled = controller.ingestAgentStreamEvent("agt_1", event);
    expect(settled).toMatchObject({ status: "success", requestId: "req_evt" });
  });
});

describe("ExtensionActionController — unknown acknowledgments are no-ops", () => {
  it("ingestActionResponse for an unknown requestId does not throw", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    expect(() =>
      controller.ingestActionResponse({ requestId: "never-dispatched", ok: true, error: null }),
    ).not.toThrow();
  });

  it("ingestActionResult for an unmatched target returns null", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    expect(
      controller.ingestActionResult("agt_1", { actionId: "x", elementId: "y", ok: true }),
    ).toBeNull();
  });
});

describe("ExtensionActionController — subscribe", () => {
  it("notifies subscribers on every pending and settled transition", () => {
    const clock = new FakeClock();
    const controller = new ExtensionActionController({ clock, sendRequest: () => {} });
    const seen: string[] = [];
    controller.subscribe((_target, state) => seen.push(state.status));

    controller.dispatch({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "run-4",
      actionId: "stop",
      requestId: "req_sub",
    });
    controller.ingestActionResult("agt_1", { actionId: "stop", elementId: "run-4", ok: true });

    expect(seen).toEqual(["pending", "success"]);
  });
});

describe("extensionActionTargetKey", () => {
  it("differs when any component of the composite identity differs", () => {
    const base: ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "loop",
      elementId: "main",
      actionId: "stop",
    };
    const key = extensionActionTargetKey(base);
    expect(extensionActionTargetKey({ ...base, agentId: "agt_2" })).not.toBe(key);
    expect(extensionActionTargetKey({ ...base, namespace: "advisor" })).not.toBe(key);
    expect(extensionActionTargetKey({ ...base, elementId: "other" })).not.toBe(key);
    expect(extensionActionTargetKey({ ...base, actionId: "cancel" })).not.toBe(key);
    expect(extensionActionTargetKey({ ...base })).toBe(key);
  });
});
