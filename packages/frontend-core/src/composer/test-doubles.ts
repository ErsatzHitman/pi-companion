/**
 * Minimal in-memory `StructuredStorage`/`Clock` test doubles used only
 * by this domain's tests. Kept local to `composer/` rather than in
 * `testing/` (a T24 stub — see that module's header) so this task does
 * not add cross-domain fixture logic outside its own scope.
 */

import type { Clock, TimerHandle } from "../platform/clock.js";
import type { StructuredStorage, StructuredStorageListOptions } from "../platform/storage.js";

/**
 * Deep-clones a plain JSON-serializable value. Used instead of the DOM
 * `structuredClone` global (unavailable under this package's `lib:
 * ["ES2023"]`, deliberately with no DOM types) so stored/returned values
 * are never accidentally aliased with the caller's object.
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * In-memory `StructuredStorage`. Two `InMemoryStructuredStorage`
 * instances constructed over the same shared `Map` simulate an app
 * restart: state written before "restart" is still readable by the new
 * instance, exactly as a real disk-backed implementation would behave.
 */
export class InMemoryStructuredStorage implements StructuredStorage {
  constructor(private readonly backing: Map<string, unknown> = new Map()) {}

  /** Returns the shared backing map, for constructing a second instance over it. */
  get sharedBacking(): Map<string, unknown> {
    return this.backing;
  }

  private key(collection: string, id: string): string {
    return `${collection}\u0000${id}`;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const value = this.backing.get(this.key(collection, id));
    return value === undefined ? null : (deepClone(value) as T);
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.backing.set(this.key(collection, id), deepClone(value));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.backing.delete(this.key(collection, id));
  }

  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    const prefix = `${collection}\u0000${options?.idPrefix ?? ""}`;
    const results: T[] = [];
    for (const [key, value] of this.backing.entries()) {
      if (key.startsWith(prefix)) {
        results.push(deepClone(value) as T);
        if (options?.limit !== undefined && results.length >= options.limit) {
          break;
        }
      }
    }
    return results;
  }

  async clear(collection: string): Promise<void> {
    const prefix = `${collection}\u0000`;
    for (const key of [...this.backing.keys()]) {
      if (key.startsWith(prefix)) {
        this.backing.delete(key);
      }
    }
  }
}

/**
 * Deterministic, manually advanced `Clock` test double. `advance` fires
 * every `setTimeout` whose due time has arrived, in due order, so a
 * debounced writer (e.g. `DraftSessionController`) can be tested without a
 * real timer. `setInterval` is unimplemented — nothing under test needs it.
 */
export class FakeClock implements Clock {
  private currentMs: number;
  private readonly timers: Array<{ handle: TimerHandle; callback: () => void; dueAt: number }> = [];
  private nextTimerId = 0;

  constructor(startMs: number = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
    const due = this.timers
      .filter((timer) => timer.dueAt <= this.currentMs)
      .sort((a, b) => a.dueAt - b.dueAt);
    for (const timer of due) {
      const index = this.timers.indexOf(timer);
      if (index !== -1) this.timers.splice(index, 1);
    }
    for (const timer of due) {
      timer.callback();
    }
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    this.nextTimerId += 1;
    const handle = { __timerHandleBrand: this.nextTimerId } as unknown as TimerHandle;
    this.timers.push({ handle, callback, dueAt: this.currentMs + delayMs });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    const index = this.timers.findIndex((timer) => timer.handle === handle);
    if (index !== -1) this.timers.splice(index, 1);
  }

  setInterval(): TimerHandle {
    throw new Error("FakeClock.setInterval is not implemented; this test double is timer-only.");
  }

  clearInterval(): void {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is timer-only.");
  }
}
