import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { Transcript } from "./transcript.js";

afterEach(cleanup);

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

function thinking(id: string, seqStart: number, text: string): timeline.TranscriptEntry {
  return row({ kind: "thinking", id, seqStart, seqEnd: seqStart, text });
}

function toolCall(id: string, seqStart: number, displayName = "Note"): timeline.TranscriptEntry {
  return row({
    kind: "tool-call",
    id,
    seqStart,
    seqEnd: seqStart,
    tool: {
      family: "plain_text",
      callId: `call-${id}`,
      toolName: "note",
      status: "completed",
      displayName,
      updateCount: 1,
      text: `${displayName} output`,
    },
  });
}

function userMessage(id: string, seqStart: number): timeline.TranscriptEntry {
  return row({ kind: "user-message", id, seqStart, seqEnd: seqStart, text: "Hello Pi" });
}

function assistantMessage(id: string, seqStart: number): timeline.TranscriptEntry {
  return row({
    kind: "assistant-message",
    id,
    seqStart,
    seqEnd: seqStart,
    text: "Hi there",
    corrected: false,
  });
}

function virtualRowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).map(
    (element) => element.textContent ?? "",
  );
}

describe("Transcript work grouping (T388)", () => {
  it("collapses a three-or-more-member work run by default and expands it on activation", async () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("u1", 1),
      thinking("t1", 2, "considering options"),
      toolCall("tc1", 3, "Read"),
      thinking("t4", 4, "checking the file"),
      assistantMessage("a1", 5),
    ];
    const { container } = render(<Transcript entries={entries} testId="transcript" />);

    // Collapsed: user, one group head, assistant. The members are gone from
    // the list, not merely hidden.
    const collapsed = virtualRowTexts(container);
    expect(collapsed).toHaveLength(3);
    expect(collapsed[0]).toContain("Hello Pi");
    expect(collapsed[1]).toContain("Read");
    expect(collapsed[1]).toContain("3 steps");
    expect(collapsed[2]).toContain("Hi there");
    expect(screen.queryByText("considering options")).toBeNull();

    const head = screen.getByTestId("transcript-work-group-t1");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(head.textContent).toContain("Read");

    await userEvent.click(head);

    expect(head.getAttribute("aria-expanded")).toBe("true");
    const expanded = virtualRowTexts(container);
    expect(expanded).toHaveLength(5);
    expect(expanded[1]).toContain("considering options");
    expect(expanded[2]).toContain("Read output");
    expect(expanded[3]).toContain("checking the file");

    await userEvent.click(head);
    expect(virtualRowTexts(container)).toHaveLength(3);
  });

  it("leaves a two-member run expanded, with its head still drawn", () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("u1", 1),
      thinking("t1", 2, "considering"),
      toolCall("tc1", 3, "Read"),
      assistantMessage("a1", 4),
    ];
    const { container } = render(<Transcript entries={entries} testId="transcript" />);

    const texts = virtualRowTexts(container);
    expect(texts).toHaveLength(4);
    expect(texts[1]).toContain("Read");
    expect(texts[1]).toContain("considering");
    expect(texts[2]).toContain("Read output");

    const head = screen.getByTestId("transcript-work-group-t1");
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("never groups across a user or assistant message", () => {
    const entries: timeline.TranscriptEntry[] = [
      thinking("t1", 1, "before"),
      toolCall("tc1", 2, "Read"),
      assistantMessage("a1", 3),
      thinking("t2", 4, "after"),
      toolCall("tc2", 5, "Grep"),
    ];
    render(<Transcript entries={entries} testId="transcript" />);

    expect(screen.getByTestId("transcript-work-group-t1")).toBeTruthy();
    expect(screen.getByTestId("transcript-work-group-t2")).toBeTruthy();
  });

  it("keeps two consecutive single work rows ungrouped", () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("u1", 1),
      thinking("t1", 2, "alone"),
      assistantMessage("a1", 3),
    ];
    const { container } = render(<Transcript entries={entries} testId="transcript" />);
    expect(virtualRowTexts(container)).toHaveLength(3);
    expect(container.querySelector('[data-testid^="transcript-work-group-"]')).toBeNull();
  });

  it("keeps a row's DOM node when an earlier page is prepended (stable keys, not indices)", () => {
    const u1 = userMessage("u1", 2);
    const a1 = assistantMessage("a1", 3);
    const { container, rerender } = render(<Transcript entries={[u1, a1]} testId="transcript" />);
    const before = container.querySelector('[data-testid="transcript-row-a1"]');
    expect(before).toBeTruthy();

    rerender(<Transcript entries={[userMessage("u0", 1), u1, a1]} testId="transcript" />);

    const after = container.querySelector('[data-testid="transcript-row-a1"]');
    // A prepend must not shift a row's identity: React reuses the same DOM
    // node because the virtualizer keys it by the entry's stable key, not by
    // its (now shifted) index.
    expect(after).toBe(before);
  });

  it("has no axe violations with a collapsed work group present", async () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("u1", 1),
      thinking("t1", 2, "considering options"),
      toolCall("tc1", 3, "Read"),
      thinking("t4", 4, "checking"),
      assistantMessage("a1", 5),
    ];
    const { container } = render(<Transcript entries={entries} testId="transcript" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
