import { getRouteApi } from "@tanstack/react-router";

import { TerminalRoute } from "../../features/terminal/index.js";
import { useDaemonClient } from "../../app/daemon-client-context.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId/terminal/$terminalId");

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` screen body
 * (T27S2 placeholder, T30A2 real route, T53A5 wires it to the live
 * client). A real `DaemonClient` (T53A1's `useDaemonClient()`)
 * structurally satisfies `terminal.TerminalRpcClient` as-is (see that
 * interface's own doc comment). `null` (no connection yet) is passed
 * through as `undefined`, which is `TerminalRoute`'s own documented
 * "waiting for a daemon connection" empty state — this task's "renders a
 * sensible state when no connection exists" criterion.
 */
export function HostSessionTerminalScreen() {
  const { serverId, agentId, terminalId } = routeApi.useParams();
  const client = useDaemonClient() ?? undefined;
  return (
    <TerminalRoute serverId={serverId} agentId={agentId} terminalId={terminalId} client={client} />
  );
}
