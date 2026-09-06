/**
 * File download state and orchestration (T35A4, plan.md §6/§7/§9/§12.4,
 * depends on T35A3).
 *
 * Read-side sibling of `file-upload-model.ts`'s controller: same shape
 * (`getState`/`subscribe`, a `Clock`-raced timeout, one named state per
 * distinct failure) but requesting a download token for a browsed file
 * and streaming its bytes, rather than picking and sending a local one.
 * This module imports neither React, React Native, Expo, DOM types, nor
 * browser globals — plain, RN-free orchestration over the injected
 * `FileBrowserClient.requestDownloadToken` (`file-browser-client.ts`)
 * and an injected `DownloadFetch` (below), testable directly in this
 * workspace's plain `vitest`.
 *
 * No wire shape is invented here: `requestDownloadToken` matches
 * `DaemonClient.requestDownloadToken(cwd, path)` (`packages/client/src/
 * daemon-client.ts`) exactly, and `buildFileDownloadUrl`
 * (`file-browser-client.ts`) matches the daemon's real `/api/files/
 * download` route. This controller's state machine and error
 * vocabulary are the RN-free port of web's `use-file-download.ts`
 * (`apps/web/src/features/files/use-file-download.ts`), extended with
 * real cancellation (web's version has none) and a pre-flight size
 * bound (web's has none either — see below).
 *
 * ---------------------------------------------------------------------
 * Progress (this task's real content, download half)
 * ---------------------------------------------------------------------
 * Unlike upload, this *is* real, protocol-native progress: the download
 * token response's own `size` gives the total up front, and every
 * `DownloadStreamReader.read()` chunk's byte count drives
 * `state.progress` as `received / total`, clamped to `[0, 1)` until the
 * stream reports `done`. `state.progress` is monotonic non-decreasing
 * for the lifetime of one download attempt, reaches exactly `1` only on
 * `"success"`, and is never `1` on any other status — including a
 * stream that reports `done: true` before `received` reaches the
 * declared total, which this controller treats as a genuine transfer
 * failure (`FILE_DOWNLOAD_TRANSFER_FAILED`) rather than a truncated
 * success (see this file's tests).
 *
 * ---------------------------------------------------------------------
 * Bound and cancellation (this task's real content, the rest of it)
 * ---------------------------------------------------------------------
 * `MAX_DOWNLOAD_BYTES` is checked against the token response's `size`
 * the instant it arrives — strictly before `fetchImpl` (the actual
 * transfer) is ever called — landing in the same named `"refused"`
 * state `file-upload-model.ts` uses for its own oversize case. This is
 * a bound web's `use-file-download.ts` does not have (it hands
 * everything straight to a desktop browser's own streaming Blob), but
 * this controller buffers every received chunk in memory before saving,
 * so an unbounded download risks exhausting a phone's memory the way an
 * unbounded upload risks exhausting the daemon's.
 *
 * `cancel()` is a real interleaving: it bumps this controller's
 * internal generation counter, best-effort calls the in-flight reader's
 * own `cancel()` (if the injected reader offers one — a real
 * `ReadableStreamDefaultReader` does), and immediately moves to
 * `"cancelled"`. The read loop checks that generation *after every
 * single `await reader.read()`*, before touching `received`/`progress`
 * or pushing the chunk — so a chunk already in flight when `cancel()`
 * fires is received and then silently discarded rather than applied
 * (`file-download-model.test.ts`'s in-flight-cancel case proves this by
 * resolving a paused `read()` *after* calling `cancel()`). `retry()`
 * always starts a brand-new attempt — a fresh token request, a fresh
 * `chunks`/`received`, `progress` back at `0` — so a retry after a
 * cancelled or failed download never appends to, or duplicates, bytes
 * from the abandoned attempt.
 */
import type { Clock } from "@picompanion/frontend-core";

import {
  FILE_DOWNLOAD_CANCELLED,
  FILE_DOWNLOAD_NOT_CONNECTED,
  FILE_DOWNLOAD_NO_ORIGIN,
  FILE_DOWNLOAD_NO_RELAY_ORIGIN,
  FILE_DOWNLOAD_TOKEN_TIMEOUT,
  FILE_DOWNLOAD_TRANSFER_FAILED,
  MAX_DOWNLOAD_BYTES,
  buildFileDownloadUrl,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
  explainOversizedDownload,
  type FileBrowserClient,
  type FileBrowserErrorExplanation,
  type FileDownloadTokenResult,
} from "./file-browser-client.js";
import { createFilesClock } from "./files-model.js";

export type { FileDownloadTokenResult } from "./file-browser-client.js";

/** Minimal, testable slice of a `fetch` `Response` this controller reads. RN-free port of web's `MinimalFetchResponse` (`apps/web/src/features/files/use-file-download.ts`). */
export interface DownloadFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { getReader(): DownloadStreamReader } | null;
}

/** Minimal, testable slice of a `ReadableStreamDefaultReader<Uint8Array>` this controller reads. `cancel` is optional so a fake that doesn't model it still satisfies this type; a real reader has one, and `cancel()` below calls it best-effort. */
export interface DownloadStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?(): Promise<void>;
}

export type DownloadFetch = (url: string) => Promise<DownloadFetchResponse>;

export type FileDownloadStatus =
  | "idle"
  | "requesting-token"
  | "downloading"
  | "success"
  | "error"
  | "cancelled"
  | "refused";

export interface DownloadedFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
}

export interface FileDownloadState {
  readonly status: FileDownloadStatus;
  readonly cwd: string | null;
  readonly path: string | null;
  readonly fileName: string | null;
  /** `null` while indeterminate (no total known yet), otherwise monotonic non-decreasing in `[0, 1)` until `"success"` sets it to exactly `1`. Never `1` on any other status. */
  readonly progress: number | null;
  /** The fully-received bytes, once `"success"`. `null` on every other status — a partial transfer is never exposed here. */
  readonly file: DownloadedFile | null;
  readonly error: FileBrowserErrorExplanation | null;
  readonly refusal: FileBrowserErrorExplanation | null;
}

const IDLE_STATE: FileDownloadState = {
  status: "idle",
  cwd: null,
  path: null,
  fileName: null,
  progress: null,
  file: null,
  error: null,
  refusal: null,
};

export const DEFAULT_FILE_DOWNLOAD_TOKEN_TIMEOUT_MS = 15_000;

/**
 * Races `client.requestDownloadToken(cwd, path)` against `clock`'s
 * timer, exactly like `files-model.ts`'s `listDirectoryWithTimeout`.
 * Rejects with `FILE_DOWNLOAD_NOT_CONNECTED` when the client has no
 * `requestDownloadToken` at all, or `FILE_DOWNLOAD_TOKEN_TIMEOUT` if the
 * timer fires first.
 */
export function requestDownloadTokenWithTimeout(
  client: FileBrowserClient,
  cwd: string,
  path: string,
  clock: Clock,
  timeoutMs: number = DEFAULT_FILE_DOWNLOAD_TOKEN_TIMEOUT_MS,
): Promise<FileDownloadTokenResult> {
  return new Promise((resolve, reject) => {
    const requestDownloadToken = client.requestDownloadToken;
    if (!requestDownloadToken) {
      reject(new Error(FILE_DOWNLOAD_NOT_CONNECTED));
      return;
    }

    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(FILE_DOWNLOAD_TOKEN_TIMEOUT));
    }, timeoutMs);

    requestDownloadToken(cwd, path).then(
      (result) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(result);
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

export interface FileDownloadControllerOptions {
  client: FileBrowserClient;
  /**
   * The daemon's HTTP origin (e.g. `"http://127.0.0.1:6768"`), or `null`
   * until a route can resolve it for the connected daemon (see
   * `FILE_DOWNLOAD_NO_ORIGIN`'s doc). Defaults to `null` — matching
   * `FilesScreenProps`' optional `client`'s "not wired yet" default.
   */
  downloadOrigin?: string | null;
  /**
   * Which connection path produced (or would produce) `downloadOrigin`
   * (T66) — `"direct" | "relay" | null`, matching `daemon-connection-
   * store.ts`'s `DaemonConnectionPath`. Only consulted when
   * `downloadOrigin` is falsy, to choose between the two distinct named
   * refusals: `"relay"` raises `FILE_DOWNLOAD_NO_RELAY_ORIGIN` (a
   * permanent, by-design limitation — see that sentinel's doc), anything
   * else raises the generic `FILE_DOWNLOAD_NO_ORIGIN`. Defaults to
   * `null`, which keeps every caller built before T66 (and every
   * existing test) on the generic message unchanged.
   */
  connectionPath?: "direct" | "relay" | null;
  /** Fetches a download token's URL. No default: unlike `requestDownloadToken` (an `FileBrowserClient` member), there is no ambient global this controller can safely assume exists across every host environment it might run in, so a caller with no real transport wired yet must pass one that always rejects, not omit this. */
  fetchImpl: DownloadFetch;
  clock?: Clock;
  tokenTimeoutMs?: number;
}

export interface FileDownloadController {
  getState: () => FileDownloadState;
  subscribe: (listener: (state: FileDownloadState) => void) => () => void;
  /** Requests a token for `path` and downloads it. */
  download: (cwd: string, path: string, suggestedFileName: string) => void;
  /** Re-runs `download()` against the same `cwd`/`path`/`fileName` after a failure, cancellation, or refusal — a brand-new attempt, never a resume. */
  retry: () => void;
  /** Cancels an in-flight token request or byte transfer. No-op once already settled (`"success"`/`"error"`/`"refused"`) or idle. */
  cancel: () => void;
}

/**
 * Builds a `FileDownloadController` — the injected-fake-daemon-RPC and
 * -fetch seam `file-download-model.test.ts` drives directly to prove
 * the token→stream round trip, monotonic real byte progress, every
 * recoverable failure, the pre-flight size bound, and the in-flight
 * cancellation interleaving, with no emulator, no real socket, and no
 * `react-native` import.
 */
export function createFileDownloadController(
  options: FileDownloadControllerOptions,
): FileDownloadController {
  const { client, fetchImpl } = options;
  const downloadOrigin = options.downloadOrigin ?? null;
  const connectionPath = options.connectionPath ?? null;
  const clock = options.clock ?? createFilesClock();
  const tokenTimeoutMs = options.tokenTimeoutMs ?? DEFAULT_FILE_DOWNLOAD_TOKEN_TIMEOUT_MS;

  let state: FileDownloadState = IDLE_STATE;
  let generation = 0;
  let lastRequest: { cwd: string; path: string; fileName: string } | null = null;
  let activeReader: DownloadStreamReader | null = null;
  const listeners = new Set<(state: FileDownloadState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const setState = (next: FileDownloadState) => {
    state = next;
    emit();
  };

  const run = (cwd: string, path: string, fileName: string) => {
    lastRequest = { cwd, path, fileName };
    const thisGeneration = ++generation;
    activeReader = null;
    setState({
      status: "requesting-token",
      cwd,
      path,
      fileName,
      progress: null,
      file: null,
      error: null,
      refusal: null,
    });

    requestDownloadTokenWithTimeout(client, cwd, path, clock, tokenTimeoutMs).then(
      (tokenResult) => {
        if (thisGeneration !== generation) return; // superseded by cancel()/a newer download()

        const explanation = explainFileDownloadTokenResult(tokenResult);
        if (explanation || !tokenResult.token) {
          setState({
            ...state,
            status: "error",
            progress: null,
            error: explanation ?? explainFileDownloadError(""),
          });
          return;
        }

        const resolvedFileName = tokenResult.fileName ?? fileName;
        const resolvedMimeType = tokenResult.mimeType ?? "application/octet-stream";
        const totalBytes = tokenResult.size;

        // Pre-flight bound: refuse before any byte fetch, the instant
        // the daemon's own reported size is known.
        if (typeof totalBytes === "number" && totalBytes > MAX_DOWNLOAD_BYTES) {
          setState({
            ...state,
            status: "refused",
            fileName: resolvedFileName,
            progress: null,
            refusal: explainOversizedDownload(totalBytes),
          });
          return;
        }

        if (!downloadOrigin) {
          setState({
            ...state,
            status: "error",
            fileName: resolvedFileName,
            progress: null,
            error: explainFileDownloadError(
              connectionPath === "relay" ? FILE_DOWNLOAD_NO_RELAY_ORIGIN : FILE_DOWNLOAD_NO_ORIGIN,
            ),
          });
          return;
        }

        const url = buildFileDownloadUrl(downloadOrigin, tokenResult.token);
        setState({
          ...state,
          status: "downloading",
          fileName: resolvedFileName,
          progress: totalBytes ? 0 : null,
        });

        fetchImpl(url)
          .then(async (response) => {
            if (thisGeneration !== generation) return;
            if (!response.ok || !response.body) {
              throw new Error(FILE_DOWNLOAD_TRANSFER_FAILED);
            }
            const reader = response.body.getReader();
            activeReader = reader;
            const chunks: Uint8Array[] = [];
            let received = 0;

            for (;;) {
              const step = await reader.read();
              if (thisGeneration !== generation) return; // cancelled/superseded mid-chunk — the chunk (if any) is discarded, never applied

              if (step.value && step.value.byteLength > 0) {
                chunks.push(step.value);
                received += step.value.byteLength;
                if (totalBytes) {
                  const progress = Math.min(received / totalBytes, 0.999_999);
                  setState({ ...state, progress });
                }
              }

              if (step.done) {
                if (typeof totalBytes === "number" && received < totalBytes) {
                  // The stream ended before the daemon's own declared
                  // size was reached — a genuine mid-transfer failure,
                  // never presented as a (truncated) success.
                  throw new Error(FILE_DOWNLOAD_TRANSFER_FAILED);
                }
                break;
              }
            }

            if (thisGeneration !== generation) return;
            activeReader = null;
            const combined = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.byteLength;
            }
            setState({
              ...state,
              status: "success",
              progress: 1,
              file: {
                fileName: resolvedFileName,
                mimeType: resolvedMimeType,
                bytes: combined,
                size: received,
              },
            });
          })
          .catch((error: unknown) => {
            if (thisGeneration !== generation) return;
            activeReader = null;
            const raw = error instanceof Error ? error.message : String(error);
            setState({
              ...state,
              status: "error",
              progress: null,
              error: explainFileDownloadError(raw),
            });
          });
      },
      (error: unknown) => {
        if (thisGeneration !== generation) return;
        const raw = error instanceof Error ? error.message : String(error);
        setState({
          ...state,
          status: "error",
          progress: null,
          error: explainFileDownloadError(raw),
        });
      },
    );
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    download: (cwd, path, suggestedFileName) => run(cwd, path, suggestedFileName),
    retry: () => {
      if (!lastRequest) return;
      run(lastRequest.cwd, lastRequest.path, lastRequest.fileName);
    },
    cancel: () => {
      if (state.status !== "requesting-token" && state.status !== "downloading") return;
      generation += 1; // any settlement of the in-flight token request or read loop above is now stale and ignored
      const reader = activeReader;
      activeReader = null;
      if (reader?.cancel) {
        reader.cancel().catch(() => undefined);
      }
      setState({
        ...state,
        status: "cancelled",
        progress: null,
        file: null,
        error: null,
        refusal: null,
      });
    },
  };
}

/** Re-exported so a caller can name the sentinel `cancel()` conceptually maps to without reaching into `file-browser-client.ts` directly. Never actually sent to or received from the daemon — see that constant's own doc. */
export { FILE_DOWNLOAD_CANCELLED };
