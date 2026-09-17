import { useMemo, type ReactNode } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { usePressScale } from "../theme/use-press-scale";
import { Icon } from "./icons";

export type ChipTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  onRemove?: () => void;
  testId?: string;
}

/**
 * The confirmed Android design's own `.chip` rule (A-SIZE):
 * `height:30px;padding:0 13px`. Radius is untouched here — `.chip` is one
 * of the surfaces already drawn at `--r-full` (A-SHAPE), which this file
 * reads as `theme.radii.full` below and which already matches; only the
 * box's own height and horizontal padding were wrong.
 */
const CHIP_HEIGHT = 30;
const CHIP_PADDING_HORIZONTAL = 13;

/**
 * Chip primitive (plan.md §10.3). When `onRemove` is supplied the chip
 * becomes a real `Pressable` (accessible button) whose accessible name is
 * `"Remove <label>"`; tone always pairs the label text with a status
 * colour, never colour alone (plan.md §10.5).
 *
 * Drawn at `CHIP_HEIGHT` (30dp), the design artifact's own `.chip` height;
 * the removable variant keeps that footprint but grows its touch bounds to
 * 48dp with `hitSlop` (plan.md T26C) rather than inflating the chip
 * itself, and carries the same `active:scale-[0.96]` press feedback as
 * `Button`/`IconButton`. The artifact's own `.chip:active{transform:
 * scale(.9)}` spring (`../theme/expressive-motion.ts`'s
 * `EXPRESSIVE_PRESS_SCALE.chip`) is NOT wired here: `usePressScale`
 * (`../theme/use-press-scale.ts`) has no `"chip"` arm on its
 * `PressScaleVariant` union today, only `"default"` and `"icon"`, and
 * that file is outside this primitive's own exclusive file set — the fix
 * is adding a `"chip"` arm there (mapping to `EXPRESSIVE_PRESS_SCALE.chip`)
 * and calling `usePressScale("chip")` below, not a second hook.
 */
export function Chip({ label, tone = "neutral", onRemove, testId }: ChipProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();
  const toneStyle = styles[`tone_${tone}`];

  if (onRemove) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        onPress={onRemove}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        testID={testId}
        hitSlop={14}
      >
        <Animated.View style={[styles.chip, toneStyle, pressStyle]}>
          <Text style={styles.chipText}>{label}</Text>
          <Icon
            name="close"
            style={{ fontSize: 9, marginLeft: theme.spacing[1], color: theme.colors.ink }}
          />
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.chip, toneStyle]} testID={testId}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function ChipGroup({
  children,
  accessibleName,
}: {
  children: ReactNode;
  accessibleName: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessible={false}
      accessibilityRole="none"
      accessibilityLabel={accessibleName}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] }}
    >
      {children}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      height: CHIP_HEIGHT,
      paddingHorizontal: CHIP_PADDING_HORIZONTAL,
      borderRadius: theme.radii.full,
      borderWidth: 1,
    },
    chipText: {
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
      color: theme.colors.ink,
    },
    tone_success: {
      backgroundColor: theme.colors["green-tint"],
      borderColor: theme.colors.green,
    },
    tone_warning: {
      backgroundColor: theme.colors["orange-tint"],
      borderColor: theme.colors.orange,
    },
    tone_danger: {
      backgroundColor: theme.colors["red-tint"],
      borderColor: theme.colors.red,
    },
    tone_info: {
      backgroundColor: theme.colors["accent-tint"],
      borderColor: theme.colors.accent,
    },
    tone_neutral: {
      backgroundColor: theme.colors.inset,
      borderColor: theme.colors.line,
    },
  });
}
