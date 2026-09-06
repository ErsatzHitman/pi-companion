import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme-context";

export type WorkflowStepStatus = "complete" | "active" | "upcoming" | "error";

export interface WorkflowStepItem {
  id: string;
  label: string;
  status: WorkflowStepStatus;
}

export interface WorkflowStepsProps {
  items: readonly WorkflowStepItem[];
  accessibleName: string;
  testId?: string;
}

const statusText: Record<WorkflowStepStatus, string> = {
  complete: "Complete",
  active: "In progress",
  upcoming: "Upcoming",
  error: "Failed",
};

/**
 * WorkflowSteps recipe (plan.md §10.4): a multi-step operation tracker
 * (pairing, connecting, syncing). Clean-specification recipe (plan.md
 * §10.1), matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): the active step carries
 * `accessibilityState={{ selected: true }}` (the closest RN/TalkBack
 * equivalent to the web recipe's `aria-current="step"`), and every step's
 * status is visible text, never marker colour alone.
 */
export function WorkflowSteps({ items, accessibleName, testId }: WorkflowStepsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={styles.list}
      accessibilityRole="none"
      accessibilityLabel={accessibleName}
      testID={testId}
    >
      {items.map((item, index) => (
        <View
          key={item.id}
          style={styles.row}
          accessible
          accessibilityState={{ selected: item.status === "active" }}
          accessibilityLabel={`Step ${index + 1} of ${items.length}: ${item.label}, ${statusText[item.status]}`}
        >
          {/* Mono ordinal (docs/beautiful-ui-reference.md "small `01`, `02`
              numbers in Geist Mono with tabular figures"). */}
          <Text style={styles.ordinal} accessibilityElementsHidden>
            {String(index + 1).padStart(2, "0")}
          </Text>
          <View
            style={[styles.marker, styles[`marker_${item.status}`]]}
            accessibilityElementsHidden
          />
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.status}>{statusText[item.status]}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    list: { gap: theme.spacing[2] },
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 36 },
    ordinal: {
      width: 16,
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    marker: { width: 10, height: 10, borderRadius: theme.radii.full },
    marker_complete: { backgroundColor: theme.colors.status.success.icon },
    marker_active: { backgroundColor: theme.colors.status.info.icon },
    marker_upcoming: { backgroundColor: theme.colors.status.neutral.icon },
    marker_error: { backgroundColor: theme.colors.status.danger.icon },
    label: {
      flex: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    status: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default WorkflowSteps;
