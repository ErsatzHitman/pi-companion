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
import { FileBrowserBreadcrumbs } from "./file-browser-breadcrumbs.js";
import { FileBrowserEntryList } from "./file-browser-entry-list.js";
import { FileEditorPanel } from "./file-editor-panel.js";
import type { FileReadClient } from "./file-read-client.js";
import { FileSearchPanel } from "./file-search-panel.js";
import { FileUploadPanel } from "./file-upload-panel.js";
import type { FileUploadClient } from "./file-upload-client.js";
import type { FileWriteClient } from "./file-write-client.js";
import { useFileDownload } from "./use-file-download.js";
import type { FileExplorerController } from "./use-file-explorer.js";
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
  /** The daemon's HTTP origin, or `null` until a route can resolve it (`use-file-download.ts`). */
  downloadOrigin: string | null;
  uploadClient: FileUploadClient;
  filePicker: FilePicker;
}

/**
 * The `/h/:serverId/session/:agentId/files/*` screen body. Breadcrumbs
 * are shown for every status (directory or file) so a file can always
 * be navigated back up to its folder; the body below them is one of
 * loading/error/empty-folder/directory-listing/file-editor, composed
 * entirely from `ui/primitives` (plan.md §10.1 — no new one-off styled
 * primitive here). Directory listing is T30B1's scope; the file body
 * (`FileEditorPanel`, wrapping T30B2's read-only `FileContentView` with
 * T30B3's edit/save path) is T30B2/T30B3's (plan.md §12.4). Saving
 * reloads through `controller.retry` so the file view always reflects
 * what the daemon actually persisted, not just the submitted buffer.
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
  downloadOrigin,
  uploadClient,
  filePicker,
}: FileBrowserViewProps) {
  const { state, retry } = controller;
  const downloadController = useFileDownload({ client: downloadClient, downloadOrigin });
  const uploadController = useFileUpload({ client: uploadClient, filePicker });

  return (
    <Section title="Files" className="pc-file-browser">
      <FileUploadPanel controller={uploadController} />
      <FileSearchPanel
        serverId={serverId}
        agentId={agentId}
        workspaceRoot={workspaceRoot}
        client={client}
      />
      <FileBrowserBreadcrumbs serverId={serverId} agentId={agentId} path={state.path} />
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
