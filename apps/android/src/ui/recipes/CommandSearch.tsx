import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface CommandSearchItem {
  id: string;
  label: string;
  hint: string;
}

export interface CommandSearchProps {
  label: string;
  placeholder: string;
  items: readonly CommandSearchItem[];
  onSelect: (item: CommandSearchItem) => void;
  testId?: string;
}

/**
 * CommandSearch recipe (plan.md §10.4): the slash-command palette. Built
 * from a clean specification of the same "combobox with list
 * autocomplete" interaction the web recipe follows (plan.md §10.1), not
 * copied code — adapted to what Android exposes: touch selection instead
 * of arrow-key navigation, since plan.md T26B requires "no hover-
 * dependent behaviour" and physical-keyboard arrow keys are not the
 * platform's primary input.
 *
 * Accessibility (plan.md §10.5): the input is `accessibilityRole="combobox"`
 * with `accessibilityState.expanded` and `accessibilityValue` naming the
 * open listbox; each candidate is a `Pressable` with `accessibilityRole="menuitem"`
 * and its own accessible label combining the command and its hint, so
 * TalkBack users can swipe through and activate one without touch
 * precision.
 */
export function CommandSearch({ label, placeholder, items, onSelect, testId }: CommandSearchProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.hint.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  );

  function choose(item: CommandSearchItem) {
    onSelect(item);
    setQuery("");
    setOpen(false);
  }

  return (
    <View style={styles.wrapper} testID={testId}>
      <TextInput
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        placeholder={placeholder}
        placeholderTextColor={theme.colors["ink-3"]}
        value={query}
        onChangeText={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        style={styles.input}
        testID={testId ? `${testId}-input` : undefined}
      />
      {open ? (
        <View style={styles.list} accessibilityRole="menu" accessibilityLabel={label}>
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No matching commands</Text>
          ) : (
            filtered.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="menuitem"
                accessibilityLabel={`${item.label}: ${item.hint}`}
                onPress={() => choose(item)}
                style={styles.option}
              >
                <Text style={styles.optionLabel}>{item.label}</Text>
                <Text style={styles.optionHint}>{item.hint}</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing[3],
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      backgroundColor: theme.colors.field,
    },
    list: {
      borderRadius: theme.radii.control,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
      ...ringShadow(theme, "card"),
    },
    empty: {
      padding: theme.spacing[3],
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    option: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: theme.spacing[3],
      // Dashed hairline divider between command options (docs/beautiful-ui-
      // reference.md "the single most recognisable trait").
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.line,
    },
    optionLabel: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    optionHint: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default CommandSearch;
