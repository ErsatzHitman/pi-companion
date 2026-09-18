import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionRail } from "./pi-extension-rail.js";

/**
 * `PiExtensionRail` (rebuilt for the reference Live pane;
 * `docs/ui-reference/pi-companion-web.html` `.live` region; plan.md §8.3,
 * §11.5). The pane holds exactly two named cards — Subagents, Workflow —
 * plus a generic `.card` per other pinned element kind, and NO Context/
 * Cache/Cost block (that telemetry moved to the composer's context ring
 * and its own session-controls sheet in `features/composer/Composer.tsx`,
 * neither owned by this component).
 *
 * Fixtures below mirror the real daemon-synthesized shapes recorded in
 * `packages/frontend-core/src/testing/fixtures/extensions/scenarios/
 * subagents.ts` (`ns:"subagents"`, `kind:"roster"`, `placement:"pinned"`,
 * rows carrying `state`/`detail`) and `workflows.ts`'s
 * `workflow-progress-channel-upsert-2` frame (`ns:"workflow"`,
 * `kind:"progress"`, `placement:"pinned"`, payload `label`/`value`/`max`)
 * — same `ns`/`kind`/`placement`/shape, synthetic ids/labels of this file's
 * own choosing, per plan.md §14.2. `todo.ts` (`ns:"todo"`, `kind:"widget"`,
 * pinned) stands in for the generic "other kind" card.
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
}

function makeController(): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: (() => {}) as never,
  });
}

/** Mirrors `subagents.ts`'s `fleet-upsert-1` frame's element. */
const fleetRoster: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  title: "Subagent fleet (1 running)",
  durable: true,
  payload: {
    kind: "roster",
    rows: [
      {
        id: "job-1",
        label: "research: synthetic query",
        state: "running",
        detail: "opencode/deepseek-v4-flash · 1.2k tokens",
      },
      { id: "job-2", label: "lint: synthetic sweep", state: "blocked", detail: "waiting on job-1" },
      { id: "job-3", label: "docs: synthetic summary", state: "done", detail: "12.3k tokens" },
    ],
  },
};

/** Mirrors `workflows.ts`'s `workflow-progress-channel-upsert-2` frame's element. */
const workflowProgress: PiUiElement = {
  id: "workflow-widget",
  ns: "workflow",
  kind: "progress",
  placement: "pinned",
  title: "workflow · implement",
  payload: { kind: "progress", label: "workflow · implement", value: 2, max: 5 },
};

/** Mirrors `todo.ts`'s pinned widget element — the generic "other kind" card. */
const todoWidget: PiUiElement = {
  id: "rpiv-todos",
  ns: "todo",
  kind: "widget",
  placement: "pinned",
  title: "Todos (1/3)",
  durable: true,
  payload: { kind: "widget", text: "Next: write the tests" },
};

// A `status`-placement element is header/status-strip territory (plan.md
// §11.5), not the rail.
const planModeStatus: PiUiElement = {
  id: "mode",
  ns: "plan-mode",
  kind: "status",
  placement: "status",
  title: "Plan mode: reviewing changes",
  payload: { kind: "status", text: "Reviewing changes" },
};

function renderRail(
  elements: PiUiElement[],
  extra: Partial<Parameters<typeof PiExtensionRail>[0]> = {},
) {
  return render(
    <PiExtensionRail
      elements={elements}
      agentId="agt_1"
      actionController={makeController()}
      {...extra}
    />,
  );
}

describe("PiExtensionRail", () => {
  it("renders a single card carrying the empty-state copy when there is no pinned content", () => {
    renderRail([]);
    expect(screen.getByRole("heading", { name: "No live extensions" })).toBeTruthy();
    expect(screen.getByTestId("pi-extension-rail-empty").textContent).toContain(
      "Fleet, workflow, loop, and goal activity appear here",
    );
  });

  it("excludes non-pinned placements per §11.5, keeping only pinned elements", () => {
    renderRail([planModeStatus, todoWidget]);
    expect(screen.queryByText("Plan mode: reviewing changes")).toBeNull();
    expect(screen.getAllByText("Todos (1/3)").length).toBeGreaterThan(0);
  });

  it("collapses to the empty state only when genuinely empty, not when every element is non-pinned", () => {
    renderRail([planModeStatus]);
    expect(screen.getByTestId("pi-extension-rail-empty")).toBeTruthy();
  });

  it("renders shimmer placeholder rows, not content, while loading", () => {
    renderRail([fleetRoster], { loading: true });
    expect(screen.getByTestId("pi-extension-rail-loading")).toBeTruthy();
    expect(screen.getByTestId("pi-extension-rail-shimmer-subagents")).toBeTruthy();
    expect(screen.getByTestId("pi-extension-rail-shimmer-workflow")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Subagents" })).toBeNull();
  });

  describe("Subagents card", () => {
    it("renders one .agent row per roster row, with a distinct glyph per status and the header running/total count", () => {
      renderRail([fleetRoster]);
      const card = screen.getByRole("heading", { name: "Subagents" }).closest("section");
      if (!card) throw new Error("expected a section ancestor");
      expect(within(card).getByText("1 running · 3 total")).toBeTruthy();

      const running = screen.getByTestId("pi-rail-agent-fleet-job-1");
      expect(within(running).getByText("research: synthetic query")).toBeTruthy();
      expect(within(running).getByText("Running")).toBeTruthy();
      expect(within(running).getByText("opencode/deepseek-v4-flash · 1.2k tokens")).toBeTruthy();

      const blocked = screen.getByTestId("pi-rail-agent-fleet-job-2");
      expect(within(blocked).getByText("Blocked")).toBeTruthy();

      const done = screen.getByTestId("pi-rail-agent-fleet-job-3");
      expect(within(done).getByText("Done")).toBeTruthy();

      // Status is never colour-only: each row's glyph character itself differs.
      expect(within(running).getByTestId("pi-rail-agent-fleet-job-1-glyph").textContent).toContain(
        "◐",
      );
      expect(within(blocked).getByTestId("pi-rail-agent-fleet-job-2-glyph").textContent).toContain(
        "◆",
      );
      expect(within(done).getByTestId("pi-rail-agent-fleet-job-3-glyph").textContent).toContain(
        "✓",
      );
    });

    it("renders a .track bar only when a row's progress is known, never a fabricated 0%", () => {
      const withProgress: PiUiElement = {
        ...fleetRoster,
        payload: {
          kind: "roster",
          rows: [
            { id: "job-1", label: "researcher", state: "running", progress: { value: 3, max: 10 } },
            { id: "job-2", label: "writer", state: "blocked" },
          ],
        },
      };
      renderRail([withProgress]);
      const known = screen.getByTestId("pi-rail-agent-fleet-job-1");
      const bar = within(known).getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("30");

      const unknown = screen.getByTestId("pi-rail-agent-fleet-job-2");
      expect(within(unknown).queryByRole("progressbar")).toBeNull();
    });
  });

  describe("Workflow card", () => {
    it("renders one .phase row per workflow progress element, with the header's N-of-M count and a mono step counter", () => {
      renderRail([workflowProgress]);
      const card = screen.getByRole("heading", { name: "Workflow" }).closest("section");
      if (!card) throw new Error("expected a section ancestor");
      expect(within(card).getByText("0 of 1")).toBeTruthy();

      const phase = screen.getByTestId("pi-rail-phase-workflow-workflow-widget");
      expect(within(phase).getByText("workflow · implement")).toBeTruthy();
      expect(within(phase).getByText("2/5")).toBeTruthy();
      expect(within(phase).getByText("Running")).toBeTruthy();
    });

    it("marks a phase done once value reaches max, updating the header count", () => {
      const finished: PiUiElement = {
        ...workflowProgress,
        payload: { kind: "progress", label: "workflow · implement", value: 5, max: 5 },
      };
      renderRail([finished]);
      const card = screen.getByRole("heading", { name: "Workflow" }).closest("section");
      if (!card) throw new Error("expected a section ancestor");
      expect(within(card).getByText("1 of 1")).toBeTruthy();
      expect(
        within(screen.getByTestId("pi-rail-phase-workflow-workflow-widget")).getByText("Done"),
      ).toBeTruthy();
    });
  });

  describe("generic card (other kinds)", () => {
    it("renders a non-subagents/workflow pinned element in its own section+heading .card, through the real registry", () => {
      renderRail([todoWidget]);
      const cardRoot = screen.getByTestId("pi-rail-element-todo-rpiv-todos");
      expect(cardRoot.tagName).toBe("SECTION");
      expect(
        within(cardRoot).getAllByRole("heading", { name: "Todos (1/3)" }).length,
      ).toBeGreaterThan(0);
      expect(within(cardRoot).getByText("Next: write the tests")).toBeTruthy();
    });

    it("renders Subagents, Workflow, and a generic card simultaneously, none collapsed into the others", () => {
      renderRail([fleetRoster, workflowProgress, todoWidget]);
      expect(screen.getByRole("heading", { name: "Subagents" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Workflow" })).toBeTruthy();
      expect(screen.getByTestId("pi-rail-element-todo-rpiv-todos")).toBeTruthy();
      expect(screen.queryByTestId("pi-extension-rail-empty")).toBeNull();
    });
  });

  it("has no axe violations empty, loading, or populated", async () => {
    const { container: empty } = renderRail([]);
    expect(await axe(empty)).toHaveNoViolations();
    cleanup();

    const { container: loading } = renderRail([], { loading: true });
    expect(await axe(loading)).toHaveNoViolations();
    cleanup();

    const { container: populated } = renderRail([fleetRoster, workflowProgress, todoWidget]);
    expect(await axe(populated)).toHaveNoViolations();
  });

  describe("CSS (docs/ui-reference/pi-companion-web.html mockup values)", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "pi-extension-rail.css"),
      "utf8",
    );

    const ruleBodyFor = (selector: string) => {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const at = stripped.indexOf(`${selector} {`);
      expect(at, `${selector} not found in pi-extension-rail.css`).toBeGreaterThanOrEqual(0);
      const close = stripped.indexOf("}", at);
      expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
      return stripped.slice(at, close);
    };

    it("declares the .card shell via design tokens: surface, radius-card, shadow-card — no raw hex", () => {
      const body = ruleBodyFor(".pi-extension-rail__card");
      expect(body).toMatch(/background:\s*var\(--color-surface\)/);
      expect(body).toMatch(/border-radius:\s*var\(--radius-card\)/);
      expect(body).toMatch(/box-shadow:\s*var\(--shadow-card\)/);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });

    it("sizes the agent name row at the mockup's 11.5px (--font-size-md)", () => {
      expect(ruleBodyFor(".pi-extension-rail__agent-row")).toMatch(
        /font-size:\s*var\(--font-size-md\)/,
      );
    });

    it("sizes the elapsed label mono at the mockup's 10px (--font-size-xs, not --font-size-sm)", () => {
      const body = ruleBodyFor(".pi-extension-rail__elapsed");
      expect(body).toMatch(/font-family:\s*var\(--font-family-mono\)/);
      expect(body).toMatch(/font-size:\s*var\(--font-size-xs\)/);
      expect(body).not.toMatch(/font-size:\s*var\(--font-size-sm\)/);
    });

    it("colours each status glyph by a distinct token, not one shared colour", () => {
      expect(ruleBodyFor(".pi-extension-rail__glyph--running")).toMatch(
        /color:\s*var\(--color-accent\)/,
      );
      expect(ruleBodyFor(".pi-extension-rail__glyph--done")).toMatch(
        /color:\s*var\(--color-green\)/,
      );
      expect(ruleBodyFor(".pi-extension-rail__glyph--blocked")).toMatch(
        /color:\s*var\(--color-orange\)/,
      );
      expect(ruleBodyFor(".pi-extension-rail__glyph--pending")).toMatch(
        /color:\s*var\(--color-ink-3\)/,
      );
    });

    it("lays the phase grid out with the mockup's 3-column template and a done-phase connector", () => {
      expect(ruleBodyFor(".pi-extension-rail__phase")).toMatch(
        /grid-template-columns:\s*14px 1fr auto/,
      );
      expect(ruleBodyFor(".pi-extension-rail__phase--done::before")).toMatch(
        /background:\s*var\(--color-green\)/,
      );
    });
  });
});
