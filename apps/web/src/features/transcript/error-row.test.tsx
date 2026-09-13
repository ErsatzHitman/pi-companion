import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isErrorEntry, TranscriptErrorRow } from "./error-row.js";
import type { ErrorTranscriptEntry } from "./error-row.js";

afterEach(cleanup);

function errorEntry(overrides: Record<string, unknown> = {}): ErrorTranscriptEntry {
  return {
    kind: "error",
    id: "row-err",
    epoch: "epoch-1",
    seqStart: 7,
    seqEnd: 7,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    message: "turn failed: context window exhausted",
    ...overrides,
  } as ErrorTranscriptEntry;
}

describe("isErrorEntry", () => {
  it("accepts only the error kind", () => {
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
    expect(isErrorEntry(errorEntry())).toBe(true);
    expect(isErrorEntry(message)).toBe(false);
  });
});

describe("TranscriptErrorRow", () => {
  it("explains the failure as a live status, not a chat bubble", () => {
    render(<TranscriptErrorRow entry={errorEntry()} testId="error-1" />);
    const marker = screen.getByTestId("error-1");
    expect(marker.getAttribute("role")).toBe("status");
    expect(marker.textContent).toContain("Something went wrong");
    expect(marker.textContent).toContain("turn failed: context window exhausted");
  });

  it("says so explicitly when the daemon reported no details", () => {
    render(<TranscriptErrorRow entry={errorEntry({ message: "   " })} testId="error-empty" />);
    expect(screen.getByTestId("error-empty").textContent).toContain("with no details");
  });

  it("bounds a pathological message rather than rendering it whole", () => {
    render(
      <TranscriptErrorRow
        entry={errorEntry({ message: `boom\n${"x".repeat(10_000)}` })}
        testId="error-long"
      />,
    );
    const text = screen.getByTestId("error-long").textContent ?? "";
    expect(text).toContain("truncated for display");
    expect(text.length).toBeLessThan(6_000);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TranscriptErrorRow entry={errorEntry()} testId="error-axe" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
