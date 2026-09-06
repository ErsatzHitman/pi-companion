import { describe, expect, it } from "vitest";

import {
  FILE_DOWNLOAD_NO_ORIGIN,
  FILE_DOWNLOAD_NOT_CONNECTED,
  buildFileDownloadUrl,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
} from "./file-download-client.js";
import type { FileDownloadTokenResult } from "./file-download-client.js";

describe("buildFileDownloadUrl (T30B4)", () => {
  it("builds the daemon's exact /api/files/download route with a token query param", () => {
    const url = buildFileDownloadUrl("http://127.0.0.1:6768", "tok_abc123");
    expect(url).toBe("http://127.0.0.1:6768/api/files/download?token=tok_abc123");
  });

  it("URL-encodes a token containing reserved characters", () => {
    const url = buildFileDownloadUrl("http://127.0.0.1:6768", "tok a+b");
    expect(url).toBe("http://127.0.0.1:6768/api/files/download?token=tok+a%2Bb");
  });
});

describe("explainFileDownloadError (T30B4)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainFileDownloadError(FILE_DOWNLOAD_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
  });

  it("explains the no-reachable-origin sentinel", () => {
    const explanation = explainFileDownloadError(FILE_DOWNLOAD_NO_ORIGIN);
    expect(explanation.title).toMatch(/aren't available yet/i);
  });

  it("falls back to a generic explanation, keeping the raw text", () => {
    const explanation = explainFileDownloadError("Download failed (500)");
    expect(explanation.title).toBe("Couldn't download this file");
    expect(explanation.description).toBe("Download failed (500)");
  });
});

describe("explainFileDownloadTokenResult (T30B4)", () => {
  function tokenResult(overrides: Partial<FileDownloadTokenResult> = {}): FileDownloadTokenResult {
    return {
      cwd: "/workspace",
      path: "README.md",
      token: "tok_1",
      fileName: "README.md",
      mimeType: "text/markdown",
      size: 12,
      error: null,
      ...overrides,
    };
  }

  it("returns null once a token is issued", () => {
    expect(explainFileDownloadTokenResult(tokenResult())).toBeNull();
  });

  it("explains a missing-file error", () => {
    const explanation = explainFileDownloadTokenResult(
      tokenResult({ token: null, error: "ENOENT: no such file or directory, stat 'x'" }),
    );
    expect(explanation?.title).toMatch(/no longer exists/i);
  });

  it("explains an outside-workspace guard", () => {
    const explanation = explainFileDownloadTokenResult(
      tokenResult({ token: null, error: "Access outside of workspace is not allowed" }),
    );
    expect(explanation?.title).toMatch(/outside the workspace/i);
  });

  it("falls back to a generic explanation for an unrecognized error", () => {
    const explanation = explainFileDownloadTokenResult(
      tokenResult({ token: null, error: "cwd is required" }),
    );
    expect(explanation?.title).toBe("Couldn't download this file");
  });
});
