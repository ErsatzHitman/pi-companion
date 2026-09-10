import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  CONTEXT_RING_RADIUS,
  CONTEXT_RING_SIZE,
  CONTEXT_RING_STROKE,
  buildContextRingViewModel,
} from "./context-ring-model";
import type { ContextUsageBand } from "../telemetry";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/**
 * The prompt bar's context ring (T353).
 *
 * The redesign's amendment to the artifact removed the four footer
 * pills that used to sit above the prompt bar (Context, Model, Effort,
 * Build/Plan) and put a single small ring in the bar itself instead,
 * filling with context usage; tapping it opens the controls those pills
 * used to carry. This is that ring, and the tap target that opens them.
 *
 * `context-ring-model.ts` owns every number and every string; this file
 * draws two `react-native-svg` circles — a track and a progress arc
 * offset by `strokeDashoffset` — and wraps them in a `Pressable`.
 *
 * **The visible ring is 18dp, the touch target is 48dp**, the same
 * split `ui/primitives/IconButton.tsx` and `ui/recipes/ScreenBar.tsx`
 * both use (plan.md §9.3, T26C). A control this small cannot be its own
 * hit area.
 *
 * **The percentage is text, next to the ring, always.** Fill level is a
 * colour-and-geometry signal and this state has to survive both being
 * unseen (plan.md §10.5) and being seen at 18dp on a bright screen. The
 * SVG itself is hidden from assistive tech; the `Pressable` carries the
 * full announced sentence.
 */
export interface ContextRingProps {
  /** The newest usage the daemon has reported, or `null`/absent when it has reported none. */
  usage?: AgentUsage | null;
  onPress: () => void;
  testId?: string;
}

export function ContextRing({ usage, onPress, testId }: ContextRingProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = useMemo(() => buildContextRingViewModel(usage), [usage]);
  const bandColors: Record<ContextUsageBand, string> = {
    normal: theme.colors.accent,
    warning: theme.colors.orange,
    critical: theme.colors.red,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityHint={model.accessibilityHint}
      onPress={onPress}
      testID={testId}
      style={({ pressed }) => [styles.touchArea, pressed ? styles.touchAreaPressed : null]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.ringBox}
      >
        <Svg width={CONTEXT_RING_SIZE} height={CONTEXT_RING_SIZE} fill="none">
          <Circle
            cx={CONTEXT_RING_SIZE / 2}
            cy={CONTEXT_RING_SIZE / 2}
            r={CONTEXT_RING_RADIUS}
            stroke={theme.colors.inset}
            strokeWidth={CONTEXT_RING_STROKE}
          />
          <Circle
            cx={CONTEXT_RING_SIZE / 2}
            cy={CONTEXT_RING_SIZE / 2}
            r={CONTEXT_RING_RADIUS}
            stroke={bandColors[model.band]}
            strokeWidth={CONTEXT_RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={model.circumference}
            strokeDashoffset={model.dashOffset}
            // Start the arc at twelve o'clock instead of three, which is
            // where an unrotated SVG circle begins. A meter that fills
            // from the right edge reads as a different quantity at a
            // glance than the same meter filling from the top. Written
            // as an SVG transform string rather than the `rotation`/
            // `originX`/`originY` props, which `react-native-svg` marks
            // deprecated.
            transform={`rotate(-90, ${CONTEXT_RING_SIZE / 2}, ${CONTEXT_RING_SIZE / 2})`}
          />
        </Svg>
      </View>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.label}
        testID={testId ? `${testId}-label` : undefined}
      >
        {model.shortLabel}
      </Text>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      minHeight: 48,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.radii.full,
    },
    touchAreaPressed: { backgroundColor: theme.colors.hover },
    ringBox: {
      width: CONTEXT_RING_SIZE,
      height: CONTEXT_RING_SIZE,
    },
    // The mono family with tabular figures, so the label does not shift
    // the bar's layout as the percentage climbs through its digits.
    label: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}

export default ContextRing;
