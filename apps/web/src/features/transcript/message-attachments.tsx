import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import { Link } from "../../ui/primitives/index.js";
import "./message-attachments.css";

/**
 * Renders the `images` a `user-message`/`assistant-message` transcript
 * entry carries (T52A2's `TranscriptEntry.images`, plan.md §11.6 "file
 * and image results"). Completes the criterion T28A5 could not — see
 * `message-row.tsx`'s doc comment (pre-T52A3) for the exact proof of
 * where the wire protocol used to drop this content before T52A1/T52A2
 * carried it through.
 *
 * **What this file can and cannot render, and why (read before changing
 * the fallback path below).** `AgentTimelineImageRef` (`packages/protocol
 * /src/agent-types.ts:357`) carries a `mimeType`, a `path`, and an
 * optional decoded `bytes` count — never inline bytes ("large binary
 * content is referenced rather than inlined wholesale", T52A1
 * acceptance). Resolving `path` to browser-renderable bytes needs a
 * daemon RPC (plan.md §12.4), and every such RPC that exists today —
 * `readFile`/`file_explorer_request` and
 * `requestDownloadToken`/`file_download_token_request`
 * (`packages/client/src/daemon-client.ts`) — resolves a `path` that must
 * be *relative to a workspace `cwd`*
 * (`packages/server/src/server/file-explorer/service.ts`'s
 * `resolveScopedPath`, which throws "Access outside of workspace is not
 * allowed" — that file's `ACCESS_OUTSIDE_WORKSPACE_MESSAGE` constant —
 * for anything outside `root`). The `path`
 * an inbound message image carries is not workspace-relative: it points
 * into a process-wide temp directory
 * (`os.tmpdir()/paseo-attachments-*`,
 * `packages/server/src/server/agent/providers/provider-image-output.ts`'s
 * `materializeProviderImage`) that exists specifically *outside* any
 * session's workspace root, so both existing RPCs reject it.
 *
 * CORRECTED at the P9-P merge gate. This said: "There is no third RPC
 * that serves an unscoped path. This is a real, provable backend gap,
 * not a client omission — resolving it needs new daemon work (a
 * dedicated attachment-serving RPC, or widening one of the existing ones
 * to accept a capability-scoped path)". T283 did that daemon work. The
 * third RPC now exists — `attachment_download_token_request`, served by
 * `packages/server/src/server/file-upload/attachment-access.ts`'s
 * `resolveAttachmentForDownload`, which admits a path only when it is
 * already recorded on the requesting agent's own timeline AND its
 * realpath lies inside the attachment temp root (plan.md §12.4,
 * "Attachment bytes"). `resolveScopedPath` was NOT widened.
 *
 * CORRECTED at T284: this said "nothing supplies `resolveImageSrc` yet",
 * naming wiring the seam at the route level as T284's own remaining
 * work. `routes/screens/host-session-screen.tsx` now does exactly that
 * (`useAttachmentImageResolver`,
 * `features/transcript/attachment-image-resolver.ts`) — a phone
 * attachment sent from `apps/android` really does render here, over a
 * `"direct"` daemon connection. `resolveImageSrc` still resolves
 * `undefined` (this file's reference card, below) for every image with
 * no live connection yet, or a `"relay"`-paired one: a relay tunnel
 * proxies only the encrypted WebSocket, so there is no direct daemon HTTP
 * endpoint to fetch a token URL from — see
 * `attachment-image-resolver.ts`'s own module doc for why that is this
 * capability's real, by-design boundary, not a gap left open.
 *
 * Rather than either faking a preview (inventing pixels this client
 * cannot actually fetch) or dropping the image silently, `resolveImageSrc`
 * below is an explicit, optional seam: any caller that has a way to turn
 * a path into a fetchable URL can supply one, and every image in this
 * transcript renders it immediately with no change to this file. Absent
 * one — or when it returns `undefined` for a given image — that image
 * renders through the same real, accessible, keyboard-reachable
 * reference card the acceptance criteria ask for — never a blank space,
 * never a broken `<img>`.
 */
export type ResolveImageSrc = (
  image: AgentTimelineImageRef,
  context: MessageAttachmentImageContext,
) => string | undefined;

export interface MessageAttachmentImageContext {
  readonly entryId: string;
  readonly speaker: "assistant" | "user";
  readonly index: number;
  readonly total: number;
}

export interface MessageAttachmentsProps {
  readonly images: ReadonlyArray<AgentTimelineImageRef>;
  readonly entryId: string;
  readonly speaker: "assistant" | "user";
  /** Resolves an image reference to a browser-fetchable URL. See the
   * module doc comment above for why this is optional and what renders
   * when it is omitted or returns `undefined` for a given image. */
  readonly resolveImageSrc?: ResolveImageSrc;
  readonly testId?: string;
}

/** Bound on how many images one message row renders (defensive DOM-size
 * bound, same family as `tool-call-row.tsx`'s `MAX_DIFF_LINES`/
 * `MAX_LIST_ROWS`): a pathological message with dozens of pasted images
 * still shows the first several plus a visible count of what was
 * hidden, rather than growing one row's DOM without bound (plan.md
 * §14.5 "transcript: 10,000 timeline items without rendering more than a
 * bounded window" — this is the per-row half of that budget). */
const MAX_IMAGES_PER_ENTRY = 12;

/** Decoded-byte bound before an image preview is replaced with a bounded
 * text note instead of an `<img>`, even when `resolveImageSrc` supplies a
 * URL (T28A5 acceptance, inherited by T52A3: "oversized payloads are
 * bounded, not dropped silently"). Matches `tool-call-row.tsx`'s
 * `MAX_INLINE_IMAGE_BYTES` so a very large image gets the same visible
 * treatment everywhere in the transcript. */
const MAX_INLINE_IMAGE_BYTES = 2_000_000;

const SIZE_UNITS = ["KB", "MB", "GB"] as const;

/** Formats a decoded byte count as e.g. `"340 B"`, `"12.4 KB"`. Self
 * contained (not imported from `features/files/format.ts`) so this
 * directory's owned files do not reach into a sibling feature directory
 * another task in this wave may be editing concurrently. */
function formatImageSize(bytes: number): string {
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
 * an unusual value still shows something rather than nothing. */
function formatImageKind(mimeType: string): string {
  const trimmed = mimeType.trim();
  const match = /^image\/([a-z0-9.-]+)/i.exec(trimmed);
  if (!match) {
    return trimmed.length > 0 ? trimmed : "Image";
  }
  const subtype = match[1].split("+")[0] ?? match[1];
  return `${subtype.toUpperCase()} image`;
}

/**
 * The accessible name for one image (T52A3 acceptance: "a message's
 * images render with a meaningful accessible name, not a filename
 * alone"). `AgentTimelineImageRef` has no user-facing filename at all —
 * only `path`, which is a daemon-local temp path
 * (`materializeProviderImage`, see module doc) that would be actively
 * misleading to show as a name — so this is built entirely from
 * information that *is* meaningful: who attached it, its position among
 * any siblings, its image kind, and its size.
 */
function accessibleImageName(
  context: MessageAttachmentImageContext,
  kindLabel: string,
  sizeLabel: string | null,
): string {
  const who = context.speaker === "assistant" ? "Pi" : "You";
  const position = context.total > 1 ? ` (${context.index + 1} of ${context.total})` : "";
  const size = sizeLabel ? `, ${sizeLabel}` : "";
  return `${who} attached an image${position}: ${kindLabel}${size}`;
}

interface AttachmentReferenceProps {
  name: string;
  kindLabel: string;
  sizeLabel: string | null;
  note: string;
  testId?: string;
}

/**
 * The fallback rendered for every image `resolveImageSrc` cannot turn
 * into an `<img>` today (see module doc comment) — and doubles as this
 * task's answer to "non-image attachments show type and size and are
 * keyboard reachable": `AgentTimelineImageRef` is the only binary
 * attachment shape a timeline item can carry at all (T52A1 confirmed
 * every `AgentAttachment` variant is flattened to text before Pi ever
 * sees it — see `message-row.tsx`'s doc comment for the citation), so
 * this reference card *is* the non-preview-able attachment case, applied
 * to the one attachment shape that exists.
 *
 * A native `<details>`/`<summary>` disclosure — the same interactive
 * pattern `tool-call-row.tsx`'s `.pc-tool-call__details` already
 * establishes for this transcript — gives real keyboard operation
 * (`Tab` reaches the `<summary>`, `Enter`/`Space` toggles it) and an
 * implicit accessible name from its text content, with no custom ARIA
 * needed.
 *
 * **T284: confirmed, not changed, that this is this product's "compact
 * chip" answer for a non-previewable attachment — the collapsed
 * `<summary>` line (name + kind/size badge) IS the chip; expanding it
 * reveals only the explanatory note, never a second control.** This is
 * deliberately a different component from `ui/primitives/Chip.tsx`'s
 * `Chip`/`ChipGroup` — the pill `Composer.tsx` renders for a *staged,
 * pre-send* attachment (always paired with a `Remove` affordance, no
 * expandable content of its own). A read-only, already-sent message
 * attachment needs the opposite shape (no remove action; a disclosure for
 * "why no preview"), which is exactly what `AttachmentReference` already
 * is — reusing `Chip` here would have to bolt a `<details>` onto a
 * component built for removal, not gained anything, and this task's own
 * brief says not to fork the renderer without a reason. No non-image
 * attachment can reach a transcript row at all today to need this
 * treatment for a different reason (see this component's doc comment
 * just above): the reference card doubles as the answer for both cases
 * because they collapse to the identical shape — "an attachment reference
 * with no live preview available" — not because one was special-cased for
 * the other.
 */
function AttachmentReference({
  name,
  kindLabel,
  sizeLabel,
  note,
  testId,
}: AttachmentReferenceProps) {
  return (
    <details
      className="pc-message-attachment pc-message-attachment--reference"
      data-testid={testId}
    >
      <summary>
        {name}
        <span className="pc-message-attachment__badge">
          {kindLabel}
          {sizeLabel ? ` · ${sizeLabel}` : ""}
        </span>
      </summary>
      <p className="pc-message-attachment__meta">{note}</p>
    </details>
  );
}

function MessageAttachmentImage({
  image,
  context,
  resolveImageSrc,
  testId,
}: {
  image: AgentTimelineImageRef;
  context: MessageAttachmentImageContext;
  resolveImageSrc?: ResolveImageSrc;
  testId?: string;
}) {
  const kindLabel = formatImageKind(image.mimeType);
  const sizeLabel = image.bytes !== undefined ? formatImageSize(image.bytes) : null;
  const name = accessibleImageName(context, kindLabel, sizeLabel);
  const oversized = image.bytes !== undefined && image.bytes > MAX_INLINE_IMAGE_BYTES;

  if (oversized) {
    return (
      <AttachmentReference
        name={name}
        kindLabel={kindLabel}
        sizeLabel={sizeLabel}
        note={`Image omitted from preview (${sizeLabel ?? "size unknown"} exceeds the ${formatImageSize(
          MAX_INLINE_IMAGE_BYTES,
        )} preview limit).`}
        testId={testId}
      />
    );
  }

  const src = resolveImageSrc?.(image, context);
  if (!src) {
    return (
      <AttachmentReference
        name={name}
        kindLabel={kindLabel}
        sizeLabel={sizeLabel}
        note="A preview isn't available for this image in this client yet."
        testId={testId}
      />
    );
  }

  return (
    <figure className="pc-message-attachment pc-message-attachment--image" data-testid={testId}>
      <Link href={src} external className="pc-message-attachment__link">
        <img src={src} alt={name} className="pc-message-attachment__image" />
      </Link>
      <figcaption className="pc-message-attachment__caption">
        {kindLabel}
        {sizeLabel ? ` · ${sizeLabel}` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * Renders every image on one message entry, bounded and keyboard
 * reachable (T52A3). Returns `null` for an entry with no images (the
 * common case) so callers can render this unconditionally.
 */
export function MessageAttachments({
  images,
  entryId,
  speaker,
  resolveImageSrc,
  testId,
}: MessageAttachmentsProps) {
  if (images.length === 0) {
    return null;
  }

  const bounded = images.slice(0, MAX_IMAGES_PER_ENTRY);
  const hiddenCount = images.length - bounded.length;
  const groupLabel = `${speaker === "assistant" ? "Pi" : "You"} attached ${images.length} image${
    images.length === 1 ? "" : "s"
  }`;

  return (
    <div
      className="pc-message-attachments"
      role="group"
      aria-label={groupLabel}
      data-testid={testId}
    >
      {bounded.map((image, index) => (
        <MessageAttachmentImage
          // Positional key: `AgentTimelineImageRef` carries no stable id
          // of its own, and this list is only ever appended to or
          // truncated from the end for a given entry (the same rationale
          // `tool-call-row.tsx`'s `DiffLines` documents for its own
          // positional keys).
          key={`${entryId}-image-${index}`}
          image={image}
          context={{ entryId, speaker, index, total: images.length }}
          resolveImageSrc={resolveImageSrc}
          testId={testId ? `${testId}-${index}` : undefined}
        />
      ))}
      {hiddenCount > 0 ? (
        <p className="pc-message-attachments__meta">
          {hiddenCount} more image{hiddenCount === 1 ? "" : "s"} not shown
        </p>
      ) : null}
    </div>
  );
}

export default MessageAttachments;
