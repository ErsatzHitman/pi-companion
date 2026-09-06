/**
 * Single-file read state and orchestration (T35A2, plan.md
 * §6/§7/§9/§12.4).
 *
 * Read-side sibling of `files-model.ts`'s directory-listing controller:
 * same shape (`getState`/`subscribe`/`retry`, a `Clock`-raced timeout,
 * one named state per distinct failure), but for a single file instead
 * of a directory. Imports neither React, React Native, Expo, DOM types,
 * nor browser globals — plain, RN-free orchestration over the injected
 * `FileBrowserClient.readFile` (`file-browser-client.ts`), testable
 * directly in this workspace's plain `vitest`.
 *
 * Every read produces exactly one of four named states — never a single
 * generic "couldn't open this file":
 *   - `"loading"` — the request (or the size pre-check below) hasn't
 *     settled yet.
 *   - `"ready"` — a text file at or under `MAX_PREVIEWABLE_FILE_BYTES`;
 *     `state.file` holds the bytes for the view to decode and tokenize.
 *   - `"refused"` — the file was read successfully but this view will
 *     not render it (binary, image, or oversized); `state.refusal`
 *     explains why. Oversized is decided *before* any read RPC when
 *     `sizeHint` (the directory listing's own `FileBrowserEntry.size`)
 *     already exceeds the ceiling — this view never fetches a payload
 *     it already knows it will refuse.
 *   - `"error"` — the daemon rejected the read (not found, permission
 *     denied, outside the workspace, timed out, not connected, …);
 *     `state.error` carries the same title/description vocabulary
 *     `files-model.ts` uses for a failed listing.
 */
import type { Clock } from "@picompanion/frontend-core";

import {
  FILE_READ_NOT_CONNECTED,
  FILE_READ_TIMEOUT,
  MAX_PREVIEWABLE_FILE_BYTES,
  explainFileReadError,
  explainRefusedFileKind,
  type FileBrowserClient,
  type FileBrowserErrorExplanation,
  type FileReadResult,
} from "./file-browser-client.js";
import { createFilesClock } from "./files-model.js";

export type { FileReadResult, FileReadKind } from "./file-browser-client.js";

export type FileViewStatus = "loading" | "ready" | "refused" | "error";

export interface FileViewError extends FileBrowserErrorExplanation {
  /** The daemon's original, untranslated error message. Empty for the size pre-check, which never talks to the daemon. */
  raw: string;
}

export interface FileViewState {
  readonly path: string;
  readonly status: FileViewStatus;
  readonly file: FileReadResult | null;
  readonly refusal: FileBrowserErrorExplanation | null;
  readonly error: FileViewError | null;
}

export function initialFileViewState(path: string): FileViewState {
  return { path, status: "loading", file: null, refusal: null, error: null };
}

export function completeFileView(path: string, file: FileReadResult): FileViewState {
  const refusal = explainRefusedFileKind(file);
  if (refusal) {
    return { path, status: "refused", file, refusal, error: null };
  }
  return { path, status: "ready", file, refusal: null, error: null };
}

export function failFileView(path: string, rawMessage: string): FileViewState {
  return {
    path,
    status: "error",
    file: null,
    refusal: null,
    error: { ...explainFileReadError(rawMessage), raw: rawMessage },
  };
}

/**
 * Refuses a file before any read RPC, using a size the caller already
 * knows (the directory listing's `FileBrowserEntry.size`) — this view
 * never spends a daemon round-trip and a large in-memory buffer fetching
 * a file it will refuse anyway. Shares `explainRefusedFileKind`'s
 * oversized wording (`file-browser-client.ts#explainOversizedFile`) so
 * this pre-check and the post-read check read identically.
 */
export function refuseFileViewForSize(path: string, sizeBytes: number): FileViewState {
  return {
    path,
    status: "refused",
    file: null,
    refusal: {
      title: "This file is too large to preview",
      description: `Files over ${Math.round(MAX_PREVIEWABLE_FILE_BYTES / 1024)} KB aren't previewed here. This one is ${Math.round(sizeBytes / 1024)} KB.`,
    },
    error: null,
  };
}

export const DEFAULT_FILE_VIEW_TIMEOUT_MS = 15_000;

/**
 * Races `client.readFile(cwd, path)` against `clock`'s timer, exactly
 * like `files-model.ts`'s `listDirectoryWithTimeout`. A missing
 * `readFile` (an older, listing-only `FileBrowserClient` test double, or
 * a real client not yet wired to a daemon) rejects immediately with
 * `FILE_READ_NOT_CONNECTED` — no timer, no RPC attempted.
 */
export function readFileWithTimeout(
  client: FileBrowserClient,
  cwd: string,
  path: string,
  clock: Clock,
  timeoutMs: number = DEFAULT_FILE_VIEW_TIMEOUT_MS,
): Promise<FileReadResult> {
  return new Promise((resolve, reject) => {
    const readFile = client.readFile;
    if (!readFile) {
      reject(new Error(FILE_READ_NOT_CONNECTED));
      return;
    }

    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(FILE_READ_TIMEOUT));
    }, timeoutMs);

    readFile(cwd, path).then(
      (file) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(file);
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

export interface FileViewControllerOptions {
  client: FileBrowserClient;
  /** The daemon-side workspace root this read is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** The file's path, relative to `workspaceRoot`. */
  path: string;
  /** The size the directory listing already reported for this file, when known — enables the pre-read oversized refusal. Omit when the file was opened without a listing entry on hand. */
  sizeHint?: number;
  clock?: Clock;
  timeoutMs?: number;
}

export interface FileViewController {
  getState: () => FileViewState;
  subscribe: (listener: (state: FileViewState) => void) => () => void;
  /** Re-issues the read (including the size pre-check) for the same path. */
  retry: () => void;
}

/**
 * Builds a `FileViewController` — the injected-fake-daemon-RPC seam
 * `file-view-model.test.ts` drives directly to prove the size pre-check,
 * a successful text read, each refusal, and each named error as real
 * state transitions, with no emulator and no `react-native` import.
 */
export function createFileViewController(options: FileViewControllerOptions): FileViewController {
  const { client, workspaceRoot, path, sizeHint } = options;
  const clock = options.clock ?? createFilesClock();
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILE_VIEW_TIMEOUT_MS;

  let state: FileViewState = initialFileViewState(path);
  let requestId = 0;
  const listeners = new Set<(state: FileViewState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const run = () => {
    if (sizeHint !== undefined && sizeHint > MAX_PREVIEWABLE_FILE_BYTES) {
      state = refuseFileViewForSize(path, sizeHint);
      emit();
      return;
    }

    const thisRequestId = ++requestId;
    state = initialFileViewState(path);
    emit();

    readFileWithTimeout(client, workspaceRoot, path, clock, timeoutMs).then(
      (file) => {
        if (thisRequestId !== requestId) return;
        state = completeFileView(path, file);
        emit();
      },
      (error: unknown) => {
        if (thisRequestId !== requestId) return;
        const raw = error instanceof Error ? error.message : String(error);
        state = failFileView(path, raw);
        emit();
      },
    );
  };

  run();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry: () => run(),
  };
}
