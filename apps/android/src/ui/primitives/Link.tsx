import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface LinkProps {
  label: string;
  onPress: () => void;
  /** Announced via accessibility hint since Android has no "opens in new tab" concept; kept for semantic parity with the web primitive. */
  external?: boolean;
  testId?: string;
}

/**
 * Link primitive (plan.md §10.3). `role="link"` plus a 48dp minimum hit
 * target — RN's `Pressable` doesn't give link semantics for free the way
 * an `<a>` does, so `accessibilityRole="link"` carries that weight here.
 */
export function Link({ label, onPress, external, testId }: LinkProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={external ? "Opens outside the app" : undefined}
      onPress={onPress}
      testID={testId}
      hitSlop={8}
      style={styles.touchArea}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: { minHeight: 48, justifyContent: "center" },
    text: {
      color: theme.colors.accent,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
      textDecorationLine: "underline",
    },
  });
}
