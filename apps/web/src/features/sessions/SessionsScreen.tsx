import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import type { Clock } from "@picompanion/frontend-core";

import { createBrowserClock } from "../../platform/clock.js";
import { Button, Section, Toast } from "../../ui/primitives/index.js";
import { CreateSessionDialog } from "./CreateSessionDialog.js";
import { DeleteSessionDialog } from "./DeleteSessionDialog.js";
import { DiscoveredSessionList } from "./DiscoveredSessionList.js";
import { RenameSessionDialog } from "./RenameSessionDialog.js";
import { SessionList } from "./SessionList.js";
import { SessionTree } from "./session-tree.js";
import { buildSessionTree } from "./session-tree-state.js";
import type { SessionRelationship } from "./session-tree-state.js";
import type { DiscoveredSessionsClient } from "./discovered-sessions-client.js";
import { createPendingConnectionDiscoveredSessionsClient } from "./pending-connection-discovered-sessions-client.js";
import { createPendingConnectionSessionsClient } from "./pending-connection-sessions-client.js";
import "./session-list.css";
import { SESSIONS_NOT_CONNECTED, explainSessionsActionError } from "./sessions-client.js";
import type {
  CloneSessionResult,
  ForkSessionInput,
  ForkSessionResult,
  SessionsClient,
} from "./sessions-client.js";
import type { SessionListState, SessionSummary } from "./types.js";
import { useCreateSession } from "./use-create-session.js";
import { useDiscoveredSessions } from "./use-discovered-sessions.js";
import { useForkCloneSession } from "./use-fork-clone-session.js";
import { useRenameSession } from "./use-rename-session.js";
import { useSessionActions } from "./use-session-actions.js";
import { useSessionListSync } from "./use-session-list-sync.js";
import type { SessionListConnectionState } from "./use-session-list-sync.js";

/**
 * Placeholder fork-point entryId the session-*list*-level "Fork" action
 * sends (T38A3). A row here has no transcript access (`features/
 * transcript/` is a different directory, out of this task's Owns line),
 * so it cannot supply a real per-message entryId the way an in-transcript
 * "edit from here" trigger eventually will (T38A1b builds that
 * shortcut's model; wiring it to a UI trigger is separate, not-yet-issued
 * work). This sentinel means "fork from this session's current tip";
 * `SessionsClient.forkSession` implementations decide what that means in
 * practice — today, only a fake in this feature's own tests do, since no
 * real wire message exists yet (see `daemon-sessions-client.ts`'s module
 * doc for that disclosed gap).
 */
const TIP_FORK_ENTRY_ID = "tip";

export interface SessionsScreenProps {
  serverId: string;
  /**
   * Seeds the rendered list. Defaults to an empty, ready list: resolving
   * a host's real session list depends on the sessions domain (currently
   * `packages/frontend-core/src/sessions/index.ts`'s stub; see
   * docs/issues-from-plan.md, T38A1). This screen still renders and
   * behaves correctly with no sessions — creating one appends it below
   * without needing that fetch to exist yet.
   */
  initialState?: SessionListState;
  /**
   * Defaults to `createPendingConnectionSessionsClient()` (T27B2: this
   * app has no live `DaemonClient` wiring yet, see
   * `pending-connection-sessions-client.ts`). Pass a real, host-scoped
   * client (`createDaemonSessionsClient`) once one exists.
   */
  client?: SessionsClient;
  /**
   * Defaults to `createPendingConnectionDiscoveredSessionsClient()`
   * (T27B5, same reason as `client`). Pass a real, host-scoped client
   * (`createDaemonDiscoveredSessionsClient`) once one exists.
   */
  discoveredClient?: DiscoveredSessionsClient;
  /**
   * Drives reconnect/gap-recovery reconciliation (T27B6, see
   * `use-session-list-sync.ts`'s module doc for why this is a plain
   * prop rather than a `features/connection` subscription). Defaults
   * to `"connected"`, matching every existing caller of this screen
   * (none of which have a reason to model a disconnect today) while
   * still exercising an initial sync against `client.fetchSessions`
   * when one is provided.
   */
  connectionState?: SessionListConnectionState;
  /**
   * Drives `useRenameSession`'s concurrent-rename arbitration (T38A4).
   * Defaults to the real browser adapter (`createBrowserClock`, plan.md
   * §7.3), matching `SessionResumeScreen`'s identical `clock` prop
   * precedent. Pass a fake in tests that need deterministic timing.
   */
  clock?: Clock;
}

const DEFAULT_LIST_STATE: SessionListState = { kind: "ready", sessions: [] };

/**
 * The `/h/:serverId/sessions` screen body (T27B2, plan.md §8.3): the
 * session list (T27B1) plus session creation, both driving real
 * navigation through `@tanstack/react-router`. Kept separate from the
 * route screen file so it is directly testable without going through
 * the router (matching `features/files/file-browser-screen.tsx`'s
 * precedent).
 */
export function SessionsScreen({
  serverId,
  initialState = DEFAULT_LIST_STATE,
  client,
  discoveredClient,
  connectionState = "connected",
  clock,
}: SessionsScreenProps) {
  const navigate = useNavigate();
  const resolvedClock = useMemo(() => clock ?? createBrowserClock(), [clock]);
  const resolvedClient = useMemo(() => client ?? createPendingConnectionSessionsClient(), [client]);
  const resolvedDiscoveredClient = useMemo(
    () => discoveredClient ?? createPendingConnectionDiscoveredSessionsClient(),
    [discoveredClient],
  );
  const [state, setState] = useState<SessionListState>(initialState);

  // T27B6: reconcile the list on initial connect and on every
  // reconnect, and mark it stale in between so a forced reconnect or a
  // gap in an otherwise-open connection never leaves a duplicated or
  // silently-stale rail.
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const sync = useSessionListSync({
    client: resolvedClient,
    connectionState,
    getSessions: () => (state.kind === "ready" ? state.sessions : []),
    onSynced: (sessions) => {
      setState({ kind: "ready", sessions });
      setSyncErrorMessage(null);
      // T38A4: every reconcile is the only channel a client has today
      // to discover its own rename lost a concurrent race against
      // another client's later write — see `use-rename-session.ts`'s
      // module doc. Feed each session's authoritative title through so
      // any outstanding rename attempt for it can resolve.
      for (const session of sessions) {
        rename.reconcileTitle(session.id, session.title);
      }
    },
    onSyncFailed: (message) => {
      if (message === SESSIONS_NOT_CONNECTED) return; // not an error worth surfacing: just not wired up yet
      setSyncErrorMessage(`Couldn't refresh the session list: ${message}`);
    },
  });
  const listState: SessionListState =
    state.kind === "ready" ? { ...state, stale: sync.stale } : state;

  function openSession(sessionId: string): void {
    void navigate({
      to: "/h/$serverId/session/$agentId",
      params: { serverId, agentId: sessionId },
    });
  }

  function handleCreated(session: SessionSummary): void {
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", sessions: [session, ...current.sessions] }
        : { kind: "ready", sessions: [session] },
    );
    // Creating a session opens it immediately (plan.md §8.3): there is
    // no reason to make the user create, then separately select, the
    // session they just asked for.
    openSession(session.id);
  }

  const controller = useCreateSession({ client: resolvedClient, onCreated: handleCreated });

  // T27B5: discover Pi sessions already on this host (including ones
  // started from a bare terminal) and import them into the same
  // `SessionListState` a create does, without auto-opening them — a
  // discovered session may cover several imports in one sitting.
  function handleImported(session: SessionSummary): void {
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", sessions: [session, ...current.sessions] }
        : { kind: "ready", sessions: [session] },
    );
  }

  const discovery = useDiscoveredSessions({
    client: resolvedDiscoveredClient,
    onImported: handleImported,
  });

  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  function updateSession(
    sessionId: string,
    updater: (session: SessionSummary) => SessionSummary,
  ): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            sessions: current.sessions.map((session) =>
              session.id === sessionId ? updater(session) : session,
            ),
          }
        : current,
    );
  }

  function removeSession(sessionId: string): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            sessions: current.sessions.filter((session) => session.id !== sessionId),
          }
        : current,
    );
  }

  function reinsertSession(session: SessionSummary): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            sessions: current.sessions.some((existing) => existing.id === session.id)
              ? current.sessions
              : [...current.sessions, session],
          }
        : { kind: "ready", sessions: [session] },
    );
  }

  // T27B4: archive and delete, both applied optimistically (before the
  // daemon round-trip resolves) and reconciled or rolled back once it
  // does.
  const actions = useSessionActions({
    client: resolvedClient,
    onArchived: (sessionId, archivedAt) => {
      updateSession(sessionId, (session) => ({ ...session, archivedAt }));
    },
    onArchiveFailed: (session, message) => {
      updateSession(session.id, () => session);
      setActionErrorMessage(explainSessionsActionError("archive", message).description);
    },
    onDeleted: (session) => {
      removeSession(session.id);
    },
    onDeleteFailed: (session, message) => {
      reinsertSession(session);
      setActionErrorMessage(explainSessionsActionError("delete", message).description);
    },
  });

  // T38A3: fork and clone. Neither is optimistic (`useForkCloneSession`'s
  // module doc explains why: there is no row to mutate ahead of the
  // round trip settling), so a failure never touches `state` or
  // `relationships` at all — the source session's own row is left
  // exactly as it was, satisfying "failure leaves the original
  // untouched" structurally rather than by a rollback path that could
  // itself go wrong.
  const [relationships, setRelationships] = useState<ReadonlyMap<string, SessionRelationship>>(
    () => new Map(),
  );

  function addSession(session: SessionSummary): void {
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", sessions: [session, ...current.sessions] }
        : { kind: "ready", sessions: [session] },
    );
  }

  function handleForked(source: SessionSummary, result: ForkSessionResult): void {
    setRelationships((current) => {
      const next = new Map(current);
      next.set(result.session.id, {
        kind: "fork",
        parentId: source.id,
        forkPoint: result.forkPoint,
      });
      return next;
    });
    addSession(result.session);
  }

  function handleCloned(source: SessionSummary, result: CloneSessionResult): void {
    setRelationships((current) => {
      const next = new Map(current);
      next.set(result.session.id, { kind: "clone", sourceId: source.id });
      return next;
    });
    addSession(result.session);
  }

  const forkClone = useForkCloneSession({
    client: resolvedClient,
    onForked: handleForked,
    onForkFailed: (_source, message) => {
      setActionErrorMessage(explainSessionsActionError("fork", message).description);
    },
    onCloned: handleCloned,
    onCloneFailed: (_source, message) => {
      setActionErrorMessage(explainSessionsActionError("clone", message).description);
    },
  });

  function forkFromTip(session: SessionSummary): void {
    const input: ForkSessionInput = { entryId: TIP_FORK_ENTRY_ID, entryIndex: 0 };
    forkClone.fork(session, input);
  }

  // T38A4: rename, applied optimistically (mirrors archive's shape) plus
  // the concurrent-rename arbitration `use-rename-session.ts`'s module
  // doc describes in full — `reconcileTitle` above (fed by every
  // `sync.onSynced`) is what actually resolves it.
  const [renameSupersededNoticeBySessionId, setRenameSupersededNoticeBySessionId] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());

  const rename = useRenameSession({
    client: resolvedClient,
    clock: resolvedClock,
    onRenamed: (sessionId, title) => {
      updateSession(sessionId, (session) => ({ ...session, title }));
    },
    onRenameFailed: (session, message) => {
      updateSession(session.id, () => session);
      setActionErrorMessage(explainSessionsActionError("rename", message).description);
    },
    onRenameSuperseded: (sessionId, attempted, current) => {
      setRenameSupersededNoticeBySessionId((existing) => {
        const next = new Map(existing);
        next.set(
          sessionId,
          `You renamed this to "${attempted}", but "${current}" is now in effect elsewhere.`,
        );
        return next;
      });
    },
  });

  const treeNodes = useMemo(
    () => buildSessionTree(listState.kind === "ready" ? listState.sessions : [], relationships),
    [listState, relationships],
  );

  return (
    <Section title="Sessions" className="pc-sessions-screen">
      <Button
        onClick={controller.openDialog}
        className="pc-sessions-screen__create-trigger"
        data-testid="create-session-trigger"
      >
        New session
      </Button>
      <Button
        kind="secondary"
        onClick={discovery.discover}
        disabled={discovery.phase === "loading"}
        className="pc-sessions-screen__discover-trigger"
        data-testid="discover-sessions-trigger"
      >
        {discovery.phase === "loading" ? "Looking…" : "Find sessions"}
      </Button>
      <DiscoveredSessionList controller={discovery} />
      <SessionList
        state={listState}
        onSelectSession={openSession}
        onArchiveSession={actions.archive}
        onRequestDeleteSession={actions.requestDelete}
        onForkSession={forkFromTip}
        onCloneSession={forkClone.clone}
        onRequestRenameSession={rename.requestRename}
        archivingSessionId={actions.archivingSessionId}
        forkingSessionId={forkClone.forkingSessionId}
        cloningSessionId={forkClone.cloningSessionId}
        renameSupersededNoticeBySessionId={renameSupersededNoticeBySessionId}
      />
      <Section title="Session tree" className="pc-sessions-screen__tree">
        <SessionTree nodes={treeNodes} onSelectSession={openSession} />
      </Section>
      <CreateSessionDialog controller={controller} />
      <DeleteSessionDialog controller={actions} />
      <RenameSessionDialog controller={rename} />
      {actionErrorMessage ? (
        <Toast tone="danger" message={actionErrorMessage} testId="sessions-action-error-toast" />
      ) : null}
      {syncErrorMessage ? (
        <Toast tone="warning" message={syncErrorMessage} testId="sessions-sync-error-toast" />
      ) : null}
    </Section>
  );
}
