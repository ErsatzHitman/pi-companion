import { describe, expect, it } from "vitest";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import {
  accumulateSessionCost,
  DEFAULT_MODEL_RATES,
  deriveSessionCost,
  deriveTurnCost,
  findModelRate,
  type ModelRate,
  type TurnCost,
} from "./cost.js";

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return { ...partial };
}

const TEST_RATES: readonly ModelRate[] = [
  {
    modelId: "claude-opus-4",
    inputPerMillionUsd: 10,
    cachedInputPerMillionUsd: 1,
    outputPerMillionUsd: 50,
  },
  {
    modelId: "no-cache-model",
    inputPerMillionUsd: 4,
    outputPerMillionUsd: 20,
  },
];

describe("findModelRate", () => {
  it("returns undefined for a missing or empty model id", () => {
    expect(findModelRate(undefined, TEST_RATES)).toBeUndefined();
    expect(findModelRate(null, TEST_RATES)).toBeUndefined();
    expect(findModelRate("", TEST_RATES)).toBeUndefined();
    expect(findModelRate("   ", TEST_RATES)).toBeUndefined();
  });

  it("returns undefined when no table entry matches", () => {
    expect(findModelRate("some-unpriced-model", TEST_RATES)).toBeUndefined();
  });

  it("matches an exact model id case-insensitively", () => {
    expect(findModelRate("Claude-Opus-4", TEST_RATES)?.modelId).toBe("claude-opus-4");
  });

  it("matches a dated snapshot id against its family prefix", () => {
    expect(findModelRate("claude-opus-4-20260115", TEST_RATES)?.modelId).toBe("claude-opus-4");
  });

  it("does not match a shorter model id against a longer table prefix", () => {
    // "claude-opus-4" itself must not match as a prefix of a *shorter*
    // reported id such as "claude-opus".
    expect(findModelRate("claude-opus", TEST_RATES)).toBeUndefined();
  });

  it("picks the longest matching prefix when more than one could apply", () => {
    const rates: ModelRate[] = [
      { modelId: "gpt-5", inputPerMillionUsd: 1, outputPerMillionUsd: 1 },
      { modelId: "gpt-5-mini", inputPerMillionUsd: 2, outputPerMillionUsd: 2 },
    ];
    expect(findModelRate("gpt-5-mini-20260101", rates)?.modelId).toBe("gpt-5-mini");
  });

  it("resolves every entry in the shipped default rate table against itself", () => {
    for (const entry of DEFAULT_MODEL_RATES) {
      expect(findModelRate(entry.modelId)?.modelId).toBe(entry.modelId);
    }
  });
});

describe("deriveTurnCost", () => {
  it("is unknown with reason no-usage when the turn reported no usage at all", () => {
    expect(deriveTurnCost(undefined, "claude-opus-4", TEST_RATES)).toEqual({
      status: "unknown",
      reason: "no-usage",
    });
    expect(deriveTurnCost(null, "claude-opus-4", TEST_RATES)).toEqual({
      status: "unknown",
      reason: "no-usage",
    });
  });

  it("is unknown with reason unknown-model when the model has no rate, even with real usage", () => {
    const result = deriveTurnCost(
      usage({ inputTokens: 1000, outputTokens: 500 }),
      "some-unreleased-model",
      TEST_RATES,
    );
    expect(result).toEqual({ status: "unknown", reason: "unknown-model" });
  });

  it("is unknown with reason unknown-model when no model id was reported", () => {
    const result = deriveTurnCost(usage({ inputTokens: 1000 }), undefined, TEST_RATES);
    expect(result).toEqual({ status: "unknown", reason: "unknown-model" });
  });

  it("prices fresh input, cached input, and output tokens separately when the model has a cache rate", () => {
    const result = deriveTurnCost(
      usage({ inputTokens: 1_000_000, cachedInputTokens: 2_000_000, outputTokens: 500_000 }),
      "claude-opus-4",
      TEST_RATES,
    );
    expect(result).toEqual({
      status: "known",
      modelId: "claude-opus-4",
      inputTokens: 1_000_000,
      cachedInputTokens: 2_000_000,
      outputTokens: 500_000,
      inputUsd: 10, // 1M tokens * $10/M
      cachedInputUsd: 2, // 2M tokens * $1/M
      outputUsd: 25, // 0.5M tokens * $50/M
      totalUsd: 37,
    });
  });

  it("falls back cached tokens to the fresh input rate when the model has no distinct cache rate", () => {
    const result = deriveTurnCost(
      usage({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }),
      "no-cache-model",
      TEST_RATES,
    );
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.inputUsd).toBe(4);
      expect(result.cachedInputUsd).toBe(4);
      expect(result.totalUsd).toBe(8);
    }
  });

  it("prices a turn with all-zero usage as a known $0 turn, not unknown", () => {
    const result = deriveTurnCost(
      usage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }),
      "claude-opus-4",
      TEST_RATES,
    );
    expect(result).toEqual({
      status: "known",
      modelId: "claude-opus-4",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      inputUsd: 0,
      cachedInputUsd: 0,
      outputUsd: 0,
      totalUsd: 0,
    });
  });

  it("treats missing individual token fields on a known-usage turn as zero, not unknown", () => {
    const result = deriveTurnCost(usage({ outputTokens: 100_000 }), "claude-opus-4", TEST_RATES);
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.inputTokens).toBe(0);
      expect(result.cachedInputTokens).toBe(0);
      expect(result.outputUsd).toBe(5);
    }
  });

  it("treats negative or non-finite reported token counts as zero rather than propagating garbage", () => {
    const result = deriveTurnCost(
      usage({ inputTokens: -5, cachedInputTokens: Number.NaN, outputTokens: 100_000 }),
      "claude-opus-4",
      TEST_RATES,
    );
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.inputTokens).toBe(0);
      expect(result.cachedInputTokens).toBe(0);
      expect(result.outputUsd).toBe(5);
    }
  });

  it("resolves against the shipped default rate table when no override is passed", () => {
    const result = deriveTurnCost(usage({ outputTokens: 1_000_000 }), "gpt-5-mini-2026");
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.modelId).toBe("gpt-5-mini");
    }
  });
});

describe("accumulateSessionCost", () => {
  it("is unknown for zero turns", () => {
    expect(accumulateSessionCost([])).toEqual({
      status: "unknown",
      totalUsd: 0,
      pricedTurns: 0,
      unknownTurns: 0,
    });
  });

  it("is unknown when every turn is unknown", () => {
    const turns: TurnCost[] = [
      { status: "unknown", reason: "no-usage" },
      { status: "unknown", reason: "unknown-model" },
    ];
    expect(accumulateSessionCost(turns)).toEqual({
      status: "unknown",
      totalUsd: 0,
      pricedTurns: 0,
      unknownTurns: 2,
    });
  });

  it("is known and sums totals when every turn priced", () => {
    const a = deriveTurnCost(usage({ outputTokens: 1_000_000 }), "claude-opus-4", TEST_RATES);
    const b = deriveTurnCost(usage({ inputTokens: 1_000_000 }), "claude-opus-4", TEST_RATES);
    const session = accumulateSessionCost([a, b]);
    expect(session.status).toBe("known");
    expect(session.pricedTurns).toBe(2);
    expect(session.unknownTurns).toBe(0);
    expect(session.totalUsd).toBe(60); // 50 (output) + 10 (input)
  });

  it("is partial, and totalUsd is a lower bound, when some turns priced and some did not", () => {
    const known = deriveTurnCost(usage({ outputTokens: 1_000_000 }), "claude-opus-4", TEST_RATES);
    const unknown: TurnCost = { status: "unknown", reason: "unknown-model" };
    const session = accumulateSessionCost([known, unknown]);
    expect(session).toEqual({
      status: "partial",
      totalUsd: 50,
      pricedTurns: 1,
      unknownTurns: 1,
    });
  });
});

describe("deriveSessionCost", () => {
  it("derives per-turn and accumulates in one pass, matching the two-step composition", () => {
    const records = [
      { turnId: "t1", modelId: "claude-opus-4", usage: usage({ inputTokens: 1_000_000 }) },
      { turnId: "t2", modelId: "claude-opus-4", usage: usage({ outputTokens: 500_000 }) },
      { turnId: "t3", modelId: undefined, usage: usage({ inputTokens: 200 }) },
    ] as const;

    const oneShot = deriveSessionCost(records, TEST_RATES);

    const composed = accumulateSessionCost(
      records.map((r) => deriveTurnCost(r.usage, r.modelId, TEST_RATES)),
    );

    expect(oneShot).toEqual(composed);
    expect(oneShot).toEqual({
      status: "partial",
      totalUsd: 35, // 10 (input) + 25 (output)
      pricedTurns: 2,
      unknownTurns: 1,
    });
  });

  it("is unknown for a session with no turns yet", () => {
    expect(deriveSessionCost([], TEST_RATES)).toEqual({
      status: "unknown",
      totalUsd: 0,
      pricedTurns: 0,
      unknownTurns: 0,
    });
  });
});
