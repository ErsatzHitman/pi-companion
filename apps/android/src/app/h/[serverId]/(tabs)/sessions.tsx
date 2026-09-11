import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  SessionsScreen,
  type SessionListState,
  type SessionOpenResult,
  type SessionSummary,
} from "../../../../features/sessions";
import { applySessionListWindow } from "../../../../features/sessions/sessions-model.js";
import { appendCreatedSession } from "../../../../app-shell/session-list-append";
import { destinationHref } from "../../../../app-shell/top-level-destinations";
import { useConnectionStatus } from "../../../../features/connect";
import { useAppCore } from "../../../core-context";

const INITIAL_SESSION_LIST_STATE: SessionListState = { kind: "ready", sessions: [] };

/**
 * `/h/:serverId/sessions` — the "sessions" Phase 5 feature family's route
 * stub — T32S1C, given a real `sessionService`/`keyValueStorage` by
 * T32S3 (item 4).
 *
 * Matches `navigationIntentToPath({ type: "sessionList", serverId })`
 * exactly (`host-tabs.ts`'s `TAB_ROUTE_NAME.sessionList` is this file's
 * own name, `"sessions"`). Imports its screen from
 * `apps/android/src/features/sessions/` rather than containing any
 * feature logic itself, so T32B1/T32B2/T32B3/T32B4 replace
 * `SessionsScreen`'s body without ever touching this file.
 *
 * `sessionService`/`keyValueStorage` used to be omitted entirely, which
 * left `SessionsScreen`'s own `if (!sessionService) return null` guard
 * (inside its `resumeController` `useMemo`) firing in production and its
 * cold-start restore effect permanently skipped (both gated on
 * `sessionService && keyValueStorage`, `sessions-screen.tsx`). Both now
 * come from `AppCore` (`../../../core.ts`) — real, not fake, adapters. A
 * real `ConnectForm` submission (T32A4, P5-W9) does connect `AppCore.
 * connection`, and `sessionService`/`fileBrowserClient` both read that
 * connection fresh on every call — see `AppCore["sessionService"]`'s doc
 * comment for the cast that makes that real, not the "not yet connected"
 * gap this comment used to describe here.
 *
 * `network` (T32S8) is `core.network`: `SessionsScreen`'s own doc comment
 * names this as the one prop this route used to omit, which left
 * `SessionListNetworkSync` never constructed and `listState.stale`/
 * `connectionPath` permanently at their unset defaults in production even
 * though `sessions-screen.test.ts` already proved the wiring against an
 * injected fake. Passing the real adapter here is the only change needed
 * to make that wiring live.
 *
 * **T32S12 mount (P5-W18), T37E2's finding**: `state`/`onSessionCreated`
 * used to be omitted entirely, so `SessionsScreen`'s internal `listState`
 * (which only re-syncs from the `state` *prop*, never mutates itself on a
 * create — see `sessions-screen.tsx`'s `handleCreateSubmit`) stayed at
 * its `DEFAULT_STATE` forever: a session a user actually created through
 * the real, connected `sessionService` above never appeared as a row
 * without a full remount. This route now owns a local
 * `SessionListState`, seeded empty-ready, and folds each
 * `onSessionCreated` callback through `../../../../app-shell/
 * session-list-append.ts`'s `appendCreatedSession` (insert-or-replace by
 * id, never `sessions-model.ts`'s `reconcileSessionInList`, which only
 * updates a row already present — see that module's doc comment for
 * why).
 *
 * **T336 mount, Maestro run 34462826449's finding**: `onSessionOpened`
 * used to be omitted too, so tapping a row ran `SessionsScreen`'s
 * `handleOpenSession` (fetch the agent, load its timeline, persist
 * `sessions/last-opened-session-id`) and then stayed on the list -- no
 * route in the app ever reached `/h/:serverId/session/:agentId` from a
 * tap. `handleSessionOpened` below is that navigation: `router.push` to
 * `destinationHref({ type: "session", serverId, agentId })`, the same
 * intent `app/share.tsx` resolves a shared file to and
 * `session/[agentId]/index.tsx`'s own header names as its path. `push`,
 * not `replace`: Android back from a session returns to this list.
 * `SessionsScreen`'s cold-start restore effect deliberately does NOT call
 * `onSessionOpened` (it restores the last-opened session's cached state
 * in place, `stale` until reconciled), so a relaunch still lands here.
 *
 * **T32S13 mount (P5-W19)**: the "not a session *list fetch*" gap this
 * comment used to disclose is closed. On mount, this route now calls
 * `core.sessionService.refreshSessions()` once and folds the result into
 * `listState` via `sessions-model.ts`'s own `applySessionListWindow` --
 * the exact merge function `SessionListNetworkSync`
 * (`../../../../features/sessions/session-list-network-sync.ts`) already
 * uses for its own resyncs, imported directly (not through the barrel,
 * which does not export it) the same way that module does. A returning
 * user who reopens this screen against an already-connected daemon now
 * sees sessions that already exist, not only ones created in this
 * process. No connection yet (or the fetch otherwise fails) rejects with
 * "Not connected to a daemon" (`daemon-session-service.ts`) -- caught
 * and silently ignored here: `listState` simply stays whatever it
 * already was, and `SessionListNetworkSync`'s own online-transition
 * resync (via `network={core.network}` below) is what retries once a
 * connection exists, exactly as this comment already documents for the
 * different-device case. Fenced against this effect re-running with a
 * `cancelled` flag, the same shape `AppCoreProvider`'s own cold-start
 * effect uses (`app/core-context.tsx`) -- a slow, abandoned fetch can
 * never clobber a newer one's state.
 *
 * **T337 (Maestro run 34470287372)**: that fetch, and `SessionsScreen`'s
 * cold-start restore effect, now wait for the daemon connection. On a
 * cold start `AppCoreProvider` reconnects the stored profile on its own
 * (`app-shell/cold-start-reconnect.ts`), but that lands a moment AFTER
 * this route mounts -- so a mount-time fetch rejected with "Not
 * connected to a daemon", the restore effect banner-ed the same text,
 * and nothing ever re-fetched: the network sync only fires on a
 * Wi-Fi/cellular switch or an offline -> online transition, and a
 * relaunch is neither. The effect below is keyed on
 * `useConnectionStatus(core.connection).phase` and runs only while it is
 * `"connected"` (so it re-runs when the reconnect lands, and on any
 * later reconnect), and `connected={phase === "connected"}` tells the
 * screen to hold its restore until then. (CORRECTED (T337): the
 * paragraph above said the fetch fires once on mount, that a rejection
 * is silently ignored, and that the network sync is what retries. The
 * first two are no longer how this route behaves; the third was never
 * true of a relaunch.)
 */
export default function SessionsRoute() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  const router = useRouter();
  const [listState, setListState] = useState<SessionListState>(INITIAL_SESSION_LIST_STATE);
  const handleSessionCreated = useCallback((session: SessionSummary) => {
    setListState((current) => appendCreatedSession(current, session));
  }, []);
  // T336: see the header comment.
  const handleSessionOpened = useCallback(
    (result: SessionOpenResult) => {
      router.push(
        destinationHref({ type: "session", serverId: serverId ?? "", agentId: result.session.id }),
      );
    },
    [router, serverId],
  );
  // T362: A1's bar carries a close action, and this route is the only
  // thing that knows whether there is anywhere to close back TO. As a
  // tab reached directly there is not; reached from a session's own
  // bar there is. `canGoBack` answers that, and the prop is left
  // undefined when it says no, so the bar draws no leading button
  // rather than one that does nothing.
  const canClose = router.canGoBack();
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);
  const { phase } = useConnectionStatus(core.connection);
  useEffect(() => {
    if (phase !== "connected") return;
    let cancelled = false;
    core.sessionService
      .refreshSessions()
      .then((window) => {
        if (cancelled) return;
        setListState((current) => applySessionListWindow(current, window));
      })
      .catch(() => {
        // The fetch failed against a live connection -- see this route's
        // own doc comment (T337): the next phase change re-runs it.
      });
    return () => {
      cancelled = true;
    };
  }, [core.sessionService, phase]);
  return (
    <SessionsScreen
      serverId={serverId}
      state={listState}
      sessionService={core.sessionService}
      keyValueStorage={core.keyValueStorage}
      network={core.network}
      connected={phase === "connected"}
      onSessionCreated={handleSessionCreated}
      onSessionOpened={handleSessionOpened}
      onClose={canClose ? handleClose : undefined}
    />
  );
}
