import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isCoreMessageEntry, TranscriptMessageRow } from "./message-row.js";
import type { CoreMessageEntry } from "./message-row.js";

afterEach(cleanup);

function userEntry(overrides: Record<string, unknown> = {}): CoreMessageEntry {
  return {
    kind: "user-message",
    id: "row-1",
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text: "Hi Pi",
    ...overrides,
  } as CoreMessageEntry;
}

function assistantEntry(overrides: Record<string, unknown> = {}): CoreMessageEntry {
  return {
    kind: "assistant-message",
    id: "row-2",
    epoch: "epoch-1",
    seqStart: 2,
    seqEnd: 2,
    timestamp: "2026-01-01T00:00:01.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text: "Hi there",
    corrected: false,
    ...overrides,
  } as CoreMessageEntry;
}

describe("isCoreMessageEntry", () => {
  it("accepts user-message and assistant-message kinds only", () => {
    const thinking: timeline.TranscriptEntry = {
      kind: "thinking",
      id: "row-3",
      epoch: "epoch-1",
      seqStart: 3,
      seqEnd: 3,
      timestamp: "2026-01-01T00:00:02.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "reasoning…",
    };
    expect(isCoreMessageEntry(userEntry())).toBe(true);
    expect(isCoreMessageEntry(assistantEntry())).toBe(true);
    expect(isCoreMessageEntry(thinking)).toBe(false);
  });
});

describe("TranscriptMessageRow", () => {
  it("distinguishes user and assistant messages by a visible label, not colour alone", () => {
    render(
      <>
        <TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-user" />
        <TranscriptMessageRow entry={assistantEntry()} streaming={false} testId="row-assistant" />
      </>,
    );
    expect(screen.getByTestId("row-user").textContent).toContain("You");
    expect(screen.getByTestId("row-assistant").textContent).toContain("Pi");
  });

  it("announces the streaming state as visible text, not only the cursor animation", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ text: "Thinking about" })}
        streaming
        testId="row-streaming"
      />,
    );
    expect(screen.getByText("Pi is still responding")).toBeTruthy();
  });

  it("does not re-render when given the same entry, streaming flag, and testId", () => {
    const entry = assistantEntry();
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming={false} testId="row-stable" />,
    );
    const before = getByTestId("row-stable").parentElement;
    expect(before?.getAttribute("data-render-count")).toBe("1");

    // Re-render with a *new* object reference but identical field values —
    // the shape a parent list re-render produces when an unrelated row
    // changed. `React.memo`'s default reference equality would treat this
    // as a change; the custom comparator must not.
    rerender(<TranscriptMessageRow entry={{ ...entry }} streaming={false} testId="row-stable" />);
    const after = getByTestId("row-stable").parentElement;
    expect(after?.getAttribute("data-render-count")).toBe("1");
  });

  it("re-renders only when its own text changes", () => {
    const entry = assistantEntry({ text: "Hel" });
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming testId="row-live" />,
    );
    expect(getByTestId("row-live").parentElement?.getAttribute("data-render-count")).toBe("1");

    rerender(
      <TranscriptMessageRow entry={{ ...entry, text: "Hello" }} streaming testId="row-live" />,
    );
    expect(getByTestId("row-live").parentElement?.getAttribute("data-render-count")).toBe("2");
    expect(getByTestId("row-live").textContent).toContain("Hello");
  });

  it("bounds an oversized message instead of freezing on an unbounded text node", () => {
    const hugeText = "x".repeat(500_000);
    render(
      <TranscriptMessageRow
        entry={assistantEntry({ text: hugeText })}
        streaming={false}
        testId="row-huge"
      />,
    );
    const row = screen.getByTestId("row-huge");
    // Rendered content is bounded well below the source payload size...
    expect(row.textContent!.length).toBeLessThan(hugeText.length);
    // ...and the truncation is visible, not a silent drop.
    expect(row.textContent).toContain("truncated for display");
    // Still plain text: the raw payload is never reinterpreted as markup.
    expect(row.querySelector("script")).toBeNull();
  });

  it("renders a normal-length message unbounded and unchanged", () => {
    render(
      <TranscriptMessageRow entry={userEntry({ text: "A short message" })} streaming={false} />,
    );
    expect(screen.getByText("A short message")).toBeTruthy();
  });

  it("renders a message's images through MessageAttachments (T52A3)", () => {
    render(
      <TranscriptMessageRow
        entry={userEntry({
          images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments-x/y.png", bytes: 1024 }],
        })}
        streaming={false}
        testId="row-with-image"
      />,
    );
    expect(screen.getByTestId("row-with-image-attachments")).toBeTruthy();
    expect(screen.getByText(/You attached an image/)).toBeTruthy();
  });

  it("renders nothing extra for a message with no images", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-no-image" />);
    expect(screen.queryByTestId("row-no-image-attachments")).toBeNull();
  });

  it("re-renders when the entry's images change even if text stays the same", () => {
    const entry = userEntry();
    const { rerender, getByTestId } = render(
      <TranscriptMessageRow entry={entry} streaming={false} testId="row-image-update" />,
    );
    expect(getByTestId("row-image-update").parentElement?.getAttribute("data-render-count")).toBe(
      "1",
    );

    rerender(
      <TranscriptMessageRow
        entry={{
          ...entry,
          images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments-x/z.png", bytes: 512 }],
        }}
        streaming={false}
        testId="row-image-update"
      />,
    );
    expect(getByTestId("row-image-update").parentElement?.getAttribute("data-render-count")).toBe(
      "2",
    );
  });

  it("renders no edit-from-here affordance at all when no handler is supplied (every existing caller, unaffected)", () => {
    render(<TranscriptMessageRow entry={userEntry()} streaming={false} testId="row-no-edit" />);
    expect(screen.queryByRole("button", { name: "Edit from here" })).toBeNull();
  });

  it("never renders an edit-from-here affordance on an assistant message, even with a handler", () => {
    render(
      <TranscriptMessageRow
        entry={assistantEntry()}
        streaming={false}
        onEditFromHere={vi.fn()}
        canEditFromHere
        testId="row-assistant-edit"
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit from here" })).toBeNull();
  });

  it("calls onEditFromHere with the message's own id when its button is activated", async () => {
    const user = userEvent.setup();
    const onEditFromHere = vi.fn();
    render(
      <TranscriptMessageRow
        entry={userEntry({ id: "msg-9" })}
        streaming={false}
        onEditFromHere={onEditFromHere}
        canEditFromHere
        testId="row-edit"
      />,
    );

    await user.click(screen.getByTestId("row-edit-edit-from-here"));

    expect(onEditFromHere).toHaveBeenCalledTimes(1);
    expect(onEditFromHere).toHaveBeenCalledWith("msg-9");
  });

  it("disables (not hides) the edit-from-here button when canEditFromHere is false — a reasoned rejection, not a hidden affordance", async () => {
    const user = userEvent.setup();
    const onEditFromHere = vi.fn();
    render(
      <TranscriptMessageRow
        entry={userEntry()}
        streaming={false}
        onEditFromHere={onEditFromHere}
        canEditFromHere={false}
        testId="row-edit-disabled"
      />,
    );

    const button = screen.getByTestId("row-edit-disabled-edit-from-here");
    expect(button.hasAttribute("hidden")).toBe(false);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    expect(onEditFromHere).not.toHaveBeenCalled();
  });

  it("has no axe violations for a message carrying an image", async () => {
    const { container } = render(
      <TranscriptMessageRow
        entry={assistantEntry({
          images: [{ mimeType: "image/jpeg", path: "/tmp/paseo-attachments-x/w.jpg", bytes: 2048 }],
        })}
        streaming={false}
        testId="row-image-axe"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
