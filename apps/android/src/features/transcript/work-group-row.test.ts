import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getNativeMotion, getNativeTheme } from "@picompanion/design-tokens";

/**
 * `work-group-row.tsx` imports `react-native`, which cannot be rendered under
 * this workspace's plain `vitest` setup — see `./transcript-accessibility.test.ts`
 * for the identical constraint and `./thinking-row.test.ts` for the
 * `readCode()` pattern this file copies.
 *
 * All the real logic (label, status suffix, announced name, which runs become
 * groups at all) already has render-free proof in `packages/frontend-core`'s
 * `work-groups.test.ts`; this file only proves the .tsx actually wires that
 * shared core into the render tree — the disclosure semantics, the 48dp touch
 * floor, the failure tone, the `memo` boundary, and (W5-RUNHEAD) the
 * confirmed design's `.runhead` box metrics, chevron rotation, collapsed
 * suffix and announcements — rather than reimplementing any of it privately.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./work-group-row.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** The raw (comment-bearing) source, for byte-level checks a comment-stripped
 * read would corrupt the offsets of. */
function readRawCode(): string {
  return readFileSync(fileURLToPath(new URL("./work-group-row.tsx", import.meta.url)), "utf8");
}

describe("work-group-row.tsx: disclosure semantics", () => {
  it("is a button whose expanded state is the inverse of `collapsed`", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityState=\{\{ expanded: !collapsed \}\}/);
    expect(code).toMatch(/onPress=\{\(\) => onToggle\(group\.id\)\}/);
  });

  it("derives the accessible name and visible meta from the shared core, never a locally assembled string", () => {
    const code = readCode();
    // Both derived locals call the real shared-core formatters exactly once
    // each, not a reimplementation of either.
    expect(code).toMatch(/const meta = collapsed[\s\S]*?timeline\.formatWorkGroupMeta\(group\)/);
    expect(code).toMatch(
      /const accessibleName = collapsed[\s\S]*?timeline\.workGroupAccessibilityLabel\(group\)/,
    );
    // And the render tree actually uses those locals, not a fresh string.
    expect(code).toMatch(/accessibilityLabel=\{accessibleName\}/);
    expect(code).toMatch(/<Text style=\{styles\.meta\}>\{meta\}<\/Text>/);
  });

  it("reports a failure in the danger tone rather than hiding it behind a neutral head", () => {
    expect(readCode()).toMatch(
      /group\.hasFailure \? theme\.colors\.red : theme\.colors\["ink-2"\]/,
    );
  });
});

describe("work-group-row.tsx: 48dp touch floor", () => {
  it("declares the floor as a module-level integer literal the touch audit can resolve", () => {
    // `ui/primitives/touch-targets.test.ts` reads this file from source and
    // cannot resolve `theme.spacing[...]`; a named integer constant is the
    // one form it proves. Both halves are pinned so a future edit cannot
    // shrink the number or smuggle it back into a theme expression.
    const code = readCode();
    expect(code).toMatch(/const WORK_GROUP_HEAD_MIN_HEIGHT = 48;/);
    expect(code).toMatch(/minHeight: WORK_GROUP_HEAD_MIN_HEIGHT,/);
    expect(code).not.toMatch(/minHeight: theme\.spacing/);
  });
});

describe("work-group-row.tsx: memo boundary", () => {
  it("is memoized so a settled group head does not re-render with the transcript", () => {
    expect(readCode()).toMatch(
      /export const TranscriptWorkGroupHead = memo\(TranscriptWorkGroupHeadImpl\)/,
    );
  });
});

describe("work-group-row.tsx: W5-RUNHEAD box metrics (.runhead)", () => {
  it("pins the two design numbers with no spacing-scale entry as named literals", () => {
    // `.runhead{gap:6px}` and the horizontal half of `.runhead{padding:4px
    // 6px}` — the spacing scale has no `6` (steps 4 -> 8), so both must
    // stay literals rather than silently rounding to a token.
    const code = readCode();
    expect(code).toMatch(/const RUNHEAD_GAP = 6;/);
    expect(code).toMatch(/const RUNHEAD_PADDING_HORIZONTAL = 6;/);
    expect(code).toMatch(/gap: RUNHEAD_GAP,/);
    expect(code).toMatch(/paddingHorizontal: RUNHEAD_PADDING_HORIZONTAL,/);
  });

  it("uses a design-tokens token, not a new literal, for every metric the scale already holds", () => {
    const code = readCode();
    // `.runhead{margin:4px 0 0}` (top only) and the vertical half of
    // `.runhead{padding:4px 6px}` both land exactly on `spacing[1]` (4).
    expect(code).toMatch(/marginTop: theme\.spacing\[1\],/);
    expect(code).toMatch(/paddingVertical: theme\.spacing\[1\],/);
    // `.runhead{border-radius:8px}` — `radii.control` (8), not the shared
    // `.blk` radius (`BLOCK_RADIUS`, 14) this trigger used before W5-RUNHEAD.
    expect(code).toMatch(/borderRadius: theme\.radii\.control,/);
    expect(code).not.toMatch(/BLOCK_RADIUS/);
    // `.runhead{font:12.5px\/1 ...}` — `typography.fontSize.base` via the
    // `body` variant, for both the group label and its status/meta text.
    expect(code).toMatch(/fontSize: theme\.typography\.variant\.body\.fontSize,/g);
    const bodyFontSizeUses = code.match(/fontSize: theme\.typography\.variant\.body\.fontSize,/g);
    expect(bodyFontSizeUses).not.toBeNull();
    expect(bodyFontSizeUses?.length).toBe(2);
  });
});

describe("work-group-row.tsx: W5-RUNHEAD chevron rotation", () => {
  it("animates the fold to -90deg over the reduced-motion-aware moderate duration", () => {
    const code = readCode();
    // `.runhead svg{transition:transform .2s}` / `.t.runfold .runhead svg
    // {transform:rotate(-90deg)}`.
    expect(code).toMatch(/useSharedValue\(collapsed \? 1 : 0\)/);
    expect(code).toMatch(/withTiming\(collapsed \? 1 : 0, \{/);
    expect(code).toMatch(/duration: motion\.duration\.moderate,/);
    expect(code).toMatch(/rotate: `\$\{chevronProgress\.value \* -90\}deg`/);
    // `motion` comes from `useTheme()`, already resolved against the
    // device's reduce-motion setting — not a second, separately-checked
    // `reduceMotion` branch.
    expect(code).toMatch(/const \{ theme, motion \} = useTheme\(\);/);
  });

  it("swapped an instant style for an animated one — no more bare style swap", () => {
    const code = readCode();
    expect(code).not.toMatch(/collapsed \? styles\.chevronCollapsed : undefined/);
    expect(code).toMatch(/<Animated\.View\s+style=\{chevronStyle\}/);
  });
});

describe("work-group-row.tsx: W5-RUNHEAD collapsed suffix", () => {
  it("declares the exact suffix as a named constant, U+00B7 MIDDLE DOT with a space each side", () => {
    const raw = readRawCode();
    const match = raw.match(/const RUNHEAD_COLLAPSED_SUFFIX = "([^"]*)";/);
    expect(match).not.toBeNull();
    const suffix = match?.[1] ?? "";
    expect(suffix).toBe(" · hidden");
    expect(suffix.codePointAt(1)).toBe(0xb7);
  });

  it("appends the suffix to both the visible meta and the accessible name only while collapsed", () => {
    const code = readCode();
    expect(code).toMatch(
      /const meta = collapsed\s*\?\s*`\$\{timeline\.formatWorkGroupMeta\(group\)\}\$\{RUNHEAD_COLLAPSED_SUFFIX\}`\s*:\s*timeline\.formatWorkGroupMeta\(group\);/,
    );
    expect(code).toMatch(
      /const accessibleName = collapsed\s*\?\s*`\$\{timeline\.workGroupAccessibilityLabel\(group\)\}\$\{RUNHEAD_COLLAPSED_SUFFIX\}`\s*:\s*timeline\.workGroupAccessibilityLabel\(group\);/,
    );
  });
});

describe("work-group-row.tsx: W5-RUNHEAD announcements", () => {
  it("declares runheadTap's two say() sentences verbatim", () => {
    const code = readCode();
    expect(code).toMatch(/const RUNHEAD_COLLAPSED_ANNOUNCEMENT = "Run collapsed to its header";/);
    expect(code).toMatch(/const RUNHEAD_EXPANDED_ANNOUNCEMENT = "Run expanded";/);
  });

  it("announces via accessibilityLiveRegion, the mechanism header.tsx already uses, not a second one", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityLiveRegion="polite"/);
    expect(code).toMatch(
      /accessibilityLabel=\{\s*collapsed \? RUNHEAD_COLLAPSED_ANNOUNCEMENT : RUNHEAD_EXPANDED_ANNOUNCEMENT\s*\}/,
    );
    // Not `AccessibilityInfo.announceForAccessibility` — the second,
    // different mechanism this task's brief says not to invent.
    expect(code).not.toMatch(/announceForAccessibility/);
  });
});

describe("work-group-row.tsx: W5-RUNHEAD design numbers reached through a token", () => {
  // ADDED at the P10-W5 merge gate. The box-metrics tests above prove the
  // .tsx names `theme.spacing[1]`, `theme.radii.control`,
  // `theme.typography.variant.body.fontSize` and `motion.duration.moderate`
  // — but a regex over the source cannot fail when the TOKEN's own value
  // moves off the number the confirmed design states. Measured at the gate:
  // of the four, only `radii.control` had a test anywhere that would
  // (`packages/design-tokens`' own `tokens.test.ts`); `spacing[1]`,
  // `fontSize.base` and `duration.moderate` were each asserted only to be
  // greater than zero, or not asserted at all. These resolve the real theme
  // the component reads and pin the values themselves.
  it("resolves every .runhead metric this row delegates to a token to the design's own number", () => {
    const theme = getNativeTheme("dark", false);
    const motion = getNativeMotion(false);
    // `.runhead{margin:4px 0 0}`, and the vertical half of
    // `.runhead{padding:4px 6px}`.
    expect(theme.spacing[1]).toBe(4);
    // The next step on the scale, proving there is still no 6 for the gap
    // and the horizontal padding to land on — which is the whole reason
    // RUNHEAD_GAP and RUNHEAD_PADDING_HORIZONTAL stay named literals.
    expect(theme.spacing[2]).toBe(8);
    // `.runhead{border-radius:8px}` — not the shared block radius (14).
    expect(theme.radii.control).toBe(8);
    // `.runhead{font:12.5px/1 Inter,system-ui,sans-serif}`.
    expect(theme.typography.variant.body.fontSize).toBe(12.5);
    // `.runhead svg{transition:transform .2s}`.
    expect(motion.duration.moderate).toBe(200);
    // And the reduced-motion table collapses that same key, which is why
    // the component needs no second reduce-motion branch of its own.
    expect(getNativeMotion(true).duration.moderate).toBeLessThan(200);
  });
});
