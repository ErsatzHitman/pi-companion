import { describe, expect, it } from "vitest";

import {
  CONTEXT_CRITICAL_FRACTION,
  CONTEXT_WARNING_FRACTION,
  buildContextCardViewModel,
  contextUsageBand,
  formatTokenCount,
  formatUsagePercent,
} from "./context-usage-model";

describe("formatTokenCount", () => {
  it("renders millions with one decimal", () => {
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
  });

  it("renders thousands with one decimal", () => {
    expect(formatTokenCount(12_400)).toBe("12.4k");
    expect(formatTokenCount(1_000)).toBe("1.0k");
    expect(formatTokenCount(200_000)).toBe("200.0k");
  });

  it("renders anything under a thousand verbatim", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(0)).toBe("0");
  });

  it("never rounds up into a threshold the session has not reached", () => {
    expect(formatTokenCount(999_999)).toBe("999.9k");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("renders nonsense from a provider as 0 rather than NaN", () => {
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatTokenCount(-5)).toBe("0");
  });
});

describe("formatUsagePercent", () => {
  it("renders a fraction as the artifact's one-decimal percentage", () => {
    expect(formatUsagePercent(0.412)).toBe("41.2%");
    expect(formatUsagePercent(0)).toBe("0.0%");
    expect(formatUsagePercent(1)).toBe("100.0%");
  });
});

describe("contextUsageBand", () => {
  it("is normal below the warning threshold", () => {
    expect(contextUsageBand(0)).toBe("normal");
    expect(contextUsageBand(0.5)).toBe("normal");
    expect(contextUsageBand(CONTEXT_WARNING_FRACTION)).toBe("normal");
  });

  it("is warning above 70% and critical above 90%", () => {
    expect(contextUsageBand(0.71)).toBe("warning");
    expect(contextUsageBand(CONTEXT_CRITICAL_FRACTION)).toBe("warning");
    expect(contextUsageBand(0.91)).toBe("critical");
    expect(contextUsageBand(1)).toBe("critical");
  });
});

describe("buildContextCardViewModel", () => {
  const full = {
    inputTokens: 12_400,
    cachedInputTokens: 100_000,
    outputTokens: 3_100,
    totalCostUsd: 0.312,
    contextWindowMaxTokens: 200_000,
    contextWindowUsedTokens: 82_400,
  };

  it("reads the percentage and the ceiling off a real AgentUsage", () => {
    const model = buildContextCardViewModel({ usage: full });
    expect(model.summary).toContain("41.2%");
    expect(model.summary).toContain("200.0k");
    expect(model.fraction).toBeCloseTo(0.412, 5);
  });

  it("says so in words when the provider has reported no window, rather than showing 0%", () => {
    const model = buildContextCardViewModel({ usage: { inputTokens: 10 } });
    expect(model.fraction).toBeNull();
    expect(model.summary).not.toContain("0.0%");
    expect(model.summary.toLowerCase()).toContain("not reported");
    expect(model.accessibilityLabel.toLowerCase()).toContain("not reported");
  });

  it("treats an absent usage the same as an unreported window", () => {
    expect(buildContextCardViewModel({ usage: null }).fraction).toBeNull();
    expect(buildContextCardViewModel({ usage: undefined }).fraction).toBeNull();
  });

  it("omits the auto-compaction clause entirely until somebody knows the answer", () => {
    expect(buildContextCardViewModel({ usage: full }).summary).not.toContain("auto-compaction");
    expect(buildContextCardViewModel({ usage: full, autoCompaction: true }).summary).toContain(
      "auto-compaction on",
    );
    expect(buildContextCardViewModel({ usage: full, autoCompaction: false }).summary).toContain(
      "auto-compaction off",
    );
  });

  it("builds the stats line from the fields the provider actually reported", () => {
    const model = buildContextCardViewModel({ usage: full });
    expect(model.statsText).toBe("↑12.4k ↓3.1k CH89.0% $0.312");
  });

  it("shows no stat a provider did not report, rather than a measured-looking zero", () => {
    const model = buildContextCardViewModel({
      usage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 1_000 },
    });
    expect(model.statsText).toBe("");
    expect(model.statsText).not.toContain("$");
    expect(model.statsText).not.toContain("CH");
  });

  it("bands the colour off the same thresholds the ring will use", () => {
    const hot = buildContextCardViewModel({
      usage: { contextWindowMaxTokens: 100, contextWindowUsedTokens: 95 },
    });
    expect(hot.band).toBe("critical");
    expect(hot.summary).toContain("95.0%");
  });

  it("speaks the percentage, so the colour band is never the only signal", () => {
    const model = buildContextCardViewModel({ usage: full });
    expect(model.accessibilityLabel).toContain("41.2%");
    expect(model.accessibilityLabel).toContain("200.0k");
  });

  it("keeps a stats line even when the window itself is unknown", () => {
    const model = buildContextCardViewModel({ usage: { inputTokens: 500, outputTokens: 250 } });
    expect(model.fraction).toBeNull();
    expect(model.statsText).toBe("↑500 ↓250");
  });
});
