import { timeline as coreTimeline } from "@picompanion/frontend-core";

import { Button, ErrorState, LoadingState } from "../../ui/primitives/index.js";
import "./session-resume.css";
import { sessionModeLabel, sessionModelChipLabel } from "./session-meta.js";
import { SessionStatusPill } from "./session-status-pill.js";
import type { SessionSummary } from "./types.js";
import type { SessionResumeController } from "./use-resume-session.js";

export interface SessionResumeViewProps {
  serverId: string;
  agentId: string;
  controller: SessionResumeController;
}

/**
 * The `/h/:serverId/session/:agentId` screen body (T27B3, plan.md
 * §8.3): the session's own head row above one of the loading/error/
 * ready states, composed entirely from `ui/primitives` plus this
 * feature's own head pieces (plan.md §10.1 — no new one-off styled
 * primitive here), matching `features/terminal/terminal-route.tsx` and
 * `features/files/file-browser-view.tsx`'s precedent for this exact
 * shape.
 *
 * The head row (title, status pill, model/effort and mode chips) is
 * deliberately read-only and sourced only from the resumed snapshot's
 * real fields: a chip whose value the daemon does not report is omitted
 * rather than filled with a placeholder. The restored-message/queued
 * facts stay in the head as a compact sub-line, keeping the
 * `session-resume-ready` test id (and its two count test ids) several
 * Playwright specs wait on.
 */
export function SessionResumeView({ controller }: SessionResumeViewProps) {
  const { state, retry } = controller;
  const session = state.session;

  // T386: the reference's main column opens with its own head row
  // (`.main-head`) and nothing else — no `Section` heading above it and no
  // Host/Session definition list, both of which used to duplicate facts the
  // URL already carries. The head row draws the title, the status pill and
  // the model/mode chips; the host and session ids stay reachable through
  // the address bar and the diagnostics route.
  return (
    <div className="pc-session-resume">
      {session ? (
        <SessionHead session={session} timeline={state.timeline} queue={state.queue} />
      ) : null}
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
    </div>
  );
}

interface SessionHeadProps {
  session: SessionSummary;
  timeline: SessionResumeController["state"]["timeline"];
  queue: SessionResumeController["state"]["queue"];
}

function SessionHead({ session, timeline, queue }: SessionHeadProps) {
  const modelChip = sessionModelChipLabel(session);
  const modeChip = sessionModeLabel(session);
  const messageCount = timeline ? coreTimeline.buildTranscriptEntries(timeline).length : null;

  return (
    <div className="pc-session-head" data-testid="session-head">
      <div className="pc-session-head__main">
        <h3 className="pc-session-head__title">{session.title ?? "Untitled session"}</h3>
        {timeline ? (
          <p className="pc-session-head__facts" data-testid="session-resume-ready">
            <span data-testid="session-resume-message-count">{messageCount}</span> messages restored
            <span aria-hidden="true"> · </span>
            <span data-testid="session-resume-queue-count">{queue.length}</span> queued
          </p>
        ) : null}
      </div>
      <SessionStatusPill session={session} testId="session-head-status" />
      {modelChip || modeChip ? (
        <div className="pc-session-head__right">
          {modelChip ? (
            <span className="pc-session-head__chip" data-testid="session-head-model">
              {modelChip}
            </span>
          ) : null}
          {modeChip ? (
            <span className="pc-session-head__chip" data-testid="session-head-mode">
              {modeChip}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
