/**
 * Bridges `@picompanion/frontend-core`'s `offline.OfflineCache` (generic
 * display-only key/value cache) with its `timeline` domain, so a
 * session's timeline tail can be cached on-device and restored before a
 * daemon connection exists (T37B, plan.md §7.4 "restore a stale cached
 * tail without marking it authoritative" / §12.5 "cached timelines are
 * marked stale until authoritative catch-up completes").
 *
 * This module does not reimplement any dedupe, gap-detection, or
 * catch-up logic — all of that already lives in `frontend-core`'s
 * `timeline.ingestTimelineWindow` / `timeline.restoreCachedTimeline`
 * (T20A/T20B) and is proven there. What this module adds is purely the
 * plumbing to get a `TimelineState`'s confirmed rows into and back out
 * of this app's `SqliteStructuredStorage`-backed `OfflineCache`
 * (`./sqlite-structured-storage.ts`, T37A) — see
 * `timeline-cache.test.ts` for a full round trip against the shared
 * `testing.loadRecordedSessionChapter("gapRecovery")` fixture that
 * proves catch-up reconciles without duplicates through the REAL
 * reducer, not a local reimplementation of it.
 *
 * Two distinct "stale" signals are involved and deliberately not
 * collapsed into one:
 *
 * - `OfflineCache`'s own `CacheEnvelope.stale` (cache level): whether
 *   the persisted bytes have been confirmed since they were last
 *   written. `confirmTimelineCatchUp` below is the only thing in this
 *   module that clears it.
 * - `TimelineState.stale` (reducer level): whether the *in-memory*
 *   replica for the CURRENT app session has been reconciled with the
 *   daemon yet. `restoreCachedTimeline` unconditionally sets this
 *   `true` on every restore — even restoring an entry the cache level
 *   had already marked caught-up — because a freshly restored replica
 *   has not yet talked to the live daemon this run. Only
 *   `ingestTimelineWindow` clears it. This is `frontend-core`'s own
 *   contract (see `restoreCachedTimeline`'s doc comment), not something
 *   this module invents.
 *
 * ## What a mount site needs
 *
 * Nothing in this repository calls these functions yet.
 * `apps/android/src/features/sessions/sessions-model.ts` (T32B6, wave
 * P5-W11 — `features/sessions/` is unowned this wave, see this
 * repository's wave grants) already carries `SessionOpenState.ready`'s
 * `timeline: coreTimeline.TimelineState` field and cross-references
 * this task in its own doc comment for exactly this wiring: call
 * `restoreTimelineTail` when opening a session before the daemon
 * responds, and `confirmTimelineCatchUp` once a real
 * `fetch_agent_timeline_response` has been folded through
 * `timeline.ingestTimelineWindow`. `SessionListState`'s list-level
 * `stale?: boolean` (T32B2) is a separate, coarser flag for the session
 * list itself, not this module's concern.
 */
import { offline as coreOffline, timeline as coreTimeline } from "@picompanion/frontend-core";
import type { Clock, StructuredStorage } from "@picompanion/frontend-core";

/**
 * `OfflineCache` collection name for cached timeline tails, distinct
 * from `sqlite-structured-storage.ts`'s default collection so a
 * session id used as a timeline-cache key never collides with an
 * unrelated cache entry (e.g. a cached session-list row) reusing the
 * same id string.
 */
export const TIMELINE_SNAPSHOT_COLLECTION = "offline/timeline-snapshot";

/** Constructs the `OfflineCache` this module's functions expect, over the given storage/clock. */
export function createTimelineCache(
  storage: StructuredStorage,
  clock: Clock,
): coreOffline.OfflineCache {
  return new coreOffline.OfflineCache(storage, clock, TIMELINE_SNAPSHOT_COLLECTION);
}

/**
 * Persists the confirmed rows of `state` (its "server replica" —
 * `state.rows`, deliberately excluding `state.pendingRows`, which are
 * local optimistic submissions per plan.md §7.2's split and do not
 * belong in a cache meant to be replayed as a daemon-confirmed tail) as
 * the cached tail for `sessionId`. Per `OfflineCache.save`'s own
 * contract, this always leaves the cache-level entry flagged stale:
 * newly saved data — even data that was itself just confirmed — must be
 * reconfirmed by a fresh caller before it can be trusted again.
 */
export async function cacheTimelineTail(
  cache: coreOffline.OfflineCache,
  sessionId: string,
  state: coreTimeline.TimelineState,
): Promise<coreOffline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot>> {
  if (state.epoch === null) {
    throw new Error("cacheTimelineTail: cannot cache a timeline with no epoch yet");
  }
  const snapshot: coreTimeline.CachedTimelineSnapshot = {
    epoch: state.epoch,
    rows: state.rows,
  };
  return cache.save(sessionId, snapshot);
}

/**
 * Restores the cached tail for `sessionId` as a `TimelineState`, or
 * `null` if nothing is cached. Delegates entirely to
 * `timeline.restoreCachedTimeline`, so the returned state's `stale` is
 * always `true` and its `gap` is recomputed from the restored rows —
 * this function adds no staleness logic of its own.
 */
export async function restoreTimelineTail(
  cache: coreOffline.OfflineCache,
  sessionId: string,
): Promise<coreTimeline.TimelineState | null> {
  const envelope = await cache.load<coreTimeline.CachedTimelineSnapshot>(sessionId);
  if (!envelope) {
    return null;
  }
  return coreTimeline.restoreCachedTimeline(envelope.data);
}

/**
 * Loads the raw cache envelope for `sessionId` (not run through
 * `restoreCachedTimeline`), so a caller can read cache-level
 * bookkeeping — `cachedAt`, `stale` — directly, e.g. to feed
 * `./timeline-staleness-announcement.ts`'s `cachedAt` input.
 */
export async function loadTimelineCacheEnvelope(
  cache: coreOffline.OfflineCache,
  sessionId: string,
): Promise<coreOffline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot> | null> {
  return cache.load<coreTimeline.CachedTimelineSnapshot>(sessionId);
}

/**
 * Call once `state` has been reconciled against the daemon (i.e. after
 * folding an authoritative `fetch_agent_timeline_response` through
 * `timeline.ingestTimelineWindow`, which is the only thing that clears
 * `TimelineState.stale`). Persists the reconciled rows and marks the
 * cache-level entry caught up in one step, so a subsequent restore's
 * `CacheEnvelope.stale` reads `false` until the next `cacheTimelineTail`
 * call re-flags it.
 *
 * Throws if `state.stale` is still `true` — that would desynchronize
 * "the daemon confirmed this" (cache level) from "the daemon actually
 * confirmed this" (reducer level), which is exactly the bug this
 * module exists to prevent. Never call this with a merely-restored or
 * optimistic state.
 */
export async function confirmTimelineCatchUp(
  cache: coreOffline.OfflineCache,
  sessionId: string,
  state: coreTimeline.TimelineState,
): Promise<coreOffline.CacheEnvelope<coreTimeline.CachedTimelineSnapshot>> {
  if (state.stale) {
    throw new Error(
      "confirmTimelineCatchUp: state.stale is still true — fold an authoritative " +
        "fetch_agent_timeline_response through timeline.ingestTimelineWindow before confirming catch-up",
    );
  }
  await cacheTimelineTail(cache, sessionId, state);
  const confirmed = await cache.markCaughtUp<coreTimeline.CachedTimelineSnapshot>(sessionId);
  if (!confirmed) {
    // Unreachable in practice: cacheTimelineTail above just wrote this
    // exact key. Guarded rather than asserted with `!` so a future
    // refactor that reorders these two calls fails loudly instead of
    // silently returning stale-but-typed-as-fresh data.
    throw new Error(
      `confirmTimelineCatchUp: no cache entry found for "${sessionId}" right after saving it`,
    );
  }
  return confirmed;
}
