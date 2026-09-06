/**
 * Clock and timer interface (plan.md §7.3).
 *
 * Core code must schedule work through `Clock` instead of calling
 * `setTimeout`/`setInterval`/`Date.now` directly, so timing is
 * deterministic under test and so no platform global leaks into core.
 */
export type TimerHandle = { readonly __timerHandleBrand: unique symbol };

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}
