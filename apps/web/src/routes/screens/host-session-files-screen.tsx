import { getRouteApi } from "@tanstack/react-router";

import { FileBrowserScreen } from "../../features/files/index.js";
import { useDaemonClient } from "../../app/daemon-client-context.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId/files/$");

/**
 * `/h/:serverId/session/:agentId/files/*` screen body (T30B1 real
 * feature, T53A5 wires it to the live client). The route's `_splat` is
 * the path being browsed, relative to the session's workspace root.
 *
 * A real `DaemonClient` (T53A1's `useDaemonClient()`) structurally
 * satisfies `FileBrowserClient`/`FileReadClient`/`FileWriteClient`/
 * `FileUploadClient`/`FileDownloadClient` as-is (see each client
 * module's own doc comment), so the one live client is passed for all
 * five props. `null` (no connection yet) is passed through as
 * `undefined`, which is `FileBrowserScreen`'s own documented default —
 * it falls back to its `createPendingConnectionFile*Client()` stand-ins,
 * so "no connection" renders that feature's existing not-connected
 * explanation rather than crashing (this task's "renders a sensible
 * state when no connection exists" criterion).
 *
 * `workspaceRoot` and `downloadOrigin` stay at `FileBrowserScreen`'s own
 * defaults: resolving a session's real daemon-side workspace root
 * depends on `packages/frontend-core/src/sessions/index.ts`, still a
 * Phase 1 stub (see that module's doc comment), and the connected
 * daemon's HTTP origin has no resolver anywhere in this app yet (see
 * `file-browser-screen.tsx`'s own `downloadOrigin` doc comment) — both
 * are outside the one file this task owns.
 */
export function HostSessionFilesScreen() {
  const { serverId, agentId, _splat } = routeApi.useParams();
  const client = useDaemonClient() ?? undefined;
  return (
    <FileBrowserScreen
      serverId={serverId}
      agentId={agentId}
      path={_splat ?? ""}
      client={client}
      readClient={client}
      writeClient={client}
      uploadClient={client}
      downloadClient={client}
    />
  );
}
