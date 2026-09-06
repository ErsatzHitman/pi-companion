import { Link } from "@tanstack/react-router";

import type { FileBrowserEntry } from "./file-browser-client.js";
import { FileDownloadAction } from "./file-download-action.js";
import { formatFileSize, formatModifiedAt } from "./format.js";
import type { FileDownloadController } from "./use-file-download.js";
import "./files.css";

export interface FileBrowserEntryListProps {
  serverId: string;
  agentId: string;
  /** The daemon-side workspace root (protocol `cwd`) `entries` are relative to. */
  workspaceRoot: string;
  entries: readonly FileBrowserEntry[];
  downloadController: FileDownloadController;
}

/**
 * The directory listing itself. Both directory and file entries are
 * real links (native keyboard operation, `role="link"` for free) that
 * navigate this route's `*` splat: one level deeper for a folder
 * (T30B1), or onto the same file-explorer route for a file, which
 * `useFileExplorer`'s list-then-read probe (T30B2) resolves into
 * read-only content. Kind and size are always visible text, never
 * colour/icon alone (plan.md §10.5), and size/modified-at read as Geist
 * Mono tabular numerals per `files.css`.
 */
export function FileBrowserEntryList({
  serverId,
  agentId,
  workspaceRoot,
  entries,
  downloadController,
}: FileBrowserEntryListProps) {
  return (
    <ul className="pc-file-browser__list" aria-label="Folder contents">
      {entries.map((entry) => {
        const testId = `file-browser-entry-${entry.path || entry.name}`;
        const kindLabel = entry.kind === "directory" ? "Folder" : "File";
        if (entry.kind === "directory") {
          return (
            <li key={entry.path}>
              <Link
                className="pc-file-browser__row pc-file-browser__row--directory"
                data-testid={testId}
                to="/h/$serverId/session/$agentId/files/$"
                params={{ serverId, agentId, _splat: entry.path }}
              >
                <span className="pc-file-browser__row-name">{entry.name}</span>
                <span className="pc-file-browser__row-kind">{kindLabel}</span>
                <span className="pc-file-browser__row-meta">
                  {formatModifiedAt(entry.modifiedAt)}
                </span>
              </Link>
            </li>
          );
        }
        return (
          <li key={entry.path}>
            <Link
              className="pc-file-browser__row pc-file-browser__row--file"
              data-testid={testId}
              to="/h/$serverId/session/$agentId/files/$"
              params={{ serverId, agentId, _splat: entry.path }}
            >
              <span className="pc-file-browser__row-name">{entry.name}</span>
              <span className="pc-file-browser__row-kind">{kindLabel}</span>
              <span className="pc-file-browser__row-meta">{formatFileSize(entry.size)}</span>
              <span className="pc-file-browser__row-meta">
                {formatModifiedAt(entry.modifiedAt)}
              </span>
            </Link>
            <FileDownloadAction
              controller={downloadController}
              cwd={workspaceRoot}
              path={entry.path}
              fileName={entry.name}
            />
          </li>
        );
      })}
    </ul>
  );
}
