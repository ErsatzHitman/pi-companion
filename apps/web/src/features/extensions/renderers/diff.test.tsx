import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "../registry-view.js";
import { piUiRendererRegistry } from "../registry.js";
import { countDiffLines, parseUnifiedDiffLines } from "./diff.js";
import "./index.js";

/**
 * T29B3 — render the `diff` kind. Acceptance criteria exercised here:
 *
 * - "Diffs render from fixtures with correct add/remove counts"
 * - "Large diffs are bounded rather than dropped"
 * - "Counts use tabular mono figures"
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

const SAMPLE_UNIFIED_DIFF = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,4 +1,5 @@",
  " export function foo() {",
  "-  return 1;",
  "+  const value = 2;",
  "+  return value;",
  " }",
].join("\n");

const diffElement: PiUiElement = {
  id: "review",
  ns: "code-review",
  kind: "diff",
  placement: "inline",
  title: "src/foo.ts",
  payload: {
    kind: "diff",
    unifiedDiff: SAMPLE_UNIFIED_DIFF,
    filePath: "src/foo.ts",
    language: "ts",
  },
} as PiUiElement;

describe("registration (T29B3)", () => {
  it("registers the diff renderer", () => {
    expect(piUiRendererRegistry.has("diff")).toBe(true);
  });
});

describe("parseUnifiedDiffLines / countDiffLines", () => {
  it("classifies metadata, hunk, add, remove, and context lines", () => {
    const lines = parseUnifiedDiffLines(SAMPLE_UNIFIED_DIFF);
    expect(lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "remove",
      "add",
      "add",
      "context",
    ]);
  });

  it("counts added and removed lines, excluding file headers", () => {
    expect(countDiffLines(parseUnifiedDiffLines(SAMPLE_UNIFIED_DIFF))).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it("does not count `---`/`+++` file header lines as removed/added", () => {
    const headerOnly = ["--- a/x", "+++ b/x", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    expect(countDiffLines(parseUnifiedDiffLines(headerOnly))).toEqual({ added: 1, removed: 1 });
  });

  it("returns no lines for an empty diff", () => {
    expect(parseUnifiedDiffLines("")).toEqual([]);
  });
});

// T58: the `diff` kind renderer is `React.lazy`-registered
// (`renderers/index.js`) so its `@lezer/*`-backed dependency does not
// ship on every route (plan.md §14.5). `PiUiElementView` renders it
// under a `<Suspense>` boundary (`registry-view.js`), so it — unlike
// every other kind here — resolves asynchronously even in this test's
// synchronous module graph; each test below awaits the renderer's first
// piece of visible output (`findBy*`) before making any further,
// ordinary synchronous assertions against the now-fully-rendered tree.
describe("diff renderer", () => {
  it("renders a DiffSummary badge with correct add/remove counts", async () => {
    view(diffElement);
    const summary = await screen.findByTestId("pi-diff-code-review-review-summary");
    expect(summary.getAttribute("aria-label")).toBe("src/foo.ts: 2 added, 1 removed");
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("renders the diff title and every content line", async () => {
    view(diffElement);
    await screen.findByTestId("pi-diff-code-review-review-code");
    expect(screen.getAllByText("src/foo.ts").length).toBeGreaterThan(0);
    // Highlighted lines are split across per-token spans, so match on the
    // rendered code region's full text content rather than one exact string.
    const codeText = screen.getByTestId("pi-diff-code-review-review-code").textContent ?? "";
    expect(codeText).toContain("export function foo() {");
    expect(codeText).toContain("return 1;");
    expect(codeText).toContain("const value = 2;");
    expect(codeText).toContain("return value;");
  });

  it("marks add/remove lines with a visible +/- marker, not colour alone", async () => {
    view(diffElement);
    const scroll = await screen.findByTestId("pi-diff-code-review-review-scroll");
    const addLine = scroll.querySelector(".pc-pi-diff__line--add");
    const removeLine = scroll.querySelector(".pc-pi-diff__line--remove");
    expect(addLine?.querySelector(".pc-pi-diff__marker")?.textContent).toBe("+");
    expect(removeLine?.querySelector(".pc-pi-diff__marker")?.textContent).toBe("-");
  });

  it("bounds a large diff instead of dropping it, with a visible truncation notice", async () => {
    const bigDiffLines = ["--- a/big.txt", "+++ b/big.txt", "@@ -1,2100 +1,2100 @@"];
    for (let i = 0; i < 2100; i++) bigDiffLines.push(`+line ${i}`);
    const bigElement: PiUiElement = {
      ...diffElement,
      id: "big",
      payload: {
        kind: "diff",
        unifiedDiff: bigDiffLines.join("\n"),
        filePath: "big.txt",
      },
    } as PiUiElement;

    view(bigElement);

    // The badge still reports the *true* total, not the bounded slice.
    expect(await screen.findByText("+2100")).toBeTruthy();
    expect(screen.getByText(/Showing first 2000 of 2103 lines/)).toBeTruthy();
    // Bounded, not dropped: some of the visible lines are still rendered.
    expect(screen.getByText("line 0")).toBeTruthy();
    // Lines past the cap are not mounted.
    expect(screen.queryByText("line 2099")).toBeNull();
  });

  it("renders an empty-state message for an empty diff", async () => {
    const emptyElement: PiUiElement = {
      ...diffElement,
      id: "empty",
      payload: { kind: "diff", unifiedDiff: "" },
    } as PiUiElement;
    view(emptyElement);
    expect(await screen.findByText("No changes to show.")).toBeTruthy();
  });

  it("falls back to plain text for an unrecognized/absent language", async () => {
    const plainElement: PiUiElement = {
      ...diffElement,
      id: "plain",
      payload: {
        kind: "diff",
        unifiedDiff: ["-old line", "+new line"].join("\n"),
      },
    } as PiUiElement;
    view(plainElement);
    expect(await screen.findByText("old line")).toBeTruthy();
    expect(screen.getByText("new line")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = view(diffElement);
    await screen.findByTestId("pi-diff-code-review-review-summary");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
