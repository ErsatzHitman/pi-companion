import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/Banner";
import { Card } from "../../ui/primitives/Card";
import { Section } from "../../ui/primitives/Section";
import { Toggle } from "../../ui/primitives/Toggle";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { createSettingsController, type SettingsSnapshot } from "./settings-model";

export interface SettingsScreenProps {
  /** `AppCore.keyValueStorage` — the same plain-storage instance every other durable-preference read in this app uses (`OnboardingGate.tsx`, `credential-store.ts`'s `plainStorage`). Never `AsyncStorage` directly. */
  storage: KeyValueStorage;
  testId?: string;
}

/**
 * App settings (T32C1, plan.md §9.3). Today the one setting is the
 * haptics toggle both `features/approvals/use-approvals-queue.ts` and
 * `features/transcript/transcript-status-haptics-model.ts` need — see
 * this task's report for the two-line seam filed at each real call
 * site, which live outside this task's `Owns` grant.
 *
 * All persistence/default/validation logic lives in `settings-model.ts`,
 * unit tested there; this component only renders the current snapshot
 * and forwards the toggle press — mirrors `OnboardingGate.tsx`'s
 * controller/view split exactly.
 *
 * **Not mounted anywhere yet.** No route entry exists in `apps/android/
 * src/app/` for a settings screen, and `app/`/`app-shell/` are outside
 * this task's grant this wave — see this task's report, addressed to
 * T32S11, for the exact route file and props this needs.
 */
export function SettingsScreen({ storage, testId }: SettingsScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const controller = useMemo(() => createSettingsController({ storage }), [storage]);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(controller.getSnapshot());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.load();
    return unsubscribe;
  }, [controller]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
      <Section title="Settings">
        <Card style={styles.card}>
          {snapshot.loadError ? (
            <Banner
              tone="info"
              message="Couldn't read your saved settings, so defaults are in use."
              testId={testId ? `${testId}-load-error` : undefined}
            />
          ) : null}
          <Toggle
            label="Haptics"
            checked={snapshot.hapticsEnabled}
            onCheckedChange={(checked) => void controller.setHapticsEnabled(checked)}
            testId={testId ? `${testId}-haptics-toggle` : undefined}
          />
          <Text style={styles.hint}>
            Vibrate for approvals, blocked turns, and finished or failed runs.
          </Text>
        </Card>
      </Section>
    </ScrollView>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    card: { gap: theme.spacing[3] },
    hint: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
  });
}
