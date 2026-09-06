import { describe, expect, it } from "vitest";

import {
  FILE_BROWSER_NOT_CONNECTED,
  FILE_BROWSER_TIMEOUT,
  FILE_DOWNLOAD_NO_ORIGIN,
  FILE_DOWNLOAD_NO_RELAY_ORIGIN,
  FILE_DOWNLOAD_TOKEN_TIMEOUT,
  FILE_DOWNLOAD_TRANSFER_FAILED,
  FILE_READ_NOT_CONNECTED,
  FILE_READ_TIMEOUT,
  FILE_UPLOAD_TIMEOUT,
  FILE_WRITE_NOT_CONNECTED,
  FILE_WRITE_TIMEOUT,
  MAX_DOWNLOAD_BYTES,
  MAX_PREVIEWABLE_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  buildFileDownloadUrl,
  explainFileBrowserError,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
  explainFileReadError,
  explainFileUploadError,
  explainFileUploadResult,
  explainFileWriteError,
  explainFileWriteResult,
  explainOversizedDownload,
  explainOversizedFile,
  explainOversizedUpload,
  explainRefusedFileKind,
  isNotADirectoryError,
  isPathNotFoundError,
  type FileDownloadTokenResult,
  type FileReadResult,
  type FileUploadResult,
  type FileWriteResult,
} from "./file-browser-client";

describe("isPathNotFoundError", () => {
  it("matches a raw ENOENT message", () => {
    expect(isPathNotFoundError("ENOENT: no such file or directory, scandir '/tmp/gone'")).toBe(
      true,
    );
  });

  it("does not match an unrelated message", () => {
    expect(isPathNotFoundError("permission denied")).toBe(false);
  });
});

describe("isNotADirectoryError", () => {
  it("matches the file-explorer service's guard message case-insensitively", () => {
    expect(isNotADirectoryError("Requested path is not a directory")).toBe(true);
    expect(isNotADirectoryError("REQUESTED PATH IS NOT A DIRECTORY")).toBe(true);
  });

  it("does not match an unrelated message", () => {
    expect(isNotADirectoryError("ENOENT")).toBe(false);
  });
});

describe("explainFileBrowserError", () => {
  it("explains the not-connected sentinel distinctly from a generic failure", () => {
    const explanation = explainFileBrowserError(FILE_BROWSER_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
  });

  it("explains the timeout sentinel distinctly from a generic failure", () => {
    const explanation = explainFileBrowserError(FILE_BROWSER_TIMEOUT);
    expect(explanation.title).toBe("Request timed out");
    expect(explanation.description).toMatch(/didn't respond in time/i);
  });

  it("explains permission-denied distinctly", () => {
    const eacces = explainFileBrowserError("EACCES: permission denied, scandir '/root'");
    expect(eacces.title).toBe("Permission denied");
    const eperm = explainFileBrowserError("EPERM: operation not permitted");
    expect(eperm.title).toBe("Permission denied");
  });

  it("gives a distinct message for a path missing during an initial listing", () => {
    const explanation = explainFileBrowserError("ENOENT: no such file or directory", "list");
    expect(explanation.title).toBe("This folder no longer exists");
  });

  it("gives a DIFFERENT, distinct message for the identical raw error during an open", () => {
    const listExplanation = explainFileBrowserError("ENOENT: no such file or directory", "list");
    const openExplanation = explainFileBrowserError("ENOENT: no such file or directory", "open");
    expect(openExplanation.title).toBe("This item just disappeared");
    expect(openExplanation.title).not.toBe(listExplanation.title);
    expect(openExplanation.description).not.toBe(listExplanation.description);
  });

  it("explains the workspace-boundary guard", () => {
    const explanation = explainFileBrowserError("Access outside of workspace is not allowed");
    expect(explanation.title).toBe("Outside the workspace");
  });

  it("explains the not-a-directory guard", () => {
    const explanation = explainFileBrowserError("Requested path is not a directory");
    expect(explanation.title).toBe("Not a folder");
  });

  it("explains the missing-cwd guard", () => {
    const explanation = explainFileBrowserError("cwd is required");
    expect(explanation.title).toBe("No workspace selected");
  });

  it("falls back to a generic explanation that still shows the raw text", () => {
    const explanation = explainFileBrowserError("something completely unexpected");
    expect(explanation.title).toBe("Couldn't list this folder");
    expect(explanation.description).toBe("something completely unexpected");
  });

  it("falls back to a fixed message for an empty raw string", () => {
    const explanation = explainFileBrowserError("");
    expect(explanation.description).toBe("The daemon returned an unknown error.");
  });
});

// ---------------------------------------------------------------------------
// File read (T35A2)
// ---------------------------------------------------------------------------

function textFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "a.txt",
    kind: "text",
    bytes: new Uint8Array(),
    mime: "text/plain",
    size: 10,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("explainFileReadError", () => {
  it("explains the not-connected sentinel distinctly from a generic failure", () => {
    expect(explainFileReadError(FILE_READ_NOT_CONNECTED).title).toBe("Not connected");
  });

  it("explains the timeout sentinel distinctly", () => {
    const explanation = explainFileReadError(FILE_READ_TIMEOUT);
    expect(explanation.title).toBe("Request timed out");
  });

  it("explains a vanished file", () => {
    expect(explainFileReadError("ENOENT: no such file or directory").title).toBe(
      "This file no longer exists",
    );
  });

  it("explains permission-denied", () => {
    expect(explainFileReadError("EACCES: permission denied").title).toBe("Permission denied");
  });

  it("explains the workspace-boundary guard", () => {
    expect(explainFileReadError("Access outside of workspace is not allowed").title).toBe(
      "Outside the workspace",
    );
  });

  it("explains the read-specific 'not a file' guard, distinct from the listing 'not a directory' guard", () => {
    const explanation = explainFileReadError("Requested path is not a file");
    expect(explanation.title).toBe("Not a file");
    expect(explanation.title).not.toBe(
      explainFileBrowserError("Requested path is not a directory").title,
    );
  });

  it("falls back to a generic explanation that still shows the raw text", () => {
    const explanation = explainFileReadError("something completely unexpected");
    expect(explanation.title).toBe("Couldn't read this file");
    expect(explanation.description).toBe("something completely unexpected");
  });
});

describe("explainOversizedFile", () => {
  it("reports both the ceiling and the file's actual size", () => {
    const explanation = explainOversizedFile(MAX_PREVIEWABLE_FILE_BYTES + 1024);
    expect(explanation.title).toBe("This file is too large to preview");
    expect(explanation.description).toMatch(`${Math.round(MAX_PREVIEWABLE_FILE_BYTES / 1024)} KB`);
    expect(explanation.description).toMatch("1025 KB");
  });
});

describe("explainRefusedFileKind", () => {
  it("refuses binary content, distinctly from image content", () => {
    const binary = explainRefusedFileKind(textFile({ kind: "binary" }));
    const image = explainRefusedFileKind(textFile({ kind: "image" }));
    expect(binary?.title).toBe("This is a binary file");
    expect(image?.title).toBe("This is an image file");
    expect(binary?.title).not.toBe(image?.title);
  });

  it("refuses text content over the size ceiling — proven exactly at the boundary, not only far past it", () => {
    const atLimit = explainRefusedFileKind(
      textFile({ kind: "text", size: MAX_PREVIEWABLE_FILE_BYTES }),
    );
    expect(atLimit).toBeNull();

    const overLimit = explainRefusedFileKind(
      textFile({ kind: "text", size: MAX_PREVIEWABLE_FILE_BYTES + 1 }),
    );
    expect(overLimit?.title).toBe("This file is too large to preview");
  });

  it("returns null (preview, don't refuse) for ordinary text content", () => {
    expect(explainRefusedFileKind(textFile({ kind: "text", size: 100 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File write (T35A3)
// ---------------------------------------------------------------------------

describe("explainFileWriteError", () => {
  it("gives FILE_WRITE_NOT_CONNECTED its own title and mentions the edit is preserved", () => {
    const explanation = explainFileWriteError(FILE_WRITE_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/still here/i);
  });

  it("gives FILE_WRITE_TIMEOUT its own title, distinct from the read/list timeout title text", () => {
    const explanation = explainFileWriteError(FILE_WRITE_TIMEOUT);
    expect(explanation.title).toBe("Save timed out");
    expect(explanation.description).toMatch(/still here/i);
  });

  it("recognizes a permission-denied rejection", () => {
    expect(explainFileWriteError("EACCES: permission denied").title).toBe("Permission denied");
  });

  it("falls back to a generic explanation that still surfaces the raw daemon text and preserves the edit", () => {
    const explanation = explainFileWriteError("socket hang up");
    expect(explanation.title).toBe("Couldn't save this file");
    expect(explanation.description).toMatch("socket hang up");
    expect(explanation.description).toMatch(/still here/i);
  });
});

describe("explainFileWriteResult", () => {
  it("returns null for a written result — nothing to explain", () => {
    const written: FileWriteResult = { status: "written", modifiedAt: "now", size: 10 };
    expect(explainFileWriteResult(written)).toBeNull();
  });

  it("distinguishes a deleted-file conflict from a changed-file conflict", () => {
    const deleted: FileWriteResult = {
      status: "conflict",
      version: { status: "missing", cwd: "/ws", path: "a.txt" },
    };
    const changed: FileWriteResult = {
      status: "conflict",
      version: { status: "ready", cwd: "/ws", path: "a.txt", size: 5, modifiedAt: "later" },
    };
    expect(explainFileWriteResult(deleted)?.title).toBe("This file was deleted");
    expect(explainFileWriteResult(changed)?.title).toBe("Someone else changed this file");
    expect(explainFileWriteResult(deleted)?.title).not.toBe(explainFileWriteResult(changed)?.title);
  });

  it("recognizes the daemon's oversized-write guard", () => {
    const result: FileWriteResult = { status: "error", error: "File is too large to edit" };
    expect(explainFileWriteResult(result)?.title).toBe("This file is too large to save");
  });

  it("recognizes the daemon's binary-write guard", () => {
    const result: FileWriteResult = { status: "error", error: "Binary files cannot be edited" };
    expect(explainFileWriteResult(result)?.title).toBe("This is a binary file");
  });

  it("falls back to a generic explanation for an unrecognized error result, still surfacing the raw text", () => {
    const result: FileWriteResult = { status: "error", error: "disk full" };
    const explanation = explainFileWriteResult(result);
    expect(explanation?.title).toBe("Couldn't save this file");
    expect(explanation?.description).toMatch("disk full");
  });
});

describe("upload (T35A4)", () => {
  it("matches the daemon's own hardcoded 100 MB ceiling (DaemonClient.uploadFile)", () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it("explains a size over the ceiling in MB, not bytes", () => {
    const explanation = explainOversizedUpload(MAX_UPLOAD_BYTES + 1024 * 1024);
    expect(explanation.title).toBe("This file is too large to upload");
    expect(explanation.description).toMatch("100 MB");
    expect(explanation.description).toMatch("101 MB");
  });

  it("explains not-connected and timeout distinctly", () => {
    expect(explainFileUploadError(FILE_UPLOAD_TIMEOUT).title).toBe("Upload timed out");
    expect(explainFileUploadError("FILE_UPLOAD_NOT_CONNECTED").title).toBe("Not connected");
  });

  it("explains a resolved size-mismatch result as recoverable, not a generic failure", () => {
    const result: FileUploadResult = {
      file: null,
      error: "Size mismatch: declared 10, received 4",
    };
    expect(explainFileUploadResult(result)?.title).toBe("The upload was interrupted");
  });

  it("returns null (no explanation) once a file was actually uploaded", () => {
    const result: FileUploadResult = {
      file: { id: "u1", fileName: "a.txt", mimeType: "text/plain", size: 4, path: "/staged/u1" },
      error: null,
    };
    expect(explainFileUploadResult(result)).toBeNull();
  });
});

describe("download (T35A4)", () => {
  it("matches the upload ceiling for the same memory-budget reason", () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("explains a size over the ceiling in MB, not bytes", () => {
    const explanation = explainOversizedDownload(MAX_DOWNLOAD_BYTES + 1024 * 1024);
    expect(explanation.title).toBe("This file is too large to download");
    expect(explanation.description).toMatch("101 MB");
  });

  it("builds a token-only URL — never the file's name or path", () => {
    const url = buildFileDownloadUrl("http://127.0.0.1:6768", "tok en/with+specials");
    expect(url).toBe("http://127.0.0.1:6768/api/files/download?token=tok%20en%2Fwith%2Bspecials");
    expect(url).not.toMatch("secret.txt");
  });

  it("strips a trailing slash on the origin before appending the route", () => {
    expect(buildFileDownloadUrl("http://127.0.0.1:6768/", "t")).toBe(
      "http://127.0.0.1:6768/api/files/download?token=t",
    );
  });

  it("explains not-connected, token-timeout, no-origin, and mid-transfer failure distinctly", () => {
    expect(explainFileDownloadError(FILE_DOWNLOAD_TOKEN_TIMEOUT).title).toBe("Request timed out");
    expect(explainFileDownloadError("FILE_DOWNLOAD_NOT_CONNECTED").title).toBe("Not connected");
    expect(explainFileDownloadError(FILE_DOWNLOAD_NO_ORIGIN).title).toBe(
      "Downloads aren't available yet",
    );
    expect(explainFileDownloadError(FILE_DOWNLOAD_TRANSFER_FAILED).title).toBe(
      "The download was interrupted",
    );
  });

  it("T66: explains a relay connection's permanent no-origin refusal distinctly from the generic one", () => {
    const relay = explainFileDownloadError(FILE_DOWNLOAD_NO_RELAY_ORIGIN);
    const generic = explainFileDownloadError(FILE_DOWNLOAD_NO_ORIGIN);
    expect(relay.title).toBe("Downloads aren't available over a relay connection");
    expect(relay.title).not.toBe(generic.title);
    expect(relay.description).toMatch(/relay/i);
  });

  it("explains a resolved no-token result (vanished file) using the same vanished vocabulary as listing", () => {
    const result: FileDownloadTokenResult = {
      cwd: "/ws",
      path: "gone.txt",
      token: null,
      fileName: null,
      mimeType: null,
      size: null,
      error: "ENOENT: no such file or directory",
    };
    expect(explainFileDownloadTokenResult(result)?.title).toBe("This file no longer exists");
  });

  it("returns null (no explanation) once a token was actually issued", () => {
    const result: FileDownloadTokenResult = {
      cwd: "/ws",
      path: "a.txt",
      token: "tok",
      fileName: "a.txt",
      mimeType: "text/plain",
      size: 4,
      error: null,
    };
    expect(explainFileDownloadTokenResult(result)).toBeNull();
  });
});
