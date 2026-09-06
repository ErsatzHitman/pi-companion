import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  PINNED_AREA_LAYOUT_CONTRACT,
  PINNED_AREA_MAX_HEIGHT_DP,
  resolvePinnedAreaVisibility,
  selectPinnedElements,
} from "./pinned-model";

/**
 * T34A4 — the pinned live-extension area's RN-free decisions. See
 * `pinned-model.ts`'s doc comment for why these two decisions
 * (`selectPinnedElements`/`resolvePinnedAreaVisibility`) are the whole of
 * what a `vitest` run in this workspace can prove about "the pinned area
 * sits above the composer and stays visible while active" and "it
 * collapses only when genuinely empty".
 */

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: overrides.id ?? "el-1",
    ns: overrides.ns ?? "demo",
    kind: overrides.kind ?? "status",
    placement: overrides.placement ?? "pinned",
    ...overrides,
  } as PiUiElement;
}

describe("selectPinnedElements", () => {
  it("keeps only placement: pinned elements", () => {
    const elements = [
      element({ id: "a", placement: "pinned" }),
      element({ id: "b", placement: "status" }),
      element({ id: "c", placement: "inline" }),
      element({ id: "d", placement: "sheet" }),
      element({ id: "e", placement: "screen" }),
      element({ id: "f", placement: "pinned" }),
    ];

    expect(selectPinnedElements(elements).map((el) => el.id)).toEqual(["a", "f"]);
  });

  it("preserves the input's order (stable store order)", () => {
    const elements = [
      element({ id: "z", placement: "pinned" }),
      element({ id: "a", placement: "pinned" }),
      element({ id: "m", placement: "pinned" }),
    ];

    expect(selectPinnedElements(elements).map((el) => el.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty array when nothing is pinned", () => {
    const elements = [
      element({ id: "a", placement: "status" }),
      element({ id: "b", placement: "inline" }),
    ];

    expect(selectPinnedElements(elements)).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectPinnedElements([])).toEqual([]);
  });
});

describe("resolvePinnedAreaVisibility", () => {
  it("collapses when there are no elements at all", () => {
    expect(resolvePinnedAreaVisibility([])).toBe("collapsed");
  });

  it("collapses when every element is a different placement", () => {
    const elements = [
      element({ id: "a", placement: "status" }),
      element({ id: "b", placement: "inline" }),
      element({ id: "c", placement: "sheet" }),
      element({ id: "d", placement: "screen" }),
    ];

    expect(resolvePinnedAreaVisibility(elements)).toBe("collapsed");
  });

  it("stays visible for one ordinary pinned element", () => {
    const elements = [element({ id: "a", placement: "pinned", kind: "widget" })];

    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
  });

  it("stays visible for a pinned element with an unrecognized kind (would render as a diagnostic)", () => {
    // "Empty" means no pinned element exists, not "no pinned element
    // rendered successfully" — an unknown-kind element is still present.
    const elements = [element({ id: "a", placement: "pinned", kind: "some-future-kind" as never })];

    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
  });

  it("stays visible for a pinned element of a known kind with no renderer registered (would render as a diagnostic)", () => {
    // `roster`/`form`/`diff`/`panel` have no Android renderer registered as
    // of this task (renderers/index.ts's own doc comment) — a pinned
    // element of one of those kinds must still keep the area visible.
    const elements = [element({ id: "a", placement: "pinned", kind: "roster" })];

    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
  });

  it("stays visible when a pinned element sits alongside non-pinned elements", () => {
    const elements = [
      element({ id: "a", placement: "status" }),
      element({ id: "b", placement: "pinned" }),
    ];

    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
  });

  it("collapses again once the last pinned element is gone (e.g. after removal/reconnect replay)", () => {
    const withPinned = [element({ id: "a", placement: "pinned" })];
    const withoutPinned = [element({ id: "b", placement: "status" })];

    expect(resolvePinnedAreaVisibility(withPinned)).toBe("visible");
    expect(resolvePinnedAreaVisibility(withoutPinned)).toBe("collapsed");
  });
});

describe("PINNED_AREA_LAYOUT_CONTRACT", () => {
  it("declares a bounded height that scrolls rather than growing without limit", () => {
    expect(PINNED_AREA_LAYOUT_CONTRACT.maxHeightDp).toBe(PINNED_AREA_MAX_HEIGHT_DP);
    expect(PINNED_AREA_LAYOUT_CONTRACT.maxHeightDp).toBeGreaterThan(0);
    expect(Number.isFinite(PINNED_AREA_LAYOUT_CONTRACT.maxHeightDp)).toBe(true);
    expect(PINNED_AREA_LAYOUT_CONTRACT.scrolls).toBe(true);
  });

  it("declares that it never overlays the composer or the keyboard/IME", () => {
    expect(PINNED_AREA_LAYOUT_CONTRACT.overlaysComposer).toBe(false);
    expect(PINNED_AREA_LAYOUT_CONTRACT.overlaysKeyboard).toBe(false);
  });
});
