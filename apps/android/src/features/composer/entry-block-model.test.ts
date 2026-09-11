import { describe, expect, it } from "vitest";

import {
  ENTRY_BLOCK_GAP,
  ENTRY_BLOCK_PADDING_HORIZONTAL,
  ENTRY_BLOCK_PADDING_VERTICAL,
  ENTRY_BLOCK_RADIUS,
  entryBlockIsOutlined,
  entryBlockRing,
  entryBlockSurface,
} from "./entry-block-model.js";
import type { ComposerEntryStatus } from "./composer-model.js";

/**
 * T355: the composer's entry blocks. RN-free, so every case below runs
 * the real function rather than matching source text.
 */

const EVERY_STATUS: readonly ComposerEntryStatus[] = ["pending", "sent", "failed"];

describe("entryBlockSurface", () => {
  it("gives a sent prompt the artifact's own `.usr` surface", () => {
    expect(entryBlockSurface("sent")).toBe("accent-tint");
  });

  it("gives a still-queued prompt `.pend`, so waiting reads differently from delivered", () => {
    expect(entryBlockSurface("pending")).toBe("inset");
  });

  it("gives a failed prompt the transcript's error surface rather than a fourth one", () => {
    expect(entryBlockSurface("failed")).toBe("tool-error-bg");
  });

  it("returns a distinct surface for every status — no two states look alike", () => {
    const surfaces = EVERY_STATUS.map(entryBlockSurface);
    expect(new Set(surfaces).size).toBe(EVERY_STATUS.length);
  });

  it("names only design-token roles, never a colour literal", () => {
    for (const status of EVERY_STATUS) {
      expect(entryBlockSurface(status)).not.toMatch(/#|rgb/);
    }
  });
});

describe("entryBlockIsOutlined", () => {
  it("outlines the one block that needs an action from the reader", () => {
    expect(entryBlockIsOutlined("failed")).toBe(true);
  });

  it("leaves the other two flat, so the outline keeps meaning something", () => {
    expect(entryBlockIsOutlined("sent")).toBe(false);
    expect(entryBlockIsOutlined("pending")).toBe(false);
  });
});

describe("entryBlockRing", () => {
  it("rings a still-pending block in the artifact's `line` hairline", () => {
    expect(entryBlockRing("pending")).toBe("line");
  });

  it("leaves the user's own tinted block unringed, as `.blk.usr { box-shadow: none }` specifies", () => {
    expect(entryBlockRing("sent")).toBeNull();
  });

  it("leaves the failed block's one border to the red outline", () => {
    expect(entryBlockRing("failed")).toBeNull();
    expect(entryBlockIsOutlined("failed")).toBe(true);
  });
});

describe("block geometry", () => {
  it("carries the artifact's own `.blk` numbers, not approximations", () => {
    expect(ENTRY_BLOCK_RADIUS).toBe(14);
    expect(ENTRY_BLOCK_PADDING_VERTICAL).toBe(9);
    expect(ENTRY_BLOCK_PADDING_HORIZONTAL).toBe(11);
    expect(ENTRY_BLOCK_GAP).toBe(9);
  });
});
