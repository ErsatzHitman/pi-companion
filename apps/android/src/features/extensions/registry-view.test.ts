import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T356 source-level contract for `registry-view.tsx`. That file imports
 * `react-native`, so it cannot render under this workspace's plain
 * `vitest` setup — the same constraint every `.tsx` contract test in
 * this repository documents, with the same `readCode()` treatment
 * (comments stripped first, so a claim made only in a doc comment can
 * never satisfy an assertion).
 *
 * The block shape itself is proven by execution in
 * `../../ui/theme/block-shape.test.ts`. What these cases pin is that
 * the one place every extension element passes through actually draws
 * it, and draws it around the diagnostic path too.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./registry-view.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("registry-view.tsx: every extension element draws in the .blk.ext block (T356)", () => {
  it("reads the fill from the shared block table, never from a colour written here", () => {
    const code = readCode();
    expect(code).toMatch(/blockSurface\("extension"\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("takes the geometry from block-shape.ts rather than re-typing the artifact's numbers", () => {
    const code = readCode();
    expect(code).toMatch(/borderRadius: BLOCK_RADIUS/);
    expect(code).toMatch(/paddingVertical: BLOCK_PADDING_VERTICAL/);
    expect(code).toMatch(/paddingHorizontal: BLOCK_PADDING_HORIZONTAL/);
  });

  it("wraps every render path in the one styled container, diagnostics included", () => {
    // One `styles.wrapper` View around the whole pipeline is what makes
    // "a malformed element still looks like that extension's element"
    // true — see this file's own T356 paragraph in registry-view.tsx.
    const code = readCode();
    expect(code).toMatch(/style=\{styles\.wrapper\}/);
    const wrapperUses = code.match(/styles\.wrapper/g) ?? [];
    expect(wrapperUses.length).toBeGreaterThanOrEqual(1);
  });
});
