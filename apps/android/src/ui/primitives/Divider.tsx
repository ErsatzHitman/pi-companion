import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "../theme/theme-context";

/**
 * Divider primitive (plan.md §10.3): a decorative separator, hidden from
 * assistive tech. Rendered as a **dashed** hairline (`docs/beautiful-ui-
 * reference.md` "Dashed hairline dividers ... the single most
 * recognisable trait") rather than a solid fill.
 */
export function Divider() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View
      style={styles.divider}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderColor: theme.colors.line,
    },
  });
}
