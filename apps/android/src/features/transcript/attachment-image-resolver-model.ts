/**
 * T284: the pure, RN-free core behind `use-attachment-image-resolver.ts`'s
 * `ResolveImageUri` hook — mirrors
 * `apps/web/src/features/transcript/attachment-image-resolver.ts`'s three
 * pure helpers one for one (same names, same behaviour, same test
 * fixtures where the fixture shape allows), for the same reason every
 * other `-model.ts` file in this directory mirrors its web sibling: the
 * same daemon capability, the same wire contract, so the same fixture
 * should produce the same outcome on both platforms.
 *
 * Kept in its own module, free of any React or React Native import (this
 * directory's established convention — see `message-attachments-model.ts`'s
 * own doc comment), so it is unit-testable under this workspace's plain
 * `vitest` setup. The actual `useState`/`useEffect` orchestration lives in
 * `./use-attachment-image-resolver.ts`, a thin `react`-only (never
 * `react-native`) hook with no test file of its own — the same "thin hook
 * over an already-tested pure core, deliberately untested by rendering"
 * precedent `../connect/use-connection-status.ts` already established in
 * this workspace (`@testing-library/react-native` would pull in
 * `react-native`, reproducing the RolldownError `CLAUDE.md`'s
 * "VITEST LIMITATION" describes; `@testing-library/react` is not
 * installed for this app — `apps/android/package.json` carries no
 * `react-dom`).
 *
 * Android's own daemon HTTP origin resolution
 * (`features/connect/daemon-connection-store.ts`'s `buildDaemonHttpOrigin`,
 * fed `AppCore.connection`'s `daemonAddress`) already exists and is reused
 * directly by the route — unlike web, this module has no
 * `resolveDirectHttpOrigin` of its own to duplicate that.
 */
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";
import type { timeline } from "@picompanion/frontend-core";

import { isCoreMessageEntry } from "./message-row-model";

/**
 * The one method this hook needs off `@picompanion/client`'s
 * `DaemonClient` — a real `DaemonClient` satisfies this structurally
 * as-is, the same shape web's identically-named interface documents (see
 * that module's doc comment for the full T283 wire contract).
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
}

/** Matches `packages/server/src/server/bootstrap.ts`'s
 * `app.get("/api/files/download", ...)` route exactly — byte-for-byte
 * the same route web's identically-named function builds. Duplicated
 * rather than imported across platforms for the obvious reason (two
 * separate apps, two separate dependency graphs), and not imported from
 * this app's own `features/files/file-browser-client.ts` either, per
 * this directory's own established "self-contained, no reach into a
 * sibling feature directory" convention (`message-attachments.tsx`'s
 * `formatImageSize` doc comment).
 *
 * **Built by concatenation, never `new URL()`.** CORRECTED at the P9-Q
 * merge gate: this shipped as `new URL("/api/files/download", origin)`
 * plus `searchParams`, copied from web's body. The convention cited
 * above is real, but it explains why not to IMPORT the sibling — it was
 * then used to justify copying web's implementation, and it dropped the
 * sibling's own stated reason for having a different shape:
 * `file-browser-client.ts`'s `buildFileDownloadUrl` is deliberately
 * string concatenation "(unlike web's `buildFileDownloadUrl`) so this
 * stays usable from the same plain Node `vitest` environment as every
 * other pure function in this file, with no assumption about which JS
 * engine's globals are present."
 *
 * That assumption is false on this platform. React Native ships no
 * native `URL`; `react-native`'s `Libraries/Blob/URL.js` polyfills it and
 * validates the base against a hand-rolled regex that **rejects a
 * bracketed IPv6 authority**. Executed against that exact regex, taken
 * from the installed file:
 *
 *     http://192.168.1.5:6767          accepted
 *     http://localhost:6767            accepted
 *     https://daemon.example.com:6767  accepted
 *     http://[::1]:6767                THROWS TypeError: Invalid base URL
 *     http://[fe80::1]:6767            THROWS TypeError: Invalid base URL
 *
 * And this app produces exactly that shape on purpose:
 * `features/connect/daemon-connection-store.ts`'s `buildDaemonHttpOrigin`
 * brackets the host when `isIpv6` says to. The throw would land inside
 * the resolver hook's `.then()` and be swallowed by its `.catch()`, so
 * every attachment on an IPv6 daemon would render the reference card
 * forever with no error anywhere. Node's WHATWG `URL` accepts brackets,
 * so no Node-hosted test could ever have caught it. */
export function buildAttachmentDownloadUrl(origin: string, token: string): string {
  const trimmed = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${trimmed}/api/files/download?token=${encodeURIComponent(token)}`;
}

/** Every unique-by-`path` image reference across `entries`, in the order
 * first encountered — byte-for-byte the same de-duplication web's
 * identically-named function performs. */
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
