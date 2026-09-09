import { useEffect, useMemo, useState } from "react";
import Animated from "react-native-reanimated";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/Banner";
import { Card } from "../../ui/primitives/Card";
import { Divider } from "../../ui/primitives/Divider";
import { Section } from "../../ui/primitives/Section";
import { Toggle } from "../../ui/primitives/Toggle";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { usePressScale } from "../../ui/theme/use-press-scale";
import { createSettingsController, type SettingsSnapshot } from "./settings-model";

export interface SettingsScreenProps {
  /** `AppCore.keyValueStorage` — the same plain-storage instance every other durable-preference read in this app uses (`OnboardingGate.tsx`, `credential-store.ts`'s `plainStorage`). Never `AsyncStorage` directly. */
  storage: KeyValueStorage;
  /**
   * Renders a "Devices" row only when supplied (T301) — the "omit the
   * affordance entirely rather than render it broken" convention
   * `../devices/DevicesScreen.tsx`'s own doc comment establishes, applied
   * here to a MISSING callback rather than a missing capability. Kept a
   * callback prop rather than importing `useRouter()` into this
   * platform-neutral-shaped module — `app/h/[serverId]/(tabs)/
   * settings.tsx` wires it from `../settings-navigation-model.ts`'s
   * `pressOpenDevices`, so this component stays renderable/testable with
   * no router at all.
   */
  onOpenDevices?: () => void;
  /** Same convention as `onOpenDevices`, for `/h/:serverId/diagnostics` (T301), wired from `settings-navigation-model.ts`'s `pressOpenDiagnostics`. */
  onOpenDiagnostics?: () => void;
  testId?: string;
}

/**
 * App settings (T32C1, plan.md §9.3). Today the one persisted setting is
 * the haptics toggle both `features/approvals/use-approvals-queue.ts` and
 * `features/transcript/transcript-status-haptics-model.ts` need — see
 * this task's report for the two-line seam filed at each real call
 * site, which live outside this task's `Owns` grant.
 *
 * All persistence/default/validation logic lives in `settings-model.ts`,
 * unit tested there; this component only renders the current snapshot
 * and forwards the toggle press — mirrors `OnboardingGate.tsx`'s
 * controller/view split exactly.
 *
 * **Mounted at `/h/:serverId/settings`** by
 * `app/h/[serverId]/(tabs)/settings.tsx` (T32S11).
 *
 * **Devices/Diagnostics entry point (T301).** Before this task,
 * `/h/:serverId/devices` and `/h/:serverId/diagnostics` were real,
 * already-mounted, already-tested routes with no in-app control that
 * navigated to either — `../devices/DevicesScreen.tsx`'s own doc comment
 * named this exact gap and the seam that would close it. `onOpenDevices`/
 * `onOpenDiagnostics` are that seam: each renders its own row in a
 * dedicated "More" section, independently of the other, and neither row
 * renders at all when its callback prop is omitted — so a caller that
 * cannot yet wire one of the two never ships a dead row for it.
 */
export function SettingsScreen({
  storage,
  onOpenDevices,
  onOpenDiagnostics,
  testId,
}: SettingsScreenProps) {
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
      {onOpenDevices || onOpenDiagnostics ? (
        <Section title="More" testId={testId ? `${testId}-more-section` : undefined}>
          <Card style={styles.navCard}>
            {onOpenDevices ? (
              <NavRow
                label="Devices"
                onPress={onOpenDevices}
                testId={testId ? `${testId}-devices-row` : undefined}
              />
            ) : null}
            {onOpenDevices && onOpenDiagnostics ? <Divider /> : null}
            {onOpenDiagnostics ? (
              <NavRow
                label="Diagnostics"
                onPress={onOpenDiagnostics}
                testId={testId ? `${testId}-diagnostics-row` : undefined}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}
    </ScrollView>
  );
}

/**
 * A tappable settings row that navigates elsewhere, distinct from
 * `Toggle`'s in-place control. Full 48dp `Pressable` hit target with the
 * inner `Animated.View` carrying the tighter visual chrome and
 * `usePressScale`'s press feedback — the same split `Button.tsx` uses,
 * so this row gets Beautiful UI's `active:scale-[0.96]` feedback and a
 * real TalkBack `button` role for free.
 */
function NavRow({
  label,
  onPress,
  testId,
}: {
  label: string;
  onPress: () => void;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createNavRowStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testId}
      style={styles.touchArea}
    >
      <Animated.View style={[styles.row, pressStyle]}>
        <Text style={styles.label}>{label}</Text>
        <Text
          style={styles.chevron}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {"›"}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    card: { gap: theme.spacing[3] },
    navCard: { padding: 0, overflow: "hidden" },
    hint: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
  });
}

function createNavRowStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: { minHeight: 48, justifyContent: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
    },
    label: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    chevron: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.heading.fontSize,
    },
  });
}
