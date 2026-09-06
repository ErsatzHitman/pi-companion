import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export type TaskRowStatus = "pending" | "in-progress" | "done" | "failed";

export interface TaskRowItem {
  id: string;
  title: string;
  status: TaskRowStatus;
}

export interface TaskRowsProps {
  items: readonly TaskRowItem[];
  accessibleName: string;
  testId?: string;
}

const statusText: Record<TaskRowStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  done: "Done",
  failed: "Failed",
};

/**
 * TaskRows recipe (plan.md §10.4): a Pi-generated task/todo list with
 * per-row status (Pi's plan-mode task tracking). Clean-specification
 * recipe (plan.md §10.1), matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): the list is one accessible group named
 * by `accessibleName`, and each row's accessible label already ends in
 * its status word ("Done", "Failed", ...) — visible text, not marker
 * colour or strikethrough alone.
 */
export function TaskRows({ items, accessibleName, testId }: TaskRowsProps) {
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
          accessibilityLabel={`${index + 1} of ${items.length}: ${item.title}, ${statusText[item.status]}`}
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
          <Text
            style={[styles.title, item.status === "done" ? styles.titleDone : null]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <Text style={styles.status}>{statusText[item.status]}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    list: { gap: theme.spacing[1] },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: 36,
      paddingVertical: theme.spacing[1],
    },
    ordinal: {
      width: 16,
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    marker: { width: 8, height: 8, borderRadius: theme.radii.full },
    marker_pending: { backgroundColor: theme.colors.status.neutral.icon },
    "marker_in-progress": { backgroundColor: theme.colors.status.info.icon },
    marker_done: { backgroundColor: theme.colors.status.success.icon },
    marker_failed: { backgroundColor: theme.colors.status.danger.icon },
    title: {
      flex: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    titleDone: { color: theme.colors["ink-2"] },
    status: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}

export default TaskRows;
