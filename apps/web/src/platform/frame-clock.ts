import type {
  FrameCallback,
  FrameClock,
  FrameClockPhase,
  FrameTickInfo,
} from "@picompanion/frontend-core";

/**
 * Web `FrameClock` implementation (T45A3, plan.md §7.4, §14.5).
 *
 * `packages/frontend-core/src/platform/frame-clock.ts` (T45A1) defines the
 * interface core paces bounded, high-frequency work through — starting
 * with `TimelineCoalescer` (T45A2), which batches every pushed live
 * `agent_stream` message and applies the whole pending batch as one state
 * transition per frame tick, so a burst of N streaming deltas produces one
 * paint instead of N (plan.md §14.5's "core batches pending rows into one
 * application per tick"). This module is that interface's `requestAnimationFrame`
 * backing for `apps/web`.
 *
 * Fallback cadence while hidden: a backgrounded/minimized tab throttles or
 * stops `requestAnimationFrame` entirely in most browsers, since there is
 * no compositor frame to align to. Relying on it there would stall the
 * streaming batcher's next flush indefinitely — messages would keep
 * queuing in memory but never apply until the tab were shown again. Once
 * `document.hidden` is true this clock instead paces on a plain timer
 * (`BACKGROUND_INTERVAL_MS`), a cadence chosen for "state keeps advancing
 * so the transcript is caught up the moment the tab is shown again", not
 * for any paint budget (there is nothing to paint while hidden).
 *
 * Holds at most one pending callback, per the `FrameClock` contract:
 * `requestFrame` replaces whichever scheduling primitive (a `rAF` handle
 * or a timer handle) is currently outstanding instead of stacking a
 * second one. A `visibilitychange` that fires while a callback is still
 * pending re-schedules that *same* callback onto whichever primitive now
 * fits the new phase, rather than waiting for a rAF that may never fire
 * (foreground -> background) or leaving a slow timer running once rAF is
 * available again (background -> foreground).
 */

/** How often this clock fires its fallback callback while
 * `document.hidden` is `true` and `requestAnimationFrame` cannot be
 * trusted to fire promptly, if at all. Not a paint budget — nothing is
 * visibly painting while the document is hidden — just a cadence that
 * keeps queued streaming state from going stale indefinitely. */
const BACKGROUND_INTERVAL_MS = 250;

export function createBrowserFrameClock(): FrameClock {
  let pendingCallback: FrameCallback | null = null;
  let rafHandle: number | null = null;
  // `window.setTimeout`'s return type resolves through whichever global
  // `setTimeout` declaration this workspace's `@types/node` inclusion
  // merges in, not always the DOM lib's plain `number` overload; cast at
  // the one call site below rather than fight that merge here.
  let timerHandle: number | null = null;

  function phase(): FrameClockPhase {
    return document.hidden ? "background" : "foreground";
  }

  function clearPrimitives(): void {
    if (rafHandle !== null) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (timerHandle !== null) {
      window.clearTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function fire(): void {
    const callback = pendingCallback;
    pendingCallback = null;
    rafHandle = null;
    timerHandle = null;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (callback) {
      const info: FrameTickInfo = { timestampMs: Date.now(), phase: phase() };
      callback(info);
    }
  }

  function scheduleOnCurrentPhase(): void {
    if (phase() === "background") {
      timerHandle = window.setTimeout(fire, BACKGROUND_INTERVAL_MS) as unknown as number;
    } else {
      rafHandle = window.requestAnimationFrame(fire);
    }
  }

  function handleVisibilityChange(): void {
    if (pendingCallback === null) {
      // Nothing pending: no primitive to move, and `fire()` already
      // detaches this listener when it runs, so there is nothing to do.
      return;
    }
    clearPrimitives();
    scheduleOnCurrentPhase();
  }

  return {
    phase,
    requestFrame(callback) {
      // "At most one pending callback": drop whatever was scheduled
      // before, then schedule the new one fresh.
      clearPrimitives();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pendingCallback = callback;
      document.addEventListener("visibilitychange", handleVisibilityChange);
      scheduleOnCurrentPhase();
    },
    cancelFrame() {
      clearPrimitives();
      pendingCallback = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
