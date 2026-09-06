/**
 * Real `SessionsClient` adapter over a `DaemonClient`-shaped object
 * (T27B2, plan.md §7.1/§12.3).
 *
 * `DaemonAgentClient` is deliberately the narrowest possible slice of
 * `@picompanion/client`'s `DaemonClient` this feature needs — just
 * `createAgent` — so this module (like `features/files/file-browser-
 * client.ts`) never has to import `@picompanion/client` to stay
 * structurally compatible with it. A real `DaemonClient` satisfies
 * `DaemonAgentClient` as-is; `daemon-sessions-client.fixture.test.ts`
 * proves that against the real class and a recorded wire fixture.
 */
import type {
  CloneSessionInput,
  CloneSessionResult,
  CreateSessionInput,
  ForkSessionInput,
  ForkSessionResult,
  RenameSessionInput,
  RenameSessionResult,
  SessionsClient,
} from "./sessions-client.js";
import type { SessionStatus, SessionSummary } from "./types.js";

/**
 * The subset of `AgentSnapshotPayload`
 * (`@picompanion/protocol`'s `messages.ts`) this feature reads. A real
 * `AgentSnapshotPayload` has every one of these fields, so it satisfies
 * this type as-is.
 */
export interface DaemonAgentSnapshot {
  id: string;
  provider: string;
  cwd: string;
  status: SessionStatus;
  title: string | null;
  updatedAt: string;
  requiresAttention?: boolean;
  archivedAt?: string | null;
}

export interface DaemonAgentClient {
  createAgent(options: { provider: string; cwd: string }): Promise<DaemonAgentSnapshot>;
  /** Matches `DaemonClient.archiveAgent` (T27B4). */
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
  /** Matches `DaemonClient.deleteAgent` (T27B4). */
  deleteAgent(agentId: string): Promise<void>;
  /**
   * Matches `DaemonClient.fetchAgents` (T27B6). Deliberately only the
   * slice this feature needs: entries carrying an `agent` snapshot,
   * nothing about `project` placement or paging — a real `DaemonClient`
   * satisfies this as-is, same as every other method on this interface.
   */
  fetchAgents(options?: {
    filter?: { includeArchived?: boolean };
  }): Promise<{ entries: readonly { agent: DaemonAgentSnapshot }[] }>;
  /**
   * DISCLOSED GAP (T38A3): no such method exists on `@picompanion/client`'s
   * real `DaemonClient` today, and no browser-facing wire message backs
   * it either — verified: zero `fork_agent`/`clone_agent`/`agent.fork.`/
   * `agent.clone.` occurrences in `packages/protocol/src/messages.ts`,
   * and no `forkAgent`/`cloneAgent` method anywhere in
   * `packages/client/src/daemon-client.ts`.
   *
   * T38A0 (`packages/server/.../pi/rpc-types.ts`) only mirrored Pi's
   * `fork`/`clone`/`set_session_name` RPC commands for the *daemon's own*
   * use against its local Pi process (see that file's module comment) —
   * its Owns line scoped it to that one file, not to adding a
   * client-reachable wire message. T38A3's Owns line is
   * `apps/web/src/features/sessions/` only, so it cannot add one either.
   * Exactly this seam — a `fork_agent_request`/`fork_agent_response` (and
   * `clone_agent_request`/`clone_agent_response`) pair in
   * `packages/protocol/src/messages.ts`, a handler in
   * `packages/server/src/server/session.ts` that turns it into the Pi
   * provider's `PiRpcCommand` `"fork"`/`"clone"`, and a
   * `forkAgent`/`cloneAgent` method on `packages/client`'s `DaemonClient`
   * matching the shape below — is new work for a protocol+client task; a
   * natural owner is T51A (already auditing "what to carry" from the Pi
   * RPC mirror through to a real client-callable surface) or a follow-up
   * split from it, not a task scoped to `apps/web` alone.
   *
   * `forkAgent`/`cloneAgent` are declared OPTIONAL here (unlike
   * `archiveAgent`/`deleteAgent`/`fetchAgents` above, which the real
   * `DaemonClient` already implements) so that fact stays true after
   * this change: an object lacking these two methods — including a real
   * `DaemonClient` instance — still satisfies `DaemonAgentClient`
   * structurally, so `daemon-sessions-client.fixture.test.ts`'s "the
   * real `DaemonClient` satisfies this interface" claim keeps holding.
   * `createDaemonSessionsClient` below only exposes `forkSession`/
   * `cloneSession` when the injected `daemon` actually implements these
   * — until the wire message lands, that is never true for a real
   * `DaemonClient`, and callers see the same "not supported" path
   * `SESSIONS_ACTION_UNSUPPORTED` already gives archive/delete when a
   * client doesn't implement them.
   */
  forkAgent?(
    agentId: string,
    options: { entryId: string; entryIndex?: number; name?: string | null },
  ): Promise<{ agent: DaemonAgentSnapshot; forkPoint: { messageId: string; index: number } }>;
  /** See `forkAgent`'s doc — same disclosed gap, same optionality reasoning. */
  cloneAgent?(
    agentId: string,
    options?: { name?: string | null },
  ): Promise<{ agent: DaemonAgentSnapshot }>;
  /**
   * DISCLOSED GAP (T38A4): the same shape of gap as `forkAgent`/
   * `cloneAgent` above, checked the same way — zero
   * `rename_agent`/`set_session_name`/`agent.rename.`/`agent.title.set.`
   * occurrences in `packages/protocol/src/messages.ts` reachable from a
   * client, and no `renameAgent`/`setAgentTitle` method anywhere in
   * `packages/client/src/daemon-client.ts`. T38A0 mirrored Pi's
   * `set_session_name` RPC command
   * (`packages/server/.../pi/rpc-types.ts`) only for the daemon's own
   * use against its local Pi process; nothing turns it into a
   * client-reachable wire message yet, and this task's Owns line
   * (`apps/web/src/features/sessions/` only) cannot add one. Same
   * natural owner as `forkAgent`/`cloneAgent`'s gap: T51A or a
   * follow-up split from it.
   *
   * Declared OPTIONAL for the same reason as `forkAgent`/`cloneAgent`:
   * a real `DaemonClient` (which implements none of these three) must
   * keep satisfying `DaemonAgentClient` structurally.
   * `createDaemonSessionsClient` below only exposes `renameSession`
   * when the injected `daemon` actually implements this — never true
   * for a real `DaemonClient` today, so callers see the same
   * "not supported" path `SESSIONS_ACTION_UNSUPPORTED` already gives
   * archive/delete/fork/clone when a client doesn't implement them.
   */
  renameAgent?(agentId: string, options: { name: string }): Promise<{ agent: DaemonAgentSnapshot }>;
}

/**
 * Maps a `DaemonAgentSnapshot` to the feature's `SessionSummary` shape.
 * Exported (T27B3) so `daemon-session-resume-client.ts` can reuse it
 * rather than re-deriving the same mapping from the same source shape.
 */
export function toSessionSummary(agent: DaemonAgentSnapshot): SessionSummary {
  return {
    id: agent.id,
    title: agent.title,
    provider: agent.provider,
    cwd: agent.cwd,
    status: agent.status,
    ...(agent.requiresAttention !== undefined
      ? { requiresAttention: agent.requiresAttention }
      : {}),
    ...(agent.archivedAt !== undefined ? { archivedAt: agent.archivedAt } : {}),
    updatedAt: agent.updatedAt,
  };
}

/** Builds a `SessionsClient` backed by a real (or fixture-driven fake) `DaemonClient`. */
export function createDaemonSessionsClient(daemon: DaemonAgentClient): SessionsClient {
  return {
    async createSession(input: CreateSessionInput): Promise<SessionSummary> {
      const agent = await daemon.createAgent({ provider: input.provider, cwd: input.cwd });
      return toSessionSummary(agent);
    },
    async archiveSession(sessionId: string): Promise<{ archivedAt: string }> {
      return daemon.archiveAgent(sessionId);
    },
    async deleteSession(sessionId: string): Promise<void> {
      await daemon.deleteAgent(sessionId);
    },
    async fetchSessions(): Promise<SessionSummary[]> {
      // `includeArchived: true` so a reconcile never silently drops the
      // "Archived" group SessionList already renders (T27B4).
      const { entries } = await daemon.fetchAgents({ filter: { includeArchived: true } });
      return entries.map((entry) => toSessionSummary(entry.agent));
    },
    // T38A3: only exposed when `daemon` actually implements the
    // corresponding optional method — see `DaemonAgentClient.forkAgent`'s
    // doc above for why that is never true against a real `DaemonClient`
    // yet. `useForkCloneSession`/`SessionsScreen` fall back to
    // `SESSIONS_ACTION_UNSUPPORTED` when this member is absent, the same
    // way they already do for `archiveSession`/`deleteSession`.
    ...(daemon.forkAgent
      ? {
          async forkSession(
            sessionId: string,
            input: ForkSessionInput,
          ): Promise<ForkSessionResult> {
            const { agent, forkPoint } = await daemon.forkAgent!(sessionId, {
              entryId: input.entryId,
              entryIndex: input.entryIndex,
              name: input.name,
            });
            return { session: toSessionSummary(agent), forkPoint };
          },
        }
      : {}),
    ...(daemon.cloneAgent
      ? {
          async cloneSession(
            sessionId: string,
            input?: CloneSessionInput,
          ): Promise<CloneSessionResult> {
            const { agent } = await daemon.cloneAgent!(sessionId, { name: input?.name });
            return { session: toSessionSummary(agent) };
          },
        }
      : {}),
    // T38A4: only exposed when `daemon` actually implements
    // `renameAgent` — see that member's doc above for why that is
    // never true against a real `DaemonClient` yet.
    ...(daemon.renameAgent
      ? {
          async renameSession(
            sessionId: string,
            input: RenameSessionInput,
          ): Promise<RenameSessionResult> {
            const { agent } = await daemon.renameAgent!(sessionId, { name: input.name });
            return { session: toSessionSummary(agent) };
          },
        }
      : {}),
  };
}
