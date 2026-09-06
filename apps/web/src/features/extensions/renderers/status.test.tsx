import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Clock, Logger, TimerHandle, extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { StatusRenderer } from "./status.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

/**
 * T114 — the `status` renderer's live elapsed-time label, read from
 * `payload.startedAt` (T40A4). Before this file, `grep -rn startedAt
 * apps/web/src/features/extensions/renderers/` returned nothing: the value
 * reached the typed payload but had no reader anywhere in `apps/web`.
 *
 * Uses a fully controllable `Clock` (plan.md §7.3) — `now()` and timer
 * firing are both driven by `advance()`, never a real timer or the wall
 * clock (T71 exists because of exactly that mistake elsewhere).
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
  /** Repeatedly fires whatever timers are due as `time` advances, so a
   * handler that re-arms itself with a fresh `setTimeout` (as
   * `useElapsedSince` does) keeps ticking across one `advance()` call that
   * spans several intervals — not just the first one due. */
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
    id: "status",
    ns: "goal",
    kind: "status",
    placement: "status",
    title: "Running",
    payload: { kind: "status", text: "Running", ...payload },
  } as PiUiElement;
}

function view(payload: Record<string, unknown>, clock: Clock) {
  const element = baseElement(payload);
  return render(
    <StatusRenderer
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

describe("StatusRenderer elapsed time (T114)", () => {
  it("renders no elapsed label when the payload carries no startedAt", () => {
    view({}, new FakeClock());
    expect(screen.queryByTestId("pi-status-elapsed-goal-status")).toBeNull();
  });

  it("renders live elapsed time from payload.startedAt", () => {
    const clock = new FakeClock();
    view({ startedAt: 0 }, clock);
    expect(screen.getByTestId("pi-status-elapsed-goal-status").textContent).toBe("0s");
  });

  it("updates the elapsed label as the injected clock advances, with no wall-clock reference", () => {
    const clock = new FakeClock();
    view({ startedAt: 0 }, clock);
    const label = screen.getByTestId("pi-status-elapsed-goal-status");
    expect(label.textContent).toBe("0s");

    act(() => {
      clock.advance(5_000);
    });
    expect(label.textContent).toBe("5s");

    act(() => {
      clock.advance(60_000);
    });
    expect(label.textContent).toBe("1m 5s");
  });

  it("ignores a non-numeric startedAt rather than showing a bogus label", () => {
    view({ startedAt: "not-a-number" }, new FakeClock());
    expect(screen.queryByTestId("pi-status-elapsed-goal-status")).toBeNull();
  });
});
