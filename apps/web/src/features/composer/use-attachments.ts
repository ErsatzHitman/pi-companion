import { useCallback, useMemo, useRef, useState } from "react";

import type { FilePicker, PickedFile } from "@picompanion/frontend-core";

import type { AgentTurnClient, AgentUploadedAttachment } from "./agent-turn-client.js";

/**
 * Composer attachments (T28B6, plan.md §12.4 "files ... use existing
 * daemon RPC and binary frames; the frontend must not directly access
 * laptop paths").
 *
 * Selection goes through the platform-neutral `FilePicker`
 * (`packages/frontend-core/src/platform/file-picker.ts`, plan.md §7.3)
 * rather than a raw DOM `<input type="file">` inside this feature: the
 * web adapter (`apps/web/src/platform/file-picker.ts`) already wraps a
 * hidden file input, so `useAttachments` and `Composer` stay agnostic of
 * how a given platform actually opens a file dialog — the same seam
 * `platform.clock`/`platform.structuredStorage` already use elsewhere in
 * this feature.
 *
 * Each picked file uploads through `AgentTurnClient.uploadFile`
 * (`daemon-agent-turn-client.ts`'s real adapter over
 * `DaemonClient.uploadFile`) the instant it is selected — not deferred to
 * submit time — so a slow or failed upload is visible and retryable
 * *before* the user commits to sending, matching this feature's existing
 * "no client yet" seam (`use-slash-commands.ts`, `use-model-thinking.ts`):
 * a client that omits `uploadFile` leaves every attempt in an explained
 * `"error"` state rather than throwing.
 *
 * Oversized files are rejected locally, before any network round trip
 * (`MAX_ATTACHMENT_BYTES` mirrors `packages/client/src/daemon-client.ts`'s
 * own `uploadFile` ceiling so the two "oversized" checks agree — see that
 * file's `MAX_UPLOAD_BYTES` constant). A file that clears the local check
 * but is still rejected by the daemon (or whose upload round trip times
 * out — `agent-turn-client.ts`'s `uploadFile` doc comment) lands in the
 * same `"error"` state with the daemon's own explanation, so "survives a
 * reconnect mid-upload or fails explicitly" holds either way: `uploadFile`
 * only ever resolves (survived) or rejects (explicit failure), never
 * hangs silently forever.
 */

export type ComposerAttachmentStatus = "uploading" | "uploaded" | "error";

export interface ComposerAttachment {
  /** Locally stable id for this staged attachment; not a daemon id. */
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: ComposerAttachmentStatus;
  /** Present once `status` is `"uploaded"`. */
  uploaded?: AgentUploadedAttachment;
  /** Present once `status` is `"error"`, explaining what a retry should expect. */
  error?: string;
}

export interface UseAttachmentsOptions {
  /** Platform file-selection surface (plan.md §7.3); always available, independent of `client`. */
  filePicker: FilePicker;
  /** Optional turn-control client; `uploadFile` is itself optional on it. */
  client?: AgentTurnClient;
  /** Overridable for deterministic tests; defaults to a counter-based generator. */
  generateAttachmentId?: () => string;
  /**
   * Local, pre-network size ceiling in bytes. Defaults to the same 100
   * MiB `DaemonClient.uploadFile` itself enforces, so a file this hook
   * rejects locally would have been rejected by the daemon anyway.
   */
  maxBytes?: number;
}

export interface UseAttachmentsState {
  attachments: readonly ComposerAttachment[];
  /**
   * Opens the platform file picker and stages + uploads every selected
   * file. Resolves once every file is staged (upload itself continues in
   * the background); resolves immediately, staging nothing, if the user
   * dismisses the picker without choosing a file.
   */
  pickAndAddFiles: () => Promise<void>;
  /** Removes a staged attachment outright (uploading, uploaded, or errored). */
  remove: (id: string) => void;
  /** Retries an errored attachment's upload. No-op for any other status or an unknown id. */
  retry: (id: string) => void;
  /** `true` while any attachment is still uploading — a submission must wait for this to clear. */
  hasPendingUploads: boolean;
  /**
   * Every successfully uploaded attachment's daemon reference, in staged
   * order. A plain (not `readonly`) array so it can be passed straight
   * through to `AgentTurnClient.sendAgentMessage`'s `attachments` option
   * without a copy.
   */
  uploadedAttachments: AgentUploadedAttachment[];
  /** Clears every staged attachment (called after a successful submit). */
  clear: () => void;
}

/** Matches `packages/client/src/daemon-client.ts`'s own `uploadFile`'s `MAX_UPLOAD_BYTES`. */
const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

let attachmentIdSequence = 0;

function defaultGenerateAttachmentId(): string {
  attachmentIdSequence += 1;
  return `attachment-${Date.now().toString(36)}-${attachmentIdSequence.toString(36)}`;
}

/** Formats a byte count as e.g. `"340 B"`, `"12.4 MB"` — kept local and tiny rather than reaching into a sibling feature's formatter. */
export function formatAttachmentSize(bytes: number): string {
  return formatBytes(bytes);
}

function formatBytes(bytes: number): string {
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

export function useAttachments(options: UseAttachmentsOptions): UseAttachmentsState {
  const {
    client,
    filePicker,
    generateAttachmentId,
    maxBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
  } = options;

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // Kept out of React state: retry needs the original `PickedFile` back,
  // and a `PickedFile` (its `readAsBytes` closure especially) is not
  // something this hook's own state should serialize or compare on every
  // render.
  const filesRef = useRef<Map<string, PickedFile>>(new Map());

  const makeId = useCallback(
    (): string => generateAttachmentId?.() ?? defaultGenerateAttachmentId(),
    [generateAttachmentId],
  );

  const updateAttachment = useCallback((id: string, patch: Partial<ComposerAttachment>) => {
    setAttachments((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const upload = useCallback(
    async (id: string, file: PickedFile): Promise<void> => {
      if (!client?.uploadFile) {
        updateAttachment(id, {
          status: "error",
          error: "Attachments are unavailable: no live connection.",
        });
        return;
      }
      try {
        const bytes = await file.readAsBytes();
        const uploaded = await client.uploadFile({
          fileName: file.name,
          mimeType: file.mimeType || "application/octet-stream",
          bytes,
        });
        updateAttachment(id, { status: "uploaded", uploaded, error: undefined });
      } catch (error) {
        updateAttachment(id, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, updateAttachment],
  );

  const stageAndUpload = useCallback(
    (files: readonly PickedFile[]): void => {
      for (const file of files) {
        const id = makeId();
        const mimeType = file.mimeType || "application/octet-stream";
        const size = file.size ?? 0;
        if (size > maxBytes) {
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              mimeType,
              size,
              status: "error",
              error: `"${file.name}" is ${formatBytes(size)} — over the ${formatBytes(maxBytes)} limit.`,
            },
          ]);
          continue;
        }
        filesRef.current.set(id, file);
        setAttachments((prev) => [
          ...prev,
          { id, name: file.name, mimeType, size, status: "uploading" },
        ]);
        void upload(id, file);
      }
    },
    [makeId, maxBytes, upload],
  );

  const pickAndAddFiles = useCallback(async (): Promise<void> => {
    const picked = await filePicker.pickFiles({ multiple: true });
    stageAndUpload(picked);
  }, [filePicker, stageAndUpload]);

  const remove = useCallback((id: string): void => {
    filesRef.current.delete(id);
    setAttachments((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const retry = useCallback(
    (id: string): void => {
      const file = filesRef.current.get(id);
      if (!file) return;
      updateAttachment(id, { status: "uploading", error: undefined });
      void upload(id, file);
    },
    [upload, updateAttachment],
  );

  const clear = useCallback((): void => {
    filesRef.current.clear();
    setAttachments([]);
  }, []);

  const hasPendingUploads = attachments.some((entry) => entry.status === "uploading");
  const uploadedAttachments = useMemo<AgentUploadedAttachment[]>(
    () =>
      attachments
        .filter(
          (entry): entry is ComposerAttachment & { uploaded: AgentUploadedAttachment } =>
            entry.status === "uploaded" && entry.uploaded !== undefined,
        )
        .map((entry) => entry.uploaded),
    [attachments],
  );

  return {
    attachments,
    pickAndAddFiles,
    remove,
    retry,
    hasPendingUploads,
    uploadedAttachments,
    clear,
  };
}
