import { describe, expect, it } from "vitest";

import {
  FILE_UPLOAD_NOT_CONNECTED,
  explainFileUploadError,
  explainFileUploadResult,
  explainUploadCancelNotConfirmed,
} from "./file-upload-client.js";
import type { FileUploadResult } from "./file-upload-client.js";

describe("explainFileUploadError (T30B4)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainFileUploadError(FILE_UPLOAD_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it("explains an oversized-file rejection", () => {
    const explanation = explainFileUploadError(
      "File too large — max 100 MB over mobile (received 200000000 bytes, limit 104857600 bytes)",
    );
    expect(explanation.title).toBe("This file is too large to upload");
  });

  it("falls back to a generic explanation, keeping the raw text", () => {
    const explanation = explainFileUploadError("socket hang up");
    expect(explanation.title).toBe("Couldn't upload this file");
    expect(explanation.description).toBe("socket hang up");
  });

  it("falls back to an unknown-error description for an empty message, mentioning the selection survives", () => {
    const explanation = explainFileUploadError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
    expect(explanation.description).toMatch(/selection is still here/i);
  });
});

describe("explainFileUploadResult (T30B4)", () => {
  it("returns null when a file was staged successfully", () => {
    const result: FileUploadResult = {
      file: { id: "upload_1", fileName: "notes.txt", mimeType: "text/plain", size: 12, path: "/x" },
      error: null,
    };
    expect(explainFileUploadResult(result)).toBeNull();
  });

  it("explains an oversized-file server guard", () => {
    const result: FileUploadResult = {
      file: null,
      error:
        "File too large — max 100 MB over mobile (received 200000000 bytes, limit 104857600 bytes)",
    };
    const explanation = explainFileUploadResult(result);
    expect(explanation?.title).toBe("This file is too large to upload");
  });

  it("explains a size-mismatch (interrupted transfer) guard", () => {
    const result: FileUploadResult = {
      file: null,
      error: "Upload size mismatch: expected 100, received 40.",
    };
    const explanation = explainFileUploadResult(result);
    expect(explanation?.title).toMatch(/interrupted/i);
  });

  it("falls back to a generic explanation for an unrecognized server error", () => {
    const result: FileUploadResult = { file: null, error: "disk full" };
    const explanation = explainFileUploadResult(result);
    expect(explanation?.title).toBe("Couldn't upload this file");
    expect(explanation?.description).toBe("disk full");
  });
});

describe("explainUploadCancelNotConfirmed (T165)", () => {
  it("keeps the daemon's own explanation for cancelled: false", () => {
    const explanation = explainUploadCancelNotConfirmed("nothing was pending");
    expect(explanation.title).toBe("Couldn't confirm the cancellation");
    expect(explanation.description).toBe("nothing was pending");
  });

  it("falls back to a generic explanation when the daemon gives no error text", () => {
    const explanation = explainUploadCancelNotConfirmed(null);
    expect(explanation.description).toMatch(/didn't confirm/i);
  });

  it("never claims the file was discarded or that the upload succeeded", () => {
    const explanation = explainUploadCancelNotConfirmed("nothing was pending");
    expect(explanation.title).not.toMatch(/cancelled/i);
    expect(explanation.description).not.toMatch(/discarded|uploaded successfully/i);
  });
});
