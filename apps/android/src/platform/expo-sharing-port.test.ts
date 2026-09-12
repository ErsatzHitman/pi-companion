/**
 * T32S11 coverage for the real `createExpoSharing` adapter.
 *
 * Same technique as `../features/composer/expo-attachment-source-port.test.ts`:
 * `expo-sharing` and `expo-file-system/legacy` each transitively import
 * `react-native` (via `expo-modules-core`'s `Platform.ts`), which this
 * workspace's plain `vitest` setup cannot transform (the "RN-in-vitest
 * limitation" — see `expo-sharing-port.ts`'s own header). Both packages are
 * replaced with controllable fixtures via `vi.mock` factories, hoisted to
 * the top of this file, before the module under test is imported — so the
 * real native packages are never actually loaded.
 */
import { describe, expect, it, vi } from "vitest";

const nativeFileShareCalls = vi.hoisted(() => [] as unknown[][]);
const writeCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock("react-native", () => ({
  Share: {
    share: async () => ({ action: "sharedAction" }),
  },
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
  requireNativeModule: () => null,
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (url: string, options: unknown) => {
    nativeFileShareCalls.push([url, options]);
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  writeAsStringAsync: async (uri: string, contents: string, options: unknown) => {
    writeCalls.push([uri, contents, options]);
  },
}));

const { createExpoSharing, writeShareableFileToCache } = await import("./expo-sharing-port.js");

describe("createExpoSharing — composition", () => {
  it("shareText forwards message/title to the injected NativeShareModule", async () => {
    const calls: unknown[] = [];
    const sharing = createExpoSharing({
      nativeShare: {
        share: async (content, options) => {
          calls.push([content, options]);
          return { action: "sharedAction" };
        },
      },
      nativeFileShare: { isAvailableAsync: async () => true, shareAsync: async () => {} },
      writeShareableFile: async () => "file:///cache/x",
    });

    await sharing.shareText("hello", { title: "T" });
    expect(calls).toEqual([[{ message: "hello", title: "T" }, undefined]]);
  });

  it("shareFiles writes then shares each file in sequence", async () => {
    const writes: string[] = [];
    const shares: string[] = [];
    const sharing = createExpoSharing({
      nativeShare: { share: async () => ({ action: "sharedAction" }) },
      nativeFileShare: {
        isAvailableAsync: async () => true,
        shareAsync: async (url) => {
          shares.push(url);
        },
      },
      writeShareableFile: async (file) => {
        writes.push(file.name);
        return `file:///cache/${file.name}`;
      },
    });

    await sharing.shareFiles([
      { name: "a.txt", mimeType: "text/plain", data: new Uint8Array([1]) },
      { name: "b.txt", mimeType: "text/plain", data: new Uint8Array([2]) },
    ]);

    expect(writes).toEqual(["a.txt", "b.txt"]);
    expect(shares).toEqual(["file:///cache/a.txt", "file:///cache/b.txt"]);
  });
});

describe("createExpoSharing — DEFAULT_BINDINGS wire the real packages", () => {
  it("writeShareableFileToCache base64-encodes the bytes into cacheDirectory + name", async () => {
    writeCalls.length = 0;
    const uri = await writeShareableFileToCache({
      name: "hi.txt",
      mimeType: "text/plain",
      data: new Uint8Array([0x68, 0x69]),
    });

    expect(uri).toBe("file:///cache/hi.txt");
    expect(writeCalls).toEqual([["file:///cache/hi.txt", "aGk=", { encoding: "base64" }]]);
  });

  it("isAvailable and shareFiles reach expo-sharing's own exports", async () => {
    nativeFileShareCalls.length = 0;
    writeCalls.length = 0;
    const sharing = createExpoSharing();

    await expect(sharing.isAvailable()).resolves.toBe(true);
    await sharing.shareFiles([
      { name: "hi.txt", mimeType: "text/plain", data: new Uint8Array([0x68, 0x69]) },
    ]);

    expect(nativeFileShareCalls).toEqual([
      ["file:///cache/hi.txt", { mimeType: "text/plain", dialogTitle: undefined }],
    ]);
  });
});
