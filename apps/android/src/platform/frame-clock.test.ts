import type { AppLifecycle, AppLifecycleState } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import { createAppFrameClock, mapLifecycleToFramePhase } from "./frame-clock";

/**
 * T33A2B: the same batching-contract test `apps/web/src/platform/
 * frame-clock.test.ts` (T45A3) runs against `createBrowserFrameClock`,
 * ported to `createAppFrameClock`'s injected deps so nothing here
 * imports `react-native` or a real timer/rAF/AppState. Differences from
 * the web version, and why:
 *
 * - Web reads `document.hidden` (via jsdom) and mocks the DOM's
 *   `requestAnimationFrame`/`setTimeout` with `vi.useFakeTimers()`.
 *   There is no DOM here, so this file drives everything through the
 *   hand-rolled `FakeLifecycle` and `createFakeSchedulers()` below —
 *   deterministic, event-loop-free fakes with no timers of their own.
 * - Web toggles phase via `document.dispatchEvent(new
 *   Event("visibilitychange"))`; this toggles phase via
 *   `FakeLifecycle#setState`, which is what `createAppFrameClock`'s
 *   injected `AppLifecycle.subscribe` actually reacts to.
 * - One added case (`mapLifecycleToFramePhase` describe block) with no
 *   web equivalent, because `AppLifecycle` has a three-state model
 *   (`"active"` / `"inactive"` / `"background"`) where
 *   `document.hidden` only has two; see `frame-clock.ts`'s doc comment
 *   for why `"inactive"` maps to `"background"`.
 *
 * Every other case name below matches its web counterpart one-to-one.
 */

class FakeLifecycle implements AppLifecycle {
  private state: AppLifecycleState;
  private readonly listeners = new Set<(state: AppLifecycleState) => void>();

  constructor(initial: AppLifecycleState = "active") {
    this.state = initial;
  }

  getState(): AppLifecycleState {
    return this.state;
  }

  subscribe(listener: (state: AppLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test-only: pushes a new state and notifies subscribers, exactly as
   * a real `AppState` change would. */
  setState(next: AppLifecycleState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Deterministic fakes for the injected rAF/timer/now primitives.
 * Nothing here schedules against a real clock or the real event loop —
 * `flushRaf`/`advanceTimers` are the only things that ever fire a
 * callback, entirely under the test's own control.
 */
function createFakeSchedulers() {
  let nextHandle = 1;
  let nowMs = 0;
  const rafQueue = new Map<number, (timestamp: number) => void>();
  const timerQueue = new Map<number, { callback: () => void; dueAt: number }>();

  return {
    requestAnimationFrame: vi.fn((callback: (timestamp: number) => void) => {
      const handle = nextHandle++;
      rafQueue.set(handle, callback);
      return handle;
    }),
    cancelAnimationFrame: vi.fn((handle: number) => {
      rafQueue.delete(handle);
    }),
    setTimeout: vi.fn((callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      timerQueue.set(handle, { callback, dueAt: nowMs + delayMs });
      return handle;
    }),
    clearTimeout: vi.fn((handle: number) => {
      timerQueue.delete(handle);
    }),
    now: () => nowMs,
    /** Fires every currently-pending rAF callback, as the next real
     * frame would, and advances the fake clock by one frame tick. */
    flushRaf(): void {
      nowMs += 16;
      const pending = [...rafQueue.values()];
      rafQueue.clear();
      for (const callback of pending) callback(nowMs);
    },
    /** Advances the fake clock by `ms` and fires any timers now due. */
    advanceTimers(ms: number): void {
      nowMs += ms;
      const due = [...timerQueue.entries()].filter(([, t]) => t.dueAt <= nowMs);
      for (const [handle, t] of due) {
        timerQueue.delete(handle);
        t.callback();
      }
    },
    get rafPendingCount(): number {
      return rafQueue.size;
    },
    get timerPendingCount(): number {
      return timerQueue.size;
    },
  };
}

function harness(initial: AppLifecycleState = "active") {
  const lifecycle = new FakeLifecycle(initial);
  const schedulers = createFakeSchedulers();
  const clock = createAppFrameClock({ lifecycle, ...schedulers });
  return { lifecycle, schedulers, clock };
}

describe("mapLifecycleToFramePhase", () => {
  it("maps active to foreground", () => {
    expect(mapLifecycleToFramePhase("active")).toBe("foreground");
  });

  it("maps background to background", () => {
    expect(mapLifecycleToFramePhase("background")).toBe("background");
  });

  it("maps inactive to background (there is no third pacing tier)", () => {
    expect(mapLifecycleToFramePhase("inactive")).toBe("background");
  });
});

describe("createAppFrameClock", () => {
  it("reports foreground when the lifecycle is active and background otherwise", () => {
    const { lifecycle, clock } = harness("active");
    expect(clock.phase()).toBe("foreground");

    lifecycle.setState("background");
    expect(clock.phase()).toBe("background");
  });

  it("schedules a foreground callback on requestAnimationFrame and reports phase foreground", () => {
    const { schedulers, clock } = harness("active");
    const callback = vi.fn();

    clock.requestFrame(callback);
    expect(callback).not.toHaveBeenCalled();
    expect(schedulers.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(schedulers.setTimeout).not.toHaveBeenCalled();

    schedulers.flushRaf();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "foreground" });
  });

  it("falls back to a timer cadence while the lifecycle is not active instead of requestAnimationFrame", () => {
    const { schedulers, clock } = harness("background");
    const callback = vi.fn();

    clock.requestFrame(callback);
    expect(schedulers.requestAnimationFrame).not.toHaveBeenCalled();

    // requestAnimationFrame's usual ~16ms cadence must not fire this: the
    // backgrounded fallback uses a slower, explicit timer instead.
    schedulers.advanceTimers(16);
    expect(callback).not.toHaveBeenCalled();

    schedulers.advanceTimers(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "background" });
  });

  it("holds at most one pending callback: a second requestFrame call replaces the first", () => {
    const { schedulers, clock } = harness("active");
    const first = vi.fn();
    const second = vi.fn();

    clock.requestFrame(first);
    clock.requestFrame(second);
    expect(schedulers.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    schedulers.flushRaf();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancelFrame cancels a pending requestAnimationFrame callback", () => {
    const { schedulers, clock } = harness("active");
    const callback = vi.fn();

    clock.requestFrame(callback);
    clock.cancelFrame();

    // Assert on the underlying primitive directly, not only on the
    // observable callback: `cancelFrame` also clears `pendingCallback`,
    // so a leaked-but-uncancelled rAF handle would still produce a
    // passing "callback not called" assertion below even if the real
    // `deps.cancelAnimationFrame` were never invoked.
    expect(schedulers.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(schedulers.rafPendingCount).toBe(0);

    schedulers.flushRaf();
    expect(callback).not.toHaveBeenCalled();
  });

  it("cancelFrame cancels a pending fallback timer callback", () => {
    const { schedulers, clock } = harness("background");
    const callback = vi.fn();

    clock.requestFrame(callback);
    clock.cancelFrame();

    // Same reasoning as the rAF case above: assert the timer primitive
    // itself was released, not just that the (already-nulled)
    // `pendingCallback` never fires.
    expect(schedulers.clearTimeout).toHaveBeenCalledTimes(1);
    expect(schedulers.timerPendingCount).toBe(0);

    schedulers.advanceTimers(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("cancelFrame is a safe no-op when nothing is pending", () => {
    const { clock } = harness("active");
    expect(() => {
      clock.cancelFrame();
    }).not.toThrow();
  });

  it("re-schedules a still-pending callback onto the fallback timer when the app is backgrounded mid-flight", () => {
    const { lifecycle, schedulers, clock } = harness("active");
    const callback = vi.fn();

    clock.requestFrame(callback);
    lifecycle.setState("background");

    // The original rAF tick must no longer fire it...
    schedulers.flushRaf();
    expect(callback).not.toHaveBeenCalled();

    // ...but the fallback cadence still delivers exactly one call.
    schedulers.advanceTimers(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "background" });
  });

  it("re-schedules a still-pending callback onto requestAnimationFrame when the app is foregrounded mid-flight", () => {
    const { lifecycle, schedulers, clock } = harness("background");
    const callback = vi.fn();

    clock.requestFrame(callback);
    lifecycle.setState("active");

    // Fast rAF cadence now delivers it well before the old background timer would have.
    schedulers.flushRaf();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "foreground" });
  });

  it("a lifecycle change with nothing pending does not schedule or throw", () => {
    const { lifecycle, schedulers, clock } = harness("active");
    expect(() => {
      lifecycle.setState("background");
      schedulers.advanceTimers(5000);
    }).not.toThrow();
    expect(schedulers.timerPendingCount).toBe(0);
    void clock;
  });

  it("fires only once per requestFrame call, even across repeated lifecycle changes", () => {
    const { lifecycle, schedulers, clock } = harness("active");
    const callback = vi.fn();

    clock.requestFrame(callback);
    lifecycle.setState("background");
    lifecycle.setState("active");
    schedulers.flushRaf();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from the lifecycle once the pending callback fires", () => {
    const { lifecycle, schedulers, clock } = harness("active");
    clock.requestFrame(vi.fn());
    expect(lifecycle.listenerCount).toBe(1);

    schedulers.flushRaf();
    expect(lifecycle.listenerCount).toBe(0);
  });

  it("unsubscribes from the lifecycle when cancelFrame is called", () => {
    const { lifecycle, clock } = harness("active");
    clock.requestFrame(vi.fn());
    expect(lifecycle.listenerCount).toBe(1);

    clock.cancelFrame();
    expect(lifecycle.listenerCount).toBe(0);
  });
});
