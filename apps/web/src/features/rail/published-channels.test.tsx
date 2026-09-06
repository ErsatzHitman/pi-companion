import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiDelta, PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionRail } from "./pi-extension-rail.js";
import { usePiUiRailElements } from "./use-pi-ui-rail-elements.js";

/**
 * T40A4 — verifies plan.md §11.7's three published channels
 * (`subagents:fleet`, `workflow:progress`, `pi-goal:status`) end to end and
 * proves the rail's degrade-visibly behavior, without ever contacting a real
 * daemon (no socket is opened anywhere in this file).
 *
 * The pre-existing `pi-extension-rail.test.tsx` (T29R2) starts from
 * hand-authored `PiUiElement` fixtures and says up front that the
 * daemon-side channel -> element translation is out of its scope. This file
 * closes that gap on the *client* half of the pipeline: the three element
 * literals below (`fleetElement`, `workflowWidgetElement`,
 * `goalProgressElement`) are not invented — they are copied, field for
 * field, from the real `PiUiDelta`s a real `PiUiStateStore.applyChannel`
 * call actually emitted for the exact payload shapes
 * `docs/pi-extension-compatibility.md` records as captured from the real
 * installed extensions (dumped and diffed against
 * `packages/server/src/server/agent/providers/pi/ui-bridge/state.test.ts`'s
 * "published channels -> what reaches the pinned rail (T40A4)" describe
 * block, which drives that same real `PiUiStateStore.applyChannel` in that
 * package's own test tree — `apps/web` cannot import daemon-only internals
 * across the package boundary, per this repo's package-exports invariant,
 * so the two halves are pinned to one shared, real value here instead of
 * cross-importing runtime code). Together the two files prove the whole
 * daemon-synthesis-to-rail-render pipeline for real, in-process data, with
 * no daemon ever contacted.
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

function makeController(): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: (() => {}) as never,
  });
}

const AGENT_ID = "agt_1";

/**
 * `subagents:fleet` — real `PiUiStateStore.applyChannel` output for
 * `docs/pi-extension-compatibility.md`'s recorded fixture payload
 * (`{entries:[{id:"job-1", ...}], active:true, selected:"main"}`). Matches
 * `state.test.ts`'s "subagents:fleet always synthesizes one pinned roster".
 */
const fleetElement: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  payload: {
    kind: "roster",
    rows: [
      {
        id: "job-1",
        label: "research: synthetic query on /tmp/synthetic.ts",
        state: "running",
        model: "opencode/deepseek-v4-flash",
        elapsedSec: 42,
      },
    ],
  },
};

/**
 * `workflow:progress`, WITH `active:true` — real synthesized *pinned*
 * output. T113 taught this pinned sibling to carry the same `step`/`total`
 * (aliased to `value`/`max`) the `placement:"status"` sibling already did,
 * so it is now a real determinate `progress` element, not a plain-text
 * `widget` — the earlier plain-text shape (T40A4's disclosed gap) never
 * reached a progress renderer at all. Matches `state.test.ts`'s
 * "workflow:progress synthesizes one pinned determinate progress element
 * (step/total, not plain text) once active is true".
 */
const workflowWidgetElement: PiUiElement = {
  id: "workflow-widget",
  ns: "workflow",
  kind: "progress",
  placement: "pinned",
  title: "workflow · implement",
  payload: { kind: "progress", label: "workflow · implement", value: 2, max: 5 },
};

/**
 * `pi-goal:status`, WITH `active:true` and the real extension's `startedAt`
 * (epoch ms) field — real synthesized pinned output, after this task's
 * `state.ts` fix. Matches `state.test.ts`'s "pi-goal:status synthesizes one
 * pinned progress element while active, carrying startedAt".
 */
const goalProgressElement: PiUiElement = {
  id: "goal-progress",
  ns: "goal",
  kind: "progress",
  placement: "pinned",
  title: "Synthetic objective — /tmp/synthetic.ts",
  payload: {
    kind: "progress",
    label: "Synthetic objective — /tmp/synthetic.ts",
    indeterminate: true,
    startedAt: 1_725_000_000_000,
  },
};

function upsert(element: PiUiElement): PiUiDelta {
  return { op: "upsert", element };
}

function LiveRail({ store }: { store: InstanceType<typeof extensions.PiUiElementStore> }) {
  const elements = usePiUiRailElements(store, AGENT_ID);
  return (
    <PiExtensionRail elements={elements} agentId={AGENT_ID} actionController={makeController()} />
  );
}

describe("published channels end to end (T40A4)", () => {
  it("renders all three published channels' real pinned content through the real client store", () => {
    const store = new extensions.PiUiElementStore();
    store.ingestDelta(AGENT_ID, 1, upsert(fleetElement));
    store.ingestDelta(AGENT_ID, 2, upsert(workflowWidgetElement));
    store.ingestDelta(AGENT_ID, 3, upsert(goalProgressElement));

    render(<LiveRail store={store} />);

    // subagents:fleet -> a real roster row, not a count.
    const fleetCard = screen.getByTestId("pi-rail-element-subagents-fleet");
    expect(
      within(fleetCard).getByText("research: synthetic query on /tmp/synthetic.ts"),
    ).toBeTruthy();
    expect(within(fleetCard).getByText("In progress")).toBeTruthy();

    // workflow:progress -> a real determinate progress bar (T113 closed the
    // gap T40A4 disclosed here).
    const workflowCard = screen.getByTestId("pi-rail-element-workflow-workflow-widget");
    expect(within(workflowCard).getAllByText("workflow · implement").length).toBeGreaterThan(0);
    const workflowBar = within(workflowCard).getByRole("progressbar");
    expect(workflowBar.getAttribute("aria-valuenow")).toBe("40");
    expect(within(workflowCard).getByText("2")).toBeTruthy();
    expect(within(workflowCard).getByText("5")).toBeTruthy();

    // pi-goal:status -> the pinned indeterminate progress element.
    const goalCard = screen.getByTestId("pi-rail-element-goal-goal-progress");
    expect(within(goalCard).getByText("Synthetic objective — /tmp/synthetic.ts")).toBeTruthy();

    // CORRECTED (P6-W4 merge gate): this asserts only that a `startedAt`
    // already present on the element survives into the card's raw-payload
    // disclosure (`RailElementCard` JSON.stringify's the whole element), so
    // it is a real DOM node rather than a store read — but it is pinned to
    // the literal above and CANNOT detect the daemon-side fix's absence
    // (verified: deleting both `startedAt` spreads from `ui-bridge/state.ts`
    // leaves this file 3/3 green while `state.test.ts` fails 2 tests). The
    // executable proof that the synthesis carries `startedAt` lives there,
    // not here. No renderer CONSUMES the value yet either — neither
    // `ProgressRenderer` nor `StatusRenderer` reads `payload.startedAt`, so
    // no elapsed time is displayed; filed as its own follow-up.
    const goalRaw = screen.getByTestId("pi-rail-element-goal-goal-progress-raw");
    expect(goalRaw.textContent).toContain('"startedAt": 1725000000000');
  });

  it("workflow:progress's real synthesis (no active flag) reaches the rail as literally nothing, alongside two channels that are live", () => {
    const store = new extensions.PiUiElementStore();
    store.ingestDelta(AGENT_ID, 1, upsert(fleetElement));
    // No workflow delta at all: this is exactly what a real `applyChannel`
    // call produces for `docs/pi-extension-compatibility.md`'s own recorded
    // `workflow:progress` fixture, which omits `active`
    // (`state.test.ts`'s "workflow:progress synthesizes no pinned content
    // at all when the channel omits active").
    store.ingestDelta(AGENT_ID, 2, upsert(goalProgressElement));

    render(<LiveRail store={store} />);

    expect(screen.queryByTestId("pi-extension-rail-empty")).toBeNull();
    expect(screen.queryByText(/workflow/i)).toBeNull();
    expect(screen.getByTestId("pi-rail-element-subagents-fleet")).toBeTruthy();
    expect(screen.getByTestId("pi-rail-element-goal-goal-progress")).toBeTruthy();
  });

  it("a dropped channel degrades visibly (a real empty-state element appears) rather than silently (a blank rail or a log line)", () => {
    const store = new extensions.PiUiElementStore();
    store.ingestDelta(AGENT_ID, 1, upsert(fleetElement));
    store.ingestDelta(AGENT_ID, 2, upsert(workflowWidgetElement));
    store.ingestDelta(AGENT_ID, 3, upsert(goalProgressElement));

    render(<LiveRail store={store} />);
    expect(screen.getByTestId("pi-extension-rail-list")).toBeTruthy();
    expect(screen.queryByTestId("pi-extension-rail-empty")).toBeNull();

    // Simulate the channel(s) getting dropped the way a real reconnect/
    // epoch-reset does (`PiUiElementStore.resetAgent`, the same method the
    // client's reconnect-replay path calls — plan.md §4.2/§12.5): every
    // live element for this agent disappears, not just the ones a single
    // channel produced, because there is no partial/per-channel resync at
    // this layer. This is the client store's real production behavior, not
    // a fixture invented for this test.
    act(() => {
      store.resetAgent(AGENT_ID);
    });

    // The bar itself re-renders from the live store (no remount, same
    // component instance) and shows a real, named, user-visible element —
    // not a blank pane, not a console line, not a boolean this test reads
    // off the store instead of the screen.
    expect(screen.queryByTestId("pi-extension-rail-list")).toBeNull();
    const empty = screen.getByTestId("pi-extension-rail-empty");
    expect(within(empty).getByText("No live extensions")).toBeTruthy();
    expect(screen.queryByTestId("pi-rail-element-subagents-fleet")).toBeNull();
    expect(screen.queryByTestId("pi-rail-element-goal-goal-progress")).toBeNull();
  });
});
