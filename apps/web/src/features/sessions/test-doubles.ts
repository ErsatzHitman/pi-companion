/**
 * Minimal in-memory `StructuredStorage`/`Clock` test doubles for this
 * feature's own tests only (never shipped behind a real code path).
 *
 * `frontend-core` keeps an equivalent pair local to its own `composer/`
 * domain rather than exporting it, and `features/composer/test-doubles.ts`
 * keeps its own tiny copy rather than reaching into
 * `packages/frontend-core/src` (per plan.md §3.3, apps depend on
 * package *exports*, never source-relative cross-workspace paths).
 * This feature keeps the same tiny copy for the same reason, since
 * `use-resume-session.ts` also drives an `OutboxController` to restore
 * queue state on resume.
 */
import type {
  Clock,
  StructuredStorage,
  StructuredStorageListOptions,
  TimerHandle,
} from "@picompanion/frontend-core";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryStructuredStorage implements StructuredStorage {
  private readonly backing = new Map<string, unknown>();

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
        if (options?.limit !== undefined && results.length >= options.limit) break;
      }
    }
    return results;
  }

  async clear(collection: string): Promise<void> {
    const prefix = `${collection}\u0000`;
    for (const key of this.backing.keys()) {
      if (key.startsWith(prefix)) this.backing.delete(key);
    }
  }
}

/** Deterministic, manually advanced `Clock` test double. */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }

  setTimeout(): TimerHandle {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }

  clearTimeout(): void {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }

  setInterval(): TimerHandle {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }

  clearInterval(): void {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}
