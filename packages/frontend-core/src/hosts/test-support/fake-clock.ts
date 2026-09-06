/**
 * A deterministic, manually-advanced `Clock` test double shared by
 * `hosts/`'s own unit tests. Not exported from `hosts/index.ts` — it is
 * test-only scaffolding, not part of this domain's public surface.
 */
import type { Clock, TimerHandle } from "../../platform/clock.js";

interface ScheduledTimeout {
  id: number;
  dueAt: number;
  callback: () => void;
  interval: number | null;
}

function toHandle(id: number): TimerHandle {
  return id as unknown as TimerHandle;
}

function fromHandle(handle: TimerHandle): number {
  return handle as unknown as number;
}

export class FakeClock implements Clock {
  private currentTime: number;
  private nextId = 1;
  private readonly timers = new Map<number, ScheduledTimeout>();

  constructor(startTime = 0) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, dueAt: this.currentTime + delayMs, callback, interval: null });
    return toHandle(id);
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(fromHandle(handle));
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, {
      id,
      dueAt: this.currentTime + intervalMs,
      callback,
      interval: intervalMs,
    });
    return toHandle(id);
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(fromHandle(handle));
  }

  /** Advances the clock and synchronously fires every timer now due, in due-time order. Interval timers reschedule themselves. */
  advance(byMs: number): void {
    const target = this.currentTime + byMs;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt);
      const next = due[0];
      if (!next) break;
      this.currentTime = next.dueAt;
      if (next.interval === null) {
        this.timers.delete(next.id);
      } else {
        next.dueAt = this.currentTime + next.interval;
      }
      next.callback();
    }
    this.currentTime = target;
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }
}
