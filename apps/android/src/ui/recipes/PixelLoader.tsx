import { useEffect, useMemo } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, View } from "react-native";

import {
  EXPRESSIVE_PIXEL_CELL_DELAYS_MS,
  EXPRESSIVE_PIXEL_CYCLE_MS,
  EXPRESSIVE_PIXEL_EASING,
  EXPRESSIVE_PIXEL_KEYFRAMES,
  EXPRESSIVE_PIXEL_REST_OPACITY,
} from "../theme/expressive-motion";
import { useTheme } from "../theme/theme-context";

/**
 * PixelLoader recipe (T350) — the redesign's "something is running"
 * mark.
 *
 * The design artifact draws in-flight work as a 3×3 grid of small
 * squares whose cells fade in on a staggered cycle, and reuses it in
 * three places: beside a running subagent's name, inside a running
 * bash block, and inside the app bar's running pill. A spinner would
 * have been the obvious substitute and is the wrong one — the grid is a
 * deliberate part of this design's language, it reads at 15dp where a
 * spinner does not, and it costs nine tiny views.
 *
 * **Reduced motion** (plan.md §10.5): with the device setting on, every
 * cell sits at `EXPRESSIVE_PIXEL_REST_OPACITY` (`.15`) and nothing
 * animates — the artifact's own `@media (prefers-reduced-motion:reduce)`
 * override for `.pxl i`, not full opacity (a prior version of this file
 * rendered the reduced-motion state at opacity `1`, read off no cited
 * source; the artifact's literal override is dim, uniformly, across all
 * nine cells). The mark still says "running" either way, because every
 * caller already states the state in words beside it — the loader is
 * decorative (see below) — so no information rides on which opacity a
 * static grid happens to sit at.
 *
 * **Decorative.** The loader is hidden from assistive tech and carries
 * no label of its own: every caller already announces the state in
 * words ("Running", "2 running · 5 total", a row's own accessible
 * label), and a second announcement per cell would be noise.
 *
 * **Deliberately not in `testing.recipeLabManifest`.** That manifest is
 * asserted by BOTH apps' recipe labs, so a name added there obliges a
 * web twin to exist; this is Android-only until the web app adopts the
 * same mark. Nothing asserts the reverse direction. Its contracts are
 * pinned by `recipe-accessibility.test.ts`, which is this app's own
 * list.
 */
export interface PixelLoaderProps {
  /**
   * Cell edge in dp. The artifact's is 4; the grid it composes is
   * `3 * size + 2 * gap` on a side.
   */
  cellSize?: number;
  /**
   * A resolved token colour for the lit cells. Defaults to the theme's
   * accent, which is what the artifact uses everywhere but the pill,
   * where the pill's own tone is passed in.
   */
  color?: string;
  testId?: string;
}

/** The artifact's `.pxl i` edge. */
const DEFAULT_CELL_SIZE = 4;
/** The artifact's `.pxl` grid gap. */
const CELL_GAP = 1.5;

/**
 * The `pixel-on` keyframe's four segments, precomputed once from
 * `EXPRESSIVE_PIXEL_KEYFRAMES`/`EXPRESSIVE_PIXEL_CYCLE_MS` rather than
 * inside the component: each entry is "animate to this opacity, over
 * this many ms", replayed in order every cycle. This is what makes the
 * shape a ramp-up/hold/ramp-down/hold rather than a symmetric fade —
 * `withRepeat(withTiming(...), -1, true)` (a ping-pong between two
 * values) cannot produce an asymmetric keyframe like this one.
 */
const PIXEL_SEGMENTS = EXPRESSIVE_PIXEL_KEYFRAMES.slice(1).map((keyframe, index) => ({
  opacity: keyframe.opacity,
  durationMs: Math.round(
    (keyframe.offset - EXPRESSIVE_PIXEL_KEYFRAMES[index].offset) * EXPRESSIVE_PIXEL_CYCLE_MS,
  ),
}));

function PixelCell({
  delayMs,
  size,
  color,
  animate,
}: {
  delayMs: number;
  size: number;
  color: string;
  animate: boolean;
}) {
  // Both the animated rest value and the reduced-motion static value are
  // the same `EXPRESSIVE_PIXEL_REST_OPACITY` — see this file's own
  // "Reduced motion" doc paragraph above.
  const opacity = useSharedValue(EXPRESSIVE_PIXEL_REST_OPACITY);

  useEffect(() => {
    if (!animate) {
      opacity.value = EXPRESSIVE_PIXEL_REST_OPACITY;
      return;
    }
    opacity.value = EXPRESSIVE_PIXEL_REST_OPACITY;
    opacity.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          ...PIXEL_SEGMENTS.map((segment) =>
            withTiming(segment.opacity, {
              duration: segment.durationMs,
              easing: Easing.bezier(...EXPRESSIVE_PIXEL_EASING),
            }),
          ),
        ),
        -1,
        false,
      ),
    );
  }, [animate, delayMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width: size, height: size, backgroundColor: color }, animatedStyle]} />
  );
}

export function PixelLoader({ cellSize = DEFAULT_CELL_SIZE, color, testId }: PixelLoaderProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(), []);
  const litColor = color ?? theme.colors.accent;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.grid, { width: cellSize * 3 + CELL_GAP * 2 }]}
      testID={testId}
    >
      {EXPRESSIVE_PIXEL_CELL_DELAYS_MS.map((delayMs, index) => (
        <PixelCell
          key={index}
          delayMs={delayMs}
          size={cellSize}
          color={litColor}
          animate={!reduceMotion}
        />
      ))}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: CELL_GAP,
    },
  });
}

export default PixelLoader;
