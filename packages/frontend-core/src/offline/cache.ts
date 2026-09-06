/**
 * Display-only offline cache (plan.md §7.1, §12.5).
 *
 * "The daemon remains authoritative. Local cache is display-only... Cached
 * timelines are marked stale until authoritative catch-up completes."
 *
 * `OfflineCache` is a generic, platform-neutral key/value envelope store
 * on top of `StructuredStorage`. It is deliberately not specific to the
 * timeline: any domain that wants "show something immediately from disk,
 * but never claim it is authoritative until told so" (timeline pages,
 * session lists, and so on) can use the same envelope shape.
 *
 * Every entry carries a `stale` flag. It starts `true` the moment data
 * is saved (or re-saved) and is loaded as `true` until the owning
 * domain explicitly calls `markCaughtUp` once it has confirmed the
 * cached data against the daemon. There is no code path in this module
 * that clears `stale` on its own — only `markCaughtUp` does, and only
 * in response to an explicit caller decision.
 */

import type { Clock } from "../platform/clock.js";
import type { StructuredStorage } from "../platform/storage.js";

/** A cached value plus its freshness bookkeeping. */
export interface CacheEnvelope<T> {
  data: T;
  /** Epoch milliseconds when this value was last saved. */
  cachedAt: number;
  /**
   * `true` until the owning domain calls `markCaughtUp` for this key
   * after confirming the cache against the daemon. Every freshly saved
   * or restored-after-restart entry starts `true`.
   */
  stale: boolean;
}

const DEFAULT_COLLECTION = "offline/cache";

/**
 * Generic display-only cache. Never used as a source of truth by
 * anything in `frontend-core` beyond "render this immediately, flagged
 * stale" — reconciling it against authoritative daemon state is the
 * caller's (timeline/session domain's) responsibility.
 */
export class OfflineCache {
  private readonly storage: StructuredStorage;
  private readonly clock: Clock;
  private readonly collection: string;

  constructor(storage: StructuredStorage, clock: Clock, collection: string = DEFAULT_COLLECTION) {
    this.storage = storage;
    this.clock = clock;
    this.collection = collection;
  }

  /**
   * Loads the cached envelope for `key`, or `null` if nothing is
   * cached. The `stale` flag reflects whatever was last persisted:
   * `true` for anything saved via `save` and not since confirmed with
   * `markCaughtUp`, which is exactly the "flagged stale until
   * authoritative catch-up" behavior — including immediately after a
   * simulated restart, since staleness is persisted, not held only in
   * memory.
   */
  async load<T>(key: string): Promise<CacheEnvelope<T> | null> {
    return this.storage.get<CacheEnvelope<T>>(this.collection, key);
  }

  /**
   * Saves `data` for `key`. Always resets `stale` to `true`: new data
   * from any non-authoritative source (an optimistic write, a partial
   * reconnect snapshot) must be re-confirmed before it can be trusted.
   */
  async save<T>(key: string, data: T): Promise<CacheEnvelope<T>> {
    const envelope: CacheEnvelope<T> = {
      data,
      cachedAt: this.clock.now(),
      stale: true,
    };
    await this.storage.put(this.collection, key, envelope);
    return envelope;
  }

  /**
   * The only way to clear `stale` for `key`. Call this once the owning
   * domain has authoritative confirmation (for example, a completed
   * `fetch_agent_timeline_request` catch-up) that the cached data is
   * current. No-op if nothing is cached for `key`.
   */
  async markCaughtUp<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const envelope = await this.storage.get<CacheEnvelope<T>>(this.collection, key);
    if (!envelope) {
      return null;
    }
    const next: CacheEnvelope<T> = { ...envelope, stale: false };
    await this.storage.put(this.collection, key, next);
    return next;
  }

  /**
   * Explicitly re-flags a previously caught-up entry as stale, for
   * example after the connection drops again. No-op if nothing is
   * cached for `key`.
   */
  async markStale<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const envelope = await this.storage.get<CacheEnvelope<T>>(this.collection, key);
    if (!envelope) {
      return null;
    }
    const next: CacheEnvelope<T> = { ...envelope, stale: true };
    await this.storage.put(this.collection, key, next);
    return next;
  }

  /** Removes the cached entry for `key`. Safe to call when none exists. */
  async clear(key: string): Promise<void> {
    await this.storage.delete(this.collection, key);
  }
}
