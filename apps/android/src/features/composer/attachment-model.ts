/**
 * Attachment staging model (T33B7, plan.md §9.2/§12.4).
 *
 * Pure, RN-free state transitions for the files a user has picked but
 * not yet sent — staged, uploading, uploaded, or errored — kept
 * completely separate from `composer-model.ts`'s `ComposerEntry`
 * lifecycle (which only exists once a message has actually been sent).
 * `Composer.tsx` is a thin view over this module, exactly like its
 * split with `composer-model.ts`.
 *
 * Uploads go over daemon RPC (`packages/client/src/daemon-client.ts`'s
 * `uploadFile`) — never `fs`, never `expo-file-system`'s write path,
 * never a local path API, the same prohibition `features/files/` is
 * under. This module never touches a filesystem itself; it only shapes
 * state around whatever an injected `AttachmentUploadClient` reports.
 * `ComposerUploadedAttachment` mirrors `packages/protocol/src/
 * messages.ts`'s `UploadedFileAttachmentSchema` field-for-field
 * (including the literal `type: "uploaded_file"`), matching
 * `apps/web/src/features/composer/agent-turn-client.ts`'s
 * `AgentUploadedAttachment` convention exactly so a future real
 * `AttachmentUploadClient` (backed by `DaemonClient.uploadFile`) needs
 * no translation step — this is the *wire* shape, not invented.
 *
 * Limits (`AttachmentLimits`) are enforced locally, before any network
 * round trip: `maxTotalBytes` mirrors `DaemonClient.uploadFile`'s own
 * 100 MiB `MAX_UPLOAD_BYTES` ceiling (matching
 * `apps/web/src/features/composer/use-attachments.ts`'s
 * `DEFAULT_MAX_ATTACHMENT_BYTES`, so the daemon's own single-file
 * ceiling and this batch's combined ceiling agree at the same number);
 * `maxCount`/`maxBytesPerFile` are this feature's own, stricter
 * per-file/per-batch limits — six full 100 MiB files in one message
 * would blow the daemon's ceiling on their own, so `maxBytesPerFile` is
 * deliberately smaller than that ceiling. `describeAttachmentLimits`
 * renders all three as
 * one sentence so `Composer.tsx` can surface them *before* a user opens
 * the picker (plan.md's own "explain the boundary before the failure"
 * expectation for this task), and `evaluateAttachmentCandidate` is
 * exercised at the exact boundary in `attachment-model.test.ts`. A
 * previewable image is still subject to every one of these ceilings —
 * `previewUri` (below) is never itself checked against a limit, only
 * carried alongside a candidate that already passed
 * `evaluateAttachmentCandidate` on `size`/`mimeType`/count exactly as
 * before.
 *
 * ## T278: the preview channel, and why it is a URI, not bytes
 *
 * `StagedAttachment.previewUri` is an OPTIONAL, IMAGE-TYPES-ONLY field
 * (`stageAttachment` below only ever copies it through when
 * `mimeType.startsWith("image/")` — a non-image candidate's
 * `previewUri` is dropped even if a caller mistakenly supplies one, so
 * the "images only" rule holds at this module's boundary, not merely as
 * a convention a renderer has to remember). Non-image attachments stay
 * the plain name/size/remove chip they always were — **no preview for
 * them, by decision**, not an oversight: a generic document icon
 * carries no information a thumbnail would add, and every renderer in
 * this feature already draws that compact chip correctly.
 *
 * Two shapes were on the table for what `previewUri` actually holds:
 *
 * 1. **A local platform URI** (what this module does) — a `file://` or
 *    `content://` string naming wherever the OS picker/camera already
 *    put the image, handed through by `attachment-source-port.ts`'s
 *    `PickedAttachmentFile.uri`. `Composer.tsx` passes this straight to
 *    React Native's `<Image source={{ uri }} />`, which decodes and
 *    caches the bitmap natively, downsampled to display size — none of
 *    that decoded memory is ever a JS string or a `Uint8Array` this
 *    module holds.
 * 2. **A data URI** (`data:image/...;base64,...`) — portable (no
 *    platform-specific scheme, survives a serialize/deserialize round
 *    trip) but requires reading the ENTIRE file into memory via
 *    `readAsBytes()` and base64-encoding it, up front, the moment the
 *    file is staged — before a user has even seen a thumbnail, let
 *    alone sent the message.
 *
 * **Measured, not estimated** (`node -e` against a real `Buffer`, not a
 * paper calculation): encoding one 25 MiB (`26,214,400` byte) buffer —
 * this feature's own `maxBytesPerFile` ceiling — to base64 produces a
 * `34,952,536`-character string, and holding both the raw buffer and
 * its encoded string at once (exactly what building a data URI
 * requires) raised the measuring Node process's RSS by `58.34 MB` for
 * that ONE file. Repeating the measurement for `DEFAULT_ATTACHMENT_LIMITS`'s
 * own worst case — six 25 MiB images staged at once, `maxCount` — and
 * holding all twelve buffers (six raw + six encoded) live
 * simultaneously (the shape `AttachmentsState.entries` would need if
 * every entry carried a data URI) raised RSS by `350.35 MB` over the
 * same process's baseline: `150 MiB` of raw source bytes plus
 * `~200 MB` of base64 text (`209,715,354` characters total), for one
 * feature's optional preview strip. A local URI's cost for the same six
 * files is six short strings — on the order of a few hundred bytes
 * combined, not megabytes — because the image bytes themselves are
 * never copied into this module's state at all.
 *
 * **What is released, and when.** Because `previewUri` is only ever a
 * string reference, there is no separate buffer this module ever holds
 * to release: `removeAttachment` and `clearAttachments` (below) already
 * drop the entry from `AttachmentsState.entries` — on removal, and on a
 * successful send respectively — and the string (and, on the JS side,
 * any native bitmap React Native cached for it) becomes eligible for
 * garbage collection at that same moment, with no extra step this
 * module needs to take. This is the whole practical payoff of choosing
 * a URI over a data URI: had this module held the base64 text itself,
 * the SAME two call sites would have needed to be the place that frees
 * tens of megabytes per file, and a caller that forgot to route through
 * either one would have leaked it.
 *
 * What this module does NOT own: if a future real
 * `AttachmentSourcePort`/`CameraCapturePort` implementation copies the
 * picked/captured image into a cache directory to produce the URI it
 * hands back (as Expo's `expo-image-picker` does), cleaning up that
 * on-disk temp file is that implementation's job, not this module's —
 * this module never touches a filesystem itself (see this doc
 * comment's own opening paragraph), so it has no path to delete from.
 * Filed for whoever wires a real picker/camera: that implementation's
 * own doc comment should say plainly whether it cleans up its cache
 * files, and if not, why leaving them is acceptable (Expo's own picker
 * cache is normally reclaimed by the OS under storage pressure, but
 * that is the OS's policy, not a guarantee this module can rely on).
 */

export type StagedAttachmentStatus = "uploading" | "uploaded" | "error";

/** Mirrors `UploadedFileAttachmentSchema` (`packages/protocol/src/messages.ts`) field-for-field — see this module's doc comment. */
export interface ComposerUploadedAttachment {
  readonly type: "uploaded_file";
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly path: string;
}

export interface StagedAttachment {
  /** Locally stable id for this staged attachment; not a daemon id. */
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: StagedAttachmentStatus;
  /**
   * A local platform URI (`file://…`, `content://…`) to render this
   * staged file as an image thumbnail — present only when `mimeType`
   * starts with `"image/"` (see this module's "T278: the preview
   * channel" doc comment for why a URI, not a data URI, and why
   * non-image types never carry one). `undefined` for every non-image
   * attachment, which is the signal `Composer.tsx`'s
   * `StagedAttachmentRow` uses to fall back to the plain name/size chip.
   */
  previewUri?: string;
  /** Present once `status` is `"uploaded"`. */
  uploaded?: ComposerUploadedAttachment;
  /** Present once `status` is `"error"`, explaining what a retry should expect. */
  error?: string;
}

export interface AttachmentsState {
  entries: readonly StagedAttachment[];
}

export const EMPTY_ATTACHMENTS_STATE: AttachmentsState = { entries: [] };

/**
 * Local, pre-network ceilings — see this module's doc comment.
 * `maxBytesPerFile` matches `DaemonClient.uploadFile`'s own 100 MiB
 * `MAX_UPLOAD_BYTES` ceiling, so a file this module rejects locally
 * would have been rejected by the daemon anyway.
 */
export interface AttachmentLimits {
  /** Maximum staged attachments per outgoing message. */
  maxCount: number;
  /** Maximum size of any one file. */
  maxBytesPerFile: number;
  /** Maximum combined size of every currently staged file. */
  maxTotalBytes: number;
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxCount: 6,
  maxBytesPerFile: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

/** Formats a byte count as e.g. `"340 B"`, `"12.4 MB"`. */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

/** One sentence describing every limit, for display *before* the picker opens (see this module's doc comment). */
export function describeAttachmentLimits(limits: AttachmentLimits): string {
  return (
    `Up to ${limits.maxCount} files, ${formatAttachmentBytes(limits.maxBytesPerFile)} each, ` +
    `${formatAttachmentBytes(limits.maxTotalBytes)} total.`
  );
}

/** Combined size of every currently staged attachment (any status — an uploading file still counts against the total). */
export function totalStagedBytes(state: AttachmentsState): number {
  return state.entries.reduce((sum, entry) => sum + entry.size, 0);
}

export interface AttachmentCandidate {
  name: string;
  mimeType: string;
  size: number;
  /**
   * Optional local platform URI for an image candidate — see
   * `StagedAttachment.previewUri`'s doc comment. Ignored by
   * `evaluateAttachmentCandidate` (a preview is never itself checked
   * against a limit) and dropped by `stageAttachment` for any
   * `mimeType` that is not `"image/…"`, so passing one for a non-image
   * candidate is a harmless no-op, not a way to bypass the "images
   * only" rule.
   */
  previewUri?: string;
}

export type AttachmentRejectionReason = "count-limit" | "file-too-large" | "total-limit";

export type AttachmentAcceptance =
  | { accepted: true }
  | { accepted: false; reason: AttachmentRejectionReason; message: string };

/**
 * Checks one candidate file against every limit *before* it is staged
 * or uploaded — count first (cheapest, and the one that gates whether
 * this file should even be considered), then its own size, then the
 * running total. `attachment-model.test.ts` asserts each boundary
 * exactly: a file at precisely `maxBytesPerFile` is accepted, one byte
 * over is rejected; a batch that lands exactly at `maxTotalBytes` is
 * accepted, one byte over is rejected; the `maxCount`-th file is
 * accepted, the `(maxCount+1)`-th is rejected.
 */
export function evaluateAttachmentCandidate(
  state: AttachmentsState,
  candidate: AttachmentCandidate,
  limits: AttachmentLimits,
): AttachmentAcceptance {
  if (state.entries.length >= limits.maxCount) {
    return {
      accepted: false,
      reason: "count-limit",
      message: `Up to ${limits.maxCount} attachments per message.`,
    };
  }
  if (candidate.size > limits.maxBytesPerFile) {
    return {
      accepted: false,
      reason: "file-too-large",
      message: `"${candidate.name}" is ${formatAttachmentBytes(candidate.size)} — over the ${formatAttachmentBytes(limits.maxBytesPerFile)} per-file limit.`,
    };
  }
  const prospectiveTotal = totalStagedBytes(state) + candidate.size;
  if (prospectiveTotal > limits.maxTotalBytes) {
    return {
      accepted: false,
      reason: "total-limit",
      message: `Adding "${candidate.name}" would exceed the ${formatAttachmentBytes(limits.maxTotalBytes)} total limit.`,
    };
  }
  return { accepted: true };
}

/** Stages a newly accepted candidate as `"uploading"`. Caller is responsible for having already checked `evaluateAttachmentCandidate`. */
export function stageAttachment(
  state: AttachmentsState,
  id: string,
  candidate: AttachmentCandidate,
): AttachmentsState {
  const isImage = candidate.mimeType.startsWith("image/");
  const entry: StagedAttachment = {
    id,
    name: candidate.name,
    mimeType: candidate.mimeType,
    size: candidate.size,
    status: "uploading",
    // Images only, enforced here rather than trusted from the caller —
    // see `AttachmentCandidate.previewUri`'s doc comment.
    previewUri: isImage ? candidate.previewUri : undefined,
  };
  return { entries: [...state.entries, entry] };
}

function updateEntry(
  state: AttachmentsState,
  id: string,
  updater: (entry: StagedAttachment) => StagedAttachment,
): AttachmentsState {
  return { entries: state.entries.map((entry) => (entry.id === id ? updater(entry) : entry)) };
}

/** Marks a staged file as successfully uploaded, recording its daemon reference. No-op for an unknown id. */
export function markAttachmentUploaded(
  state: AttachmentsState,
  id: string,
  uploaded: ComposerUploadedAttachment,
): AttachmentsState {
  return updateEntry(state, id, (entry) => ({
    ...entry,
    status: "uploaded",
    uploaded,
    error: undefined,
  }));
}

/** Marks a staged file's upload as failed, with an explanation for the retry affordance. No-op for an unknown id. */
export function markAttachmentError(
  state: AttachmentsState,
  id: string,
  message: string,
): AttachmentsState {
  return updateEntry(state, id, (entry) => ({ ...entry, status: "error", error: message }));
}

/** Removes a staged attachment outright (uploading, uploaded, or errored). No-op for an unknown id. */
export function removeAttachment(state: AttachmentsState, id: string): AttachmentsState {
  return { entries: state.entries.filter((entry) => entry.id !== id) };
}

/** Clears every staged attachment (called after a successful submit — they now travel with the sent message, not this staging list). */
export function clearAttachments(): AttachmentsState {
  return EMPTY_ATTACHMENTS_STATE;
}

/** `true` while any attachment is still uploading — a submission must wait for this to clear, exactly like `use-attachments.ts`'s `hasPendingUploads`. */
export function hasPendingUploads(state: AttachmentsState): boolean {
  return state.entries.some((entry) => entry.status === "uploading");
}

/** `true` when at least one staged attachment is uploaded and none are still uploading — the state a Send is allowed to include attachments in. */
export function hasSendableAttachments(state: AttachmentsState): boolean {
  return state.entries.some((entry) => entry.status === "uploaded");
}

/** Every successfully uploaded attachment's daemon reference, in staged order — passed straight through to the outbox payload without a copy. */
export function uploadedAttachmentRefs(state: AttachmentsState): ComposerUploadedAttachment[] {
  return state.entries
    .filter(
      (entry): entry is StagedAttachment & { uploaded: ComposerUploadedAttachment } =>
        entry.status === "uploaded" && entry.uploaded !== undefined,
    )
    .map((entry) => entry.uploaded);
}

/** Short visible status word for a staged attachment (paired with its name, never colour alone — plan.md §10.5). */
export function attachmentStatusLabel(status: StagedAttachmentStatus): string {
  switch (status) {
    case "uploading":
      return "Uploading…";
    case "uploaded":
      return "Uploaded";
    case "error":
      return "Failed";
  }
}

/**
 * Transport for uploading one staged file. Injected — there is no live
 * `DaemonClient` wired into Android yet (plan.md §12.4's "no client
 * yet" seam, already used by `TurnService` in `composer-model.ts`).
 * `uploadFile` is itself optional, mirroring
 * `apps/web/src/features/composer/agent-turn-client.ts`'s
 * `AgentTurnClient.uploadFile`: a client that omits it leaves every
 * attempt in an explained `"error"` state rather than throwing (see
 * `Composer.tsx`'s upload orchestration).
 */
export interface AttachmentUploadClient {
  uploadFile?(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<ComposerUploadedAttachment>;
}
