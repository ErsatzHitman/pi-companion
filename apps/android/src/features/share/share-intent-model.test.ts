import { describe, expect, it } from "vitest";

import {
  ACCEPTED_FILE_MIME_TYPES,
  MAX_SHARE_FILE_BYTES,
  classifyShareIntent,
  type RawShareIntent,
  type RawShareIntentFile,
} from "./share-intent-model";

function textIntent(text: string, mimeType = "text/plain"): RawShareIntent {
  return { action: "SEND", mimeType, text };
}

function fileIntent(overrides: Partial<RawShareIntentFile> = {}): RawShareIntent {
  return {
    action: "SEND",
    mimeType: overrides.mimeType ?? "image/png",
    file: {
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      uri: "content://com.example/photo.png",
      ...overrides,
    },
  };
}

describe("classifyShareIntent — accepted allowlist", () => {
  it("accepts plain text", () => {
    const result = classifyShareIntent(textIntent("hello from another app"));
    expect(result).toEqual({
      accepted: true,
      content: { kind: "text", text: "hello from another app", looksSecretShaped: false },
    });
  });

  it("classifies a bare http(s) URL as kind 'url', not 'text'", () => {
    const result = classifyShareIntent(textIntent("https://example.com/a/b?c=1"));
    expect(result).toEqual({
      accepted: true,
      content: { kind: "url", url: "https://example.com/a/b?c=1" },
    });
  });

  it("does not classify text merely containing a URL as kind 'url'", () => {
    const result = classifyShareIntent(textIntent("check this out: https://example.com"));
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.content.kind).toBe("text");
  });

  it("accepts every listed file MIME type", () => {
    for (const mimeType of ACCEPTED_FILE_MIME_TYPES) {
      const result = classifyShareIntent(fileIntent({ mimeType }));
      expect(result.accepted, `expected ${mimeType} to be accepted`).toBe(true);
    }
  });

  it("accepts a file exactly at the size bound", () => {
    const result = classifyShareIntent(fileIntent({ sizeBytes: MAX_SHARE_FILE_BYTES }));
    expect(result.accepted).toBe(true);
  });

  it("flags secret-shaped text via frontend-core's security helper, without refusing it", () => {
    const result = classifyShareIntent(textIntent("here is my key sk-LIVEKEY1234567890ABCDEF"));
    expect(result.accepted).toBe(true);
    if (result.accepted && result.content.kind === "text") {
      expect(result.content.looksSecretShaped).toBe(true);
    } else {
      throw new Error("expected kind 'text'");
    }
  });
});

describe("classifyShareIntent — refused, not silently dropped", () => {
  it("refuses an unrecognized action as 'unsupported-action', distinct from an unsupported type", () => {
    const result = classifyShareIntent({ action: "SEND_MULTIPLE", mimeType: "text/plain" });
    expect(result).toMatchObject({ accepted: false, reason: "unsupported-action" });
  });

  it("refuses a file whose MIME type is outside the allowlist as 'unsupported-type'", () => {
    const result = classifyShareIntent(fileIntent({ mimeType: "application/octet-stream" }));
    expect(result).toMatchObject({ accepted: false, reason: "unsupported-type" });
  });

  it("refuses a non-text/plain MIME type carrying no file as 'unsupported-type'", () => {
    const result = classifyShareIntent({ action: "SEND", mimeType: "audio/mpeg" });
    expect(result).toMatchObject({ accepted: false, reason: "unsupported-type" });
  });

  it("refuses empty text as 'empty-content', distinct from an unsupported type", () => {
    const result = classifyShareIntent(textIntent("   "));
    expect(result).toMatchObject({ accepted: false, reason: "empty-content" });
  });

  it("refuses an oversized accepted-type file as 'file-too-large' — distinct from 'unsupported-type'", () => {
    const result = classifyShareIntent(fileIntent({ sizeBytes: MAX_SHARE_FILE_BYTES + 1 }));
    expect(result).toMatchObject({ accepted: false, reason: "file-too-large" });
  });

  it("every refusal carries a non-empty user-facing explanation", () => {
    const result = classifyShareIntent({ action: "SEND", mimeType: "audio/mpeg" });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.explanation.length).toBeGreaterThan(0);
    }
  });
});
