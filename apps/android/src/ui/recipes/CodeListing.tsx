import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/theme-context";

export interface CodeListingProps {
  path: string;
  language: string;
  code: string;
  highlightLine?: number;
  testId?: string;
}

/**
 * CodeListing recipe (plan.md §10.4): a file-path-labelled, numbered code
 * excerpt, e.g. a snippet Pi quotes while explaining a change, with an
 * optional highlighted line. Clean-specification recipe (plan.md §10.1),
 * layered on the same typography as the `CodeBlock` primitive.
 *
 * Accessibility (plan.md §10.5): line numbers are `accessibilityElementsHidden`
 * (a visual aid, not part of the accessible content); the highlighted
 * line gets a visible left border *and* an accessible label suffixed
 * "(changed line)" rather than colour alone.
 */
export function CodeListing({ path, language, code, highlightLine, testId }: CodeListingProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const lines = code.split("\n");

  return (
    <View style={styles.wrapper} testID={testId}>
      <View style={styles.header}>
        <Text style={styles.path} numberOfLines={1}>
          {path}
        </Text>
        <Text style={styles.language}>{language}</Text>
      </View>
      <ScrollView horizontal accessibilityRole="none">
        <View>
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const isHighlighted = lineNumber === highlightLine;
            return (
              <View
                key={lineNumber}
                style={[styles.line, isHighlighted ? styles.lineHighlighted : null]}
                accessible
                accessibilityLabel={`${line}${isHighlighted ? " (changed line)" : ""}`}
              >
                <Text style={styles.lineNumber} accessibilityElementsHidden>
                  {lineNumber}
                </Text>
                <Text style={styles.lineText}>{line}</Text>
              </View>
            );
          })}
        </View>
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
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      // Dashed hairline divider between the path header and the code body
      // (docs/beautiful-ui-reference.md "the single most recognisable
      // trait").
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.code.codeBorder,
    },
    path: {
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    language: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    line: {
      flexDirection: "row",
      paddingHorizontal: theme.spacing[3],
      borderLeftWidth: 2,
      borderLeftColor: "transparent",
    },
    lineHighlighted: {
      borderLeftColor: theme.colors.accent,
      backgroundColor: theme.colors["accent-tint"],
    },
    lineNumber: {
      width: 32,
      textAlign: "right",
      marginRight: theme.spacing[2],
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
    lineText: {
      color: theme.colors.code.codeForeground,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
  });
}

export default CodeListing;
