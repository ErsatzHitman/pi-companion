/**
 * Real `SessionsClient` adapter over a `DaemonClient`-shaped object
 * (T27B2, plan.md §7.1/§12.3).
 *
 * `DaemonAgentClient` is deliberately the narrowest possible slice of
 * `@picompanion/client`'s `DaemonClient` this feature needs — `createAgent`,
 * `archiveAgent`, `deleteAgent`, `fetchAgents`, and `forkAgent` — so this
 * module (like `features/files/file-browser-client.ts`) never has to import
 * `@picompanion/client` to stay structurally compatible with it. A real
 * `DaemonClient` satisfies `DaemonAgentClient` as-is;
 * `daemon-sessions-client.fixture.test.ts` proves that against the real
 * class and a recorded wire fixture.
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
import type { SessionMode, SessionStatus, SessionSummary, SessionUsage } from "./types.js";

/**
 * The subset of `AgentSnapshotPayload`
 * (`@picompanion/protocol`'s `messages.ts`) this feature reads. A real
 * `AgentSnapshotPayload` has every one of these fields, so it satisfies
 * this type as-is.
 *
 * `model`, `currentModeId` and `availableModes` mirror the wire schema's
 * own non-optional fields (they are `string | null` / an array on every
 * snapshot); `thinkingOptionId` and `lastUsage` mirror the schema's
 * optional ones, so this type stays satisfiable by every snapshot a real
 * daemon emits, not only the ones that carry a provider-side thinking
 * level or a usage report yet.
 */
export interface DaemonAgentSnapshot {
  id: string;
  provider: string;
  cwd: string;
  status: SessionStatus;
  title: string | null;
  updatedAt: string;
  model: string | null;
  currentModeId: string | null;
  availableModes: readonly SessionMode[];
  thinkingOptionId?: string | null;
  lastUsage?: SessionUsage;
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
   * Matches `DaemonClient.forkAgent` (`agent.fork.request`/
   * `agent.fork.response` in `@picompanion/protocol`'s `messages.ts`,
   * handled by `packages/server/src/server/session.ts`).
   *
   * CORRECTED (fork-agent-ui): this previously disclosed T38A3's gap — no
   * `forkAgent`/`cloneAgent` method on the real `DaemonClient` and no
   * `fork_agent`/`clone_agent`/`agent.fork.`/`agent.clone.` wire message —
   * with both members optional so a real `DaemonClient` still satisfied
   * this interface. The fork half of that seam has since landed, so
   * `forkAgent` is REQUIRED here: every real `DaemonClient` implements it
   * and `createDaemonSessionsClient` below always exposes `forkSession`.
   * `cloneAgent` below stays optional until its own wire message lands.
   *
   * The `agent`/`forkPoint` nullability mirrors the wire's own failure shape
   * (`ForkAgentResponseMessageSchema` carries a null agent and forkPoint on
   * failure): a real `DaemonClient.forkAgent` rejects with the daemon's error
   * before ever resolving those nulls, but the structural contract admits them
   * so the real class satisfies this interface as-is — `forkSession` below
   * turns a null resolution into a rejected promise rather than mapping it.
   */
  forkAgent(
    agentId: string,
    options: { entryId: string; entryIndex?: number; name?: string | null },
  ): Promise<{
    agent: DaemonAgentSnapshot | null;
    forkPoint: { messageId: string; index: number } | null;
  }>;
  /**
   * DISCLOSED GAP (T38A3, clone half — still open): no `cloneAgent` method
   * exists on `@picompanion/client`'s real `DaemonClient` today, and no
   * `clone_agent_request`/`clone_agent_response` wire message backs it —
   * the fork half of T38A3's original gap has landed (`forkAgent` above is
   * now required), the clone half has not. Declared OPTIONAL so a real
   * `DaemonClient` (which implements everything above plus `forkAgent`,
   * but not this) still satisfies `DaemonAgentClient` structurally.
   * `createDaemonSessionsClient` below only exposes `cloneSession` when the
   * injected `daemon` actually implements this.
   */
  cloneAgent?(
    agentId: string,
    options?: { name?: string | null },
  ): Promise<{ agent: DaemonAgentSnapshot }>;
  /**
   * DISCLOSED GAP (T38A4): the same shape of gap as `cloneAgent` above,
   * checked the same way — zero
   * `rename_agent`/`set_session_name`/`agent.rename.`/`agent.title.set.`
   * occurrences in `packages/protocol/src/messages.ts` reachable from a
   * client, and no `renameAgent`/`setAgentTitle` method anywhere in
   * `packages/client/src/daemon-client.ts`. T38A0 mirrored Pi's
   * `set_session_name` RPC command
   * (`packages/server/.../pi/rpc-types.ts`) only for the daemon's own
   * use against its local Pi process; nothing turns it into a
   * client-reachable wire message yet, and this task's Owns line
   * (`apps/web/src/features/sessions/` only) cannot add one. Same
   * natural owner as `cloneAgent`'s gap: T51A or a
   * follow-up split from it. (CORRECTED fork-agent-ui: this previously
   * named `forkAgent`/`cloneAgent` together as the gap's shape; the fork
   * half has since landed and `forkAgent` above is now required.)
   *
   * Declared OPTIONAL for the same reason as `cloneAgent`:
   * a real `DaemonClient` (which implements everything above including
   * `forkAgent`, but neither of these two) must
   * keep satisfying `DaemonAgentClient` structurally.
   * `createDaemonSessionsClient` below only exposes `renameSession`
   * when the injected `daemon` actually implements this — never true
   * for a real `DaemonClient` today, so callers see the same
   * "not supported" path `SESSIONS_ACTION_UNSUPPORTED` already gives
   * clone/rename when a client doesn't implement them.
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
    model: agent.model,
    currentModeId: agent.currentModeId,
    availableModes: agent.availableModes,
    ...(agent.thinkingOptionId !== undefined ? { thinkingOptionId: agent.thinkingOptionId } : {}),
    ...(agent.lastUsage !== undefined ? { lastUsage: agent.lastUsage } : {}),
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
    // `forkSession` is always exposed: `DaemonAgentClient.forkAgent` is
    // REQUIRED (the fork wire has landed), so every injected `daemon` —
    // including a real `DaemonClient` — implements it. `cloneSession` below
    // stays conditional on the still-optional `cloneAgent`.
    // `useForkCloneSession`/`SessionsScreen` still fall back to
    // `SESSIONS_ACTION_UNSUPPORTED` for the clone path when that member is
    // absent, the same way they already do for `renameSession`.
    async forkSession(sessionId: string, input: ForkSessionInput): Promise<ForkSessionResult> {
      const { agent, forkPoint } = await daemon.forkAgent(sessionId, {
        entryId: input.entryId,
        entryIndex: input.entryIndex,
        // The wire's `name` is `string`-optional (absent means "no name");
        // a `null` name from `ForkSessionInput` is sent as absent, never as
        // a literal null the schema would reject.
        ...(input.name != null ? { name: input.name } : {}),
      });
      if (!agent || !forkPoint) {
        throw new Error("Fork did not return a new session.");
      }
      return { session: toSessionSummary(agent), forkPoint };
    },
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
