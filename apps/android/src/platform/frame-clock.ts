import type {
  AppLifecycle,
  AppLifecycleState,
  FrameCallback,
  FrameClock,
  FrameClockPhase,
  FrameTickInfo,
} from "@picompanion/frontend-core";

/**
 * Android `FrameClock` implementation (T33A2B, split from T33A2; plan.md
 * §7.4, §14.5, T45A1).
 *
 * The Android counterpart of `apps/web/src/platform/frame-clock.ts`
 * (T45A3): the `requestAnimationFrame`-backed pacing primitive that
 * `TimelineCoalescer` (T45A2) schedules its per-tick batch flush onto, so
 * a burst of N pushed `agent_stream` deltas applies as one state
 * transition instead of N. Read `frontend-core`'s `frame-clock.ts` for
 * the interface contract this must uphold.
 *
 * Two differences from web, both intentional:
 *
 * 1. Phase source. Web reads `document.hidden` directly, because that
 *    *is* its lifecycle signal. Android's equivalent signal is React
 *    Native's `AppState`, already wrapped once by
 *    `./lifecycle.ts`'s `createAppStateLifecycle()` (exposed as
 *    `AppCore["lifecycle"]` in `../app-shell/core.ts`, whose own doc comment
 *    states the "one source of foreground/background state per process"
 *    rule this file follows). Rather than subscribing to `AppState` a
 *    second time, this module takes an `AppLifecycle` as an injected
 *    dependency and derives its phase from that. The caller wires
 *    `createAppStateLifecycle()` through at the real app boundary (that
 *    wiring is T33A2's job, not this one's); tests inject a fake
 *    `AppLifecycle` instead and never touch `react-native`.
 *
 *    `AppLifecycle` reports three states (`"active"`, `"inactive"`,
 *    `"background"`) where `FrameClockPhase` has two. `"inactive"` maps
 *    to `"background"` here for the same reason `ResumeController`
 *    (`packages/frontend-core/src/connection/resume-controller.ts`)
 *    treats a return to `"active"` *from* `"inactive"` exactly like a
 *    return from `"background"`: `"inactive"` is the "not fully
 *    foregrounded" bucket, not a third pacing tier, so only `"active"`
 *    counts as `"foreground"` here.
 *
 * 2. Scheduling primitives. Web calls `window.requestAnimationFrame`/
 *    `window.setTimeout` directly because jsdom supplies real ones in
 *    tests. This workspace's tests can never import `react-native`
 *    (rolldown chokes on its Flow-typed entry point — see this repo's
 *    `CLAUDE.md`), and this file has no DOM/Node lib to declare RN's
 *    globals against (`apps/android/tsconfig.json` sets `lib: ["ES2023"]`
 *    only). So both the frame primitive and the fallback timer are
 *    injected as plain function deps (`requestAnimationFrame`/
 *    `cancelAnimationFrame`/`setTimeout`/`clearTimeout`) rather than read
 *    off a global. The real app boundary passes React Native's globals
 *    (`global.requestAnimationFrame`, `global.setTimeout`, ...); tests
 *    pass hand-rolled fakes with no timers and no schedulers of their
 *    own, driven synchronously in test code's own control flow.
 *
 * Background fallback cadence, same reasoning as web: a backgrounded app
 * gets no `requestAnimationFrame` calls at all (there is no compositor
 * frame to align to), so relying on it would stall the streaming
 * batcher's next flush indefinitely. Once the lifecycle reports anything
 * other than `"active"`, this clock paces on the injected timer instead
 * (`BACKGROUND_INTERVAL_MS`) — a "keep state moving so the transcript is
 * caught up the instant the app returns to the foreground" cadence, not
 * a paint budget.
 *
 * Holds at most one pending callback, per the `FrameClock` contract:
 * `requestFrame` replaces whichever primitive (an rAF handle or a timer
 * handle) is currently outstanding instead of stacking a second one. An
 * `AppLifecycle` change that fires while a callback is still pending
 * re-schedules that *same* callback onto whichever primitive now fits
 * the new phase, rather than waiting on an rAF that may never fire
 * (foreground -> background) or leaving a slow timer running once rAF is
 * available again (background -> foreground).
 */

/** Same cadence and same rationale as web's `BACKGROUND_INTERVAL_MS`:
 * not a paint budget, just a "don't let queued streaming state go stale
 * indefinitely while backgrounded" interval. */
const BACKGROUND_INTERVAL_MS = 250;

/**
 * The scheduling primitives this clock paces on, injected so the whole
 * module stays `react-native`-free and deterministically testable. The
 * real app boundary supplies React Native's globals; tests supply fakes.
 */
export interface AppFrameSchedulers {
  requestAnimationFrame: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
  /** Milliseconds since the Unix epoch, per this clock's own notion of time. */
  now: () => number;
}

export interface AppFrameClockDeps extends AppFrameSchedulers {
  /** The single source of foreground/background truth for this process —
   * pass `createAppStateLifecycle()` (or `AppCore["lifecycle"]`) at the
   * real app boundary, and a fake `AppLifecycle` in tests. */
  lifecycle: AppLifecycle;
}

/** Maps `AppLifecycle`'s three states onto `FrameClock`'s two-phase
 * model. Only `"active"` counts as `"foreground"`; see the doc comment
 * above for why `"inactive"` joins `"background"` rather than getting a
 * pacing tier of its own. */
export function mapLifecycleToFramePhase(state: AppLifecycleState): FrameClockPhase {
  return state === "active" ? "foreground" : "background";
}

export function createAppFrameClock(deps: AppFrameClockDeps): FrameClock {
  let pendingCallback: FrameCallback | null = null;
  let rafHandle: number | null = null;
  let timerHandle: number | null = null;
  let unsubscribeLifecycle: (() => void) | null = null;

  function phase(): FrameClockPhase {
    return mapLifecycleToFramePhase(deps.lifecycle.getState());
  }

  function clearPrimitives(): void {
    if (rafHandle !== null) {
      deps.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (timerHandle !== null) {
      deps.clearTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function detachLifecycle(): void {
    if (unsubscribeLifecycle !== null) {
      unsubscribeLifecycle();
      unsubscribeLifecycle = null;
    }
  }

  function fire(): void {
    const callback = pendingCallback;
    pendingCallback = null;
    rafHandle = null;
    timerHandle = null;
    detachLifecycle();
    if (callback) {
      const info: FrameTickInfo = { timestampMs: deps.now(), phase: phase() };
      callback(info);
    }
  }

  function scheduleOnCurrentPhase(): void {
    if (phase() === "background") {
      timerHandle = deps.setTimeout(fire, BACKGROUND_INTERVAL_MS);
    } else {
      rafHandle = deps.requestAnimationFrame(fire);
    }
  }

  function handleLifecycleChange(): void {
    if (pendingCallback === null) {
      // Nothing pending: no primitive to move, and `fire()` already
      // detaches this subscription when it runs, so there is nothing to do.
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
      detachLifecycle();
      pendingCallback = callback;
      unsubscribeLifecycle = deps.lifecycle.subscribe(handleLifecycleChange);
      scheduleOnCurrentPhase();
    },
    cancelFrame() {
      clearPrimitives();
      pendingCallback = null;
      detachLifecycle();
    },
  };
}
