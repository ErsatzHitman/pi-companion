import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isCompactionEntry, TranscriptCompactionRow } from "./compaction-row.js";
import type { CompactionTranscriptEntry } from "./compaction-row.js";

afterEach(cleanup);

function compactionEntry(overrides: Record<string, unknown> = {}): CompactionTranscriptEntry {
  return {
    kind: "compaction",
    id: "row-9",
    epoch: "epoch-1",
    seqStart: 9,
    seqEnd: 9,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    status: "completed",
    ...overrides,
  } as CompactionTranscriptEntry;
}

describe("isCompactionEntry", () => {
  it("accepts only the compaction kind", () => {
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
    expect(isCompactionEntry(compactionEntry())).toBe(true);
    expect(isCompactionEntry(message)).toBe(false);
  });
});

describe("TranscriptCompactionRow", () => {
  it("explains an in-progress automatic compaction as a live status, not a chat bubble", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "loading", trigger: "auto" })}
        testId="compaction-1"
      />,
    );
    const marker = screen.getByTestId("compaction-1");
    expect(marker.getAttribute("role")).toBe("status");
    expect(marker.textContent).toContain("Automatic compaction in progress");
    expect(marker.textContent).toContain("condensing earlier turns");
  });

  it("explains a completed manual compaction, including the pre-compaction token count", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", trigger: "manual", preTokens: 128_500 })}
        testId="compaction-2"
      />,
    );
    const marker = screen.getByTestId("compaction-2");
    expect(marker.textContent).toContain("Manual compaction completed");
    expect(marker.textContent).toContain("128,500 tokens");
  });

  it("does not claim a trigger it was not told about", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed" })}
        testId="compaction-3"
      />,
    );
    const marker = screen.getByTestId("compaction-3");
    expect(marker.textContent).toContain("Compaction completed");
    expect(marker.textContent).not.toContain("Automatic");
    expect(marker.textContent).not.toContain("Manual");
  });

  it("omits the token note when preTokens is not supplied", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", trigger: "auto" })}
        testId="compaction-4"
      />,
    );
    expect(screen.getByTestId("compaction-4").textContent).not.toContain("tokens beforehand");
  });

  // T146: the app carries these fields since T143 (`7fb0c26`) — the old
  // blanket claim that it never would is gone, not reworded, from every
  // rendered compaction, completed or loading.
  it("never renders the pre-T143 false claim that the app doesn't carry this detail", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", trigger: "manual", preTokens: 4_000 })}
        testId="compaction-no-false-claim"
      />,
    );
    const text = screen.getByTestId("compaction-no-false-claim").textContent ?? "";
    expect(text).not.toContain("isn't available here yet");
    expect(text).not.toContain("doesn't carry that detail from the agent today");
  });

  it("renders Pi's own summary when the daemon supplied one (T143)", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({
          status: "completed",
          trigger: "manual",
          summary: "Discussed the auth refactor and merged two branches.",
        })}
        testId="compaction-summary"
      />,
    );
    expect(screen.getByTestId("compaction-summary").textContent).toContain(
      "Summary: Discussed the auth refactor and merged two branches.",
    );
  });

  it("renders the read and modified file counts when the daemon supplied them (T143)", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({
          status: "completed",
          filesRead: ["a.ts", "b.ts"],
          filesModified: ["c.ts"],
        })}
        testId="compaction-files"
      />,
    );
    expect(screen.getByTestId("compaction-files").textContent).toContain(
      "(2 files read, 1 file modified)",
    );
  });

  it("renders only the read-file count when no file was modified (T143)", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", filesRead: ["a.ts"] })}
        testId="compaction-files-read-only"
      />,
    );
    const text = screen.getByTestId("compaction-files-read-only").textContent ?? "";
    expect(text).toContain("(1 file read)");
    expect(text).not.toContain("modified");
  });

  it("renders the post-compaction token estimate alongside the pre-compaction count (T143)", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({
          status: "completed",
          preTokens: 128_500,
          estimatedTokensAfter: 4_000,
        })}
        testId="compaction-token-range"
      />,
    );
    expect(screen.getByTestId("compaction-token-range").textContent).toContain(
      "128,500 tokens beforehand, reduced to about 4,000 afterward",
    );
  });

  it("renders the post-compaction token estimate alone when preTokens is not supplied", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", estimatedTokensAfter: 4_000 })}
        testId="compaction-token-after-only"
      />,
    );
    expect(screen.getByTestId("compaction-token-after-only").textContent).toContain(
      "now uses about 4,000 tokens",
    );
  });

  it("honestly says this particular compaction had no summary or file details, when the daemon sent none", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", trigger: "manual", preTokens: 4_000 })}
        testId="compaction-absent"
      />,
    );
    expect(screen.getByTestId("compaction-absent").textContent).toContain(
      "No summary or file details were provided for this compaction.",
    );
  });

  it("does not add the absent-details note once a summary is present", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", summary: "ok" })}
        testId="compaction-absent-not-shown"
      />,
    );
    expect(screen.getByTestId("compaction-absent-not-shown").textContent).not.toContain(
      "No summary or file details were provided",
    );
  });

  it("does not add the absent-details note while a compaction is still loading — there is nothing to summarize yet", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "loading", trigger: "manual" })}
        testId="compaction-loading-no-absent-note"
      />,
    );
    const text = screen.getByTestId("compaction-loading-no-absent-note").textContent ?? "";
    expect(text).not.toContain("isn't available here yet");
    expect(text).not.toContain("No summary or file details were provided");
  });

  it("does not re-render when given a new object reference with identical field values", () => {
    const entry = compactionEntry({ status: "completed", summary: "Initial summary." });
    const { rerender, getByTestId } = render(
      <TranscriptCompactionRow entry={entry} testId="compaction-stable" />,
    );
    const before = getByTestId("compaction-stable").parentElement;
    expect(before?.getAttribute("data-render-count")).toBe("1");

    rerender(<TranscriptCompactionRow entry={{ ...entry }} testId="compaction-stable" />);
    const after = getByTestId("compaction-stable").parentElement;
    expect(after?.getAttribute("data-render-count")).toBe("1");
  });

  // T146 acceptance: "change ONLY the summary between renders and show the
  // row updating." A summary-only change carries no `preTokens` change, so
  // this is exactly the case the task called out as the one
  // `areCompactionRowPropsEqual` must not miss.
  it("re-renders when only the summary changes, with no token count involved", () => {
    const entry = compactionEntry({ status: "completed", summary: "First summary." });
    const { rerender, getByTestId } = render(
      <TranscriptCompactionRow entry={entry} testId="compaction-summary-live" />,
    );
    expect(
      getByTestId("compaction-summary-live").parentElement?.getAttribute("data-render-count"),
    ).toBe("1");

    rerender(
      <TranscriptCompactionRow
        entry={{ ...entry, summary: "Second summary." }}
        testId="compaction-summary-live"
      />,
    );
    const after = getByTestId("compaction-summary-live");
    expect(after.parentElement?.getAttribute("data-render-count")).toBe("2");
    expect(after.textContent).toContain("Summary: Second summary.");
    expect(after.textContent).not.toContain("First summary.");
  });

  it("is visually distinct from a message row: a status marker, not a speaker-attributed bubble", () => {
    render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed" })}
        testId="compaction-5"
      />,
    );
    const marker = screen.getByTestId("compaction-5");
    expect(marker.className).toContain("pc-banner");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("has no axe violations while loading or completed", async () => {
    const { container: loadingContainer } = render(
      <TranscriptCompactionRow entry={compactionEntry({ status: "loading", trigger: "auto" })} />,
    );
    expect(await axe(loadingContainer)).toHaveNoViolations();
    cleanup();

    const { container: completedContainer } = render(
      <TranscriptCompactionRow
        entry={compactionEntry({ status: "completed", trigger: "manual", preTokens: 4_200 })}
      />,
    );
    expect(await axe(completedContainer)).toHaveNoViolations();
  }, 20_000);
});
