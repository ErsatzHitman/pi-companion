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
 * exercised at the exact boundary in `attachment-model.test.ts`.
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
  const entry: StagedAttachment = {
    id,
    name: candidate.name,
    mimeType: candidate.mimeType,
    size: candidate.size,
    status: "uploading",
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
