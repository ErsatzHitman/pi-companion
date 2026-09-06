import type { FetchAgentTimelineResponseMessage } from "@picompanion/protocol/messages";

import { timeline as coreTimeline } from "@picompanion/frontend-core";

import type {
  CreateSessionRequest,
  SessionListWindow,
  SessionOpenResult,
  SessionService,
  SessionStatus,
  SessionSummary,
} from "../features/sessions/sessions-model.js";

/**
 * Real `SessionService` adapter over a `DaemonClient`-shaped object —
 * T32S3, item (4)'s missing half. `../app-shell/core.ts` wires this behind
 * `AppCore.sessionService`, closing `sessions.tsx`'s "passes neither
 * `sessionService` nor `keyValueStorage`" defect for the `sessionService`
 * side (`../platform/key-value-storage.ts` already closed the other
 * side).
 *
 * Deliberately mirrors `apps/web/src/features/sessions/
 * daemon-sessions-client.ts` and `daemon-session-resume-client.ts`'s
 * already-proven pattern rather than inventing a new one: our own
 * repo's own working adapter for the very same protocol RPCs
 * (`createAgent`/`fetchAgent`/`fetchAgentTimeline`/`archiveAgent`/
 * `deleteAgent`), reused for consistency, not copied from Paseo (this
 * file, like that one, imports neither `@picompanion/client` nor
 * anything under `D:/paseo`). `DaemonSessionServiceClient` is
 * deliberately the narrowest possible slice of `@picompanion/client`'s
 * `DaemonClient` this file needs, exactly like web's `DaemonAgentClient`
 * — a real `DaemonClient` satisfies it as-is, structurally, with no
 * cast needed at the *type* level once a caller narrows
 * `connection.DaemonClientLifecycle.getDaemonClient()`'s wider-than-
 * needed-but-narrower-than-this `DaemonClientLike` down to it (see
 * `./daemon-session-service.test.ts` for the structural-compatibility
 * proof against a hand-rolled fake, and `../app-shell/core.ts`'s
 * `sessionService` doc comment for the one place a real cast happens
 * and why).
 *
 * One shape difference from web's precedent, because Android's
 * `SessionService.archiveSession` (`../features/sessions/
 * sessions-model.ts`) returns the session's full updated `SessionSummary`
 * where web's `SessionsClient.archiveSession` only returns
 * `{ archivedAt }`: the real `DaemonClient.archiveAgent` RPC itself only
 * ever resolves `{ archivedAt }` (`packages/client/src/daemon-client.ts`
 * — read, not modified), so this adapter's `archiveSession` makes a
 * second round-trip (`fetchAgent`) to hand back the full summary
 * `sessions-model.ts`'s interface promises, rather than fabricating the
 * unchanged fields locally.
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

/** `FetchAgentTimelineResponseMessage["payload"]` verbatim — matches web's `SessionTimelinePayload`. */
export type SessionTimelinePayload = FetchAgentTimelineResponseMessage["payload"];

export interface DaemonFetchAgentTimelineOptions {
  direction?: "tail" | "before" | "after";
  limit?: number;
}

/** The narrow session-transport seam this adapter needs from a real `DaemonClient`. */
export interface DaemonSessionServiceClient {
  createAgent(options: { provider: string; cwd: string }): Promise<DaemonAgentSnapshot>;
  fetchAgent(agentId: string, requestId?: string): Promise<{ agent: DaemonAgentSnapshot } | null>;
  fetchAgentTimeline(
    agentId: string,
    options?: DaemonFetchAgentTimelineOptions,
  ): Promise<SessionTimelinePayload>;
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
  deleteAgent(agentId: string): Promise<void>;
  /**
   * Matches `DaemonClient.fetchAgents` (`packages/client/src/
   * daemon-client.ts`'s `fetch_agents_request`/`fetch_agents_response`
   * RPC) — T32B6, item (2)'s addition. Deliberately only the slice this
   * adapter needs: entries carrying an `agent` snapshot plus
   * `pageInfo.hasMore`, nothing about `project` placement or cursors —
   * a real `DaemonClient` satisfies this as-is, structurally, same as
   * every other method on this interface. Mirrors `apps/web/src/
   * features/sessions/daemon-sessions-client.ts`'s `DaemonAgentClient
   * .fetchAgents` almost exactly; the one difference is this also reads
   * `pageInfo.hasMore` so `refreshSessions` below can report an honest
   * `SessionListWindow.complete` rather than assuming the page is the
   * whole list.
   */
  fetchAgents(options?: { filter?: { includeArchived?: boolean } }): Promise<{
    entries: readonly { agent: DaemonAgentSnapshot }[];
    pageInfo: { hasMore: boolean };
  }>;
}

/** Maps a `DaemonAgentSnapshot` to `sessions-model.ts`'s `SessionSummary` shape — matches web's `toSessionSummary`. */
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

/**
 * The initial page requested on open — the most recent window, matching
 * `apps/web/src/features/sessions/daemon-session-resume-client.ts`'s
 * identical constant and rationale (the reference CLI's own
 * `direction: "tail"` resume-style read). Gap backfill beyond this is
 * out of this adapter's scope, same as web's.
 */
const INITIAL_TIMELINE_OPTIONS: DaemonFetchAgentTimelineOptions = { direction: "tail", limit: 200 };

/**
 * Builds a `SessionService` backed by a real (or fake, in tests)
 * `DaemonSessionServiceClient`. `getClient` is called fresh on every
 * method invocation — not captured once — so this adapter always
 * reflects whichever daemon connection generation is live right now,
 * the same reactivity shape `../app-shell/resume-signals.ts` already uses for
 * `AppCore.network`/`AppCore.lifecycle`. `getClient()` returning `null`
 * (no active connection) rejects every method with a clear, dedicated
 * error rather than hanging or silently no-opping — this is a *real*
 * adapter's honest answer to "not connected", not a fake that pretends
 * to succeed (see `./network-reachability.ts`'s doc comment for the
 * same "real, not fake" framing applied to a different adapter).
 */
export function createDaemonSessionService(
  getClient: () => DaemonSessionServiceClient | null,
): SessionService {
  function requireClient(): DaemonSessionServiceClient {
    const client = getClient();
    if (!client) {
      throw new Error("Not connected to a daemon");
    }
    return client;
  }

  return {
    async createSession(request: CreateSessionRequest): Promise<SessionSummary> {
      const client = requireClient();
      const agent = await client.createAgent({ provider: request.provider, cwd: request.cwd });
      return toSessionSummary(agent);
    },

    async openSession(sessionId: string): Promise<SessionOpenResult> {
      const client = requireClient();
      const fetched = await client.fetchAgent(sessionId);
      if (!fetched?.agent) {
        // Matches the reference backend's `"Agent not found: <id>"`
        // payload `error` (see web's identical `daemon-session-resume-
        // client.ts` comment) — a real client should never actually
        // resolve `null` here; this only covers a fake/test client that
        // does.
        throw new Error(`Agent not found: ${sessionId}`);
      }
      const session = toSessionSummary(fetched.agent);

      const timelinePayload = await client.fetchAgentTimeline(sessionId, INITIAL_TIMELINE_OPTIONS);
      const timeline = coreTimeline.ingestTimelineWindow(coreTimeline.createEmptyTimelineState(), {
        type: "fetch_agent_timeline_response",
        payload: timelinePayload,
      });

      return { session, timeline };
    },

    async archiveSession(sessionId: string): Promise<SessionSummary> {
      const client = requireClient();
      await client.archiveAgent(sessionId);
      // `archiveAgent` only ever resolves `{ archivedAt }` (see module
      // doc) — refetch for the full `SessionSummary` this interface
      // promises rather than guessing the unchanged fields.
      const fetched = await client.fetchAgent(sessionId);
      if (!fetched?.agent) {
        throw new Error(`Agent not found: ${sessionId}`);
      }
      return toSessionSummary(fetched.agent);
    },

    async deleteSession(sessionId: string): Promise<void> {
      const client = requireClient();
      await client.deleteAgent(sessionId);
    },

    async refreshSessions(): Promise<SessionListWindow> {
      const client = requireClient();
      // `includeArchived: true` so a resync never silently drops the
      // "Archived" group the list already renders (matches web's
      // `daemon-sessions-client.ts#fetchSessions`).
      const { entries, pageInfo } = await client.fetchAgents({
        filter: { includeArchived: true },
      });
      return {
        sessions: entries.map((entry) => toSessionSummary(entry.agent)),
        complete: !pageInfo.hasMore,
      };
    },
  };
}
