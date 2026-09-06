import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface SectionProps {
  title: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Section primitive (plan.md §10.3): a labelled grouping. Native TalkBack
 * has no `aria-labelledby` grouping equivalent, so this exposes the
 * heading as `accessibilityRole="header"` and wraps the group with
 * `accessible={false}`/`accessibilityRole="none"` at the container so the
 * heading still reads standalone (plan.md §10.5 "screen-reader role and
 * state").
 */
export function Section({ title, children, testId }: SectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.section} testID={testId}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    section: { gap: theme.spacing[3] },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.heading.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
  });
}
