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
 * Touch floor: the disclosure `Pressable` is `WORK_GROUP_HEAD_MIN_HEIGHT`
 * tall with `hitSlop`. That value is a module-level integer literal on
 * purpose — `ui/primitives/touch-targets.test.ts` reads this file from
 * source, cannot resolve a `theme.spacing[...]` expression, and fails any
 * interactive element whose declared floor it cannot prove reaches 48dp
 * (plan.md §9.3).
 *
 * ## W5-RUNHEAD: conforming to the confirmed Android design's `.runhead`
 *
 * The confirmed design gives this row's own box (not the shared `.blk`
 * geometry `ui/theme/block-shape.ts` carries) four metrics this file now
 * matches, quoting the design's own CSS in each constant/style below:
 * `.runhead{display:inline-flex;align-items:center;gap:6px;margin:4px 0 0;
 * padding:4px 6px;border-radius:8px;font:12.5px/1 Inter,system-ui,
 * sans-serif;color:var(--ink-2);font-variant-numeric:tabular-nums}`. `gap`
 * and the horizontal padding have no `packages/design-tokens` spacing-scale
 * entry (the scale steps 4 → 8, skipping 6), so both stay named literals;
 * the vertical padding, the top margin, the radius and the font size all
 * land exactly on an existing token (`spacing[1]`, `radii.control`,
 * `typography.fontSize.base` via `typography.variant.body.fontSize`) and
 * use that token directly rather than re-wrapping it. `font-variant-numeric`
 * and the `.runhead` box's own dashed border/failure-tint chrome are
 * unchanged by this pass — the first is not one of the four deltas this
 * task's brief lists, and the second (this row's dashed outline, `.blk`'s
 * shape rather than a borderless `.runhead`) predates this task and this
 * task's brief never asks for it to be removed; see the file's own W5-
 * RUNHEAD report for both, rather than silently dropping either.
 *
 * The design's own `runheadTap(h)` script (quoted verbatim in the design
 * doc) does three things on every tap: toggles `.runfold` (this file's
 * `collapsed`, held by the route, not locally), rotates the chevron -90deg
 * over the CSS `transition:transform .2s` (`motion.duration.moderate`,
 * reduced-motion-aware via `useTheme()`'s already-resolved `motion`), and
 * appends `RUNHEAD_COLLAPSED_SUFFIX` to the visible/announced summary while
 * folded. The two `say(...)` calls it makes — "Run collapsed to its
 * header" / "Run expanded" — are announced the same way
 * `features/transcript/header.tsx` announces a status change: a node
 * carrying `accessibilityLiveRegion="polite"` whose `accessibilityLabel`
 * changes with the state being announced. Unlike `header.tsx`, that node
 * here cannot be this row's own outer wrapper marked `accessible`, because
 * (unlike `header.tsx`'s wrapper) this wrapper has a genuinely separate
 * interactive descendant — the disclosure `Pressable` itself — that must
 * stay independently reachable with its own accessible name; collapsing it
 * into one `accessible` node the way `header.tsx` does would swallow the
 * button. So the announcement lives on its own zero-size, always-present
 * sibling node instead, carrying only the two announced sentences and
 * nothing visible. Per `header.tsx`'s own disclosure: on-device
 * announcement timing (and, here additionally, whether this second node
 * becomes an extra stop in TalkBack's linear swipe order) is unverified —
 * no emulator in this workspace.
 */
import { memo, useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { timeline } from "@picompanion/frontend-core";

import { VectorIcon } from "../../ui/primitives/vector-icons";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";

/** plan.md §9.3's 48dp touch floor. See this file's doc comment for why it is
 * not a theme expression. */
const WORK_GROUP_HEAD_MIN_HEIGHT = 48;
const CHEVRON_SIZE = 14;

/**
 * `.runhead{gap:6px}` and `.runhead{padding:4px 6px}`'s horizontal half.
 * No `packages/design-tokens` spacing-scale entry holds `6` (the scale
 * steps `spacing[1]=4` → `spacing[2]=8`), so both stay named literals
 * rather than rounding to the nearest token.
 */
const RUNHEAD_GAP = 6;
const RUNHEAD_PADDING_HORIZONTAL = 6;

/**
 * `runheadTap`'s own appended text when a run is folded to its header —
 * quoting the design's script verbatim: `h.querySelector('span')
 * .textContent = on ? h.dataset.txt+' · hidden' : h.dataset.txt`. The
 * separator is U+00B7 MIDDLE DOT with a space on each side, confirmed
 * against the design document's raw bytes (not assumed from how it
 * renders), matching `formatWorkGroupMeta`'s own `" · "` join in
 * `packages/frontend-core`.
 */
const RUNHEAD_COLLAPSED_SUFFIX = " · hidden";

/** `runheadTap`'s two `say(...)` calls, quoted verbatim. */
const RUNHEAD_COLLAPSED_ANNOUNCEMENT = "Run collapsed to its header";
const RUNHEAD_EXPANDED_ANNOUNCEMENT = "Run expanded";

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
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // A group must never hide a failure behind a neutral label.
  const labelTint = group.hasFailure ? theme.colors.red : theme.colors["ink-2"];

  // `.runhead svg{transition:transform .2s}` / `.t.runfold .runhead svg
  // {transform:rotate(-90deg)}` — folded rotates the chevron -90deg over
  // `motion.duration.moderate` (200ms, or the reduced-motion table's
  // near-instant value when the device asks for it — `motion` is already
  // resolved for that by `useTheme()`, the same way
  // `ui/recipes/ThinkingSection.tsx`'s own chevron rotation is).
  const chevronProgress = useSharedValue(collapsed ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(collapsed ? 1 : 0, {
      duration: motion.duration.moderate,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [collapsed, motion, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * -90}deg` }],
  }));

  const meta = collapsed
    ? `${timeline.formatWorkGroupMeta(group)}${RUNHEAD_COLLAPSED_SUFFIX}`
    : timeline.formatWorkGroupMeta(group);
  const accessibleName = collapsed
    ? `${timeline.workGroupAccessibilityLabel(group)}${RUNHEAD_COLLAPSED_SUFFIX}`
    : timeline.workGroupAccessibilityLabel(group);

  return (
    <View style={styles.wrapper} testID={testId}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibleName}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => onToggle(group.id)}
        hitSlop={4}
        style={[styles.trigger, group.hasFailure ? styles.triggerFailed : null]}
      >
        <Animated.View
          style={chevronStyle}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <VectorIcon name="chevron-down" size={CHEVRON_SIZE} color={theme.colors["ink-3"]} />
        </Animated.View>
        <Text style={[styles.label, { color: labelTint }]} numberOfLines={1}>
          {group.summary.label}
        </Text>
        <Text style={styles.meta}>{meta}</Text>
      </Pressable>
      {/* `say(on ? 'Run collapsed to its header' : 'Run expanded')` — see
          this file's own doc comment for why this lives on its own node
          rather than on the `Pressable` above. */}
      <Text
        style={styles.announcer}
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          collapsed ? RUNHEAD_COLLAPSED_ANNOUNCEMENT : RUNHEAD_EXPANDED_ANNOUNCEMENT
        }
      />
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
      gap: RUNHEAD_GAP,
      minHeight: WORK_GROUP_HEAD_MIN_HEIGHT,
      // `.runhead{margin:4px 0 0}` — top only.
      marginTop: theme.spacing[1],
      // `.runhead{padding:4px 6px}`.
      paddingVertical: theme.spacing[1],
      paddingHorizontal: RUNHEAD_PADDING_HORIZONTAL,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.line,
      // `.runhead{border-radius:8px}` — `radii.control` (8), not the
      // shared `.blk` radius (`ui/theme/block-shape.ts`'s `BLOCK_RADIUS`,
      // 14) this trigger drew before W5-RUNHEAD: the two components have
      // different radii in the design, and this row is a `.runhead`, not
      // a `.blk`.
      borderRadius: theme.radii.control,
    },
    triggerFailed: {
      borderColor: theme.colors.red,
    },
    label: {
      flex: 1,
      // `.runhead{font:12.5px/1 ...}` — `typography.fontSize.base` (12.5),
      // read via the `body` variant, which is the one variant that already
      // resolves to `base`. The variant's own weight/tracking are kept
      // (the design's single `font` shorthand carries no separate weight
      // rule, but bolding the group's own label apart from its status
      // suffix predates this task and is not one of its four deltas).
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    meta: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      // `.runhead{font:12.5px/1 ...}` — same token as `label` above.
      fontSize: theme.typography.variant.body.fontSize,
    },
    announcer: {
      width: 0,
      height: 0,
      overflow: "hidden",
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
