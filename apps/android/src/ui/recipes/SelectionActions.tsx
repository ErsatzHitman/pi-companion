import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "../primitives/IconButton";
import type { IconName } from "../primitives/icons";
import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface SelectionAction {
  id: string;
  label: string;
  icon: IconName;
}

export interface SelectionActionsProps {
  selectionSummary: string;
  actions: readonly SelectionAction[];
  onAction: (id: string) => void;
  testId?: string;
}

/**
 * SelectionActions recipe (plan.md §10.4): a floating toolbar that
 * appears after selecting transcript text (Copy / Quote in reply /
 * Dismiss). Clean-specification recipe (plan.md §10.1), matching the web
 * recipe's semantics.
 *
 * Accessibility (plan.md §10.5): `accessibilityRole="toolbar"` with a
 * visible summary of what is selected as real text (not an implicit
 * selection state), and each action is an `IconButton` with its own
 * mandatory accessible name so TalkBack/keyboard users don't need the
 * icon to understand the action.
 */
export function SelectionActions({
  selectionSummary,
  actions,
  onAction,
  testId,
}: SelectionActionsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={styles.wrapper}
      accessibilityRole="toolbar"
      accessibilityLabel="Selection actions"
      testID={testId}
    >
      <Text style={styles.summary}>{selectionSummary}</Text>
      <View style={styles.buttons}>
        {actions.map((action) => (
          <IconButton
            key={action.id}
            icon={action.icon}
            accessibleName={action.label}
            onPress={() => onAction(action.id)}
          />
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[2],
      padding: theme.spacing[2],
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.surface,
      ...ringShadow(theme, "overlay"),
    },
    summary: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    buttons: { flexDirection: "row", gap: theme.spacing[1] },
  });
}

export default SelectionActions;
