import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { AgentUsage } from "@picompanion/protocol/agent-types";
import { extensions, telemetry as coreTelemetry } from "@picompanion/frontend-core";
import { Outlet, createRootRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCore } from "../app/core-context.js";
import { useDaemonClientContext } from "../app/daemon-client-context.js";
import { PiNoticeBannerContainer } from "../features/notices/index.js";
import { ContextMeter, PiExtensionRail, usePiUiRailElements } from "../features/rail/index.js";
import {
  SESSIONS_NOT_CONNECTED,
  createDaemonSessionsClient,
  createPendingConnectionSessionsClient,
  groupSessions,
  statusPresentation,
  useSessionListSync,
} from "../features/sessions/index.js";
import type { SessionListConnectionState, SessionListState } from "../features/sessions/index.js";
import { SessionCostMeterContainer } from "../features/telemetry/index.js";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  StatusIndicator,
} from "../ui/primitives/index.js";
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
 * `ExtensionActionController` + `PiExtensionRail`/`ContextMeter` +
 * `SessionCostMeterContainer` for the right rail) against the live
 * `DaemonClient` T53A1 provides via `useDaemonClientContext()`. It adds no
 * new feature behaviour of its own beyond the wiring glue documented below.
 *
 * **Why this file does not simply reuse `features/sessions`' `SessionList`/
 * `SessionsScreen` components or `features/rail`'s existing per-kind
 * cards' exact same DOM structure for its own inline rendering.** Those
 * already exist and are reused directly wherever there is no risk of
 * double-mounting the same live data (`ContextMeter`, `PiExtensionRail`,
 * `SessionCostMeterContainer`, `usePiUiRailElements`) — this file adds no
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
 * require a single match). This file's `SessionRailContent` reuses that
 * feature's pure, presentation-free logic (`groupSessions`,
 * `statusPresentation`, `useSessionListSync`, the real/pending-connection
 * client factories) and composes the same primitives, but renders its own
 * rows under a `shell-session-rail-*` test id namespace so the two
 * regions can never collide, on this route or any other.
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
 * state, and session creation"; session creation and host state stay
 * with `HostSessionsScreen`'s existing centre-route surface — see this
 * file's module doc for why. This rail's job is live cross-route
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

  if (listState.kind === "loading") {
    return (
      <LoadingState
        title="Loading sessions"
        description="Fetching sessions from this host."
        testId="shell-session-rail-loading"
      />
    );
  }

  if (listState.kind === "error") {
    return (
      <ErrorState
        title="Couldn't load sessions"
        description={listState.message}
        testId="shell-session-rail-error"
      />
    );
  }

  if (listState.sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Create a session on this host to see it here."
        testId="shell-session-rail-empty"
      />
    );
  }

  const groups = groupSessions(listState.sessions);

  return (
    <Section title="Sessions" id="shell-session-rail">
      {listState.stale ? (
        <Banner
          tone="warning"
          message="Reconnecting — this list may be out of date."
          testId="shell-session-rail-stale-banner"
        />
      ) : null}
      {groups.map((group) => (
        <Section key={group.kind} title={group.label}>
          <ul
            className="shell-rail__session-rows"
            data-testid={`shell-session-rail-group-${group.kind}`}
          >
            {group.sessions.map((session) => {
              const presentation = statusPresentation(session);
              const selected = session.id === selectedSessionId;
              return (
                <li key={session.id}>
                  <Button
                    kind="secondary"
                    onClick={() => openSession(session.id)}
                    aria-current={selected ? "true" : undefined}
                    data-testid={`shell-session-rail-row-${session.id}`}
                  >
                    {session.title ?? "Untitled session"}
                    <StatusIndicator
                      label="Status"
                      tone={presentation.tone}
                      statusText={presentation.text}
                    />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </Section>
  );
}

interface ExtensionRailContentProps {
  agentId: string;
}

/**
 * The right Pi extension rail's live content for one open session
 * (plan.md §8.3, §11.5): pinned fleet/workflow/loop/goal elements
 * (`PiExtensionRail`), the context-window/cache meter (`ContextMeter`),
 * the session cost meter (`SessionCostMeterContainer`) — the exact trio
 * `SessionCostMeterContainer`'s own module doc already names as
 * "ready to mount as a sibling of `ContextMeter` inside `PiExtensionRail`/
 * `Shell`'s `extensionRail` slot" — and, since T112, live `pi_notice`
 * warnings (`PiNoticeBannerContainer`, `features/notices/`): the Pi
 * provider's only channel for out-of-band operator-visible notices,
 * produced by the daemon since long before this task and consumed by
 * nobody until now (found by the P6-W4 import-graph walk, confirmed by
 * `grep -rn pi_notice`).
 *
 * A fresh `PiUiElementStore` is created per `agentId` (`useMemo`, T29R1's
 * existing convention) so switching sessions never carries a stale
 * element from the previous one; `client.on("agent_stream", ...)` is
 * this rail's only live input, filtered to this `agentId`, feeding both
 * the element store and the action controller's async result channel.
 *
 * **Known gap, not silently dropped:** `ExtensionActionController`
 * requires a `sendRequest` that actually delivers a
 * `pi.ui.action.request` `SessionInboundMessage` to the daemon.
 * `@picompanion/client`'s `DaemonClient`
 * (`packages/client/src/daemon-client.ts`) has no public method that
 * sends this message type — it was never ported (grep the file for
 * `pi.ui.action`/`pi_ui`: nothing sends one; T51 tracks auditing the full
 * RPC mirror gap this is one instance of). So every pinned element still
 * renders at full fidelity and *reads* every live update, but activating
 * an action button here will dispatch, sit `"pending"` for
 * `ExtensionActionController`'s 60s default timeout, and then settle as
 * `"timeout"` — a real, honestly-surfaced outcome, not a silent no-op or
 * a faked success. Fixing this requires adding a sender to
 * `packages/client`, a different package than this task owns.
 */
function ExtensionRailContent({ agentId }: ExtensionRailContentProps) {
  const { client } = useDaemonClientContext();
  const { platform } = useCore();

  const store = useMemo(() => new extensions.PiUiElementStore(), [agentId]);
  const actionController = useMemo(
    () =>
      new extensions.ExtensionActionController({
        clock: platform.clock,
        getElementRevision: (id) => store.getRevision(id),
        sendRequest: () => {
          // See this component's doc comment: `DaemonClient` has no
          // `pi.ui.action.request` sender yet. Logged once per dispatch
          // rather than silently dropped, so the gap is discoverable
          // from the running app, not just from source.
          platform.logger.warn(
            "Pi UI action dispatch is not supported yet: DaemonClient has no pi.ui.action.request sender (packages/client/src/daemon-client.ts)",
          );
        },
      }),
    [platform, store],
  );

  useEffect(() => {
    if (!client) return undefined;
    return client.on("agent_stream", (message) => {
      if (message.payload.agentId !== agentId) return;
      // `AgentStreamEventPayload` (the wire-validated shape `DaemonClient`
      // actually delivers) and `AgentStreamEvent` (frontend-core's
      // hand-written parser input) describe the same daemon events with
      // independently declared, structurally identical types — the same
      // relationship `daemon-session-cost-client.ts` documents for
      // `AgentSnapshotPayload`. Neither `PiUiElementStore.ingestEvent` nor
      // `ExtensionActionController.ingestAgentStreamEvent` reads anything
      // outside that shared shape.
      const event = message.payload.event as unknown as AgentStreamEvent;
      store.ingestEvent(event);
      actionController.ingestAgentStreamEvent(agentId, event);
    });
  }, [client, agentId, store, actionController]);

  const [usage, setUsage] = useState<AgentUsage | undefined>(undefined);
  useEffect(() => {
    setUsage(undefined);
    if (!client) return undefined;
    return client.on("agent_update", (message) => {
      if (message.payload.kind !== "upsert") return;
      if (message.payload.agent.id !== agentId) return;
      setUsage(message.payload.agent.lastUsage);
    });
  }, [client, agentId]);

  const elements = usePiUiRailElements(store, agentId);
  const windowTelemetry = coreTelemetry.deriveContextWindowTelemetry(usage);

  return (
    <>
      <ContextMeter telemetry={windowTelemetry} />
      <SessionCostMeterContainer agentId={agentId} client={client ?? undefined} />
      <PiNoticeBannerContainer agentId={agentId} client={client ?? undefined} />
      <PiExtensionRail elements={elements} agentId={agentId} actionController={actionController} />
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

  return (
    <Shell
      sessionRail={
        serverId ? (
          <SessionRailContent serverId={serverId} selectedSessionId={agentId} />
        ) : undefined
      }
      extensionRail={agentId ? <ExtensionRailContent agentId={agentId} /> : undefined}
    >
      <Outlet />
    </Shell>
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
