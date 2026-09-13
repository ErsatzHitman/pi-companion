import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { isRetryEntry, retryEntryFromPiRetryEvent, TranscriptRetryRow } from "./retry-row.js";
import type { RetryTranscriptEntry } from "./retry-row.js";

afterEach(cleanup);

function retryEntry(overrides: Partial<RetryTranscriptEntry> = {}): RetryTranscriptEntry {
  return {
    kind: "retry",
    id: "row-retry",
    epoch: "epoch-1",
    seqStart: 8,
    seqEnd: 8,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    phase: "assistant",
    attempt: 2,
    maxAttempts: 5,
    ...overrides,
  };
}

describe("isRetryEntry", () => {
  it("accepts only the web-local retry kind", () => {
    expect(isRetryEntry(retryEntry())).toBe(true);
    expect(isRetryEntry({ kind: "error" })).toBe(false);
    expect(isRetryEntry(null)).toBe(false);
    expect(isRetryEntry(undefined)).toBe(false);
  });
});

describe("retryEntryFromPiRetryEvent", () => {
  it("bridges a genuine pi_retry wire event onto the row shape with nothing inferred", () => {
    const entry = retryEntryFromPiRetryEvent(
      {
        type: "pi_retry",
        provider: "pi",
        phase: "compaction",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2_000,
        error: "summarizer timed out",
      },
      {
        id: "row-retry-bridge",
        epoch: "epoch-1",
        seqStart: 8,
        seqEnd: 8,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );
    expect(entry.kind).toBe("retry");
    expect(entry.provider).toBe("pi");
    expect(entry.phase).toBe("compaction");
    expect(entry.attempt).toBe(1);
    expect(entry.maxAttempts).toBe(3);
    expect(entry.delayMs).toBe(2_000);
    expect(entry.error).toBe("summarizer timed out");
    expect(entry.pending).toBe(false);
    expect(entry.stale).toBe(false);
  });

  it("omits delay and error when the event carries neither", () => {
    const entry = retryEntryFromPiRetryEvent(
      { type: "pi_retry", provider: "pi", phase: "assistant", attempt: 1, maxAttempts: 3 },
      {
        id: "row-retry-bare",
        epoch: "epoch-1",
        seqStart: 8,
        seqEnd: 8,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );
    expect(entry.delayMs).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });
});

describe("TranscriptRetryRow", () => {
  it("explains an automatic retry as a live status with its attempt count", () => {
    render(<TranscriptRetryRow entry={retryEntry()} testId="retry-1" />);
    const marker = screen.getByTestId("retry-1");
    expect(marker.getAttribute("role")).toBe("status");
    expect(marker.textContent).toContain("Automatic retry");
    expect(marker.textContent).toContain("attempt 2 of 5");
  });

  it("names summarization retries for the compaction and branch-summary phases", () => {
    render(<TranscriptRetryRow entry={retryEntry({ phase: "compaction" })} testId="retry-comp" />);
    expect(screen.getByTestId("retry-comp").textContent).toContain("Summarization retry");
    render(
      <TranscriptRetryRow
        entry={retryEntry({ id: "row-retry-branch", phase: "branchSummary" })}
        testId="retry-branch"
      />,
    );
    expect(screen.getByTestId("retry-branch").textContent).toContain("Summarization retry");
  });

  it("carries the backoff delay and the last error in words", () => {
    render(
      <TranscriptRetryRow
        entry={retryEntry({ delayMs: 2_000, error: "summarizer timed out" })}
        testId="retry-full"
      />,
    );
    const text = screen.getByTestId("retry-full").textContent ?? "";
    expect(text).toContain("retrying in 2s");
    expect(text).toContain("Last error: summarizer timed out");
  });

  it("bounds a pathological error string rather than rendering it whole", () => {
    render(
      <TranscriptRetryRow entry={retryEntry({ error: `x`.repeat(10_000) })} testId="retry-long" />,
    );
    const text = screen.getByTestId("retry-long").textContent ?? "";
    expect(text).toContain("truncated for display");
    expect(text.length).toBeLessThan(4_000);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TranscriptRetryRow entry={retryEntry()} testId="retry-axe" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
