import { useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../theme/theme-context";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ToastProps {
  tone: StatusTone;
  message: string;
  testId?: string;
}

/**
 * Toast primitive (plan.md §10.3): a transient, non-modal notification.
 * `accessibilityLiveRegion` is `"assertive"` for danger/warning (needs to
 * interrupt) and `"polite"` otherwise, mirroring the web primitive's
 * alert-vs-status split; the tone is always paired with a visible label,
 * not colour alone (plan.md §10.5). Entrance uses a Reanimated fade/slide
 * from the shared motion tokens, near-instant under `reduceMotion`.
 */
export function Toast({ tone, message, testId }: ToastProps) {
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const assertive = tone === "danger" || tone === "warning";
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: motion.duration.base,
      easing: Easing.bezier(...motion.easing.decelerate),
    });
  }, [motion, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  return (
    <Animated.View
      style={[styles.toast, styles[`tone_${tone}`], animatedStyle]}
      accessible
      accessibilityLiveRegion={assertive ? "assertive" : "polite"}
      accessibilityLabel={`${toneLabel(tone)}: ${message}`}
      testID={testId}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

/** Toast region: mount once per screen, renders active toasts stacked bottom-up. */
export function ToastRegion({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      accessibilityRole="none"
      accessibilityLabel="Notifications"
      style={{
        position: "absolute",
        left: theme.spacing[4],
        right: theme.spacing[4],
        bottom: theme.spacing[4],
        gap: theme.spacing[2],
      }}
    >
      {children}
    </View>
  );
}

function toneLabel(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "Success";
    case "warning":
      return "Warning";
    case "danger":
      return "Error";
    case "info":
      return "Info";
    default:
      return "Notice";
  }
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    toast: {
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
      borderWidth: 1,
      ...theme.elevation[1],
    },
    text: { color: theme.colors.ink, fontSize: theme.typography.variant.body.fontSize },
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
  });
}
