import { useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface PopoverProps {
  triggerLabel: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Popover primitive (plan.md §10.3): a non-modal disclosure. The trigger
 * exposes `accessibilityState.expanded`; content closes on outside tap or
 * the Android back gesture (`onRequestClose`), matching the web
 * primitive's outside-click/Escape contract (plan.md §10.5).
 */
export function Popover({ triggerLabel, children, testId }: PopoverProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        testID={testId}
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>{triggerLabel}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityLabel={`Close ${triggerLabel}`}
        >
          <View
            accessible
            accessibilityRole="none"
            accessibilityLabel={triggerLabel}
            style={styles.content}
            onStartShouldSetResponder={() => true}
          >
            {children}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    trigger: { minHeight: 48, justifyContent: "center", paddingHorizontal: theme.spacing[3] },
    triggerText: { color: theme.colors.accent, fontSize: theme.typography.variant.body.fontSize },
    scrim: {
      flex: 1,
      backgroundColor: theme.colors.overlayScrim,
      justifyContent: "center",
      padding: theme.spacing[5],
    },
    content: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
      padding: theme.spacing[4],
      ...ringShadow(theme, "overlay"),
    },
  });
}
