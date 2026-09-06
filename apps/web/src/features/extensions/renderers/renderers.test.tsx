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
 * T29A2 — render the `status`, `widget`, and `progress` kinds. Acceptance
 * criteria exercised here:
 *
 * - "All three render from canonical-payload fixtures"
 * - "Progress conveys value in text as well as visually"
 * - "An asserted axe check passes"
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

describe("registration (T29A2)", () => {
  it("registers status, widget, and progress renderers", () => {
    expect(piUiRendererRegistry.has("status")).toBe(true);
    expect(piUiRendererRegistry.has("widget")).toBe(true);
    expect(piUiRendererRegistry.has("progress")).toBe(true);
  });
});

describe("status renderer", () => {
  const statusElement: PiUiElement = {
    id: "mode",
    ns: "plan-mode",
    kind: "status",
    placement: "status",
    title: "Plan mode",
    payload: {
      kind: "status",
      text: "Reviewing changes",
      detail: "3 files pending",
      tone: "accent",
    },
  } as PiUiElement;

  it("renders the canonical payload's text as visible status text with a non-colour label", () => {
    view(statusElement);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Plan Mode/);
    expect(status.textContent).toMatch(/Reviewing changes/);
    expect(screen.getByText("3 files pending")).toBeTruthy();
  });

  it("falls back to the element title when payload text is absent", () => {
    view({
      ...statusElement,
      payload: { kind: "status", tone: "warning" },
    } as PiUiElement);
    expect(screen.getByRole("status").textContent).toMatch(/Plan mode/);
  });

  it("has no axe violations", async () => {
    const { container } = view(statusElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("widget renderer", () => {
  it("renders rows with label, value, tone chip, and detail", () => {
    const element: PiUiElement = {
      id: "tasks",
      ns: "todo",
      kind: "widget",
      placement: "pinned",
      title: "3 of 7 tasks complete",
      payload: {
        kind: "widget",
        rows: [
          { id: "r1", label: "Build", value: "passing", tone: "success", detail: "12s" },
          { id: "r2", label: "Deploy", value: "blocked", tone: "warning" },
        ],
      },
    } as PiUiElement;

    view(element);
    expect(screen.getByText("3 of 7 tasks complete")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getByText("passing")).toBeTruthy();
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.getByText("12s")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
  });

  it("renders free text when no rows or lines are present", () => {
    view({
      id: "summary",
      ns: "notes",
      kind: "widget",
      placement: "pinned",
      payload: { kind: "widget", text: "Everything looks fine." },
    } as PiUiElement);
    expect(screen.getByText("Everything looks fine.")).toBeTruthy();
  });

  it("renders pre-split lines as a list", () => {
    view({
      id: "summary2",
      ns: "notes",
      kind: "widget",
      placement: "pinned",
      payload: { kind: "widget", lines: ["First line", "Second line"] },
    } as PiUiElement);
    expect(screen.getByText("First line")).toBeTruthy();
    expect(screen.getByText("Second line")).toBeTruthy();
  });

  it("dispatches the widget's action and reflects pending/settled state", async () => {
    const sent: unknown[] = [];
    const controller = makeController((message) => sent.push(message));
    const user = userEvent.setup();
    const element: PiUiElement = {
      id: "tasks",
      ns: "todo",
      kind: "widget",
      placement: "pinned",
      title: "3 of 7 tasks complete",
      actions: [{ id: "expand", label: "Expand" }],
      payload: { kind: "widget", text: "3 of 7 complete" },
    } as PiUiElement;

    view(element, controller);
    const button = screen.getByRole("button", { name: "Expand" });
    button.focus();
    await user.keyboard("{Enter}");

    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "expand" }),
    ]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "todo",
        elementId: "tasks",
        actionId: "expand",
      }).status,
    ).toBe("pending");
  });

  it("requires confirmation before a dangerous action dispatches, and names the action and its consequence", async () => {
    const sent: unknown[] = [];
    const controller = makeController((message) => sent.push(message));
    const user = userEvent.setup();
    const element: PiUiElement = {
      id: "tasks",
      ns: "todo",
      kind: "widget",
      placement: "pinned",
      actions: [{ id: "clear", label: "Clear all", variant: "danger", confirm: "Really clear?" }],
      payload: { kind: "widget", text: "3 of 7 complete" },
    } as PiUiElement;

    view(element, controller);
    const button = screen.getByRole("button", { name: "Clear all" });
    // Non-dangerous actions are unaffected: this one stays enabled.
    expect(button.hasAttribute("disabled")).toBe(false);

    await user.click(button);
    // Clicking it never fired the action directly.
    expect(sent).toEqual([]);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Clear all");
    expect(dialog.textContent).toContain("Really clear?");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toEqual([]);

    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "clear" }),
    ]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = view({
      id: "tasks",
      ns: "todo",
      kind: "widget",
      placement: "pinned",
      title: "3 of 7 tasks complete",
      actions: [{ id: "expand", label: "Expand" }],
      payload: { kind: "widget", text: "3 of 7 complete" },
    } as PiUiElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("progress renderer", () => {
  it("conveys a determinate value both visually and in text", () => {
    const element: PiUiElement = {
      id: "deploy-workflow",
      ns: "workflows",
      kind: "progress",
      placement: "status",
      title: "Deploy workflow",
      payload: { kind: "progress", value: 2, max: 5, detail: "Running migrations" },
    } as PiUiElement;

    const { container } = view(element);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    // Visual fill width reflects the same fraction.
    const fill = container.querySelector(".pc-progress__fill") as HTMLElement;
    expect(fill.style.width).toBe("40%");
    // Text conveys it too: both the primitive's own percentage and the
    // explicit "x of y" step count this renderer adds.
    expect(screen.getByText("40%")).toBeTruthy();
    expect(within(container).getByText("of", { exact: false })).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Running migrations")).toBeTruthy();
  });

  it("renders an indeterminate progress element without a numeric value", () => {
    const element: PiUiElement = {
      id: "deploy-workflow",
      ns: "workflows",
      kind: "progress",
      placement: "status",
      title: "Deploy workflow",
      payload: { kind: "progress", indeterminate: true },
    } as PiUiElement;

    view(element);
    const bar = screen.getByRole("progressbar");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = view({
      id: "deploy-workflow",
      ns: "workflows",
      kind: "progress",
      placement: "status",
      title: "Deploy workflow",
      payload: { kind: "progress", value: 3, max: 5 },
    } as PiUiElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
