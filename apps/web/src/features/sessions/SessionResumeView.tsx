import { timeline as coreTimeline } from "@picompanion/frontend-core";

import {
  Button,
  ErrorState,
  LoadingState,
  Section,
  StatusIndicator,
} from "../../ui/primitives/index.js";
import "./session-resume.css";
import { statusPresentation } from "./status-presentation.js";
import type { SessionResumeController } from "./use-resume-session.js";

export interface SessionResumeViewProps {
  serverId: string;
  agentId: string;
  controller: SessionResumeController;
}

/**
 * The `/h/:serverId/session/:agentId` screen body (T27B3, plan.md
 * §8.3): the route's own identity (host, session) above one of the
 * loading/error/ready states, composed entirely from `ui/primitives`
 * (plan.md §10.1 — no new one-off styled primitive here), matching
 * `features/terminal/terminal-route.tsx` and
 * `features/files/file-browser-view.tsx`'s precedent for this exact
 * shape.
 *
 * The ready state summarizes what resume restored (title, status,
 * restored message count, queued submission count) rather than
 * rendering the transcript itself — that is `features/transcript/`'s
 * separately owned surface (T28A*); this task's job stops at proving
 * "resume restores timeline and queue state" is true, not at
 * re-rendering it a second time.
 */
export function SessionResumeView({ serverId, agentId, controller }: SessionResumeViewProps) {
  const { state, retry } = controller;

  return (
    <Section title="Session" className="pc-session-resume">
      <dl className="pc-session-resume__params">
        <div>
          <dt>Host</dt>
          <dd>{serverId}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{agentId}</dd>
        </div>
      </dl>
      {state.status === "loading" ? (
        <LoadingState
          title="Resuming session…"
          description="Restoring the conversation and any queued messages."
          testId="session-resume-loading"
        />
      ) : null}
      {state.status === "error" && state.error ? (
        <div className="pc-session-resume__error">
          <ErrorState
            title={state.error.title}
            description={state.error.description}
            testId="session-resume-error"
          />
          <Button kind="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.status === "ready" && state.session && state.timeline ? (
        <SessionResumeSummary
          session={state.session}
          timeline={state.timeline}
          queue={state.queue}
        />
      ) : null}
    </Section>
  );
}

interface SessionResumeSummaryProps {
  session: NonNullable<SessionResumeController["state"]["session"]>;
  timeline: NonNullable<SessionResumeController["state"]["timeline"]>;
  queue: SessionResumeController["state"]["queue"];
}

function SessionResumeSummary({ session, timeline, queue }: SessionResumeSummaryProps) {
  const { tone, text } = statusPresentation(session);
  const messageCount = coreTimeline.buildTranscriptEntries(timeline).length;

  return (
    <div className="pc-session-resume__summary" data-testid="session-resume-ready">
      <h3 className="pc-session-resume__title">{session.title ?? "Untitled session"}</h3>
      <StatusIndicator label="Status" tone={tone} statusText={text} />
      <dl className="pc-session-resume__counts">
        <div>
          <dt>Messages restored</dt>
          <dd data-testid="session-resume-message-count">{messageCount}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd data-testid="session-resume-queue-count">{queue.length}</dd>
        </div>
      </dl>
    </div>
  );
}
