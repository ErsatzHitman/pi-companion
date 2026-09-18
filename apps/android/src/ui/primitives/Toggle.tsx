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

/**
 * The confirmed Android design's own `.sw`/`.sw i` rule (A-SIZE):
 * `.sw{width:44px;height:26px;...}` with the knob `.sw i{top:4px;left:4px;
 * width:18px;height:18px;...}` and, on `[data-on="on"]`, `i{left:22px}`.
 * `TRACK_HEIGHT - KNOB_SIZE` is `8`, so a single `KNOB_INSET` of `4`
 * centres the knob vertically (via `track`'s `justifyContent: "center"`
 * below) at the same value the spec uses for the knob's own horizontal
 * inset — both axes read `4px` in the source rule, not a coincidence this
 * file has to reconcile.
 */
const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB_SIZE = 18;
const KNOB_INSET = 4;

/**
 * Toggle primitive (plan.md §10.3): `accessibilityRole="switch"` with
 * `accessibilityState.checked` kept in sync, a 48dp hit target around the
 * visually smaller track, and a Reanimated knob slide driven by the
 * shared motion tokens (near-instant when `reduceMotion` is on, per
 * plan.md §10.5).
 *
 * **The knob recolours, not just slides.** The confirmed spec's `.sw i`
 * rule is `background:var(--ink-2)` off and, under
 * `.sw[data-on="on"] i`, `background:#08131f` on — a real colour change,
 * not only the `left` position `knobStyle` already drove. `#08131f` is a
 * raw hex with no exact match in `packages/design-tokens/src/tokens.ts`
 * (read-only from this package): the nearest named token for "text/an
 * icon painted directly on a saturated solid fill" is `accentContrast`,
 * already used the identical way by `ui/recipes/PromptBar.tsx`'s send
 * icon for the spec's own `#0d1b2a`/`--surface` pair — close, not
 * byte-identical (measured: `accentContrast` resolves to
 * `beautifulDark.page` (`#17181a`) in dark mode and `#f7f8f9` in light,
 * neither of which is `#08131f`). Reading the shared alias here keeps
 * this knob off the same on-accent colour as every other on-accent
 * surface by construction, rather than hardcoding a fourth near-miss
 * literal of its own.
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
    // See this file's own doc comment for why `accentContrast` stands
    // in for the spec's raw `#08131f` on-state knob colour.
    backgroundColor: progress.value > 0.5 ? theme.colors.accentContrast : theme.colors["ink-2"],
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
      height: TRACK_HEIGHT,
      borderRadius: theme.radii.full,
      justifyContent: "center",
    },
    trackDisabled: { opacity: 0.5 },
    knob: {
      width: KNOB_SIZE,
      height: KNOB_SIZE,
      borderRadius: theme.radii.full,
      // No static colour here: the knob recolours with the toggle's own
      // progress, in `knobStyle` above, the same way `trackStyle`
      // already drives the track's colour.
    },
    label: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
    labelDisabled: { color: theme.colors["ink-3"] },
  });
}
