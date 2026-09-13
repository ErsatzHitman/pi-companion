/**
 * T284: the route-level `ResolveImageSrc` this app's session route
 * supplies to `Transcript`/`MessageAttachments` — see
 * `message-attachments.tsx`'s module doc for the seam's contract and why
 * it stayed unsupplied until now.
 *
 * **Why this is a whole module rather than a one-line closure at the
 * route.** `ResolveImageSrc` is a *synchronous* function
 * (`(image, context) => string | undefined`), called from inside
 * `MessageAttachments`' render — but turning an `AgentTimelineImageRef`
 * into a fetchable URL needs an async round trip
 * (`requestAttachmentDownloadToken`, plan.md §12.4). Kicking off that
 * round trip synchronously from inside a render function (and calling
 * `setState` from its `.then`) is the standard "resolve once, cache,
 * re-render" shape, but it needs real state to hold the cache and a real
 * effect to drive the requests — `useAttachmentImageResolver` below is
 * that hook; the function it returns only ever *reads* the cache.
 *
 * **The three pure pieces, unit-tested directly:**
 * - `collectTimelineImages` extracts every unique-by-`path` image
 *   reference off a live `entries` list (a message can repeat the exact
 *   same `AgentTimelineImageRef` object across re-renders while
 *   streaming; different entries can never share a `path` in practice,
 *   since `materializeProviderImage` names each file by content hash,
 *   but de-duplicating here is what stops two message rows carrying the
 *   same attachment from requesting the same token twice).
 * - `buildAttachmentDownloadUrl` matches
 *   `features/files/file-download-client.ts`'s `buildFileDownloadUrl`
 *   route byte-for-byte (`/api/files/download?token=...` — `session.ts`'s
 *   `handleAttachmentDownloadTokenRequest` doc comment: "Reuses the exact
 *   ... `/api/files/download` HTTP route ... does; only the request-side
 *   authorization differs"). Duplicated here rather than imported from
 *   `features/files/`, matching this directory's own established
 *   convention (`message-attachments.tsx`'s `formatImageSize` docstring:
 *   "so this directory's owned files do not reach into a sibling feature
 *   directory another task in this wave may be editing concurrently") —
 *   this codebase has no precedent anywhere of one `apps/web/src/features/*`
 *   directory importing from a sibling; only routes compose across them.
 * - `resolveDirectHttpOrigin` turns the connected `HostProfile` + the
 *   active `HostConnectionKind` into the daemon's own `http(s)://host:port`
 *   origin — `null` whenever there is no live profile, or the active
 *   connection is `"relay"` (a relay tunnel proxies only the encrypted
 *   WebSocket; there is no direct HTTP endpoint to derive one from, the
 *   same limitation `apps/android`'s `daemon-connection-store.ts`
 *   documents for its own `daemonAddress` field). `HostProfile.direct.
 *   endpoint` is already the exact `host:port` (or bracketed-IPv6)
 *   string `@picompanion/frontend-core`'s `hosts` module builds a
 *   WebSocket URL from (`connection-url.ts`), so this needs no
 *   IPv6-bracketing logic of its own — only a scheme prefix.
 *
 * **The relay pure pieces, unit-tested directly alongside the three above:**
 * - `supportsRelayAttachmentDownload` probes for the chunk-loop method
 *   (mirroring `features/files/file-download-client.ts`'s
 *   `supportsRelayFileDownload`, duplicated here for the same
 *   no-sibling-import reason as `buildAttachmentDownloadUrl` above).
 * - `encodeBytesToBase64`/`buildAttachmentDataUri` turn chunk-loop bytes
 *   into an `<img>`-renderable `data:` URI with no `Buffer`/`btoa`
 *   dependency, so every JS engine either app runs under encodes
 *   identically.
 *
 * **What this means for the two acceptance directions.** A `"direct"`
 * connection (this app's only connection kind with any live daemon HTTP
 * endpoint at all, per this same reasoning) resolves real images through
 * the token+HTTP round trip. A `"relay"` connection resolves real images
 * too — through the `file_download_bytes` chunk loop inside the E2EE
 * channel (see below), so the relay never sees anything but ciphertext.
 * No connection yet always returns `undefined` for every image —
 * `MessageAttachments`' own reference-card fallback is what renders then,
 * exactly the "no blank space, no broken `<img>`" acceptance this task's
 * brief names for an unreachable file, not a regression this task
 * introduces.
 *
 * **Relay images ride the chunk-loop download the files feature uses.**
 * `DaemonClient.downloadFileBytes` (the `file_download_bytes` pair the
 * files feature's relay path is built on) now serves agentId-scoped
 * attachment paths as well as workspace-`cwd`-scoped file paths: a
 * request without a usable `cwd` but with a non-empty `agentId` is
 * resolved through the SAME `resolveAttachmentForDownload` membership +
 * containment check the `attachment_download_token_request` path uses
 * (see `handleFileDownloadBytesRequest` in `packages/server/src/server/
 * session/files/workspace-files-session.ts` and `readAttachmentFileChunk`
 * in `.../file-upload/attachment-access.ts`). This hook therefore calls
 * `client.downloadFileBytes({ agentId, path })` whenever there is no
 * direct origin to fetch a token URL from. The returned bytes are
 * rendered as a `data:` URI (see `buildAttachmentDataUri`), so no object
 * URL needs revoking when this hook's cache resets. A relay pairing whose
 * client has no chunk-loop method at all — an old daemon or adapter —
 * keeps the reference-card fallback, never a doomed request: that
 * method-presence check (`supportsRelayAttachmentDownload`, mirroring
 * `features/files/file-download-client.ts`'s `supportsRelayFileDownload`)
 * is this capability's only old-daemon probe, and the daemon-side
 * rejection of a chunk read an old daemon does not understand lands in
 * the same fallback through the `.catch()` below.
 *
 * **A disclosed limitation of the token itself, not of this module.**
 * `DownloadTokenStore.consumeToken` (`packages/server/src/server/
 * file-download/token-store.ts`) deletes an entry the instant it is
 * read — every resolved URL is single-use. Once the browser's first
 * `<img>` fetch consumes it, the *cached* URL this hook keeps for the
 * rest of this mount's lifetime would 404 on a second real network
 * fetch of the same URL (a manual reload, or the browser evicting and
 * re-fetching the image from cache). This is inherent to the shared
 * `DownloadTokenStore` design T283 chose and T284 has no scope to touch
 * (`Do not touch the daemon`) — not something this module can paper
 * over without inventing a second, un-single-use token type. In the
 * normal path (attach, then view) it is unobservable: the browser
 * fetches the image exactly once and then serves it from its own cache
 * for the rest of the mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { hosts, timeline } from "@picompanion/frontend-core";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import { isCoreMessageEntry } from "./message-row.js";
import type { MessageAttachmentImageContext, ResolveImageSrc } from "./message-attachments.js";

/**
 * The methods this hook needs off `@picompanion/client`'s
 * `DaemonClient` — a real `DaemonClient` satisfies this structurally
 * as-is (`requestAttachmentDownloadToken`'s real return type carries
 * every field here plus `agentId`/`path`/`fileName`/`size`/`requestId`;
 * see `daemon-client.ts`'s own doc comment for the T283 wire contract;
 * `downloadFileBytes`'s real options/result carry every field here plus
 * the workspace-path and transport fields this hook never passes).
 */
export interface AttachmentDownloadTokenClient {
  requestAttachmentDownloadToken(
    agentId: string,
    path: string,
  ): Promise<{
    token: string | null;
    mimeType: string | null;
    error: string | null;
  }>;
  /**
   * Relay-path chunk-loop download (the `file_download_bytes` protocol
   * pair, served fetch-and-forward inside the existing E2EE channel).
   * This hook calls it with `{ agentId, path }` only — no `cwd` — and the
   * daemon resolves it through the same attachment access check the token
   * path uses. Optional, like every transfer member on the files
   * feature's own client: a client object without it (an adapter written
   * before the pair existed) keeps the reference-card fallback.
   */
  downloadFileBytes?(options: { agentId: string; path: string }): Promise<{
    bytes: Uint8Array;
    mimeType?: string;
    size?: number;
    fileName?: string;
  }>;
}

/**
 * Capability probe for the relay attachment path: whether `client`
 * carries the chunk-loop download at all. A method-presence probe,
 * deliberately — mirroring `features/files/file-download-client.ts`'s
 * `supportsRelayFileDownload` (duplicated here rather than imported, per
 * this directory's own established no-sibling-import convention cited
 * above): the protocol advertises no server-features flag for the
 * `file_download_bytes` pair, so there is nothing else to read. A client
 * without the method at all keeps the reference-card fallback; a client
 * with it against an old daemon rejects the unknown wire type, which the
 * hook's `.catch()` below turns into the same fallback.
 */
export function supportsRelayAttachmentDownload(client: AttachmentDownloadTokenClient): boolean {
  return typeof client.downloadFileBytes === "function";
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Pure base64 encoder over raw bytes — no `Buffer` (unavailable in the
 * browser bundle) and no `btoa` (unavailable on some native runtimes),
 * so this file and its Android mirror share the identical behaviour in
 * every JS engine either app runs under. Chunked 3-bytes-at-a-time over
 * the input; padding only on the final quantum.
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? (bytes[index + 1] ?? 0) : 0;
    const third = index + 2 < bytes.length ? (bytes[index + 2] ?? 0) : 0;
    const quantum = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(quantum >> 18) & 63];
    output += BASE64_ALPHABET[(quantum >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(quantum >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[quantum & 63] : "=";
  }
  return output;
}

/**
 * Turns chunk-loop bytes into an `<img>`-renderable `data:` URI. Pure —
 * the relay path's answer to `buildAttachmentDownloadUrl`'s token URL:
 * no object URL to revoke when this hook's cache resets, and the same
 * helper the Android mirror uses for its own `Image` source.
 */
export function buildAttachmentDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${encodeBytesToBase64(bytes)}`;
}

/** Matches `packages/server/src/server/bootstrap.ts`'s
 * `app.get("/api/files/download", ...)` route exactly — see this
 * module's doc comment for why this is duplicated from
 * `features/files/file-download-client.ts`'s identical
 * `buildFileDownloadUrl` rather than imported. */
export function buildAttachmentDownloadUrl(origin: string, token: string): string {
  const url = new URL("/api/files/download", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

/** See this module's doc comment's third bullet. `null` whenever there is
 * no reachable direct HTTP origin: no profile, `kind !== "direct"`, or a
 * profile with no `direct` connection configured. */
export function resolveDirectHttpOrigin(
  profile: hosts.HostProfile | null,
  kind: hosts.HostConnectionKind | null,
): string | null {
  if (kind !== "direct" || !profile?.direct) {
    return null;
  }
  const scheme = profile.direct.useTls ? "https" : "http";
  return `${scheme}://${profile.direct.endpoint}`;
}

/** Every unique-by-`path` image reference across `entries`, in the order
 * first encountered. See this module's doc comment's first bullet. */
export function collectTimelineImages(
  entries: readonly timeline.TranscriptEntry[],
): readonly AgentTimelineImageRef[] {
  const seen = new Set<string>();
  const images: AgentTimelineImageRef[] = [];
  for (const entry of entries) {
    if (!isCoreMessageEntry(entry) || !entry.images) {
      continue;
    }
    for (const image of entry.images) {
      if (seen.has(image.path)) {
        continue;
      }
      seen.add(image.path);
      images.push(image);
    }
  }
  return images;
}

/**
 * Returns `resolved` unchanged (same reference) when `path` already maps
 * to `url` — so a caller storing this in `useState` never triggers an
 * extra render for a resolution that changed nothing. Otherwise returns
 * a new `Map` with `path` set, never mutating `resolved` itself.
 */
export function applyResolvedAttachmentImage(
  resolved: ReadonlyMap<string, string>,
  path: string,
  url: string,
): ReadonlyMap<string, string> {
  if (resolved.get(path) === url) {
    return resolved;
  }
  const next = new Map(resolved);
  next.set(path, url);
  return next;
}

export interface UseAttachmentImageResolverOptions {
  /** `null` with no live connection — every image resolves to `undefined` (the reference-card fallback). */
  client: AttachmentDownloadTokenClient | null;
  agentId: string;
  /**
   * `resolveDirectHttpOrigin`'s result — `null` on a relay connection or
   * with no connection yet. A `null` origin no longer means the reference
   * card: on a relay pairing the hook downloads the bytes inside the E2EE
   * channel via `client.downloadFileBytes({ agentId, path })` instead of
   * the token+HTTP round trip (see this module's doc comment). Only a
   * relay pairing whose client has no chunk-loop method at all — an old
   * daemon or adapter, per `supportsRelayAttachmentDownload` — keeps the
   * fallback.
   */
  downloadOrigin: string | null;
  /** The live transcript this session is rendering; only entries carrying `images` are read. */
  entries: readonly timeline.TranscriptEntry[];
}

/**
 * Builds the `ResolveImageSrc` this app's session route passes to
 * `EditFromHereSurface`/`Transcript`. See this module's doc comment for
 * the full design; in short: a `path` is requested at most once per
 * `(client, agentId, downloadOrigin)` generation, resolved URLs are
 * cached for the life of this hook's mount, and a resolution that fails
 * or comes back with no token is left unresolved forever (the reference
 * card), never retried.
 */
export function useAttachmentImageResolver({
  client,
  agentId,
  downloadOrigin,
  entries,
}: UseAttachmentImageResolverOptions): ResolveImageSrc {
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(() => new Map());
  const requestedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // A new connection generation (reconnect, or a switch between "direct"
  // and "relay") invalidates every token this hook may have requested
  // against the previous one: a stale cached URL would point at a token
  // no live daemon process still holds, and a path already marked
  // "requested" against a now-gone client would never be retried against
  // the new one.
  useEffect(() => {
    requestedRef.current = new Set();
    setResolved(new Map());
  }, [client, agentId, downloadOrigin]);

  const images = collectTimelineImages(entries);
  const imagePathsKey = images.map((image) => image.path).join(" ");

  useEffect(() => {
    if (!client) {
      return;
    }
    // Direct origin: the token+HTTP round trip. No direct origin but a
    // chunk-loop method: the relay path. Neither: an old daemon or
    // adapter — every image stays on the reference-card fallback, never a
    // doomed request.
    const useRelayChunkLoop = !downloadOrigin && supportsRelayAttachmentDownload(client);
    if (!downloadOrigin && !useRelayChunkLoop) {
      return;
    }
    for (const image of images) {
      if (requestedRef.current.has(image.path)) {
        continue;
      }
      requestedRef.current.add(image.path);
      if (useRelayChunkLoop) {
        client.downloadFileBytes!({ agentId, path: image.path })
          .then((result) => {
            if (!mountedRef.current || result.bytes.byteLength === 0) {
              return;
            }
            const url = buildAttachmentDataUri(result.bytes, result.mimeType ?? image.mimeType);
            setResolved((previous) => applyResolvedAttachmentImage(previous, image.path, url));
          })
          .catch(() => {
            // Left unresolved: `MessageAttachments`' own reference-card
            // fallback already covers "no src" — this hook adds no second
            // error surface (see module doc's "left unresolved forever,
            // never retried"). An old daemon's rejection of the chunk wire
            // type lands here, which is exactly the old-daemon fallback.
          });
        continue;
      }
      client
        .requestAttachmentDownloadToken(agentId, image.path)
        .then((payload) => {
          if (!mountedRef.current || !payload.token) {
            return;
          }
          const url = buildAttachmentDownloadUrl(downloadOrigin!, payload.token);
          setResolved((previous) => applyResolvedAttachmentImage(previous, image.path, url));
        })
        .catch(() => {
          // Left unresolved: `MessageAttachments`' own reference-card
          // fallback already covers "no src" — this hook adds no second
          // error surface (see module doc's "left unresolved forever,
          // never retried").
        });
    }
    // `images` itself is intentionally excluded: it is a fresh array on
    // every call (derived from `entries`, itself fresh every render while
    // streaming), and `imagePathsKey` is the stable summary of the only
    // thing about it this effect cares about — which paths exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, agentId, downloadOrigin, imagePathsKey]);

  return useCallback(
    (image: AgentTimelineImageRef, _context: MessageAttachmentImageContext) =>
      resolved.get(image.path),
    [resolved],
  );
}
