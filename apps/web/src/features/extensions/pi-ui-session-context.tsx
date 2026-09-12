import type { DaemonClient } from "@picompanion/client";
import { extensions } from "@picompanion/frontend-core";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { useCore } from "../../app/core-context.js";
import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { usePiUiRailElements } from "../rail/use-pi-ui-rail-elements.js";
import { sendPiUiActionRequest, subscribePiUiActionResponses } from "./action-transport.js";

type PiUiElementStore = InstanceType<typeof extensions.PiUiElementStore>;

/** One open session's live Pi UI Bridge ownership, shared by every placement destination. */
export interface PiUiSessionValue {
  /** The session/agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Live elements in the store's stable insertion order, across every placement. */
  elements: readonly PiUiElement[];
  /** Dispatches and tracks this agent's Pi UI actions (T21C). */
  actionController: extensions.ExtensionActionController;
  /** The live store the elements/action revision are read from. */
  store: PiUiElementStore;
  /** This agent's current Pi UI Bridge revision, for the dev-mode stale-state badge. */
  revision: number;
}

const PiUiSessionContext = createContext<PiUiSessionValue | null>(null);

/**
 * The current session's live Pi UI Bridge ownership, or `null` on a route
 * with no session in context.
 */
export function usePiUiSession(): PiUiSessionValue | null {
  return useContext(PiUiSessionContext);
}

export interface PiUiSessionProviderProps {
  /** The open session's agent id, or `undefined` on a non-session route. */
  agentId: string | undefined;
  children: ReactNode;
  /**
   * Test seam: overrides the live client the provider reads from
   * `DaemonClientContext`. Production passes nothing, so the context client
   * is used. `null` is a real override (no client), not "unset".
   */
  client?: DaemonClient | null;
}

/**
 * Owns the one live `PiUiElementStore` + `ExtensionActionController` pair
 * for the open session and publishes it to every placement destination
 * through context (plan.md §11.4, §12.3).
 *
 * Before this provider, that store/controller/subscription lived inside
 * `routes/root-route.tsx`'s `ExtensionRailContent`, which is the right
 * rail's own component. The right rail is only one of five placement
 * destinations; `inline`, `sheet`, and `screen` elements need the same live
 * store in the *centre* column, and a second store/subscription would give
 * each destination a different view of the same stream (rail cards would
 * miss an element the centre column just ingested, and an action dispatched
 * from a sheet would never settle against the rail's controller). Hoisting
 * the ownership one level up — `RootRouteComponent` wraps `Shell`, so both
 * the `extensionRail` slot and the routed screen sit inside this provider —
 * is what keeps one store, one controller, and one subscription for a
 * session.
 *
 * A fresh store is created per `agentId` (`useMemo`), so switching sessions
 * never carries a stale element from the previous one; `client.on(
 * "agent_stream")` is the only live input, filtered to this agent, feeding
 * both the element store and the action controller's async result channel,
 * exactly as the rail's own component did before this move.
 *
 * With no `agentId` (every non-session route) the provider still renders
 * `children` and publishes `null`, so a screen that is not a session never
 * needs its own guard just to avoid a throw.
 */
export function PiUiSessionProvider({
  agentId,
  children,
  client: clientOverride,
}: PiUiSessionProviderProps) {
  const { client: contextClient } = useDaemonClientContext();
  const { platform } = useCore();
  const client = clientOverride !== undefined ? clientOverride : contextClient;

  const store = useMemo(() => new extensions.PiUiElementStore(), [agentId]);
  // `usePiUiRailElements` is a hook and must be called unconditionally, so
  // the no-session case reads a scoped-but-unused empty agent id.
  const scopedAgentId = agentId ?? "";

  const actionController = useMemo(
    () =>
      new extensions.ExtensionActionController({
        clock: platform.clock,
        getElementRevision: (id) => store.getRevision(id),
        sendRequest: (message) => sendPiUiActionRequest(client, message),
      }),
    [client, platform, store],
  );

  useEffect(() => {
    if (!client || !agentId) {
      return undefined;
    }
    // The synchronous ack (`pi.ui.action.response`) and the async result
    // (`agent_stream`'s `pi_ui_action_result`, fed below) are the two
    // channels `ExtensionActionController` settles dispatches from.
    const unsubscribeResponses = subscribePiUiActionResponses(client, actionController);
    const unsubscribeAgentStream = client.on("agent_stream", (message) => {
      if (message.payload.agentId !== agentId) return;
      // `AgentStreamEventPayload` (the wire-validated shape `DaemonClient`
      // delivers) and `AgentStreamEvent` (frontend-core's parser input)
      // describe the same daemon events with independently declared,
      // structurally identical types — the same relationship the rail's
      // own subscription documented before this move.
      const event = message.payload.event as unknown as AgentStreamEvent;
      store.ingestEvent(event);
      actionController.ingestAgentStreamEvent(agentId, event);
    });
    return () => {
      unsubscribeResponses();
      unsubscribeAgentStream();
    };
  }, [client, agentId, store, actionController]);

  const elements = usePiUiRailElements(store, scopedAgentId);
  const revision = store.getRevision(scopedAgentId);

  const value = useMemo<PiUiSessionValue | null>(
    () => (agentId ? { agentId, elements, actionController, store, revision } : null),
    [agentId, elements, actionController, store, revision],
  );

  return <PiUiSessionContext.Provider value={value}>{children}</PiUiSessionContext.Provider>;
}
