/**
 * Frame-clock platform interface (plan.md §7.4, §14.5, T45A1).
 *
 * Core paces bounded, high-frequency work (starting with the streaming
 * timeline batcher, T45A2) through this interface instead of calling
 * `requestAnimationFrame`/`setTimeout` directly, so the pacing mechanism
 * stays deterministic under test and no browser global leaks into core.
 * `requestAnimationFrame`/`cancelAnimationFrame` are banned globals in
 * this package (see `.oxlintrc.json`) — this interface is the sanctioned
 * substitute.
 *
 * Web supplies an adapter backed by `requestAnimationFrame` (falling
 * back to a timer while the tab is hidden, since rAF throttles or stops
 * there); Android supplies an adapter backed by its own frame or timer
 * primitive. Neither adapter lives here — see `apps/web/src/platform/`
 * and `apps/android/src/platform/` (T45A3 and its Android counterpart).
 *
 * Contract: a `FrameClock` holds **at most one pending callback**. Core
 * callers that want "schedule only if nothing is already scheduled"
 * semantics (the streaming batcher does) must track that themselves —
 * calling `requestFrame` again before a pending callback fires replaces
 * it rather than queuing a second one. This mirrors how the batcher is
 * used: it accumulates *data* itself and only ever needs one outstanding
 * "please tell me when the next frame happens" request at a time.
 */

/**
 * Whether the host surface is actively presenting frames. A hidden tab
 * or backgrounded app is `"background"`, so a host adapter can pace
 * differently there (e.g. fall back to a slow timer once
 * `requestAnimationFrame` stops firing) without core needing to know how.
 */
export type FrameClockPhase = "foreground" | "background";

export interface FrameTickInfo {
  /** Milliseconds since the Unix epoch, per this clock's own notion of time. */
  timestampMs: number;
  /** The pacing phase in effect at the moment this tick fired. */
  phase: FrameClockPhase;
}

export type FrameCallback = (info: FrameTickInfo) => void;

export interface FrameClock {
  /** The current pacing phase. Hosts update this from lifecycle/visibility signals. */
  phase(): FrameClockPhase;
  /**
   * Schedules `callback` to run on the next frame tick. Replaces any
   * previously pending callback on this clock instance; see the
   * single-pending-callback contract above.
   */
  requestFrame(callback: FrameCallback): void;
  /** Cancels the pending callback, if any. Safe to call when nothing is pending. */
  cancelFrame(): void;
}

/**
 * Deterministic, manually-ticked `FrameClock` for core (and host) tests.
 * Drives the interface with no timers and no browser: `tick()` fires the
 * pending callback synchronously, in test code's own control flow.
 */
export class TestFrameClock implements FrameClock {
  private currentPhase: FrameClockPhase = "foreground";
  private currentTimeMs: number;
  private pending: FrameCallback | null = null;

  constructor(startTimeMs = 0) {
    this.currentTimeMs = startTimeMs;
  }

  phase(): FrameClockPhase {
    return this.currentPhase;
  }

  /** Test-only: sets the phase a subsequent `tick()` will report. */
  setPhase(phase: FrameClockPhase): void {
    this.currentPhase = phase;
  }

  requestFrame(callback: FrameCallback): void {
    this.pending = callback;
  }

  cancelFrame(): void {
    this.pending = null;
  }

  /** Test-only: whether a callback is currently scheduled. */
  hasPendingFrame(): boolean {
    return this.pending !== null;
  }

  /**
   * Advances the fake clock by `advanceMs` and, if a callback is
   * pending, fires it synchronously and clears the pending slot first
   * (so the callback may schedule its own next frame from inside
   * itself, as the streaming batcher does). Returns whether a callback
   * fired.
   */
  tick(advanceMs = 16): boolean {
    this.currentTimeMs += advanceMs;
    const callback = this.pending;
    this.pending = null;
    if (!callback) return false;
    callback({ timestampMs: this.currentTimeMs, phase: this.currentPhase });
    return true;
  }

  now(): number {
    return this.currentTimeMs;
  }
}
