import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiExtensionRail } from "../../rail/pi-extension-rail.js";

/**
 * T113 — proves, in the DOM, that the pinned element `workflow:progress`
 * now synthesizes (`packages/server/.../ui-bridge/state.ts`'s
 * `applyChannel` `"workflow:progress"` case, gated on `payload.active ===
 * true`) actually reaches a real, reachable row on the web right rail —
 * not a fabricated one.
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
 * `selectRailElements` (only `placement: "pinned"` survives) -> the
 * dedicated "Workflow" card's `PhaseRow` — rather than calling a renderer
 * directly, so a regression in the rail's own placement/bucketing would
 * also fail this file, not just an isolated renderer unit test.
 *
 * FIX-CI3 (reconciled after UI-W5, `docs/issues-from-plan.md`):
 * `pi-extension-rail.tsx`'s rebuild routes every `ns:"workflow"
 * payload.kind:"progress"` pinned element into a dedicated "Workflow" card
 * as one `.phase` row (glyph + name + a short mono step counter), matching
 * `docs/ui-reference/pi-companion-web.html`'s own `.flow`/`.phase` markup
 * exactly (that reference never draws an ARIA progress bar or a percentage
 * for a workflow phase) — it no longer reaches `RailElementCard` /
 * `PiUiElementView` / the registered `progress` renderer at all, so the
 * old `role="progressbar"`/percentage assertions below no longer describe
 * any DOM this component can produce for a workflow element. The element
 * is still fully rendered and reachable; the assertions below were moved
 * onto the real current DOM (`pi-rail-phase-<ns>-<id>`, `PhaseRow`'s name
 * and step-counter text, and its real, payload-derived status) rather than
 * weakened.
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
  it("renders a real phase row with an honest step/total counter, not a plain-text title card", () => {
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

    // `pi-rail-phase-<ns>-<id>`, not `pi-rail-element-<ns>-<id>`: a
    // `ns:"workflow"` progress element renders inside the Workflow card's
    // own `PhaseRow`, never through the generic per-kind renderer card.
    const card = screen.getByTestId("pi-rail-phase-workflow-workflow-widget");
    // Real label reached the DOM, not a fallback (`element.kind`/`element.id`).
    expect(within(card).getByText("workflow · implement")).toBeTruthy();
    // Real step/total reached the DOM as one honest counter — proves this is
    // computed from the actual payload, not a fabricated/rounded percentage.
    expect(within(card).getByText("2/5")).toBeTruthy();
    // 2/5 = 40%, neither done nor pending, so the row's own status must be
    // "running" — proves `progressPayloadStatus` genuinely read the payload
    // rather than this row defaulting to some other status.
    expect(card.className).toContain("pi-extension-rail__phase--running");
    expect(within(card).getByText("Running")).toBeTruthy();
  });

  it("renders something truthful (no fabricated counter or status) when total is absent", () => {
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

    const card = screen.getByTestId("pi-rail-phase-workflow-workflow-widget");
    // `progressStepCounter` returns "—" (unknown), never a fraction computed
    // from `value` alone with no `max` — the shape of fabrication T113's
    // original `progress.tsx` fix guarded against (clamping the raw step
    // count into `[0, 1]`, i.e. a false 100%).
    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).queryByText("2/2")).toBeNull();
    expect(within(card).queryByText(/%/)).toBeNull();
    // With no `max`, `railProgressFraction` is `undefined`, so the row's own
    // status is honestly "pending" (unknown), never fabricated as "done".
    expect(card.className).toContain("pi-extension-rail__phase--pending");
    expect(within(card).getByText("Pending")).toBeTruthy();
  });
});
