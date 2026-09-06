import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "../registry-view.js";
import { piUiRendererRegistry } from "../registry.js";
import "./index.js";

/**
 * T29B1 — render the `roster` kind. Acceptance criteria exercised here:
 *
 * - "Roster rows render every documented field from fixtures"
 * - "Row status is conveyed in text as well as colour"
 * - "Row actions dispatch and show pending state"
 * - "The roster reconstructs after a reload from stored snapshots, with
 *   live data winning over history" (ompweb review)
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

const fleetElement: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  title: "Subagent fleet (2 running)",
  payload: {
    kind: "roster",
    rows: [
      {
        id: "r1",
        label: "Refactor auth module",
        state: "running",
        detail: "Editing 3 files",
        progress: { value: 2, max: 5 },
        actions: [
          { id: "cancel", label: "Cancel", variant: "danger", confirm: "Cancel this subagent?" },
        ],
      },
      {
        id: "r2",
        label: "Write migration",
        state: "blocked",
        detail: "Waiting for approval",
      },
      {
        id: "r3",
        label: "Update docs",
        state: "done",
        actions: [{ id: "open", label: "Open" }],
      },
    ],
  },
} as PiUiElement;

describe("registration (T29B1)", () => {
  it("registers the roster renderer", () => {
    expect(piUiRendererRegistry.has("roster")).toBe(true);
  });
});

describe("roster renderer", () => {
  it("renders every row's label, state, detail, and progress", () => {
    view(fleetElement);

    expect(screen.getByText("Subagent fleet (2 running)")).toBeTruthy();

    expect(screen.getByText("Refactor auth module")).toBeTruthy();
    expect(screen.getByText("Editing 3 files")).toBeTruthy();
    // Progress: visual bar plus visible text (plan.md §10.5), plus the row's
    // own status text alongside it (not colour alone).
    expect(screen.getByRole("progressbar", { name: /Refactor auth module progress/ })).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();

    expect(screen.getByText("Write migration")).toBeTruthy();
    expect(screen.getByText("Waiting for approval")).toBeTruthy();

    expect(screen.getByText("Update docs")).toBeTruthy();
  });

  it("conveys each row's status as visible text, not colour alone", () => {
    view(fleetElement);
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("dispatches a row action against the row's composite element id and shows pending state", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(fleetElement, controller);
    const openButton = screen.getByRole("button", { name: "Open" });
    openButton.focus();
    await user.keyboard("{Enter}");

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        actionId: "open",
        elementId: "fleet#r3",
      }),
    ]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "subagents",
        elementId: "fleet#r3",
        actionId: "open",
      }).status,
    ).toBe("pending");

    // A different row's identically-named action is a distinct target and
    // stays idle — row identity, not just actionId, distinguishes pending
    // state (plan.md §12.3 action identity).
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "subagents",
        elementId: "fleet#r1",
        actionId: "open",
      }).status,
    ).toBe("idle");
  });

  it("requires confirmation before a dangerous row action dispatches, naming the action and its consequence", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(fleetElement, controller);
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    // Non-dangerous row actions are unaffected: this one stays enabled.
    expect(cancelButton.hasAttribute("disabled")).toBe(false);

    await user.click(cancelButton);
    expect(sent).toEqual([]);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Cancel");
    expect(dialog.textContent).toContain("Cancel this subagent?");

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        actionId: "cancel",
        elementId: "fleet#r1",
      }),
    ]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "subagents",
        elementId: "fleet#r1",
        actionId: "cancel",
      }).status,
    ).toBe("pending");
  });

  it("does not dispatch a dangerous row action when the confirmation is declined", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    view(fleetElement, controller);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toEqual([]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "subagents",
        elementId: "fleet#r1",
        actionId: "cancel",
      }).status,
    ).toBe("idle");
  });

  it("renders an empty-state message when there are no rows", () => {
    view({
      id: "fleet",
      ns: "subagents",
      kind: "roster",
      placement: "pinned",
      payload: { kind: "roster", rows: [] },
    } as PiUiElement);
    expect(screen.getByText("No rows to show.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = view(fleetElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("roster reconstruction after reload (ompweb review)", () => {
  it("live data wins over a replayed historical snapshot", () => {
    const store = new extensions.PiUiElementStore();

    // Step 1: app restart / reload replays a durable `pi_ui_snapshot`
    // timeline item recorded before the reload (plan.md §11.5 "Durable
    // snapshots become timeline items").
    const historicalItem: AgentTimelineItem = {
      type: "pi_ui_snapshot",
      state: {
        agentId: "agt_1",
        revision: 3,
        elements: [
          {
            ...fleetElement,
            title: "Subagent fleet (stale)",
            payload: {
              kind: "roster",
              rows: [{ id: "r1", label: "Refactor auth module", state: "idle" }],
            },
          },
        ],
        updatedAt: "2026-08-31T10:00:00.000Z",
      },
    };
    const historicalState = extensions.piUiSnapshotState(historicalItem);
    expect(historicalState).not.toBeNull();
    store.ingestFullState(historicalState!);

    expect(store.getElement("agt_1", "subagents", "fleet")?.title).toBe("Subagent fleet (stale)");

    // Step 2: the daemon's live Pi UI Bridge stream catches this client up
    // with a newer revision — a fresh `pi_ui_delta` upsert, exactly like a
    // reconnect replay (`ingestPiUiReplayBatch`). Live data must win.
    const outcome = store.ingestDelta("agt_1", 4, {
      op: "upsert",
      element: {
        ...fleetElement,
        title: "Subagent fleet (2 running)",
      },
    });
    expect(outcome.action).toBe("applied");

    const reconciled = store.getElement("agt_1", "subagents", "fleet")!;
    expect(reconciled.title).toBe("Subagent fleet (2 running)");
    expect(store.getRevision("agt_1")).toBe(4);

    // The renderer, given the reconciled live element, must show the live
    // row set rather than anything from the discarded historical snapshot.
    view(reconciled);
    expect(screen.getByText("Subagent fleet (2 running)")).toBeTruthy();
    expect(screen.queryByText("Subagent fleet (stale)")).toBeNull();
    expect(
      within(screen.getByTestId("pi-roster-subagents-fleet")).getByText("In progress"),
    ).toBeTruthy();
  });

  it("never applies a stale full state over already-live data (epoch/revision fencing)", () => {
    const store = new extensions.PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 5,
      elements: [{ ...fleetElement, title: "Live title" }],
      updatedAt: "2026-08-31T10:05:00.000Z",
    });

    // A late-arriving replay of an older snapshot (revision behind current)
    // must be discarded, not resurrect stale roster content.
    const staleReplay = extensions.piUiSnapshotState({
      type: "pi_ui_snapshot",
      state: {
        agentId: "agt_1",
        revision: 2,
        elements: [{ ...fleetElement, title: "Stale replay title" }],
        updatedAt: "2026-08-31T09:00:00.000Z",
      },
    })!;
    const outcome = store.ingestFullState(staleReplay);
    expect(outcome.action).toBe("discarded");
    expect(store.getElement("agt_1", "subagents", "fleet")?.title).toBe("Live title");
  });
});
