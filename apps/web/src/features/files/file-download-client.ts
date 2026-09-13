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

  /**
   * Relay-path chunk-loop download (the `file_download_bytes` protocol
   * pair, served fetch-and-forward inside the existing E2EE channel so a
   * relay-paired caller gets bytes no direct HTTP endpoint could serve).
   * `use-file-download.ts` calls this instead of the token+HTTP round
   * trip above whenever there is no direct origin to fetch from.
   *
   * Optional, like every transfer member on Android's own
   * `FileBrowserClient`: a client object without it (the pending-
   * connection placeholder, an adapter written before the pair existed)
   * keeps the old `FILE_DOWNLOAD_NO_ORIGIN` behaviour unchanged.
   *
   * Shaped to match `@picompanion/client`'s
   * `DaemonClient.downloadFileBytes(options)`
   * (`packages/client/src/daemon-client.ts`) — same option names, same
   * result fields — so a real `DaemonClient` satisfies this member
   * structurally with no adapter, exactly like `requestDownloadToken`
   * above. Only `cwd`+`path` are passed by this feature (it addresses
   * browsed-workspace files; the daemon's chunk handler serves those
   * through its workspace-`cwd` scope) — attachments ride the same pair
   * with `{ agentId, path }` and no `cwd`, through the agentId-scoped
   * attachment check (see `attachment-image-resolver.ts`'s module doc).
   */
  downloadFileBytes?(options: RelayFileDownloadOptions): Promise<RelayDownloadedFileBytes>;
}

/**
 * The `cwd`+`path` subset of `@picompanion/client`'s
 * `DownloadFileBytesOptions` this feature actually passes — see
 * `FileDownloadClient.downloadFileBytes`'s doc for why only these two.
 */
export interface RelayFileDownloadOptions {
  readonly cwd: string;
  readonly path: string;
}

/**
 * Matches `@picompanion/client`'s `DownloadedFileBytes`
 * (`packages/client/src/daemon-client.ts`) field for field, so that
 * method's resolved value is assignable here with no conversion.
 */
export interface RelayDownloadedFileBytes {
  readonly bytes: Uint8Array;
  readonly size?: number;
  readonly mimeType?: string;
  readonly fileName?: string;
}

/**
 * Capability probe for the relay download path: whether `client` carries
 * the chunk-loop download at all. This is a method-presence probe,
 * deliberately — the protocol advertises no server-features flag for the
 * `file_download_bytes` pair (and `packages/*` is frozen to this task),
 * so there is nothing else to read. A new client against an old daemon
 * still rejects the unknown wire type as an ordinary, explainable
 * download error; only a client object without the method at all keeps
 * the `FILE_DOWNLOAD_NO_ORIGIN` refusal.
 */
export function supportsRelayFileDownload(client: FileDownloadClient): boolean {
  return typeof client.downloadFileBytes === "function";
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
 * no connection exists yet — or the connected route is a relay whose
 * client carries no chunk-loop download either (see
 * `supportsRelayFileDownload`: a relay pairing whose client *does*
 * expose `downloadFileBytes` never reaches this sentinel — it downloads
 * inside the E2EE channel instead). `routes/screens/
 * host-session-files-screen.tsx` resolves the direct origin when one is
 * available.
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
