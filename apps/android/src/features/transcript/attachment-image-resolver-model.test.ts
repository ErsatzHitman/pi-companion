import { describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import {
  applyResolvedAttachmentImage,
  buildAttachmentDownloadUrl,
  collectTimelineImages,
} from "./attachment-image-resolver-model";

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
