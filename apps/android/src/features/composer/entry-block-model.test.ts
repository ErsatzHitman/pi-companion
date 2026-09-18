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
    // P10-GATE: was `accent-tint`, which came from the stale
    // reconstruction. The design artifact declares `--usr-bg:var(--field)`
    // and `.blk.usr{background:var(--usr-bg)}`, so the user block paints
    // on `field`; `accent-tint` appears nowhere in it.
    expect(entryBlockSurface("sent")).toBe("field");
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
  // CORRECTED: this case used to be "rings a still-pending block in the
  // artifact's `line` hairline" and expected `"line"`. The confirmed
  // spec draws no ring, shadow, or border on `.blk` in any state — see
  // `blockRing`'s own doc comment in `block-shape.ts` — so a pending
  // entry now renders with no ring at all, the same as every other
  // status.
  it("draws no ring on a pending block — the confirmed spec rings nothing", () => {
    expect(entryBlockRing("pending")).toBeNull();
  });

  it("leaves the user's own tinted block unringed too — no `.blk` state has one", () => {
    expect(entryBlockRing("sent")).toBeNull();
  });

  it("leaves the failed block's one border to the red outline", () => {
    expect(entryBlockRing("failed")).toBeNull();
    expect(entryBlockIsOutlined("failed")).toBe(true);
  });

  it("rings no status at all — the ring is gone, not selectively applied", () => {
    for (const status of EVERY_STATUS) {
      expect(entryBlockRing(status)).toBeNull();
    }
  });
});

describe("block geometry", () => {
  it("carries the artifact's own `.blk` numbers, not approximations", () => {
    // CORRECTED: padding-horizontal and gap were `11`/`9`, quoting
    // docs/ui-reference/pi-companion-app.html's stale reconstruction —
    // see block-shape.ts's own corrected doc comments for the confirmed
    // spec's real `padding: 9px 12px; margin: 10px 0`.
    expect(ENTRY_BLOCK_RADIUS).toBe(14);
    expect(ENTRY_BLOCK_PADDING_VERTICAL).toBe(9);
    expect(ENTRY_BLOCK_PADDING_HORIZONTAL).toBe(12);
    expect(ENTRY_BLOCK_GAP).toBe(10);
  });
});
