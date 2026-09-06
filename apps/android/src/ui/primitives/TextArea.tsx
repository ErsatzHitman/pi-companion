import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface TextAreaProps extends Omit<TextInputProps, "style" | "multiline"> {
  label: string;
  error?: string;
  required?: boolean;
  testId?: string;
}

/** TextArea primitive (plan.md §10.3); same label/error contract as `TextField`, multiline. */
export function TextArea({ label, error, required, testId, ...rest }: TextAreaProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text accessibilityElementsHidden> *</Text> : null}
      </Text>
      <TextInput
        multiline
        accessibilityLabel={error ? `${label}. ${error}` : label}
        placeholderTextColor={theme.colors["ink-3"]}
        testID={testId}
        style={[styles.input, error ? styles.inputError : null]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
      minHeight: 96,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      backgroundColor: theme.colors.field,
      textAlignVertical: "top",
    },
    inputError: { borderColor: theme.colors.status.danger.border },
    error: {
      color: theme.colors.status.danger.foreground,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
