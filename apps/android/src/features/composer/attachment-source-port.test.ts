import { describe, expect, it } from "vitest";

import { readUriAsBytes } from "./attachment-source-port";

/**
 * T290: `readUriAsBytes` is React Native's own `fetch`/`Blob`/
 * `FileReader` globals, not any Expo package — this workspace's plain
 * `vitest` (Node) environment has neither `Blob` payload plumbed
 * through a real `FileReader` nor `FileReader` itself as a global, so
 * both are stubbed here, minimally, mirroring `../voice/expo-audio-
 * voice-capture-port.test.ts`'s identical treatment of
 * `readClipAsBase64` — the one piece of real logic this function has is
 * turning a `FileReader.readAsArrayBuffer` result into a `Uint8Array`.
 */
describe("readUriAsBytes — ArrayBuffer extraction, no expo-file-system involved", () => {
  it("resolves the bytes FileReader.readAsArrayBuffer produces", async () => {
    const originalFetch = globalThis.fetch;
    const originalFileReader = globalThis.FileReader;
    globalThis.fetch = (async () => ({
      blob: async () => ({ size: 3 }),
    })) as unknown as typeof fetch;
    const expectedBytes = new Uint8Array([1, 2, 3]).buffer;
    class StubFileReader {
      result: ArrayBuffer | null = null;
      onerror: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer() {
        this.result = expectedBytes;
        this.onloadend?.();
      }
    }
    globalThis.FileReader = StubFileReader as unknown as typeof FileReader;

    try {
      const bytes = await readUriAsBytes("file:///cache/report.pdf");
      expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.FileReader = originalFileReader;
    }
  });

  it("rejects when FileReader reports an error, rather than resolving garbage", async () => {
    const originalFetch = globalThis.fetch;
    const originalFileReader = globalThis.FileReader;
    globalThis.fetch = (async () => ({
      blob: async () => ({ size: 3 }),
    })) as unknown as typeof fetch;
    class FailingFileReader {
      result: ArrayBuffer | null = null;
      error = new Error("boom");
      onerror: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;

    try {
      await expect(readUriAsBytes("file:///cache/report.pdf")).rejects.toThrow("boom");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.FileReader = originalFileReader;
    }
  });

  it("rejects when FileReader's result is not an ArrayBuffer, rather than resolving garbage", async () => {
    const originalFetch = globalThis.fetch;
    const originalFileReader = globalThis.FileReader;
    globalThis.fetch = (async () => ({
      blob: async () => ({ size: 3 }),
    })) as unknown as typeof fetch;
    class WrongResultFileReader {
      result: string | null = null;
      onerror: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer() {
        this.result = "not-an-array-buffer";
        this.onloadend?.();
      }
    }
    globalThis.FileReader = WrongResultFileReader as unknown as typeof FileReader;

    try {
      await expect(readUriAsBytes("file:///cache/report.pdf")).rejects.toThrow(
        "Unexpected FileReader result",
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.FileReader = originalFileReader;
    }
  });
});
