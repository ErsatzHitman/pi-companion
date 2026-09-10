import { useCallback, useEffect, useState } from "react";
import type { AgentUsage } from "@picompanion/protocol/agent-types";
import { useLocalSearchParams, useRouter } from "expo-router";

import { SessionNavActions } from "../../../../../app-shell/session-nav-actions";
import {
  createTurnRunningSignal,
  type ConnectionStatusSource,
  type DaemonTurnStreamSource,
} from "../../../../../features/sessions/turn-running-signal.js";
import { LiveScreen } from "../../../../../features/live";
import { createContextUsageSignal } from "../../../../../features/telemetry";
import { resolveAgentUsageClient } from "../../../../../app-shell/session-route-daemon-clients";
import { usePiUiElements } from "../../../../../features/extensions/registry-index";
import { useAppCore } from "../../../../core-context";

/**
 * `/h/:serverId/session/:agentId/live` — the Live (A2) screen's route
 * (T350).
 *
 * Matches `navigationIntentToPath({ type: "sessionLive", serverId,
 * agentId })` exactly; `frontend-core`'s `navigation` module gained
 * that intent, and `app-shell/deep-link-routing.ts` its matching
 * branch, in the same change, so this path is a registered destination
 * rather than a string this file invented.
 *
 * Like every other route in this tree it holds no feature logic:
 * `features/live/live-screen.tsx` draws the screen and
 * `live-screen-model.ts` decides what it says. This file supplies the
 * three things only a route can — the params, the live element store,
 * and a router — and nothing else.
 *
 * **The elements come from the same store the session screen reads.**
 * `usePiUiElements(core.piUiSession.store, agentId)` is the identical
 * call `session/[agentId]/index.tsx` makes for its pinned area, over
 * the one `AppCore.piUiSession` instance, so this screen opens no
 * second subscription and can never disagree with the session screen
 * about what is running.
 *
 * **Viewing this screen keeps the feed alive.** The daemon withholds
 * every `agent_stream` for an agent nobody has registered
 * (`setViewedAgentTimeline`, the mechanism T339 wired for the session
 * screen), and leaving the session route runs that route's cleanup,
 * which registers `[]`. Navigating here from the session screen
 * therefore has to re-register, or this screen would show a snapshot
 * frozen at the moment it opened. The effect below is T339's, keyed the
 * same way on the connection `phase`.
 *
 * **T352 mount.** The Context card's numbers come from
 * `features/telemetry`'s `createContextUsageSignal`, over the live
 * `DaemonClient` this route narrows with `resolveAgentUsageClient` —
 * the eighth `resolve*Client` port off that one instance. It listens on
 * `agent_update`, not `agent_stream`: that signal's own module doc
 * records why, measured against the wire schema rather than assumed
 * from the event union's names. With no connection the resolver hands
 * back `undefined`, no subscription opens, and the card truthfully
 * reports an unreported window. `autoCompaction` is deliberately not
 * passed yet — the control that reads and sets it is the context-ring
 * menu's, and until it exists nobody has asked the daemon, so the card
 * omits the clause rather than inventing a default.
 *
 * **Files and Terminal are mounted here**, as `SessionNavActions`,
 * keeping `session-nav-actions-files`/`session-nav-actions-terminal`.
 * They used to sit under the session screen's header; the redesign
 * moves them onto this screen (see `live-screen.tsx`'s doc comment).
 * `apps/android/maestro/files-and-terminal.yaml` reaches both routes by
 * deep link, never by tapping either button, so this move changes
 * nothing that flow does — checked against the flow's own steps, not
 * assumed.
 */
export default function SessionLiveRoute() {
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId: string }>();
  const core = useAppCore();
  const router = useRouter();
  const { elements } = usePiUiElements(core.piUiSession.store, agentId ?? "");

  // The same real per-agent signal the session route drives its
  // composer with (`features/sessions/turn-running-signal.js`), read
  // here so the bar's pill reports this session's actual state rather
  // than a fixed word.
  const [turnRunning, setTurnRunning] = useState(false);
  useEffect(() => {
    if (!agentId) return;
    const daemonSource: DaemonTurnStreamSource = {
      on: (_type, handler) =>
        core.subscribeAgentStream(
          handler as unknown as Parameters<typeof core.subscribeAgentStream>[0],
        ),
    };
    const connectionStatusSource: ConnectionStatusSource = {
      subscribeConnectionStatus: (listener) =>
        core.connection.subscribe((snapshot) => listener({ status: snapshot.phase })),
    };
    const signal = createTurnRunningSignal(
      daemonSource,
      agentId,
      setTurnRunning,
      connectionStatusSource,
    );
    setTurnRunning(signal.getRunning());
    return () => signal.dispose();
  }, [core, agentId]);

  // T339's registration, repeated for this route — see this component's
  // doc comment for why leaving the session screen makes it necessary.
  useEffect(() => {
    if (!agentId) return;
    void core.setViewedAgentTimeline([agentId]);
    return () => {
      void core.setViewedAgentTimeline([]);
    };
  }, [core, agentId]);

  // T352: this session's live token usage. Re-derived on every render
  // like the session route's own `resolve*Client` reads, and effectful
  // only inside the effect below, so a reconnect (a new lifecycle)
  // rebuilds the subscription instead of holding a dead one.
  const usageClient = resolveAgentUsageClient(core.connection);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  useEffect(() => {
    if (!agentId || !usageClient) return;
    const signal = createContextUsageSignal(usageClient, agentId, setUsage);
    setUsage(signal.getUsage());
    return () => signal.dispose();
  }, [usageClient, agentId]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <LiveScreen
      elements={elements}
      turnRunning={turnRunning}
      usage={usage}
      onBack={handleBack}
      navActions={<SessionNavActions serverId={serverId ?? ""} agentId={agentId ?? ""} />}
    />
  );
}
