import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `RunHeader.tsx` imports `react-native` and `react-native-reanimated`,
 * which cannot be rendered under this workspace's plain `vitest` setup —
 * see `./message-row.test.ts` and `./thinking-row.test.ts`'s doc
 * comments for the identical constraint and the `readCode()` pattern
 * this file copies. All real logic (`buildRunHeaderViewModel`,
 * `buildRunHeaderSummary`, `buildRunHeaderDisplayText`,
 * `runHeaderAnnouncement`, the pluralisation, the rotation constants)
 * already has render-free proof in `./run-header-model.test.ts`; this
 * file only proves the .tsx actually wires that logic into the render
 * tree — the chevron rotation, the pressed-state background, the
 * accessibility props and the announced label — rather than silently
 * duplicating or dropping it.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct in `RunHeader.tsx`, re-run this file, confirm the specific
 * assertion that construct backs actually fails).
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./RunHeader.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("RunHeader.tsx: builds its view model from the real props, not private state", () => {
  it("calls buildRunHeaderViewModel(entries, collapsed)", () => {
    expect(readCode()).toMatch(/buildRunHeaderViewModel\(entries, collapsed\)/);
  });

  it("imports the model's own functions/constants rather than reimplementing them", () => {
    const source = readCode();
    expect(source).toMatch(/buildRunHeaderViewModel/);
    expect(source).toMatch(/RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG/);
    expect(source).toMatch(/from "\.\/run-header-model"/);
  });
});

describe("RunHeader.tsx: renders the view model's own display text", () => {
  it("renders viewModel.displayText inside the Text, not a locally recomputed string", () => {
    expect(readCode()).toMatch(/<Text[\s\S]{0,120}>\s*\{viewModel\.displayText\}/);
  });

  it("uses viewModel.accessibilityLabel as the Pressable's accessible name", () => {
    expect(readCode()).toMatch(/accessibilityLabel=\{viewModel\.accessibilityLabel\}/);
  });
});

describe("RunHeader.tsx: accessibility — button role, expanded state, live announcement", () => {
  it('is a real Pressable with accessibilityRole="button"', () => {
    expect(readCode()).toMatch(/accessibilityRole="button"/);
  });

  it("reports accessibilityState expanded as the inverse of collapsed", () => {
    expect(readCode()).toMatch(/accessibilityState=\{\{ expanded: !collapsed \}\}/);
  });

  it("marks the control as a polite live region, following header.tsx's convention rather than inventing a second mechanism", () => {
    expect(readCode()).toMatch(/accessibilityLiveRegion="polite"/);
  });

  it("wires onPress to the caller's onToggleCollapsed, never a locally-owned toggle", () => {
    expect(readCode()).toMatch(/onPress=\{onToggleCollapsed\}/);
    expect(readCode()).not.toMatch(/useState/);
  });
});

describe("RunHeader.tsx: chevron rotation drives from the model's collapsed rotation constant", () => {
  it("animates progress toward 1 when collapsed and 0 when expanded", () => {
    expect(readCode()).toMatch(/withTiming\(collapsed \? 1 : 0/);
  });

  it("interpolates rotation as progress times the model's collapsed rotation constant (-90deg at progress 1)", () => {
    expect(readCode()).toMatch(
      /rotate: `\$\{progress\.value \* RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG\}deg`/,
    );
  });

  it("uses the shared, reduced-motion-aware motion.duration.moderate (200ms) for the transition, not a fresh literal", () => {
    expect(readCode()).toMatch(/duration: motion\.duration\.moderate/);
  });
});

describe("RunHeader.tsx: hover ported as pressed (no :hover on Android)", () => {
  it("applies runheadPressed only while pressed, via the Pressable style function", () => {
    expect(readCode()).toMatch(
      /style=\{\(\{ pressed \}\) => \[styles\.runhead, pressed \? styles\.runheadPressed : null\]\}/,
    );
  });

  it("styles the pressed state from theme.colors.hover, the same token ScreenBar/IconButton already reuse for :hover", () => {
    expect(readCode()).toMatch(/runheadPressed: \{ backgroundColor: theme\.colors\.hover \}/);
  });
});

describe("RunHeader.tsx: the chevron is decorative; the row is the accessible unit", () => {
  it("hides the chevron from assistive tech (accessibilityElementsHidden), so only the Pressable's own label is read", () => {
    expect(readCode()).toMatch(
      /<Animated\.View style=\{chevronStyle\} accessibilityElementsHidden>/,
    );
  });

  it('draws the chevron with VectorIcon name="chevron-down" at the design\'s 12x12 size', () => {
    const source = readCode();
    expect(source).toMatch(/VectorIcon name="chevron-down" size=\{CHEVRON_SIZE\}/);
    expect(source).toMatch(/const CHEVRON_SIZE = 12/);
  });
});

describe("RunHeader.tsx: the .runhead box metrics are the confirmed design's own numbers", () => {
  // Added at the P10-W4 merge gate. These four literals are read straight
  // out of the confirmed Android design's
  // `.runhead{...gap:6px;margin:4px 0 0;padding:4px 6px;font:12.5px/1...}`
  // rule, but nothing pinned them: mutating all four at once
  // (6->5, 4->3, 6->7, 12.5->12.6) left this file at 15/15 passing, so a
  // future edit could have drifted the row's whole box off the design
  // without a single test going red. Each assertion pins BOTH the value
  // and the style property it feeds, because a number pinned but wired to
  // nothing is the defect this repository keeps re-shipping.

  it("pins gap:6px, and spends it as the row's gap", () => {
    const source = readCode();
    expect(source).toMatch(/const RUNHEAD_GAP = 6;/);
    expect(source).toMatch(/gap: RUNHEAD_GAP,/);
  });

  it("pins margin:4px 0 0, and spends it as marginTop only", () => {
    const source = readCode();
    expect(source).toMatch(/const RUNHEAD_MARGIN_TOP = 4;/);
    expect(source).toMatch(/marginTop: RUNHEAD_MARGIN_TOP,/);
  });

  it("pins the 6px horizontal half of padding:4px 6px, and spends it", () => {
    const source = readCode();
    expect(source).toMatch(/const RUNHEAD_PADDING_HORIZONTAL = 6;/);
    expect(source).toMatch(/paddingHorizontal: RUNHEAD_PADDING_HORIZONTAL,/);
  });

  it("pins font:12.5px/1 as a 12.5 size with a line height of exactly 1x it", () => {
    const source = readCode();
    expect(source).toMatch(/const RUNHEAD_FONT_SIZE = 12\.5;/);
    expect(source).toMatch(/const RUNHEAD_LINE_HEIGHT = RUNHEAD_FONT_SIZE;/);
    expect(source).toMatch(/fontSize: RUNHEAD_FONT_SIZE,/);
    expect(source).toMatch(/lineHeight: RUNHEAD_LINE_HEIGHT,/);
  });
});
