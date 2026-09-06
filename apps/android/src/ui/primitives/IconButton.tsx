import { useMemo } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, type GestureResponderEvent } from "react-native";

import { useTheme } from "../theme/theme-context";
import { usePressScale } from "../theme/use-press-scale";
import { Icon, type IconName } from "./icons";

export interface IconButtonProps {
  icon: IconName;
  /** Required: the icon alone is hidden from assistive tech, so this is the button's only accessible name. */
  accessibleName: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  testId?: string;
}

/** Beautiful UI's icon-button footprint (docs/beautiful-ui-reference.md "24–28px icon buttons"). */
const ICON_BUTTON_SIZE = 28;

/**
 * IconButton primitive (plan.md §10.3). Icon-only affordance with a
 * mandatory `accessibleName` (plan.md §10.5).
 *
 * The Beautiful UI icon button is a tight 28dp square with a `control`
 * radius and no fill until hovered/pressed — well below the 48dp touch
 * minimum, so (plan.md T26C) the outer `Pressable` is the full 48dp hit
 * target while the inner `Animated.View` carries the smaller visual
 * chrome and the `active:scale-[0.96]` press feedback, centred via
 * transparent padding.
 */
export function IconButton({ icon, accessibleName, onPress, disabled, testId }: IconButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={disabled ? undefined : onPressOut}
      testID={testId}
      style={({ pressed }) => [
        styles.touchArea,
        pressed && !disabled ? styles.touchAreaPressed : null,
      ]}
    >
      <Animated.View style={[styles.button, disabled ? null : pressStyle]}>
        <Icon
          name={icon}
          style={{
            color: disabled ? theme.colors["ink-3"] : theme.colors.ink,
            fontSize: 14,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: {
      minWidth: 48,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radii.full,
    },
    // Beautiful UI's "hover affordances fade in" (docs/beautiful-ui-
    // reference.md signature trait 8): the touch wrapper, not the inner
    // chrome, gets the transient hover/press tint so the visual square
    // stays a fixed 28dp regardless of press state.
    touchAreaPressed: { backgroundColor: theme.colors.hover },
    button: {
      width: ICON_BUTTON_SIZE,
      height: ICON_BUTTON_SIZE,
      borderRadius: theme.radii.control,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
