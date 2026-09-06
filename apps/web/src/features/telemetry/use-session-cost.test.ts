import type { AgentUsage } from "@picompanion/protocol/agent-types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionCostStore } from "./session-cost-store.js";
import { useSessionCost } from "./use-session-cost.js";

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return { ...partial };
}

describe("useSessionCost", () => {
  it("reads the store's current session cost", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const { result } = renderHook(() => useSessionCost(store));
    expect(result.current.status).toBe("known");
    expect(result.current.totalUsd).toBeCloseTo(3, 6);
  });

  it("starts unknown for a fresh store", () => {
    const store = new SessionCostStore();
    const { result } = renderHook(() => useSessionCost(store));
    expect(result.current.status).toBe("unknown");
  });

  it("updates live as the store ingests a mid-turn usage reading", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    const { result } = renderHook(() => useSessionCost(store));
    expect(result.current.status).toBe("unknown");

    act(() => {
      store.ingestUsage("turn_1", usage({ inputTokens: 100_000, outputTokens: 0 }));
    });
    expect(result.current.status).toBe("known");
    expect(result.current.totalUsd).toBeCloseTo(0.3, 6);

    act(() => {
      store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    });
    expect(result.current.totalUsd).toBeCloseTo(3, 6);
  });

  it("returns a referentially stable snapshot across re-renders when the revision has not changed", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000, outputTokens: 0 }));

    const { result, rerender } = renderHook(() => useSessionCost(store));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
