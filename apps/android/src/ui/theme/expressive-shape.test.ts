import { describe, expect, it } from "vitest";

import { BLOCK_RADIUS } from "./block-shape.js";
import {
  EXPRESSIVE_RADII,
  EXPRESSIVE_RADIUS_BLK,
  EXPRESSIVE_RADIUS_FULL,
  EXPRESSIVE_RADIUS_LG,
  EXPRESSIVE_RADIUS_MD,
  EXPRESSIVE_RADIUS_SM,
  EXPRESSIVE_RADIUS_XS,
  type ExpressiveRadiusToken,
} from "./expressive-shape.js";

/**
 * A-SHAPE: the Android-only MD3 Expressive radius scale. RN-free, so
 * every case runs the real module rather than reading its source text.
 */

describe("expressive radius constants", () => {
  it("carry the design artifact's own --r-* values, not approximations", () => {
    // Copied from the artifact's `:root` block, independently of
    // whatever `expressive-shape.ts` currently declares — a retune of
    // any one constant fails exactly this line.
    expect(EXPRESSIVE_RADIUS_XS).toBe(10);
    expect(EXPRESSIVE_RADIUS_SM).toBe(16);
    expect(EXPRESSIVE_RADIUS_MD).toBe(22);
    expect(EXPRESSIVE_RADIUS_LG).toBe(28);
    expect(EXPRESSIVE_RADIUS_FULL).toBe(9999);
    expect(EXPRESSIVE_RADIUS_BLK).toBe(14);
  });

  it("keeps every point on the scale distinct except the documented blk/window overlap", () => {
    // xs/sm/md/lg/full must all differ from one another — if a future
    // edit accidentally collapses two points to the same number, the
    // scale silently stops being a scale.
    const points = [
      EXPRESSIVE_RADIUS_XS,
      EXPRESSIVE_RADIUS_SM,
      EXPRESSIVE_RADIUS_MD,
      EXPRESSIVE_RADIUS_LG,
      EXPRESSIVE_RADIUS_FULL,
    ];
    expect(new Set(points).size).toBe(points.length);
  });

  it("never diverges from block-shape's own BLOCK_RADIUS for the one shared point", () => {
    // `--r-blk` is documented as equal to the shared `window:14` alias,
    // which `block-shape.ts` already owns as `BLOCK_RADIUS`. Read it
    // directly here rather than trusting the literal `14` above: if
    // `expressive-shape.ts` is ever edited to hardcode a second, drifted
    // copy of that number instead of importing it, this fails even
    // though the constant-vs-literal check above would still pass.
    expect(EXPRESSIVE_RADIUS_BLK).toBe(BLOCK_RADIUS);
  });
});

describe("EXPRESSIVE_RADII mapping", () => {
  const EVERY_TOKEN: readonly ExpressiveRadiusToken[] = ["xs", "sm", "md", "lg", "full", "blk"];

  it("exposes exactly the artifact's six token names, no more and no fewer", () => {
    expect(Object.keys(EXPRESSIVE_RADII).sort()).toEqual([...EVERY_TOKEN].sort());
  });

  it("agrees with each individual constant — the mapping is not a second, independent source", () => {
    expect(EXPRESSIVE_RADII.xs).toBe(EXPRESSIVE_RADIUS_XS);
    expect(EXPRESSIVE_RADII.sm).toBe(EXPRESSIVE_RADIUS_SM);
    expect(EXPRESSIVE_RADII.md).toBe(EXPRESSIVE_RADIUS_MD);
    expect(EXPRESSIVE_RADII.lg).toBe(EXPRESSIVE_RADIUS_LG);
    expect(EXPRESSIVE_RADII.full).toBe(EXPRESSIVE_RADIUS_FULL);
    expect(EXPRESSIVE_RADII.blk).toBe(EXPRESSIVE_RADIUS_BLK);
  });
});
