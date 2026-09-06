/**
 * Session resume wire shapes and client contract (T27B3, plan.md
 * §7.4/§12.3, extending `sessions-client.ts`'s "open" half with
 * "resume an existing session, including opening cold from a direct
 * URL").
 *
 * Resuming a session (in this feature's sense — reopening one the
 * daemon already knows about, whether from the list or from a
 * bookmarked/typed `/h/:serverId/session/:agentId` URL with no prior
 * app state) is two daemon round-trips: `DaemonClient.fetchAgent`
 * (`fetch_agent_request`/`fetch_agent_response`) for the current
 * snapshot, then `DaemonClient.fetchAgentTimeline`
 * (`fetch_agent_timeline_request`/`fetch_agent_timeline_response`) for
 * its history, folded into a `TimelineState` through
 * `@picompanion/frontend-core`'s already-built, framework-neutral
 * timeline reducer (`timeline.ingestTimelineWindow`) — this feature
 * never reimplements timeline ingestion. `SessionTimelinePayload` is
 * `FetchAgentTimelineResponseMessage["payload"]` verbatim (imported
 * from `@picompanion/protocol`, not `@picompanion/client`, matching
 * `sessions-client.ts`/`file-browser-client.ts`'s precedent of not
 * depending on `@picompanion/client` to stay structurally compatible
 * with it), so a real `DaemonClient.fetchAgentTimeline` result needs no
 * translation before reaching `ingestTimelineWindow`.
 *
 * This module intentionally stops at producing a `SessionSummary` plus
 * a `TimelineState`; rendering that state (the transcript UI) belongs
 * to the separately owned `features/transcript/` tasks.
 */
import type { FetchAgentTimelineResponseMessage } from "@picompanion/protocol/messages";

import type { timeline as coreTimeline } from "@picompanion/frontend-core";

import type { SessionSummary } from "./types.js";

/** `FetchAgentTimelineResponseMessage["payload"]` verbatim — see module doc. */
export type SessionTimelinePayload = FetchAgentTimelineResponseMessage["payload"];

export interface SessionResumeResult {
  session: SessionSummary;
  /**
   * The session's timeline, already folded through
   * `timeline.ingestTimelineWindow` from an empty `TimelineState`. Feed
   * this to `timeline.buildTranscriptEntries`/`buildTranscriptView` to
   * render it.
   */
  timeline: coreTimeline.TimelineState;
}

export interface SessionResumeClient {
  /**
   * Resumes `sessionId`. Rejects with an `Error` whose `message` is the
   * daemon's raw explanation on failure — including the reference
   * backend's `"Agent not found: <id>"` (see
   * `packages/server/src/server/session.ts`'s `handleFetchAgent`) for a
   * session that does not exist, which `explainSessionResumeError`
   * turns into a clear, dedicated message.
   */
  resumeSession(sessionId: string): Promise<SessionResumeResult>;
}

/**
 * Sentinel error message used by
 * `createPendingConnectionSessionResumeClient` (this feature's
 * stand-in client, used until a live app-wide `DaemonClient` is wired
 * through `apps/web/src/app/core-context.tsx`, matching
 * `sessions-client.ts`'s `SESSIONS_NOT_CONNECTED` precedent) so
 * `explainSessionResumeError` can give it a dedicated explanation.
 */
export const SESSION_RESUME_NOT_CONNECTED = "SESSION_RESUME_NOT_CONNECTED";

export interface SessionResumeErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw daemon (or placeholder-client) error message to a title
 * and description a user can act on (T27B3's "resuming a missing
 * session fails with a clear message" acceptance criterion).
 */
export function explainSessionResumeError(rawMessage: string): SessionResumeErrorExplanation {
  const message = rawMessage.trim();

  if (message === SESSION_RESUME_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon before resuming this session.",
    };
  }
  if (/agent not found/i.test(message) || /^enoent\b/i.test(message)) {
    return {
      title: "This session doesn't exist",
      description: "It may have been deleted, or the link is no longer valid.",
    };
  }
  return {
    title: "Couldn't resume this session",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}
