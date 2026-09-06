import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  statusText: string;
  testId?: string;
}

/**
 * StatusIndicator primitive (plan.md §10.3): a coloured dot is always
 * paired with visible status text (plan.md §10.5), and
 * `accessibilityLiveRegion="polite"` announces changes without stealing
 * focus, mirroring the web primitive's `role="status"`.
 */
export function StatusIndicator({ label, tone, statusText, testId }: StatusIndicatorProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const dotStyle = styles[`dot_${tone}`];

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label}: ${statusText}`}
      testID={testId}
    >
      <View style={[styles.dot, dotStyle]} accessibilityElementsHidden />
      <Text style={styles.label}>{label}:</Text>
      <Text style={styles.text}>{statusText}</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], minHeight: 48 },
    dot: { width: 8, height: 8, borderRadius: theme.radii.full },
    dot_success: { backgroundColor: theme.colors.status.success.icon },
    dot_warning: { backgroundColor: theme.colors.status.warning.icon },
    dot_danger: { backgroundColor: theme.colors.status.danger.icon },
    dot_info: { backgroundColor: theme.colors.status.info.icon },
    dot_neutral: { backgroundColor: theme.colors.status.neutral.icon },
    label: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    text: { color: theme.colors.ink, fontSize: theme.typography.variant.label.fontSize },
  });
}
