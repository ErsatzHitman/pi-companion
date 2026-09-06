import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../ui/theme/theme-context";

export interface RoutePlaceholderProps {
  title: string;
  /** Route params to surface, so a deep link/navigation call is visibly proven to have reached this screen. */
  params?: Record<string, string>;
}

/**
 * Shared placeholder body for a Phase 5 Expo Router stub route — T32S1C
 * ("Register Phase-5 route stubs for every feature family"). Mirrors
 * `apps/web/src/ui/route-placeholder.tsx`'s T15/T27S2 precedent on the
 * other platform: proves the route resolves and shows its params,
 * nothing more.
 *
 * Used directly by `h/[serverId]/(tabs)/settings.tsx`: plan.md §6 lists a
 * `settings/` feature directory in its *proposed* structure, but no
 * Phase 5 (or later) task in `docs/issues-from-plan.md` actually owns
 * building one — `features/notifications/` (T36A/T36B) is permission
 * notifications specifically, a different, narrower concern, not a
 * general settings screen. Wiring the settings route stub through a
 * `features/settings/` directory this task would have to invent, with no
 * task ever depending on T32S1C to claim ownership of it, would create
 * exactly the kind of unowned, orphaned file this task exists to avoid.
 * `apps/web/src/routes/screens/host-settings-screen.tsx` reached the
 * identical conclusion for the same reason and made the same choice.
 */
export function RoutePlaceholder({ title, params }: RoutePlaceholderProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const entries = params ? Object.entries(params) : [];

  return (
    <View style={styles.container} testID="route-placeholder">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {entries.map(([key, value]) => (
        <Text key={key} style={styles.param}>
          {key}: {value}
        </Text>
      ))}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[2],
      backgroundColor: theme.colors.page,
      padding: theme.spacing[6],
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.title.fontSize,
    },
    param: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
    },
  });
}
