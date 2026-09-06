import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `message-row.tsx` imports `react-native` (via `../../ui/recipes`'s
 * `StreamingMessage`), which cannot be rendered under this workspace's
 * plain `vitest` setup — see `./transcript-accessibility.test.ts`'s doc
 * comment for the identical constraint and the `readCode()` pattern this
 * file copies. All real logic (`speakerFor`, `boundedText`,
 * `areMessageRowPropsEqual`) already has render-free proof in
 * `./message-row-model.test.ts`; this file only proves the .tsx actually
 * wires that logic into the render tree and the `memo` boundary, rather
 * than, say, silently duplicating or dropping it.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./message-row.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("message-row.tsx: composes StreamingMessage from the model's mapping, not a private one", () => {
  it("passes speakerFor(entry) as the speaker prop", () => {
    expect(readCode()).toMatch(/speaker=\{speakerFor\(entry\)\}/);
  });

  it("passes boundedText(entry.text) as the text prop, not entry.text directly", () => {
    expect(readCode()).toMatch(/text=\{boundedText\(entry\.text\)\}/);
  });

  it("forwards the streaming prop unchanged", () => {
    expect(readCode()).toMatch(/streaming=\{streaming\}/);
  });
});

describe("message-row.tsx: memoized on the model's comparator", () => {
  it("wraps the row in memo(..., areMessageRowPropsEqual) — never a bare memo() with default shallow-prop comparison", () => {
    expect(readCode()).toMatch(
      /export const TranscriptMessageRow = memo\(\s*TranscriptMessageRowImpl,\s*areMessageRowPropsEqual,?\s*\)/,
    );
  });
});

describe("message-row.tsx: T33A5 renders entry.images via MessageAttachments", () => {
  it("composes MessageAttachments with the entry's images, entryId, and speaker", () => {
    const source = readCode();
    expect(source).toMatch(/<MessageAttachments\b/);
    expect(source).toMatch(/images=\{images\}/);
    expect(source).toMatch(/entryId=\{entry\.id\}/);
    expect(source).toMatch(/speaker=\{speakerFor\(entry\)\}/);
  });

  it("derives images from entry.images with a safe fallback (never crashes on an entry with no images)", () => {
    expect(readCode()).toMatch(/const images = entry\.images \?\? \[\]/);
  });
});
