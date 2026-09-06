/**
 * File search state for the files feature (T30B5, plan.md §12.4).
 *
 * The daemon exposes no dedicated file-search RPC (only
 * `FileBrowserClient.listDirectory`, see `file-browser-client.ts`'s
 * docstring and `packages/protocol/src/messages.ts` /
 * `packages/server/src/server/file-explorer/service.ts`, neither of
 * which has a search request). So this hook builds "search across
 * files" out of the existing listing call: a bounded breadth-first walk
 * from the workspace root, matching each entry's name against the query
 * case-insensitively. This still respects plan.md §12.4 ("the frontend
 * must not directly access laptop paths") because every directory read
 * goes through the same daemon RPC the browser already uses — nothing
 * here touches a filesystem directly.
 *
 * The walk is bounded two ways so a huge or deep workspace can never
 * turn one query into an unbounded burst of daemon requests:
 * `FILE_SEARCH_MAX_RESULTS` caps the number of matches collected, and
 * `FILE_SEARCH_MAX_DIRECTORIES_VISITED` caps how many directories are
 * listed. Either bound sets `truncated: true`, which
 * `file-search-panel.tsx` turns into an explicit notice (T30B5's
 * "result count is bounded with an explicit truncation notice"
 * criterion) rather than silently dropping hits.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
  FileBrowserErrorExplanation,
} from "./file-browser-client.js";
import { explainFileBrowserError } from "./file-browser-client.js";
import { authorizeWorkspacePath } from "./path-authorization.js";

/** How long to wait after the last keystroke before searching (debounced input). */
export const FILE_SEARCH_DEBOUNCE_MS = 250;
/** Maximum number of matches collected before the walk stops early. */
export const FILE_SEARCH_MAX_RESULTS = 50;
/** Maximum number of directories listed before the walk stops early. */
export const FILE_SEARCH_MAX_DIRECTORIES_VISITED = 200;

export interface UseFileSearchOptions {
  client: FileBrowserClient;
  /** The daemon-side workspace root (protocol `cwd`) to search within. */
  workspaceRoot: string;
  /** The path to search from, relative to the workspace root. Defaults to the whole workspace (`""`). */
  rootPath?: string;
  /** Overridable for tests; defaults to `FILE_SEARCH_DEBOUNCE_MS`. */
  debounceMs?: number;
}

export type FileSearchStatus = "idle" | "searching" | "done" | "error";

export interface FileSearchError extends FileBrowserErrorExplanation {
  /** The daemon's original, untranslated error message. */
  raw: string;
}

export interface FileSearchState {
  /** The raw, un-debounced text currently in the search field. */
  query: string;
  status: FileSearchStatus;
  results: readonly FileBrowserEntry[];
  truncated: boolean;
  error: FileSearchError | null;
}

export interface FileSearchController {
  state: FileSearchState;
  setQuery: (query: string) => void;
  /** Re-issues the search for the current query (e.g. after an error). */
  retry: () => void;
}

function idleState(query: string): FileSearchState {
  return { query, status: "idle", results: [], truncated: false, error: null };
}

interface SearchOutcome {
  results: FileBrowserEntry[];
  truncated: boolean;
}

/**
 * Bounded breadth-first walk of the workspace tree, matching entry
 * names against `needle`. A failure listing the very first directory
 * (the search root) is a real, reportable error — the same "not
 * connected"/permission/missing-path failures `useFileBrowser` already
 * explains. A failure listing a *nested* directory reached during the
 * walk (e.g. a permission-restricted subfolder) is skipped instead of
 * aborting the whole search, so one bad subtree cannot hide every other
 * match.
 */
async function searchTree(
  client: FileBrowserClient,
  workspaceRoot: string,
  rootPath: string,
  needle: string,
  isStale: () => boolean,
): Promise<SearchOutcome> {
  const queue: string[] = [rootPath];
  const results: FileBrowserEntry[] = [];
  let visited = 0;
  let isRoot = true;

  while (queue.length > 0) {
    if (isStale()) return { results, truncated: false };
    const dir = queue.shift() as string;

    // T41A1a: the single path-authorization door. Applied to EVERY
    // dequeued path — both the initial `rootPath` and every subsequent
    // `entry.path` this same walk queued from a prior `listDirectory`
    // response — before `client.listDirectory` is ever called for it.
    // A rejection for the root is a real, reportable error (mirroring
    // the existing "first directory failed" behavior below); a
    // rejection partway through the walk is skipped like any other
    // bad subtree, so one unauthorized entry can never hide the rest.
    let authorizedDir: string;
    try {
      authorizedDir = authorizeWorkspacePath(dir).path;
    } catch (error) {
      if (isRoot) throw error;
      continue;
    }

    let directory: FileBrowserDirectory;
    try {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential: bounds request volume per query.
      directory = await client.listDirectory(workspaceRoot, authorizedDir);
    } catch (error) {
      if (isRoot) throw error;
      continue;
    }
    isRoot = false;
    visited += 1;

    for (const entry of directory.entries) {
      if (entry.name.toLowerCase().includes(needle)) {
        results.push(entry);
        if (results.length >= FILE_SEARCH_MAX_RESULTS) {
          return { results, truncated: true };
        }
      }
      if (entry.kind === "directory") {
        queue.push(entry.path);
      }
    }

    if (visited >= FILE_SEARCH_MAX_DIRECTORIES_VISITED && queue.length > 0) {
      return { results, truncated: true };
    }
  }

  return { results, truncated: false };
}

export function useFileSearch(options: UseFileSearchOptions): FileSearchController {
  const { client, workspaceRoot, rootPath = "", debounceMs = FILE_SEARCH_DEBOUNCE_MS } = options;
  const [query, setQueryState] = useState("");
  const [state, setState] = useState<FileSearchState>(() => idleState(""));
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [retryToken, setRetryToken] = useState(0);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setState((prev) => ({ ...prev, query: next }));
  }, []);

  useEffect(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // Cancel any in-flight search and go idle; an empty query has no results.
      requestIdRef.current += 1;
      setState(idleState(query));
      return;
    }

    timerRef.current = setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isStale = () => requestIdRef.current !== requestId;

      setState((prev) => ({ ...prev, status: "searching", error: null }));

      searchTree(client, workspaceRoot, rootPath, trimmed.toLowerCase(), isStale).then(
        (outcome) => {
          if (isStale()) return;
          setState((prev) => ({
            ...prev,
            status: "done",
            results: outcome.results,
            truncated: outcome.truncated,
            error: null,
          }));
        },
        (searchError: unknown) => {
          if (isStale()) return;
          const raw = searchError instanceof Error ? searchError.message : String(searchError);
          setState((prev) => ({
            ...prev,
            status: "error",
            results: [],
            truncated: false,
            error: { ...explainFileBrowserError(raw), raw },
          }));
        },
      );
    }, debounceMs);

    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
    // `retryToken` intentionally participates only to force a re-run;
    // its value is never read.
  }, [client, workspaceRoot, rootPath, query, debounceMs, retryToken]);

  return {
    state,
    setQuery,
    retry: () => setRetryToken((token) => token + 1),
  };
}
