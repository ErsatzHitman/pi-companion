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
 * Chip primitive (plan.md §10.3). When `onRemove` is supplied the chip
 * becomes a real `Pressable` (accessible button) whose accessible name is
 * `"Remove <label>"`; tone always pairs the label text with a status
 * colour, never colour alone (plan.md §10.5).
 *
 * Beautiful UI's pill chips are visually tight (~24dp tall); the
 * removable variant keeps that footprint but grows its touch bounds to
 * 48dp with `hitSlop` (plan.md T26C) rather than inflating the chip
 * itself, and carries the same `active:scale-[0.96]` press feedback as
 * `Button`/`IconButton`.
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
      height: 24,
      paddingHorizontal: theme.spacing[2],
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
