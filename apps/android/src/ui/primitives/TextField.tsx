import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string;
  required?: boolean;
  testId?: string;
}

/**
 * TextField primitive (plan.md §10.3). The label is always visible text
 * above the input (never a placeholder-only label), and an error is
 * exposed both as visible text and folded into the input's accessible
 * name for TalkBack (plan.md §10.5 "non-color status text" +
 * "screen-reader role and state").
 */
export function TextField({ label, error, required, testId, ...rest }: TextFieldProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text accessibilityElementsHidden> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={error ? `${label}. ${error}` : label}
        accessibilityState={{ disabled: Boolean(rest.editable === false) }}
        placeholderTextColor={theme.colors["ink-3"]}
        testID={testId}
        style={[styles.input, error ? styles.inputError : null]}
        {...rest}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
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
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing[3],
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      // Beautiful UI's `field` role is the form-control fill (docs/beautiful-
      // ui-reference.md surface stack "page → canvas → surface → inset →
      // field"), distinct from a `surface` card background.
      backgroundColor: theme.colors.field,
    },
    inputError: { borderColor: theme.colors.status.danger.border },
    error: {
      color: theme.colors.status.danger.foreground,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
