import { describe, expect, it } from "vitest";

import {
  COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED,
  COMPOSER_SLOT_MAX_WINDOW_SHARE_BESIDE_PINNED,
  resolveComposerSlotMaxHeightDp,
  resolveComposerSlotMinHeight,
} from "./composer-slot-cap-model";

describe("resolveComposerSlotMaxHeightDp", () => {
  it("does not cap the composer at all while nothing is pinned", () => {
    expect(
      resolveComposerSlotMaxHeightDp({ windowHeightDp: 873, liveExtensionOccupied: false }),
    ).toBeUndefined();
  });

  it("takes the window share on a tall window, so the cap scales with the screen", () => {
    // 873dp is the emulator Maestro run 34502151872 measured (2400px at
    // density 2.75): the share binds well below the 320dp ceiling.
    expect(
      resolveComposerSlotMaxHeightDp({ windowHeightDp: 873, liveExtensionOccupied: true }),
    ).toBe(Math.round(873 * COMPOSER_SLOT_MAX_WINDOW_SHARE_BESIDE_PINNED));
    expect(
      resolveComposerSlotMaxHeightDp({ windowHeightDp: 873, liveExtensionOccupied: true }),
    ).toBeLessThan(COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED);
  });

  it("takes the dp ceiling on a very tall window, rather than a third of it", () => {
    expect(
      resolveComposerSlotMaxHeightDp({ windowHeightDp: 2000, liveExtensionOccupied: true }),
    ).toBe(COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED);
  });

  it("frees enough of the emulator's window for the pinned area to uncover a panel's sections", () => {
    // The shard-4 geometry, in dp at density 2.75: a 2138px shell is
    // 777dp, of which the header and status strip took 154dp and the
    // composer took 402dp, leaving the pinned area 221dp for ~319dp of
    // content. With the cap the composer cannot exceed this, so the
    // pinned area is left strictly more than its own content needs.
    const cap = resolveComposerSlotMaxHeightDp({
      windowHeightDp: 873,
      liveExtensionOccupied: true,
    });
    expect(cap).toBeDefined();
    const pinnedAreaRoom = 777 - 154 - (cap ?? 0);
    expect(pinnedAreaRoom).toBeGreaterThan(319);
  });

  it("falls back to the dp ceiling rather than a fraction of a bad window measurement", () => {
    for (const windowHeightDp of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveComposerSlotMaxHeightDp({ windowHeightDp, liveExtensionOccupied: true })).toBe(
        COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED,
      );
    }
  });

  it("caps the composer less hard than the pinned area's own share, so the pinned area wins the contest", () => {
    expect(COMPOSER_SLOT_MAX_WINDOW_SHARE_BESIDE_PINNED).toBeLessThan(0.45);
  });
});

describe("resolveComposerSlotMinHeight", () => {
  it("is the composer's measured floor plus the slot's own padding", () => {
    expect(resolveComposerSlotMinHeight({ contentMinHeight: 459, verticalPadding: 24 })).toBe(483);
  });

  it("has no floor until the composer has reported a measurement", () => {
    expect(
      resolveComposerSlotMinHeight({ contentMinHeight: 0, verticalPadding: 24 }),
    ).toBeUndefined();
    expect(
      resolveComposerSlotMinHeight({ contentMinHeight: Number.NaN, verticalPadding: 24 }),
    ).toBeUndefined();
    expect(
      resolveComposerSlotMinHeight({ contentMinHeight: -10, verticalPadding: 24 }),
    ).toBeUndefined();
  });

  it("tolerates a missing padding rather than poisoning the floor", () => {
    expect(
      resolveComposerSlotMinHeight({ contentMinHeight: 459, verticalPadding: Number.NaN }),
    ).toBe(459);
  });

  it("keeps the prompt bar whenever the cap is shorter than the floor, because minHeight wins", () => {
    // A short window caps hard: 0.32 x 500dp is 160dp, below the ~191dp
    // the composer's unshrinkable parts need. Yoga resolves that conflict
    // in favour of minHeight, so the floor is what the slot actually gets
    // — this test pins the arithmetic that makes that conflict possible
    // and deliberate rather than accidental.
    const cap = resolveComposerSlotMaxHeightDp({
      windowHeightDp: 500,
      liveExtensionOccupied: true,
    });
    const floor = resolveComposerSlotMinHeight({ contentMinHeight: 191, verticalPadding: 24 });
    expect(cap).toBe(160);
    expect(floor).toBe(215);
    expect(floor).toBeGreaterThan(cap ?? 0);
  });
});
