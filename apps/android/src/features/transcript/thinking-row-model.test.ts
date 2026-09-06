import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import {
  MAX_BODY_CHARS,
  MAX_SUMMARY_CHARS,
  areThinkingRowPropsEqual,
  bodyFor,
  firstLine,
  formatElapsedDuration,
  isThinkingEntry,
  shouldAnimateShimmer,
  summaryFor,
  truncate,
  type ThinkingTranscriptEntry,
  type TranscriptThinkingRowProps,
} from "./thinking-row-model";

function thinkingEntry(overrides: Partial<ThinkingTranscriptEntry> = {}): ThinkingTranscriptEntry {
  return {
    kind: "thinking",
    id: "row-3",
    epoch: "epoch-1",
    seqStart: 3,
    seqEnd: 3,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text: "The user wants X, so I should check Y first.",
    ...overrides,
  } as ThinkingTranscriptEntry;
}

describe("isThinkingEntry: shared fixture — reasoning-stream (real ingest, not a hand-built entry)", () => {
  // Transcribed (agentId/epoch/seq/timestamp/item fields verbatim) from
  // `packages/frontend-core/src/timeline/fixtures/scenarios/
  // reasoning-stream.ts` — the same "not statically importable across the
  // package boundary" situation `message-row-model.test.ts`'s module doc
  // comment explains for its own fixtures; the same fix (transcribe the
  // literal payload, run it through the real, unmodified
  // `timeline.ingestAgentStreamMessage`/`buildTranscriptEntries`) applies.
  const messages: AgentStreamMessage[] = [
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t28a3_0001",
        epoch: "epoch-t28a3-0001",
        seq: 1,
        timestamp: "2026-09-01T12:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "reasoning",
            text: "Checking the README for the build command before running it.",
          },
        },
      },
    },
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t28a3_0001",
        epoch: "epoch-t28a3-0001",
        seq: 2,
        timestamp: "2026-09-01T12:00:01.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "Running `npm run build` now.",
            messageId: "msg_t28a3_0001",
          },
        },
      },
    },
  ];

  function ingestAll(msgs: AgentStreamMessage[]): coreTimeline.TimelineState {
    let state = coreTimeline.createEmptyTimelineState();
    for (const message of msgs) {
      state = coreTimeline.ingestAgentStreamMessage(state, message);
    }
    return state;
  }

  it("accepts the real thinking row and rejects the sibling message row", () => {
    const entries = coreTimeline.buildTranscriptEntries(ingestAll(messages));
    expect(entries).toHaveLength(2);
    const [thinking, message] = entries;
    expect(thinking.kind).toBe("thinking");
    expect(isThinkingEntry(thinking)).toBe(true);
    expect(message.kind).toBe("assistant-message");
    expect(isThinkingEntry(message)).toBe(false);
  });
});

describe("truncate/firstLine: same bound/suffix semantics as web's thinking-row.tsx", () => {
  it("leaves short text unchanged", () => {
    expect(truncate("hi", 80, "…")).toBe("hi");
  });

  it("truncates over-length text to exactly `max`, ending with the suffix", () => {
    const oversized = "a".repeat(100);
    const result = truncate(oversized, 80, "…");
    expect(result).toHaveLength(80);
    expect(result.endsWith("…")).toBe(true);
  });

  it("firstLine returns the trimmed first line of a multi-line string", () => {
    expect(firstLine("  first\nsecond\nthird  ")).toBe("first");
    expect(firstLine("only one line")).toBe("only one line");
  });
});

describe("summaryFor: the announced label changes with live state, not just colour/animation", () => {
  it("prefixes 'Thinking: …' while live", () => {
    const entry = thinkingEntry({ text: "Checking the README for the build command." });
    expect(summaryFor(entry, true)).toBe("Thinking: Checking the README for the build command.");
  });

  it("prefixes 'Thought: …' once settled — same entry, different announced text", () => {
    const entry = thinkingEntry({ text: "Checking the README for the build command." });
    expect(summaryFor(entry, false)).toBe("Thought: Checking the README for the build command.");
  });

  it("falls back to a bare 'Thinking…'/'Thought' when the entry has no text yet", () => {
    const entry = thinkingEntry({ text: "   " });
    expect(summaryFor(entry, true)).toBe("Thinking…");
    expect(summaryFor(entry, false)).toBe("Thought");
  });

  it("bounds the preview to MAX_SUMMARY_CHARS, taking only the first line", () => {
    const entry = thinkingEntry({ text: `${"x".repeat(200)}\nsecond line` });
    const summary = summaryFor(entry, true);
    // "Thinking: " (10 chars) + at most MAX_SUMMARY_CHARS of preview.
    expect(summary.length).toBeLessThanOrEqual(10 + MAX_SUMMARY_CHARS);
    expect(summary).not.toContain("second line");
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("bodyFor: bounded rather than unbounded, per the module doc's cited acceptance", () => {
  it("returns the trimmed text unchanged when under the bound", () => {
    expect(bodyFor(thinkingEntry({ text: "  short reasoning  " }))).toBe("short reasoning");
  });

  it("returns a placeholder for empty/whitespace-only text", () => {
    expect(bodyFor(thinkingEntry({ text: "   " }))).toBe("…");
  });

  it("truncates reasoning far past MAX_BODY_CHARS, keeping the truncation suffix", () => {
    const longText = "reasoning ".repeat(1000); // ~10,000 chars
    const body = bodyFor(thinkingEntry({ text: longText }));
    expect(body.length).toBeLessThan(longText.length);
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(body).toContain("truncated");
  });
});

describe("formatElapsedDuration: matches web's formatElapsed rounding/format", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatElapsedDuration(0)).toBe("0s");
    expect(formatElapsedDuration(4600)).toBe("5s");
    expect(formatElapsedDuration(59_000)).toBe("59s");
  });

  it("formats minute-plus durations as 'Nm Ss'", () => {
    expect(formatElapsedDuration(65_000)).toBe("1m 5s");
    expect(formatElapsedDuration(125_000)).toBe("2m 5s");
  });

  it("never goes negative for a clock skew that makes elapsed time appear negative", () => {
    expect(formatElapsedDuration(-500)).toBe("0s");
  });
});

describe("shouldAnimateShimmer: reduced motion is honoured without ever hiding the live state", () => {
  it("animates only while live and reduced motion is off", () => {
    expect(shouldAnimateShimmer(true, false)).toBe(true);
  });

  it("does not animate once settled, motion preference aside", () => {
    expect(shouldAnimateShimmer(false, false)).toBe(false);
    expect(shouldAnimateShimmer(false, true)).toBe(false);
  });

  it("stops animating under reduced motion while still live — the caller renders statically, not never (see thinking-row.tsx: the caption's `live ?` render gate is separate from this animate gate)", () => {
    expect(shouldAnimateShimmer(true, true)).toBe(false);
  });
});

describe("areThinkingRowPropsEqual: same comparator fields as message-row-model's areMessageRowPropsEqual", () => {
  function props(overrides: Partial<TranscriptThinkingRowProps> = {}): TranscriptThinkingRowProps {
    return { entry: thinkingEntry(), live: false, testId: "thinking-1", ...overrides };
  }

  it("is true for identical props (reference-distinct entries)", () => {
    expect(areThinkingRowPropsEqual(props(), props())).toBe(true);
  });

  it("is false when text changes (a live reasoning delta)", () => {
    expect(
      areThinkingRowPropsEqual(
        props({ entry: thinkingEntry({ text: "partial" }) }),
        props({ entry: thinkingEntry({ text: "partial more" }) }),
      ),
    ).toBe(false);
  });

  it("is false when id, timestamp, live, or testId changes", () => {
    const base = props();
    expect(areThinkingRowPropsEqual(base, props({ entry: thinkingEntry({ id: "row-4" }) }))).toBe(
      false,
    );
    expect(
      areThinkingRowPropsEqual(
        base,
        props({ entry: thinkingEntry({ timestamp: "2026-01-01T00:00:05.000Z" }) }),
      ),
    ).toBe(false);
    expect(areThinkingRowPropsEqual(base, props({ live: true }))).toBe(false);
    expect(areThinkingRowPropsEqual(base, props({ testId: "other" }))).toBe(false);
  });
});

/**
 * Contract proof that the shared `ThinkingSection` recipe this task
 * composes (`../../ui/recipes/ThinkingSection.tsx`) still exposes the
 * TalkBack contract `summaryFor`/`thinking-row.tsx` depend on: a real
 * button role, an `accessibilityState.expanded`, and
 * `accessibilityLabel={summary}` so a live-aware `summary` is what makes
 * the announced label change. Pattern copied from
 * `./message-row-model.test.ts`'s `readStreamingMessageCode()`. Not
 * mutation-checked here — `ThinkingSection.tsx` is not owned by this task
 * (this task's brief: "do not fork it, do not edit it") and must not be
 * left mutated; `../../ui/recipes/recipe-accessibility.test.ts`
 * (T26B, not this task's file) already carries the mutation-checked proof
 * of the first two lines below for that recipe.
 */
function readThinkingSectionCode(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../../ui/recipes/ThinkingSection.tsx", import.meta.url)),
    "utf8",
  );
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ThinkingSection contract this task relies on", () => {
  it('exposes accessibilityRole="button" and accessibilityState={{ expanded }}', () => {
    const code = readThinkingSectionCode();
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityState=\{\{\s*expanded\s*\}\}/);
  });

  it("sets accessibilityLabel={summary} — the prop this.summaryFor's live-aware text flows into", () => {
    const code = readThinkingSectionCode();
    expect(code).toMatch(/accessibilityLabel=\{summary\}/);
  });

  it("reveals/hides the body instantly (no animation gates the body itself, so reduced motion can never make it fail to expand or collapse)", () => {
    const code = readThinkingSectionCode();
    expect(code).toMatch(/\{expanded \? \(/);
  });
});
