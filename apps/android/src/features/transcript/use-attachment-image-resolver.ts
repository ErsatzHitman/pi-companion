/**
 * T284: the route-level `ResolveImageUri` this app's session route
 * supplies to `TranscriptMessageRow`/`MessageAttachments` — see
 * `message-attachments.tsx`'s module doc for the seam's contract, and
 * `attachment-image-resolver-model.ts`'s module doc for why the actual
 * cache/de-duplication logic lives there instead of here, unit-tested,
 * while this file stays a thin, deliberately untested-by-rendering
 * `react`-only wrapper (never `react-native` — that is what keeps this
 * file, unlike `index.tsx`, resolvable under plain `vitest`, though
 * nothing here exercises it that way; see the model module's doc comment
 * for the precedent this follows).
 *
 * Byte-for-byte the same shape as
 * `apps/web/src/features/transcript/attachment-image-resolver.ts`'s
 * identically-named `useAttachmentImageResolver` — same cache-reset-on-
 * connection-change behaviour, same "request each path at most once,
 * never retry a failed/no-token resolution", same single-use-token
 * disclosure (`DownloadTokenStore.consumeToken` deletes on read; see that
 * module's doc comment for the full reasoning, unchanged here).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { timeline } from "@picompanion/frontend-core";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import {
  applyResolvedAttachmentImage,
  buildAttachmentDownloadUrl,
  collectTimelineImages,
  type AttachmentDownloadTokenClient,
} from "./attachment-image-resolver-model";
import type { AttachmentImageContext, ResolveImageUri } from "./message-attachments";

export interface UseAttachmentImageResolverOptions {
  /** `undefined`/`null` with no live connection — every image resolves to `undefined` (the reference-card fallback). */
  client: AttachmentDownloadTokenClient | null | undefined;
  agentId: string;
  /** This app's `buildDaemonHttpOrigin(daemonAddress)` result — `null` on a relay connection or with no connection yet. */
  downloadOrigin: string | null;
  /** The live transcript this session is rendering; only entries carrying `images` are read. */
  entries: readonly timeline.TranscriptEntry[];
}

export function useAttachmentImageResolver({
  client,
  agentId,
  downloadOrigin,
  entries,
}: UseAttachmentImageResolverOptions): ResolveImageUri {
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
  // against the previous one — see web's identically-shaped effect for
  // the full reasoning.
  useEffect(() => {
    requestedRef.current = new Set();
    setResolved(new Map());
  }, [client, agentId, downloadOrigin]);

  const images = collectTimelineImages(entries);
  const imagePathsKey = images.map((image) => image.path).join(" ");

  useEffect(() => {
    if (!client || !downloadOrigin) {
      return;
    }
    for (const image of images) {
      if (requestedRef.current.has(image.path)) {
        continue;
      }
      requestedRef.current.add(image.path);
      client
        .requestAttachmentDownloadToken(agentId, image.path)
        .then((payload) => {
          if (!mountedRef.current || !payload.token) {
            return;
          }
          const url = buildAttachmentDownloadUrl(downloadOrigin, payload.token);
          setResolved((previous) => applyResolvedAttachmentImage(previous, image.path, url));
        })
        .catch(() => {
          // Left unresolved: `MessageAttachments`' own reference-card
          // fallback already covers "no uri" — this hook adds no second
          // error surface.
        });
    }
    // `images` is intentionally excluded — see web's identical effect's
    // comment for why `imagePathsKey` is this effect's real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, agentId, downloadOrigin, imagePathsKey]);

  return useCallback(
    (image: AgentTimelineImageRef, _context: AttachmentImageContext) => resolved.get(image.path),
    [resolved],
  );
}
