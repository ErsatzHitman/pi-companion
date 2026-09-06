import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  testId?: string;
}

/**
 * Select primitive (plan.md §10.3). Android/React Native has no native
 * `<select>`; this is a labelled trigger (`accessibilityRole="button"`,
 * announces the current value) that opens a full-screen option list
 * (`Modal`) so every option keeps a real touch target and TalkBack can
 * read `accessibilityState.selected` per row, matching the web
 * primitive's "pick one of N labelled options" semantics.
 */
export function Select({ label, options, value, onValueChange, testId }: SelectProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? "Not selected"}`}
        accessibilityHint="Opens a list of options"
        onPress={() => setOpen(true)}
        testID={testId}
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>{current?.label ?? "Select…"}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityLabel={`Close ${label}`}
        >
          <View style={styles.menu} onStartShouldSetResponder={() => true}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: option.value === value }}
                accessibilityLabel={option.label}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    field: { gap: theme.spacing[1] },
    label: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    trigger: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing[3],
      justifyContent: "center",
      backgroundColor: theme.colors.field,
    },
    triggerText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    scrim: { flex: 1, backgroundColor: theme.colors.overlayScrim, justifyContent: "flex-end" },
    menu: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.window,
      borderTopRightRadius: theme.radii.window,
      paddingVertical: theme.spacing[2],
      ...ringShadow(theme, "overlay"),
    },
    menuItem: { minHeight: 48, justifyContent: "center", paddingHorizontal: theme.spacing[4] },
    menuItemText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
