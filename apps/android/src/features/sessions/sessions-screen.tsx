/**
 * `/h/:serverId/sessions` screen (T32B1, plan.md §9.2/§9.3/§10.3),
 * extended by T32B2 (plan.md §9.2, "Add Android session create and
 * open") with a create-session form and per-row open handling.
 *
 * Renders the session list with its empty and error states. There is no
 * live `DaemonClient` on Android yet (T32A3-T32A6 build it), so this
 * screen takes its session data as the optional `state` prop rather than
 * constructing a connection itself; the route stub
 * (`apps/android/src/app/h/[serverId]/(tabs)/sessions.tsx`, owned by
 * T32S1C) only ever passes `serverId`, so `state` defaults to an empty
 * ready state and still renders through the real `EmptyState` primitive
 * rather than nothing.
 *
 * Create/open likewise take an injected `sessionService` (T32B2's
 * `SessionService`, `sessions-model.ts`) rather than constructing a
 * `DaemonClient` — the same "no client yet" seam `Composer` already uses
 * for `onSubmit` (plan.md §12.4). `sessionService` is optional for the
 * same reason `state` is: the route stub doesn't wire one yet
 * (T32A1B, wave P5-W6, does), so the create form and every row simply
 * render disabled rather than throwing when it's absent.
 *
 * `sessions-model.ts` owns every decision (status text/tone, grouping,
 * the combined per-row accessibility label, which state to show, the
 * create-draft/submit lifecycle, the open loading/ready/error
 * transitions); this file is the thin native mapping onto
 * `View`/`Text`/`useState`, matching the pattern `../extensions/
 * renderers/log.tsx` already uses for the same `react-native`-in-vitest
 * reason (see that file's note) and `../composer/Composer.tsx`'s
 * "component only wires the model to `useState`" precedent.
 *
 * Accessibility (plan.md §10.5, §9.3 "primary touch targets are at least
 * 48 dp"): every row is one `accessible` `Pressable` node at least 48dp
 * tall whose label names title, status text, and provider/cwd together,
 * so status is never colour alone and the whole row is a single
 * TalkBack stop; tapping it opens that session. Empty and error states
 * come from the shared `EmptyState`/`ErrorState` primitives
 * (`../../ui/primitives/PlaceholderState.tsx`) — this file hand-rolls
 * neither.
 *
 * Opening a session here only ever proves the `SessionOpenState`
 * transition (`sessions-model.ts`'s module doc): a real timeline render
 * is the transcript feature's job (T33A2+), and there is no live
 * `DaemonClient`-backed `SessionService` yet (T32A1B). `onSessionOpened`
 * exists so a caller (eventually the `session/[agentId]` route, T32S2)
 * can act on a resolved open — this file never navigates on its own.
 *
 * T32B6 (wave P5-W11) closes the three defects `features/sessions/`
 * shipped unowned with: an optional `network` prop (see
 * `SessionsScreenProps`) constructs and drives `SessionListNetworkSync`
 * (`./session-list-network-sync.ts`) once it and `sessionService` are
 * both present, using the `SessionService.refreshSessions` method this
 * task adds; `listState.connectionPath` now renders as visible text via
 * `sessionListConnectionPathLabel`; and `listState.stale` is announced
 * through T37B's own `describeSessionListStaleness`
 * (`../../platform/offline/stale-announcement.ts`), never a second,
 * locally-invented staleness concept. T32S8 (P5-W12) added the one line
 * that was missing at the route (`network={core.network}` in
 * `app/h/[serverId]/(tabs)/sessions.tsx`), so `SessionListNetworkSync` is
 * constructed and driven in production and a real path switch does
 * trigger a resync. The adapter it is fed is still
 * `createPollingNetworkReachability` with `getProbeUrl: () => null`
 * (`app-shell/core.ts`) — `NativeNetworkReachability` stays blocked on
 * T60C's `@react-native-community/netinfo` install grant — so
 * `connectionPath` reports what polling can see, not a native path type.
 * The behaviour itself is proven here only against an injected fake
 * `NetworkReachability` (`sessions-screen.test.ts`).
 */
import type { KeyValueStorage, NetworkReachability } from "@picompanion/frontend-core";
import type { NativeTheme } from "@picompanion/design-tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useResumeSignals } from "../../app/core-context";
import {
  describeSessionListStaleness,
  type SessionListStalenessInput,
} from "../../platform/offline/stale-announcement";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  TextField,
} from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { useKeyboardInset } from "../../app-shell/keyboard-inset";
import { SessionListNetworkSync } from "./session-list-network-sync";
import { createSessionResumeController } from "./session-resume-controller";
import {
  EMPTY_CREATE_SESSION_STATE,
  IDLE_SESSION_ACTIONS_STATE,
  IDLE_SESSION_OPEN_STATE,
  applySessionOpenReconcile,
  beginArchiveSession,
  beginConfirmedDeleteSession,
  beginCreateSession,
  beginSessionOpen,
  buildSessionsScreenModel,
  clearLastOpenedSessionId,
  completeArchiveSession,
  completeDeleteSession,
  completeSessionOpen,
  dismissDeleteRequest,
  failArchiveSession,
  failDeleteSession,
  failSessionOpen,
  markCreateSessionFailed,
  markCreateSessionSucceeded,
  openAndLoadSession,
  readLastOpenedSessionId,
  reconcileSessionInList,
  removeSessionFromList,
  requestDeleteSession,
  sessionListConnectionPathLabel,
  updateCreateSessionDraft,
  writeLastOpenedSessionId,
  type CreateSessionState,
  type OutboxQueueReader,
  type SessionActionsState,
  type SessionListState,
  type SessionOpenResult,
  type SessionOpenState,
  type SessionRowModel,
  type SessionService,
  type SessionSummary,
} from "./sessions-model";

export interface SessionsScreenProps {
  serverId: string;
  /**
   * The session-list core state to render. Optional: nothing on Android
   * fetches real sessions yet, so the route stub only ever passes
   * `serverId`. Defaults to an empty ready state.
   */
  state?: SessionListState;
  /** Injected create/open transport (T32B2). Optional — see module doc. */
  sessionService?: SessionService;
  /**
   * Where the last-opened session id is persisted (T32B3). Optional —
   * the route stub doesn't wire one yet, so cold-start restore and
   * open-persistence are both simply skipped when absent, exactly like
   * `sessionService`.
   */
  keyValueStorage?: KeyValueStorage;
  /** This session's queued outbox entries, loaded alongside a restore (T32B3's "queue state"). Optional; a restore's `queue` is simply absent without one. */
  outbox?: OutboxQueueReader;
  /**
   * Feeds `SessionListNetworkSync` (T32B6, item 1): every observed
   * `NetworkStatus` updates `listState.connectionPath` and, on a
   * Wi-Fi <-> cellular path switch or an offline -> online transition,
   * triggers `sessionService.refreshSessions()` to reconcile the list.
   * Optional and independent of `sessionService`/`keyValueStorage`
   * above for the same "no client yet" reason — this screen only
   * constructs the sync once both `network` and `sessionService` are
   * present. The route (`apps/android/src/app/h/[serverId]/
   * (tabs)/sessions.tsx`) passes `network={core.network}` as of T32S8
   * (P5-W12), so the sync is live in production; before that it did not,
   * and this screen fell back to `connectionPath`'s honest "Unknown"
   * default with no resync ever firing — see this file's module doc for
   * which adapter `core.network` is today.
   */
  network?: NetworkReachability;
  /** Fires once a session is created successfully — e.g. so a caller can refresh `state`. */
  onSessionCreated?: (session: SessionSummary) => void;
  /** Fires once opening a session resolves — this screen never navigates on its own; see module doc. */
  onSessionOpened?: (result: SessionOpenResult) => void;
  /**
   * T337: whether the daemon connection this screen's `sessionService`
   * reads through is up right now. While `false`, the cold-start restore
   * effect waits (it re-runs the moment this flips to `true`) instead of
   * opening the last session against an idle store and surfacing "Not
   * connected to a daemon" in the open-error banner — Maestro run
   * 34470287372's `cold-start-restore`, where `AppCoreProvider`'s own
   * reconnect landed a moment after this screen mounted. Optional:
   * absent (every older caller, and the tests) means "assume connected",
   * which is exactly the pre-T337 behaviour.
   */
  connected?: boolean;
}

const DEFAULT_STATE: SessionListState = { kind: "ready", sessions: [] };

export function SessionsScreen({
  serverId,
  state = DEFAULT_STATE,
  sessionService,
  keyValueStorage,
  outbox,
  network,
  onSessionCreated,
  onSessionOpened,
  connected,
}: SessionsScreenProps) {
  const { theme } = useTheme();
  const keyboardInset = useKeyboardInset();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const testId = `sessions-screen-${serverId}`;

  // T32B4: `listState` starts from the caller-supplied `state` prop but is
  // reconciled locally once an archive/delete round-trip resolves — never
  // spliced ahead of the daemon's confirmation (see
  // `reconcileSessionInList`/`removeSessionFromList`'s docs). A later
  // `state` prop change (a real refetch, once a caller has one) still wins:
  // this effect re-syncs from it.
  const [listState, setListState] = useState<SessionListState>(state);
  useEffect(() => {
    setListState(state);
  }, [state]);
  const listStateRef = useRef(listState);
  listStateRef.current = listState;
  const model = buildSessionsScreenModel(listState);
  const sessionsById = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    if (listState.kind === "ready") {
      for (const session of listState.sessions) map.set(session.id, session);
    }
    return map;
  }, [listState]);

  // T32B6, item 1: constructed only once both `network` and
  // `sessionService` are present (see `SessionsScreenProps.network`'s
  // doc) — never a fake `NetworkReachability`/`SessionService` on this
  // path. `getState`/`onStateChange` close over the ref/setter above so
  // `SessionListNetworkSync` always reconciles against whatever
  // `listState` a concurrent archive/delete/open just produced, never a
  // stale snapshot captured at construction time.
  const sessionListNetworkSync = useMemo(() => {
    if (!network || !sessionService) return null;
    return new SessionListNetworkSync({
      refreshSessions: () => sessionService.refreshSessions(),
      getState: () => listStateRef.current,
      onStateChange: (next) => setListState(next),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, sessionService]);

  // Seeds the sync with the current `NetworkStatus` (`subscribe` alone
  // only fires on a future change, per `NetworkReachability`'s own
  // contract — `platform/network-reachability.ts`), then keeps it fed.
  useEffect(() => {
    if (!sessionListNetworkSync || !network) return;
    let cancelled = false;
    void network.getStatus().then((status) => {
      if (!cancelled) sessionListNetworkSync.handleNetworkStatus(status);
    });
    const unsubscribe = network.subscribe((status) => {
      sessionListNetworkSync.handleNetworkStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionListNetworkSync, network]);

  const [createState, setCreateState] = useState<CreateSessionState>(EMPTY_CREATE_SESSION_STATE);
  const [openState, setOpenState] = useState<SessionOpenState>(IDLE_SESSION_OPEN_STATE);
  const openStateRef = useRef(openState);
  openStateRef.current = openState;

  // T32B4: archive/delete action state (pending marker, delete-confirmation
  // target, last error) — kept apart from `listState`/`openState` since it
  // tracks a row-level action rather than the list or the open session.
  const [actionsState, setActionsState] = useState<SessionActionsState>(IDLE_SESSION_ACTIONS_STATE);
  const actionsStateRef = useRef(actionsState);
  actionsStateRef.current = actionsState;

  // T32B3: cold start restores the last opened session (plan.md §7.4).
  // Runs once sessionService/keyValueStorage are available and only while
  // nothing else has already started an open (a route that passes an
  // explicit initial session, or a tap that beat this effect to it, both
  // leave openState past "idle" by the time this runs). T337: and only
  // while `connected` is not `false` -- see that prop's doc; the effect
  // re-runs when it flips, and the "idle" guard still holds then.
  useEffect(() => {
    if (!sessionService || !keyValueStorage) return;
    if (connected === false) return;
    if (openStateRef.current.status !== "idle") return;
    let cancelled = false;
    void readLastOpenedSessionId(keyValueStorage).then((sessionId) => {
      if (cancelled || !sessionId) return;
      setOpenState(beginSessionOpen(sessionId));
      void openAndLoadSession(
        sessionId,
        { sessionService, storage: keyValueStorage, outbox },
        { stale: true },
      ).then((next) => {
        if (!cancelled) setOpenState(next);
      });
    });
    return () => {
      cancelled = true;
    };
    // Deliberately just these three: re-running on every openState change
    // would re-attempt a restore mid-open. See the "idle" guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionService, keyValueStorage, connected]);

  // T32B3: reconcile the open session when a socket stays open but goes
  // silent (plan.md §7.4 "Liveness") — `createSessionResumeController`
  // re-opens whatever session is currently ready; `useResumeSignals` feeds
  // this app's foreground/connectivity churn into it
  // (`../../app/resume-signals.ts`, T32S1B).
  const resumeController = useMemo(() => {
    if (!sessionService) return null;
    return createSessionResumeController({
      sessionService,
      getSessionId: () =>
        openStateRef.current.status === "ready" ? openStateRef.current.sessionId : null,
      onReconciled: (sessionId, result) => {
        setOpenState((current) => applySessionOpenReconcile(current, sessionId, result));
      },
      onReconcileError: (sessionId, message, explanation) => {
        if (!explanation.missing) return;
        // The daemon no longer has this session: a distinct, named
        // failure — never left silently "stale" forever — and the
        // stored id is cleared so a later cold start doesn't keep
        // retrying a session that's gone.
        setOpenState((current) =>
          current.status === "ready" && current.sessionId === sessionId
            ? failSessionOpen(sessionId, message)
            : current,
        );
        if (keyValueStorage) void clearLastOpenedSessionId(keyValueStorage);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionService, keyValueStorage]);

  useEffect(() => {
    return () => resumeController?.dispose();
  }, [resumeController]);

  useResumeSignals(resumeController);

  const handleCreateSubmit = useCallback(() => {
    if (!sessionService) return;
    const begin = beginCreateSession(createState);
    setCreateState(begin.state);
    if (!begin.ok) return;

    sessionService
      .createSession(begin.state.draft)
      .then((session) => {
        setCreateState(markCreateSessionSucceeded());
        onSessionCreated?.(session);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setCreateState((current) => markCreateSessionFailed(current, message));
      });
  }, [sessionService, createState, onSessionCreated]);

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      if (!sessionService) return;
      setOpenState(beginSessionOpen(sessionId));
      sessionService
        .openSession(sessionId)
        .then((result) => {
          setOpenState(completeSessionOpen(sessionId, result));
          // T32B3: this becomes the session a later cold start restores.
          if (keyValueStorage) void writeLastOpenedSessionId(keyValueStorage, sessionId);
          onSessionOpened?.(result);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setOpenState(failSessionOpen(sessionId, message));
        });
    },
    [sessionService, keyValueStorage, onSessionOpened],
  );

  // T32B4: archive fires immediately (no confirmation — archiving isn't
  // destructive), but the list is only reconciled once `archiveSession`
  // resolves, with exactly what it resolved with (never a local guess).
  const handleArchiveSession = useCallback(
    (session: SessionSummary) => {
      if (!sessionService) return;
      setActionsState((current) => beginArchiveSession(current, session.id));
      sessionService
        .archiveSession(session.id)
        .then((updated) => {
          setListState((current) => reconcileSessionInList(current, updated));
          setActionsState((current) => completeArchiveSession(current, session.id));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setActionsState((current) => failArchiveSession(current, session.id, message));
        });
    },
    [sessionService],
  );

  // T32B4: opens the delete-confirmation Dialog. No service call happens
  // until `handleConfirmDelete` — a dismissal (`handleDismissDelete`)
  // leaves the session untouched.
  const handleRequestDelete = useCallback((session: SessionSummary) => {
    setActionsState((current) => requestDeleteSession(current, session));
  }, []);

  const handleDismissDelete = useCallback(() => {
    setActionsState((current) => dismissDeleteRequest(current));
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!sessionService) return;
    const begin = beginConfirmedDeleteSession(actionsStateRef.current);
    if (!begin.sessionId) return;
    const sessionId = begin.sessionId;
    setActionsState(begin.state);
    sessionService
      .deleteSession(sessionId)
      .then(() => {
        // T32B4: the row is removed only now, from the daemon's
        // confirmation — never spliced out ahead of it.
        setListState((current) => removeSessionFromList(current, sessionId));
        setActionsState((current) => completeDeleteSession(current, sessionId));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setActionsState((current) => failDeleteSession(current, sessionId, message));
      });
  }, [sessionService]);

  // T32B6, item 3/4: `SessionListState.stale` fed straight into T37B's
  // `describeSessionListStaleness` (`platform/offline/
  // stale-announcement.ts`) via `SessionListStalenessInput` — the
  // explicit type annotation ties this call to that exact shape at
  // compile time rather than an object literal happening to match it
  // structurally, so the two staleness concepts this doc comment names
  // can never silently drift apart. `null` (not stale, or no list yet)
  // renders nothing.
  const listStaleness = useMemo(() => {
    const input: SessionListStalenessInput = {
      stale: listState.kind === "ready" ? Boolean(listState.stale) : false,
    };
    return describeSessionListStaleness(input);
  }, [listState]);

  return (
    <ScrollView
      // T330: same viewport shrink as `connection-shell.tsx`'s ScrollView.
      style={[styles.container, { marginBottom: keyboardInset }]}
      testID={testId}
      // T329: same reason as `connection-shell.tsx`'s ScrollView — the
      // create-session form's submit is tapped straight after typing, and
      // the default `"never"` would spend that tap dismissing the keyboard.
      keyboardShouldPersistTaps="handled"
    >
      <CreateSessionForm
        state={createState}
        onCwdChange={(cwd) =>
          setCreateState((current) => updateCreateSessionDraft(current, { cwd }))
        }
        onProviderChange={(provider) =>
          setCreateState((current) => updateCreateSessionDraft(current, { provider }))
        }
        onSubmit={handleCreateSubmit}
        disabled={!sessionService}
        testId={`${testId}-create`}
      />
      {listState.kind === "ready" ? (
        // T32B6, item 3: "the active connection path is visible" — text,
        // never colour alone, honestly "Unknown" until `network` (see
        // `SessionsScreenProps`) has fed at least one `NetworkStatus`.
        <Banner
          tone="neutral"
          message={`Connection: ${sessionListConnectionPathLabel(listState.connectionPath)}`}
          testId={`${testId}-connection-path`}
        />
      ) : null}
      {listStaleness ? (
        // T32B6, item 4: T37B's own staleness sentence, not a second,
        // locally-invented one — see `listStaleness`'s doc above.
        <Banner tone="warning" message={listStaleness.text} testId={`${testId}-list-stale`} />
      ) : null}
      {openState.status === "loading" ? (
        <Banner
          tone="info"
          message={`Opening session ${openState.sessionId}…`}
          testId={`${testId}-open-loading`}
        />
      ) : null}
      {openState.status === "error" ? (
        <Banner tone="danger" message={openState.message} testId={`${testId}-open-error`} />
      ) : null}
      {openState.status === "ready" && openState.stale ? (
        // T32B3, plan.md §7.4: a restored cached tail is shown, but never
        // presented as authoritative until a resume reconcile confirms it.
        <Banner
          tone="warning"
          message="Restored from the last time this session was open — catching up with the daemon…"
          testId={`${testId}-open-stale`}
        />
      ) : null}
      {model.kind === "loading" ? (
        <LoadingState
          title={model.title}
          description={model.description}
          testId={`${testId}-loading`}
        />
      ) : null}
      {model.kind === "error" ? (
        <ErrorState
          title={model.title}
          description={model.description}
          testId={`${testId}-error`}
        />
      ) : null}
      {model.kind === "empty" ? (
        <EmptyState
          title={model.title}
          description={model.description}
          testId={`${testId}-empty`}
        />
      ) : null}
      {model.kind === "ready"
        ? model.groups.map((group) => (
            <Section key={group.kind} title={group.label} testId={`${testId}-group-${group.kind}`}>
              <View style={styles.rows}>
                {group.rows.map((row) => {
                  const rawSession = sessionsById.get(row.id);
                  const isPending = actionsState.pendingSessionId === row.id;
                  return (
                    <SessionRow
                      key={row.id}
                      row={row}
                      theme={theme}
                      onOpen={sessionService ? () => handleOpenSession(row.id) : undefined}
                      onArchive={
                        sessionService && rawSession && !rawSession.archivedAt
                          ? () => handleArchiveSession(rawSession)
                          : undefined
                      }
                      archiving={isPending && actionsState.pendingPhase === "archiving"}
                      onRequestDelete={
                        sessionService && rawSession
                          ? () => handleRequestDelete(rawSession)
                          : undefined
                      }
                      deleting={isPending && actionsState.pendingPhase === "deleting"}
                      errorMessage={
                        actionsState.error?.sessionId === row.id
                          ? actionsState.error.message
                          : undefined
                      }
                      testId={`${testId}-row-${row.id}`}
                    />
                  );
                })}
              </View>
            </Section>
          ))
        : null}
      <Dialog
        open={actionsState.deleteTarget !== null}
        title="Delete this session?"
        description={
          actionsState.deleteTarget
            ? `"${actionsState.deleteTarget.title ?? "Untitled session"}" will be permanently deleted. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        onConfirm={handleConfirmDelete}
        onClose={handleDismissDelete}
        testId={`${testId}-delete-dialog`}
      />
    </ScrollView>
  );
}

function CreateSessionForm({
  state,
  onCwdChange,
  onProviderChange,
  onSubmit,
  disabled,
  testId,
}: {
  state: CreateSessionState;
  onCwdChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  testId: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const submitting = state.phase === "submitting";

  return (
    <Section title="New session" testId={testId}>
      <View style={styles.formFields}>
        <TextField
          label="Working directory"
          value={state.draft.cwd}
          onChangeText={onCwdChange}
          error={state.errors.cwd}
          editable={!submitting}
          testId={`${testId}-cwd`}
        />
        <TextField
          label="Provider"
          value={state.draft.provider}
          onChangeText={onProviderChange}
          error={state.errors.provider}
          editable={!submitting}
          testId={`${testId}-provider`}
        />
        {state.phase === "error" && state.errorMessage ? (
          <Banner tone="danger" message={state.errorMessage} testId={`${testId}-error`} />
        ) : null}
        <Button
          label={submitting ? "Creating…" : "Create session"}
          onPress={onSubmit}
          disabled={disabled || submitting}
          testId={`${testId}-submit`}
        />
      </View>
    </Section>
  );
}

function SessionRow({
  row,
  theme,
  onOpen,
  onArchive,
  archiving,
  onRequestDelete,
  deleting,
  errorMessage,
  testId,
}: {
  row: SessionRowModel;
  theme: NativeTheme;
  onOpen: (() => void) | undefined;
  /** Undefined both when there's no `sessionService` and for an already-archived row — archiving an archived session is meaningless (T32B4). */
  onArchive: (() => void) | undefined;
  archiving: boolean;
  onRequestDelete: (() => void) | undefined;
  deleting: boolean;
  /** This row's most recent archive/delete failure message, if any (T32B4: the row stays present with a named error, never silently vanishing). */
  errorMessage: string | undefined;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const dotStyle = styles[`dot_${row.tone}`];
  const actionsDisabled = archiving || deleting;

  return (
    <View style={styles.rowContainer}>
      <Pressable
        style={styles.row}
        accessible
        accessibilityRole="button"
        accessibilityLabel={row.accessibilityLabel}
        onPress={onOpen}
        disabled={!onOpen}
        testID={testId}
      >
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, dotStyle]} accessibilityElementsHidden />
          {/* Status shown as visible text alongside the coloured dot — never colour alone (plan.md §10.5). */}
          <Text style={styles.statusText}>{row.statusText}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {row.meta}
        </Text>
      </Pressable>
      {errorMessage ? (
        <Banner tone="danger" message={errorMessage} testId={`${testId}-action-error`} />
      ) : null}
      <View style={styles.rowActions}>
        {onArchive ? (
          <Button
            kind="secondary"
            label={archiving ? "Archiving…" : "Archive"}
            onPress={onArchive}
            disabled={actionsDisabled}
            testId={`${testId}-archive`}
          />
        ) : null}
        {onRequestDelete ? (
          <Button
            kind="danger"
            label={deleting ? "Deleting…" : "Delete"}
            onPress={onRequestDelete}
            disabled={actionsDisabled}
            testId={`${testId}-delete`}
          />
        ) : null}
      </View>
    </View>
  );
}

function createStyles(theme: NativeTheme) {
  return StyleSheet.create({
    container: { flex: 1 },
    formFields: { gap: theme.spacing[2] },
    rows: { gap: theme.spacing[1] },
    rowContainer: { gap: theme.spacing[1] },
    row: {
      minHeight: 48,
      justifyContent: "center",
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.line,
    },
    rowActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: theme.spacing[2],
      paddingBottom: theme.spacing[2],
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
    dot: { width: 8, height: 8, borderRadius: theme.radii.full },
    dot_success: { backgroundColor: theme.colors.status.success.icon },
    dot_warning: { backgroundColor: theme.colors.status.warning.icon },
    dot_danger: { backgroundColor: theme.colors.status.danger.icon },
    dot_info: { backgroundColor: theme.colors.status.info.icon },
    dot_neutral: { backgroundColor: theme.colors.status.neutral.icon },
    statusText: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    meta: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
