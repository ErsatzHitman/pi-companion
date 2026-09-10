import { useEffect, useMemo } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, View } from "react-native";

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
 * cell renders at full opacity and nothing animates. The mark still
 * says "running", because a filled grid is visibly different from the
 * hollow ring a waiting row draws — the state never depends on the
 * motion. Every duration comes from `motion.duration`, which
 * `getNativeMotion(reduceMotion)` already collapses, so the guard here
 * is belt and braces rather than the only defence.
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
/** The artifact's dim cell — a lit cell at rest, not a second colour. */
const DIM_OPACITY = 0.22;

/**
 * The artifact's own per-cell delays, as a fraction of one cycle. Its
 * CSS staggers the nine cells 90ms apart on a 650ms cycle in the order
 * below, which reads as a wave crossing the grid rather than a
 * row-by-row sweep.
 */
const CELL_PHASES = [0.14, 0.28, 0.42, 0, 0.14, 0.28, 0.14, 0.28, 0.42] as const;

function PixelCell({
  phase,
  durationMs,
  size,
  color,
  animate,
}: {
  phase: number;
  durationMs: number;
  size: number;
  color: string;
  animate: boolean;
}) {
  const opacity = useSharedValue(animate ? DIM_OPACITY : 1);

  useEffect(() => {
    if (!animate) {
      opacity.value = 1;
      return;
    }
    opacity.value = DIM_OPACITY;
    opacity.value = withDelay(
      Math.round(phase * durationMs),
      withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, true),
    );
  }, [animate, phase, durationMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width: size, height: size, backgroundColor: color }, animatedStyle]} />
  );
}

export function PixelLoader({ cellSize = DEFAULT_CELL_SIZE, color, testId }: PixelLoaderProps) {
  const { theme, motion, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(), []);
  const litColor = color ?? theme.colors.accent;
  // The artifact's cycle is 650ms; `slower` (400ms) is the nearest
  // token, and a token is what plan.md §10.2 and this app's own
  // reduced-motion contract require over a literal.
  const durationMs = motion.duration.slower;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.grid, { width: cellSize * 3 + CELL_GAP * 2 }]}
      testID={testId}
    >
      {CELL_PHASES.map((phase, index) => (
        <PixelCell
          key={index}
          phase={phase}
          durationMs={durationMs}
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
