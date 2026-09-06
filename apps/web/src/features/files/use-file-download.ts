/**
 * Download state for the files feature (T30B4, plan.md §12.4). Owns
 * requesting a download token for a browsed file, fetching the token
 * URL, and saving the resulting bytes locally — never a direct
 * filesystem access, and no daemon RPC beyond the token request itself
 * (the transfer is a plain HTTP GET; see `file-download-client.ts`'s
 * header comment for why).
 *
 * Progress is real, not simulated: `content-length`/the token's `size`
 * gives the total, and each `ReadableStreamDefaultReader.read()` chunk's
 * byte count drives `state.progress` — this is genuine network progress,
 * unlike upload (see `use-file-upload.ts`'s header comment on why the
 * daemon's upload RPC has no equivalent hook).
 *
 * "Failures are recoverable without losing the selection" (T30B4's
 * acceptance criterion): the requested `path`/`fileName` stay in state
 * across a failure, so `retry()` re-requests a token and re-fetches
 * without the caller re-choosing which file to download.
 *
 * T41A3 (cancellation): every in-flight download is tracked by a `Run`
 * object carrying an `AbortController` and a `cancelled` flag. `cancel()`
 * flips `cancelled`, aborts the controller (so the abort signal reaches
 * `fetchImpl` — assertable in a test, per T41A3's "assert the effect, not
 * the state" instruction) and cancels the stream reader if one exists
 * yet. Every continuation after an `await`/`.then` checks `run.cancelled`
 * before touching state, so a token or a chunk that arrives after cancel
 * never overwrites the "cancelled" status with a stale success or error —
 * and, decisively, `saveBlob` (the only place bytes reach the user's
 * disk) is never reached once `cancelled` is set: no partial file, because
 * no file at all. The same `run.cancelled` guard also protects an
 * unmount: the cleanup effect below marks the active run cancelled and
 * aborts it, so a reader/response arriving after the component is gone
 * touches nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FileDownloadClient } from "./file-download-client.js";
import {
  buildFileDownloadUrl,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
  FILE_DOWNLOAD_NO_ORIGIN,
  type FileDownloadErrorExplanation,
} from "./file-download-client.js";
import { authorizeWorkspacePath, PathAuthorizationError } from "./path-authorization.js";

export type FileDownloadStatus =
  | "idle"
  | "requesting-token"
  | "downloading"
  | "success"
  | "error"
  | "cancelled";

export interface FileDownloadState {
  status: FileDownloadStatus;
  /** The workspace-relative path of the file currently selected for download, preserved across a failure. */
  path: string | null;
  fileName: string | null;
  /** 0-1 once the total byte count is known, `null` while indeterminate. */
  progress: number | null;
  error: FileDownloadErrorExplanation | null;
}

/** Minimal, testable slice of `Response` this hook reads. */
export interface MinimalFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { getReader(): MinimalStreamReader } | null;
}

export interface MinimalStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  /** Optional, mirroring `ReadableStreamDefaultReader.cancel()` — called on `cancel()` to release the stream promptly. */
  cancel?(reason?: unknown): Promise<void> | void;
}

export interface MinimalFetchInit {
  signal?: AbortSignal;
}

export type MinimalFetch = (url: string, init?: MinimalFetchInit) => Promise<MinimalFetchResponse>;

export interface UseFileDownloadOptions {
  client: FileDownloadClient;
  /**
   * The daemon's HTTP origin (e.g. `"http://127.0.0.1:6768"`), or `null`
   * until a route can resolve it for the connected daemon (see
   * `FILE_DOWNLOAD_NO_ORIGIN`'s doc comment). `FileBrowserScreen`
   * defaults this to `null`, matching every other file-feature client
   * prop's "not wired yet" default.
   */
  downloadOrigin: string | null;
  /** Defaults to `globalThis.fetch`; overridable for tests. */
  fetchImpl?: MinimalFetch;
  /** Triggers a browser save of the downloaded bytes. Defaults to a real Blob-URL anchor click; overridable for tests. */
  saveBlob?: (bytes: Uint8Array, fileName: string, mimeType: string) => void;
}

export interface FileDownloadController {
  state: FileDownloadState;
  /** Requests a token for `path` and downloads it. */
  download: (cwd: string, path: string, suggestedFileName: string) => void;
  /** Re-runs `download()` against the same `cwd`/`path`/`fileName` after a failure. */
  retry: () => void;
  /**
   * Cancels the in-flight token request or download. No-op unless
   * `state.status` is `"requesting-token"` or `"downloading"`. See the
   * module doc comment for exactly what this does and does not stop.
   */
  cancel: () => void;
}

const IDLE_STATE: FileDownloadState = {
  status: "idle",
  path: null,
  fileName: null,
  progress: null,
  error: null,
};

/** One in-flight `download()`/`retry()` attempt. */
interface DownloadRun {
  cancelled: boolean;
  controller: AbortController;
  reader: MinimalStreamReader | null;
}

/** Real save path: a same-tab Blob-URL anchor click, matching how browsers normally trigger a "Save As" download. */
function saveBlobViaAnchor(bytes: Uint8Array, fileName: string, mimeType: string): void {
  // `BlobPart` requires an `ArrayBufferView<ArrayBuffer>`, but a `Uint8Array`
  // built from streamed `fetch` chunks is typed `ArrayBufferLike` (which
  // also covers `SharedArrayBuffer`); this cast is safe because `bytes`
  // was always allocated locally with `new Uint8Array(received)`.
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useFileDownload(options: UseFileDownloadOptions): FileDownloadController {
  const {
    client,
    downloadOrigin,
    fetchImpl = (url: string, init?: MinimalFetchInit) => fetch(url, init),
    saveBlob = saveBlobViaAnchor,
  } = options;
  const [state, setState] = useState<FileDownloadState>(IDLE_STATE);
  const requestRef = useRef<{ cwd: string; path: string; fileName: string } | null>(null);
  const activeRunRef = useRef<DownloadRun | null>(null);

  // T41A3: a download in flight when this component unmounts must not go
  // on reading chunks into a tree that no longer exists, and must not
  // leave a dangling stream reader.
  useEffect(
    () => () => {
      const run = activeRunRef.current;
      if (!run) return;
      run.cancelled = true;
      run.controller.abort();
      void run.reader?.cancel?.();
    },
    [],
  );

  const run = useCallback(
    (cwd: string, path: string, fileName: string) => {
      requestRef.current = { cwd, path, fileName };
      const thisRun: DownloadRun = {
        cancelled: false,
        controller: new AbortController(),
        reader: null,
      };
      activeRunRef.current = thisRun;
      setState({ status: "requesting-token", path, fileName, progress: null, error: null });

      // T41A1a: the single path-authorization door. `path` is
      // canonicalized and rejected here — before
      // `client.requestDownloadToken` is ever called.
      let authorizedPath: string;
      try {
        authorizedPath = authorizeWorkspacePath(path).path;
      } catch (error) {
        const raw = error instanceof PathAuthorizationError ? error.message : String(error);
        setState((prev) => ({ ...prev, status: "error", error: explainFileDownloadError(raw) }));
        return;
      }

      client
        .requestDownloadToken(cwd, authorizedPath)
        .then((tokenResult) => {
          if (thisRun.cancelled) return; // cancelled while the token request was in flight

          const explanation = explainFileDownloadTokenResult(tokenResult);
          if (explanation || !tokenResult.token) {
            setState((prev) => ({
              ...prev,
              status: "error",
              error: explanation ?? explainFileDownloadError(""),
            }));
            return;
          }
          if (!downloadOrigin) {
            setState((prev) => ({
              ...prev,
              status: "error",
              error: explainFileDownloadError(FILE_DOWNLOAD_NO_ORIGIN),
            }));
            return;
          }

          const resolvedFileName = tokenResult.fileName ?? fileName;
          const resolvedMimeType = tokenResult.mimeType ?? "application/octet-stream";
          const totalBytes = tokenResult.size;
          const url = buildFileDownloadUrl(downloadOrigin, tokenResult.token!);

          setState((prev) => ({
            ...prev,
            status: "downloading",
            fileName: resolvedFileName,
            progress: totalBytes ? 0 : null,
          }));

          fetchImpl(url, { signal: thisRun.controller.signal })
            .then(async (response) => {
              if (thisRun.cancelled) return;
              if (!response.ok || !response.body) {
                throw new Error(`Download failed (${response.status})`);
              }
              const reader = response.body.getReader();
              thisRun.reader = reader;
              if (thisRun.cancelled) {
                // cancel() ran between the fetch resolving and the reader
                // being stored above; release it immediately rather than
                // starting to read.
                void reader.cancel?.();
                return;
              }
              const chunks: Uint8Array[] = [];
              let received = 0;
              for (;;) {
                const { done, value } = await reader.read();
                if (thisRun.cancelled) return; // no further progress applied, and saveBlob below is never reached
                if (done) break;
                if (value && value.byteLength > 0) {
                  chunks.push(value);
                  received += value.byteLength;
                  if (totalBytes) {
                    const progress = Math.min(1, received / totalBytes);
                    setState((prev) =>
                      prev.status === "downloading" ? { ...prev, progress } : prev,
                    );
                  }
                }
              }
              const combined = new Uint8Array(received);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.byteLength;
              }
              // T41A3: the object URL is created, and the save triggered,
              // only once every chunk has arrived — never from a partial
              // `combined` buffer, and never after `cancelled` (checked
              // just above on every loop iteration and once more here).
              if (thisRun.cancelled) return;
              saveBlob(combined, resolvedFileName, resolvedMimeType);
              setState((prev) => ({ ...prev, status: "success", progress: 1 }));
            })
            .catch((error: unknown) => {
              if (thisRun.cancelled) return; // an AbortError from our own abort() is expected here, not a failure
              const raw = error instanceof Error ? error.message : String(error);
              setState((prev) => ({
                ...prev,
                status: "error",
                error: explainFileDownloadError(raw),
              }));
            });
        })
        .catch((error: unknown) => {
          if (thisRun.cancelled) return;
          const raw = error instanceof Error ? error.message : String(error);
          setState((prev) => ({ ...prev, status: "error", error: explainFileDownloadError(raw) }));
        });
    },
    [client, downloadOrigin, fetchImpl, saveBlob],
  );

  const download = useCallback(
    (cwd: string, path: string, suggestedFileName: string) => {
      run(cwd, path, suggestedFileName);
    },
    [run],
  );

  const retry = useCallback(() => {
    const last = requestRef.current;
    if (!last) return;
    run(last.cwd, last.path, last.fileName);
  }, [run]);

  const cancel = useCallback(() => {
    const activeRun = activeRunRef.current;
    if (activeRun) {
      activeRun.cancelled = true;
      activeRun.controller.abort();
      void activeRun.reader?.cancel?.();
    }
    setState((prev) =>
      prev.status === "requesting-token" || prev.status === "downloading"
        ? { ...prev, status: "cancelled", progress: null, error: null }
        : prev,
    );
  }, []);

  return { state, download, retry, cancel };
}
