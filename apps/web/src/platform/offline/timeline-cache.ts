/**
 * The web console's timeline cache bridge (T393, plan.md §2.2/§12.5).
 *
 * `frontend-core` already owns the display-only cache (`offline.
 * OfflineCache`) and the "restore a stale tail before the daemon
 * answers" reducer (`timeline.restoreCachedTimeline`) — but nothing under
 * `apps/web/src` reached them, so a cold open with no daemon showed an
 * empty transcript even when the same browser had streamed that session
 * minutes earlier. This module is the missing half: it names the
 * collection, builds the snapshot the reducer wants, and keeps the
 * freshness bookkeeping honest.
 *
 * Two rules it exists to keep:
 *
 * - **A restore never re-stamps.** `loadTimelineCacheEnvelope` only
 *   reads, so the `cachedAt` a caller renders is the time the tail was
 *   last written, never "now" — an offline banner must say when the data
 *   was actually seen, not when it was displayed.
 * - **Only an authoritative window marks the cache caught up.**
 *   `cacheTimelineTail` writes a fresh (therefore `stale: true`) entry on
 *   every coalesced stream update; `confirmTimelineCatchUp` is the one
 *   call that follows a real `fetch_agent_timeline_response` window.
 *
 * Platform-shaped, not platform-free: it takes this app's
 * `StructuredStorage` and `Clock` and passes them straight through, so
 * the browser's own storage (`platform/storage.ts`) backs it.
 */
import { offline, timeline as coreTimeline } from "@picompanion/frontend-core";
import type { Clock } from "@picompanion/frontend-core";
import type { StructuredStorage } from "@picompanion/frontend-core";

/** The one collection every cached tail lives in. */
const TIMELINE_CACHE_COLLECTION = "offline/timeline";

/** A cache plus the storage it was built over; opaque to callers. */
export interface TimelineCache {
  readonly cache: offline.OfflineCache;
}

/** Builds the cache over the app's own structured storage and clock. */
export function createTimelineCache(storage: StructuredStorage, clock: Clock): TimelineCache {
  return { cache: new offline.OfflineCache(storage, clock, TIMELINE_CACHE_COLLECTION) };
}

/** One session's key. Sessions are independent; one must never overwrite another. */
export function timelineCacheKey(sessionId: string): string {
  return `session/${sessionId}/tail`;
}

/**
 * The cached snapshot for a state, or `null` when the state is not yet
 * worth caching (no epoch, or nothing ingested): writing an empty tail
 * would let a later restore claim "cached, 0 rows" and hide a perfectly
 * good live transcript behind an offline banner.
 */
function snapshotFor(
  state: coreTimeline.TimelineState,
): coreTimeline.CachedTimelineSnapshot | null {
  if (state.epoch === null || state.rows.length === 0) {
    return null;
  }
  return { epoch: state.epoch, rows: state.rows };
}

/**
 * Writes the current tail, returning the envelope (its `cachedAt` is the
 * write time). Never throws for an uncacheable state — it returns the
 * previous envelope, or `null`, so a caller's write path stays a
 * fire-and-forget.
 */
export async function cacheTimelineTail(
  cache: TimelineCache,
  sessionId: string,
  state: coreTimeline.TimelineState,
): Promise<offline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot> | null> {
  const snapshot = snapshotFor(state);
  if (snapshot === null) {
    return cache.cache.load<coreTimeline.CachedTimelineSnapshot>(timelineCacheKey(sessionId));
  }
  return cache.cache.save(timelineCacheKey(sessionId), snapshot);
}

/**
 * Reads the cached tail without touching its freshness bookkeeping. The
 * returned `cachedAt` is the last time a write happened, which is exactly
 * what an offline banner should show.
 */
export async function loadTimelineCacheEnvelope(
  cache: TimelineCache,
  sessionId: string,
): Promise<offline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot> | null> {
  return cache.cache.load<coreTimeline.CachedTimelineSnapshot>(timelineCacheKey(sessionId));
}

/**
 * Writes a just-ingested authoritative window and marks it caught up, so
 * the entry stops claiming staleness. Returns the resulting envelope; the
 * write happens first, and its envelope is the fallback when
 * `markCaughtUp` finds nothing to stamp (a cache cleared in between).
 */
export async function confirmTimelineCatchUp(
  cache: TimelineCache,
  sessionId: string,
  state: coreTimeline.TimelineState,
): Promise<offline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot> | null> {
  const key = timelineCacheKey(sessionId);
  const snapshot = snapshotFor(state);
  if (snapshot === null) {
    return cache.cache.markCaughtUp<coreTimeline.CachedTimelineSnapshot>(key);
  }
  const saved = await cache.cache.save(key, snapshot);
  return (await cache.cache.markCaughtUp<coreTimeline.CachedTimelineSnapshot>(key)) ?? saved;
}
