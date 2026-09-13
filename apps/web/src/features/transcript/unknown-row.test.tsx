import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isUnknownEntry, TranscriptUnknownRow } from "./unknown-row.js";
import type { UnknownTranscriptEntry } from "./unknown-row.js";

afterEach(cleanup);

function unknownEntry(overrides: Record<string, unknown> = {}): UnknownTranscriptEntry {
  return {
    kind: "unknown",
    id: "row-unk",
    epoch: "epoch-1",
    seqStart: 9,
    seqEnd: 9,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    rawType: "future_widget",
    raw: { type: "future_widget", text: "from a newer daemon" },
    ...overrides,
  } as UnknownTranscriptEntry;
}

describe("isUnknownEntry", () => {
  it("accepts only the unknown kind", () => {
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
    expect(isUnknownEntry(unknownEntry())).toBe(true);
    expect(isUnknownEntry(message)).toBe(false);
  });
});

describe("TranscriptUnknownRow", () => {
  it("names the unrecognized wire type in words so history stays complete", () => {
    render(<TranscriptUnknownRow entry={unknownEntry()} testId="unknown-1" />);
    const card = screen.getByTestId("unknown-1");
    expect(card.textContent).toContain("future_widget");
    expect(card.textContent).toContain("does not recognize it");
    expect(card.textContent).toContain("update the app");
  });

  it("boxes the payload behind a disclosure as inert text, never markup", () => {
    render(<TranscriptUnknownRow entry={unknownEntry()} testId="unknown-2" />);
    const card = screen.getByTestId("unknown-2");
    const disclosure = card.querySelector("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.textContent).toContain("future_widget");
    // Inert text: no element is created from the payload itself.
    expect(card.querySelectorAll("script")).toHaveLength(0);
  });

  it("bounds a pathological payload rather than rendering it whole", () => {
    render(
      <TranscriptUnknownRow
        entry={unknownEntry({ raw: { type: "future_widget", blob: "x".repeat(20_000) } })}
        testId="unknown-long"
      />,
    );
    const text = screen.getByTestId("unknown-long").textContent ?? "";
    expect(text).toContain("truncated");
    expect(text.length).toBeLessThan(8_000);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TranscriptUnknownRow entry={unknownEntry()} testId="unknown-axe" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
