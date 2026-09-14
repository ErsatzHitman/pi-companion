import { Link } from "@tanstack/react-router";

import { Icon } from "../../ui/primitives/index.js";
import type { FileBrowserEntry } from "./file-browser-client.js";
import { FileDownloadAction } from "./file-download-action.js";
import { FileDeleteAction, FileRenameAction } from "./file-ops-panel.js";
import { formatFileSize, formatModifiedAt } from "./format.js";
import type { FileDownloadController } from "./use-file-download.js";
import type { FileOpsController } from "./use-file-ops.js";
import "./files.css";

export interface FileBrowserEntryListProps {
  serverId: string;
  agentId: string;
  /** The daemon-side workspace root (protocol `cwd`) `entries` are relative to. */
  workspaceRoot: string;
  entries: readonly FileBrowserEntry[];
  downloadController: FileDownloadController;
  opsController: FileOpsController;
}

/**
 * The directory listing itself, in the app's `.srow` row grammar
 * (UI-W7, docs/ui-reference/pi-companion-web.html): a kind glyph plus
 * name on the left, mono size/modified metadata right-aligned in a
 * fixed column, and rename/delete (every row) plus download (file rows
 * only) revealed on hover/focus-within instead of standing full-width
 * buttons (`.pc-file-browser__row-actions` in `files.css`; always
 * visible under `@media (hover: none)`, never `display:none`, so touch
 * users keep the affordance). Both directory and file entries are still
 * real links (native keyboard operation, `role="link"` for free) that
 * navigate this route's `*` splat — unchanged from before this pass,
 * including every row's `data-testid`. Kind is still conveyed as text,
 * not colour/icon alone (plan.md §10.5): the glyph is decorative
 * (`aria-hidden`) and a visually-hidden "Folder"/"File" label sits next
 * to it.
 */
export function FileBrowserEntryList({
  serverId,
  agentId,
  workspaceRoot,
  entries,
  downloadController,
  opsController,
}: FileBrowserEntryListProps) {
  return (
    <ul className="pc-file-browser__list" aria-label="Folder contents">
      {entries.map((entry) => {
        const testId = `file-browser-entry-${entry.path || entry.name}`;
        const kindLabel = entry.kind === "directory" ? "Folder" : "File";
        if (entry.kind === "directory") {
          return (
            <li key={entry.path} className="pc-file-browser__row-item">
              <Link
                className="pc-file-browser__row pc-file-browser__row--directory"
                data-testid={testId}
                to="/h/$serverId/session/$agentId/files/$"
                params={{ serverId, agentId, _splat: entry.path }}
              >
                <Icon name="folder" className="pc-file-browser__row-glyph" />
                <span className="pc-file-browser__row-name">{entry.name}</span>
                <span className="pc-visually-hidden">{kindLabel}</span>
                <span className="pc-file-browser__row-meta-group">
                  <span className="pc-file-browser__row-meta">
                    {formatModifiedAt(entry.modifiedAt)}
                  </span>
                </span>
              </Link>
              <span className="pc-file-browser__row-actions">
                <FileRenameAction controller={opsController} path={entry.path} name={entry.name} />
                <FileDeleteAction
                  controller={opsController}
                  path={entry.path}
                  name={entry.name}
                  kind="directory"
                />
              </span>
            </li>
          );
        }
        return (
          <li key={entry.path} className="pc-file-browser__row-item">
            <Link
              className="pc-file-browser__row pc-file-browser__row--file"
              data-testid={testId}
              to="/h/$serverId/session/$agentId/files/$"
              params={{ serverId, agentId, _splat: entry.path }}
            >
              <Icon name="file" className="pc-file-browser__row-glyph" />
              <span className="pc-file-browser__row-name">{entry.name}</span>
              <span className="pc-visually-hidden">{kindLabel}</span>
              <span className="pc-file-browser__row-meta-group">
                <span className="pc-file-browser__row-meta">{formatFileSize(entry.size)}</span>
                <span className="pc-file-browser__row-meta">
                  {formatModifiedAt(entry.modifiedAt)}
                </span>
              </span>
            </Link>
            <span className="pc-file-browser__row-actions">
              <FileRenameAction controller={opsController} path={entry.path} name={entry.name} />
              <FileDownloadAction
                controller={downloadController}
                cwd={workspaceRoot}
                path={entry.path}
                fileName={entry.name}
              />
              <FileDeleteAction
                controller={opsController}
                path={entry.path}
                name={entry.name}
                kind="file"
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
