/**
 * Session-list reconciliation merge (T27B6, plan.md §7.4 "deduplicate by
 * epoch and sequence" applied to the session rail rather than the
 * timeline).
 *
 * The rail's `SessionListState` has no epoch/sequence of its own — a
 * session's identity is just its `id` — so reconciling a freshly fetched
 * authoritative list against whatever the rail already knows only needs
 * to be idempotent per id: applying the same (or an overlapping) fetch
 * more than once, in any order relative to optimistic local edits, must
 * never produce two rows for the same session.
 */
import type { SessionSummary } from "./types.js";

/**
 * Merges a freshly fetched, authoritative session list into the
 * currently known one.
 *
 * - A session present in both keeps its position from `current` but
 *   takes its field values from `fetched` (the daemon is authoritative
 *   once reconnected — a session that changed status, title, or
 *   attention while this client was disconnected must show the real
 *   value, not the last one this client happened to see).
 * - A session present only in `fetched` (new since the last known
 *   state, or created by another client while this one was
 *   disconnected) is appended.
 * - A session present only in `current` (no longer reported by the
 *   daemon — deleted elsewhere while this client was disconnected) is
 *   dropped.
 * - A duplicate id within `fetched` itself (defensive: should not
 *   happen) resolves to the last occurrence, mirroring how a Map
 *   would collapse it.
 *
 * Every id appears at most once in the result, regardless of how many
 * times overlapping pages/fetches are merged in — this is what keeps
 * gap-recovery idempotent (T27B6 "no duplicate rows appear after gap
 * recovery").
 */
export function mergeSessionList(
  current: readonly SessionSummary[],
  fetched: readonly SessionSummary[],
): SessionSummary[] {
  const fetchedById = new Map<string, SessionSummary>();
  for (const session of fetched) {
    fetchedById.set(session.id, session);
  }

  const merged: SessionSummary[] = [];
  const placed = new Set<string>();

  for (const session of current) {
    if (placed.has(session.id)) continue; // defensive: `current` itself should never carry a duplicate id
    const authoritative = fetchedById.get(session.id);
    if (authoritative) {
      merged.push(authoritative);
      placed.add(session.id);
    }
  }

  for (const session of fetchedById.values()) {
    if (placed.has(session.id)) continue;
    merged.push(session);
    placed.add(session.id);
  }

  return merged;
}
