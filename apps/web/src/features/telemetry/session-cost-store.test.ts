import type { AgentUsage } from "@picompanion/protocol/agent-types";
import { describe, expect, it, vi } from "vitest";

import { SessionCostStore } from "./session-cost-store.js";

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return { ...partial };
}

describe("SessionCostStore", () => {
  it("starts unknown before any usage is ingested", () => {
    const store = new SessionCostStore();
    expect(store.getSessionCost()).toEqual({
      status: "unknown",
      totalUsd: 0,
      pricedTurns: 0,
      unknownTurns: 0,
    });
  });

  it("prices a turn once a known model and usage are ingested", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));

    const cost = store.getSessionCost();
    expect(cost.status).toBe("known");
    expect(cost.pricedTurns).toBe(1);
    expect(cost.unknownTurns).toBe(0);
    expect(cost.totalUsd).toBeCloseTo(3 + 15, 6);
  });

  it("renders an unpriced model as unknown, never zero", () => {
    const store = new SessionCostStore();
    store.setModel("some-unpriced-model-nobody-has-heard-of");
    store.ingestUsage("turn_1", usage({ inputTokens: 500, outputTokens: 500 }));

    const cost = store.getSessionCost();
    expect(cost.status).toBe("unknown");
    expect(cost.totalUsd).toBe(0);
    expect(cost.pricedTurns).toBe(0);
    expect(cost.unknownTurns).toBe(1);
  });

  it("is partial (a lower bound), not zero, when only some turns priced", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    store.setModel("unpriced-model");
    store.ingestUsage("turn_2", usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const cost = store.getSessionCost();
    expect(cost.status).toBe("partial");
    expect(cost.pricedTurns).toBe(1);
    expect(cost.unknownTurns).toBe(1);
    expect(cost.totalUsd).toBeCloseTo(3, 6);
  });

  it("overwrites (never adds to) a turn's entry when the same turnId is re-ingested (mid-turn update)", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");

    store.ingestUsage("turn_1", usage({ inputTokens: 100_000, outputTokens: 0 }));
    const midTurn = store.getSessionCost().totalUsd;
    expect(midTurn).toBeCloseTo(0.3, 6);

    // A later, larger cumulative reading for the *same* turn replaces the
    // earlier one instead of stacking on top of it.
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    const afterUpdate = store.getSessionCost().totalUsd;
    expect(afterUpdate).toBeCloseTo(3, 6);
    expect(store.getSessionCost().pricedTurns).toBe(1);
  });

  it("accumulates across distinct turnIds", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    store.ingestUsage("turn_2", usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const cost = store.getSessionCost();
    expect(cost.pricedTurns).toBe(2);
    expect(cost.totalUsd).toBeCloseTo(6, 6);
  });

  it("prices a turn already billed at an old model when the model later changes mid-session", () => {
    const store = new SessionCostStore();
    store.setModel("claude-opus-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    store.setModel("claude-haiku-4");
    store.ingestUsage("turn_2", usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const cost = store.getSessionCost();
    // turn_1 priced at Opus ($15/M in), turn_2 at Haiku ($0.8/M in) —
    // history keeps the rate it was actually billed at.
    expect(cost.totalUsd).toBeCloseTo(15 + 0.8, 6);
  });

  it("falls back to the currently open turn when a reading arrives with no turnId", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 100_000, outputTokens: 0 }));
    // A final reading for the same turn arrives without an explicit id.
    store.ingestUsage(undefined, usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const cost = store.getSessionCost();
    expect(cost.pricedTurns).toBe(1);
    expect(cost.totalUsd).toBeCloseTo(3, 6);
  });

  it("closeTurn prevents a later no-turnId reading from being misattributed to a finished turn", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    store.closeTurn();
    // A stray reading with no turnId after close opens a *new* entry
    // instead of overwriting turn_1's.
    store.ingestUsage(undefined, usage({ inputTokens: 1_000_000, outputTokens: 0 }));

    const cost = store.getSessionCost();
    expect(cost.pricedTurns).toBe(2);
    expect(cost.totalUsd).toBeCloseTo(6, 6);
  });

  it("ignores a null/undefined usage reading — never overwrites a known cost with unknown", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    const before = store.getSessionCost();

    store.ingestUsage("turn_1", undefined);
    store.ingestUsage("turn_1", null);

    expect(store.getSessionCost()).toEqual(before);
  });

  it("bumps revision and notifies subscribers on every ingest, not on closeTurn alone", () => {
    const store = new SessionCostStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const before = store.getRevision();
    store.setModel("claude-sonnet-4");
    expect(store.getRevision()).toBe(before); // setModel alone does not bump

    store.ingestUsage("turn_1", usage({ inputTokens: 1_000, outputTokens: 0 }));
    expect(store.getRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    store.closeTurn();
    expect(store.getRevision()).toBe(before + 1); // closeTurn alone does not bump
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const store = new SessionCostStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000, outputTokens: 0 }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a cached snapshot object across calls until the next mutation", () => {
    const store = new SessionCostStore();
    const first = store.getSessionCost();
    const second = store.getSessionCost();
    expect(first).toBe(second);

    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000, outputTokens: 0 }));
    const third = store.getSessionCost();
    expect(third).not.toBe(first);
    expect(store.getSessionCost()).toBe(third);
  });

  it("reset clears the model, every turn, and the open-turn fallback", () => {
    const store = new SessionCostStore();
    store.setModel("claude-sonnet-4");
    store.ingestUsage("turn_1", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    expect(store.getSessionCost().pricedTurns).toBe(1);

    store.reset();
    expect(store.getSessionCost()).toEqual({
      status: "unknown",
      totalUsd: 0,
      pricedTurns: 0,
      unknownTurns: 0,
    });

    // The model was cleared too — the same usage now prices as unknown
    // until a model is set again.
    store.ingestUsage("turn_2", usage({ inputTokens: 1_000_000, outputTokens: 0 }));
    expect(store.getSessionCost().status).toBe("unknown");
  });
});
