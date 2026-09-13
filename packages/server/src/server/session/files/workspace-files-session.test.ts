import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@picompanion/protocol/binary-frames/index";
import {
  WorkspaceFilesSession,
  type WorkspaceFilesSessionHost,
} from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  ATTACHMENT_TEMP_DIR_PREFIX,
  type AttachmentTimelineLookup,
} from "../../file-upload/attachment-access.js";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeSubsystem(
  options: {
    hasBinaryChannel?: boolean;
    emitBinary?: (frame: Uint8Array) => Promise<void> | void;
    attachmentLookup?: AttachmentTimelineLookup;
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const binary: Uint8Array[] = [];
  let hasBinary = options.hasBinaryChannel ?? false;
  const host: WorkspaceFilesSessionHost = {
    emit: (msg) => emitted.push(msg),
    emitBinary: async (frame) => {
      binary.push(frame);
      await options.emitBinary?.(frame);
    },
    hasBinaryChannel: () => hasBinary,
  };
  const paseoHome = makeDir("workspace-files-home-");
  const subsystem = new WorkspaceFilesSession({
    host,
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    paseoHome,
    logger: pino({ level: "silent" }),
    ...(options.attachmentLookup ? { attachmentLookup: options.attachmentLookup } : {}),
  });
  return {
    subsystem,
    emitted,
    binary,
    paseoHome,
    setHasBinary: (value: boolean) => {
      hasBinary = value;
    },
  };
}

function uploadFrame(args: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const frame = decodeFileTransferFrame(encodeFileTransferFrame(args));
  if (!frame) {
    throw new Error("Expected a file transfer frame");
  }
  return frame;
}

describe("WorkspaceFilesSession", () => {
  test("lists directory entries", async () => {
    const cwd = makeDir("workspace-files-list-");
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-list",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.directory).not.toBeNull();
  });

  test("reads file content inline when the client has no binary channel", async () => {
    const cwd = makeDir("workspace-files-read-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: false });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read",
      acceptBinary: true,
    });

    expect(binary).toEqual([]);
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file).not.toBeNull();
  });

  test("streams binary frames when the client accepts binary and has a channel", async () => {
    const cwd = makeDir("workspace-files-binary-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-binary",
      acceptBinary: true,
    });

    expect(emitted).toEqual([]);
    expect(binary).toHaveLength(3);
    const opcodes = binary.map((frame) => decodeFileTransferFrame(frame)?.opcode);
    expect(opcodes).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
      FileTransferOpcode.FileEnd,
    ]);
  });

  test("streams a real file larger than the socket limit as paced ordered chunks", async () => {
    const cwd = makeDir("workspace-files-large-binary-");
    const fileBytes = Buffer.alloc(8 * 1024 * 1024 + 123);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    writeFileSync(join(cwd, "large.bin"), fileBytes);

    let releaseFirstChunk: (() => void) | undefined;
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let chunkSends = 0;
    const { subsystem, emitted, binary } = makeSubsystem({
      hasBinaryChannel: true,
      emitBinary: async (frame) => {
        if (decodeFileTransferFrame(frame)?.opcode !== FileTransferOpcode.FileChunk) return;
        chunkSends += 1;
        if (chunkSends === 1) await firstChunkSent;
      },
    });

    const transfer = subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "large.bin",
      mode: "file",
      requestId: "req-large-binary",
      acceptBinary: true,
    });

    await expect.poll(() => chunkSends).toBe(1);
    expect(binary.map((frame) => decodeFileTransferFrame(frame)?.opcode)).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
    ]);

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-unrelated-list",
    });
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ requestId: "req-unrelated-list", error: null }),
      }),
    ]);

    releaseFirstChunk?.();
    await transfer;

    const frames = binary.map((frame) => decodeFileTransferFrame(frame));
    const chunks = frames.flatMap((frame) =>
      frame?.opcode === FileTransferOpcode.FileChunk ? [frame.payload] : [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(
      Buffer.compare(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), fileBytes),
    ).toBe(0);
    expect(frames.at(0)?.opcode).toBe(FileTransferOpcode.FileBegin);
    expect(frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    expect(emitted).toHaveLength(1);
  }, 30_000);

  test("rejects an empty file-explorer cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: "  ",
      path: ".",
      mode: "list",
      requestId: "req-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_explorer_response",
        payload: expect.objectContaining({
          error: "cwd is required",
          directory: null,
          file: null,
          requestId: "req-empty",
        }),
      },
    ]);
  });

  test("issues a download token for a real file", async () => {
    const cwd = makeDir("workspace-files-token-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd,
      path: "report.txt",
      requestId: "req-token",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_token_response") {
      throw new Error(`expected file_download_token_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(typeof message.payload.token).toBe("string");
    expect(message.payload.fileName).toBe("report.txt");
    expect(message.payload.size).toBe(11);
  });

  test("rejects an empty download-token cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: "",
      path: "report.txt",
      requestId: "req-token-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({
          token: null,
          error: "cwd is required",
          requestId: "req-token-empty",
        }),
      },
    ]);
  });

  test("serves a file-download-bytes chunk with metadata", async () => {
    const cwd = makeDir("workspace-files-bytes-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      cwd,
      path: "report.txt",
      offset: 0,
      length: 5,
      requestId: "req-bytes",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.offset).toBe(0);
    expect(message.payload.eof).toBe(false);
    expect(message.payload.size).toBe(11);
    expect(message.payload.fileName).toBe("report.txt");
    expect(Buffer.from(message.payload.dataBase64, "base64").toString("utf8")).toBe("hello");
  });

  test("marks the final file-download-bytes chunk with eof", async () => {
    const cwd = makeDir("workspace-files-bytes-eof-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      cwd,
      path: "report.txt",
      offset: 6,
      length: 65536,
      requestId: "req-bytes-eof",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.offset).toBe(6);
    expect(message.payload.eof).toBe(true);
    expect(Buffer.from(message.payload.dataBase64, "base64").toString("utf8")).toBe("world");
  });

  test("returns an empty eof chunk past the end of the file", async () => {
    const cwd = makeDir("workspace-files-bytes-past-eof-");
    writeFileSync(join(cwd, "report.txt"), "hi");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      cwd,
      path: "report.txt",
      offset: 99,
      length: 16,
      requestId: "req-bytes-past-eof",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.dataBase64).toBe("");
    expect(message.payload.eof).toBe(true);
  });

  test("rejects an empty download-bytes cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      cwd: "  ",
      path: "report.txt",
      offset: 0,
      length: 16,
      requestId: "req-bytes-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_bytes_response",
        payload: expect.objectContaining({
          requestId: "req-bytes-empty",
          offset: 0,
          dataBase64: "",
          eof: true,
          error: "cwd is required",
        }),
      },
    ]);
  });

  test("rejects an outside-workspace download-bytes path without throwing", async () => {
    const cwd = makeDir("workspace-files-bytes-jail-");
    writeFileSync(join(cwd, "ok.txt"), "ok");
    const { subsystem, emitted } = makeSubsystem();

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        cwd,
        path: "../escape.txt",
        offset: 0,
        length: 16,
        requestId: "req-bytes-jail",
      }),
    ).resolves.toBeUndefined();

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    expect(message.payload.offset).toBe(0);
    expect(message.payload.dataBase64).toBe("");
    expect(message.payload.eof).toBe(true);
    expect(typeof message.payload.error).toBe("string");
  });

  test("reports a missing download-bytes file as an error envelope", async () => {
    const cwd = makeDir("workspace-files-bytes-missing-");
    const { subsystem, emitted } = makeSubsystem();

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        cwd,
        path: "nope.txt",
        offset: 0,
        length: 16,
        requestId: "req-bytes-missing",
      }),
    ).resolves.toBeUndefined();

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    expect(message.payload.dataBase64).toBe("");
    expect(message.payload.eof).toBe(true);
    expect(typeof message.payload.error).toBe("string");
  });

  function makeAttachmentLookup(
    images: Record<string, AgentTimelineImageRef[] | null>,
  ): AttachmentTimelineLookup {
    return {
      getAgentTimelineImages: (agentId) => (agentId in images ? images[agentId] : null),
    };
  }

  function writeAttachmentFile(contents: string): {
    dir: string;
    ref: AgentTimelineImageRef;
  } {
    const dir = makeDir(ATTACHMENT_TEMP_DIR_PREFIX);
    const filePath = join(dir, "attachment.png");
    writeFileSync(filePath, contents);
    return { dir, ref: { mimeType: "image/png", path: filePath, bytes: contents.length } };
  }

  function expectBytesResponse(emitted: SessionOutboundMessage[]) {
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_bytes_response") {
      throw new Error(`expected file_download_bytes_response, got ${message.type}`);
    }
    return message.payload;
  }

  test("serves an agentId-scoped attachment chunk with metadata and no cwd", async () => {
    const { ref } = writeAttachmentFile("hello world");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        agentId: "agent-a",
        path: ref.path,
        offset: 0,
        length: 5,
        requestId: "req-bytes-attachment",
      }),
    ).resolves.toBeUndefined();

    const payload = expectBytesResponse(emitted);
    expect(payload.error).toBeNull();
    expect(payload.offset).toBe(0);
    expect(payload.eof).toBe(false);
    expect(payload.size).toBe(11);
    expect(payload.mimeType).toBe("image/png");
    expect(payload.fileName).toBe("attachment.png");
    expect(Buffer.from(payload.dataBase64, "base64").toString("utf8")).toBe("hello");
  });

  test("marks the final agentId-scoped attachment chunk with eof", async () => {
    const { ref } = writeAttachmentFile("hello world");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      agentId: "agent-a",
      path: ref.path,
      offset: 6,
      length: 65536,
      requestId: "req-bytes-attachment-eof",
    });

    const payload = expectBytesResponse(emitted);
    expect(payload.error).toBeNull();
    expect(payload.offset).toBe(6);
    expect(payload.eof).toBe(true);
    expect(Buffer.from(payload.dataBase64, "base64").toString("utf8")).toBe("world");
  });

  test("refuses a cross-agent attachment chunk as an error envelope without throwing", async () => {
    const { ref } = writeAttachmentFile("agent-a-bytes");
    const other = writeAttachmentFile("agent-b-bytes");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref], "agent-b": [other.ref] }),
    });

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        agentId: "agent-b",
        path: ref.path,
        offset: 0,
        length: 16,
        requestId: "req-bytes-attachment-cross",
      }),
    ).resolves.toBeUndefined();

    const payload = expectBytesResponse(emitted);
    expect(payload.offset).toBe(0);
    expect(payload.dataBase64).toBe("");
    expect(payload.eof).toBe(true);
    expect(payload.error).toBe("Attachment not found");
  });

  test("refuses an attachment chunk for an unknown agent as an error envelope without throwing", async () => {
    const { ref } = writeAttachmentFile("hello world");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        agentId: "missing-agent",
        path: ref.path,
        offset: 0,
        length: 16,
        requestId: "req-bytes-attachment-unknown",
      }),
    ).resolves.toBeUndefined();

    const payload = expectBytesResponse(emitted);
    expect(payload.dataBase64).toBe("");
    expect(payload.eof).toBe(true);
    expect(payload.error).toBe("Attachment not found");
  });

  test("reports a deleted attachment file as an error envelope without throwing", async () => {
    const { dir, ref } = writeAttachmentFile("hello world");
    rmSync(join(dir, "attachment.png"), { force: true });
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        agentId: "agent-a",
        path: ref.path,
        offset: 0,
        length: 16,
        requestId: "req-bytes-attachment-deleted",
      }),
    ).resolves.toBeUndefined();

    const payload = expectBytesResponse(emitted);
    expect(payload.dataBase64).toBe("");
    expect(payload.eof).toBe(true);
    expect(typeof payload.error).toBe("string");
  });

  test("reports an invalid attachment chunk length as an error envelope without throwing", async () => {
    const { ref } = writeAttachmentFile("hello world");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await expect(
      subsystem.handleFileDownloadBytesRequest({
        type: "file_download_bytes_request",
        agentId: "agent-a",
        path: ref.path,
        offset: 0,
        length: 0,
        requestId: "req-bytes-attachment-bad-length",
      }),
    ).resolves.toBeUndefined();

    const payload = expectBytesResponse(emitted);
    expect(payload.dataBase64).toBe("");
    expect(payload.eof).toBe(true);
    expect(payload.error).toBe("Invalid length");
  });

  test("keeps cwd-is-required when an agentId is sent but no attachment lookup is configured", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      agentId: "agent-a",
      path: "/tmp/paseo-attachments-x/deadbeef.png",
      offset: 0,
      length: 16,
      requestId: "req-bytes-attachment-no-lookup",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_bytes_response",
        payload: expect.objectContaining({
          requestId: "req-bytes-attachment-no-lookup",
          offset: 0,
          dataBase64: "",
          eof: true,
          error: "cwd is required",
        }),
      },
    ]);
  });

  test("prefers the workspace file when both cwd and agentId are present", async () => {
    const cwd = makeDir("workspace-files-bytes-both-");
    writeFileSync(join(cwd, "report.txt"), "workspace-bytes");
    const { ref } = writeAttachmentFile("attachment-bytes");
    const { subsystem, emitted } = makeSubsystem({
      attachmentLookup: makeAttachmentLookup({ "agent-a": [ref] }),
    });

    await subsystem.handleFileDownloadBytesRequest({
      type: "file_download_bytes_request",
      cwd,
      agentId: "agent-a",
      path: "report.txt",
      offset: 0,
      length: 9,
      requestId: "req-bytes-both",
    });

    const payload = expectBytesResponse(emitted);
    expect(payload.error).toBeNull();
    expect(Buffer.from(payload.dataBase64, "base64").toString("utf8")).toBe("workspace");
  });

  test("responds to a project icon request", async () => {
    const cwd = makeDir("workspace-files-icon-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleProjectIconRequest({
      type: "project_icon_request",
      cwd,
      requestId: "req-icon",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "project_icon_response") {
      throw new Error(`expected project_icon_response, got ${message.type}`);
    }
    expect(message.payload.cwd).toBe(cwd);
    expect(message.payload.error).toBeNull();
  });

  test("round-trips an upload through transfer frames", async () => {
    const { subsystem, emitted, paseoHome } = makeSubsystem();

    subsystem.handleFileUploadRequest({
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    });
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello world"),
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
    );

    const message = emitted.find((entry) => entry.type === "file.upload.response");
    if (message?.type !== "file.upload.response") {
      throw new Error("expected a file.upload.response message");
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.fileName).toBe("notes.txt");
    expect(readFileSync(join(paseoHome, "uploads", "upload_req-upload", "notes.txt"), "utf8")).toBe(
      "hello world",
    );
  });

  test("handleFileUploadCancelRequest discards a partial upload and emits a confirmed cancel (T163)", async () => {
    const { subsystem, emitted, paseoHome } = makeSubsystem();

    subsystem.handleFileUploadRequest({
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    });
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello"),
      }),
    );

    const uploadDir = join(paseoHome, "uploads", "upload_req-upload");
    expect(readFileSync(join(uploadDir, "notes.txt"), "utf8")).toBe("hello");

    await subsystem.handleFileUploadCancelRequest({
      type: "file.upload.cancel.request",
      uploadRequestId: "req-upload",
      requestId: "req-cancel-rpc",
    });

    const message = emitted.find((entry) => entry.type === "file.upload.cancel.response");
    if (message?.type !== "file.upload.cancel.response") {
      throw new Error("expected a file.upload.cancel.response message");
    }
    expect(message.payload).toEqual({
      requestId: "req-cancel-rpc",
      uploadRequestId: "req-upload",
      cancelled: true,
      error: null,
    });
    // The confirmed cancel must correspond to the staged bytes actually
    // being gone by the time the response is emitted — not a mounted
    // handler that ran but left the file behind.
    expect(() => readFileSync(join(uploadDir, "notes.txt"), "utf8")).toThrow();

    // A FileEnd that arrives after the confirmed cancel must not produce a
    // second, contradicting `file.upload.response`.
    await subsystem.handleFileTransferFrame(
      uploadFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
    );
    expect(emitted.filter((entry) => entry.type === "file.upload.response")).toHaveLength(0);
  });
});
