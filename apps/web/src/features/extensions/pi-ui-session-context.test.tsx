import type { DaemonClient } from "@picompanion/client";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { PiUiSessionProvider, usePiUiSession } from "./pi-ui-session-context.js";

/**
 * `PiUiSessionProvider`/`usePiUiSession` — the one live store/controller a
 * session shares across every placement destination (plan.md §11.4,
 * §12.3). These tests use the provider's explicit `client` seam, so they
 * exercise the real `agent_stream` ingestion and `sendPiUiAction` forwarding
 * without a `DaemonClientProvider` or a socket.
 */

afterEach(cleanup);

type EmitMessage = {
  payload: { agentId: string; event: unknown };
};

function makeFakeClient() {
  const handlers = new Map<string, Set<(message: never) => void>>();
  const client = {
    on(type: string, handler: (message: never) => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => set.delete(handler);
    },
    sendPiUiAction: vi.fn(async () => ({ requestId: "req", ok: true, error: null })),
  };
  return {
    client: client as unknown as DaemonClient,
    emit(type: string, message: unknown) {
      for (const handler of handlers.get(type) ?? []) handler(message as never);
    },
  };
}

const element: PiUiElement = {
  id: "mode",
  ns: "plan-mode",
  kind: "status",
  placement: "status",
  payload: { kind: "status", text: "Reviewing changes" },
};

function Consumer() {
  const session = usePiUiSession();
  if (!session) {
    return <span data-testid="no-session" />;
  }
  return (
    <div>
      <span data-testid="element-count">{session.elements.length}</span>
      <span data-testid="revision">{session.revision}</span>
      <button
        type="button"
        onClick={() => {
          void session.actionController.dispatch({
            agentId: session.agentId,
            namespace: "plan-mode",
            elementId: "mode",
            actionId: "open",
          });
        }}
      >
        dispatch
      </button>
    </div>
  );
}

function renderProvider(agentId: string | undefined, fake: ReturnType<typeof makeFakeClient>) {
  return render(
    <CoreProvider>
      <PiUiSessionProvider agentId={agentId} client={fake.client}>
        <Consumer />
      </PiUiSessionProvider>
    </CoreProvider>,
  );
}

describe("PiUiSessionProvider", () => {
  it("publishes null on a route with no session, without throwing", () => {
    const fake = makeFakeClient();
    renderProvider(undefined, fake);
    expect(screen.getByTestId("no-session")).toBeTruthy();
  });

  it("ingests a live pi_ui_delta from agent_stream into the one shared store", () => {
    const fake = makeFakeClient();
    renderProvider("agt_1", fake);

    expect(screen.getByTestId("element-count").textContent).toBe("0");

    act(() => {
      // Reach the real subscription through the fake's emit.
      fake.emit("agent_stream", {
        payload: {
          agentId: "agt_1",
          event: {
            type: "pi_ui_delta",
            provider: "pi",
            agentId: "agt_1",
            revision: 1,
            delta: { op: "upsert", element },
          },
        },
      } satisfies EmitMessage);
    });

    expect(screen.getByTestId("element-count").textContent).toBe("1");
    expect(screen.getByTestId("revision").textContent).toBe("1");
  });

  it("ignores an agent_stream event for a different agent", () => {
    const fake = makeFakeClient();
    renderProvider("agt_1", fake);

    act(() => {
      fake.emit("agent_stream", {
        payload: {
          agentId: "agt_2",
          event: {
            type: "pi_ui_delta",
            provider: "pi",
            agentId: "agt_2",
            revision: 1,
            delta: { op: "upsert", element },
          },
        },
      });
    });

    expect(screen.getByTestId("element-count").textContent).toBe("0");
  });

  it("forwards an action dispatch through the shared controller to client.sendPiUiAction", async () => {
    const fake = makeFakeClient();
    const user = userEvent.setup();
    renderProvider("agt_1", fake);

    await user.click(screen.getByRole("button", { name: "dispatch" }));

    expect(fake.client.sendPiUiAction).toHaveBeenCalledTimes(1);
    expect(fake.client.sendPiUiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agt_1",
        actionId: "open",
        elementId: "mode",
      }),
    );
  });
});
