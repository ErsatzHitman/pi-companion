import type { Clock, TimerHandle } from "@picompanion/frontend-core";

/** `Clock` backed by `Date`/`setTimeout`/`setInterval` (plan.md §7.3). */
export function createBrowserClock(): Clock {
  return {
    now() {
      return Date.now();
    },
    setTimeout(callback, delayMs) {
      return window.setTimeout(callback, delayMs) as unknown as TimerHandle;
    },
    clearTimeout(handle) {
      window.clearTimeout(handle as unknown as number);
    },
    setInterval(callback, intervalMs) {
      return window.setInterval(callback, intervalMs) as unknown as TimerHandle;
    },
    clearInterval(handle) {
      window.clearInterval(handle as unknown as number);
    },
  };
}
