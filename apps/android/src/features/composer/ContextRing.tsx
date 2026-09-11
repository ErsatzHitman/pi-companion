import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ProgressRing } from "../../ui/recipes";
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
 * wraps the drawing in a `Pressable` and puts the percentage beside it.
 *
 * **T360 moved the drawing itself to `ui/recipes/ProgressRing.tsx`.**
 * It used to be two `react-native-svg` circles here — a track and a
 * progress arc offset by `strokeDashoffset`, rotated to start at
 * twelve o'clock. The todo widget became the second ring in this app,
 * and a second copy of that arc (the rotation in particular, which is
 * easy to get wrong and invisible when you do) is the duplication
 * T356, T358 and T359 each removed for a shape. What stays here is
 * what is this control's own: the tap target, the label, and the
 * band-to-colour mapping.
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
        <ProgressRing
          size={CONTEXT_RING_SIZE}
          radius={CONTEXT_RING_RADIUS}
          strokeWidth={CONTEXT_RING_STROKE}
          circumference={model.circumference}
          dashOffset={model.dashOffset}
          trackColor={theme.colors.inset}
          arcColor={bandColors[model.band]}
        />
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
