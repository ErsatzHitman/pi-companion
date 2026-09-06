/**
 * Placeholder `SessionResumeClient` (T27B3), the resume-side
 * counterpart of `pending-connection-sessions-client.ts`.
 *
 * `apps/web`'s daemon connection is not yet wired end to end (see that
 * module's doc comment for the full rationale). Until a task wires a
 * real, host-scoped `SessionResumeClient` — a thin adapter over
 * `DaemonClient.fetchAgent`/`fetchAgentTimeline`, which
 * `daemon-session-resume-client.ts` already builds — this placeholder
 * is what `SessionResumeScreen` uses by default. It always rejects
 * with `SESSION_RESUME_NOT_CONNECTED`, which `explainSessionResumeError`
 * turns into a clear, non-crashing "not connected" explanation instead
 * of ever touching a daemon session directly (plan.md §12.3).
 */
import { SESSION_RESUME_NOT_CONNECTED, type SessionResumeClient } from "./session-resume-client.js";

export function createPendingConnectionSessionResumeClient(): SessionResumeClient {
  return {
    resumeSession() {
      return Promise.reject(new Error(SESSION_RESUME_NOT_CONNECTED));
    },
  };
}
