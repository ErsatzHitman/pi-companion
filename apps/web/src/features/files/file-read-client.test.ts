import { describe, expect, it } from "vitest";

import {
  FILE_READ_NOT_CONNECTED,
  MAX_PREVIEWABLE_FILE_BYTES,
  explainFileReadError,
  explainRefusedFileKind,
} from "./file-read-client.js";
import type { FileReadResult } from "./file-read-client.js";

function textFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "src/index.ts",
    kind: "text",
    bytes: new TextEncoder().encode("export {};\n"),
    mime: "text/plain",
    size: 11,
    modifiedAt: "2026-02-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("explainFileReadError (T30B2)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainFileReadError(FILE_READ_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it.each([
    "ENOENT: no such file or directory, open '/workspace/missing.ts'",
    "no such file or directory",
  ])("explains a missing-path error: %s", (raw) => {
    const explanation = explainFileReadError(raw);
    expect(explanation.title).toMatch(/no longer exists/i);
  });

  it.each(["EACCES: permission denied, open '/workspace/secret'", "permission denied"])(
    "explains a permission error: %s",
    (raw) => {
      const explanation = explainFileReadError(raw);
      expect(explanation.title).toBe("Permission denied");
    },
  );

  it("explains an outside-workspace guard", () => {
    const explanation = explainFileReadError("Access outside of workspace is not allowed");
    expect(explanation.title).toMatch(/outside the workspace/i);
  });

  it("explains the not-a-file guard", () => {
    const explanation = explainFileReadError("Requested path is not a file");
    expect(explanation.title).toBe("Not a file");
  });

  it("explains a missing cwd", () => {
    const explanation = explainFileReadError("cwd is required");
    expect(explanation.title).toMatch(/no workspace selected/i);
  });

  it("falls back to a generic explanation, keeping the raw text", () => {
    const explanation = explainFileReadError("something unexpected happened");
    expect(explanation.title).toBe("Couldn't read this file");
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to an unknown-error description for an empty message", () => {
    const explanation = explainFileReadError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
  });
});

describe("explainRefusedFileKind (T30B2)", () => {
  it("returns null for a previewable text file", () => {
    expect(explainRefusedFileKind(textFile())).toBeNull();
  });

  it("refuses a binary file", () => {
    const refusal = explainRefusedFileKind(textFile({ kind: "binary" }));
    expect(refusal?.title).toMatch(/binary file/i);
  });

  it("refuses an image file", () => {
    const refusal = explainRefusedFileKind(textFile({ kind: "image" }));
    expect(refusal?.title).toMatch(/image file/i);
  });

  it("refuses a text file over the previewable size cap", () => {
    const refusal = explainRefusedFileKind(textFile({ size: MAX_PREVIEWABLE_FILE_BYTES + 1 }));
    expect(refusal?.title).toMatch(/too large to preview/i);
  });

  it("allows a text file exactly at the previewable size cap", () => {
    expect(explainRefusedFileKind(textFile({ size: MAX_PREVIEWABLE_FILE_BYTES }))).toBeNull();
  });
});
