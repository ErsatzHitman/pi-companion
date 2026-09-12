import { appendFile, chmod, mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDirectoryEntry,
  createExplorerFile,
  deleteExplorerEntry,
  getExplorerFileVersion,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "./service.js";

async function createHomeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.homedir(), prefix));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("atomically writes an existing text file at the expected revision", async () => {
    const root = await createTempDir("paseo-file-write-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "before", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "after",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });

      expect(result.status).toBe("written");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves the original file permissions across atomic replacement",
    async () => {
      const root = await createTempDir("paseo-file-mode-");
      try {
        const filePath = path.join(root, "script.sh");
        await writeFile(filePath, "before", "utf8");
        await chmod(filePath, 0o764);
        const current = await getExplorerFileVersion({ root, relativePath: "script.sh" });
        expect(current.status).toBe("ready");
        if (current.status !== "ready") return;

        const result = await writeExplorerFile({
          root,
          relativePath: "script.sh",
          content: "after",
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

        expect(result.status).toBe("written");
        expect((await stat(filePath)).mode & 0o7777).toBe(0o764);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves a newer disk revision instead of overwriting it", async () => {
    const root = await createTempDir("paseo-file-conflict-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "newer on disk", "utf8");

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "conflict", version: { status: "ready" } });
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe(
        "newer on disk",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the high-precision revision token over the display timestamp", async () => {
    const root = await createTempDir("paseo-file-revision-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "on disk", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: `${current.revision}-stale`,
      });

      expect(result.status).toBe("conflict");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("on disk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never creates a missing file through the write API", async () => {
    const root = await createTempDir("paseo-file-missing-");
    try {
      const result = await writeExplorerFile({
        root,
        relativePath: "missing.txt",
        content: "new file",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "conflict", version: { status: "missing" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads .ex files as text", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "sample.ex");
      const content = "defmodule Sample do\nend\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "sample.ex",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads unknown extension text files as text", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "notes.customext");
      const content = "hello from a custom text file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "notes.customext",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies files with null bytes as binary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "blob.weird");
      await writeFile(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

      const result = await readExplorerFile({
        root,
        relativePath: "blob.weird",
      });

      expect(result.kind).toBe("binary");
      expect(result.encoding).toBe("none");
      expect(result.content).toBeUndefined();
      expect(result.mimeType).toBe("application/octet-stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file grows after its revision is advertised", async () => {
    const root = await createTempDir("paseo-file-stream-growth-");

    try {
      const filePath = path.join(root, "growing.log");
      const initial = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, initial);
      await expect(
        streamExplorerFile({ root, relativePath: "growing.log" }, async (file) => {
          await appendFile(filePath, Buffer.alloc(300 * 1024, 0x62));
          for await (const _chunk of file.chunks) {
            // Consume through the advertised prefix before validating the revision.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file shrinks below its advertised size", async () => {
    const root = await createTempDir("paseo-file-stream-truncate-");

    try {
      const filePath = path.join(root, "shrinking.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));

      await expect(
        streamExplorerFile({ root, relativePath: "shrinking.log" }, async (file) => {
          await truncate(filePath, 100 * 1024);
          for await (const _chunk of file.chunks) {
            // Consume until the stream detects the premature EOF.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file is overwritten in place", async () => {
    const root = await createTempDir("paseo-file-stream-overwrite-");

    try {
      const filePath = path.join(root, "changing.log");
      const initial = Buffer.alloc(600 * 1024, 0x61);
      await writeFile(filePath, initial);

      await expect(
        streamExplorerFile({ root, relativePath: "changing.log" }, async (file) => {
          let chunkIndex = 0;
          for await (const _chunk of file.chunks) {
            chunkIndex += 1;
            if (chunkIndex === 1) {
              const replacement = Buffer.alloc(initial.byteLength, 0x62);
              await writeFile(filePath, replacement);
            }
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies sampled text when UTF-8 crosses the sample boundary", async () => {
    const root = await createTempDir("paseo-file-stream-utf8-");

    try {
      const content = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("€"), Buffer.from("z")]);
      await writeFile(path.join(root, "sample.txt"), content);
      let kind: string | undefined;
      let encoding: string | undefined;

      await streamExplorerFile({ root, relativePath: "sample.txt" }, async (file) => {
        kind = file.kind;
        encoding = file.encoding;
      });

      expect(kind).toBe("text");
      expect(encoding).toBe("utf-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete UTF-8 when the whole file was sampled", async () => {
    const root = await createTempDir("paseo-file-stream-invalid-utf8-");

    try {
      await writeFile(path.join(root, "invalid.txt"), Buffer.from([0x61, 0xe2, 0x82]));
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "invalid.txt" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary bytes beyond the initial classification block", async () => {
    const root = await createTempDir("paseo-file-stream-late-binary-");

    try {
      const content = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff])]);
      await writeFile(path.join(root, "late-binary.unknown"), content);
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "late-binary.unknown" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands a ~ prefix in relative paths against the user home directory", async () => {
    const root = await createHomeTempDir(".paseo-file-explorer-home-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root,
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.content).toBe("hello from home\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows home to be the scoped root for tilde file previews", async () => {
    const root = await createHomeTempDir(".paseo-file-explorer-home-root-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home root\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root: "~",
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.path).toBe(path.relative(os.homedir(), filePath).split(path.sep).join("/"));
      expect(result.content).toBe("hello from home root\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ~-prefixed paths that resolve outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-file-explorer-outside-home-"));

    try {
      await expect(
        readExplorerFile({
          root,
          relativePath: "~/some/file.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates nested directories and lists them", async () => {
    const root = await createTempDir("paseo-file-mkdir-");
    try {
      const result = await createDirectoryEntry({ root, relativePath: "a/b/c" });
      expect(result.path).toBe("a/b/c");
      const listing = await listDirectoryEntries({ root, relativePath: "a/b" });
      expect(listing.entries.map((e) => e.name)).toContain("c");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to create the root directory or escape it", async () => {
    const root = await createTempDir("paseo-file-mkdir-root-");
    try {
      await expect(createDirectoryEntry({ root, relativePath: "." })).rejects.toThrow(
        "Cannot create the root directory",
      );
      await expect(createDirectoryEntry({ root, relativePath: "../escape" })).rejects.toThrow(
        "Access outside of workspace is not allowed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates a new file but never clobbers an existing one", async () => {
    const root = await createTempDir("paseo-file-create-");
    try {
      const created = await createExplorerFile({
        root,
        relativePath: "notes/hello.txt",
        content: "hi",
      });
      expect(created.path).toBe("notes/hello.txt");
      expect((await readExplorerFile({ root, relativePath: "notes/hello.txt" })).content).toBe(
        "hi",
      );
      await expect(createExplorerFile({ root, relativePath: "notes/hello.txt" })).rejects.toThrow(
        /EEXIST|already exists/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames an entry and refuses occupied destinations", async () => {
    const root = await createTempDir("paseo-file-rename-");
    try {
      await createExplorerFile({ root, relativePath: "a.txt", content: "a" });
      await createExplorerFile({ root, relativePath: "b.txt", content: "b" });
      await expect(
        renameExplorerEntry({ root, oldPath: "a.txt", newPath: "b.txt" }),
      ).rejects.toThrow("Destination already exists");
      const renamed = await renameExplorerEntry({ root, oldPath: "a.txt", newPath: "c.txt" });
      expect(renamed.newPath).toBe("c.txt");
      await expect(readExplorerFile({ root, relativePath: "a.txt" })).rejects.toThrow();
      expect((await readExplorerFile({ root, relativePath: "c.txt" })).content).toBe("a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to rename the root or escape the jail", async () => {
    const root = await createTempDir("paseo-file-rename-root-");
    try {
      await createExplorerFile({ root, relativePath: "a.txt", content: "a" });
      await expect(renameExplorerEntry({ root, oldPath: ".", newPath: "b" })).rejects.toThrow(
        "Cannot rename the root directory",
      );
      await expect(
        renameExplorerEntry({ root, oldPath: "a.txt", newPath: "../evil.txt" }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes files, refuses non-empty dirs without recursive, deletes them with it", async () => {
    const root = await createTempDir("paseo-file-delete-");
    try {
      await createExplorerFile({ root, relativePath: "gone.txt", content: "x" });
      expect((await deleteExplorerEntry({ root, relativePath: "gone.txt" })).path).toBe("gone.txt");
      await createExplorerFile({ root, relativePath: "dir/inner.txt", content: "y" });
      await expect(deleteExplorerEntry({ root, relativePath: "dir" })).rejects.toThrow(
        "Directory is not empty",
      );
      expect((await deleteExplorerEntry({ root, relativePath: "dir", recursive: true })).path).toBe(
        "dir",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to delete the root or a missing path", async () => {
    const root = await createTempDir("paseo-file-delete-root-");
    try {
      await expect(deleteExplorerEntry({ root, relativePath: "." })).rejects.toThrow(
        "Cannot delete the root directory",
      );
      await expect(deleteExplorerEntry({ root, relativePath: "nope.txt" })).rejects.toThrow(
        "Requested path does not exist",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
