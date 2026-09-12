import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import { FileBrowserScreen } from "../../features/files/index.js";
import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { resolveDirectHttpOrigin } from "../../features/transcript/attachment-image-resolver.js";
import { useSessionWorkspaceRoot } from "./use-session-workspace-root.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId/files/$");

/**
 * `/h/:serverId/session/:agentId/files/*` screen body (T30B1 real
 * feature, T53A5 wires it to the live client). The route's `_splat` is
 * the path being browsed, relative to the session's workspace root.
 *
 * A real `DaemonClient` (T53A1's `useDaemonClient()`) structurally
 * satisfies `FileBrowserClient`/`FileReadClient`/`FileWriteClient`/
 * `FileUploadClient`/`FileDownloadClient`/`FileOpsClient` as-is (see each
 * client module's own doc comment), so the one live client is passed for
 * every client prop. `null` (no connection yet) is passed through as
 * `undefined`, which is `FileBrowserScreen`'s own documented default —
 * it falls back to its `createPendingConnectionFile*Client()` stand-ins,
 * so "no connection" renders that feature's existing not-connected
 * explanation rather than crashing (this task's "renders a sensible
 * state when no connection exists" criterion).
 *
 * `workspaceRoot` is the session's real daemon-side `cwd`, resolved
 * through `useSessionWorkspaceRoot` (the same `fetchAgent` ->
 * `AgentSnapshotPayload.cwd` source the app shell's
 * `SessionWorkspaceCrumb` reads — no new fetch). It stays `""` until that
 * resolves, which is `FileBrowserScreen`'s own pending default.
 *
 * `downloadOrigin` reuses `HostSessionScreen`'s exact derivation off
 * `hostController.getCurrentProfile()`/`info.kind` and
 * `resolveDirectHttpOrigin`: `null` on a relay connection (or with no
 * connection yet) is by design — a relay proxies only the encrypted
 * WebSocket and has no direct HTTP endpoint to fetch bytes from (see
 * `attachment-image-resolver.ts`'s module doc).
 */
export function HostSessionFilesScreen() {
  const { serverId, agentId, _splat } = routeApi.useParams();
  const { client, info, hostController } = useDaemonClientContext();
  const workspaceRoot = useSessionWorkspaceRoot(client, agentId);

  // Mirrors `HostSessionScreen`'s `downloadOrigin` memo: `getCurrentProfile()`
  // is a synchronous getter outside the `info` snapshot, so it is read fresh
  // against the two `info` fields that actually change when the active
  // profile does.
  const downloadOrigin = useMemo(
    () => resolveDirectHttpOrigin(hostController?.getCurrentProfile() ?? null, info.kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getCurrentProfile()` is read fresh; `info.profileId`/`info.kind` are what change with it.
    [hostController, info.profileId, info.kind],
  );

  return (
    <FileBrowserScreen
      serverId={serverId}
      agentId={agentId}
      path={_splat ?? ""}
      workspaceRoot={workspaceRoot}
      client={client ?? undefined}
      readClient={client ?? undefined}
      writeClient={client ?? undefined}
      uploadClient={client ?? undefined}
      downloadClient={client ?? undefined}
      opsClient={client ?? undefined}
      downloadOrigin={downloadOrigin}
    />
  );
}
