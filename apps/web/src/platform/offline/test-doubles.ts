/**
 * Test doubles for the offline-cache platform module (T393).
 *
 * `frontend-core` ships its own doubles, but they live in its *testing*
 * entry point, which `apps/web`'s production graph must not import. These
 * are the two shapes the offline path needs and nothing more: an
 * in-memory `StructuredStorage` and a `Clock` whose "now" only moves when
 * a test moves it, so a freshness assertion can never pass because real
 * time happened to advance.
 */
import type { Clock, StructuredStorage, TimerHandle } from "@picompanion/frontend-core";

/**
 * A handle the real `Clock` type brands opaquely (`TimerHandle` is a
 * unique-symbol brand, so nothing outside this file can mint one). The
 * double keeps its own numeric id inside and hands the brand back out.
 */
interface ManualTimerHandle extends TimerHandle {
  readonly id: number;
}

function handleFor(id: number): TimerHandle {
  return { id } as unknown as ManualTimerHandle;
}

function idOf(handle: TimerHandle): number {
  return (handle as unknown as ManualTimerHandle).id;
}

/** An in-memory `StructuredStorage`, keyed `collection/id`. */
export class InMemoryStructuredStorage implements StructuredStorage {
  private readonly records = new Map<string, unknown>();

  private static key(collection: string, id: string): string {
    return `${collection}\u0000${id}`;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const value = this.records.get(InMemoryStructuredStorage.key(collection, id));
    return value === undefined ? null : (structuredClone(value) as T);
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.records.set(InMemoryStructuredStorage.key(collection, id), structuredClone(value));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.records.delete(InMemoryStructuredStorage.key(collection, id));
  }

  async list<T>(collection: string, options?: { idPrefix?: string; limit?: number }): Promise<T[]> {
    const prefix = `${collection}\u0000${options?.idPrefix ?? ""}`;
    const values: T[] = [];
    for (const [key, value] of this.records) {
      if (!key.startsWith(prefix)) continue;
      values.push(structuredClone(value) as T);
      if (options?.limit !== undefined && values.length >= options.limit) break;
    }
    return values;
  }

  async clear(collection: string): Promise<void> {
    const prefix = `${collection}\u0000`;
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
  }
}

/**
 * A `Clock` whose `now()` is set by the test. Timers are registered but
 * never fired on their own: `advance` moves `now`, and a test that needs a
 * timer to run calls `runDue`.
 */
export class ManualClock implements Clock {
  private current: number;
  private readonly timers = new Map<
    number,
    { callback: () => void; dueAt: number; repeatMs?: number }
  >();
  private nextHandle = 1;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, dueAt: this.current + Math.max(0, delayMs) });
    return handleFor(handle);
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(idOf(handle));
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    const handle = this.nextHandle++;
    this.timers.set(handle, {
      callback,
      dueAt: this.current + Math.max(1, intervalMs),
      repeatMs: Math.max(1, intervalMs),
    });
    return handleFor(handle);
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(idOf(handle));
  }

  /** Moves "now" forward without running anything. */
  advance(deltaMs: number): void {
    this.current += deltaMs;
  }

  /** Runs every timer due at or before `now()`, in due order; intervals repeat. */
  runDue(): void {
    for (const [handle, timer] of [...this.timers].sort((a, b) => a[1].dueAt - b[1].dueAt)) {
      if (timer.dueAt > this.current) continue;
      if (timer.repeatMs === undefined) {
        this.timers.delete(handle);
      } else {
        timer.dueAt = this.current + timer.repeatMs;
      }
      timer.callback();
    }
  }
}
