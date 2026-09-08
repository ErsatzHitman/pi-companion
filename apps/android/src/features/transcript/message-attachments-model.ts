/**
 * Message image/attachment render model (T33A5; plan.md §9.3, §11.1,
 * §11.6 "file and image results").
 *
 * Picks up the "deliberate difference from web" `message-row-model.ts`
 * documented and named this task for: `CoreMessageEntry.images`
 * (`AgentTimelineImageRef[]`, T52A2's passthrough) is now rendered, not
 * merely carried.
 *
 * Mirrors `apps/web/src/features/transcript/message-attachments.tsx`'s
 * pure helpers one for one (`formatImageSize`, `formatImageKind`,
 * `accessibleImageName`, `MAX_IMAGES_PER_ENTRY`) so the same fixture
 * produces the same accessible name and the same bound on both
 * platforms. Kept free of any React or React Native import (this
 * directory's established pattern — see `./message-row-model.ts`'s and
 * `./tool-call-row-model.ts`'s doc comments), so it is unit-testable
 * under this workspace's plain `vitest` setup.
 *
 * **Same shape as web, same answer.** `AgentTimelineImageRef` carries a
 * `path` into a daemon-local temp directory (`materializeProviderImage`),
 * not workspace-relative bytes — see web's `message-attachments.tsx`
 * module doc comment for the full citation trail. CORRECTED at the P9-P
 * merge gate: this called it a "backend gap" and said "no existing RPC
 * will resolve" such a path. T283 shipped one —
 * `attachment_download_token_request`, capability-scoped to paths
 * already on the requesting agent's own timeline (plan.md §12.4,
 * "Attachment bytes"). What remains true is that nothing supplies
 * `resolveImageUri` yet, so there is no resolver wired here to call;
 * supplying it is T284's. Rather than
 * inventing pixels or dropping the reference silently, every image
 * renders as an accessible reference card — name, kind, size — through
 * `imageAttachmentViewModel` below, with an optional `resolveImageUri`
 * seam (`message-attachments.tsx`) so a future daemon RPC can start
 * rendering real previews with no change to this module's shape.
 */
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

export interface AttachmentImageContext {
  readonly entryId: string;
  readonly speaker: "assistant" | "user";
  readonly index: number;
  readonly total: number;
}

/** Bound on how many images one message row renders (defensive DOM/list-
 * size bound, same family as `tool-call-row-model.ts`'s `DIFF_LINE_CAP`
 * and web's identical constant): a pathological message with dozens of
 * pasted images still shows the first several plus a visible, named
 * count of what was hidden, rather than growing one row's native list
 * without bound (plan.md §14.5's per-row half of the "bounded window"
 * budget). Matches web's `MAX_IMAGES_PER_ENTRY` exactly so the same
 * fixture bounds the same way on both platforms. */
export const MAX_IMAGES_PER_ENTRY = 12;

/** Decoded-byte ceiling before an image is reported as too large to
 * preview rather than handed to a resolver at all — matches web's
 * `MAX_INLINE_IMAGE_BYTES` (2 MB) so a very large image gets the same
 * visible treatment on both platforms, and gives `resolveImageUri` a
 * documented ceiling to honour once a real daemon RPC exists. */
export const MAX_INLINE_IMAGE_BYTES = 2_000_000;

const SIZE_UNITS = ["KB", "MB", "GB"] as const;

/** Formats a decoded byte count as e.g. `"340 B"`, `"12.4 KB"`. Byte-for-
 * byte the same formatting as web's `formatImageSize` (self-contained
 * here for the same reason web's is: this directory's owned files must
 * not reach into a sibling feature directory another task in this wave
 * may be editing concurrently). */
export function formatImageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${SIZE_UNITS[unitIndex]}`;
}

/** `"image/svg+xml"` -> `"SVG image"`, `"image/png"` -> `"PNG image"`. Falls
 * back to the raw MIME type for anything this pattern does not match, so
 * an unusual value still shows something rather than nothing. Same
 * behaviour as web's `formatImageKind`. */
export function formatImageKind(mimeType: string): string {
  const trimmed = mimeType.trim();
  const match = /^image\/([a-z0-9.-]+)/i.exec(trimmed);
  if (!match) {
    return trimmed.length > 0 ? trimmed : "Image";
  }
  const subtype = match[1].split("+")[0] ?? match[1];
  return `${subtype.toUpperCase()} image`;
}

/**
 * The accessible name for one image (acceptance: "images and attachments
 * render with accessible names" — a screen reader user must be able to
 * act on the announcement even with no preview, no alt text, and no
 * filename). `AgentTimelineImageRef` carries no user-facing filename at
 * all — only `path`, a daemon-local temp path that would be actively
 * misleading to show — so this is built entirely from information that
 * *is* meaningful: who attached it, its position among any siblings, its
 * kind, and its size. Byte-for-byte the same sentence shape as web's
 * `accessibleImageName`.
 */
export function accessibleImageName(
  context: AttachmentImageContext,
  kindLabel: string,
  sizeLabel: string | null,
): string {
  const who = context.speaker === "assistant" ? "Pi" : "You";
  const position = context.total > 1 ? ` (${context.index + 1} of ${context.total})` : "";
  const size = sizeLabel ? `, ${sizeLabel}` : "";
  return `${who} attached an image${position}: ${kindLabel}${size}`;
}

export interface ImageAttachmentViewModel {
  /** Stable-enough positional key (`AgentTimelineImageRef` carries no id
   * of its own; this list is only ever appended to or truncated from the
   * end for a given entry, same rationale web's `MessageAttachments`
   * documents for its own positional keys). */
  key: string;
  /** The full accessible name (see `accessibleImageName`) — set as the
   * container's `accessibilityLabel` by the view, never left for a
   * screen reader to assemble from separate text nodes. */
  name: string;
  kindLabel: string;
  sizeLabel: string | null;
  /** `true` when `image.bytes` exceeds `MAX_INLINE_IMAGE_BYTES` — the
   * oversized-payload case this task's acceptance names explicitly. */
  oversized: boolean;
  /** The visible caption explaining why there is no preview: the
   * oversized reason when `oversized`, else the "no resolver wired yet"
   * reason. Always shown as visible text, never colour/icon alone. */
  note: string;
}

/** Builds the full view model for one image attachment. Pure and total —
 * every `AgentTimelineImageRef`, including one with an unrecognized MIME
 * type or no `bytes`, produces a valid `ImageAttachmentViewModel`. */
export function imageAttachmentViewModel(
  image: AgentTimelineImageRef,
  context: AttachmentImageContext,
): ImageAttachmentViewModel {
  const kindLabel = formatImageKind(image.mimeType);
  const sizeLabel = image.bytes !== undefined ? formatImageSize(image.bytes) : null;
  const name = accessibleImageName(context, kindLabel, sizeLabel);
  const oversized = image.bytes !== undefined && image.bytes > MAX_INLINE_IMAGE_BYTES;
  const note = oversized
    ? `Image omitted from preview (${sizeLabel ?? "size unknown"} exceeds the ${formatImageSize(
        MAX_INLINE_IMAGE_BYTES,
      )} preview limit).`
    : "A preview isn't available for this image in this client yet.";
  return {
    key: `${context.entryId}-image-${context.index}`,
    name,
    kindLabel,
    sizeLabel,
    oversized,
    note,
  };
}

export interface BoundedImages<T> {
  visible: readonly T[];
  hiddenCount: number;
}

/** Slices `images` to `max` (default `MAX_IMAGES_PER_ENTRY`), reporting
 * how many were hidden so the caller can render a visible, named count
 * rather than silently dropping the rest. Tested at the exact boundary
 * (`max` images: nothing hidden; `max + 1`: exactly one hidden). */
export function boundImages<T>(
  images: readonly T[],
  max: number = MAX_IMAGES_PER_ENTRY,
): BoundedImages<T> {
  const visible = images.slice(0, max);
  return { visible, hiddenCount: images.length - visible.length };
}

/** The whole attachment group's `accessibilityLabel` (plan.md §9.3/§10.5:
 * a role/count must never be conveyed by an icon or layout position
 * alone) — mirrors web's identical `groupLabel` string. */
export function imageGroupAccessibilityLabel(speaker: "assistant" | "user", total: number): string {
  const who = speaker === "assistant" ? "Pi" : "You";
  return `${who} attached ${total} image${total === 1 ? "" : "s"}`;
}
