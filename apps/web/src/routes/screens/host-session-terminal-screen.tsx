import { getRouteApi } from "@tanstack/react-router";

import { TerminalRoute } from "../../features/terminal/index.js";
import { useDaemonClient } from "../../app/daemon-client-context.js";
import { useSessionWorkspaceRoot } from "./use-session-workspace-root.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId/terminal/$terminalId");

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` screen body
 * (T27S2 placeholder, T30A2 real route, T53A5 wires it to the live
 * client). A real `DaemonClient` (T53A1's `useDaemonClient()`)
 * structurally satisfies `SessionTerminalClient` as-is — both the
 * `TerminalRpcClient` slice `TerminalView` mounts and the
 * `listTerminals`/`createTerminal` pair the route resolves a real
 * terminal through (see that interface's own doc comment). `null` (no
 * connection yet) is passed through as `undefined`, which is
 * `TerminalRoute`'s own documented "waiting for a daemon connection"
 * empty state.
 *
 * `workspaceRoot` is the session's real daemon-side `cwd`, resolved
 * through `useSessionWorkspaceRoot` (the same source the header's
 * workspace crumb reads), so the terminal is listed/created against the
 * session's actual workspace rather than a guess. It stays `""` until
 * that resolves, and the route waits rather than issuing the RPC against
 * an empty root.
 */
export function HostSessionTerminalScreen() {
  const { serverId, agentId, terminalId } = routeApi.useParams();
  const client = useDaemonClient();
  const workspaceRoot = useSessionWorkspaceRoot(client, agentId);
  return (
    <TerminalRoute
      serverId={serverId}
      agentId={agentId}
      terminalId={terminalId}
      client={client ?? undefined}
      workspaceRoot={workspaceRoot}
    />
  );
}
