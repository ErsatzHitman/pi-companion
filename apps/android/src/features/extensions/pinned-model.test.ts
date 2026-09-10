import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PINNED_AREA_LAYOUT_CONTRACT,
  PINNED_AREA_MAX_HEIGHT_DP,
  PINNED_AREA_MAX_WINDOW_SHARE,
  resolvePinnedAreaMaxHeightDp,
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
    expect(PINNED_AREA_LAYOUT_CONTRACT.maxWindowShare).toBe(PINNED_AREA_MAX_WINDOW_SHARE);
    expect(PINNED_AREA_LAYOUT_CONTRACT.maxHeightDp).toBeGreaterThan(0);
    expect(Number.isFinite(PINNED_AREA_LAYOUT_CONTRACT.maxHeightDp)).toBe(true);
    expect(PINNED_AREA_LAYOUT_CONTRACT.scrolls).toBe(true);
  });

  it("declares that it never overlays the composer or the keyboard/IME", () => {
    expect(PINNED_AREA_LAYOUT_CONTRACT.overlaysComposer).toBe(false);
    expect(PINNED_AREA_LAYOUT_CONTRACT.overlaysKeyboard).toBe(false);
  });
});

describe("resolvePinnedAreaMaxHeightDp (T342)", () => {
  it("is tall enough for a one-row roster card and a one-section panel together on a phone-sized window", () => {
    // Maestro run 34485299369 measured those two cards at ~310dp
    // stacked (roster 172dp, panel ~115dp, gaps); the old 240dp cap
    // clipped the panel's sections below the fold.
    expect(PINNED_AREA_MAX_HEIGHT_DP).toBeGreaterThanOrEqual(340);
    expect(resolvePinnedAreaMaxHeightDp(914)).toBe(PINNED_AREA_MAX_HEIGHT_DP);
  });

  it("caps at the window share on a short window, so transcript and composer keep room", () => {
    expect(resolvePinnedAreaMaxHeightDp(640)).toBe(Math.round(640 * PINNED_AREA_MAX_WINDOW_SHARE));
    expect(resolvePinnedAreaMaxHeightDp(640)).toBeLessThan(PINNED_AREA_MAX_HEIGHT_DP);
  });

  it("falls back to the absolute cap alone when nothing has been measured yet", () => {
    expect(resolvePinnedAreaMaxHeightDp(0)).toBe(PINNED_AREA_MAX_HEIGHT_DP);
    expect(resolvePinnedAreaMaxHeightDp(Number.NaN)).toBe(PINNED_AREA_MAX_HEIGHT_DP);
    expect(resolvePinnedAreaMaxHeightDp(-1)).toBe(PINNED_AREA_MAX_HEIGHT_DP);
  });
});

describe("PinnedLiveExtensionArea applies the window-relative cap (T342)", () => {
  // `pinned-live-extension-area.tsx` imports `react-native`, so this is a
  // source-level pin over the comment-stripped code, the same reason
  // every renderer test in this directory gives.
  const code = readFileSync(
    fileURLToPath(new URL("./pinned-live-extension-area.tsx", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("reads useWindowDimensions().height and resolves the cap through resolvePinnedAreaMaxHeightDp", () => {
    expect(code).toMatch(/useWindowDimensions/);
    expect(code).toMatch(/const \{ height: windowHeight \} = useWindowDimensions\(\);/);
    expect(code).toMatch(/const maxHeight = resolvePinnedAreaMaxHeightDp\(windowHeight\);/);
    expect(code).toMatch(/createStyles\(theme, maxHeight\), \[theme, maxHeight\]/);
  });

  it("applies that cap to both the wrapper and the ScrollView, never the constant directly, and (T343) lets both shrink below it", () => {
    expect(code).toMatch(/wrapper: \{ maxHeight, flexShrink: 1, minHeight: 0 \}/);
    expect(code).toMatch(/scroll: \{ maxHeight, flexShrink: 1 \}/);
    expect(code).not.toMatch(/maxHeight: PINNED_AREA_MAX_HEIGHT_DP/);
  });
});
