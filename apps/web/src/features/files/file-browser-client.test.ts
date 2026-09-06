import { describe, expect, it } from "vitest";

import { FILE_BROWSER_NOT_CONNECTED, explainFileBrowserError } from "./file-browser-client.js";

describe("explainFileBrowserError (T30B1)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainFileBrowserError(FILE_BROWSER_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it.each([
    "ENOENT: no such file or directory, stat '/workspace/missing'",
    "no such file or directory",
  ])("explains a missing-path error: %s", (raw) => {
    const explanation = explainFileBrowserError(raw);
    expect(explanation.title).toMatch(/no longer exists/i);
  });

  it.each([
    "EACCES: permission denied, open '/root/secret'",
    "EPERM: operation not permitted",
    "Permission denied",
  ])("explains a permission error: %s", (raw) => {
    const explanation = explainFileBrowserError(raw);
    expect(explanation.title).toMatch(/permission denied/i);
  });

  it("explains the outside-of-workspace guard", () => {
    const explanation = explainFileBrowserError("Access outside of workspace is not allowed");
    expect(explanation.title).toMatch(/outside the workspace/i);
  });

  it("explains a not-a-directory guard", () => {
    const explanation = explainFileBrowserError("Requested path is not a directory");
    expect(explanation.title).toMatch(/not a folder/i);
  });

  it("explains a missing-cwd guard", () => {
    const explanation = explainFileBrowserError("cwd is required");
    expect(explanation.title).toMatch(/no workspace selected/i);
  });

  it("falls back to a generic explanation that still shows the raw message", () => {
    const explanation = explainFileBrowserError("something unexpected happened");
    expect(explanation.title).toMatch(/couldn't list this folder/i);
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to a generic message when the raw text is empty", () => {
    const explanation = explainFileBrowserError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
  });
});
