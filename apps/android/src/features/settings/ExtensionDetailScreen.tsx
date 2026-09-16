import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "../../ui/primitives/Card";
import { Section } from "../../ui/primitives/Section";
import { ScreenBar } from "../../ui/recipes/ScreenBar";
import { useTheme } from "../../ui/theme/theme-context";
import { DRAWING_EXTENSIONS } from "./settings-extension-coverage";

export interface ExtensionDetailScreenProps {
  /** The extension namespace this screen describes, e.g. `"todo"` — a `DRAWING_EXTENSIONS` row's own `name`. */
  name: string;
  /** Closes back to Settings (ANDROID-EXT-1). Optional, same convention as `SettingsScreen`'s own `onClose`. */
  onBack?: () => void;
  testId?: string;
}

/**
 * One extension's static detail screen (ANDROID-EXT-1, plan.md §11.7).
 * Mounted at `/h/:serverId/extensions/:name` by
 * `app/h/[serverId]/extensions/[name].tsx`, reached by pressing a row in
 * `SettingsScreen.tsx`'s "Extensions that draw" list.
 *
 * Purely static documentation: it renders one `./settings-extension-
 * coverage.ts` row's `whereItDraws` prose and `contract` term/value
 * pairs as two labelled `Section`/`Card` groups, mirroring that row's
 * own two written facts. There is deliberately no runtime namespace ->
 * extension lookup here — `settings-extension-coverage.ts`'s own module
 * doc explains why none exists (`../extensions/registry.ts` maps a wire
 * `PiUiKind` to a renderer component, never an extension's own
 * namespace, so there is no live table to resolve one back out of). If
 * `name` does not match any row — reachable only if a caller passes a
 * `name` `DRAWING_EXTENSIONS` does not carry, never through the real
 * Settings-tab row press, which always passes one of its own rows' own
 * `name` — this renders an honest "not found" card instead of a blank
 * or crashing screen.
 */
export function ExtensionDetailScreen({ name, onBack, testId }: ExtensionDetailScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const row = DRAWING_EXTENSIONS.find((candidate) => candidate.name === name);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
      <ScreenBar
        title={row?.name ?? name}
        leading={
          onBack
            ? {
                mark: "‹",
                accessibleName: "Back to settings",
                onPress: onBack,
                testId: testId ? `${testId}-back` : undefined,
              }
            : undefined
        }
        testId={testId ? `${testId}-bar` : undefined}
      />
      {row ? (
        <>
          <Section
            title="Where it draws"
            variant="label"
            testId={testId ? `${testId}-where-section` : undefined}
          >
            <Card style={styles.card}>
              <Text style={styles.prose} testID={testId ? `${testId}-where-text` : undefined}>
                {row.whereItDraws}
              </Text>
            </Card>
          </Section>
          <Section
            title="Contract"
            variant="label"
            testId={testId ? `${testId}-contract-section` : undefined}
          >
            <Card style={styles.card}>
              {row.contract.map((entry, index) => (
                <View
                  key={entry.term}
                  style={[styles.contractRow, index === 0 ? null : styles.contractRowSpacing]}
                  testID={testId ? `${testId}-contract-${entry.term}` : undefined}
                >
                  <Text style={styles.contractTerm}>{entry.term}</Text>
                  <Text style={styles.contractValue}>{entry.value}</Text>
                </View>
              ))}
            </Card>
          </Section>
        </>
      ) : (
        <Section
          title="Not found"
          variant="label"
          testId={testId ? `${testId}-missing-section` : undefined}
        >
          <Card style={styles.card}>
            <Text style={styles.prose} testID={testId ? `${testId}-missing-text` : undefined}>
              {`"${name}" isn't one of the extensions this app draws a dedicated screen for.`}
            </Text>
          </Card>
        </Section>
      )}
    </ScrollView>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    card: { gap: theme.spacing[3] },
    prose: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
      lineHeight: theme.typography.variant.body.lineHeight,
    },
    contractRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing[3],
    },
    contractRowSpacing: { marginTop: theme.spacing[2] },
    contractTerm: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    contractValue: {
      flex: 1,
      textAlign: "right",
      color: theme.colors.ink,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
