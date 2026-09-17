import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level contract for `Chip.tsx`, in the shape `Toggle.test.ts` and
 * `Sheet.test.ts` already use: the primitive imports `react-native`, so it
 * cannot render under this workspace's plain `vitest` setup, and
 * `readCode()` strips comments first, so a claim made only in a doc comment
 * can never satisfy an assertion.
 *
 * Added at the P10-W3 merge gate. `A-SIZE` moved `CHIP_HEIGHT` from 24 to
 * the confirmed Android design's `.chip{height:30px}` and
 * `CHIP_PADDING_HORIZONTAL` to its `padding:0 13px`, and named both — but
 * nothing pinned either one, so both could have drifted back silently. That
 * is the same "a spec number with no test that could fail" gap this wave was
 * briefed to close, and it survived only because `A-SIZE`'s exclusive file
 * list named no test for this primitive.
 *
 * `touch-targets.test.ts` does NOT close it, which was checked rather than
 * assumed: its runtime check is a hit-area FLOOR (the chip's height plus its
 * vertical hit slop must clear 48dp), so it would keep passing if
 * `CHIP_HEIGHT` silently returned to 24.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Chip.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Chip: box metrics match the confirmed Android design's own .chip", () => {
  it("declares CHIP_HEIGHT as 30", () => {
    expect(readCode()).toMatch(/const CHIP_HEIGHT = 30;/);
  });

  it("declares CHIP_PADDING_HORIZONTAL as 13", () => {
    expect(readCode()).toMatch(/const CHIP_PADDING_HORIZONTAL = 13;/);
  });

  it("spends both constants on the chip box rather than re-typing the numbers", () => {
    const code = readCode();
    expect(code).toMatch(/height:\s*CHIP_HEIGHT/);
    expect(code).toMatch(/paddingHorizontal:\s*CHIP_PADDING_HORIZONTAL/);
    // The pre-A-SIZE values, so a revert to either is a failure and not a
    // silent pass: 24 was the old height, and the old padding came from the
    // shared spacing scale rather than from a named constant.
    expect(code).not.toMatch(/height:\s*24\b/);
    expect(code).not.toMatch(/paddingHorizontal:\s*theme\.spacing\[2\]/);
  });

  it("keeps the full-pill radius the design draws, which A-SIZE did not change", () => {
    // `.chip{...border-radius:var(--r-full)}`. This was already correct
    // before A-SIZE and is pinned here so a size change can never quietly
    // take the radius with it.
    expect(readCode()).toMatch(/borderRadius:\s*theme\.radii\.full/);
  });
});
