import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement, PiUiPanelSection } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "../registry-view.js";
import { piUiRendererRegistry } from "../registry.js";
import "./index.js";

/**
 * T29B4 — render the `panel` kind, which composes other kinds. Acceptance
 * criteria exercised here:
 *
 * - "A panel renders nested kinds from fixtures"
 * - "Nesting depth is bounded with a visible diagnostic beyond the limit"
 * - "A failing child does not take down the panel"
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

/** plan.md §11.7's documented `loop` example: "panel containing status, markdown, roster, progress, and log; stop/details actions". */
const loopPanelElement: PiUiElement = {
  id: "run-4",
  ns: "loop",
  kind: "panel",
  placement: "sheet",
  title: "Loop run #4",
  actions: [
    { id: "stop", label: "Stop", variant: "danger", confirm: "Stop the running loop?" },
    { id: "details", label: "Details" },
  ],
  payload: {
    kind: "panel",
    text: "Deploy workflow, step 3 of 5.",
    sections: [
      {
        id: "head",
        kind: "status",
        title: "Status",
        payload: { kind: "status", text: "Running step 3 of 5", tone: "accent" },
      },
      {
        id: "notes",
        kind: "markdown",
        payload: { kind: "markdown", text: "**Deploying** to staging." },
      },
      {
        id: "fleet",
        kind: "roster",
        title: "Fleet",
        actions: [
          { id: "stop-fleet", label: "Stop fleet", variant: "danger", confirm: "Stop the fleet?" },
        ],
        payload: {
          kind: "roster",
          rows: [{ id: "sub_1", label: "reviewer", state: "running", detail: "reading diff" }],
        },
      },
      {
        id: "progress",
        kind: "progress",
        payload: { kind: "progress", label: "Deploy", value: 3, max: 5 },
      },
      {
        id: "tail",
        kind: "log",
        title: "Log",
        actions: [{ id: "clear", label: "Clear" }],
        payload: { kind: "log", lines: ["step 1", "step 2", "step 3"], tail: 200 },
      },
    ],
  },
} as PiUiElement;

describe("registration (T29B4)", () => {
  it("registers the panel renderer", () => {
    expect(piUiRendererRegistry.has("panel")).toBe(true);
  });
});

describe("panel renderer", () => {
  it("renders nested kinds from fixtures: status, markdown, roster, progress, and log", () => {
    view(loopPanelElement);

    expect(screen.getByText("Loop run #4")).toBeTruthy();
    expect(screen.getByText("Deploy workflow, step 3 of 5.")).toBeTruthy();

    // status
    expect(screen.getByText("Running step 3 of 5")).toBeTruthy();

    // markdown, rendered as real elements (never raw HTML/markup text)
    const notes = screen.getByTestId("pi-markdown-loop-notes");
    expect(notes.querySelector("strong")?.textContent).toBe("Deploying");

    // roster
    expect(screen.getByText("reviewer")).toBeTruthy();
    expect(screen.getByText("reading diff")).toBeTruthy();

    // progress
    const progress = screen.getByTestId("pi-progress-loop-progress");
    expect(progress.textContent).toContain("3");
    expect(progress.textContent).toContain("5");

    // log (lines are joined into one code-block text node, not one per line)
    expect(screen.getByTestId("pi-log-loop-tail-scroll").textContent).toContain("step 1");
    expect(screen.getByTestId("pi-log-loop-tail-scroll").textContent).toContain("step 3");

    // the panel's own top-level actions still render alongside its sections
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  });

  it("dispatches a section's own action against the section's composite element id", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(loopPanelElement, controller);
    const clearButton = screen.getByRole("button", { name: "Clear" });
    clearButton.focus();
    await user.keyboard("{Enter}");

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        actionId: "clear",
        elementId: "run-4#tail",
      }),
    ]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "loop",
        elementId: "run-4#tail",
        actionId: "clear",
      }).status,
    ).toBe("pending");
  });

  it("requires confirmation before a dangerous section action dispatches, naming the action and its consequence", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(loopPanelElement, controller);
    const stopFleet = screen.getByRole("button", { name: "Stop fleet" });
    // Non-dangerous section and element-level actions stay unaffected.
    expect(stopFleet.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Details" }).hasAttribute("disabled")).toBe(false);

    await user.click(stopFleet);
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Stop fleet");
    expect(dialog.textContent).toContain("Stop the fleet?");

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        actionId: "stop-fleet",
        elementId: "run-4#fleet",
      }),
    ]);
  });

  it("requires confirmation before the panel's own dangerous top-level action dispatches", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(loopPanelElement, controller);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Stop");
    expect(dialog.textContent).toContain("Stop the running loop?");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "stop" }),
    ]);
  });

  it("bounds nesting depth: a section that is itself a panel renders a visible diagnostic, not a recursive panel", () => {
    const nestedSections: PiUiPanelSection[] = [
      {
        id: "head",
        kind: "status",
        payload: { kind: "status", text: "Still running" },
      },
      // Not constructible through the normal wire path (`PiUiLeafKindSchema`
      // excludes `"panel"`); built by hand here to exercise the renderer's
      // own defense-in-depth guard against an unvalidated nested panel.
      {
        id: "inner",
        kind: "panel" as PiUiPanelSection["kind"],
        payload: { kind: "panel", sections: [] } as unknown as PiUiPanelSection["payload"],
      },
    ];
    const nestedElement: PiUiElement = {
      ...loopPanelElement,
      id: "run-5",
      actions: undefined,
      payload: { kind: "panel", sections: nestedSections },
    } as PiUiElement;

    view(nestedElement);

    // The sibling section still renders normally.
    expect(screen.getByText("Still running")).toBeTruthy();
    // The nested-panel section renders one diagnostic instead of recursing.
    const diagnostic = screen.getByTestId("pi-panel-loop-run-5-section-inner-nesting-limit");
    expect(diagnostic.textContent).toContain("nested panels are not supported");
    // No second panel title/testid was mounted for the nested section.
    expect(screen.queryByTestId("pi-panel-loop-inner")).toBeNull();
  });

  it("a failing child does not take down the panel", () => {
    const original = piUiRendererRegistry.get("status");
    expect(original).toBeDefined();
    piUiRendererRegistry.register("status", () => {
      throw new Error("boom");
    });

    try {
      view(loopPanelElement);
      // The panel itself, and every sibling section, still renders.
      expect(screen.getByTestId("pi-panel-loop-run-4")).toBeTruthy();
      expect(screen.getByText("reviewer")).toBeTruthy();
      expect(screen.getByTestId("pi-log-loop-tail-scroll").textContent).toContain("step 1");
      // The failing section shows the shared per-element error state instead.
      expect(screen.getByText('"status" element failed to render')).toBeTruthy();
    } finally {
      piUiRendererRegistry.register("status", original!);
    }
  });

  it("renders a diagnostic for a section kind with no registered renderer", () => {
    const unknownKindSections = [
      {
        id: "mystery",
        kind: "bogus-kind",
        payload: undefined,
      },
    ] as unknown as PiUiPanelSection[];
    view({
      ...loopPanelElement,
      id: "run-6",
      actions: undefined,
      payload: { kind: "panel", sections: unknownKindSections },
    } as PiUiElement);
    expect(screen.getByText(/has no registered web renderer/)).toBeTruthy();
  });

  it("renders an empty-state message when there are no sections", () => {
    view({
      id: "empty-panel",
      ns: "loop",
      kind: "panel",
      placement: "sheet",
      payload: { kind: "panel", sections: [] },
    } as PiUiElement);
    expect(screen.getByText("No sections to show.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = view(loopPanelElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
