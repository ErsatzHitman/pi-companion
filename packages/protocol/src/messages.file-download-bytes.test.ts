import { describe, expect, test } from "vitest";
import {
  FileDownloadBytesRequestSchema,
  FileDownloadBytesResponseSchema,
  MAX_FILE_DOWNLOAD_BYTES_LENGTH,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("file download bytes message contract", () => {
  test("accepts a minimal chunk request", () => {
    expect(
      FileDownloadBytesRequestSchema.parse({
        type: "file_download_bytes_request",
        cwd: "/repo/app",
        path: "report.txt",
        offset: 0,
        length: 65536,
        requestId: "req-bytes-1",
      }),
    ).toEqual({
      type: "file_download_bytes_request",
      cwd: "/repo/app",
      path: "report.txt",
      offset: 0,
      length: 65536,
      requestId: "req-bytes-1",
    });
  });

  test("cwd and agentId are both optional", () => {
    expect(
      FileDownloadBytesRequestSchema.parse({
        type: "file_download_bytes_request",
        agentId: "agent-1",
        path: "uploads/notes.txt",
        offset: 128,
        length: 1024,
        requestId: "req-bytes-2",
      }),
    ).toMatchObject({
      type: "file_download_bytes_request",
      agentId: "agent-1",
      offset: 128,
    });
    expect(
      FileDownloadBytesRequestSchema.parse({
        type: "file_download_bytes_request",
        path: "a.txt",
        offset: 0,
        length: 1,
        requestId: "req-bytes-3",
      }),
    ).toMatchObject({ type: "file_download_bytes_request" });
  });

  test("rejects offsets below zero and lengths outside 1..65536", () => {
    expect(
      FileDownloadBytesRequestSchema.safeParse({
        type: "file_download_bytes_request",
        cwd: "/repo/app",
        path: "a.txt",
        offset: -1,
        length: 16,
        requestId: "req-bad-offset",
      }).success,
    ).toBe(false);
    expect(
      FileDownloadBytesRequestSchema.safeParse({
        type: "file_download_bytes_request",
        cwd: "/repo/app",
        path: "a.txt",
        offset: 0,
        length: 0,
        requestId: "req-bad-length-zero",
      }).success,
    ).toBe(false);
    expect(
      FileDownloadBytesRequestSchema.safeParse({
        type: "file_download_bytes_request",
        cwd: "/repo/app",
        path: "a.txt",
        offset: 0,
        length: MAX_FILE_DOWNLOAD_BYTES_LENGTH + 1,
        requestId: "req-bad-length-big",
      }).success,
    ).toBe(false);
    expect(MAX_FILE_DOWNLOAD_BYTES_LENGTH).toBe(65536);
  });

  test("request belongs to the session inbound union", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "file_download_bytes_request",
        cwd: "/repo/app",
        path: "report.txt",
        offset: 0,
        length: 4096,
        requestId: "req-bytes-union",
      }),
    ).toMatchObject({
      type: "file_download_bytes_request",
      requestId: "req-bytes-union",
    });
  });

  test("accepts a data response with metadata", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "file_download_bytes_response",
        payload: {
          requestId: "req-bytes-1",
          offset: 0,
          dataBase64: "aGVsbG8=",
          eof: false,
          size: 11,
          mimeType: "text/plain",
          fileName: "report.txt",
          error: null,
        },
      }),
    ).toMatchObject({ type: "file_download_bytes_response" });
  });

  test("error is optional-nullable and metadata is optional", () => {
    const withoutError = FileDownloadBytesResponseSchema.parse({
      type: "file_download_bytes_response",
      payload: {
        requestId: "req-bytes-4",
        offset: 0,
        dataBase64: "",
        eof: true,
      },
    });
    expect(withoutError.payload.error).toBeUndefined();
    expect(withoutError.payload.size).toBeUndefined();

    const withError = FileDownloadBytesResponseSchema.parse({
      type: "file_download_bytes_response",
      payload: {
        requestId: "req-bytes-5",
        offset: 64,
        dataBase64: "",
        eof: true,
        error: "Access outside of workspace is not allowed",
      },
    });
    expect(withError.payload.error).toBe("Access outside of workspace is not allowed");
  });
});
