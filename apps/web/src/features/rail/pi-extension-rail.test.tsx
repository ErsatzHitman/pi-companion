import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionRail } from "./pi-extension-rail.js";
import { usePiUiRailElements } from "./use-pi-ui-rail-elements.js";

/**
 * `PiExtensionRail`/`RailElementCard` (T29R1, T29R2; plan.md §8.3, §11.5).
 *
 * T29R2's acceptance criteria exercised here:
 *
 * - "Fleet, workflow, loop and goal state stay visible while active"
 * - "None of them collapse into a single status chip"
 * - "State updates live from published channels"
 *
 * Fixtures below mirror plan.md §11.7's documented shapes for the four
 * named extensions: `subagents` (fleet → `roster`), `workflows` (workflow →
 * `progress`), `loop` (→ `panel` composing `status`/`markdown`/`roster`/
 * `progress`/`log`), and `pi-goal` (goal → `status`). The daemon-side
 * translation from a published channel (`subagents:fleet`,
 * `workflow:progress`, `pi-goal:status`) into `PiUiElement`s is out of this
 * task's scope (owned by the Pi provider/bridge decoder).
 *
 * CORRECTED (P6-W4 merge gate, after T40A4): these are ILLUSTRATIVE shapes
 * of the four `kind`s the rail must render — they are NOT what those three
 * channels' real synthesis emits, and this header previously claimed they
 * were. T40A4 drove the real `PiUiStateStore.applyChannel` for all three
 * published channels and recorded what it actually produces in
 * `packages/server/.../pi/ui-bridge/state.test.ts`'s "published channels ->
 * what reaches the pinned rail (T40A4)" describe block, mirrored on the
 * client side by `published-channels.test.tsx` in this directory. Read those
 * two files, not this one, for what a channel really produces — the
 * `ns`/`id` and exact title/label text below are still synthetic, chosen for
 * this file's own illustrative purposes, not copied from a real payload.
 *
 * UPDATED (T113): the `workflow` fixture below is no longer a divergence in
 * *kind* — `workflow:progress`'s pinned sibling (gated on `active: true`)
 * is now a real `progress` element carrying `step`/`total` as `value`/`max`,
 * same as `workflowProgress` here, closing the gap this comment used to
 * describe (a pinned plain-text `widget` that could never show a bar at
 * all). `published-channels.test.tsx` is the one proven against the real
 * `applyChannel`-shaped literal; this file's `workflowProgress` remains its
 * own independent illustrative fixture (different `ns`/`id`/title).
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

const todoWidget: PiUiElement = {
  id: "tasks",
  ns: "todo",
  kind: "widget",
  placement: "pinned",
  title: "3 of 7 tasks complete",
  durable: true,
  payload: { kind: "widget", text: "Next: write the tests" },
};

/** plan.md §11.7: `subagents` — "prominent roster with running, blocked, done, usage, and cancel/open actions". */
const fleetRoster: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  title: "Subagent fleet",
  durable: true,
  payload: {
    kind: "roster",
    rows: [
      { id: "job-1", label: "Researcher", state: "running", detail: "reading /tmp/synthetic.ts" },
      { id: "job-2", label: "Writer", state: "done" },
    ],
  },
};

/**
 * plan.md §11.7: `workflows` — "approval form, progress, roster, and logs".
 * An illustrative pinned `progress` element, NOT what the `workflow:progress`
 * channel synthesizes — see this file's header for what it really emits
 * (T40A4). Kept as the rail's coverage of a determinate progress bar.
 */
const workflowProgress: PiUiElement = {
  id: "deploy-workflow",
  ns: "workflows",
  kind: "progress",
  placement: "pinned",
  title: "Deploy workflow",
  payload: {
    kind: "progress",
    label: "Deploy workflow",
    detail: "implement phase",
    value: 2,
    max: 5,
  },
};

/** plan.md §11.7: `loop` — "panel containing status, markdown, roster, progress, and log; stop/details actions". */
const loopPanel: PiUiElement = {
  id: "run-7",
  ns: "loop",
  kind: "panel",
  placement: "pinned",
  title: "Loop run #7",
  actions: [
    { id: "stop", label: "Stop loop", variant: "danger", confirm: "Stop the running loop?" },
  ],
  payload: {
    kind: "panel",
    text: "Iterating toward the goal.",
    sections: [
      {
        id: "head",
        kind: "status",
        title: "Status",
        payload: { kind: "status", text: "Iterating", tone: "accent" },
      },
      {
        id: "notes",
        kind: "markdown",
        payload: { kind: "markdown", text: "**Refining** the plan." },
      },
      {
        id: "fleet",
        kind: "roster",
        title: "Fleet",
        payload: {
          kind: "roster",
          rows: [{ id: "sub_1", label: "reviewer", state: "running" }],
        },
      },
      {
        id: "progress",
        kind: "progress",
        payload: { kind: "progress", label: "Loop rounds", value: 4, max: 10 },
      },
      {
        id: "tail",
        kind: "log",
        title: "Log",
        payload: { kind: "log", lines: ["round 3", "round 4"] },
      },
    ],
  },
};

/** plan.md §11.7: `pi-goal` — "goal status, rounds, budget, blocked/waiting state"; channel `pi-goal:status`. */
const goalStatus: PiUiElement = {
  id: "goal-1",
  ns: "pi-goal",
  kind: "status",
  placement: "pinned",
  title: "Goal",
  payload: {
    kind: "status",
    text: "Active — round 2",
    detail: "Budget 1.2k/100k",
    tone: "accent",
  },
};

// A `status`-placement element is header/status-strip territory (plan.md
// §11.5), not the rail — used below to prove the rail excludes it even when
// it sits alongside pinned siblings from the same agent.
const planModeStatus: PiUiElement = {
  id: "mode",
  ns: "plan-mode",
  kind: "status",
  placement: "status",
  title: "Plan mode: reviewing changes",
  payload: { kind: "status", text: "Reviewing changes" },
};

function renderRail(elements: PiUiElement[], controller = makeController()) {
  return render(
    <PiExtensionRail elements={elements} agentId="agt_1" actionController={controller} />,
  );
}

describe("PiExtensionRail", () => {
  it("renders the empty state when there is no pinned content", () => {
    renderRail([]);
    expect(screen.getByTestId("pi-extension-rail-empty")).toBeTruthy();
    expect(screen.queryByTestId("pi-extension-rail-list")).toBeNull();
  });

  it("excludes non-pinned placements per §11.5, keeping only pinned elements", () => {
    renderRail([planModeStatus, todoWidget]);
    expect(screen.queryByText("Plan mode: reviewing changes")).toBeNull();
    expect(screen.getByText("3 of 7 tasks complete")).toBeTruthy();
  });

  it("collapses to the empty state only when genuinely empty, not when every element is non-pinned", () => {
    renderRail([planModeStatus]);
    // Still "genuinely empty" from the rail's point of view — no pinned
    // element survived the filter — so the empty state is correct here.
    expect(screen.getByTestId("pi-extension-rail-empty")).toBeTruthy();
  });

  describe("fleet, workflow, loop, and goal (T29R2)", () => {
    it("renders all four, each at full per-kind fidelity, simultaneously and independently", () => {
      renderRail([fleetRoster, workflowProgress, loopPanel, goalStatus]);

      expect(screen.queryByTestId("pi-extension-rail-empty")).toBeNull();
      const list = screen.getByTestId("pi-extension-rail-list");
      // Direct children only — several of the four elements below nest
      // their own `<li>`s (e.g. the fleet roster's `TaskRows`, or the loop
      // panel's nested roster section), so `getAllByRole("listitem")` over
      // the whole subtree would over-count.
      expect(list.children).toHaveLength(4);

      const fleetCard = screen.getByTestId("pi-rail-element-subagents-fleet");
      const workflowCard = screen.getByTestId("pi-rail-element-workflows-deploy-workflow");
      const loopCard = screen.getByTestId("pi-rail-element-loop-run-7");
      const goalCard = screen.getByTestId("pi-rail-element-pi-goal-goal-1");

      // Fleet: real roster rows with individual labels and text status
      // (not a "2 agents" count), through the T29B1 `roster` renderer.
      expect(within(fleetCard).getByText("Subagent fleet")).toBeTruthy();
      expect(within(fleetCard).getByText("Researcher")).toBeTruthy();
      expect(within(fleetCard).getByText("In progress")).toBeTruthy();
      expect(within(fleetCard).getByText("Writer")).toBeTruthy();
      expect(within(fleetCard).getByText("Done")).toBeTruthy();
      expect(within(fleetCard).getByText("reading /tmp/synthetic.ts")).toBeTruthy();

      // Workflow: a real progress bar with a visible numeric readout, not
      // a "step 2 of 5" string baked into a title.
      const workflowProgressbar = within(workflowCard).getByRole("progressbar", {
        name: "Deploy workflow",
      });
      expect(workflowProgressbar.getAttribute("aria-valuenow")).toBe("40");
      expect(within(workflowCard).getByText("40%")).toBeTruthy();
      expect(
        within(workflowCard).getByTestId("pi-progress-workflows-deploy-workflow").textContent,
      ).toContain("2");
      expect(within(workflowCard).getByText("implement phase")).toBeTruthy();

      // Loop: the panel composes status, markdown, roster, progress, and
      // log sections — every one of them independently visible, plus the
      // panel's own top-level "Stop loop" action.
      expect(within(loopCard).getByText("Loop run #7")).toBeTruthy();
      expect(within(loopCard).getByText("Iterating")).toBeTruthy();
      const loopNotes = within(loopCard).getByTestId("pi-markdown-loop-notes");
      expect(loopNotes.querySelector("strong")?.textContent).toBe("Refining");
      expect(within(loopCard).getByText("reviewer")).toBeTruthy();
      const loopProgress = within(loopCard).getByTestId("pi-progress-loop-progress");
      expect(loopProgress.textContent).toContain("4");
      expect(loopProgress.textContent).toContain("10");
      const loopLog = within(loopCard).getByTestId("pi-log-loop-tail-scroll");
      expect(loopLog.textContent).toContain("round 3");
      expect(loopLog.textContent).toContain("round 4");
      expect(within(loopCard).getByRole("button", { name: "Stop loop" })).toBeTruthy();

      // Goal: status text and detail (rounds/budget), text-first, not a dot alone.
      expect(within(goalCard).getByText("Active — round 2")).toBeTruthy();
      expect(within(goalCard).getByText("Budget 1.2k/100k")).toBeTruthy();
      const goalStatusNode = within(goalCard).getByRole("status");
      expect(goalStatusNode.textContent).toContain("Pi Goal");

      // No collapsed summary chip anywhere that merges the four into one
      // readout — e.g. no combined "4 active"/"4 items" count standing in
      // for the real per-element content asserted above.
      expect(screen.queryByText(/4 active/i)).toBeNull();
      expect(screen.queryByText(/4 item/i)).toBeNull();
    });

    it("keeps a live fleet/workflow/loop/goal element visible across a store-driven update, without remounting the rail", () => {
      const { PiUiElementStore } = extensions;
      const store = new PiUiElementStore();
      // Sequential revisions (T21B; `PiUiElementStore` discards a repeated
      // revision as stale and treats a skipped one as a gap needing resync —
      // see `packages/frontend-core/src/extensions/state.test.ts` — so each
      // of these three initial elements arrives on its own revision, the
      // same way three separate published-channel deltas would.
      store.ingestDelta("agt_1", 1, { op: "upsert", element: fleetRoster });
      store.ingestDelta("agt_1", 2, { op: "upsert", element: workflowProgress });
      store.ingestDelta("agt_1", 3, { op: "upsert", element: goalStatus });

      function LiveRail() {
        const elements = usePiUiRailElements(store, "agt_1");
        return (
          <PiExtensionRail
            elements={elements}
            agentId="agt_1"
            actionController={makeController()}
          />
        );
      }

      render(<LiveRail />);

      expect(
        within(screen.getByTestId("pi-rail-element-subagents-fleet")).getByText("Researcher"),
      ).toBeTruthy();
      expect(
        screen
          .getByTestId("pi-rail-element-workflows-deploy-workflow")
          .querySelector('[role="progressbar"]')
          ?.getAttribute("aria-valuenow"),
      ).toBe("40");
      expect(screen.getByText("Active — round 2")).toBeTruthy();

      // A live "published channel" update — the workflow advances a step,
      // a fleet row finishes, and the goal's round count moves on — all
      // through the same store the rail already subscribes to (T29R1's
      // `usePiUiRailElements`), not a re-render with new props.
      act(() => {
        store.ingestDelta("agt_1", 4, {
          op: "upsert",
          element: {
            ...workflowProgress,
            payload: { kind: "progress", label: "Deploy workflow", value: 4, max: 5 },
          },
        });
        store.ingestDelta("agt_1", 5, {
          op: "upsert",
          element: {
            ...fleetRoster,
            payload: {
              kind: "roster",
              rows: [
                { id: "job-1", label: "Researcher", state: "done" },
                { id: "job-2", label: "Writer", state: "done" },
              ],
            },
          },
        });
        store.ingestDelta("agt_1", 6, {
          op: "upsert",
          element: {
            ...goalStatus,
            payload: {
              kind: "status",
              text: "Active — round 3",
              detail: "Budget 1.4k/100k",
              tone: "accent",
            },
          },
        });
      });

      expect(
        screen
          .getByTestId("pi-rail-element-workflows-deploy-workflow")
          .querySelector('[role="progressbar"]')
          ?.getAttribute("aria-valuenow"),
      ).toBe("80");
      const fleetCard = screen.getByTestId("pi-rail-element-subagents-fleet");
      expect(within(fleetCard).getAllByText("Done")).toHaveLength(2);
      expect(screen.getByText("Active — round 3")).toBeTruthy();
      expect(screen.getByText("Budget 1.4k/100k")).toBeTruthy();

      // The fleet element itself stayed visible throughout — it never
      // dropped out of the rail while still live/pinned.
      expect(screen.getByTestId("pi-rail-element-subagents-fleet")).toBeTruthy();
    });

    it("dispatches a fleet row action through the real registry wiring, not a static summary", async () => {
      const sent: Array<Record<string, unknown>> = [];
      const controller = makeController((message) => sent.push(message as Record<string, unknown>));
      const rosterWithAction: PiUiElement = {
        ...fleetRoster,
        payload: {
          kind: "roster",
          rows: [
            {
              id: "job-1",
              label: "Researcher",
              state: "running",
              actions: [{ id: "cancel", label: "Cancel" }],
            },
          ],
        },
      };
      const user = userEvent.setup();
      renderRail([rosterWithAction], controller);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(sent).toEqual([
        expect.objectContaining({
          type: "pi.ui.action.request",
          agentId: "agt_1",
          elementId: "fleet#job-1",
          actionId: "cancel",
        }),
      ]);
    });
  });

  it("labels the rail region under a heading landmark", () => {
    renderRail([todoWidget]);
    expect(screen.getByRole("heading", { name: "Live extensions" })).toBeTruthy();
  });

  it("exposes each element's raw payload behind a native, keyboard-operable disclosure", async () => {
    const user = userEvent.setup();
    renderRail([todoWidget]);

    const summary = screen.getByText("Raw payload");
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details");
    if (!details) throw new Error("expected a <details> ancestor");

    // Tab from the top of the document until the disclosure itself has
    // focus — proves it is reachable purely by keyboard, not just by click.
    await user.tab();
    expect(document.activeElement).toBe(summary);

    // jsdom does not apply the browser's default UA stylesheet that hides a
    // closed <details>'s body, so this asserts the real, portable signal
    // instead: the element's own `open` state. `<summary>` is native
    // interactive content — every browser maps a keyboard Enter/Space on a
    // focused summary to the same activation behavior as a click (jsdom
    // implements that activation behavior for a real click event, which is
    // exactly what this asserts); the line above already proved the
    // element is keyboard-focusable in the first place, so together these
    // two checks cover both halves of "reachable by keyboard" without a
    // bespoke click handler of this component's own.
    expect(details.open).toBe(false);
    await user.click(summary);
    expect(details.open).toBe(true);

    const raw = screen.getByTestId("pi-rail-element-todo-tasks-raw");
    expect(raw.textContent).toContain('"kind": "widget"');
  });

  it("shows one visible diagnostic, not transcript text, for an unrecognized kind", () => {
    const unknown: PiUiElement = {
      id: "x",
      ns: "some-extension",
      kind: "not-a-real-kind" as never,
      placement: "pinned",
      title: "Mystery element",
    };
    renderRail([unknown]);
    expect(screen.getByText(/Unrecognized element kind/)).toBeTruthy();
    expect(screen.getByText(/source: some-extension:x/)).toBeTruthy();
  });

  it("shows one visible diagnostic, not a silent blank card, for a known kind with no valid payload", () => {
    const bare: PiUiElement = {
      id: "bare",
      ns: "some-extension",
      kind: "log",
      placement: "pinned",
      title: "Untitled feed",
    };
    renderRail([bare]);
    expect(screen.getByText(/payload does not match its kind's shape/)).toBeTruthy();
  });

  it("has no axe violations empty or populated with fleet, workflow, loop, and goal together", async () => {
    const { container: empty } = renderRail([]);
    expect(await axe(empty)).toHaveNoViolations();
    cleanup();

    const { container: populated } = renderRail([
      todoWidget,
      fleetRoster,
      workflowProgress,
      loopPanel,
      goalStatus,
    ]);
    expect(await axe(populated)).toHaveNoViolations();
  });

  describe("telemetry (T29C2)", () => {
    const knownTelemetry: coreTelemetry.ContextWindowTelemetry = {
      contextWindow: {
        status: "known",
        usedTokens: 50_000,
        maxTokens: 200_000,
        usedFraction: 0.25,
      },
      cacheShare: {
        status: "known",
        cachedTokens: 8_000,
        freshTokens: 2_000,
        cacheHitFraction: 0.8,
        cacheHitPercent: 80,
      },
    };

    it("renders no context meter when telemetry is omitted, leaving existing behavior untouched", () => {
      render(<PiExtensionRail elements={[]} agentId="agt_1" actionController={makeController()} />);
      expect(screen.queryByTestId("context-meter")).toBeNull();
      expect(screen.getByTestId("pi-extension-rail-empty")).toBeTruthy();
    });

    it("renders the context meter above the pinned list when telemetry is supplied", () => {
      render(
        <PiExtensionRail
          elements={[todoWidget]}
          agentId="agt_1"
          actionController={makeController()}
          telemetry={knownTelemetry}
        />,
      );
      expect(screen.getByTestId("context-meter")).toBeTruthy();
      expect(screen.getByTestId("pi-extension-rail-list")).toBeTruthy();
    });

    it("renders the context meter even when there is no pinned extension content", () => {
      render(
        <PiExtensionRail
          elements={[]}
          agentId="agt_1"
          actionController={makeController()}
          telemetry={knownTelemetry}
        />,
      );
      // Context/cache usage is live agent state, not an extension element, so
      // it does not collapse away just because no extension is pinned.
      expect(screen.getByTestId("context-meter")).toBeTruthy();
      expect(screen.getByTestId("pi-extension-rail-empty")).toBeTruthy();
    });

    it("has no axe violations with telemetry present", async () => {
      const { container } = render(
        <PiExtensionRail
          elements={[todoWidget]}
          agentId="agt_1"
          actionController={makeController()}
          telemetry={knownTelemetry}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
