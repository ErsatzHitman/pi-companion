import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface ToggleProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

const TRACK_WIDTH = 44;
const KNOB_SIZE = 20;
const KNOB_INSET = 3;

/**
 * Toggle primitive (plan.md §10.3): `accessibilityRole="switch"` with
 * `accessibilityState.checked` kept in sync, a 48dp hit target around the
 * visually smaller track, and a Reanimated knob slide driven by the
 * shared motion tokens (near-instant when `reduceMotion` is on, per
 * plan.md §10.5).
 */
export function Toggle({ label, checked, onCheckedChange, disabled, testId }: ToggleProps) {
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const progress = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(checked ? 1 : 0, {
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [checked, motion, progress]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: KNOB_INSET + progress.value * (TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2),
      },
    ],
  }));

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: progress.value > 0.5 ? theme.colors.accent : theme.colors["line-strong"],
  }));

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked, disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={() => onCheckedChange(!checked)}
        testID={testId}
        hitSlop={12}
        style={styles.touchArea}
      >
        <Animated.View style={[styles.track, trackStyle, disabled ? styles.trackDisabled : null]}>
          <Animated.View style={[styles.knob, knobStyle]} />
        </Animated.View>
      </Pressable>
      <Text style={[styles.label, disabled ? styles.labelDisabled : null]}>{label}</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
    touchArea: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" },
    track: {
      width: TRACK_WIDTH,
      height: 24,
      borderRadius: theme.radii.full,
      justifyContent: "center",
    },
    trackDisabled: { opacity: 0.5 },
    knob: {
      width: KNOB_SIZE,
      height: KNOB_SIZE,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.surface,
    },
    label: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
    labelDisabled: { color: theme.colors["ink-3"] },
  });
}
