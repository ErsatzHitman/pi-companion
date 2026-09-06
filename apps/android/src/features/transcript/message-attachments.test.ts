import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `message-attachments.tsx` imports `react-native`, which cannot be
 * rendered under this workspace's plain `vitest` setup — see
 * `./transcript-accessibility.test.ts`'s doc comment for the identical
 * constraint and the `readCode()` pattern this file copies. All real
 * logic (accessible naming, oversized/count bounding) already has
 * render-free proof in `./message-attachments-model.test.ts`; this file
 * only proves the .tsx actually wires that logic into the render tree —
 * the accessible name onto the container, the oversized case skipping
 * the resolver, and the bounded-count truncation notice — rather than
 * silently duplicating or bypassing it.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./message-attachments.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("message-attachments.tsx: accessible names, not colour/icon alone", () => {
  it("sets the whole attachment group's accessibilityLabel from imageGroupAccessibilityLabel", () => {
    expect(readCode()).toMatch(/accessibilityLabel=\{groupLabel\}/);
    expect(readCode()).toMatch(
      /const groupLabel = imageGroupAccessibilityLabel\(speaker, images\.length\)/,
    );
  });

  it("sets each image/attachment card's accessibilityLabel from the model's accessible name, not a filename or blank", () => {
    expect(readCode()).toMatch(/accessibilityLabel=\{model\.name\}/);
  });
});

describe("message-attachments.tsx: bounded by MAX_IMAGES_PER_ENTRY, visibly", () => {
  it("slices the images through boundImages rather than rendering the raw array", () => {
    expect(readCode()).toMatch(/boundImages\(images, MAX_IMAGES_PER_ENTRY\)/);
  });

  it("renders a visible, named count of what was hidden when hiddenCount > 0", () => {
    const source = readCode();
    expect(source).toMatch(/hiddenCount > 0/);
    expect(source).toMatch(/more image\{hiddenCount === 1 \? "" : "s"\} not shown/);
  });
});

describe("message-attachments.tsx: an oversized image never reaches the resolver", () => {
  it("gates the resolveImageUri call on model.oversized being false", () => {
    expect(readCode()).toMatch(
      /const uri = model\.oversized \? undefined : resolveImageUri\?\.\(image, context\)/,
    );
  });
});

describe("message-attachments.tsx: returns null for an entry with no images", () => {
  it("short-circuits on images.length === 0 so callers can render this unconditionally", () => {
    const source = readCode();
    expect(source).toMatch(/if \(images\.length === 0\) \{/);
    expect(source).toMatch(/return null;/);
  });
});
