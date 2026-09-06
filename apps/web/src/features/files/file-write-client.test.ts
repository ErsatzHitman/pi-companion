import { describe, expect, it } from "vitest";

import {
  FILE_WRITE_NOT_CONNECTED,
  explainFileWriteError,
  explainFileWriteResult,
} from "./file-write-client.js";
import type { FileWriteResult } from "./file-write-client.js";

describe("explainFileWriteError (T30B3)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainFileWriteError(FILE_WRITE_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it.each(["EACCES: permission denied, open '/workspace/secret'", "permission denied"])(
    "explains a permission error: %s",
    (raw) => {
      const explanation = explainFileWriteError(raw);
      expect(explanation.title).toBe("Permission denied");
    },
  );

  it("explains an outside-workspace guard", () => {
    const explanation = explainFileWriteError("Access outside of workspace is not allowed");
    expect(explanation.title).toMatch(/outside the workspace/i);
  });

  it("falls back to a generic explanation, keeping the raw text and mentioning the buffer survives", () => {
    const explanation = explainFileWriteError("socket hang up");
    expect(explanation.title).toBe("Couldn't save this file");
    expect(explanation.description).toBe("socket hang up");
  });

  it("falls back to an unknown-error description for an empty message", () => {
    const explanation = explainFileWriteError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
    expect(explanation.description).toMatch(/still here/i);
  });
});

describe("explainFileWriteResult (T30B3)", () => {
  it("returns null for a written result", () => {
    const result: FileWriteResult = {
      status: "written",
      modifiedAt: "2026-02-01T12:00:00.000Z",
      size: 12,
    };
    expect(explainFileWriteResult(result)).toBeNull();
  });

  it("explains a conflict against a newer version", () => {
    const result: FileWriteResult = {
      status: "conflict",
      version: {
        status: "ready",
        cwd: "/workspace",
        path: "src/index.ts",
        size: 40,
        modifiedAt: "2026-02-01T13:00:00.000Z",
      },
    };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toMatch(/someone else changed this file/i);
  });

  it("explains a conflict where the file was deleted", () => {
    const result: FileWriteResult = {
      status: "conflict",
      version: { status: "missing", cwd: "/workspace", path: "src/index.ts" },
    };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toMatch(/deleted/i);
  });

  it("explains an oversized-file server error", () => {
    const result: FileWriteResult = { status: "error", error: "File is too large to edit" };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toMatch(/too large to save/i);
  });

  it("explains a binary-file server error", () => {
    const result: FileWriteResult = { status: "error", error: "Binary files cannot be edited" };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toMatch(/binary file/i);
  });

  it("explains a not-a-file server error", () => {
    const result: FileWriteResult = { status: "error", error: "Requested path is not a file" };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toBe("Not a file");
  });

  it("falls back to a generic explanation for an unrecognized server error", () => {
    const result: FileWriteResult = { status: "error", error: "disk is full" };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toBe("Couldn't save this file");
    expect(explanation?.description).toBe("disk is full");
  });
});
