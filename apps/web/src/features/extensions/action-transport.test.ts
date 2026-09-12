import { describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { SessionOutboundMessage } from "@picompanion/protocol/messages";

import {
  sendPiUiActionRequest,
  subscribePiUiActionResponses,
  type PiUiActionTransportClient,
} from "./action-transport.js";

/**
 * Wiring-level tests for `action-transport.ts` — the two seams
 * `ExtensionActionController` needs from `DaemonClient` (`sendRequest` at
 * construction, `pi.ui.action.response` ingest at runtime), against a plain
 * fake. The controller's own round-trip semantics are already covered by
 * `extension-fixture-actions.test.tsx`; these prove the transport actually
 * reaches the wire and the ack actually reaches the controller.
 */

/** Deterministic no-op `Clock` — no timer ever needs to fire here. */
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

class FakeTransportClient implements PiUiActionTransportClient {
  readonly sent: Array<{
    agentId: string;
    actionId: string;
    elementId: string;
    payload?: Record<string, unknown>;
    requestId?: string;
  }> = [];
  private readonly handlers = new Set<
    (message: { payload: extensions.PiUiActionResponsePayload }) => void
  >();

  sendPiUiAction(input: {
    agentId: string;
    actionId: string;
    elementId: string;
    payload?: Record<string, unknown>;
    requestId?: string;
  }): Promise<unknown> {
    this.sent.push(input);
    return Promise.resolve({
      requestId: input.requestId ?? "generated",
      ok: true,
      error: null,
    });
  }

  on<TType extends "pi.ui.action.response">(
    _type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void {
    const responseHandler = handler as (message: {
      payload: extensions.PiUiActionResponsePayload;
    }) => void;
    this.handlers.add(responseHandler);
    return () => this.handlers.delete(responseHandler);
  }

  emitResponse(payload: extensions.PiUiActionResponsePayload): void {
    for (const handler of this.handlers) handler({ payload });
  }
}

const ACTION_MESSAGE: extensions.PiUiActionRequestMessage = {
  type: "pi.ui.action.request",
  agentId: "agt_1",
  actionId: "collapse",
  elementId: "todo-1",
  payload: { rowId: "r1" },
  requestId: "req_1",
};

describe("sendPiUiActionRequest", () => {
  it("forwards the controller's exact message fields, requestId included", () => {
    const client = new FakeTransportClient();
    sendPiUiActionRequest(client, ACTION_MESSAGE);

    expect(client.sent).toEqual([
      {
        agentId: "agt_1",
        actionId: "collapse",
        elementId: "todo-1",
        payload: { rowId: "r1" },
        requestId: "req_1",
      },
    ]);
  });

  it("omits payload entirely when the message carries none", () => {
    const client = new FakeTransportClient();
    sendPiUiActionRequest(client, {
      type: "pi.ui.action.request",
      agentId: "agt_1",
      actionId: "toggle",
      elementId: "plan-1",
      requestId: "req_2",
    });

    expect(client.sent).toEqual([
      { agentId: "agt_1", actionId: "toggle", elementId: "plan-1", requestId: "req_2" },
    ]);
  });

  it("is a no-op with no connected client, leaving the controller to time out honestly", () => {
    expect(() => sendPiUiActionRequest(null, ACTION_MESSAGE)).not.toThrow();
    expect(() => sendPiUiActionRequest(undefined, ACTION_MESSAGE)).not.toThrow();
  });

  it("really reaches the client when a controller dispatches through it", () => {
    const client = new FakeTransportClient();
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: (message) => sendPiUiActionRequest(client, message),
    });

    void controller.dispatch({
      agentId: "agt_1",
      namespace: "todo",
      elementId: "todo-1",
      actionId: "collapse",
      requestId: "req_1",
    });

    expect(client.sent).toEqual([
      { agentId: "agt_1", actionId: "collapse", elementId: "todo-1", requestId: "req_1" },
    ]);
  });
});

describe("subscribePiUiActionResponses", () => {
  it("routes an ok:false ack to the controller so the dispatch settles rejected with answeredBy", async () => {
    const client = new FakeTransportClient();
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: (message) => sendPiUiActionRequest(client, message),
    });
    const unsubscribe = subscribePiUiActionResponses(client, controller);

    const settled = controller.dispatch({
      agentId: "agt_1",
      namespace: "todo",
      elementId: "todo-1",
      actionId: "collapse",
      requestId: "req_1",
    });

    client.emitResponse({
      requestId: "req_1",
      ok: false,
      error: "unknown element",
      answeredBy: { clientId: "clsk_web" },
    });

    await expect(settled).resolves.toMatchObject({
      status: "rejected",
      error: "unknown element",
      source: "response",
      requestId: "req_1",
      answeredBy: { clientId: "clsk_web" },
    });

    unsubscribe();
    expect(
      controller.isPending({
        agentId: "agt_1",
        namespace: "todo",
        elementId: "todo-1",
        actionId: "collapse",
      }),
    ).toBe(false);
  });

  it("unsubscribes cleanly", () => {
    const client = new FakeTransportClient();
    const controller = new extensions.ExtensionActionController({
      clock: new NullClock(),
      sendRequest: () => {},
    });

    const unsubscribe = subscribePiUiActionResponses(client, controller);
    unsubscribe();

    // No handler remains, so an ack after unsubscribe cannot settle anything.
    client.emitResponse({ requestId: "req_1", ok: false, error: "unknown element" });
    expect(controller.listPending()).toEqual([]);
  });
});
