import { describe, expect, it } from "vitest";

import {
  buildRunHeaderDisplayText,
  buildRunHeaderSummary,
  buildRunHeaderViewModel,
  countRunHeaderEntries,
  runHeaderAnnouncement,
  RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG,
  RUN_HEADER_CHEVRON_EXPANDED_ROTATION_DEG,
  RUN_HEADER_COLLAPSE_ANNOUNCEMENT,
  RUN_HEADER_EMPTY_SUMMARY,
  RUN_HEADER_EXPAND_ANNOUNCEMENT,
  RUN_HEADER_HIDDEN_SUFFIX,
  RUN_HEADER_SEPARATOR,
  type RunHeaderEntry,
} from "./run-header-model";

function entry(kind: string): RunHeaderEntry {
  return { kind };
}

describe("RUN_HEADER_SEPARATOR: a middle dot, read out of the design's raw bytes", () => {
  it("is exactly one U+00B7 MIDDLE DOT surrounded by one space on each side", () => {
    expect(RUN_HEADER_SEPARATOR).toBe(" · ");
    expect(RUN_HEADER_SEPARATOR.codePointAt(1)).toBe(0xb7);
  });

  it("is not a hyphen, en dash or em dash", () => {
    expect(RUN_HEADER_SEPARATOR).not.toContain("-");
    expect(RUN_HEADER_SEPARATOR).not.toContain("–");
    expect(RUN_HEADER_SEPARATOR).not.toContain("—");
  });
});

describe("countRunHeaderEntries: derives counts from the real run contents", () => {
  it("counts tool-call and assistant-message entries, not user-message or thinking", () => {
    const entries = [
      entry("user-message"),
      entry("tool-call"),
      entry("tool-call"),
      entry("thinking"),
      entry("assistant-message"),
    ];
    expect(countRunHeaderEntries(entries)).toEqual({ toolCallCount: 2, messageCount: 1 });
  });

  it("returns zero counts for an empty run", () => {
    expect(countRunHeaderEntries([])).toEqual({ toolCallCount: 0, messageCount: 0 });
  });
});

describe("buildRunHeaderSummary: the design's own count sentence", () => {
  it("pins the design's own sample exactly: '6 tool calls · 1 message'", () => {
    expect(buildRunHeaderSummary({ toolCallCount: 6, messageCount: 1 })).toBe(
      "6 tool calls · 1 message",
    );
  });

  it("pluralises singular tool call and singular message correctly", () => {
    expect(buildRunHeaderSummary({ toolCallCount: 1, messageCount: 1 })).toBe(
      "1 tool call · 1 message",
    );
  });

  it("pluralises plural counts correctly", () => {
    expect(buildRunHeaderSummary({ toolCallCount: 2, messageCount: 3 })).toBe(
      "2 tool calls · 3 messages",
    );
  });

  it("never reads '0 tool calls': omits the tool-call clause entirely when the count is zero", () => {
    const summary = buildRunHeaderSummary({ toolCallCount: 0, messageCount: 2 });
    expect(summary).toBe("2 messages");
    expect(summary).not.toContain("0 tool call");
  });

  it("omits the message clause entirely when the count is zero", () => {
    const summary = buildRunHeaderSummary({ toolCallCount: 3, messageCount: 0 });
    expect(summary).toBe("3 tool calls");
    expect(summary).not.toContain("0 message");
  });

  it("falls back to the named empty-run constant when both counts are zero, never an empty string", () => {
    const summary = buildRunHeaderSummary({ toolCallCount: 0, messageCount: 0 });
    expect(summary).toBe(RUN_HEADER_EMPTY_SUMMARY);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("0");
  });
});

describe("buildRunHeaderDisplayText: the collapsed suffix", () => {
  it("adds the exact ' · hidden' suffix from runheadTap while collapsed", () => {
    expect(buildRunHeaderDisplayText("6 tool calls · 1 message", true)).toBe(
      `6 tool calls · 1 message${RUN_HEADER_SEPARATOR}${RUN_HEADER_HIDDEN_SUFFIX}`,
    );
    expect(buildRunHeaderDisplayText("6 tool calls · 1 message", true)).toBe(
      "6 tool calls · 1 message · hidden",
    );
  });

  it("leaves the summary unchanged while expanded", () => {
    expect(buildRunHeaderDisplayText("6 tool calls · 1 message", false)).toBe(
      "6 tool calls · 1 message",
    );
  });
});

describe("runHeaderAnnouncement: runheadTap's own two say() sentences", () => {
  it("announces 'Run collapsed to its header' when collapsed", () => {
    expect(runHeaderAnnouncement(true)).toBe(RUN_HEADER_COLLAPSE_ANNOUNCEMENT);
    expect(runHeaderAnnouncement(true)).toBe("Run collapsed to its header");
  });

  it("announces 'Run expanded' when expanded", () => {
    expect(runHeaderAnnouncement(false)).toBe(RUN_HEADER_EXPAND_ANNOUNCEMENT);
    expect(runHeaderAnnouncement(false)).toBe("Run expanded");
  });
});

describe("chevron rotation constants", () => {
  it("rotates to exactly -90deg when collapsed, per .t.runfold .runhead svg", () => {
    expect(RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG).toBe(-90);
  });

  it("rests at 0deg when expanded", () => {
    expect(RUN_HEADER_CHEVRON_EXPANDED_ROTATION_DEG).toBe(0);
  });
});

describe("buildRunHeaderViewModel: wires counting, display text, announcement and rotation together", () => {
  const sixToolCallsOneMessage = [
    entry("tool-call"),
    entry("tool-call"),
    entry("tool-call"),
    entry("tool-call"),
    entry("tool-call"),
    entry("tool-call"),
    entry("assistant-message"),
  ];

  it("while expanded: bare summary, expand announcement, 0deg", () => {
    const vm = buildRunHeaderViewModel(sixToolCallsOneMessage, false);
    expect(vm.summaryText).toBe("6 tool calls · 1 message");
    expect(vm.displayText).toBe("6 tool calls · 1 message");
    expect(vm.announcement).toBe("Run expanded");
    expect(vm.chevronRotationDeg).toBe(0);
    expect(vm.accessibilityLabel).toBe("6 tool calls · 1 message. Run expanded.");
  });

  it("while collapsed: hidden-suffixed summary, collapse announcement, -90deg", () => {
    const vm = buildRunHeaderViewModel(sixToolCallsOneMessage, true);
    expect(vm.summaryText).toBe("6 tool calls · 1 message");
    expect(vm.displayText).toBe("6 tool calls · 1 message · hidden");
    expect(vm.announcement).toBe("Run collapsed to its header");
    expect(vm.chevronRotationDeg).toBe(-90);
    expect(vm.accessibilityLabel).toBe(
      "6 tool calls · 1 message · hidden. Run collapsed to its header.",
    );
  });
});
