/**
 * Session resume state (T27B3, plan.md §7.4).
 *
 * On mount (and whenever `sessionId` changes or `retry()` is called),
 * fetches the session and its timeline through the injected
 * `SessionResumeClient`, then folds in this session's queued outbox
 * entries from the already-built `composer.OutboxController` (T22) —
 * together, "resume restores timeline and queue state" (T27B3's
 * acceptance criterion). Feeding a resumed session's own history into
 * `OutboxController` is what makes this a genuine cold open: a direct
 * `/h/:serverId/session/:agentId` URL with no prior app state (no list
 * fetch, no earlier navigation) still restores both.
 *
 * Mirrors `use-file-browser.ts`'s loading/ready/error shape and
 * stale-response guard (T30B1's precedent for this exact pattern), and
 * `use-composer.ts`'s `OutboxController` construction (T28B1) for the
 * queue half.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { Clock, StructuredStorage } from "@picompanion/frontend-core";
import { composer as coreComposer, timeline as coreTimeline } from "@picompanion/frontend-core";

import type {
  SessionResumeClient,
  SessionResumeErrorExplanation,
} from "./session-resume-client.js";
import { explainSessionResumeError } from "./session-resume-client.js";
import type { SessionSummary } from "./types.js";

export interface UseResumeSessionOptions {
  client: SessionResumeClient;
  sessionId: string;
  clock: Clock;
  structuredStorage: StructuredStorage;
}

export type SessionResumeStatus = "loading" | "ready" | "error";

export interface SessionResumeError extends SessionResumeErrorExplanation {
  /** The daemon's original, untranslated error message. */
  raw: string;
}

export interface SessionResumeState {
  sessionId: string;
  status: SessionResumeStatus;
  session: SessionSummary | null;
  timeline: coreTimeline.TimelineState | null;
  /** This session's queued outbox entries, oldest first (T27B3 "queue state"). */
  queue: readonly coreComposer.OutboxEntry[];
  error: SessionResumeError | null;
}

export interface SessionResumeController {
  state: SessionResumeState;
  /** Re-issues the resume request for the current `sessionId`. */
  retry: () => void;
}

function initialState(sessionId: string): SessionResumeState {
  return { sessionId, status: "loading", session: null, timeline: null, queue: [], error: null };
}

export function useResumeSession(options: UseResumeSessionOptions): SessionResumeController {
  const { client, sessionId, clock, structuredStorage } = options;
  const [state, setState] = useState<SessionResumeState>(() => initialState(sessionId));
  const requestIdRef = useRef(0);
  // Bumped by `retry()` to force a reload of an unchanged `sessionId`
  // even though it is not itself a new value the effect below reacts to.
  const [retryToken, setRetryToken] = useState(0);

  const outbox = useMemo(
    () => new coreComposer.OutboxController(structuredStorage, clock),
    [structuredStorage, clock],
  );

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState(initialState(sessionId));

    async function run(): Promise<void> {
      try {
        const result = await client.resumeSession(sessionId);
        const queue = await outbox.loadAll(sessionId);
        if (requestIdRef.current !== requestId) return;
        setState({
          sessionId,
          status: "ready",
          session: result.session,
          timeline: result.timeline,
          queue,
          error: null,
        });
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        const raw = error instanceof Error ? error.message : String(error);
        setState({
          sessionId,
          status: "error",
          session: null,
          timeline: null,
          queue: [],
          error: { ...explainSessionResumeError(raw), raw },
        });
      }
    }

    void run();
    // `retryToken` intentionally participates only to force a re-run;
    // its value is never read.
  }, [client, sessionId, outbox, retryToken]);

  return {
    state,
    retry: () => setRetryToken((token) => token + 1),
  };
}
