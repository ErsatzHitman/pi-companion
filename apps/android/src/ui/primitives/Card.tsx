import { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

/**
 * Card primitive (plan.md §10.3): a raised `surface` container outlined
 * with Beautiful UI's 1px ring rather than a blurred drop shadow
 * (`ringShadow`, docs/beautiful-ui-reference.md "Shadows are rings, not
 * blurs").
 */
export function Card({ style, ...rest }: ViewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={[styles.card, style]} {...rest} />;
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
      padding: theme.spacing[4],
      ...ringShadow(theme, "card"),
    },
  });
}
