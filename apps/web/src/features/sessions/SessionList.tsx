import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from "../../ui/primitives/index.js";
import { groupSessions } from "./group-sessions.js";
import { SessionRow } from "./SessionRow.js";
import type { SessionListState, SessionSummary } from "./types.js";

import "./session-list.css";

export interface SessionListProps {
  /** The session-list core state (plan.md §8.3 left session rail). */
  state: SessionListState;
  /** The currently open session, if any, so its row can be marked current. */
  selectedSessionId?: string | null;
  /** Called when a row is activated by click or keyboard. */
  onSelectSession?: (sessionId: string) => void;
  /** Archives a session immediately (T27B4); omitted hides every row's "Archive" action. */
  onArchiveSession?: (session: SessionSummary) => void;
  /** Opens the delete-confirmation dialog for a session (T27B4); omitted hides every row's "Delete" action. */
  onRequestDeleteSession?: (session: SessionSummary) => void;
  /** Clones a session immediately (T38A3); omitted hides every row's "Clone" action. */
  onCloneSession?: (session: SessionSummary) => void;
  /** Forks a session immediately (T38A3); omitted hides every row's "Fork" action. */
  onForkSession?: (session: SessionSummary) => void;
  /** Opens the rename dialog for a session (T38A4); omitted hides every row's "Rename" action. */
  onRequestRenameSession?: (session: SessionSummary) => void;
  /** The id of the session currently being archived, if any (T27B4). */
  archivingSessionId?: string | null;
  /** The id of the session currently being cloned FROM, if any (T38A3). */
  cloningSessionId?: string | null;
  /** The id of the session currently being forked FROM, if any (T38A3). */
  forkingSessionId?: string | null;
  /**
   * Maps a session id to a superseded-rename notice, if this client's
   * own recent rename of that session lost a concurrent race (T38A4;
   * see `SessionRow`'s `renameSupersededNotice` doc).
   */
  renameSupersededNoticeBySessionId?: ReadonlyMap<string, string>;
}

/**
 * Renders the left session rail's session list (T27B1). Composes only
 * existing primitives: `LoadingState`/`ErrorState`/`EmptyState` for the
 * non-ready states, `Section` to group sessions with a labelled
 * heading, and `SessionRow` (this feature's own composition of
 * `StatusIndicator`) for each session.
 *
 * `state.stale` (T27B6) renders a persistent `Banner` above the groups
 * rather than hiding or altering the rows themselves: the list stays
 * fully visible and interactive while unconfirmed, it is just labelled
 * as such (plan.md §7.4's "restore a stale cached tail without marking
 * it authoritative").
 */
export function SessionList({
  state,
  selectedSessionId,
  onSelectSession,
  onArchiveSession,
  onRequestDeleteSession,
  onCloneSession,
  onForkSession,
  onRequestRenameSession,
  archivingSessionId,
  cloningSessionId,
  forkingSessionId,
  renameSupersededNoticeBySessionId,
}: SessionListProps) {
  if (state.kind === "loading") {
    return (
      <LoadingState
        title="Loading sessions"
        description="Fetching sessions from this host."
        testId="session-list-loading"
      />
    );
  }

  if (state.kind === "error") {
    return (
      <ErrorState
        title="Couldn't load sessions"
        description={state.message}
        testId="session-list-error"
      />
    );
  }

  if (state.sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Create a session on this host to see it here."
        testId="session-list-empty"
      />
    );
  }

  const groups = groupSessions(state.sessions);

  return (
    <div className="pc-session-list" data-testid="session-list">
      {state.stale ? (
        <Banner
          tone="warning"
          message="Reconnecting — this list may be out of date."
          testId="session-list-stale-banner"
        />
      ) : null}
      {groups.map((group) => (
        <Section key={group.kind} title={group.label} className="pc-session-list__group">
          <ul className="pc-session-rows">
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === selectedSessionId}
                onSelect={onSelectSession}
                onArchive={onArchiveSession}
                onRequestDelete={onRequestDeleteSession}
                onClone={onCloneSession}
                onFork={onForkSession}
                onRequestRename={onRequestRenameSession}
                archiving={session.id === archivingSessionId}
                cloning={session.id === cloningSessionId}
                forking={session.id === forkingSessionId}
                renameSupersededNotice={renameSupersededNoticeBySessionId?.get(session.id) ?? null}
              />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
