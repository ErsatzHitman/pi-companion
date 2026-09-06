import { useMemo } from "react";

import type { Clock, StructuredStorage } from "@picompanion/frontend-core";

import { createBrowserClock } from "../../platform/clock.js";
import { createIndexedDbStructuredStorage } from "../../platform/structured-storage.js";
import { SessionResumeView } from "./SessionResumeView.js";
import { createPendingConnectionSessionResumeClient } from "./pending-connection-session-resume-client.js";
import type { SessionResumeClient } from "./session-resume-client.js";
import { useResumeSession } from "./use-resume-session.js";

export interface SessionResumeScreenProps {
  serverId: string;
  agentId: string;
  /**
   * Defaults to `createPendingConnectionSessionResumeClient()` (T27B3:
   * this app has no live `DaemonClient` wiring yet, matching
   * `SessionsScreen`/`FileBrowserScreen`'s precedent). Pass a real,
   * host-scoped client (`createDaemonSessionResumeClient`) once one
   * exists.
   */
  client?: SessionResumeClient;
  /**
   * Defaults to the real browser adapters (`createBrowserClock`,
   * `createIndexedDbStructuredStorage`) — unlike `client`, these do not
   * depend on a live daemon connection, so there is no placeholder
   * variant for them.
   */
  clock?: Clock;
  structuredStorage?: StructuredStorage;
}

/**
 * The `/h/:serverId/session/:agentId` screen (T27B3, plan.md §8.3): a
 * direct cold-open URL for a session the daemon already knows about,
 * whether the user got there from the session list (T27B2) or typed
 * or bookmarked the link with no prior app state. Kept separate from
 * the route screen file so it is directly testable without going
 * through the router (matching `features/files/file-browser-screen.tsx`'s
 * precedent).
 */
export function SessionResumeScreen({
  serverId,
  agentId,
  client,
  clock,
  structuredStorage,
}: SessionResumeScreenProps) {
  const resolvedClient = useMemo(
    () => client ?? createPendingConnectionSessionResumeClient(),
    [client],
  );
  const resolvedClock = useMemo(() => clock ?? createBrowserClock(), [clock]);
  const resolvedStorage = useMemo(
    () => structuredStorage ?? createIndexedDbStructuredStorage(),
    [structuredStorage],
  );

  const controller = useResumeSession({
    client: resolvedClient,
    sessionId: agentId,
    clock: resolvedClock,
    structuredStorage: resolvedStorage,
  });

  return <SessionResumeView serverId={serverId} agentId={agentId} controller={controller} />;
}
