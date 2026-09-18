import { describe, expect, it } from "vitest";

import {
  BLOCK_GAP,
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockOutline,
  blockRing,
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

describe("blockRing", () => {
  it("is always null: the confirmed spec draws no ring, shadow, or border on .blk, in any state", () => {
    // CORRECTED: this used to expect "line" for every filled kind except
    // "user" (pending, tool-ok, extension), quoting `.blk`'s
    // `box-shadow: var(--sh-hairline)` as the reason. That rule, and the
    // `--sh-hairline` token it names, exist only in
    // docs/ui-reference/pi-companion-app.html's stale reconstruction —
    // `grep -c -- '--sh-hairline'` returns 9 there and 0 over the
    // confirmed spec. See block-shape.ts's own `blockRing` doc comment
    // for the full correction.
    for (const kind of EVERY_KIND) {
      expect(blockRing(kind)).toBeNull();
    }
  });

  it("leaves the error block's one border to blockOutline, which already claims it in red", () => {
    expect(blockRing("tool-error")).toBeNull();
    expect(blockOutline("tool-error")).toBe("red");
  });
});

describe("block geometry", () => {
  it("carries the confirmed spec's own `.blk` numbers, not the stale reconstruction's", () => {
    // android-spec.html: `.blk{border-radius:var(--r-blk);padding:9px
    // 12px;margin:10px 0}`, `--r-blk:14px`. (CORRECTED: this pinned
    // BLOCK_PADDING_HORIZONTAL at 11 and BLOCK_GAP at 9, both quoting
    // docs/ui-reference/pi-companion-app.html's stale `.blk { padding:
    // 9px 11px }` / `.t { gap: 9px }` instead. See block-shape.ts's
    // module doc comment for the full correction.)
    expect(BLOCK_RADIUS).toBe(14);
    expect(BLOCK_PADDING_VERTICAL).toBe(9);
    expect(BLOCK_PADDING_HORIZONTAL).toBe(12);
    expect(BLOCK_GAP).toBe(10);
  });
});
