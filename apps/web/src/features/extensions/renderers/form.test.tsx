import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "../registry-view.js";
import { piUiRendererRegistry } from "../registry.js";
import "./index.js";

/**
 * T29B2 — render the `form` kind with action states. Acceptance criteria
 * exercised here:
 *
 * - "Forms render every documented field type from fixtures"
 * - "Pending, success and failure states are each visible"
 * - "Forms are keyboard operable and labelled"
 */

afterEach(cleanup);

/** Deterministic, manually-advanced `Clock` (no real timers; plan.md §7.3). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.setTimeout(callback, intervalMs);
  }
  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }
  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[0] - b[0])) {
      if (timer.at <= this.time && this.timers.has(id)) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

function makeController(
  sendRequest: (message: unknown) => void = () => {},
): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: sendRequest as never,
  });
}

function view(element: PiUiElement, controller = makeController(), revision?: number) {
  return render(
    <PiUiElementView
      element={element}
      agentId="agt_1"
      actionController={controller}
      revision={revision}
    />,
  );
}

const pickApproachElement: PiUiElement = {
  id: "pick-approach",
  ns: "ask-user",
  kind: "form",
  placement: "sheet",
  title: "How should we proceed?",
  actions: [
    { id: "submit", label: "Submit", variant: "primary" },
    { id: "cancel", label: "Cancel", variant: "secondary" },
  ],
  payload: {
    kind: "form",
    description: "Pick an approach and leave an optional comment.",
    submitLabel: "Send answer",
    fields: [
      {
        kind: "select",
        id: "approach",
        label: "Approach",
        multiple: true,
        searchable: true,
        required: true,
        options: [
          { value: "rewrite", label: "Rewrite", description: "Larger, cleaner diff" },
          { value: "add-tests", label: "Add tests" },
          { value: "patch", label: "Small patch" },
        ],
      },
      {
        kind: "text",
        id: "comment",
        label: "Comment",
        placeholder: "Optional notes",
        multiline: true,
      },
      {
        kind: "toggle",
        id: "notify",
        label: "Notify the team",
        description: "Post a summary once this is done",
        value: true,
      },
    ],
  },
} as PiUiElement;

describe("registration (T29B2)", () => {
  it("registers the form renderer", () => {
    expect(piUiRendererRegistry.has("form")).toBe(true);
  });
});

describe("form renderer", () => {
  it("renders every documented field type: select (multi, searchable), text (multiline), and toggle", () => {
    view(pickApproachElement);

    expect(screen.getByText("How should we proceed?")).toBeTruthy();
    expect(screen.getByText("Pick an approach and leave an optional comment.")).toBeTruthy();

    // select (multiple + searchable)
    expect(screen.getByRole("searchbox", { name: "Search Approach options" })).toBeTruthy();
    const approachSelect = screen.getByRole("listbox", { name: "Approach" });
    expect(approachSelect).toBeTruthy();
    expect(screen.getByRole("option", { name: /Rewrite/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Larger, cleaner diff/ })).toBeTruthy();

    // text (multiline -> textarea)
    const comment = screen.getByRole("textbox", { name: "Comment" });
    expect(comment.tagName).toBe("TEXTAREA");

    // toggle
    const notify = screen.getByRole("switch", { name: "Notify the team" });
    expect(notify.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Post a summary once this is done")).toBeTruthy();

    // submit label override from payload.submitLabel
    expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("filters searchable select options by the search query", async () => {
    const user = userEvent.setup();
    view(pickApproachElement);

    expect(screen.getByRole("option", { name: /Small patch/ })).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search Approach options" }), "rewrite");
    expect(screen.queryByRole("option", { name: /Small patch/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Rewrite/ })).toBeTruthy();
  });

  it("is keyboard operable: text and toggle fields can be reached and changed without a mouse", async () => {
    const user = userEvent.setup();
    view(pickApproachElement);

    const comment = screen.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement;
    comment.focus();
    await user.keyboard("Prefer the smaller diff.");
    expect(comment.value).toBe("Prefer the smaller diff.");

    const notify = screen.getByRole("switch", { name: "Notify the team" });
    notify.focus();
    await user.keyboard(" ");
    expect(notify.getAttribute("aria-checked")).toBe("false");
  });

  it("dispatches the submit action with the collected field values as payload and shows pending state", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    const { rerender } = view(pickApproachElement, controller);

    const comment = screen.getByRole("textbox", { name: "Comment" });
    await user.type(comment, "Ship it");

    const submit = screen.getByRole("button", { name: "Send answer" });
    submit.focus();
    await user.keyboard("{Enter}");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "pi.ui.action.request",
      actionId: "submit",
      elementId: "pick-approach",
      payload: expect.objectContaining({
        comment: "Ship it",
        notify: true,
      }),
    });

    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "ask-user",
        elementId: "pick-approach",
        actionId: "submit",
      }).status,
    ).toBe("pending");
    // Pending is visible near the button once this element re-renders (the
    // registry does not itself own controller->DOM live wiring; a parent
    // that owns a re-render trigger does, mirrored here with `rerender`).
    rerender(
      <PiUiElementView
        element={pickApproachElement}
        agentId="agt_1"
        actionController={controller}
      />,
    );
    expect(screen.getByText("Submitting…")).toBeTruthy();
  });

  it("shows a success state once the action settles", async () => {
    const controller = makeController();
    const user = userEvent.setup();
    const { rerender } = view(pickApproachElement, controller);

    await user.click(screen.getByRole("button", { name: "Send answer" }));
    controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: true,
    });
    rerender(
      <PiUiElementView
        element={pickApproachElement}
        agentId="agt_1"
        actionController={controller}
      />,
    );

    expect(screen.getByText("Submitted")).toBeTruthy();
  });

  it("shows a failure state, with the error text, once the action is rejected", async () => {
    const controller = makeController();
    const user = userEvent.setup();
    const { rerender } = view(pickApproachElement, controller);

    await user.click(screen.getByRole("button", { name: "Send answer" }));
    controller.ingestActionResult("agt_1", {
      actionId: "submit",
      elementId: "pick-approach",
      ok: false,
      error: "Namespace rejected the answer",
    });
    rerender(
      <PiUiElementView
        element={pickApproachElement}
        agentId="agt_1"
        actionController={controller}
      />,
    );

    expect(screen.getByText("Namespace rejected the answer")).toBeTruthy();
  });

  it("renders an empty-state message when there are no fields", () => {
    view({
      id: "empty-form",
      ns: "ask-user",
      kind: "form",
      placement: "sheet",
      payload: { kind: "form", fields: [] },
    } as PiUiElement);
    expect(screen.getByText("No fields to show.")).toBeTruthy();
  });

  it("requires confirmation before a dangerous form action dispatches, carrying the collected field values through", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    const dangerousElement: PiUiElement = {
      id: "discard",
      ns: "ask-user",
      kind: "form",
      placement: "sheet",
      title: "Discard the draft?",
      actions: [
        {
          id: "discard",
          label: "Discard",
          variant: "danger",
          confirm: "This permanently deletes the unsaved draft.",
        },
      ],
      payload: {
        kind: "form",
        fields: [{ kind: "text", id: "reason", label: "Reason", placeholder: "Optional" }],
      },
    } as PiUiElement;

    view(dangerousElement, controller);
    const reason = screen.getByRole("textbox", { name: "Reason" });
    await user.type(reason, "no longer needed");

    const discardButton = screen.getByRole("button", { name: "Discard" });
    expect(discardButton.hasAttribute("disabled")).toBe(false);

    await user.click(discardButton);
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Discard");
    expect(dialog.textContent).toContain("This permanently deletes the unsaved draft.");

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        actionId: "discard",
        payload: expect.objectContaining({ reason: "no longer needed" }),
      }),
    ]);
  });

  it("has no axe violations", async () => {
    const { container } = view(pickApproachElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
