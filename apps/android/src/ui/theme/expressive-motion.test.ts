import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EXPRESSIVE_CARET_BLINK_DURATION_MS,
  EXPRESSIVE_FADE_UP_DURATION_MS,
  EXPRESSIVE_FADE_UP_EASING,
  EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y,
  EXPRESSIVE_PIXEL_CELL_DELAYS_MS,
  EXPRESSIVE_PIXEL_CYCLE_MS,
  EXPRESSIVE_PIXEL_EASING,
  EXPRESSIVE_PIXEL_KEYFRAMES,
  EXPRESSIVE_PIXEL_REST_OPACITY,
  EXPRESSIVE_POP_IN_DURATION_MS,
  EXPRESSIVE_POP_IN_EASING,
  EXPRESSIVE_POP_IN_FROM_OPACITY,
  EXPRESSIVE_POP_IN_FROM_SCALE,
  EXPRESSIVE_PRESS_SCALE,
  EXPRESSIVE_PRESS_SPRING_DURATION_MS,
  EXPRESSIVE_PRESS_SPRING_EASING,
  EXPRESSIVE_RECORDS_PULSE_DURATION_MS,
  EXPRESSIVE_RECORDS_PULSE_EASING,
  EXPRESSIVE_RECORDS_PULSE_PEAK,
  EXPRESSIVE_RECORDS_PULSE_REST,
  type ExpressivePressTarget,
} from "./expressive-motion.js";

/**
 * A-MOTION: the Android-only MD3 Expressive motion numbers. RN-free, so
 * the constants below run the real module rather than reading its source
 * text (`expressive-shape.test.ts`'s own justification for the same
 * split, applied here to motion instead of shape).
 *
 * The RN/Reanimated *consumers* of this module (`use-press-scale.ts`,
 * `../primitives/IconButton.tsx`, `../recipes/ScreenBar.tsx`,
 * `../recipes/PixelLoader.tsx`, `../recipes/StreamingMessage.tsx`) cannot
 * render under this workspace's plain `vitest` setup — the same
 * constraint `../recipes/ShimmerText.test.ts` already documents — so the
 * second half of this file reads their committed source text (comments
 * stripped first) and asserts they actually consume these exports,
 * rather than duplicating the numbers as their own literals.
 */

describe("press spring", () => {
  it("carries the artifact's own .42s cubic-bezier(.34,1.7,.5,1), not an approximation", () => {
    expect(EXPRESSIVE_PRESS_SPRING_DURATION_MS).toBe(420);
    expect(EXPRESSIVE_PRESS_SPRING_EASING).toEqual([0.34, 1.7, 0.5, 1]);
  });

  it("is a spring, not an ease-out — its second control point sits above 1, producing overshoot", () => {
    // The one number that tells a spring apart from every curve in the
    // shared `motion.easing` table (packages/design-tokens/src/tokens.ts),
    // all of which stay within [0,1] on both axes and never cross their
    // target. A retune that "simplifies" this back into an ease-out
    // curve (any y <= 1) fails exactly this assertion.
    const [, y1] = EXPRESSIVE_PRESS_SPRING_EASING;
    expect(y1).toBeGreaterThan(1);
  });

  it("gives the icon target the artifact's deeper .88 press, distinct from the shared Beautiful UI .96", () => {
    expect(EXPRESSIVE_PRESS_SCALE.icon).toBe(0.88);
    expect(EXPRESSIVE_PRESS_SCALE.icon).not.toBe(0.96);
  });

  it("carries every one of the artifact's seven named press targets, no more and no fewer", () => {
    const expected: Record<ExpressivePressTarget, number> = {
      icon: 0.88,
      screenRailItem: 0.93,
      promptButton: 0.9,
      row: 0.97,
      chip: 0.9,
      block: 0.985,
      filePill: 0.92,
    };
    expect(EXPRESSIVE_PRESS_SCALE).toEqual(expected);
  });
});

describe("pixel-on (the .pxl 3x3 grid loader)", () => {
  it("uses the artifact's own 650ms cycle, not a `motion.duration` token", () => {
    expect(EXPRESSIVE_PIXEL_CYCLE_MS).toBe(650);
    // Not equal to any of the shared Beautiful UI durations this used to
    // be approximated by (100/150/200/300/400/600).
    expect([100, 150, 200, 300, 400, 600]).not.toContain(EXPRESSIVE_PIXEL_CYCLE_MS);
  });

  it("carries the artifact's asymmetric keyframe shape (ramp/hold/ramp/hold), not a symmetric two-value fade", () => {
    expect(EXPRESSIVE_PIXEL_KEYFRAMES).toEqual([
      { offset: 0, opacity: 0.15 },
      { offset: 0.18, opacity: 1 },
      { offset: 0.42, opacity: 1 },
      { offset: 0.62, opacity: 0.15 },
      { offset: 1, opacity: 0.15 },
    ]);
  });

  it("resolves to exactly one full 650ms cycle when the keyframe offsets are converted to segment durations", () => {
    // The same conversion PixelLoader.tsx's own `PIXEL_SEGMENTS` does —
    // proving the keyframe data is internally consistent (segments sum
    // to the whole cycle) independently of that component's own code.
    const segmentDurations = EXPRESSIVE_PIXEL_KEYFRAMES.slice(1).map(
      (keyframe, index) =>
        (keyframe.offset - EXPRESSIVE_PIXEL_KEYFRAMES[index].offset) * EXPRESSIVE_PIXEL_CYCLE_MS,
    );
    expect(segmentDurations).toEqual([117, 156, 130, 247]);
    expect(segmentDurations.reduce((a, b) => a + b, 0)).toBe(EXPRESSIVE_PIXEL_CYCLE_MS);
  });

  it("uses CSS ease-in-out per segment, and the rest opacity matches the reduced-motion override exactly", () => {
    expect(EXPRESSIVE_PIXEL_EASING).toEqual([0.42, 0, 0.58, 1]);
    expect(EXPRESSIVE_PIXEL_REST_OPACITY).toBe(0.15);
    // The reduced-motion static value IS the keyframe's own dim value —
    // not `1` (full opacity), which a prior version of this module's
    // only consumer used with no cited source.
    expect(EXPRESSIVE_PIXEL_REST_OPACITY).toBe(EXPRESSIVE_PIXEL_KEYFRAMES[0].opacity);
  });

  it("staggers all nine cells by the artifact's own nth-child delays, in nth-child order", () => {
    expect(EXPRESSIVE_PIXEL_CELL_DELAYS_MS).toEqual([90, 180, 270, 0, 90, 180, 90, 180, 270]);
  });
});

describe("caret-blink (recorded, not wired — see StreamingMessage.tsx)", () => {
  it("carries the artifact's own 1s cycle", () => {
    expect(EXPRESSIVE_CARET_BLINK_DURATION_MS).toBe(1000);
  });
});

describe("pop-in / records-pulse / fade-up (recorded for a caller outside this package)", () => {
  it("pop-in shares its easing with fade-up, and each keeps its own scale/opacity endpoints", () => {
    expect(EXPRESSIVE_POP_IN_EASING).toEqual([0.23, 1, 0.32, 1]);
    expect(EXPRESSIVE_POP_IN_FROM_SCALE).toBe(0.95);
    expect(EXPRESSIVE_POP_IN_FROM_OPACITY).toBe(0);
    expect(EXPRESSIVE_POP_IN_DURATION_MS).toEqual({ chip: 250, pill: 200, preview: 160 });
  });

  it("records-pulse holds the artifact's own rest/peak opacity and scale pair", () => {
    expect(EXPRESSIVE_RECORDS_PULSE_DURATION_MS).toBe(1100);
    expect(EXPRESSIVE_RECORDS_PULSE_EASING).toEqual([0.42, 0, 0.58, 1]);
    expect(EXPRESSIVE_RECORDS_PULSE_REST).toEqual({ opacity: 0.35, scale: 0.8 });
    expect(EXPRESSIVE_RECORDS_PULSE_PEAK).toEqual({ opacity: 1, scale: 1 });
  });

  it("fade-up carries the artifact's own three per-surface durations, including the transcript turn's 320ms", () => {
    expect(EXPRESSIVE_FADE_UP_EASING).toEqual([0.23, 1, 0.32, 1]);
    expect(EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y).toBe(8);
    expect(EXPRESSIVE_FADE_UP_DURATION_MS).toEqual({
      transcriptTurn: 320,
      listRow: 300,
      menu: 240,
    });
  });
});

// ---------------------------------------------------------------------------
// Source-level contracts for this module's RN/Reanimated consumers.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("use-press-scale.ts: the icon variant is a parameter, not a silent change to the shared default", () => {
  const code = () => readSource("./use-press-scale.ts");

  it("imports the spring numbers from this module rather than declaring its own", () => {
    expect(code()).toMatch(/from "\.\/expressive-motion"/);
    expect(code()).toMatch(/EXPRESSIVE_PRESS_SCALE/);
    expect(code()).toMatch(/EXPRESSIVE_PRESS_SPRING_DURATION_MS/);
    expect(code()).toMatch(/EXPRESSIVE_PRESS_SPRING_EASING/);
  });

  it('takes a variant parameter defaulting to "default", so every existing caller is unaffected unless it opts in', () => {
    expect(code()).toMatch(/variant: PressScaleVariant = "default"/);
    expect(code()).toMatch(/variant === "icon"/);
  });

  it("keeps the unconditional default path reading the shared motion tokens, not the icon spring", () => {
    expect(code()).toMatch(/target: motion\.pressScale/);
    expect(code()).toMatch(/duration: motion\.duration\.fast/);
    expect(code()).toMatch(/Easing\.bezier\(\.\.\.motion\.easing\.standard\)/);
  });

  it("still collapses to a no-op under reduceMotion for both press-in and press-out, regardless of variant", () => {
    const matches = code().match(/if \(reduceMotion\) return;/g);
    expect(matches).toHaveLength(2);
  });
});

describe("IconButton.tsx and ScreenBar.tsx: both call the icon variant, not the shared default", () => {
  it('IconButton\'s .ic press uses usePressScale("icon")', () => {
    expect(readSource("../primitives/IconButton.tsx")).toMatch(/usePressScale\("icon"\)/);
  });

  it('ScreenBar\'s own .ic-shaped bar action uses usePressScale("icon") too', () => {
    expect(readSource("../recipes/ScreenBar.tsx")).toMatch(/usePressScale\("icon"\)/);
  });
});

describe("PixelLoader.tsx: pixel-on is driven entirely by this module's numbers", () => {
  const code = () => readSource("../recipes/PixelLoader.tsx");

  it("imports every pixel-on export it needs, and declares no drifted literal of its own", () => {
    const src = code();
    expect(src).toMatch(/from "\.\.\/theme\/expressive-motion"/);
    for (const name of [
      "EXPRESSIVE_PIXEL_CELL_DELAYS_MS",
      "EXPRESSIVE_PIXEL_CYCLE_MS",
      "EXPRESSIVE_PIXEL_EASING",
      "EXPRESSIVE_PIXEL_KEYFRAMES",
      "EXPRESSIVE_PIXEL_REST_OPACITY",
    ]) {
      expect(src).toMatch(new RegExp(name));
    }
    // Regression guards for the two numbers this file used to get wrong:
    // `0.22` (should be the keyframe's own `.15`) and a `motion.duration`
    // token standing in for the artifact's real 650ms cycle.
    expect(src).not.toMatch(/0\.22/);
    expect(src).not.toMatch(/motion\.duration\.slower/);
  });

  it("replays the keyframe as a sequence of segments, not a two-value ping-pong", () => {
    const src = code();
    expect(src).toMatch(/withSequence\(/);
    expect(src).toMatch(/withRepeat\(\s*withSequence\(/);
    // The old shape: `withRepeat(withTiming(1, ...), -1, true)` — the
    // `true` (mirror/ping-pong) argument is exactly what cannot produce
    // an asymmetric ramp/hold/ramp/hold keyframe.
    expect(src).not.toMatch(/withRepeat\(withTiming\(1,/);
  });

  it("sets the reduced-motion rest opacity to the keyframe's own dim value, not full opacity", () => {
    const matches = code().match(/opacity\.value = EXPRESSIVE_PIXEL_REST_OPACITY;/g);
    // Once in the `!animate` branch, once as the animated start value —
    // both paths now agree, which is the fix itself.
    expect(matches).toHaveLength(2);
  });
});

describe("StreamingMessage.tsx: the caret direction is corrected, and the shimmer is composed rather than duplicated", () => {
  const code = () => readSource("../recipes/StreamingMessage.tsx");

  it("renders the caret as a plain, unanimated View while streaming — solid, matching .is-streaming{animation:none}", () => {
    const src = code();
    expect(src).toMatch(/<View style=\{styles\.cursor\} accessibilityElementsHidden \/>/);
    // Regression guard: the caret must not be wrapped in an animated
    // opacity pulse the way a prior version of this file blinked it
    // WHILE streaming — backwards from the artifact.
    expect(src).not.toMatch(/Animated\.View style=\{\[styles\.cursor/);
  });

  it("composes ./ShimmerText.tsx for the caption instead of re-deriving interpolateColor/withRepeat locally", () => {
    const src = code();
    expect(src).toMatch(/from "\.\/ShimmerText"/);
    expect(src).toMatch(/<ShimmerText active=\{!reduceMotion\} style=\{styles\.caption\}>/);
    // Regression guard: this file used to duplicate ShimmerText's own
    // 1.4s constant under a second name, which is exactly the drift risk
    // a single shimmer owner exists to remove.
    expect(src).not.toMatch(/const SHIMMER_DURATION_MS/);
    expect(src).not.toMatch(/interpolateColor/);
  });

  it("no longer imports react-native-reanimated at all — nothing left in this file animates directly", () => {
    // Both the caret (now static) and the caption (now ShimmerText's own
    // animation, not this file's) stopped calling Reanimated directly.
    // This is a deliberate, disclosed scope decision — see this file's
    // own "fade-up ... deliberately NOT wired up here" doc paragraph —
    // not an oversight: wiring the artifact's turn-entrance fade-up here
    // would reintroduce a direct Reanimated call that owns a duration
    // outside the shared `motion.duration` table, which
    // `../recipes/recipe-accessibility.test.ts` (outside this package)
    // only tolerates for a name explicitly listed in its own
    // `MOTION_TOKEN_EXEMPT` set.
    expect(code()).not.toMatch(/from "react-native-reanimated"/);
  });
});
