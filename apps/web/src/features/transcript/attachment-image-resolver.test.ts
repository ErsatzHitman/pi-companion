import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { timeline } from "@picompanion/frontend-core";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import {
  applyResolvedAttachmentImage,
  buildAttachmentDataUri,
  buildAttachmentDownloadUrl,
  collectTimelineImages,
  encodeBytesToBase64,
  resolveDirectHttpOrigin,
  supportsRelayAttachmentDownload,
  useAttachmentImageResolver,
  type AttachmentDownloadTokenClient,
} from "./attachment-image-resolver.js";

const SETTLE_WAIT = { timeout: 5_000 } as const;

function image(overrides: Partial<AgentTimelineImageRef> = {}): AgentTimelineImageRef {
  return {
    mimeType: "image/png",
    path: "/tmp/paseo-attachments-abc123/deadbeef.png",
    bytes: 42_000,
    ...overrides,
  };
}

function userMessage(id: string, images?: AgentTimelineImageRef[]): timeline.TranscriptEntry {
  return {
    id,
    kind: "user-message",
    text: "hi",
    pending: false,
    stale: false,
    ...(images ? { images } : {}),
  } as unknown as timeline.TranscriptEntry;
}

describe("buildAttachmentDownloadUrl", () => {
  it("builds the daemon's exact /api/files/download route with a token query param", () => {
    expect(buildAttachmentDownloadUrl("http://127.0.0.1:6768", "tok_abc123")).toBe(
      "http://127.0.0.1:6768/api/files/download?token=tok_abc123",
    );
  });

  it("percent-encodes a token with reserved characters", () => {
    expect(buildAttachmentDownloadUrl("http://127.0.0.1:6768", "tok a+b")).toBe(
      "http://127.0.0.1:6768/api/files/download?token=tok+a%2Bb",
    );
  });
});

describe("resolveDirectHttpOrigin", () => {
  it("returns null with no profile", () => {
    expect(resolveDirectHttpOrigin(null, "direct")).toBeNull();
  });

  it("returns null on a relay connection even with a direct profile configured", () => {
    const profile = {
      id: "p1",
      label: "Home",
      direct: { endpoint: "127.0.0.1:6767", useTls: false },
      preferDirect: true,
      createdAt: 0,
      updatedAt: 0,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };
    expect(resolveDirectHttpOrigin(profile, "relay")).toBeNull();
  });

  it("returns null when the kind is direct but the profile has no direct connection configured", () => {
    const profile = {
      id: "p1",
      label: "Relay only",
      preferDirect: false,
      createdAt: 0,
      updatedAt: 0,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };
    expect(resolveDirectHttpOrigin(profile, "direct")).toBeNull();
  });

  it("builds an http origin for a non-TLS direct profile", () => {
    const profile = {
      id: "p1",
      label: "Home",
      direct: { endpoint: "127.0.0.1:6767", useTls: false },
      preferDirect: true,
      createdAt: 0,
      updatedAt: 0,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };
    expect(resolveDirectHttpOrigin(profile, "direct")).toBe("http://127.0.0.1:6767");
  });

  it("builds an https origin for a TLS direct profile, preserving a bracketed IPv6 endpoint verbatim", () => {
    const profile = {
      id: "p1",
      label: "Home",
      direct: { endpoint: "[::1]:6767", useTls: true },
      preferDirect: true,
      createdAt: 0,
      updatedAt: 0,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };
    expect(resolveDirectHttpOrigin(profile, "direct")).toBe("https://[::1]:6767");
  });
});

describe("encodeBytesToBase64", () => {
  it("encodes known byte vectors without Buffer or btoa", () => {
    expect(encodeBytesToBase64(new Uint8Array([]))).toBe("");
    expect(encodeBytesToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");
    expect(encodeBytesToBase64(new Uint8Array([255]))).toBe("/w==");
    expect(encodeBytesToBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  });
});

describe("buildAttachmentDataUri", () => {
  it("prefixes the base64 bytes with the data: MIME header", () => {
    expect(buildAttachmentDataUri(new Uint8Array([1, 2, 3]), "image/png")).toBe(
      "data:image/png;base64,AQID",
    );
  });
});

describe("supportsRelayAttachmentDownload", () => {
  it("is false for a token-only client, true once downloadFileBytes is present", () => {
    const { client } = fakeClient(() => ({ token: "tok", mimeType: "image/png", error: null }));
    expect(supportsRelayAttachmentDownload(client)).toBe(false);
    expect(
      supportsRelayAttachmentDownload({
        ...client,
        downloadFileBytes: async () => ({ bytes: new Uint8Array([1]) }),
      }),
    ).toBe(true);
  });
});

describe("collectTimelineImages", () => {
  it("returns an empty array for entries with no images", () => {
    expect(collectTimelineImages([userMessage("m1")])).toEqual([]);
  });

  it("collects images off user/assistant entries, ignoring other entry kinds", () => {
    const img = image();
    const nonMessage = {
      id: "t1",
      kind: "thinking",
      text: "",
    } as unknown as timeline.TranscriptEntry;
    expect(collectTimelineImages([userMessage("m1", [img]), nonMessage])).toEqual([img]);
  });

  it("de-duplicates by path across multiple entries, keeping first-seen order", () => {
    const shared = image({ path: "/tmp/paseo-attachments-x/shared.png" });
    const other = image({ path: "/tmp/paseo-attachments-x/other.png" });
    const result = collectTimelineImages([
      userMessage("m1", [shared]),
      userMessage("m2", [other, shared]),
    ]);
    expect(result).toEqual([shared, other]);
  });
});

describe("applyResolvedAttachmentImage", () => {
  it("returns the same Map reference when the path already maps to the same url", () => {
    const map = new Map([["/p/a.png", "http://x/a"]]);
    expect(applyResolvedAttachmentImage(map, "/p/a.png", "http://x/a")).toBe(map);
  });

  it("returns a new Map with the path set when it differs, never mutating the input", () => {
    const map = new Map([["/p/a.png", "http://x/a"]]);
    const next = applyResolvedAttachmentImage(map, "/p/b.png", "http://x/b");
    expect(next).not.toBe(map);
    expect(next.get("/p/b.png")).toBe("http://x/b");
    expect(map.has("/p/b.png")).toBe(false);
  });
});

/** A counting fake — never a stand-in whose result the test itself invents (see this repository's own "an assertion pinned to your own fixture" catalogue entry). Resolves a real token per call, tracked by call count. */
function fakeClient(
  tokenFor: (path: string) => {
    token: string | null;
    mimeType: string | null;
    error: string | null;
  },
): { client: AttachmentDownloadTokenClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      requestAttachmentDownloadToken: vi.fn(async (_agentId: string, path: string) => {
        calls.push(path);
        return tokenFor(path);
      }),
    },
  };
}

describe("useAttachmentImageResolver", () => {
  it("resolves undefined for every image with no client (no connection)", () => {
    const { result } = renderHook(() =>
      useAttachmentImageResolver({
        client: null,
        agentId: "agent-1",
        downloadOrigin: null,
        entries: [userMessage("m1", [image()])],
      }),
    );
    expect(
      result.current(image(), { entryId: "m1", speaker: "user", index: 0, total: 1 }),
    ).toBeUndefined();
  });

  it("resolves undefined for every image with a client but no downloadOrigin (relay connection)", () => {
    const { client } = fakeClient(() => ({ token: "tok", mimeType: "image/png", error: null }));
    const { result } = renderHook(() =>
      useAttachmentImageResolver({
        client,
        agentId: "agent-1",
        downloadOrigin: null,
        entries: [userMessage("m1", [image()])],
      }),
    );
    expect(
      result.current(image(), { entryId: "m1", speaker: "user", index: 0, total: 1 }),
    ).toBeUndefined();
  });

  it("relay images resolve through the chunk loop to a data URI when the client exposes downloadFileBytes (the daemon now serves agentId-scoped chunk reads), and no token is requested", async () => {
    const theImage = image();
    const { client, calls } = fakeClient(() => ({
      token: "tok_1",
      mimeType: "image/png",
      error: null,
    }));
    const downloadFileBytes = vi.fn(async (_options: { agentId: string; path: string }) => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    }));
    const relayCapableClient = { ...client, downloadFileBytes };
    const { result, rerender } = renderHook(
      ({ entries }: { entries: timeline.TranscriptEntry[] }) =>
        useAttachmentImageResolver({
          client: relayCapableClient,
          agentId: "agent-1",
          downloadOrigin: null,
          entries,
        }),
      { initialProps: { entries: [userMessage("m1", [theImage])] } },
    );

    await waitFor(() => {
      expect(result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 })).toBe(
        "data:image/png;base64,AQID",
      );
    }, SETTLE_WAIT);
    // The token path is never touched on relay: the chunk loop is the
    // only request, addressed by agentId (no cwd), exactly once.
    expect(calls).toEqual([]);
    expect(downloadFileBytes).toHaveBeenCalledTimes(1);
    expect(downloadFileBytes).toHaveBeenCalledWith({ agentId: "agent-1", path: theImage.path });

    // A re-render with the identical image paths must not re-request an
    // already-resolved path.
    rerender({ entries: [userMessage("m1", [theImage]), userMessage("m2")] });
    await waitFor(() => {
      expect(downloadFileBytes).toHaveBeenCalledTimes(1);
    }, SETTLE_WAIT);
  });

  it("relay images prefer the chunk loop's MIME type but fall back to the timeline ref's own when the daemon omits it", async () => {
    const theImage = image({ mimeType: "image/jpeg" });
    const { client } = fakeClient(() => ({
      token: "tok_1",
      mimeType: "image/png",
      error: null,
    }));
    const relayCapableClient = {
      ...client,
      downloadFileBytes: vi.fn(async () => ({ bytes: new Uint8Array([255]) })),
    };
    const { result } = renderHook(() =>
      useAttachmentImageResolver({
        client: relayCapableClient,
        agentId: "agent-1",
        downloadOrigin: null,
        entries: [userMessage("m1", [theImage])],
      }),
    );

    await waitFor(() => {
      expect(result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 })).toBe(
        "data:image/jpeg;base64,/w==",
      );
    }, SETTLE_WAIT);
  });

  it("relay images stay on the reference-card fallback when the client has no chunk-loop method (old daemon), and no token is requested either", async () => {
    const theImage = image();
    const { client, calls } = fakeClient(() => ({
      token: "tok_1",
      mimeType: "image/png",
      error: null,
    }));
    const { result } = renderHook(() =>
      useAttachmentImageResolver({
        client,
        agentId: "agent-1",
        downloadOrigin: null,
        entries: [userMessage("m1", [theImage])],
      }),
    );

    // Let any wrongly-kicked-off request settle, then prove nothing was
    // requested at all — neither a token nor a chunk-loop read: with no
    // direct origin and no chunk method there is nowhere to read from.
    await waitFor(() => expect(calls).toEqual([]), SETTLE_WAIT);
    expect(
      result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 }),
    ).toBeUndefined();
  });

  it("a rejected relay chunk read leaves the image unresolved forever (old-daemon wire rejection is the same fallback, never retried)", async () => {
    const theImage = image();
    const { client } = fakeClient(() => ({
      token: "tok_1",
      mimeType: "image/png",
      error: null,
    }));
    const downloadFileBytes = vi.fn(async () => {
      throw new Error("Unknown message type");
    });
    const relayCapableClient = { ...client, downloadFileBytes };
    const { result, rerender } = renderHook(
      ({ entries }: { entries: timeline.TranscriptEntry[] }) =>
        useAttachmentImageResolver({
          client: relayCapableClient,
          agentId: "agent-1",
          downloadOrigin: null,
          entries,
        }),
      { initialProps: { entries: [userMessage("m1", [theImage])] } },
    );

    await waitFor(() => expect(downloadFileBytes).toHaveBeenCalledTimes(1), SETTLE_WAIT);
    expect(
      result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 }),
    ).toBeUndefined();

    rerender({ entries: [userMessage("m1", [theImage])] });
    await waitFor(() => {
      expect(downloadFileBytes).toHaveBeenCalledTimes(1);
    }, SETTLE_WAIT);
  });

  it("resolves a real fetchable URL once the token request settles, and never requests the same path twice", async () => {
    const theImage = image();
    const { client, calls } = fakeClient(() => ({
      token: "tok_1",
      mimeType: "image/png",
      error: null,
    }));
    const { result, rerender } = renderHook(
      ({ entries }: { entries: timeline.TranscriptEntry[] }) =>
        useAttachmentImageResolver({
          client,
          agentId: "agent-1",
          downloadOrigin: "http://127.0.0.1:6767",
          entries,
        }),
      { initialProps: { entries: [userMessage("m1", [theImage])] } },
    );

    await waitFor(() => {
      expect(result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 })).toBe(
        "http://127.0.0.1:6767/api/files/download?token=tok_1",
      );
    }, SETTLE_WAIT);
    expect(calls).toEqual([theImage.path]);

    // A re-render with the identical set of image paths (the common case
    // while streaming: entries is a fresh array every tick, the image
    // list within it is not) must not re-request an already-resolved
    // path.
    rerender({ entries: [userMessage("m1", [theImage]), userMessage("m2")] });
    await waitFor(() => {
      expect(calls).toEqual([theImage.path]);
    }, SETTLE_WAIT);
  });

  it("leaves an image unresolved forever (never retried) when the daemon returns no token", async () => {
    const theImage = image();
    const { client, calls } = fakeClient(() => ({
      token: null,
      mimeType: null,
      error: "Attachment not found",
    }));
    const { result, rerender } = renderHook(
      ({ entries }: { entries: timeline.TranscriptEntry[] }) =>
        useAttachmentImageResolver({
          client,
          agentId: "agent-1",
          downloadOrigin: "http://127.0.0.1:6767",
          entries,
        }),
      { initialProps: { entries: [userMessage("m1", [theImage])] } },
    );

    await waitFor(() => {
      expect(calls).toEqual([theImage.path]);
    }, SETTLE_WAIT);
    expect(
      result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 }),
    ).toBeUndefined();

    rerender({ entries: [userMessage("m1", [theImage])] });
    await waitFor(() => {
      expect(calls).toEqual([theImage.path]);
    }, SETTLE_WAIT);
  });

  it("resets its cache and re-requests when downloadOrigin changes (a reconnect / relay<->direct switch)", async () => {
    const theImage = image();
    const { client, calls } = fakeClient(() => ({
      token: "tok_2",
      mimeType: "image/png",
      error: null,
    }));
    const { result, rerender } = renderHook(
      ({ downloadOrigin }: { downloadOrigin: string | null }) =>
        useAttachmentImageResolver({
          client,
          agentId: "agent-1",
          downloadOrigin,
          entries: [userMessage("m1", [theImage])],
        }),
      { initialProps: { downloadOrigin: "http://127.0.0.1:6767" } },
    );

    await waitFor(() => {
      expect(calls).toEqual([theImage.path]);
    }, SETTLE_WAIT);

    rerender({ downloadOrigin: "http://127.0.0.1:7000" });
    await waitFor(() => {
      expect(calls).toEqual([theImage.path, theImage.path]);
    }, SETTLE_WAIT);
    await waitFor(() => {
      expect(result.current(theImage, { entryId: "m1", speaker: "user", index: 0, total: 1 })).toBe(
        "http://127.0.0.1:7000/api/files/download?token=tok_2",
      );
    }, SETTLE_WAIT);
  });
});
