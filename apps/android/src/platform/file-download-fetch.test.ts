import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchDownload } from "./file-download-fetch.js";

/** Minimal fake `DownloadStreamReader.getReader()`-shaped body — proves `createFetchDownload` forwards the exact object, not a copy. */
function fakeReadableBody() {
  return { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) };
}

describe("createFetchDownload (T32S14)", () => {
  it("forwards ok/status unchanged, and the exact body reference, for a response with a readable body", async () => {
    const body = fakeReadableBody();
    const rawFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body });
    const fetchImpl = createFetchDownload(rawFetch);

    const result = await fetchImpl("https://daemon.example/download/abc");

    expect(rawFetch).toHaveBeenCalledWith("https://daemon.example/download/abc");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe(body);
  });

  it("normalizes a response with no body field at all to body: null, honestly rather than crashing — RN's own fetch/Response type declares no body field", async () => {
    const rawFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const fetchImpl = createFetchDownload(rawFetch);

    const result = await fetchImpl("https://daemon.example/download/abc");

    expect(result.body).toBeNull();
  });

  it("normalizes a body value with no getReader() (e.g. RN's Blob-shaped body) to null rather than passing through something that would crash on .getReader()", async () => {
    const rawFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { size: 42 } });
    const fetchImpl = createFetchDownload(rawFetch);

    const result = await fetchImpl("https://daemon.example/download/abc");

    expect(result.body).toBeNull();
  });

  it("forwards a non-ok status (e.g. 404) unchanged rather than throwing — the caller (file-download-model.ts) classifies it", async () => {
    const rawFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, body: null });
    const fetchImpl = createFetchDownload(rawFetch);

    const result = await fetchImpl("https://daemon.example/download/missing");

    expect(result).toEqual({ ok: false, status: 404, body: null });
  });

  it("propagates a rejected underlying fetch call as a rejected promise, never swallowed", async () => {
    const rawFetch = vi.fn().mockRejectedValue(new Error("network down"));
    const fetchImpl = createFetchDownload(rawFetch);

    await expect(fetchImpl("https://daemon.example/download/abc")).rejects.toThrow("network down");
  });
});

describe("createFetchDownload with no injected transport (default parameter)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls the ambient global fetch when no rawFetch override is supplied", async () => {
    const body = fakeReadableBody();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, body }) as unknown as typeof fetch;
    const fetchImpl = createFetchDownload();

    const result = await fetchImpl("https://daemon.example/download/abc");

    expect(globalThis.fetch).toHaveBeenCalledWith("https://daemon.example/download/abc");
    expect(result).toEqual({ ok: true, status: 200, body });
  });
});
