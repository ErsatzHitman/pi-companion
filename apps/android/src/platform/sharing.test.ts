import { describe, expect, it, vi } from "vitest";

import { MAX_DOWNLOAD_BYTES } from "../features/files/file-browser-client.js";
import {
  SHARING_FILES_UNAVAILABLE,
  SHARING_OVERSIZE_FILE,
  createAndroidSharing,
  createFileSharingUnavailableSharing,
  type AndroidSharingDeps,
  type NativeFileShareModule,
  type NativeShareModule,
} from "./sharing.js";

function fakeNativeShare(): NativeShareModule & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    share: async (content, options) => {
      calls.push({ content, options });
      return { action: "sharedAction" };
    },
  };
}

function fakeNativeFileShare(available: boolean): NativeFileShareModule & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    isAvailableAsync: async () => available,
    shareAsync: async (url, options) => {
      calls.push({ url, options });
    },
  };
}

function buildDeps(overrides: Partial<AndroidSharingDeps> = {}): AndroidSharingDeps {
  return {
    nativeShare: fakeNativeShare(),
    nativeFileShare: fakeNativeFileShare(true),
    writeShareableFile: vi.fn(async (file) => `file:///cache/${file.name}`),
    ...overrides,
  };
}

describe("createAndroidSharing — shareText", () => {
  it("forwards text and title straight to the native share module", async () => {
    const nativeShare = fakeNativeShare();
    const sharing = createAndroidSharing(buildDeps({ nativeShare }));

    await sharing.shareText("hello world", { title: "Share this" });

    expect(nativeShare.calls).toEqual([
      { content: { message: "hello world", title: "Share this" }, options: undefined },
    ]);
  });

  it("resolves (does not reject) when the native module reports a dismissed share — Android's chooser never reliably reports cancellation", async () => {
    const nativeShare: NativeShareModule = {
      share: async () => ({ action: "dismissedAction" }),
    };
    const sharing = createAndroidSharing(buildDeps({ nativeShare }));

    await expect(sharing.shareText("hello")).resolves.toBeUndefined();
  });
});

describe("createAndroidSharing — shareFiles", () => {
  it("writes then shares each file in sequence, in order", async () => {
    const writeShareableFile = vi.fn(
      async (file: { name: string }) => `file:///cache/${file.name}`,
    );
    const nativeFileShare = fakeNativeFileShare(true);
    const sharing = createAndroidSharing(buildDeps({ writeShareableFile, nativeFileShare }));

    await sharing.shareFiles(
      [
        { name: "a.txt", mimeType: "text/plain", data: new Uint8Array([1]) },
        { name: "b.txt", mimeType: "text/plain", data: new Uint8Array([2]) },
      ],
      { title: "Export" },
    );

    expect(writeShareableFile).toHaveBeenCalledTimes(2);
    expect(nativeFileShare.calls).toEqual([
      { url: "file:///cache/a.txt", options: { mimeType: "text/plain", dialogTitle: "Export" } },
      { url: "file:///cache/b.txt", options: { mimeType: "text/plain", dialogTitle: "Export" } },
    ]);
  });

  it("is a no-op for an empty file list — no write, no native call", async () => {
    const writeShareableFile = vi.fn();
    const nativeFileShare = fakeNativeFileShare(true);
    const sharing = createAndroidSharing(buildDeps({ writeShareableFile, nativeFileShare }));

    await sharing.shareFiles([]);

    expect(writeShareableFile).not.toHaveBeenCalled();
    expect(nativeFileShare.calls).toHaveLength(0);
  });

  it("rejects with SHARING_OVERSIZE_FILE before writing anything, when a file exceeds MAX_DOWNLOAD_BYTES", async () => {
    const writeShareableFile = vi.fn();
    const oversized = new Uint8Array(MAX_DOWNLOAD_BYTES + 1);
    const sharing = createAndroidSharing(buildDeps({ writeShareableFile }));

    await expect(sharing.shareFiles([{ name: "huge.bin", data: oversized }])).rejects.toThrow(
      SHARING_OVERSIZE_FILE,
    );
    expect(writeShareableFile).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at MAX_DOWNLOAD_BYTES", async () => {
    const atLimit = new Uint8Array(MAX_DOWNLOAD_BYTES);
    const sharing = createAndroidSharing(buildDeps());

    await expect(sharing.shareFiles([{ name: "max.bin", data: atLimit }])).resolves.toBeUndefined();
  });

  it("rejects with SHARING_FILES_UNAVAILABLE, without writing anything, when no share target exists", async () => {
    const writeShareableFile = vi.fn();
    const nativeFileShare = fakeNativeFileShare(false);
    const sharing = createAndroidSharing(buildDeps({ writeShareableFile, nativeFileShare }));

    await expect(
      sharing.shareFiles([{ name: "a.txt", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(SHARING_FILES_UNAVAILABLE);
    expect(writeShareableFile).not.toHaveBeenCalled();
  });
});

describe("createAndroidSharing — isAvailable", () => {
  it("reflects the native file-share module's own availability flag", async () => {
    await expect(
      createAndroidSharing(buildDeps({ nativeFileShare: fakeNativeFileShare(true) })).isAvailable(),
    ).resolves.toBe(true);
    await expect(
      createAndroidSharing(
        buildDeps({ nativeFileShare: fakeNativeFileShare(false) }),
      ).isAvailable(),
    ).resolves.toBe(false);
  });
});

describe("createFileSharingUnavailableSharing", () => {
  it("shares text for real through the injected native module", async () => {
    const nativeShare = fakeNativeShare();
    const sharing = createFileSharingUnavailableSharing(nativeShare);

    await sharing.shareText("still works", { title: "t" });

    expect(nativeShare.calls).toEqual([
      { content: { message: "still works", title: "t" }, options: undefined },
    ]);
  });

  it("reports file-sharing as unavailable and refuses shareFiles", async () => {
    const sharing = createFileSharingUnavailableSharing(fakeNativeShare());

    await expect(sharing.isAvailable()).resolves.toBe(false);
    await expect(
      sharing.shareFiles([{ name: "a.txt", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(SHARING_FILES_UNAVAILABLE);
  });
});
