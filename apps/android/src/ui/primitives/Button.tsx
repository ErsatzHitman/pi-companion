import { useMemo } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, type GestureResponderEvent } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { usePressScale } from "../theme/use-press-scale";

export type ButtonKind = "primary" | "secondary" | "danger";

export interface ButtonProps {
  kind?: ButtonKind;
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  testId?: string;
}

/** Beautiful UI's tight control height (plan.md T26C: "keep the visual size"). */
const BUTTON_HEIGHT = 32;

/**
 * Button primitive (plan.md §10.3). One visual treatment; `kind` selects a
 * semantic role (primary/secondary/danger), not an alternate style.
 * `Pressable` gives TalkBack the `button` role/state for free once
 * `accessibilityRole`/`accessibilityState` are set.
 *
 * Beautiful UI's control height (~32dp) is below the 48dp touch minimum
 * (plan.md T26C), so the outer `Pressable` is the full 48dp hit target and
 * the inner `Animated.View` carries the tighter visual chrome, centred
 * inside it via transparent padding — the touch target expands without
 * inflating the button's on-screen size. The inner view also carries the
 * `active:scale-[0.96]` press feedback (`usePressScale`,
 * docs/beautiful-ui-reference.md "Buttons `active:scale-[0.96]`").
 */
export function Button({ kind = "primary", label, onPress, disabled, testId }: ButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();
  const toneStyle = styles[`button_${kind}`];
  const textToneStyle = styles[`text_${kind}`];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={disabled ? undefined : onPressOut}
      testID={testId}
      style={styles.touchArea}
    >
      <Animated.View
        style={[
          styles.button,
          toneStyle,
          disabled ? styles.buttonDisabled : null,
          disabled ? null : pressStyle,
        ]}
      >
        <Text style={[styles.text, textToneStyle, disabled ? styles.textDisabled : null]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: { minHeight: 48, justifyContent: "center", alignItems: "flex-start" },
    button: {
      height: BUTTON_HEIGHT,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.radii.control,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
    },
    button_primary: { backgroundColor: theme.colors.accent },
    button_secondary: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    button_danger: { backgroundColor: theme.colors.red },
    buttonDisabled: { backgroundColor: theme.colors.surface, opacity: 0.6 },
    text: {
      fontFamily: theme.typography.variant.label.fontFamily,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    text_primary: { color: theme.colors.accentContrast },
    text_secondary: { color: theme.colors.ink },
    text_danger: { color: theme.colors.accentContrast },
    textDisabled: { color: theme.colors["ink-3"] },
  });
}
