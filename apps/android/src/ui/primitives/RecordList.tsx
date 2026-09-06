import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface RecordListColumn {
  key: string;
  header: string;
}

export interface RecordListRow {
  id: string;
  cells: Record<string, string>;
}

export interface RecordListProps {
  accessibleName: string;
  columns: readonly RecordListColumn[];
  rows: readonly RecordListRow[];
  testId?: string;
}

/**
 * RecordList primitive (plan.md §10.3): a responsive record list stacked
 * as label/value rows per record rather than a fixed-width grid, so it
 * reflows on Android's narrow (compact-only) screens without horizontal
 * scrolling or clipped cells. Each record is a single accessibility
 * element so TalkBack reads the whole row at once, matching the web
 * primitive's per-row grouping.
 */
export function RecordList({ accessibleName, columns, rows, testId }: RecordListProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View accessibilityRole="none" accessibilityLabel={accessibleName} testID={testId}>
      {rows.map((row) => {
        const summary = columns
          .map((column) => `${column.header}: ${row.cells[column.key] ?? ""}`)
          .join(", ");
        return (
          <View key={row.id} accessible accessibilityLabel={summary} style={styles.row}>
            {columns.map((column) => (
              <View key={column.key} style={styles.cell}>
                <Text style={styles.cellHeader}>{column.header}</Text>
                <Text style={styles.cellValue}>{row.cells[column.key] ?? ""}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[3],
      // Dashed hairline row divider (docs/beautiful-ui-reference.md "the
      // single most recognisable trait").
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.line,
    },
    cell: { minWidth: 96 },
    cellHeader: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    cellValue: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
