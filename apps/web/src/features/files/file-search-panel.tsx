import { Link } from "@tanstack/react-router";

import {
  Banner,
  Button,
  EmptyState,
  LoadingState,
  SearchField,
} from "../../ui/primitives/index.js";
import type { FileBrowserClient } from "./file-browser-client.js";
import { FILE_SEARCH_MAX_RESULTS, useFileSearch } from "./use-file-search.js";
import "./files.css";

export interface FileSearchPanelProps {
  serverId: string;
  agentId: string;
  /** The daemon-side workspace root (protocol `cwd`) to search within. */
  workspaceRoot: string;
  client: FileBrowserClient;
}

/**
 * Search across the workspace's files by name (T30B5, plan.md §12.4).
 * Built from the `SearchField` primitive plus the same row/link
 * language `FileBrowserEntryList` uses (`.pc-file-browser__row` in
 * `files.css`), so a hit reads exactly like a listing row and navigates
 * with a real `@tanstack/react-router` `Link` onto the same
 * `/files/*` route a folder listing would use — real, keyboard-operable
 * navigation, no client-side-only "selection" state to lose.
 *
 * The field itself is always visible (available from every browser
 * state, same placement rationale as `FileUploadPanel`); results,
 * loading, error, and empty states only render once a non-blank query
 * exists, per `useFileSearch`'s debounced-idle-until-typed state
 * machine.
 */
export function FileSearchPanel({
  serverId,
  agentId,
  workspaceRoot,
  client,
}: FileSearchPanelProps) {
  const { state, setQuery, retry } = useFileSearch({ client, workspaceRoot });
  const trimmedQuery = state.query.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <div className="pc-file-search">
      <SearchField
        label="Search files by name"
        placeholder="Search files…"
        value={state.query}
        onChange={(event) => setQuery(event.target.value)}
        testId="file-search-field"
      />
      {hasQuery && state.status === "searching" ? (
        <LoadingState
          title="Searching…"
          description={`Looking for files matching "${trimmedQuery}"`}
          testId="file-search-loading"
        />
      ) : null}
      {hasQuery && state.status === "error" && state.error ? (
        <div className="pc-file-search__error">
          <Banner tone="danger" message={state.error.description} testId="file-search-error" />
          <Button kind="secondary" onClick={retry}>
            Retry search
          </Button>
        </div>
      ) : null}
      {hasQuery && state.status === "done" && state.results.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`No files match "${trimmedQuery}".`}
          testId="file-search-empty"
        />
      ) : null}
      {hasQuery && state.status === "done" && state.results.length > 0 ? (
        <>
          <ul
            className="pc-file-browser__list pc-file-search__results"
            aria-label={`Search results for ${trimmedQuery}`}
          >
            {state.results.map((entry) => {
              const kindLabel = entry.kind === "directory" ? "Folder" : "File";
              const rowClass =
                entry.kind === "directory"
                  ? "pc-file-browser__row pc-file-browser__row--directory"
                  : "pc-file-browser__row pc-file-browser__row--file";
              return (
                <li key={entry.path}>
                  <Link
                    className={rowClass}
                    data-testid={`file-search-result-${entry.path}`}
                    to="/h/$serverId/session/$agentId/files/$"
                    params={{ serverId, agentId, _splat: entry.path }}
                  >
                    <span className="pc-file-browser__row-name">{entry.path}</span>
                    <span className="pc-file-browser__row-kind">{kindLabel}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {state.truncated ? (
            <Banner
              tone="info"
              message={`Showing the first ${FILE_SEARCH_MAX_RESULTS} matches. Narrow your search to see the rest.`}
              testId="file-search-truncated"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
