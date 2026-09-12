import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionStatusStrip } from "./pi-extension-status-strip.js";
import { usePiUiRailElements } from "./use-pi-ui-rail-elements.js";

/**
 * `PiExtensionStatusStrip` — the web session status strip (plan.md §11.3,
 * §11.5). Before this component, `select-rail-elements.ts`'s only
 * placement filter was `pinned`, so no code path in `apps/web` rendered a
 * `status`-placement element at all. These tests mirror
 * `pi-extension-rail.test.tsx`'s: placement filtering, per-element
 * fidelity through `PiUiElementView` (the unknown-kind fallback and the
 * 64 KiB payload cap, unchanged), live store updates, action dispatch, and
 * axe.
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
}

function makeController(
  sendRequest: (message: unknown) => void = () => {},
): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: sendRequest as never,
  });
}

/** plan.md §11.7: plan-mode's `!mode` status. */
const planModeStatus: PiUiElement = {
  id: "mode",
  ns: "plan-mode",
  kind: "status",
  placement: "status",
  title: "Plan mode: reviewing changes",
  payload: { kind: "status", text: "Reviewing changes", tone: "accent" },
};

/** plan.md §11.7: prompt-arbitrage's footer status. */
const promptArbitrageStatus: PiUiElement = {
  id: "footer",
  ns: "prompt-arbitrage",
  kind: "status",
  placement: "status",
  title: "Prompt arbitrage",
  payload: { kind: "status", text: "3 candidates ranked", detail: "showing best first" },
};

/**
 * A `pinned`-placement sibling from the same agent (the rail's own
 * territory, plan.md §11.5) — proves the strip excludes it even when it
 * sits alongside status elements in the same live store.
 */
const pinnedGoalStatus: PiUiElement = {
  id: "goal-1",
  ns: "pi-goal",
  kind: "status",
  placement: "pinned",
  title: "Goal",
  payload: { kind: "status", text: "Active — round 2" },
};

function renderStrip(elements: PiUiElement[], controller = makeController()) {
  return render(
    <PiExtensionStatusStrip elements={elements} agentId="agt_1" actionController={controller} />,
  );
}

describe("PiExtensionStatusStrip", () => {
  it("renders a status-placement element through PiUiElementView's registry pipeline", () => {
    renderStrip([planModeStatus]);

    const wrapper = screen.getByTestId("pi-status-strip-plan-mode-mode");
    // The registered `status` renderer ran (its own test id), not a
    // fallback diagnostic.
    expect(within(wrapper).getByTestId("pi-status-plan-mode-mode")).toBeTruthy();
    expect(within(wrapper).getByText("Reviewing changes")).toBeTruthy();
    expect(within(wrapper).getByText("Plan Mode:")).toBeTruthy();
  });

  it("renders every status-placement element, each at full per-kind fidelity, in store order", () => {
    renderStrip([planModeStatus, promptArbitrageStatus]);

    const list = screen.getByTestId("pi-extension-status-strip-list");
    expect(list.children).toHaveLength(2);
    expect(
      within(screen.getByTestId("pi-status-strip-prompt-arbitrage-footer")).getByText(
        "3 candidates ranked",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("pi-status-strip-prompt-arbitrage-footer")).getByText(
        "showing best first",
      ),
    ).toBeTruthy();
  });

  it("excludes non-status placements per §11.5, keeping only status", () => {
    renderStrip([planModeStatus, pinnedGoalStatus]);

    expect(screen.getByTestId("pi-status-strip-plan-mode-mode")).toBeTruthy();
    expect(screen.queryByText("Active — round 2")).toBeNull();
    expect(screen.queryByTestId("pi-status-strip-pi-goal-goal-1")).toBeNull();
  });

  it("renders nothing at all when only non-status elements are present", () => {
    renderStrip([pinnedGoalStatus]);

    expect(screen.queryByTestId("pi-extension-status-strip")).toBeNull();
    expect(screen.queryByTestId("pi-extension-status-strip-list")).toBeNull();
  });

  it("renders nothing at all for an empty element set", () => {
    const { container } = renderStrip([]);
    expect(container.firstChild).toBeNull();
  });

  it("shows one visible diagnostic, not transcript text, for an unrecognized status-placement kind", () => {
    const unknown: PiUiElement = {
      id: "x",
      ns: "some-extension",
      kind: "not-a-real-kind" as never,
      placement: "status",
      title: "Mystery element",
    };
    renderStrip([unknown]);

    expect(screen.getByText(/Unrecognized element kind/)).toBeTruthy();
    expect(screen.getByText(/source: some-extension:x/)).toBeTruthy();
  });

  it("caps an oversized status payload through PiUiElementView's 64 KiB guard, unchanged", () => {
    const hugeText = "x".repeat(70_000);
    const oversized: PiUiElement = {
      id: "huge",
      ns: "minimal-status",
      kind: "status",
      placement: "status",
      title: "Huge status",
      payload: { kind: "status", text: hugeText },
    };
    renderStrip([oversized]);

    expect(screen.getByText(/Element payload too large to render/)).toBeTruthy();
    expect(screen.getByText(/exceeds the 65,536-byte limit/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(hugeText);
  });

  it("dispatches a status element's action through the real registry wiring, not a static summary", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const withAction: PiUiElement = {
      ...planModeStatus,
      actions: [{ id: "exit", label: "Exit plan mode" }],
    };
    const user = userEvent.setup();
    renderStrip([withAction], controller);

    await user.click(screen.getByRole("button", { name: "Exit plan mode" }));

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        agentId: "agt_1",
        elementId: "mode",
        actionId: "exit",
      }),
    ]);
  });

  it("stays live across a store-driven update, without remounting the strip", () => {
    const { PiUiElementStore } = extensions;
    const store = new PiUiElementStore();
    // Sequential revisions, so each delta arrives as its own published
    // update (see `pi-extension-rail.test.tsx`'s same note on
    // `PiUiElementStore`'s stale/gap rules).
    store.ingestDelta("agt_1", 1, { op: "upsert", element: planModeStatus });

    function LiveStrip() {
      const elements = usePiUiRailElements(store, "agt_1");
      return (
        <PiExtensionStatusStrip
          elements={elements}
          agentId="agt_1"
          actionController={makeController()}
        />
      );
    }

    render(<LiveStrip />);
    expect(screen.getByText("Reviewing changes")).toBeTruthy();

    act(() => {
      store.ingestDelta("agt_1", 2, {
        op: "upsert",
        element: {
          ...planModeStatus,
          payload: { kind: "status", text: "Changes approved", tone: "success" },
        },
      });
    });

    expect(screen.getByText("Changes approved")).toBeTruthy();
    expect(screen.queryByText("Reviewing changes")).toBeNull();
    // Still the same mounted strip/list — the element updated in place.
    expect(screen.getByTestId("pi-extension-status-strip-list").children).toHaveLength(1);
  });

  it("has no axe violations empty or populated with status and pinned elements together", async () => {
    const { container: empty } = renderStrip([]);
    expect(await axe(empty)).toHaveNoViolations();
    cleanup();

    const { container: populated } = renderStrip([planModeStatus, pinnedGoalStatus]);
    expect(await axe(populated)).toHaveNoViolations();
  });
});
