import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { Sheet } from "./Sheet";

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
 * The sheet's own subtitle text. Deliberately generic (see this file's
 * doc comment): one `Select` is reused for a connection profile, a
 * model name, a form question and more, and those share no sentence
 * beyond "pick one of these".
 */
const SHEET_DESCRIPTION = "Choose one option.";

/**
 * Select primitive (plan.md §10.3). Android/React Native has no native
 * `<select>`; this is a labelled trigger (`accessibilityRole="button"`,
 * announces the current value) that opens a labelled option list on the
 * shared `Sheet` primitive so every option keeps a real touch target and
 * TalkBack can read `accessibilityState.selected` per row, matching the
 * web primitive's "pick one of N labelled options" semantics.
 *
 * **UI-A2 rebuilt the option list on `Sheet`, in place of a React
 * Native `<Modal>`.** A `<Modal>` opens a second native Android
 * `Window` — `Sheet.tsx`'s own doc comment names this as exactly the
 * bug plan.md §9.3 warns against: a second native window competes with
 * the composer's `TextInput` for IME focus. That was live here, not
 * hypothetical — `Select` is what `ModelThinkingPicker.tsx`/
 * `QueueModePicker.tsx` are built from, and both are mounted inside
 * `PromptControlsMenu`'s own `Sheet`, so opening either picker used to
 * stack a second native window on top of the one the composer needs.
 * `Sheet` instead renders through the same same-window `Portal` every
 * other overlay in this app already shares (`Portal.tsx`); a `Sheet`
 * nested inside another `Sheet` costs a second scrim, never a second
 * window — `Portal.tsx`'s own registry keys every open sheet
 * independently, so they compose freely.
 *
 * Every existing contract is unchanged: the trigger's face
 * (`current?.label ?? "Select…"`) and accessible name
 * (`` `${label}: ${current?.label ?? "Not selected"}` ``,
 * `accessibilityHint="Opens a list of options"`), and each option row's
 * `accessibilityRole="menuitem"` / `accessibilityState.selected` /
 * `accessibilityLabel` and 48dp `menuItem` touch target —
 * `ModelThinkingPicker.tsx`/`QueueModePicker.tsx`'s own doc comments
 * quote several of these verbatim, and both keep compiling and passing
 * unchanged. Only the container around the option list changed.
 * `label` doubles as the sheet's own required title.
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
      <Sheet
        open={open}
        title={label}
        description={SHEET_DESCRIPTION}
        onClose={() => setOpen(false)}
      >
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
      </Sheet>
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
    menuItem: { minHeight: 48, justifyContent: "center", paddingHorizontal: theme.spacing[4] },
    menuItemText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
