import { act, cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isThinkingEntry, TranscriptThinkingRow } from "./thinking-row.js";
import type { ThinkingTranscriptEntry } from "./thinking-row.js";

afterEach(cleanup);

function thinkingEntry(overrides: Record<string, unknown> = {}): ThinkingTranscriptEntry {
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

describe("isThinkingEntry", () => {
  it("accepts only the thinking kind", () => {
    const message: timeline.TranscriptEntry = {
      kind: "user-message",
      id: "row-1",
      epoch: "epoch-1",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "hi",
    };
    expect(isThinkingEntry(thinkingEntry())).toBe(true);
    expect(isThinkingEntry(message)).toBe(false);
  });
});

describe("TranscriptThinkingRow", () => {
  it("renders a collapsed-by-default disclosure that expands and collapses by keyboard with correct ARIA state", async () => {
    const user = userEvent.setup();
    render(<TranscriptThinkingRow entry={thinkingEntry()} live={false} testId="thinking-1" />);
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".pc-thinking__body p")?.textContent).toContain(
      "The user wants X",
    );

    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the body text bounded to a maximum length rather than unbounded", () => {
    const longText = "reasoning ".repeat(1000); // ~10,000 chars, well past the cap
    render(
      <TranscriptThinkingRow
        entry={thinkingEntry({ text: longText })}
        live={false}
        testId="thinking-long"
      />,
    );
    const region = document.querySelector(".pc-thinking__body p");
    expect(region?.textContent).toBeTruthy();
    expect((region?.textContent ?? "").length).toBeLessThan(longText.length);
    expect(region?.textContent).toContain("truncated");
  });

  it("announces the live state as visible text, not colour/animation alone, while streaming", () => {
    render(<TranscriptThinkingRow entry={thinkingEntry()} live testId="thinking-live" />);
    expect(screen.getByText("Still thinking")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toContain("Thinking");
  });

  it("does not announce the live state once settled", () => {
    render(
      <TranscriptThinkingRow entry={thinkingEntry()} live={false} testId="thinking-settled" />,
    );
    expect(screen.queryByText("Still thinking")).toBeNull();
  });

  it("does not re-render when given the same entry, live flag, and testId", () => {
    const entry = thinkingEntry();
    const { rerender, getByTestId } = render(
      <TranscriptThinkingRow entry={entry} live={false} testId="thinking-stable" />,
    );
    const before = getByTestId("thinking-stable").parentElement;
    expect(before?.getAttribute("data-render-count")).toBe("1");

    rerender(<TranscriptThinkingRow entry={{ ...entry }} live={false} testId="thinking-stable" />);
    const after = getByTestId("thinking-stable").parentElement;
    expect(after?.getAttribute("data-render-count")).toBe("1");
  });

  it("re-renders when its own text changes", () => {
    const entry = thinkingEntry({ text: "First" });
    const { rerender, getByTestId } = render(
      <TranscriptThinkingRow entry={entry} live testId="thinking-updating" />,
    );
    expect(getByTestId("thinking-updating").parentElement?.getAttribute("data-render-count")).toBe(
      "1",
    );

    rerender(
      <TranscriptThinkingRow
        entry={{ ...entry, text: "First, then more" }}
        live
        testId="thinking-updating"
      />,
    );
    expect(getByTestId("thinking-updating").parentElement?.getAttribute("data-render-count")).toBe(
      "2",
    );
  });

  it("has no axe violations, expanded or collapsed", async () => {
    const { container, rerender } = render(
      <TranscriptThinkingRow entry={thinkingEntry()} live={false} testId="thinking-axe" />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<TranscriptThinkingRow entry={thinkingEntry()} live testId="thinking-axe" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("live duration readout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks while live and freezes the moment it stops being live", () => {
    const entry = thinkingEntry({ timestamp: "2026-01-01T00:00:00.000Z" });
    const { rerender, getByTestId } = render(
      <TranscriptThinkingRow entry={entry} live testId="thinking-duration" />,
    );
    // 5s elapsed at mount.
    expect(getByTestId("thinking-duration").textContent).toContain("5s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(getByTestId("thinking-duration").textContent).toContain("8s");

    // Stops being live: the readout freezes rather than continuing to
    // count up against the wall clock.
    rerender(<TranscriptThinkingRow entry={entry} live={false} testId="thinking-duration" />);
    const frozen = getByTestId("thinking-duration").textContent;
    expect(frozen).toContain("8s");

    act(() => {
      vi.advanceTimersByTime(52_000);
    });
    rerender(<TranscriptThinkingRow entry={entry} live={false} testId="thinking-duration" />);
    expect(getByTestId("thinking-duration").textContent).toBe(frozen);
  });

  it("reports no duration for an entry that was already settled when first observed", () => {
    const entry = thinkingEntry({ timestamp: "2026-01-01T00:00:00.000Z" });
    render(<TranscriptThinkingRow entry={entry} live={false} testId="thinking-unknown" />);
    // Rendered without ever having been live: `.pc-thinking__duration`
    // should not fabricate an elapsed time from wall-clock now.
    const duration = document.querySelector(".pc-thinking__duration");
    expect(duration?.textContent ?? "").toBe("");
  });
});
