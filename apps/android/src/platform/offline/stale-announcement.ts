/**
 * Pure, RN-free derivation of stale-cache announcement text (T37B,
 * plan.md §7.4 "restore a stale cached tail without marking it
 * authoritative" / §12.5 "cached timelines are marked stale until
 * authoritative catch-up completes").
 *
 * This task's third criterion, "Stale state is announced, not
 * colour-only," needs a screen to actually render — `platform/offline/`
 * (this task's whole grant) has none, and every screen that could host
 * one is unowned this wave (`features/sessions/`, `features/transcript/`)
 * or owned by a sibling building the app shell (`T32S6`). What this
 * module CAN and DOES do is make staleness a first-class, structured
 * piece of state — a reason plus the moment it went stale, not just a
 * boolean a renderer would have to reinterpret — and prove that a full
 * sentence (never a bare "Stale" label a colour swatch alone could
 * stand in for) is mechanically derivable from that state. See
 * `stale-announcement.test.ts` for the derivation proof, including
 * against real `TimelineState` produced by `./timeline-cache.ts` over
 * the shared `testing.loadRecordedSessionChapter("gapRecovery")`
 * fixture.
 *
 * `describeTimelineStaleness` reads `TimelineState`'s own `stale`/`gap`
 * fields (`@picompanion/frontend-core`'s `timeline` domain) —
 * `describeSessionListStaleness` reads `OfflineCache`'s own
 * `CacheEnvelope.stale`/`cachedAt`, matching the shape
 * `SessionListState.stale` (`apps/android/src/features/sessions/
 * sessions-model.ts`, T32B2) already carries a field for and
 * cross-references this task by name. Neither function renders
 * anything: the eventual screen (`features/sessions/`'s T32B6, wave
 * P5-W11, for the list; `features/transcript/` or `app-shell/` for the
 * open session) is expected to put this module's `text` into an
 * accessible live region or banner copy, and its own visual treatment
 * (a dot, an icon, a border tint) alongside it, never instead of it.
 */
import type { timeline as coreTimeline } from "@picompanion/frontend-core";

/** Why a piece of cached data is currently stale. */
export type StalenessReason =
  /** A gap in the confirmed rows is known and being backfilled (`TimelineState.gap`). */
  | "gap-backfill"
  /** Nothing is known to be missing, but the daemon has not confirmed this data since it was (re)loaded. */
  | "awaiting-catch-up";

/** Structured staleness state: a reason and the moment it began, not just a boolean. */
export interface StalenessAnnouncement {
  reason: StalenessReason;
  /** Epoch ms this data was last confirmed or saved, when known. `null` if not tracked by the caller. */
  since: number | null;
  /** A complete, human-readable sentence naming the actual state. Never a bare word a colour alone could substitute for. */
  text: string;
}

function formatElapsed(deltaMs: number): string {
  if (deltaMs < 0) {
    return "moments ago";
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return "moments ago";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface TimelineStalenessInput {
  stale: boolean;
  gap: coreTimeline.TimelineGap | null;
  /** `CacheEnvelope.cachedAt` for the tail this state was restored from, when known. */
  cachedAt?: number;
  /** Epoch ms "now", for relative-time phrasing. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * `null` when `input.stale` is `false` (nothing to announce).
 * Otherwise a `StalenessAnnouncement` naming why the timeline is stale
 * and, when `cachedAt` is supplied, how long ago it was last confirmed.
 */
export function describeTimelineStaleness(
  input: TimelineStalenessInput,
): StalenessAnnouncement | null {
  if (!input.stale) {
    return null;
  }
  const since = input.cachedAt ?? null;
  if (input.gap) {
    return {
      reason: "gap-backfill",
      since,
      text: "Catching up on missing messages before this view is up to date.",
    };
  }
  if (since !== null) {
    const now = input.now ?? Date.now();
    return {
      reason: "awaiting-catch-up",
      since,
      text: `Showing messages cached ${formatElapsed(now - since)} — confirming with the server.`,
    };
  }
  return {
    reason: "awaiting-catch-up",
    since: null,
    text: "Showing cached messages — confirming with the server.",
  };
}

export interface SessionListStalenessInput {
  stale: boolean;
  cachedAt?: number;
  now?: number;
}

/**
 * The session-list counterpart to `describeTimelineStaleness`, over the
 * coarser list-level `stale` flag `SessionListState` (T32B2) carries.
 * There is no gap concept at the list level, so `reason` is always
 * `"awaiting-catch-up"`.
 */
export function describeSessionListStaleness(
  input: SessionListStalenessInput,
): StalenessAnnouncement | null {
  if (!input.stale) {
    return null;
  }
  const since = input.cachedAt ?? null;
  if (since !== null) {
    const now = input.now ?? Date.now();
    return {
      reason: "awaiting-catch-up",
      since,
      text: `Showing your last known session list from ${formatElapsed(now - since)} — confirming with the server.`,
    };
  }
  return {
    reason: "awaiting-catch-up",
    since: null,
    text: "Showing your last known session list — confirming with the server.",
  };
}
