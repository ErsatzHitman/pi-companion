import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface DiffSummaryProps {
  path: string;
  added: number;
  removed: number;
  modified: number;
  testId?: string;
}

/**
 * DiffSummary recipe (plan.md §10.4): the compact +/-/~ line-count badge
 * shown next to a changed file. Clean-specification recipe (plan.md
 * §10.1), matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): every count is prefixed with a visible
 * `+`/`-`/`~` sign (not colour alone) and the whole summary is one
 * accessibility element with a single `accessibilityLabel` summarising
 * the counts in words, so TalkBack doesn't have to parse three separate
 * text nodes.
 */
export function DiffSummary({ path, added, removed, modified, testId }: DiffSummaryProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const summary = `${path}: ${added} added, ${removed} removed${modified ? `, ${modified} modified` : ""}`;

  return (
    <View style={styles.row} accessible accessibilityLabel={summary} testID={testId}>
      <Text style={styles.path} numberOfLines={1}>
        {path}
      </Text>
      <Text style={[styles.stat, styles.added]}>{`+${added}`}</Text>
      <Text style={[styles.stat, styles.removed]}>{`-${removed}`}</Text>
      {modified > 0 ? <Text style={[styles.stat, styles.modified]}>{`~${modified}`}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 32 },
    path: {
      flex: 1,
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    // Geist Mono with tabular figures for the +/-/~ counters (docs/
    // beautiful-ui-reference.md "Geist Mono for all numerals ... with
    // tabular-nums on counters and timers").
    stat: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    added: { color: theme.colors.status.success.foreground },
    removed: { color: theme.colors.status.danger.foreground },
    modified: { color: theme.colors.status.warning.foreground },
  });
}

export default DiffSummary;
