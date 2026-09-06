/**
 * File browser navigation state and orchestration (T35A1, plan.md
 * §6/§7/§9/§12.4).
 *
 * Owns every decision `files-screen.tsx` renders: the current path, the
 * breadcrumb trail, how entries are ordered, and the transitions between
 * loading/ready/error. This module imports neither React, React Native,
 * Expo, DOM types, nor browser globals — it is plain, RN-free
 * orchestration over the injected `FileBrowserClient`
 * (`file-browser-client.ts`), testable directly in this workspace's
 * plain `vitest`, exactly like `../sessions/session-resume-controller.ts`.
 *
 * Scope: this task browses directories only. A file row is shown (name,
 * size, modified) but is not navigable — Android has no daemon file
 * *read* RPC wired yet this wave (unlike `apps/web/src/features/files/
 * use-file-explorer.ts`, which probes a failed `listDirectory` into a
 * `readFile` fallback). Reading file content is a follow-on task's job;
 * this controller only ever issues `listDirectory` calls.
 *
 * Every navigation re-lists through `client.listDirectory` — there is no
 * local cache a stale listing could be served from — which is what lets
 * "vanished between listing and open" be a real, distinct daemon
 * response (`explainFileBrowserError`'s `context: "open"` branch) rather
 * than a client-side guess.
 */
import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import {
  FILE_BROWSER_TIMEOUT,
  explainFileBrowserError,
  type FileBrowserClient,
  type FileBrowserDirectory,
  type FileBrowserEntry,
  type FileBrowserErrorExplanation,
} from "./file-browser-client.js";

export type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
  FileBrowserEntryKind,
} from "./file-browser-client.js";

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Strips empty/`"."` segments so equivalent paths compare and dedupe cleanly. Mirrors web's `normalizeFileBrowserPath`. */
export function normalizeFilesPath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

export function pathSegments(path: string): string[] {
  const normalized = normalizeFilesPath(path);
  return normalized.length === 0 ? [] : normalized.split("/");
}

/** The parent directory's path, or `null` when `path` is already the workspace root. */
export function parentFilesPath(path: string): string | null {
  const segments = pathSegments(path);
  if (segments.length === 0) return null;
  return segments.slice(0, -1).join("/");
}

export interface FilesBreadcrumb {
  readonly label: string;
  /** The path this crumb navigates to (`""` is the workspace root). */
  readonly path: string;
  readonly isCurrent: boolean;
}

/**
 * Builds the breadcrumb trail for `path`, root first. Matches web's
 * `FileBrowserBreadcrumbs`' vocabulary — the root crumb reads "Files",
 * every other crumb is its own path segment.
 */
export function buildFilesBreadcrumbs(path: string): FilesBreadcrumb[] {
  const segments = pathSegments(path);
  const crumbs: FilesBreadcrumb[] = [
    { label: "Files", path: "", isCurrent: segments.length === 0 },
  ];
  segments.forEach((segment, index) => {
    const crumbPath = segments.slice(0, index + 1).join("/");
    crumbs.push({ label: segment, path: crumbPath, isCurrent: index === segments.length - 1 });
  });
  return crumbs;
}

/** Directories before files, then case-insensitive alphabetical within each group — never the daemon's raw, unspecified order. */
export function sortFilesEntries(entries: readonly FileBrowserEntry[]): FileBrowserEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// ---------------------------------------------------------------------------
// Listing state
// ---------------------------------------------------------------------------

export type FilesListStatus = "loading" | "ready" | "error";

export interface FilesListError extends FileBrowserErrorExplanation {
  /** The daemon's original, untranslated error message. */
  raw: string;
}

export interface FilesListState {
  readonly path: string;
  readonly status: FilesListStatus;
  readonly entries: readonly FileBrowserEntry[] | null;
  readonly error: FilesListError | null;
}

export function initialFilesListState(path: string): FilesListState {
  return { path: normalizeFilesPath(path), status: "loading", entries: null, error: null };
}

export function beginFilesListing(path: string): FilesListState {
  return initialFilesListState(path);
}

export function completeFilesListing(
  path: string,
  directory: FileBrowserDirectory,
): FilesListState {
  return {
    path: normalizeFilesPath(path),
    status: "ready",
    entries: sortFilesEntries(directory.entries),
    error: null,
  };
}

/**
 * `context` is `"open"` when this failure came from navigating into an
 * entry this same screen just listed (rather than the initial listing
 * of `path` itself) — see `explainFileBrowserError`'s doc for why that
 * changes the message.
 */
export function failFilesListing(
  path: string,
  rawMessage: string,
  context: "list" | "open" = "list",
): FilesListState {
  return {
    path: normalizeFilesPath(path),
    status: "error",
    entries: null,
    error: { ...explainFileBrowserError(rawMessage, context), raw: rawMessage },
  };
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

export const DEFAULT_FILES_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Backed by the ambient timer globals — mirrors `../sessions/
 * session-resume-controller.ts`'s `createSessionResumeClock` (see that
 * file's doc for why this app has no shared `Clock` adapter yet under
 * `apps/android/src/platform/` to import instead).
 */
export function createFilesClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle,
    clearTimeout: (handle) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback, intervalMs) =>
      setInterval(callback, intervalMs) as unknown as TimerHandle,
    clearInterval: (handle) => {
      clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  };
}

/**
 * Races `client.listDirectory(cwd, path)` against `clock`'s timer.
 * Rejects with `FILE_BROWSER_TIMEOUT` if the timer fires first; either
 * way, the loser is never applied (the timer is cleared on a real
 * response, and a late response after a timeout is simply ignored by
 * this promise, which has already settled).
 */
export function listDirectoryWithTimeout(
  client: FileBrowserClient,
  cwd: string,
  path: string,
  clock: Clock,
  timeoutMs: number = DEFAULT_FILES_REQUEST_TIMEOUT_MS,
): Promise<FileBrowserDirectory> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(FILE_BROWSER_TIMEOUT));
    }, timeoutMs);

    client.listDirectory(cwd, path).then(
      (directory) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(directory);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface FilesBrowserControllerOptions {
  client: FileBrowserClient;
  /** The daemon-side workspace root this listing is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** The path to list first, relative to `workspaceRoot` (`""` is the root). Defaults to `""`. */
  initialPath?: string;
  clock?: Clock;
  timeoutMs?: number;
}

export interface FilesBrowserController {
  getState: () => FilesListState;
  subscribe: (listener: (state: FilesListState) => void) => () => void;
  /** Lists `path` directly (used for breadcrumb navigation and going up). Never a navigation-context error — the target wasn't a row this screen just showed. */
  load: (path: string) => void;
  /** Navigates into `entry` (must be a directory — callers never invoke this for a file row, since files aren't navigable this wave). Failures use the "open" error context. */
  open: (entry: FileBrowserEntry) => void;
  /** Navigates to the current directory's parent, or does nothing at the workspace root. */
  up: () => void;
  /** Re-issues the listing request for the current path, in its current context. */
  retry: () => void;
}

/**
 * Builds a `FilesBrowserController` — the "injected fake daemon RPC
 * client" seam `files-model.test.ts` drives directly to prove entering
 * a directory, going up, and the breadcrumb path all as real state
 * transitions, with no emulator and no `react-native` import.
 */
export function createFilesBrowserController(
  options: FilesBrowserControllerOptions,
): FilesBrowserController {
  const { client, workspaceRoot } = options;
  const clock = options.clock ?? createFilesClock();
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILES_REQUEST_TIMEOUT_MS;

  let state = initialFilesListState(options.initialPath ?? "");
  let lastContext: "list" | "open" = "list";
  let requestId = 0;
  const listeners = new Set<(state: FilesListState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const runListing = (path: string, context: "list" | "open") => {
    const thisRequestId = ++requestId;
    lastContext = context;
    state = beginFilesListing(path);
    emit();

    listDirectoryWithTimeout(client, workspaceRoot, path, clock, timeoutMs).then(
      (directory) => {
        if (thisRequestId !== requestId) return;
        state = completeFilesListing(path, directory);
        emit();
      },
      (error: unknown) => {
        if (thisRequestId !== requestId) return;
        const raw = error instanceof Error ? error.message : String(error);
        state = failFilesListing(path, raw, context);
        emit();
      },
    );
  };

  runListing(state.path, "list");

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: (path) => runListing(normalizeFilesPath(path), "list"),
    open: (entry) => runListing(entry.path, "open"),
    up: () => {
      const parent = parentFilesPath(state.path);
      if (parent === null) return;
      runListing(parent, "list");
    },
    retry: () => runListing(state.path, lastContext),
  };
}
