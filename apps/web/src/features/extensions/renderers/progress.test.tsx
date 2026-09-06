import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiExtensionRail } from "../../rail/pi-extension-rail.js";

/**
 * T113 — proves, in the DOM, that the pinned element `workflow:progress`
 * now synthesizes (`packages/server/.../ui-bridge/state.ts`'s
 * `applyChannel` `"workflow:progress"` case, gated on `payload.active ===
 * true`) actually reaches a determinate progress bar on the web right rail.
 *
 * `element` below is not invented: it is copied field for field from the
 * real `PiUiStateStore.applyChannel` output asserted in
 * `packages/server/src/server/agent/providers/pi/ui-bridge/state.test.ts`'s
 * "workflow:progress synthesizes one pinned determinate progress element
 * (step/total, not plain text) once active is true" — `apps/web` cannot
 * import daemon-only internals across the package boundary (this repo's
 * package-exports invariant), so the two halves are pinned to one shared,
 * real value here instead of two independently-invented fixtures, the same
 * pattern `apps/web/src/features/rail/published-channels.test.tsx`
 * established for the other two published channels.
 *
 * This drives the real rail pipeline — `PiExtensionRail` ->
 * `selectRailElements` (only `placement: "pinned"` survives) ->
 * `RailElementCard` -> `PiUiElementView` -> the registered `progress`
 * renderer (`progress.tsx`) — rather than calling `ProgressRenderer`
 * directly, so a regression in the rail's own placement filter would also
 * fail this file, not just a renderer unit test.
 */

afterEach(cleanup);

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
  advance(): void {}
}

function makeController(): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: (() => {}) as never,
  });
}

function renderRail(elements: PiUiElement[]) {
  return render(
    <PiExtensionRail elements={elements} agentId="agt_1" actionController={makeController()} />,
  );
}

describe("workflow:progress's pinned element on the rail (T113)", () => {
  it("renders a real determinate progress bar from step/total, not a plain-text title card", () => {
    // Matches `state.test.ts`'s real `applyChannel` output for
    // `{ status: "running", phase: "implement", step: 2, total: 5, active: true }`.
    const element: PiUiElement = {
      id: "workflow-widget",
      ns: "workflow",
      kind: "progress",
      placement: "pinned",
      title: "workflow · implement",
      payload: {
        kind: "progress",
        label: "workflow · implement",
        value: 2,
        max: 5,
      },
    } as PiUiElement;

    renderRail([element]);

    const card = screen.getByTestId("pi-rail-element-workflow-workflow-widget");
    const bar = within(card).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(within(card).getByText("40%")).toBeTruthy();
    expect(within(card).getByText("2")).toBeTruthy();
    expect(within(card).getByText("5")).toBeTruthy();
  });

  it("renders something truthful (no fabricated percentage) when total is absent", () => {
    // Matches `state.test.ts`'s real `applyChannel` output for
    // `{ status: "running", phase: "implement", step: 2, active: true }`
    // (no `total`).
    const element: PiUiElement = {
      id: "workflow-widget",
      ns: "workflow",
      kind: "progress",
      placement: "pinned",
      title: "workflow · implement",
      payload: {
        kind: "progress",
        label: "workflow · implement",
        value: 2,
      },
    } as PiUiElement;

    renderRail([element]);

    const card = screen.getByTestId("pi-rail-element-workflow-workflow-widget");
    const bar = within(card).getByRole("progressbar");
    // Before T113's `progress.tsx` fix, a `value` with no `max` fell through
    // `clampFraction`'s `max === undefined` branch and clamped the raw step
    // count (2) into `[0, 1]`, i.e. 100% — a fabricated, misleading number.
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(within(card).getByText("In progress")).toBeTruthy();
    expect(within(card).queryByText("100%")).toBeNull();
  });
});
