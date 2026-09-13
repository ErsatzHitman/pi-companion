import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { isTodoEntry } from "./todo-dock.js";
import { TranscriptTodoRow } from "./todo-row.js";
import type { TodoTranscriptEntry } from "./todo-row.js";

afterEach(cleanup);

function todoEntry(overrides: Record<string, unknown> = {}): TodoTranscriptEntry {
  return {
    kind: "todo",
    id: "todo-inline",
    epoch: "epoch-1",
    seqStart: 4,
    seqEnd: 4,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    items: [
      { text: "Read the brief", completed: true },
      { text: "Write the rows", completed: false },
      { text: "Run the tests", completed: false },
    ],
    ...overrides,
  } as TodoTranscriptEntry;
}

describe("TranscriptTodoRow", () => {
  it("reuses the dock's own guard", () => {
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
    expect(isTodoEntry(todoEntry())).toBe(true);
    expect(isTodoEntry(message)).toBe(false);
  });

  it("prints the count and the list through the shared TaskRows treatment", () => {
    render(<TranscriptTodoRow entry={todoEntry()} testId="todo-inline" />);
    const card = screen.getByTestId("todo-inline");
    expect(within(card).getByText("Task list — 1 of 3 done")).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Task list" })).toBeTruthy();
    expect(card.querySelectorAll("li")).toHaveLength(3);
  });

  it("marks every row's state in words, not colour alone", () => {
    render(<TranscriptTodoRow entry={todoEntry()} testId="todo-words" />);
    const card = screen.getByTestId("todo-words");
    expect(within(card).getAllByText("Done")).toHaveLength(1);
    expect(within(card).getAllByText("In progress")).toHaveLength(1);
    expect(within(card).getAllByText("Pending")).toHaveLength(1);
  });

  it("renders its headline rather than vanishing for an empty list", () => {
    render(<TranscriptTodoRow entry={todoEntry({ items: [] })} testId="todo-empty" />);
    expect(screen.getByTestId("todo-empty").textContent).toContain("0 of 0");
  });

  it("has no axe violations", async () => {
    const { container } = render(<TranscriptTodoRow entry={todoEntry()} testId="todo-axe" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
