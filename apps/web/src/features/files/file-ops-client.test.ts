import { describe, expect, it, vi } from "vitest";

import { authorizeWorkspacePath } from "./path-authorization.js";
import { explainFileOpsError, type FileOpsClient } from "./file-ops-client.js";

describe("explainFileOpsError", () => {
  it("explains the root guards", () => {
    for (const raw of [
      "Cannot create the root directory",
      "Cannot delete the root directory",
      "Cannot rename the root directory",
    ]) {
      expect(explainFileOpsError(raw).title).toMatch(/root folder is protected/i);
    }
  });

  it("explains an occupied destination", () => {
    expect(explainFileOpsError("Destination already exists").title).toMatch(/already there/i);
  });

  it("explains a non-empty directory", () => {
    expect(explainFileOpsError("Directory is not empty").title).toMatch(/isn't empty/i);
  });

  it("explains a vanished path", () => {
    expect(explainFileOpsError("Requested path does not exist").title).toMatch(/no longer exists/i);
  });

  it("explains the shared workspace guards", () => {
    expect(explainFileOpsError("Access outside of workspace is not allowed").title).toMatch(
      /outside the workspace/i,
    );
    expect(explainFileOpsError("cwd is required").title).toMatch(/no workspace selected/i);
  });

  it("falls back to a generic explanation that still shows the raw message", () => {
    const explanation = explainFileOpsError("something unexpected happened");
    expect(explanation.title).toMatch(/couldn't change this file/i);
    expect(explanation.description).toBe("something unexpected happened");
  });
});

describe("FileOpsClient authorization door", () => {
  it("authorizes every ops path through authorizeWorkspacePath before the request", async () => {
    const client: FileOpsClient = {
      mkdir: vi.fn().mockResolvedValue({ path: "a" }),
      createFile: vi.fn().mockResolvedValue({ path: "a.txt" }),
      renameEntry: vi.fn().mockResolvedValue({ oldPath: "a.txt", newPath: "b.txt" }),
      deleteEntry: vi.fn().mockResolvedValue({ path: "a.txt" }),
    };

    // The door every caller must use first: legit paths pass through
    // unchanged, escape-shaped paths throw before any RPC is issued.
    expect(authorizeWorkspacePath("notes/hello.txt").path).toBe("notes/hello.txt");
    expect(() => authorizeWorkspacePath("../escape")).toThrow();

    await client.mkdir("/root", authorizeWorkspacePath("a").path);
    await client.createFile("/root", authorizeWorkspacePath("a.txt").path, "hi");
    await client.renameEntry(
      "/root",
      authorizeWorkspacePath("a.txt").path,
      authorizeWorkspacePath("b.txt").path,
    );
    await client.deleteEntry("/root", authorizeWorkspacePath("a.txt").path);
    expect(client.mkdir).toHaveBeenCalledWith("/root", "a");
    expect(client.createFile).toHaveBeenCalledWith("/root", "a.txt", "hi");
    expect(client.renameEntry).toHaveBeenCalledWith("/root", "a.txt", "b.txt");
    expect(client.deleteEntry).toHaveBeenCalledWith("/root", "a.txt");
  });
});
