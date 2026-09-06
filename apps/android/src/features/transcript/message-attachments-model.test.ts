import { describe, expect, it } from "vitest";
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

import {
  MAX_IMAGES_PER_ENTRY,
  MAX_INLINE_IMAGE_BYTES,
  accessibleImageName,
  boundImages,
  formatImageKind,
  formatImageSize,
  imageAttachmentViewModel,
  imageGroupAccessibilityLabel,
  type AttachmentImageContext,
} from "./message-attachments-model";

function ctx(overrides: Partial<AttachmentImageContext> = {}): AttachmentImageContext {
  return { entryId: "entry-1", speaker: "user", index: 0, total: 1, ...overrides };
}

describe("formatImageSize", () => {
  it("formats sub-KB counts in bytes", () => {
    expect(formatImageSize(340)).toBe("340 B");
    expect(formatImageSize(0)).toBe("0 B");
  });

  it("formats KB with one decimal under 10, none at/above 10", () => {
    expect(formatImageSize(9 * 1024)).toBe("9.0 KB");
    expect(formatImageSize(51_200)).toBe("50 KB");
  });

  it("steps up through MB/GB", () => {
    expect(formatImageSize(2_000_000)).toBe("1.9 MB");
    expect(formatImageSize(2_147_483_648)).toBe("2.0 GB");
  });
});

describe("formatImageKind", () => {
  it("maps a recognized image/* MIME type to '<SUBTYPE> image'", () => {
    expect(formatImageKind("image/png")).toBe("PNG image");
    expect(formatImageKind("image/svg+xml")).toBe("SVG image");
  });

  it("falls back to the raw MIME type for anything unrecognized, never a blank label", () => {
    expect(formatImageKind("application/octet-stream")).toBe("application/octet-stream");
    expect(formatImageKind("")).toBe("Image");
    expect(formatImageKind("   ")).toBe("Image");
  });
});

describe("accessibleImageName: the no-alt-text case", () => {
  it("announces speaker, kind, and size even though AgentTimelineImageRef carries no alt text or filename", () => {
    const name = accessibleImageName(ctx({ speaker: "assistant" }), "PNG image", "47.1 KB");
    expect(name).toBe("Pi attached an image: PNG image, 47.1 KB");
  });

  it("announces a 1-of-N position when part of a multi-image group", () => {
    const name = accessibleImageName(
      ctx({ speaker: "user", index: 1, total: 3 }),
      "JPEG image",
      "1 MB",
    );
    expect(name).toBe("You attached an image (2 of 3): JPEG image, 1 MB");
  });

  it("omits the size clause entirely when no size is known — never a misleading placeholder", () => {
    const name = accessibleImageName(ctx(), "PNG image", null);
    expect(name).toBe("You attached an image: PNG image");
  });
});

describe("imageAttachmentViewModel: oversized-payload boundary", () => {
  const context = ctx({ speaker: "assistant" });

  function image(bytes: number): AgentTimelineImageRef {
    return { mimeType: "image/png", path: "/tmp/paseo-attachments-x/a.png", bytes };
  }

  it("is not oversized at exactly MAX_INLINE_IMAGE_BYTES", () => {
    const model = imageAttachmentViewModel(image(MAX_INLINE_IMAGE_BYTES), context);
    expect(model.oversized).toBe(false);
    expect(model.note).toBe("A preview isn't available for this image in this client yet.");
  });

  it("is oversized exactly one byte past MAX_INLINE_IMAGE_BYTES, with a named, visible reason", () => {
    const model = imageAttachmentViewModel(image(MAX_INLINE_IMAGE_BYTES + 1), context);
    expect(model.oversized).toBe(true);
    expect(model.note).toContain("exceeds the");
    expect(model.note).toContain(formatImageSize(MAX_INLINE_IMAGE_BYTES));
  });

  it("is never oversized when bytes is unknown (undefined never compares > a number as true)", () => {
    const model = imageAttachmentViewModel(
      { mimeType: "image/png", path: "/tmp/x/a.png" },
      context,
    );
    expect(model.oversized).toBe(false);
    expect(model.sizeLabel).toBeNull();
  });

  it("never leaks the daemon-local temp path into the accessible name or note", () => {
    const model = imageAttachmentViewModel(image(1000), context);
    expect(model.name).not.toContain("/tmp/");
    expect(model.note).not.toContain("/tmp/");
  });

  it("sets a stable positional key derived from entryId and index", () => {
    const model = imageAttachmentViewModel(image(10), ctx({ entryId: "e-9", index: 2 }));
    expect(model.key).toBe("e-9-image-2");
  });
});

describe("boundImages: attachment-count boundary", () => {
  function images(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  it("hides nothing at exactly MAX_IMAGES_PER_ENTRY", () => {
    const result = boundImages(images(MAX_IMAGES_PER_ENTRY));
    expect(result.visible).toHaveLength(MAX_IMAGES_PER_ENTRY);
    expect(result.hiddenCount).toBe(0);
  });

  it("hides exactly one image one past MAX_IMAGES_PER_ENTRY", () => {
    const result = boundImages(images(MAX_IMAGES_PER_ENTRY + 1));
    expect(result.visible).toHaveLength(MAX_IMAGES_PER_ENTRY);
    expect(result.hiddenCount).toBe(1);
  });

  it("bounds a pathological count (200 images) to the same cap, never rendering them all", () => {
    const result = boundImages(images(200));
    expect(result.visible).toHaveLength(MAX_IMAGES_PER_ENTRY);
    expect(result.hiddenCount).toBe(200 - MAX_IMAGES_PER_ENTRY);
  });
});

describe("imageGroupAccessibilityLabel", () => {
  it("pluralizes correctly at the 1/2 boundary and names the speaker", () => {
    expect(imageGroupAccessibilityLabel("user", 1)).toBe("You attached 1 image");
    expect(imageGroupAccessibilityLabel("assistant", 2)).toBe("Pi attached 2 images");
  });
});
