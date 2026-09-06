import type { AgentUsage } from "@picompanion/protocol/agent-types";
import { act, cleanup, render, screen } from "@testing-library/react";
import { memo, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonSessionCostClient } from "./daemon-session-cost-client.js";
import { SessionCostMeterContainer } from "./SessionCostMeterContainer.js";

afterEach(cleanup);

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return { ...partial };
}

interface FakeAgent {
  id: string;
  model: string | null;
  lastUsage?: AgentUsage;
  activeTurn?: { turnId: string; startedAt: string | null } | null;
}

type FakeAgentUpdateMessage = {
  type: "agent_update";
  payload: { kind: "upsert"; agent: FakeAgent } | { kind: "remove"; agentId: string };
};

/** A minimal fake `DaemonSessionCostClient` this test drives directly. */
function createFakeDaemon(): DaemonSessionCostClient & {
  pushUpdate: (agent: FakeAgent) => void;
} {
  const handlers = new Set<(message: FakeAgentUpdateMessage) => void>();

  return {
    on: ((_type: "agent_update", handler: (message: FakeAgentUpdateMessage) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }) as DaemonSessionCostClient["on"],
    pushUpdate(agent) {
      for (const handler of handlers) {
        handler({ type: "agent_update", payload: { kind: "upsert", agent } });
      }
    },
  };
}

describe("SessionCostMeterContainer", () => {
  it("renders the store's initial unknown state without a client", () => {
    render(<SessionCostMeterContainer agentId="agt_1" />);
    expect(screen.getByText(/Not priced yet/)).toBeTruthy();
  });

  it("reflects live agent_update pushes from an attached daemon client", () => {
    const daemon = createFakeDaemon();
    render(<SessionCostMeterContainer agentId="agt_1" client={daemon} />);
    expect(screen.getByText(/Not priced yet/)).toBeTruthy();

    act(() => {
      daemon.pushUpdate({
        id: "agt_1",
        model: "claude-sonnet-4",
        activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
        lastUsage: usage({ inputTokens: 1_000_000, outputTokens: 0 }),
      });
    });

    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$3.0000 this session",
    );
  });

  it("ignores pushes for a different agentId", () => {
    const daemon = createFakeDaemon();
    render(<SessionCostMeterContainer agentId="agt_1" client={daemon} />);

    act(() => {
      daemon.pushUpdate({
        id: "agt_other",
        model: "claude-sonnet-4",
        activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
        lastUsage: usage({ inputTokens: 1_000_000, outputTokens: 0 }),
      });
    });

    expect(screen.getByText(/Not priced yet/)).toBeTruthy();
  });

  /**
   * T48A2's third acceptance criterion: "the value updates during a turn
   * without re-rendering the transcript". `SessionCostMeterContainer`
   * subscribes its own `SessionCostStore` via `useSessionCost`
   * (`useSyncExternalStore`) rather than a value threaded down from a
   * shared parent, so a sibling that memoizes on unrelated props must
   * never re-render just because this store's revision moves. This test
   * stands a `React.memo` sibling in for the real transcript (owned by a
   * different task's directory) to prove that isolation structurally.
   */
  it("updates independently of a sibling component (does not force a memoized sibling to re-render)", () => {
    const renderCounts = { sibling: 0 };
    const Sibling = memo(function Sibling({ label }: { label: string }) {
      renderCounts.sibling += 1;
      return <div data-testid="sibling">{label}</div>;
    });

    const daemon = createFakeDaemon();

    function Harness() {
      const renders = useRef(0);
      renders.current += 1;
      return (
        <div>
          <SessionCostMeterContainer agentId="agt_1" client={daemon} />
          <Sibling label="transcript stand-in" />
        </div>
      );
    }

    render(<Harness />);
    expect(renderCounts.sibling).toBe(1);

    act(() => {
      daemon.pushUpdate({
        id: "agt_1",
        model: "claude-sonnet-4",
        activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
        lastUsage: usage({ inputTokens: 100_000, outputTokens: 0 }),
      });
    });
    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$0.3000 this session",
    );
    expect(renderCounts.sibling).toBe(1);

    // A mid-turn update to the same turn moves the readout again, still
    // without the sibling re-rendering.
    act(() => {
      daemon.pushUpdate({
        id: "agt_1",
        model: "claude-sonnet-4",
        activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
        lastUsage: usage({ inputTokens: 1_000_000, outputTokens: 0 }),
      });
    });
    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$3.0000 this session",
    );
    expect(renderCounts.sibling).toBe(1);
  });
});
