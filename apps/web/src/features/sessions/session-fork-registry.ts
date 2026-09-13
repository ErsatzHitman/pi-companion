import type { SessionRelationship } from "./session-tree-state.js";

/**
 * Transcript-fork relationship registry (fork-lands-as-root close).
 *
 * `SessionsScreen.handleForked` owns the tree placement for forks started
 * from the session list (`useForkCloneSession`): it records a
 * `SessionRelationship` and `buildSessionTree` puts the new session under
 * its real parent. Forks started from the transcript
 * (`features/transcript/use-edit-from-here.ts` via
 * `routes/screens/host-session-screen.tsx`) used to land as roots there,
 * because that screen never told this one about them and the daemon's
 * `fetch_agents_response` carries no parent field to backfill from.
 *
 * This module is the shared owner both screens write through: the session
 * route records every transcript fork here at the moment it resolves, and
 * `SessionsScreen` seeds its own `relationships` state from here on mount
 * (and records its own list-level forks here too, so a reload still sees
 * them once the daemon list includes the new agent). In-memory only, like
 * `SessionsScreen`'s own state before it — a reload without daemon
 * lineage still renders roots, which `session-tree-state.ts` already
 * discloses.
 */

const recorded = new Map<string, SessionRelationship>();

export function recordForkRelationship(
  newSessionId: string,
  relationship: SessionRelationship,
): void {
  recorded.set(newSessionId, relationship);
}

export function getRecordedRelationships(): ReadonlyMap<string, SessionRelationship> {
  return new Map(recorded);
}

export function clearRecordedRelationshipsForTests(): void {
  recorded.clear();
}
