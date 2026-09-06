import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  FileTransferOpcode,
  type FileTransferFrame,
} from "@picompanion/protocol/binary-frames/index";
import { getErrorMessage } from "@picompanion/protocol/error-utils";
import type { FileUploadRequest, FileUploadResponse } from "../messages.js";

interface FileUploadStoreOptions {
  paseoHome: string;
  staleUploadTimeoutMs?: number;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const MAX_UPLOAD_DISPLAY = "100 MB";

interface PendingUpload {
  requestId: string;
  id: string;
  attempt: number;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  receivedBytes: number;
  started: boolean;
  staleTimeout: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
}

export class FileUploadStore {
  private static readonly defaultStaleUploadTimeoutMs = 10 * 60 * 1000;

  private readonly paseoHome: string;
  private readonly staleUploadTimeoutMs: number;
  private readonly pending = new Map<string, PendingUpload>();

  constructor(options: FileUploadStoreOptions) {
    this.paseoHome = options.paseoHome;
    this.staleUploadTimeoutMs =
      options.staleUploadTimeoutMs ?? FileUploadStore.defaultStaleUploadTimeoutMs;
  }

  beginUpload(request: FileUploadRequest): FileUploadResponse | null {
    if (request.size > MAX_UPLOAD_BYTES) {
      // Do not create a pending entry; immediately return an error response.
      return {
        type: "file.upload.response",
        payload: {
          requestId: request.requestId,
          file: null,
          error: `File too large — max 100 MB over mobile (received ${request.size} bytes, limit ${MAX_UPLOAD_BYTES} bytes)`,
        },
      };
    }
    const existingUpload = this.pending.get(request.requestId);
    if (existingUpload) {
      this.clearPendingUpload(existingUpload);
      void existingUpload.queue.then(() => this.removeUploadDirectory(existingUpload));
    }

    const fileName = sanitizeFileName(request.fileName);
    const attempt = existingUpload ? existingUpload.attempt + 1 : 1;
    const id = buildUploadId(request.requestId, attempt);
    const uploadDir = join(this.paseoHome, "uploads", id);
    const upload: PendingUpload = {
      requestId: request.requestId,
      id,
      attempt,
      fileName,
      mimeType: request.mimeType,
      size: request.size,
      path: join(uploadDir, fileName),
      receivedBytes: 0,
      started: false,
      staleTimeout: this.createStaleUploadTimeout(request.requestId),
      queue: Promise.resolve(),
    };
    this.pending.set(request.requestId, upload);
    return null;
  }

  /**
   * T163: discards every staged byte for `uploadRequestId`, if any is
   * still pending. Resolves only after the upload directory is actually
   * removed from disk — `cancelled: true` is therefore a real receipt,
   * not a registration. Returns `cancelled: false` (with `error` set) when
   * nothing was pending: the upload already completed via `FileEnd`, the
   * id is unknown, or it was already discarded (size mismatch, the
   * 10-minute stale timeout, or a previous cancel).
   */
  async cancelUpload(
    uploadRequestId: string,
  ): Promise<{ cancelled: boolean; error: string | null }> {
    const upload = this.pending.get(uploadRequestId);
    if (!upload) {
      return { cancelled: false, error: "No upload in progress for this id." };
    }
    this.clearPendingUpload(upload);
    // A chunk write already queued when the cancel arrived must settle
    // before the directory is removed, or its `appendFile` could recreate
    // bytes this discard was meant to erase.
    await upload.queue.catch(() => undefined);
    await this.removeUploadDirectory(upload);
    return { cancelled: true, error: null };
  }

  async receiveFrame(frame: FileTransferFrame): Promise<FileUploadResponse | null> {
    const upload = this.pending.get(frame.requestId);
    if (!upload) {
      return null;
    }
    this.refreshStaleUploadTimeout(upload);

    const operation = upload.queue.then(() => this.applyFrame(upload, frame));
    upload.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async applyFrame(
    upload: PendingUpload,
    frame: FileTransferFrame,
  ): Promise<FileUploadResponse | null> {
    if (this.pending.get(upload.requestId) !== upload) {
      return null;
    }

    try {
      if (frame.opcode === FileTransferOpcode.FileBegin) {
        await this.startWriting(upload);
        return null;
      }
      if (frame.opcode === FileTransferOpcode.FileChunk) {
        await this.writeChunk(upload, frame.payload);
        return null;
      }
      return await this.completeUpload(upload);
    } catch (error) {
      await this.removeFailedUpload(upload);
      return buildUploadResponse(upload, getErrorMessage(error));
    }
  }

  private async startWriting(upload: PendingUpload): Promise<void> {
    await mkdir(join(this.paseoHome, "uploads", upload.id), { recursive: true });
    await writeFile(upload.path, new Uint8Array());
    upload.started = true;
  }

  private async writeChunk(upload: PendingUpload, bytes: Uint8Array): Promise<void> {
    if (!upload.started) {
      throw new Error("Upload chunks arrived before file begin.");
    }
    const nextReceivedBytes = upload.receivedBytes + bytes.byteLength;
    if (nextReceivedBytes > upload.size) {
      throw new Error(
        `Upload exceeded declared size: expected ${upload.size}, received ${nextReceivedBytes}.`,
      );
    }
    await appendFile(upload.path, bytes);
    upload.receivedBytes += bytes.byteLength;
  }

  private async completeUpload(upload: PendingUpload): Promise<FileUploadResponse> {
    this.clearPendingUpload(upload);
    if (upload.receivedBytes !== upload.size) {
      await this.removeUploadDirectory(upload);
      return buildUploadResponse(
        upload,
        `Upload size mismatch: expected ${upload.size}, received ${upload.receivedBytes}.`,
      );
    }
    return buildUploadResponse(upload, null);
  }

  private createStaleUploadTimeout(requestId: string): ReturnType<typeof setTimeout> {
    const timeout = setTimeout(() => {
      this.expireStaleUpload(requestId);
    }, this.staleUploadTimeoutMs);
    timeout.unref?.();
    return timeout;
  }

  private refreshStaleUploadTimeout(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    upload.staleTimeout = this.createStaleUploadTimeout(upload.requestId);
  }

  private expireStaleUpload(requestId: string): void {
    const upload = this.pending.get(requestId);
    if (!upload) {
      return;
    }
    this.clearPendingUpload(upload);
    const cleanup = upload.queue.then(
      () => this.removeUploadDirectory(upload),
      () => this.removeUploadDirectory(upload),
    );
    upload.queue = cleanup.then(
      () => undefined,
      () => undefined,
    );
  }

  private clearPendingUpload(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    if (this.pending.get(upload.requestId) === upload) {
      this.pending.delete(upload.requestId);
    }
  }

  private async removeFailedUpload(upload: PendingUpload): Promise<void> {
    this.clearPendingUpload(upload);
    await this.removeUploadDirectory(upload);
  }

  private async removeUploadDirectory(upload: PendingUpload): Promise<void> {
    await rm(join(this.paseoHome, "uploads", upload.id), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

function buildUploadResponse(upload: PendingUpload, error: string | null): FileUploadResponse {
  return {
    type: "file.upload.response",
    payload: {
      requestId: upload.requestId,
      file: error
        ? null
        : {
            type: "uploaded_file",
            id: upload.id,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            size: upload.size,
            path: upload.path,
          },
      error,
    },
  };
}

function sanitizeUploadId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function buildUploadId(requestId: string, attempt: number): string {
  const baseId = `upload_${sanitizeUploadId(requestId)}`;
  return attempt === 1 ? baseId : `${baseId}_${attempt}`;
}

function sanitizeFileName(value: string): string {
  const name = basename(value)
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim();
  return name.length > 0 && name !== "." && name !== ".." ? name : "upload";
}
