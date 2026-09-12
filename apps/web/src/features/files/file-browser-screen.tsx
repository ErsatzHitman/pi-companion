import { useMemo } from "react";

import type { FilePicker } from "@picompanion/frontend-core";

import { useCore } from "../../app/core-context.js";
import type { FileBrowserClient } from "./file-browser-client.js";
import type { FileDownloadClient } from "./file-download-client.js";
import { FileBrowserView } from "./file-browser-view.js";
import type { FileOpsClient } from "./file-ops-client.js";
import type { FileReadClient } from "./file-read-client.js";
import type { FileUploadClient } from "./file-upload-client.js";
import type { FileWriteClient } from "./file-write-client.js";
import { createPendingConnectionFileBrowserClient } from "./pending-connection-file-browser-client.js";
import { createPendingConnectionFileDownloadClient } from "./pending-connection-file-download-client.js";
import { createPendingConnectionFileOpsClient } from "./pending-connection-file-ops-client.js";
import { createPendingConnectionFileReadClient } from "./pending-connection-file-read-client.js";
import { createPendingConnectionFileUploadClient } from "./pending-connection-file-upload-client.js";
import { createPendingConnectionFileWriteClient } from "./pending-connection-file-write-client.js";
import { useFileExplorer } from "./use-file-explorer.js";

export interface FileBrowserScreenProps {
  serverId: string;
  agentId: string;
  /** The route's `*` splat: the path to list, relative to the workspace root. */
  path: string;
  /**
   * The daemon-side workspace root (protocol `cwd`) to browse. Defaults
   * to `""` for callers/tests that inject a fake client; the real route
   * (`routes/screens/host-session-files-screen.tsx`) resolves the open
   * session's `cwd` through `useSessionWorkspaceRoot` and passes it here.
   * While unresolved, the pending-connection client below rejects every
   * request, so the empty default never reaches a real daemon with the
   * wrong root.
   */
  workspaceRoot?: string;
  /**
   * Defaults to `createPendingConnectionFileBrowserClient()` (T30B1:
   * this app has no live `DaemonClient` wiring yet). Pass a real,
   * session-scoped client once one exists.
   */
  client?: FileBrowserClient;
  /**
   * Defaults to `createPendingConnectionFileReadClient()` (T30B2: same
   * reason as `client` above). Pass a real, session-scoped client once
   * one exists — typically the same `DaemonClient` instance passed as
   * `client`, since it satisfies both interfaces structurally.
   */
  readClient?: FileReadClient;
  /**
   * Defaults to `createPendingConnectionFileWriteClient()` (T30B3: same
   * reason as `readClient` above). Pass a real, session-scoped client
   * once one exists — typically the same `DaemonClient` instance passed
   * as `client`/`readClient`, since it satisfies all three interfaces
   * structurally.
   */
  writeClient?: FileWriteClient;
  /**
   * Defaults to `createPendingConnectionFileUploadClient()` (T30B4: same
   * reason as `writeClient` above). Pass a real, session-scoped client
   * once one exists — typically the same `DaemonClient` instance passed
   * as every other client prop here, since it satisfies this interface
   * structurally too.
   */
  uploadClient?: FileUploadClient;
  /**
   * Defaults to `createPendingConnectionFileDownloadClient()` (T30B4:
   * same reason as `uploadClient` above).
   */
  downloadClient?: FileDownloadClient;
  /**
   * Defaults to `createPendingConnectionFileOpsClient()` (same reason as
   * `uploadClient` above). A real, session-scoped client — typically the
   * same `DaemonClient` passed as every other client prop here, since
   * `mkdir`/`createFile`/`renameEntry`/`deleteEntry` satisfy
   * `FileOpsClient` structurally.
   */
  opsClient?: FileOpsClient;
  /**
   * The daemon's HTTP origin (T30B4). Defaults to `null` — a download
   * still round-trips its token request against a real `downloadClient`,
   * it just cannot fetch the bytes. The real route
   * (`routes/screens/host-session-files-screen.tsx`) derives it off the
   * connected `HostProfile` via `resolveDirectHttpOrigin`, which is
   * `null` on a relay connection by design (a relay has no direct HTTP
   * endpoint; see `attachment-image-resolver.ts`).
   */
  downloadOrigin?: string | null;
  /**
   * Defaults to `useCore().platform.filePicker` — unlike the daemon
   * clients above, file picking needs no daemon connection, so this one
   * is real (not a pending placeholder) out of the box.
   */
  filePicker?: FilePicker;
}

/**
 * Wires `useFileExplorer` and `FileBrowserView` together for
 * `HostSessionFilesScreen`. Kept separate from the route screen file so
 * it is directly testable without going through the router.
 */
export function FileBrowserScreen({
  serverId,
  agentId,
  path,
  workspaceRoot = "",
  client,
  readClient,
  writeClient,
  uploadClient,
  downloadClient,
  opsClient,
  downloadOrigin = null,
  filePicker,
}: FileBrowserScreenProps) {
  const { platform } = useCore();
  const resolvedClient = useMemo(
    () => client ?? createPendingConnectionFileBrowserClient(),
    [client],
  );
  const resolvedReadClient = useMemo(
    () => readClient ?? createPendingConnectionFileReadClient(),
    [readClient],
  );
  const resolvedWriteClient = useMemo(
    () => writeClient ?? createPendingConnectionFileWriteClient(),
    [writeClient],
  );
  const resolvedUploadClient = useMemo(
    () => uploadClient ?? createPendingConnectionFileUploadClient(),
    [uploadClient],
  );
  const resolvedDownloadClient = useMemo(
    () => downloadClient ?? createPendingConnectionFileDownloadClient(),
    [downloadClient],
  );
  const resolvedOpsClient = useMemo(
    () => opsClient ?? createPendingConnectionFileOpsClient(),
    [opsClient],
  );
  const resolvedFilePicker = filePicker ?? platform.filePicker;
  const controller = useFileExplorer({
    client: resolvedClient,
    readClient: resolvedReadClient,
    workspaceRoot,
    path,
  });

  return (
    <FileBrowserView
      serverId={serverId}
      agentId={agentId}
      workspaceRoot={workspaceRoot}
      controller={controller}
      client={resolvedClient}
      writeClient={resolvedWriteClient}
      readClient={resolvedReadClient}
      uploadClient={resolvedUploadClient}
      downloadClient={resolvedDownloadClient}
      opsClient={resolvedOpsClient}
      downloadOrigin={downloadOrigin}
      filePicker={resolvedFilePicker}
    />
  );
}
