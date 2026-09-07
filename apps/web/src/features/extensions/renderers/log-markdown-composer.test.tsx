import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "../registry-view.js";
import { piUiRendererRegistry } from "../registry.js";
import "./index.js";
import { DEFAULT_LOG_TAIL } from "./log.js";

/**
 * T29A3 — render the `log`, `markdown`, and `composer` kinds. Acceptance
 * criteria exercised here:
 *
 * - "All three render from canonical-payload fixtures"
 * - "Markdown is sanitised and cannot inject script or raw HTML"
 * - "Log output is bounded and scrollable"
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

describe("registration (T29A3)", () => {
  it("registers log, markdown, and composer renderers", () => {
    expect(piUiRendererRegistry.has("log")).toBe(true);
    expect(piUiRendererRegistry.has("markdown")).toBe(true);
    expect(piUiRendererRegistry.has("composer")).toBe(true);
  });
});

describe("log renderer", () => {
  const logElement: PiUiElement = {
    id: "activity",
    ns: "advisor",
    kind: "log",
    placement: "inline",
    title: "Advisor activity log",
    payload: {
      kind: "log",
      lines: ["Starting up", "Fetched 3 files", "Done"],
    },
  } as PiUiElement;

  it("renders every line from the canonical payload fixture", () => {
    view(logElement);
    expect(screen.getByText("Advisor activity log")).toBeTruthy();
    const region = screen.getByRole("log", { name: "Advisor activity log output" });
    expect(region.textContent).toContain("Starting up");
    expect(region.textContent).toContain("Fetched 3 files");
    expect(region.textContent).toContain("Done");
  });

  it("is bounded and scrollable: a small max-height region caps very long output", () => {
    const manyLines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    view({
      ...logElement,
      payload: { kind: "log", lines: manyLines, tail: 10 },
    } as PiUiElement);

    const region = screen.getByTestId("pi-log-advisor-activity-scroll");
    expect(region.className).toContain("pc-pi-log__scroll");
    // Only the last `tail` lines are mounted, not all 50.
    expect(screen.getByText(/line 49/)).toBeTruthy();
    expect(screen.queryByText(/^line 0$/)).toBeNull();
    expect(screen.getByText(/Showing last 10 of 50 lines/)).toBeTruthy();
  });

  it("bounds the log to the shared default tail of 200 lines when the payload names no tail", () => {
    expect(DEFAULT_LOG_TAIL).toBe(200);
    const manyLines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    view({
      ...logElement,
      payload: { kind: "log", lines: manyLines, mono: false },
    } as PiUiElement);

    // Only the newest DEFAULT_LOG_TAIL lines are ever mounted — the oldest
    // 50 of 250 are dropped, matching the Android render model's default
    // (`apps/android/src/features/extensions/renderers/log-model.ts`,
    // `DEFAULT_LOG_TAIL`; both are 200 as of T226 — plan.md §14.5).
    expect(screen.getByText("line 250")).toBeTruthy();
    expect(screen.getByText("line 51")).toBeTruthy();
    expect(screen.queryByText("line 50")).toBeNull();
    expect(screen.queryByText(/^line 1$/)).toBeNull();
    expect(
      screen.getByText(/Showing last 200 of 250 lines \(50 earlier lines hidden\)\./),
    ).toBeTruthy();
  });

  it("respects mono: false by rendering a plain list instead of a code block", () => {
    view({
      ...logElement,
      payload: { kind: "log", lines: ["one", "two"], mono: false },
    } as PiUiElement);
    const region = screen.getByTestId("pi-log-advisor-activity-scroll");
    expect(region.querySelector(".pc-pi-log__lines")).toBeTruthy();
    expect(region.querySelector(".pc-code-block")).toBeNull();
  });

  it("shows a placeholder rather than an empty region when there are no lines", () => {
    view({ ...logElement, payload: { kind: "log", lines: [] } } as PiUiElement);
    expect(screen.getByText("No output yet.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = view(logElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("markdown renderer", () => {
  const markdownElement: PiUiElement = {
    id: "notes",
    ns: "btw",
    kind: "markdown",
    placement: "screen",
    title: "BTW: design review notes",
    payload: {
      kind: "markdown",
      text: "## Summary\n\nThis has **bold**, *em*, and `code`.\n\n- one\n- two\n\n[docs](https://example.com)",
    },
  } as PiUiElement;

  it("renders headings, emphasis, code, lists, and links from the canonical payload fixture", () => {
    view(markdownElement);
    expect(screen.getByRole("heading", { level: 3, name: "Summary" })).toBeTruthy();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("em").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    const link = screen.getByRole("link", { name: /docs/ });
    expect(link.getAttribute("href")).toBe("https://example.com");
  });

  it("never renders a script tag or interprets raw HTML from the payload text", () => {
    const { container } = view({
      ...markdownElement,
      payload: {
        kind: "markdown",
        text: "before <script>window.__pwned = true;</script> after",
      },
    } as PiUiElement);

    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The literal source text is still visible, just as inert text.
    expect(container.textContent).toContain("<script>window.__pwned = true;</script>");
  });

  it("never turns a javascript: link into a real, navigable anchor", () => {
    const { container } = view({
      ...markdownElement,
      payload: {
        kind: "markdown",
        text: "[click me](javascript:evil)",
      },
    } as PiUiElement);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[click me](javascript:evil)");
  });

  it("has no axe violations", async () => {
    const { container } = view(markdownElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("composer renderer", () => {
  const composerElement: PiUiElement = {
    id: "arbitrage-suggestion",
    ns: "prompt-arbitrage",
    kind: "composer",
    placement: "inline",
    title: "Composer replacement suggested",
    actions: [
      { id: "accept", label: "Use suggestion", variant: "primary" },
      { id: "undo", label: "Undo", variant: "secondary" },
    ],
    payload: {
      kind: "composer",
      text: "Rewritten prompt text",
      mode: "replace",
      previousText: "Original prompt text",
    },
  } as PiUiElement;

  it("renders the proposed text, mode, and previous text from the canonical payload fixture", () => {
    view(composerElement);
    expect(screen.getByText("Composer replacement suggested")).toBeTruthy();
    expect(screen.getByText("Rewritten prompt text")).toBeTruthy();
    expect(screen.getByText("Replace draft")).toBeTruthy();
    expect(screen.getByText("Original prompt text")).toBeTruthy();
  });

  it("dispatches the accept action and reflects pending state", async () => {
    const sent: unknown[] = [];
    const controller = makeController((message) => sent.push(message));
    const user = userEvent.setup();
    view(composerElement, controller);

    const button = screen.getByRole("button", { name: "Use suggestion" });
    button.focus();
    await user.keyboard("{Enter}");

    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "accept" }),
    ]);
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "prompt-arbitrage",
        elementId: "arbitrage-suggestion",
        actionId: "accept",
      }).status,
    ).toBe("pending");
  });

  it("renders without a previous-draft section when previousText is absent", () => {
    view({
      ...composerElement,
      payload: { kind: "composer", text: "New text", mode: "prefill" },
    } as PiUiElement);
    expect(screen.getByText("Prefill draft")).toBeTruthy();
    expect(screen.queryByText("Current draft")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = view(composerElement);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
