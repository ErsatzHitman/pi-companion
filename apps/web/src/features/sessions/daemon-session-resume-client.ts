/**
 * Real `SessionResumeClient` adapter over a `DaemonClient`-shaped
 * object (T27B3, plan.md §7.4/§12.3), the resume-side counterpart of
 * `daemon-sessions-client.ts`'s create-side adapter.
 *
 * `DaemonAgentTimelineClient` is deliberately the narrowest possible
 * slice of `@picompanion/client`'s `DaemonClient` this feature needs —
 * `fetchAgent` and `fetchAgentTimeline` — so this module never has to
 * import `@picompanion/client` to stay structurally compatible with it
 * (matching `daemon-sessions-client.ts`'s precedent). A real
 * `DaemonClient` satisfies `DaemonAgentTimelineClient` as-is;
 * `daemon-session-resume-client.fixture.test.ts` proves that against
 * the real class and a recorded wire fixture.
 */
import { timeline as coreTimeline } from "@picompanion/frontend-core";

import { toSessionSummary } from "./daemon-sessions-client.js";
import type { DaemonAgentSnapshot } from "./daemon-sessions-client.js";
import type {
  SessionResumeClient,
  SessionResumeResult,
  SessionTimelinePayload,
} from "./session-resume-client.js";

/** The subset of `DaemonClient.fetchAgent`'s resolved value this feature reads. */
export interface DaemonFetchAgentResult {
  agent: DaemonAgentSnapshot;
}

export interface DaemonFetchAgentTimelineOptions {
  direction?: "tail" | "before" | "after";
  limit?: number;
}

export interface DaemonAgentTimelineClient {
  fetchAgent(agentId: string, requestId?: string): Promise<DaemonFetchAgentResult | null>;
  fetchAgentTimeline(
    agentId: string,
    options?: DaemonFetchAgentTimelineOptions,
  ): Promise<SessionTimelinePayload>;
}

/**
 * The initial page requested on resume/cold-open: the most recent
 * window, matching the reference CLI's own resume-style read
 * (`packages/cli/src/commands/agent/run.ts`'s `direction: "tail"`).
 * Gap backfill beyond this first page is `timeline.planGapBackfillRequest`'s
 * job (T20B), driven by whatever eventually owns a live connection to
 * this session — out of this task's "cold load" scope.
 */
const INITIAL_TIMELINE_OPTIONS: DaemonFetchAgentTimelineOptions = {
  direction: "tail",
  limit: 200,
};

/** Builds a `SessionResumeClient` backed by a real (or fixture-driven fake) `DaemonClient`. */
export function createDaemonSessionResumeClient(
  daemon: DaemonAgentTimelineClient,
): SessionResumeClient {
  return {
    async resumeSession(sessionId: string): Promise<SessionResumeResult> {
      const fetched = await daemon.fetchAgent(sessionId);
      if (!fetched?.agent) {
        // The reference backend rejects a missing agent with a payload
        // `error` (`"Agent not found: <id>"`) that `DaemonClient.fetchAgent`
        // throws for, so a real client should never actually resolve
        // `null` here — this only covers a fake/test client that does.
        throw new Error(`Agent not found: ${sessionId}`);
      }
      const session = toSessionSummary(fetched.agent);

      const timelinePayload = await daemon.fetchAgentTimeline(sessionId, INITIAL_TIMELINE_OPTIONS);
      const timeline = coreTimeline.ingestTimelineWindow(coreTimeline.createEmptyTimelineState(), {
        type: "fetch_agent_timeline_response",
        payload: timelinePayload,
      });

      return { session, timeline };
    },
  };
}
