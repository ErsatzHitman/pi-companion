import type { SessionSummary } from "./types.js";

/**
 * Session-list grouping (T27B1 acceptance: "Sessions render grouped
 * with status shown in text as well as colour"). A session's *group*
 * and its per-row `StatusIndicator` text are deliberately separate
 * signals: the group answers "does this need my attention", the row
 * answers "what is Pi doing right now".
 */
export type SessionGroupKind = "needs-attention" | "active" | "idle" | "archived";

const GROUP_ORDER: readonly SessionGroupKind[] = ["needs-attention", "active", "idle", "archived"];

const GROUP_LABEL: Record<SessionGroupKind, string> = {
  "needs-attention": "Needs attention",
  active: "Active",
  idle: "Idle",
  archived: "Archived",
};

export interface SessionGroup {
  kind: SessionGroupKind;
  label: string;
  sessions: readonly SessionSummary[];
}

/**
 * Categorizes a single session. Archived always wins (an archived
 * session's live `status` is no longer actionable); otherwise a session
 * needing attention or in an `error` status is surfaced above ordinary
 * active/idle sessions.
 */
export function categorizeSession(session: SessionSummary): SessionGroupKind {
  if (session.archivedAt) return "archived";
  if (session.requiresAttention || session.status === "error") return "needs-attention";
  if (session.status === "running" || session.status === "initializing") return "active";
  return "idle";
}

/**
 * Groups sessions in a fixed, stable order and drops empty groups so
 * the rail never shows a "Closed (0)" heading. Within a group, sessions
 * are sorted most-recently-updated first.
 */
export function groupSessions(sessions: readonly SessionSummary[]): SessionGroup[] {
  const buckets = new Map<SessionGroupKind, SessionSummary[]>(
    GROUP_ORDER.map((kind) => [kind, []]),
  );

  for (const session of sessions) {
    buckets.get(categorizeSession(session))?.push(session);
  }

  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    sessions: [...(buckets.get(kind) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })).filter((group) => group.sessions.length > 0);
}
