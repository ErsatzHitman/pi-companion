import { describe, expect, it } from "vitest";

import {
  BLOCK_GAP,
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockOutline,
  blockSurface,
  type BlockKind,
} from "./block-shape.js";

/**
 * T356: the shared `.blk` shape. RN-free, so every case runs the real
 * function.
 */

const EVERY_KIND: readonly BlockKind[] = [
  "user",
  "assistant",
  "pending",
  "tool-ok",
  "tool-error",
  "extension",
];

describe("blockSurface", () => {
  it("gives each filled kind the token role the design names for it", () => {
    expect(blockSurface("user")).toBe("field");
    expect(blockSurface("pending")).toBe("inset");
    expect(blockSurface("tool-ok")).toBe("tool-success-bg");
    expect(blockSurface("tool-error")).toBe("tool-error-bg");
    expect(blockSurface("extension")).toBe("extension-bg");
  });

  it("leaves the model's own prose unfilled, so the boxes keep their contrast", () => {
    expect(blockSurface("assistant")).toBeNull();
  });

  it("never returns two kinds the same fill — no two block kinds look alike", () => {
    const filled = EVERY_KIND.map(blockSurface).filter((surface) => surface !== null);
    expect(new Set(filled).size).toBe(filled.length);
  });

  it("names only token roles, never a colour literal", () => {
    for (const kind of EVERY_KIND) {
      const surface = blockSurface(kind);
      if (surface !== null) expect(surface).not.toMatch(/#|rgb/);
    }
  });
});

describe("blockOutline", () => {
  it("outlines only the block that needs an action from the reader", () => {
    expect(blockOutline("tool-error")).toBe("red");
    for (const kind of EVERY_KIND.filter((candidate) => candidate !== "tool-error")) {
      expect(blockOutline(kind)).toBeNull();
    }
  });
});

describe("block geometry", () => {
  it("carries the artifact's own `.blk` numbers, not approximations", () => {
    expect(BLOCK_RADIUS).toBe(14);
    expect(BLOCK_PADDING_VERTICAL).toBe(9);
    expect(BLOCK_PADDING_HORIZONTAL).toBe(12);
    expect(BLOCK_GAP).toBe(10);
  });
});
