import { useMemo, type Ref } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";

import { useTheme } from "../theme/theme-context";

export interface SearchFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  /**
   * T362: so a caller's own search affordance can move the cursor
   * here. A1's top bar carries the artifact's search mark beside the
   * title while the field itself sits in the body below, and a second
   * search button that did nothing would be worse than none. React 19
   * passes `ref` as an ordinary prop, so no `forwardRef` wrapper is
   * needed.
   */
  ref?: Ref<TextInput>;
  testId?: string;
}

/**
 * SearchField primitive (plan.md §10.3): `returnKeyType="search"` for the
 * right IME affordance, with the label carried purely as
 * `accessibilityLabel` — search fields are conventionally unlabelled
 * visually but must still expose an accessible name (plan.md §10.5).
 */
export function SearchField({ label, ref, testId, ...rest }: SearchFieldProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <TextInput
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="search"
      returnKeyType="search"
      placeholderTextColor={theme.colors["ink-3"]}
      testID={testId}
      style={styles.input}
      {...rest}
    />
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.full,
      paddingHorizontal: theme.spacing[4],
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      backgroundColor: theme.colors.field,
    },
  });
}
