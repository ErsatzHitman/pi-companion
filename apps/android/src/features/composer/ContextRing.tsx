import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ProgressRing } from "../../ui/recipes";
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
 * wraps the drawing in a `Pressable` and draws the percentage INSIDE
 * the ring through `ProgressRing`'s `centerLabel`, at the artifact's own
 * `.pct` size and weight (8px/700, `ink-2`).
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
 * **The visible ring is 28dp, the touch target is 48dp**, the same
 * split `ui/primitives/IconButton.tsx` and `ui/recipes/ScreenBar.tsx`
 * both use (plan.md §9.3, T26C). A control this small cannot be its own
 * hit area.
 *
 * **The percentage is text, inside the ring, always.** Fill level is a
 * colour-and-geometry signal and this state has to survive both being
 * unseen (plan.md §10.5) and being seen at 8px on a bright screen. The
 * SVG is hidden from assistive tech and the `Pressable` carries the
 * full announced sentence, so the number is announced even though the
 * drawing is not.
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
          trackColor={theme.colors["line-strong"]}
          arcColor={bandColors[model.band]}
          centerLabel={model.shortLabel}
          centerLabelColor={theme.colors["ink-2"]}
          centerLabelFontFamily={theme.typography.variant.code.fontFamily}
          centerLabelFontSize={CONTEXT_RING_LABEL_SIZE}
        />
      </View>
    </Pressable>
  );
}

/** `.ctx-ring .pct { font-size: 8px; font-weight: 700 }`. */
const CONTEXT_RING_LABEL_SIZE = 8;

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: {
      minWidth: 48,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radii.full,
    },
    touchAreaPressed: { backgroundColor: theme.colors.hover },
    ringBox: {
      width: CONTEXT_RING_SIZE,
      height: CONTEXT_RING_SIZE,
    },
  });
}

export default ContextRing;
