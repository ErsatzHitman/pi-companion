/**
 * Session-list types (T27B1, plan.md §8.3 left session rail).
 *
 * `SessionSummary` mirrors the subset of the ported backend's
 * `AgentSnapshotPayload` (`@picompanion/protocol`, `agent_list` /
 * `fetch_agents_response`) that the session rail needs to render:
 * enough to group and label a row without pulling the whole daemon
 * wire type into `apps/web`. `packages/frontend-core`'s `sessions/`
 * domain is still a T14 skeleton stub (see its module doc) — this type
 * is the "core state" shape this task renders from until a later core
 * task (T27B2+) replaces it with a real adapter over `DaemonClient`.
 */

/** Mirrors `AGENT_LIFECYCLE_STATUSES` (`@picompanion/protocol`). */
export type SessionStatus = "initializing" | "idle" | "running" | "error" | "closed";

export interface SessionSummary {
  id: string;
  /** `null` before Pi assigns a title, as in the ported backend. */
  title: string | null;
  provider: string;
  cwd: string;
  status: SessionStatus;
  /** Mirrors `AgentSnapshotPayload.requiresAttention`. */
  requiresAttention?: boolean;
  /** Mirrors `AgentSnapshotPayload.archivedAt`; non-null means archived. */
  archivedAt?: string | null;
  /** ISO-8601 timestamp, mirrors `AgentSnapshotPayload.updatedAt`. */
  updatedAt: string;
}

/**
 * The session-list core state shape: a discriminated union so the
 * renderer never has to guess whether an empty list means "still
 * loading" or "loaded and empty".
 *
 * `stale` (T27B6, plan.md §7.4's "restore a stale cached tail without
 * marking it authoritative" invariant applied to the session rail):
 * true while the last-known `sessions` haven't been reconfirmed against
 * the daemon since a disconnect — e.g. a forced reconnect or a socket
 * that went silent. Defaults to `false`/absent for a state built from a
 * live, connected fetch. The renderer must surface this rather than
 * silently presenting a stale list as current.
 */
export type SessionListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sessions: readonly SessionSummary[]; stale?: boolean };
