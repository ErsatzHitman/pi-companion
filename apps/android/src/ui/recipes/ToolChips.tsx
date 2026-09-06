import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { testing } from "@picompanion/frontend-core";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface ToolChipItem {
  id: string;
  label: string;
  tone: testing.LabTone;
  statusText: string;
}

export interface ToolChipsProps {
  items: readonly ToolChipItem[];
  accessibleName: string;
  testId?: string;
}

/**
 * ToolChips recipe (plan.md §10.4): the row of tool-permission chips
 * shown next to a tool call (Read/Write/Bash/Network, each with an
 * allow/needs-approval/denied state). Clean-specification recipe (plan.md
 * §10.1), matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): the row carries one accessible group
 * label, and each chip's status is duplicated as visible text (not just
 * the tone colour) with its own accessible label "<label>: <status>", so
 * "Denied" reads the same whether or not colour is perceivable.
 */
export function ToolChips({ items, accessibleName, testId }: ToolChipsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={styles.row}
      accessibilityRole="none"
      accessibilityLabel={accessibleName}
      testID={testId}
    >
      {items.map((item) => (
        <View
          key={item.id}
          style={[styles.chip, styles[`tone_${item.tone}`]]}
          accessible
          accessibilityLabel={`${item.label}: ${item.statusText}`}
        >
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.status}>{item.statusText}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
    // Non-interactive display chips: Beautiful UI's tight ~24-28dp footprint
    // applies directly (docs/beautiful-ui-reference.md "very tight control
    // sizes"); no 48dp touch target is owed since there's no `onPress` here.
    chip: {
      minHeight: 28,
      justifyContent: "center",
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      borderRadius: theme.radii.chip,
      borderWidth: 1,
      gap: 2,
    },
    tone_success: {
      backgroundColor: theme.colors.status.success.background,
      borderColor: theme.colors.status.success.border,
    },
    tone_warning: {
      backgroundColor: theme.colors.status.warning.background,
      borderColor: theme.colors.status.warning.border,
    },
    tone_danger: {
      backgroundColor: theme.colors.status.danger.background,
      borderColor: theme.colors.status.danger.border,
    },
    tone_info: {
      backgroundColor: theme.colors.status.info.background,
      borderColor: theme.colors.status.info.border,
    },
    tone_neutral: {
      backgroundColor: theme.colors.status.neutral.background,
      borderColor: theme.colors.status.neutral.border,
    },
    label: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    status: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default ToolChips;
