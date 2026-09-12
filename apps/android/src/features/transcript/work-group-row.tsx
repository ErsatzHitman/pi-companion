/**
 * Android work-group head (T388) — the disclosure row that stands in for a
 * consecutive thinking/tool-call run in the transcript.
 *
 * A thin native view over the pure model in `@picompanion/frontend-core`
 * (`timeline.buildTranscriptWorkGroups` and its `formatWorkGroupMeta`/
 * `workGroupAccessibilityLabel` formatters), mirroring
 * `apps/web/src/features/transcript/work-group-row.tsx`. It owns no grouping
 * logic of its own: the label, the status suffix, and the announced name all
 * come from the shared core, so the two platforms cannot drift.
 *
 * The route (`app/h/[serverId]/session/[agentId]/index.tsx`) renders this
 * *above* a group's first member inside that member's own row; the remaining
 * members are dropped from the list entirely while the group is collapsed
 * (`timeline.visibleTranscriptEntries`), so a collapsed run costs one row.
 *
 * Touch floor: the disclosure `Pressable` is `WORK_GROUP_HEAD_MIN_HEIGHT` tall
 * with `hitSlop`. That value is a module-level integer literal on purpose —
 * `ui/primitives/touch-targets.test.ts` reads this file from source, cannot
 * resolve a `theme.spacing[...]` expression, and fails any interactive element
 * whose declared floor it cannot prove reaches 48dp (plan.md §9.3).
 */
import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { timeline } from "@picompanion/frontend-core";

import { VectorIcon } from "../../ui/primitives/vector-icons";
import { BLOCK_RADIUS } from "../../ui/theme/block-shape";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";

/** plan.md §9.3's 48dp touch floor. See this file's doc comment for why it is
 * not a theme expression. */
const WORK_GROUP_HEAD_MIN_HEIGHT = 48;
const CHEVRON_SIZE = 14;

export interface TranscriptWorkGroupHeadProps {
  group: timeline.TranscriptWorkGroup;
  /** Resolved collapse state (host override, else the group's own
   * `defaultCollapsed`). */
  collapsed: boolean;
  /** Called with the group's id. A single stable callback, so this memoized
   * component's props stay comparable by reference. */
  onToggle: (groupId: string) => void;
  testId?: string;
}

function TranscriptWorkGroupHeadImpl({
  group,
  collapsed,
  onToggle,
  testId,
}: TranscriptWorkGroupHeadProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // A group must never hide a failure behind a neutral label.
  const labelTint = group.hasFailure ? theme.colors.red : theme.colors["ink-2"];

  return (
    <View style={styles.wrapper} testID={testId}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={timeline.workGroupAccessibilityLabel(group)}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => onToggle(group.id)}
        hitSlop={4}
        style={[styles.trigger, group.hasFailure ? styles.triggerFailed : null]}
      >
        <View
          style={collapsed ? styles.chevronCollapsed : undefined}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <VectorIcon name="chevron-down" size={CHEVRON_SIZE} color={theme.colors["ink-3"]} />
        </View>
        <Text style={[styles.label, { color: labelTint }]} numberOfLines={1}>
          {group.summary.label}
        </Text>
        <Text style={styles.meta}>{timeline.formatWorkGroupMeta(group)}</Text>
      </Pressable>
      {group.summary.detail !== undefined ? (
        <Text style={styles.detail} numberOfLines={1}>
          {group.summary.detail}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[1],
      marginBottom: theme.spacing[1],
    },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: WORK_GROUP_HEAD_MIN_HEIGHT,
      paddingHorizontal: theme.spacing[2],
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.line,
      borderRadius: BLOCK_RADIUS,
    },
    triggerFailed: {
      borderColor: theme.colors.red,
    },
    chevronCollapsed: {
      transform: [{ rotate: "-90deg" }],
    },
    label: {
      flex: 1,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    meta: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    detail: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      paddingHorizontal: theme.spacing[2],
    },
  });
}

export const TranscriptWorkGroupHead = memo(TranscriptWorkGroupHeadImpl);

export default TranscriptWorkGroupHead;
