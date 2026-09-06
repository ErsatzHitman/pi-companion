import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Clock, Logger, TimerHandle, extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { WidgetRenderer } from "./widget.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

/**
 * T114 — the `widget` renderer's live elapsed-time label, read from
 * `payload.startedAt` (T40A4). `widget` payload schemas are `.passthrough()`
 * (`@picompanion/protocol/pi-ui-bridge/payload.ts`) exactly like `status`,
 * so an extension publishing a widget with its own `startedAt` is carried
 * through unchanged and deserves the same reader as `status.tsx` — before
 * this file, nothing under `apps/web/src/features/extensions/renderers/`
 * ever read it.
 *
 * Same fully controllable `Clock` as `status.test.tsx` — `now()` and timer
 * firing both driven by `advance()`, never a real timer or the wall clock.
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
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[0] - b[0])[0];
      if (!due) {
        break;
      }
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.callback();
    }
    this.time = target;
  }
}

const idleActionState: extensions.ExtensionActionState = { status: "idle" };

function baseElement(payload: Record<string, unknown>): PiUiElement {
  return {
    id: "w1",
    ns: "workflow",
    kind: "widget",
    placement: "pinned",
    title: "Deploy",
    payload: { kind: "widget", text: "Deploying", ...payload },
  } as PiUiElement;
}

function view(payload: Record<string, unknown>, clock: Clock) {
  const element = baseElement(payload);
  return render(
    <WidgetRenderer
      element={element}
      payload={element.payload as never}
      revision={undefined}
      dispatchAction={async () => ({ status: "success" }) as never}
      getActionState={() => idleActionState}
      logger={noopLogger}
      clock={clock}
    />,
  );
}

describe("WidgetRenderer elapsed time (T114)", () => {
  it("renders no elapsed label when the payload carries no startedAt", () => {
    view({}, new FakeClock());
    expect(screen.queryByTestId("pi-widget-elapsed-workflow-w1")).toBeNull();
  });

  it("renders live elapsed time from payload.startedAt", () => {
    const clock = new FakeClock();
    view({ startedAt: 0 }, clock);
    expect(screen.getByTestId("pi-widget-elapsed-workflow-w1").textContent).toBe("0s");
  });

  it("updates the elapsed label as the injected clock advances, with no wall-clock reference", () => {
    const clock = new FakeClock();
    view({ startedAt: 0 }, clock);
    const label = screen.getByTestId("pi-widget-elapsed-workflow-w1");
    expect(label.textContent).toBe("0s");

    act(() => {
      clock.advance(90_000);
    });
    expect(label.textContent).toBe("1m 30s");
  });

  it("ignores a non-numeric startedAt rather than showing a bogus label", () => {
    view({ startedAt: "soon" }, new FakeClock());
    expect(screen.queryByTestId("pi-widget-elapsed-workflow-w1")).toBeNull();
  });
});
