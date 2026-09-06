import { describe, expect, it } from "vitest";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import {
  deriveCacheShare,
  deriveContextWindowTelemetry,
  deriveContextWindowUsage,
} from "./derive.js";

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return { ...partial };
}

describe("deriveContextWindowUsage", () => {
  it("is unknown when the agent has no usage at all", () => {
    expect(deriveContextWindowUsage(undefined)).toEqual({ status: "unknown" });
    expect(deriveContextWindowUsage(null)).toEqual({ status: "unknown" });
    expect(deriveContextWindowUsage(usage({}))).toEqual({ status: "unknown" });
  });

  it("is unknown when only one of used/max tokens is reported", () => {
    expect(deriveContextWindowUsage(usage({ contextWindowUsedTokens: 1000 }))).toEqual({
      status: "unknown",
    });
    expect(deriveContextWindowUsage(usage({ contextWindowMaxTokens: 200_000 }))).toEqual({
      status: "unknown",
    });
  });

  it("is unknown when the reported ceiling is zero or negative", () => {
    expect(
      deriveContextWindowUsage(usage({ contextWindowUsedTokens: 0, contextWindowMaxTokens: 0 })),
    ).toEqual({ status: "unknown" });
    expect(
      deriveContextWindowUsage(usage({ contextWindowUsedTokens: 5, contextWindowMaxTokens: -1 })),
    ).toEqual({ status: "unknown" });
  });

  it("is unknown for non-finite reported values", () => {
    expect(
      deriveContextWindowUsage(
        usage({ contextWindowUsedTokens: Number.NaN, contextWindowMaxTokens: 200_000 }),
      ),
    ).toEqual({ status: "unknown" });
    expect(
      deriveContextWindowUsage(
        usage({ contextWindowUsedTokens: 10, contextWindowMaxTokens: Number.POSITIVE_INFINITY }),
      ),
    ).toEqual({ status: "unknown" });
  });

  it("derives used fraction from reported used/max tokens", () => {
    expect(
      deriveContextWindowUsage(
        usage({ contextWindowUsedTokens: 50_000, contextWindowMaxTokens: 200_000 }),
      ),
    ).toEqual({
      status: "known",
      usedTokens: 50_000,
      maxTokens: 200_000,
      usedFraction: 0.25,
    });
  });

  it("clamps an over-budget used-token report to a 1.0 fraction rather than overflowing", () => {
    const result = deriveContextWindowUsage(
      usage({ contextWindowUsedTokens: 250_000, contextWindowMaxTokens: 200_000 }),
    );
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.usedFraction).toBe(1);
      // Raw values are preserved even when the fraction is clamped, so a
      // consumer can still show the true "used" number.
      expect(result.usedTokens).toBe(250_000);
    }
  });

  it("treats zero used tokens as known (not unknown) when the ceiling is reported", () => {
    expect(
      deriveContextWindowUsage(
        usage({ contextWindowUsedTokens: 0, contextWindowMaxTokens: 200_000 }),
      ),
    ).toEqual({
      status: "known",
      usedTokens: 0,
      maxTokens: 200_000,
      usedFraction: 0,
    });
  });
});

describe("deriveCacheShare", () => {
  it("is unknown when the agent has no usage at all", () => {
    expect(deriveCacheShare(undefined)).toEqual({ status: "unknown" });
    expect(deriveCacheShare(null)).toEqual({ status: "unknown" });
    expect(deriveCacheShare(usage({}))).toEqual({ status: "unknown" });
  });

  it("is unknown when only one of cached/input tokens is reported", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: 100 }))).toEqual({ status: "unknown" });
    expect(deriveCacheShare(usage({ inputTokens: 100 }))).toEqual({ status: "unknown" });
  });

  it("is unknown when both cached and fresh input tokens are zero (nothing billed yet)", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: 0, inputTokens: 0 }))).toEqual({
      status: "unknown",
    });
  });

  it("is unknown for negative reported values", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: -5, inputTokens: 10 }))).toEqual({
      status: "unknown",
    });
  });

  it("derives a cache-hit percent from cached and fresh input tokens", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: 300, inputTokens: 100 }))).toEqual({
      status: "known",
      cachedTokens: 300,
      freshTokens: 100,
      cacheHitFraction: 0.75,
      cacheHitPercent: 75,
    });
  });

  it("reports a 0% cache hit as known when input tokens were billed but none were cached", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: 0, inputTokens: 100 }))).toEqual({
      status: "known",
      cachedTokens: 0,
      freshTokens: 100,
      cacheHitFraction: 0,
      cacheHitPercent: 0,
    });
  });

  it("reports a 100% cache hit as known when every input token was cached", () => {
    expect(deriveCacheShare(usage({ cachedInputTokens: 100, inputTokens: 0 }))).toEqual({
      status: "known",
      cachedTokens: 100,
      freshTokens: 0,
      cacheHitFraction: 1,
      cacheHitPercent: 100,
    });
  });

  it("rounds the percent to the nearest whole number", () => {
    const result = deriveCacheShare(usage({ cachedInputTokens: 1, inputTokens: 2 }));
    expect(result.status).toBe("known");
    if (result.status === "known") {
      expect(result.cacheHitFraction).toBeCloseTo(1 / 3, 10);
      expect(result.cacheHitPercent).toBe(33);
    }
  });
});

describe("deriveContextWindowTelemetry", () => {
  it("combines both derivations from a single AgentUsage snapshot", () => {
    const combined = deriveContextWindowTelemetry(
      usage({
        contextWindowUsedTokens: 10_000,
        contextWindowMaxTokens: 100_000,
        cachedInputTokens: 900,
        inputTokens: 100,
      }),
    );
    expect(combined.contextWindow).toEqual({
      status: "known",
      usedTokens: 10_000,
      maxTokens: 100_000,
      usedFraction: 0.1,
    });
    expect(combined.cacheShare).toEqual({
      status: "known",
      cachedTokens: 900,
      freshTokens: 100,
      cacheHitFraction: 0.9,
      cacheHitPercent: 90,
    });
  });

  it("keeps each half independently unknown when the provider only reports the other half", () => {
    const combined = deriveContextWindowTelemetry(
      usage({ contextWindowUsedTokens: 500, contextWindowMaxTokens: 1000 }),
    );
    expect(combined.contextWindow.status).toBe("known");
    expect(combined.cacheShare).toEqual({ status: "unknown" });
  });

  it("is fully unknown for an agent that has never reported usage", () => {
    expect(deriveContextWindowTelemetry(undefined)).toEqual({
      contextWindow: { status: "unknown" },
      cacheShare: { status: "unknown" },
    });
  });
});
