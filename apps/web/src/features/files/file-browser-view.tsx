import type { FilePicker } from "@picompanion/frontend-core";

import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from "../../ui/primitives/index.js";
import type { FileBrowserClient } from "./file-browser-client.js";
import type { FileDownloadClient } from "./file-download-client.js";
import { FileBrowserEntryList } from "./file-browser-entry-list.js";
import { FileEditorPanel } from "./file-editor-panel.js";
import { FileToolbar } from "./file-toolbar.js";
import type { FileOpsClient } from "./file-ops-client.js";
import type { FileReadClient } from "./file-read-client.js";
import type { FileUploadClient } from "./file-upload-client.js";
import type { FileWriteClient } from "./file-write-client.js";
import { useFileDownload } from "./use-file-download.js";
import type { FileExplorerController } from "./use-file-explorer.js";
import { useFileOps } from "./use-file-ops.js";
import { useFileUpload } from "./use-file-upload.js";
import "./files.css";

export interface FileBrowserViewProps {
  serverId: string;
  agentId: string;
  /** The daemon-side workspace root (protocol `cwd`) this browser/editor is scoped to. */
  workspaceRoot: string;
  controller: FileExplorerController;
  /** The same listing client `controller` was built from (T30B5's search reuses it). */
  client: FileBrowserClient;
  writeClient: FileWriteClient;
  /**
   * The same read client `controller` was built from. Passed through to
   * `FileEditorPanel` for T41A2's conflict-resolution flow, which
   * re-reads the daemon's current content once a save conflicts.
   */
  readClient: FileReadClient;
  downloadClient: FileDownloadClient;
  opsClient: FileOpsClient;
  /** The daemon's HTTP origin, or `null` for a relay/no connection (`use-file-download.ts`). */
  downloadOrigin: string | null;
  uploadClient: FileUploadClient;
  filePicker: FilePicker;
}

/**
 * The `/h/:serverId/session/:agentId/files/*` screen body. A compact
 * `FileToolbar` (breadcrumbs plus upload/new-folder/new-file/search/
 * refresh) sits above the body, which is one of
 * loading/error/empty-folder/directory-listing/file-editor, composed
 * entirely from `ui/primitives` (plan.md §10.1 — no new one-off styled
 * primitive here). The toolbar is shown for every status (directory or
 * file) so its breadcrumbs can always navigate a file back up to its
 * folder. Directory listing is T30B1's scope; the file body
 * (`FileEditorPanel`, wrapping T30B2's read-only `FileContentView` with
 * T30B3's edit/save path) is T30B2/T30B3's (plan.md §12.4). Saving
 * reloads through `controller.retry` so the file view always reflects
 * what the daemon actually persisted, not just the submitted buffer.
 *
 * UI-W7: the mutation affordances (`useFileOps`) and the upload
 * affordance (`useFileUpload`) are still built once, here, and passed
 * down — `FileToolbar` and `FileBrowserEntryList` only render UI for
 * them, they don't own the controllers.
 */
export function FileBrowserView({
  serverId,
  agentId,
  workspaceRoot,
  controller,
  client,
  writeClient,
  readClient,
  downloadClient,
  opsClient,
  downloadOrigin,
  uploadClient,
  filePicker,
}: FileBrowserViewProps) {
  const { state, retry } = controller;
  const downloadController = useFileDownload({ client: downloadClient, downloadOrigin });
  const uploadController = useFileUpload({ client: uploadClient, filePicker });
  const opsController = useFileOps({ client: opsClient, workspaceRoot, onChanged: retry });

  return (
    <Section title="Files" className="pc-file-browser">
      <FileToolbar
        serverId={serverId}
        agentId={agentId}
        workspaceRoot={workspaceRoot}
        path={state.path}
        client={client}
        opsController={opsController}
        uploadController={uploadController}
        onRefresh={retry}
      />
      {state.status === "loading" ? (
        <LoadingState
          title="Loading…"
          description={state.path ? `Opening ${state.path}` : "Listing the workspace root"}
          testId="file-browser-loading"
        />
      ) : null}
      {state.status === "error" && state.error ? (
        <div className="pc-file-browser__error">
          <ErrorState
            title={state.error.title}
            description={state.error.description}
            testId="file-browser-error"
          />
          <Button kind="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.status === "directory" && state.directory ? (
        state.directory.entries.length === 0 ? (
          <EmptyState
            title="This folder is empty"
            description="There is nothing to show here yet."
            testId="file-browser-empty"
          />
        ) : (
          <FileBrowserEntryList
            serverId={serverId}
            agentId={agentId}
            workspaceRoot={workspaceRoot}
            entries={state.directory.entries}
            downloadController={downloadController}
            opsController={opsController}
          />
        )
      ) : null}
      {state.status === "file" && state.file ? (
        <FileEditorPanel
          file={state.file}
          workspaceRoot={workspaceRoot}
          writeClient={writeClient}
          readClient={readClient}
          downloadController={downloadController}
          onSaved={retry}
        />
      ) : null}
    </Section>
  );
}
