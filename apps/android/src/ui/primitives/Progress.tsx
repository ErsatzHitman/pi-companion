import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../theme/theme-context";

export interface ProgressProps {
  label: string;
  /** 0-1, or `null` for an indeterminate (unknown-duration) operation. */
  value: number | null;
  testId?: string;
}

/**
 * Progress primitive (plan.md §10.3). `accessibilityRole="progressbar"`
 * with `accessibilityValue` reflecting the 0-100 range (omitted while
 * indeterminate, matching the ARIA `progressbar` pattern the web
 * primitive follows); the percentage is always visible text, never
 * width/colour alone (plan.md §10.5). The indeterminate sweep respects
 * `reduceMotion` by collapsing to a static bar.
 */
export function Progress({ label, value, testId }: ProgressProps) {
  const { theme, motion, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const percentText = value === null ? "In progress" : `${Math.round(value * 100)}%`;
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (value !== null || reduceMotion) {
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(
      withTiming(1, {
        duration: motion.duration.slower,
        easing: Easing.bezier(...motion.easing.standard),
      }),
      -1,
      false,
    );
  }, [value, reduceMotion, motion, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep.value * 160 - 80 }],
  }));

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        value === null ? { text: percentText } : { min: 0, max: 100, now: Math.round(value * 100) }
      }
      testID={testId}
    >
      <View style={styles.labelRow}>
        <Text style={styles.labelText}>{label}</Text>
        <Text style={styles.percentText}>{percentText}</Text>
      </View>
      <View style={styles.track}>
        {value === null ? (
          <Animated.View style={[styles.indeterminateFill, sweepStyle]} />
        ) : (
          <View style={[styles.fill, { width: `${Math.round(value * 100)}%` }]} />
        )}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    labelRow: { flexDirection: "row", justifyContent: "space-between" },
    labelText: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    // The percentage/duration readout is a counter, so it takes the mono
    // family with tabular figures (docs/beautiful-ui-reference.md's rule
    // for numerals on counters and timers). T356: that document names
    // Geist Mono and this comment used to quote the face name, which has
    // been wrong on Android since T345 swapped the mono face to JetBrains
    // Mono. The rule is what was borrowed; the face comes from
    // `theme.typography.variant.code.fontFamily`, which is why the code
    // below never named one.
    percentText: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    track: {
      height: 6,
      borderRadius: theme.radii.full,
      // Beautiful UI's `inset` role: a recessed well, used here for the
      // progress track the way it's used for input backgrounds.
      backgroundColor: theme.colors.inset,
      overflow: "hidden",
    },
    fill: { height: 6, borderRadius: theme.radii.full, backgroundColor: theme.colors.accent },
    indeterminateFill: {
      height: 6,
      width: 80,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.accent,
    },
  });
}
