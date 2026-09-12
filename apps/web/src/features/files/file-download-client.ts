/**
 * File download wire shapes and client contract (T30B4, plan.md §12.4).
 *
 * Shaped to match `@picompanion/client`'s
 * `DaemonClient.requestDownloadToken(cwd, path)` (see
 * `packages/client/src/daemon-client.ts`) and the
 * `file_download_token_request`/`file_download_token_response` wire
 * messages (see `packages/protocol/src/messages.ts`'s
 * `FileDownloadTokenResponseSchema`). A real `DaemonClient` already
 * satisfies `FileDownloadClient` structurally; nothing here needs to
 * import `@picompanion/client` to stay in sync with it.
 *
 * Unlike upload, download *is* scoped to the browsed workspace: the
 * token request takes the same `cwd`/`path` the file listing/read RPCs
 * do. The daemon issues a single-use, short-TTL capability token
 * (`packages/server/src/server/file-download/token-store.ts`) rather
 * than streaming bytes over the WebSocket; the actual transfer happens
 * over a plain HTTP GET to `/api/files/download?token=...`
 * (`packages/server/src/server/bootstrap.ts`'s `handleFileDownload`),
 * which `buildFileDownloadUrl` below builds and `use-file-download.ts`
 * fetches with real byte-level progress. This is why `downloadOrigin` —
 * the daemon's own HTTP origin, not something `DaemonClient` exposes
 * today — is a separate input the caller supplies rather than something
 * this client resolves itself.
 *
 * The daemon does not reject the token request for a business-level
 * failure (missing file, path outside the workspace) — it resolves with
 * `token: null` and `error` set (see `handleFileDownloadTokenRequest` in
 * `packages/server/src/server/session/files/workspace-files-session.ts`)
 * rather than throwing. `requestDownloadToken` below only *rejects* for
 * a transport-level failure; `explainFileDownloadTokenResult` covers the
 * resolved, no-token outcome and `explainFileDownloadError` covers the
 * rejected ones (plus any failure while actually fetching the bytes).
 */

/** Mirrors the daemon's `FileDownloadTokenResponseSchema.payload` shape. */
export interface FileDownloadTokenResult {
  readonly cwd: string;
  readonly path: string;
  readonly token: string | null;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly error: string | null;
}

export interface FileDownloadClient {
  /**
   * Requests a single-use download token for a file. `cwd` is the
   * daemon-side workspace root (protocol `cwd`); `path` is the file's
   * path relative to it. Rejects with an `Error` whose `message` is the
   * daemon's raw explanation on a transport-level failure.
   */
  requestDownloadToken(cwd: string, path: string): Promise<FileDownloadTokenResult>;
}

/**
 * Sentinel error message used by `createPendingConnectionFileDownloadClient`
 * so `explainFileDownloadError` can give it a dedicated explanation
 * instead of falling through to the generic "couldn't download this
 * file" message.
 */
export const FILE_DOWNLOAD_NOT_CONNECTED = "FILE_DOWNLOAD_NOT_CONNECTED";

/**
 * Sentinel error message `use-file-download.ts` raises when a token was
 * issued but no reachable HTTP origin is available to fetch it from:
 * the connected route is a relay (which proxies only the encrypted
 * WebSocket, with no direct HTTP endpoint — see
 * `attachment-image-resolver.ts`'s `resolveDirectHttpOrigin`), or no
 * connection exists yet. `routes/screens/host-session-files-screen.tsx`
 * resolves the direct origin when one is available.
 */
export const FILE_DOWNLOAD_NO_ORIGIN = "FILE_DOWNLOAD_NO_ORIGIN";

export interface FileDownloadErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw transport-level failure (an `Error.message` from a rejected
 * `requestDownloadToken`, or from the HTTP fetch of the token URL
 * itself) to a title and description a user can act on. The selected
 * entry is always preserved by the caller (`use-file-download.ts`) when
 * this fires — nothing here discards it.
 */
export function explainFileDownloadError(rawMessage: string): FileDownloadErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_DOWNLOAD_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to download files for this session.",
    };
  }
  if (message === FILE_DOWNLOAD_NO_ORIGIN) {
    return {
      title: "Downloads aren't available yet",
      description: "This session isn't connected to a reachable daemon address yet.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  return {
    title: "Couldn't download this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Explains a resolved, no-token `FileDownloadTokenResult` (`error` set,
 * no `token`). Returns `null` when a token was issued successfully.
 */
export function explainFileDownloadTokenResult(
  result: FileDownloadTokenResult,
): FileDownloadErrorExplanation | null {
  if (!result.error) return null;

  const message = result.error.trim();
  if (/^enoent\b/i.test(message) || /no such file or directory/i.test(message)) {
    return {
      title: "This file no longer exists",
      description:
        "It may have been moved, renamed, or deleted since it was last listed. Go back and try again.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  return {
    title: "Couldn't download this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Builds the browser-fetchable URL for a download token, given the
 * daemon's HTTP origin (e.g. `"http://127.0.0.1:6768"`) and the token
 * `requestDownloadToken` issued. Matches
 * `packages/server/src/server/bootstrap.ts`'s `app.get("/api/files/download", ...)`
 * route exactly: a `token` query parameter, nothing else. The token
 * itself is a single-use, short-TTL capability scoped to exactly one
 * file (`DownloadTokenStore`, `packages/server/src/server/file-download/token-store.ts`)
 * — not a durable secret like a daemon password or bearer key — which is
 * why the daemon's own route design already puts it in the query string.
 */
export function buildFileDownloadUrl(origin: string, token: string): string {
  const url = new URL("/api/files/download", origin);
  url.searchParams.set("token", token);
  return url.toString();
}
