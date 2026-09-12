import { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import { Outlet, createRootRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useDaemonClientContext } from "../app/daemon-client-context.js";
import {
  PiUiSessionProvider,
  usePiUiSession,
} from "../features/extensions/pi-ui-session-context.js";
import { PiNoticeBannerContainer } from "../features/notices/index.js";
import { ContextMeter, PiExtensionRail, PiExtensionStatusStrip } from "../features/rail/index.js";
import {
  SESSIONS_NOT_CONNECTED,
  SessionRail,
  SessionStatusPill,
  SessionWorkspaceCrumb,
  createDaemonSessionsClient,
  createPendingConnectionSessionsClient,
  useSessionListSync,
  useSessionSnapshot,
} from "../features/sessions/index.js";
import type {
  SessionChromeClient,
  SessionListConnectionState,
  SessionListState,
} from "../features/sessions/index.js";
import { SessionCostMeterContainer } from "../features/telemetry/index.js";
import { Shell } from "../ui/shell.js";
import { NotFoundScreen } from "./not-found-screen.js";
import { RouteErrorScreen } from "./route-error-screen.js";

/**
 * Mounts the session and extension rails into `Shell` (plan.md §8.3,
 * T53A3). Before this task, `root-route.tsx` passed neither `sessionRail`
 * nor `extensionRail`, so both rails permanently showed `Shell`'s own
 * empty-state fallback (see `ui/shell.tsx`'s doc comment) no matter what
 * a host or session actually had — every rail feature (`features/sessions`,
 * `features/rail`, `features/telemetry`) was fully built and tested in
 * isolation but reachable from nowhere.
 *
 * This file is pure assembly: it composes already-built, already-tested
 * pieces (`useSessionListSync` + `groupSessions`/`statusPresentation` for
 * the left rail's live session list; `PiUiElementStore` +
 * `ExtensionActionController` + `PiExtensionRail`/`PiExtensionStatusStrip`/
 * `ContextMeter` + `SessionCostMeterContainer` for the right rail) against
 * the live `DaemonClient` T53A1 provides via `useDaemonClientContext()`. It
 * adds no new feature behaviour of its own beyond the wiring glue documented
 * below.
 *
 * **Why this file does not simply reuse `features/sessions`' `SessionList`/
 * `SessionsScreen` components or `features/rail`'s existing per-kind
 * cards' exact same DOM structure for its own inline rendering.** Those
 * already exist and are reused directly wherever there is no risk of
 * double-mounting the same live data (`ContextMeter`, `PiExtensionRail`,
 * `SessionCostMeterContainer`, `PiUiSessionProvider`) — this file adds no
 * parallel implementation of any of them. The one deliberate exception is
 * the *left* rail's row rendering: `HostSessionsScreen`
 * (`routes/screens/host-sessions-screen.tsx`, a different, already-merged
 * task's owned file, not touched here) mounts `features/sessions`'
 * `SessionsScreen` — which itself renders a `SessionList` — as the centre
 * content of `/h/:serverId/sessions`. `Shell` renders `sessionRail`
 * *simultaneously* with that centre content on every route, including
 * that one, so reusing `SessionList`'s own hard-coded
 * `data-testid`s/row keys there would render two elements sharing the
 * same `session-list-empty`/`session-row-<id>` test id at once on that
 * route (`host-sessions-screen.test.tsx`'s existing `getByTestId` calls
 * require a single match). This file's `SessionRailContent` keeps the
 * same live-data wiring (`useSessionListSync`, the real/pending-connection
 * client factories) and renders `features/sessions`' own `SessionRail`
 * (`SessionRail.tsx`), which owns the rail's head/search/rows/foot and
 * uses the `shell-session-rail-*` test id namespace so the two regions
 * can never collide, on this route or any other.
 */

function toSessionListConnectionState(status: string): SessionListConnectionState {
  if (status === "connected") return "connected";
  if (status === "connecting" || status === "probing" || status === "reconnect-pending") {
    return "connecting";
  }
  return "disconnected";
}

interface SessionRailContentProps {
  serverId: string;
  selectedSessionId?: string;
}

/**
 * The left session rail's live content (plan.md §8.3: "sessions, host
 * state, and session creation"; the create dialog itself and host state
 * stay with `HostSessionsScreen`'s existing centre-route surface — see
 * this file's module doc for why. This rail's job is live cross-route
 * navigation between a host's sessions, always visible next to whatever
 * is open in the centre column).
 */
function SessionRailContent({ serverId, selectedSessionId }: SessionRailContentProps) {
  const { client, info } = useDaemonClientContext();
  const navigate = useNavigate();

  const sessionsClient = useMemo(
    () => (client ? createDaemonSessionsClient(client) : createPendingConnectionSessionsClient()),
    [client],
  );

  const [state, setState] = useState<SessionListState>({ kind: "ready", sessions: [] });
  // A different host has nothing to do with the previous host's session
  // list; never let it carry over across a host switch.
  useEffect(() => {
    setState({ kind: "ready", sessions: [] });
  }, [serverId]);

  const connectionState = toSessionListConnectionState(info.status);
  const sync = useSessionListSync({
    client: sessionsClient,
    connectionState,
    getSessions: () => (state.kind === "ready" ? state.sessions : []),
    onSynced: (sessions) => setState({ kind: "ready", sessions }),
    onSyncFailed: (message) => {
      if (message === SESSIONS_NOT_CONNECTED) return; // not wired up yet, not a real failure
      setState((current) => (current.kind === "ready" ? current : { kind: "error", message }));
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

  // The create-session dialog is `SessionsScreen`'s own
  // (`features/sessions/SessionsScreen.tsx`'s `create-session-trigger`),
  // and that screen is what `/h/:serverId/sessions` mounts. This rail's
  // `New session` action navigates there rather than duplicating a create
  // controller in the shell — the honest wiring, not a second dialog.
  function openCreateSession(): void {
    void navigate({ to: "/h/$serverId/sessions", params: { serverId } });
  }

  return (
    <SessionRail
      state={listState}
      selectedSessionId={selectedSessionId}
      onSelectSession={openSession}
      onNewSession={openCreateSession}
      connection={{ status: info.status, kind: info.kind }}
    />
  );
}

interface ExtensionRailContentProps {
  agentId: string;
  /**
   * The adapted daemon client this rail reads the open session's live
   * snapshot through; its `Live` head status pill and the context-window
   * telemetry below both come from that one snapshot, and an
   * `agent_update` re-renders this rail rather than the whole routed
   * tree.
   */
  chromeClient: SessionChromeClient | null;
}

/**
 * The right Pi extension rail's live content for one open session
 * (plan.md §8.3, §11.5): status-placement elements (`PiExtensionStatusStrip`
 * — `status` is "header or right-rail status" per §11.3, and this column
 * is the right-rail half of that; until this mount, every daemon-
 * synthesized `status` element sat unrendered), pinned fleet/workflow/loop/
 * goal elements (`PiExtensionRail`), the context-window/cache meter
 * (`ContextMeter`), the session cost meter (`SessionCostMeterContainer`) —
 * the exact trio `SessionCostMeterContainer`'s own module doc already names
 * as "ready to mount as a sibling of `ContextMeter` inside `PiExtensionRail`/
 * `Shell`'s `extensionRail` slot" — and, since T112, live `pi_notice`
 * warnings (`PiNoticeBannerContainer`, `features/notices/`): the Pi
 * provider's only channel for out-of-band operator-visible notices,
 * produced by the daemon since long before this task and consumed by
 * nobody until now (found by the P6-W4 import-graph walk, confirmed by
 * `grep -rn pi_notice`).
 *
 * A fresh `PiUiElementStore` is created per `agentId` and a single
 * `agent_stream` subscription feeds both the element store and the action
 * controller's async result channel — but that ownership now lives in
 * `features/extensions/pi-ui-session-context.tsx`'s `PiUiSessionProvider`
 * (which wraps `Shell`, so both this rail and the routed screen see one
 * session), not here: the same live store now feeds the `inline`, `sheet`,
 * and `screen` destinations in the centre column as well as this rail.
 *
 * **Action round trip, wired in full (by the provider this component
 * reads):** each dispatch forwards through
 * `features/extensions/action-transport.ts`'s `sendPiUiActionRequest` to
 * the live `DaemonClient.sendPiUiAction`, and the provider subscribes to
 * `pi.ui.action.response` so the daemon's synchronous ack reaches
 * `ExtensionActionController.ingestActionResponse`. The async half —
 * `agent_stream`'s `pi_ui_action_result` — reaches `ingestAgentStreamEvent`
 * from the same subscription. A dispatch with no connected client is left
 * to settle as the controller's honest `"timeout"`, never a faked success.
 */
function ExtensionRailContent({ agentId, chromeClient }: ExtensionRailContentProps) {
  const { client } = useDaemonClientContext();
  const session = useSessionSnapshot(chromeClient, agentId);
  const piUiSession = usePiUiSession();

  const windowTelemetry = coreTelemetry.deriveContextWindowTelemetry(session?.lastUsage);

  // The provider wrapping `Shell` owns this session's live store and action
  // controller; on every session route this rail renders for, its value is
  // non-null. Guarding keeps a non-session render from throwing rather than
  // silently assuming the invariant.
  if (!piUiSession) {
    return null;
  }

  const { elements, actionController, revision } = piUiSession;

  return (
    <>
      <div className="shell__live-head" data-testid="shell-live-head">
        <span className="shell__live-eyebrow">Live</span>
        <SessionStatusPill session={session} testId="shell-live-status" />
      </div>
      <ContextMeter telemetry={windowTelemetry} />
      <SessionCostMeterContainer agentId={agentId} client={client ?? undefined} />
      <PiNoticeBannerContainer agentId={agentId} client={client ?? undefined} />
      <PiExtensionStatusStrip
        elements={elements}
        agentId={agentId}
        actionController={actionController}
        revision={revision}
      />
      <PiExtensionRail
        elements={elements}
        agentId={agentId}
        actionController={actionController}
        revision={revision}
      />
    </>
  );
}

function RootRouteComponent() {
  // Loose (non-"from") params: this component renders for every route
  // (it is `rootRoute`'s own `component`), so it reads whatever subset of
  // `{ serverId, agentId }` the currently matched leaf route happens to
  // declare, rather than requiring one specific route.
  const params = useParams({ strict: false }) as { serverId?: string; agentId?: string };
  const { serverId, agentId } = params;
  const { client } = useDaemonClientContext();

  // A real `DaemonClient.on` is a generic overload set over every
  // outbound message type, which `SessionSnapshotSource`'s structural
  // shape cannot express; this memo adapts it once, the same way
  // `daemon-agent-turn-client.ts` narrows `DaemonClient` for the
  // composer. It is handed to two small chrome components (the header
  // crumb and the live rail's head), each of which reads it through
  // `useSessionSnapshot` itself so a metadata push re-renders that
  // component, never this route wrapper (and therefore never the
  // transcript).
  const chromeClient = useMemo<SessionChromeClient | null>(() => {
    if (!client) return null;
    return {
      fetchAgent: (sessionId) => client.fetchAgent(sessionId),
      subscribeAgentUpdates: (handler) =>
        client.on("agent_update", (message) => handler({ payload: message.payload })),
      getCheckoutStatus: (cwd) => client.getCheckoutStatus(cwd),
    };
  }, [client]);

  return (
    <PiUiSessionProvider agentId={agentId}>
      <Shell
        sessionRail={
          serverId ? (
            <SessionRailContent serverId={serverId} selectedSessionId={agentId} />
          ) : undefined
        }
        extensionRail={
          agentId ? (
            <ExtensionRailContent agentId={agentId} chromeClient={chromeClient} />
          ) : undefined
        }
        headerWorkspace={<SessionWorkspaceCrumb agentId={agentId ?? null} client={chromeClient} />}
      >
        <Outlet />
      </Shell>
    </PiUiSessionProvider>
  );
}

export const rootRoute = createRootRoute({
  component: RootRouteComponent,
  // T27S2: unknown paths and `notFound()` throws bubble to this instead of
  // TanStack Router's generic default; route load/render failures bubble
  // to `errorComponent`. Both are declared once here so no other route
  // file needs to repeat them.
  notFoundComponent: NotFoundScreen,
  errorComponent: RouteErrorScreen,
});
