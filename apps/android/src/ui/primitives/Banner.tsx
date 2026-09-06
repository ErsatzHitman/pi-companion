import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface BannerProps {
  tone: StatusTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

/**
 * Banner primitive (plan.md §10.3): a persistent, in-flow status strip
 * (e.g. "connected through a relay"). `accessibilityLiveRegion="polite"`;
 * the optional action is a real `Pressable` button with a 48dp hit
 * target, never a bare colour cue.
 */
export function Banner({ tone, message, actionLabel, onAction, testId }: BannerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={[styles.banner, styles[`tone_${tone}`]]}
      accessible={!actionLabel}
      accessibilityLiveRegion="polite"
      accessibilityLabel={actionLabel ? undefined : message}
      testID={testId}
    >
      <Text style={styles.message} accessibilityLabel={actionLabel ? message : undefined}>
        {message}
      </Text>
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.action}
          hitSlop={8}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.radii.control,
      borderWidth: 1,
      gap: theme.spacing[3],
    },
    message: {
      flex: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    action: { minHeight: 48, justifyContent: "center" },
    actionText: {
      color: theme.colors.accent,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
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
