import { useState } from "react";

import { IconButton } from "../../ui/primitives/index.js";
import type { FileBrowserClient } from "./file-browser-client.js";
import { FileBrowserBreadcrumbs } from "./file-browser-breadcrumbs.js";
import { FileNewFilePopover, FileNewFolderPopover } from "./file-ops-panel.js";
import { FilePopoverButton } from "./file-popover-button.js";
import { FileSearchPanel } from "./file-search-panel.js";
import { FileUploadPanel } from "./file-upload-panel.js";
import type { FileOpsController } from "./use-file-ops.js";
import type { FileUploadController } from "./use-file-upload.js";
import "./files.css";

export interface FileToolbarProps {
  serverId: string;
  agentId: string;
  /** The daemon-side workspace root (protocol `cwd`) this toolbar is scoped to. */
  workspaceRoot: string;
  /** The current directory/file path (`FileExplorerController`'s `state.path`), for the breadcrumb trail. */
  path: string;
  client: FileBrowserClient;
  opsController: FileOpsController;
  uploadController: FileUploadController;
  onRefresh: () => void;
}

/**
 * The files screen's single compact toolbar row (UI-W7, plan.md §12.4):
 * breadcrumbs on the left, icon-button affordances on the right (Upload,
 * New folder, New file, Search, Refresh). Replaces the three
 * always-open panels (`FileUploadPanel`/`FileOpsPanel`/`FileSearchPanel`)
 * that used to stack above the breadcrumbs — every mutation is now
 * reached through a small popover, and search is a toggled inline field
 * rather than a standing one. Each popover/toggle reuses the exact
 * controller `FileBrowserView` already builds (`useFileOps`/
 * `useFileUpload`), so no client wiring changes; `FileUploadPanel` and
 * `FileSearchPanel` themselves are unchanged, just no longer rendered
 * standing open.
 */
export function FileToolbar({
  serverId,
  agentId,
  workspaceRoot,
  path,
  client,
  opsController,
  uploadController,
  onRefresh,
}: FileToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="pc-file-toolbar" data-testid="file-toolbar">
      <div className="pc-file-toolbar__row">
        <FileBrowserBreadcrumbs serverId={serverId} agentId={agentId} path={path} />
        <div className="pc-file-toolbar__actions">
          <FilePopoverButton icon="upload" accessibleName="Upload" testId="file-upload-trigger">
            {() => <FileUploadPanel controller={uploadController} />}
          </FilePopoverButton>
          <FileNewFolderPopover controller={opsController} />
          <FileNewFilePopover controller={opsController} />
          <IconButton
            icon="search"
            accessibleName={searchOpen ? "Hide search" : "Search"}
            aria-pressed={searchOpen}
            data-testid="file-search-toggle"
            onClick={() => setSearchOpen((value) => !value)}
          />
          <IconButton
            icon="refresh"
            accessibleName="Refresh"
            data-testid="file-refresh"
            onClick={onRefresh}
          />
        </div>
      </div>
      {searchOpen ? (
        <div className="pc-file-toolbar__search" data-testid="file-search-panel-wrap">
          <FileSearchPanel
            serverId={serverId}
            agentId={agentId}
            workspaceRoot={workspaceRoot}
            client={client}
          />
        </div>
      ) : null}
    </div>
  );
}
