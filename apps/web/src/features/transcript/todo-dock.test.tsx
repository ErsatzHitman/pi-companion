import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { Transcript } from "./transcript.js";
import { isTodoEntry, selectLatestTodoEntry, TodoDock } from "./todo-dock.js";
import type { TodoTranscriptEntry } from "./todo-dock.js";

afterEach(cleanup);

function todoEntry(overrides: Record<string, unknown> = {}): TodoTranscriptEntry {
  return {
    kind: "todo",
    id: "todo-1",
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    items: [
      { text: "Read the four Android frames", completed: true },
      { text: "Map S7 / A1 / A2 onto three panes", completed: true },
      { text: "Settle where Settings lives", completed: true },
      { text: "Write the grid shell", completed: true },
      { text: "Pin the pane widths in a contract test", completed: false },
      { text: "File the follow-up", completed: false },
    ],
    ...overrides,
  } as TodoTranscriptEntry;
}

function messageEntry(id: string, text: string): timeline.TranscriptEntry {
  return {
    kind: "user-message",
    id,
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    text,
  };
}

describe("isTodoEntry / selectLatestTodoEntry", () => {
  it("accepts only the todo kind", () => {
    expect(isTodoEntry(todoEntry())).toBe(true);
    expect(isTodoEntry(messageEntry("u1", "hi"))).toBe(false);
  });

  it("returns the LAST todo entry, not the first", () => {
    const first = todoEntry({ id: "todo-old", items: [{ text: "old", completed: false }] });
    const second = todoEntry({ id: "todo-new", items: [{ text: "new", completed: false }] });
    expect(selectLatestTodoEntry([first, messageEntry("u1", "hi"), second])?.id).toBe("todo-new");
  });

  it("returns null when a session has never emitted a todo", () => {
    expect(selectLatestTodoEntry([messageEntry("u1", "hi")])).toBeNull();
    expect(selectLatestTodoEntry([])).toBeNull();
  });
});

describe("TodoDock", () => {
  it("draws the Android ring geometry: 18px box, r=8, stroke 2, circumference-derived dash offset", () => {
    render(<TodoDock entry={todoEntry()} testId="dock" />);
    const ring = screen.getByTestId("dock").querySelector("svg.pc-todo-dock__ring");
    expect(ring?.getAttribute("width")).toBe("18");
    expect(ring?.getAttribute("height")).toBe("18");
    const arc = ring?.querySelector(".pc-todo-dock__ring-arc");
    expect(arc?.getAttribute("r")).toBe("8");
    expect(arc?.getAttribute("stroke-width")).toBe("2");
    const circumference = 2 * Math.PI * 8;
    expect(arc?.getAttribute("stroke-dasharray")).toBe(circumference.toFixed(2));
    // 4 of 6 done leaves two-sixths of the ring unpainted.
    expect(arc?.getAttribute("stroke-dashoffset")).toBe((circumference * (1 - 4 / 6)).toFixed(2));
    const track = ring?.querySelector(".pc-todo-dock__ring-track");
    expect(track?.getAttribute("r")).toBe("8");
  });

  it("prints the count, the current item and the list itself", () => {
    render(<TodoDock entry={todoEntry()} testId="dock" />);
    const dock = screen.getByTestId("dock");
    expect(within(dock).getByText("Task list")).toBeTruthy();
    expect(within(dock).getByText("4 of 6")).toBeTruthy();
    // The current item is named twice on purpose, exactly as the mockup
    // draws it: once in the head's `.now-line` and once in the list row.
    expect(within(dock).getAllByText("Pin the pane widths in a contract test")).toHaveLength(2);
    expect(dock.querySelectorAll(".pc-todo-dock__now")).toHaveLength(1);
    expect(within(dock).getByRole("list", { name: "Task list items" })).toBeTruthy();
    expect(dock.querySelectorAll("li")).toHaveLength(6);
  });

  it("marks every row's state in words, not colour alone", () => {
    render(<TodoDock entry={todoEntry()} testId="dock" />);
    const dock = screen.getByTestId("dock");
    expect(within(dock).getAllByText("Done")).toHaveLength(4);
    expect(within(dock).getAllByText("In progress")).toHaveLength(1);
    expect(within(dock).getAllByText("Pending")).toHaveLength(1);
  });

  it("is a keyboard-operable disclosure with an exposed expanded state", async () => {
    const user = userEvent.setup();
    render(<TodoDock entry={todoEntry()} testId="dock" />);
    const toggle = screen.getByTestId("dock-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("list", { name: "Task list items" })).toBeTruthy();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed hides the rows while keeping the tracked region in the DOM.
    expect(screen.getByRole("list", { name: "Task list items", hidden: true })).toBeTruthy();
    expect(toggle.getAttribute("aria-label")).toBe("Expand task list");

    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse task list");
  });

  it("says 'All done' and paints a full ring when nothing is left", () => {
    render(
      <TodoDock
        entry={todoEntry({
          items: [{ text: "One", completed: true }],
        })}
        testId="dock-done"
      />,
    );
    expect(within(screen.getByTestId("dock-done")).getByText("All done")).toBeTruthy();
    expect(within(screen.getByTestId("dock-done")).getByText("1 of 1")).toBeTruthy();
    const arc = screen
      .getByTestId("dock-done")
      .querySelector(".pc-todo-dock__ring-arc")
      ?.getAttribute("stroke-dashoffset");
    expect(arc).toBe("0.00");
  });

  it("draws an empty ring for an empty list rather than claiming everything is done", () => {
    render(<TodoDock entry={todoEntry({ items: [] })} testId="dock-empty" />);
    const dock = screen.getByTestId("dock-empty");
    expect(within(dock).getByText("0 of 0")).toBeTruthy();
    expect(within(dock).getByText("All done")).toBeTruthy();
    const circumference = 2 * Math.PI * 8;
    expect(dock.querySelector(".pc-todo-dock__ring-arc")?.getAttribute("stroke-dashoffset")).toBe(
      circumference.toFixed(2),
    );
  });

  it("is the only place a todo renders — the scrolling transcript still skips it", () => {
    const entry = todoEntry();
    render(
      <>
        <Transcript entries={[entry]} testId="transcript" />
        <TodoDock entry={entry} testId="dock" />
      </>,
    );
    // The transcript's own empty state shows because `todo` is excluded
    // from its renderable kinds; only the dock carries the words.
    expect(screen.getByText("No messages yet")).toBeTruthy();
    expect(within(screen.getByTestId("dock")).getByText("4 of 6")).toBeTruthy();
    // Still only the dock's own two sites (head + list row); nothing in the
    // transcript column duplicates them.
    expect(screen.getAllByText("Pin the pane widths in a contract test")).toHaveLength(2);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TodoDock entry={todoEntry()} testId="dock-axe" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
