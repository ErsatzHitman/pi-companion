import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme-context";

export interface CodeBlockProps {
  code: string;
  language?: string;
  testId?: string;
}

/**
 * CodeBlock primitive (plan.md §10.3): a monospace, horizontally
 * scrollable code region with a visible language label. Syntax
 * highlighting (T29A's richer renderers) layers on top of this; the
 * primitive itself only guarantees layout and legibility.
 */
export function CodeBlock({ code, language, testId }: CodeBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrapper} testID={testId}>
      {language ? <Text style={styles.language}>{language}</Text> : null}
      <ScrollView horizontal accessibilityRole="none">
        <Text
          style={styles.code}
          accessibilityLabel={`Code${language ? ` (${language})` : ""}: ${code}`}
        >
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      backgroundColor: theme.colors.code.codeBackground,
      borderWidth: 1,
      borderColor: theme.colors.code.codeBorder,
      borderRadius: theme.radii.control,
      padding: theme.spacing[3],
    },
    language: {
      color: theme.colors["ink-3"],
      // Geist Mono for "paths, keys and log lines" (docs/beautiful-ui-
      // reference.md).
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      marginBottom: theme.spacing[1],
    },
    code: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      lineHeight: theme.typography.variant.code.lineHeight,
      color: theme.colors.code.codeForeground,
    },
  });
}
