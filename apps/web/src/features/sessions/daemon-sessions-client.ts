/**
 * Real `SessionsClient` adapter over a `DaemonClient`-shaped object
 * (T27B2, plan.md §7.1/§12.3).
 *
 * `DaemonAgentClient` is deliberately the narrowest possible slice of
 * `@picompanion/client`'s `DaemonClient` this feature needs — `createAgent`,
 * `archiveAgent`, `deleteAgent`, `fetchAgents`, `forkAgent`, `cloneAgent`,
 * and `renameAgent` — so this module (like `features/files/file-browser-
 * client.ts`) never has to import `@picompanion/client` to stay
 * structurally compatible with it. A real `DaemonClient` satisfies
 * `DaemonAgentClient` as-is; `daemon-sessions-client.fixture.test.ts`
 * proves that against the real class and a recorded wire fixture.
 * CORRECTED (wire-apps-followup): this previously listed only through
 * `forkAgent`; the clone/rename halves have since landed and are required
 * here too.
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
   * Matches `DaemonClient.cloneAgent` (`agent.clone.request`/
   * `agent.clone.response` in `@picompanion/protocol`'s `messages.ts`,
   * handled by `packages/server/src/server/session.ts`).
   *
   * CORRECTED (wire-apps-followup): this previously disclosed T38A3's clone
   * half as an open gap — "no `cloneAgent` method exists on
   * `@picompanion/client`'s real `DaemonClient` today, and no
   * `clone_agent_request`/`clone_agent_response` wire message backs it" —
   * declared OPTIONAL so a real `DaemonClient` still satisfied this
   * interface. That seam has since landed, so `cloneAgent` is REQUIRED
   * here: every real `DaemonClient` implements it and
   * `createDaemonSessionsClient` below always exposes `cloneSession`.
   *
   * The `agent` nullability mirrors the wire's own failure shape
   * (`CloneAgentResponseMessageSchema` carries a null agent on failure):
   * a real `DaemonClient.cloneAgent` rejects with the daemon's error
   * before ever resolving that null, but the structural contract admits it
   * so the real class satisfies this interface as-is — `cloneSession`
   * below turns a null resolution into a rejected promise rather than
   * mapping it, the same way `forkSession` does for its own nulls.
   */
  cloneAgent(
    agentId: string,
    options?: { name?: string | null },
  ): Promise<{ agent: DaemonAgentSnapshot | null }>;
  /**
   * Matches `DaemonClient.renameAgent` (`agent.rename.request`/
   * `agent.rename.response` in `@picompanion/protocol`'s `messages.ts`,
   * handled by `packages/server/src/server/session.ts` via the daemon's
   * `set_session_name` path).
   *
   * CORRECTED (wire-apps-followup): this previously disclosed T38A4 as an
   * open gap — "zero `rename_agent`/`set_session_name`/`agent.rename.`/
   * `agent.title.set.` occurrences in `packages/protocol/src/messages.ts`
   * reachable from a client, and no `renameAgent`/`setAgentTitle` method
   * anywhere in `packages/client/src/daemon-client.ts`" — declared OPTIONAL
   * so a real `DaemonClient` still satisfied this interface. That seam has
   * since landed, so `renameAgent` is REQUIRED here: every real
   * `DaemonClient` implements it and `createDaemonSessionsClient` below
   * always exposes `renameSession`. (CORRECTED fork-agent-ui history
   * preserved: this previously named `forkAgent`/`cloneAgent` together as
   * the gap's shape; the fork half landed first and `forkAgent` above went
   * required then.)
   *
   * The `(agentId, name)` two-string shape matches the real
   * `DaemonClient.renameAgent` exactly (not the `{ name }` options object
   * this interface declared before the real method existed) so a real
   * `DaemonClient` satisfies this interface as-is. The `agent` nullability
   * mirrors the wire's own failure shape, same as `cloneAgent` above —
   * `renameSession` below turns a null resolution into a rejected promise
   * rather than mapping it.
   */
  renameAgent(agentId: string, name: string): Promise<{ agent: DaemonAgentSnapshot | null }>;
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
    // `forkSession`/`cloneSession`/`renameSession` are always exposed:
    // `DaemonAgentClient.forkAgent`/`cloneAgent`/`renameAgent` are all
    // REQUIRED (every wire has landed), so every injected `daemon` —
    // including a real `DaemonClient` — implements them. CORRECTED
    // (wire-apps-followup): `cloneSession`/`renameSession` were previously
    // conditional on the still-optional `cloneAgent`/`renameAgent`, falling
    // back to `SESSIONS_ACTION_UNSUPPORTED` when absent. That fallback now
    // survives only for partial fakes that omit them, never for a current
    // real client.
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
    async cloneSession(sessionId: string, input?: CloneSessionInput): Promise<CloneSessionResult> {
      const { agent } = await daemon.cloneAgent(sessionId, {
        // The wire's `name` is `string`-optional (absent means "no name");
        // a `null` name from `CloneSessionInput` is sent as absent, never as
        // a literal null the schema would reject — same mapping `forkSession`
        // above applies to its own `name`.
        ...(input?.name != null ? { name: input.name } : {}),
      });
      if (!agent) {
        throw new Error("Clone did not return a new session.");
      }
      return { session: toSessionSummary(agent) };
    },
    async renameSession(
      sessionId: string,
      input: RenameSessionInput,
    ): Promise<RenameSessionResult> {
      const { agent } = await daemon.renameAgent(sessionId, input.name);
      if (!agent) {
        throw new Error("Rename did not return a session.");
      }
      return { session: toSessionSummary(agent) };
    },
  };
}
