import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { ElementActionsRow } from "./element-actions.js";

/**
 * T128 — `pi.ui.action.response`/`pi_ui_action_result` now carry an optional
 * `answeredBy` (the same shape `agent_permission_resolved` has carried since
 * T111), and `ElementActionsRow` — the one shared action-feedback row reused
 * by every simple Pi UI Bridge kind (`status`, `widget`, `progress`, `log`,
 * `markdown`, `diff`, `panel`; see this file's own module doc) — is "the web
 * renderer that displays it" (T128's scope grant).
 *
 * Acceptance criteria exercised here:
 * - "A second client renders who answered, proven by the value arriving in
 *   the DOM" — the two-controller describe block below constructs two
 *   independent `ExtensionActionController` instances (standing in for two
 *   separately connected clients, e.g. web + Android, both live on the same
 *   session — see `../../../../../packages/frontend-core/src/actions/
 *   arbitration.ts`'s module doc for why that is the normal case this
 *   product supports), feeds both the exact same broadcast
 *   `pi_ui_action_result` naming a third connection as the answerer, and
 *   renders each controller's resulting state through a separate
 *   `ElementActionsRow` instance — proving the identity actually reaches two
 *   independently rendered DOMs, not just one controller's in-memory state.
 * - "Omitting the field keeps today's behaviour" — a settled state with no
 *   `answeredBy` at all (the exact shape a pre-T128 daemon would still send)
 *   renders byte-identical feedback text to before this task.
 */

afterEach(cleanup);

const action: PiUiAction = { id: "undo", label: "Undo" };

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

function newController() {
  return new extensions.ExtensionActionController({
    clock: new NullClock(),
    sendRequest: () => {},
  });
}

const TARGET = {
  agentId: "agent-1",
  namespace: "prompt-arbitrage",
  elementId: "arbitrage-suggestion",
  actionId: "undo",
};

describe("ElementActionsRow feedback text without answeredBy (pre-T128 behavior)", () => {
  it("renders plain 'Done' when the settled state carries no answeredBy at all", () => {
    const controller = newController();
    void controller.dispatch({ ...TARGET, requestId: "req-1" });
    controller.ingestAgentStreamEvent("agent-1", {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
    });
    const state = controller.getActionState(TARGET);
    expect(Object.prototype.hasOwnProperty.call(state, "answeredBy")).toBe(false);

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => state as never}
        getActionState={() => state}
        ariaLabel="Suggestion actions"
      />,
    );
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("renders plain 'Failed' when a rejected state carries no answeredBy and no error", () => {
    const controller = newController();
    void controller.dispatch({ ...TARGET, requestId: "req-2" });
    controller.ingestActionResponse({ requestId: "req-2", ok: false, error: null });
    const state = controller.getActionState(TARGET);
    expect(Object.prototype.hasOwnProperty.call(state, "answeredBy")).toBe(false);

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => state as never}
        getActionState={() => state}
        ariaLabel="Suggestion actions"
      />,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});

describe("ElementActionsRow attribution against a real production payload (T134)", () => {
  // session.ts's `dispatchPiUiMessage` — the one real emitter of
  // `pi.ui.action.response` — sets exactly `{ clientId: this.clientId }`
  // and never a `label` (verified at HEAD: `grep -n "answeredBy:"
  // packages/server/src/server/session.ts` shows only bare `clientId`).
  // This builds that exact payload shape via `ingestActionResponse` (no
  // hand-supplied `label`) and asserts the text a real user reads.
  it("renders the error alone for a self-answered response naming only a clientId, never the raw id", () => {
    // Mirrors session.ts's actual failure emit in `dispatchPiUiMessage`:
    // `{ requestId, ok: false, error: message, answeredBy: {
    // clientId: this.clientId } }` — no `label`, ever, today.
    const controller = newController();
    void controller.dispatch({ ...TARGET, requestId: "req-self" });
    controller.ingestActionResponse({
      requestId: "req-self",
      ok: false,
      error: "Agent agent-1 not found",
      answeredBy: { clientId: "clid_9f2a3b7c" },
    });
    const state = controller.getActionState(TARGET);
    expect(state).toMatchObject({ answeredBy: { clientId: "clid_9f2a3b7c" } });

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => state as never}
        getActionState={() => state}
        ariaLabel="Suggestion actions"
      />,
    );
    expect(screen.getByText("Agent agent-1 not found")).toBeTruthy();
    expect(screen.queryByText(/clid_9f2a3b7c/)).toBeNull();
  });

  it("renders an honest, non-identifying phrase for a different connection's result naming only a clientId", () => {
    const controller = newController();
    void controller.dispatch({ ...TARGET, requestId: "req-other" });
    controller.ingestAgentStreamEvent("agent-1", {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
      answeredBy: { clientId: "clid_other_9f2a" },
    });
    const state = controller.getActionState(TARGET);
    expect(state).toMatchObject({ answeredBy: { clientId: "clid_other_9f2a" } });

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => state as never}
        getActionState={() => state}
        ariaLabel="Suggestion actions"
      />,
    );
    expect(screen.getByText("Done — another client")).toBeTruthy();
    expect(screen.queryByText(/clid_other_9f2a/)).toBeNull();
  });
});

describe("ElementActionsRow renders answeredBy (T128)", () => {
  it("appends the daemon's label to a self-answered response", () => {
    const controller = newController();
    void controller.dispatch({ ...TARGET, requestId: "req-3" });
    controller.ingestActionResponse({
      requestId: "req-3",
      ok: false,
      error: "Agent not found",
      answeredBy: { clientId: "clid_self", label: "Web" },
    });
    const state = controller.getActionState(TARGET);

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => state as never}
        getActionState={() => state}
        ariaLabel="Suggestion actions"
      />,
    );
    expect(screen.getByText("Agent not found — Web")).toBeTruthy();
  });
});

describe("ElementActionsRow — a second client renders who answered (T128)", () => {
  it("two independently constructed clients both render the same external answerer for one shared pi_ui_action_result broadcast", () => {
    // Two separately connected clients (e.g. a web tab and an Android
    // client, plan.md §12.3), each with its own controller instance — one
    // per connected client is exactly how this product runs, per
    // arbitration.ts's module doc.
    const controllerA = newController();
    const controllerB = newController();

    // Both dispatched the same target under their own requestId — neither
    // one is the client that actually gets attributed below, proving the
    // rendered identity comes from the broadcast, not from either
    // dispatcher's own identity.
    void controllerA.dispatch({ ...TARGET, requestId: "req-a" });
    void controllerB.dispatch({ ...TARGET, requestId: "req-b" });

    const sharedResult: Extract<AgentStreamEvent, { type: "pi_ui_action_result" }> = {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
      answeredBy: { clientId: "clid_other_client", label: "Android" },
    };

    controllerA.ingestAgentStreamEvent("agent-1", sharedResult);
    controllerB.ingestAgentStreamEvent("agent-1", sharedResult);

    const stateA = controllerA.getActionState(TARGET);
    const stateB = controllerB.getActionState(TARGET);
    // Both clients' controllers landed on the identical settled answeredBy —
    // proven in-memory first, then in two separate renders below.
    expect(stateA).toMatchObject({
      answeredBy: { clientId: "clid_other_client", label: "Android" },
    });
    expect(stateB).toMatchObject({
      answeredBy: { clientId: "clid_other_client", label: "Android" },
    });

    const { unmount: unmountA } = render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => stateA as never}
        getActionState={() => stateA}
        ariaLabel="Client A suggestion actions"
      />,
    );
    expect(screen.getByText("Done — Android")).toBeTruthy();
    unmountA();

    render(
      <ElementActionsRow
        actions={[action]}
        dispatchAction={async () => stateB as never}
        getActionState={() => stateB}
        ariaLabel="Client B suggestion actions"
      />,
    );
    expect(screen.getByText("Done — Android")).toBeTruthy();
  });
});
