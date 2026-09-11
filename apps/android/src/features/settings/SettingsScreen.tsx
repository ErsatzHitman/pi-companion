import { useEffect, useMemo, useState } from "react";
import Animated from "react-native-reanimated";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import type { DaemonConnectionPhase } from "../connect/daemon-connection-store";

import { Banner } from "../../ui/primitives/Banner";
import { Card } from "../../ui/primitives/Card";
import { Divider } from "../../ui/primitives/Divider";
import { Section } from "../../ui/primitives/Section";
import { StatusPill } from "../../ui/primitives/StatusPill";
import { ScreenBar } from "../../ui/recipes/ScreenBar";
import { Toggle } from "../../ui/primitives/Toggle";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { usePressScale } from "../../ui/theme/use-press-scale";
import { createSettingsController, type SettingsSnapshot } from "./settings-model";
import {
  settingsHostAccessibilityLabel,
  settingsHostDetail,
  settingsHostStatus,
  settingsHostTitle,
  type SettingsHostProfileView,
} from "./settings-host-model";

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
  /**
   * The saved profile this screen's host row describes (T366), or
   * `null` while none is loaded. The caller reads it — this component
   * touches no credential store, and takes the four non-secret fields
   * `settings-host-model.ts` declares rather than a whole
   * `HostProfileRecord`.
   */
  hostProfile?: SettingsHostProfileView | null;
  /** The live connection phase behind the host row's pill (T366). Defaults to `"idle"`, which reads "Not connected". */
  connectionPhase?: DaemonConnectionPhase;
  /** A3's bar closes back to wherever the reader came from (T366). Optional: as a tab there is nothing to close back to. */
  onClose?: () => void;
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
 *
 * **T366 — A3's shape.** The screen opens with the shared `ScreenBar`,
 * its groups are labelled in the redesign's quiet `.lbl` style
 * (`Section`'s `variant="label"`), and the first of them names the host
 * every setting below belongs to, with a live status pill. Nothing here
 * said which daemon it was about before.
 *
 * **Four of `HANDOFF.md` §7.5's rows are deliberately not drawn, and
 * this is the reason.** Model, Thinking effort, Auto-compaction and
 * "Ask before every tool" are per-AGENT on the wire: every method that
 * reads or writes them (`session-controls-model.ts`'s
 * `listProviderModes`, `setAgentMode`, `getAutoCompaction`,
 * `setAutoCompaction`) takes an `agentId`, and this screen is
 * per-host — it has no session to name. Drawing them here would mean
 * either a local preference nothing on the wire reads, or a control
 * that silently applied to one arbitrary session. Both are worse than
 * their absence, and all four are already reachable where they belong:
 * the session's own context-ring menu. The same argument covers §7.5's
 * extension rows and its "Loaded but silent" card — which extensions
 * have drawn is state a session accumulates, not a property of a host.
 */
export function SettingsScreen({
  storage,
  onOpenDevices,
  onOpenDiagnostics,
  hostProfile = null,
  connectionPhase = "idle",
  onClose,
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
      <ScreenBar
        title="Settings"
        leading={
          onClose
            ? {
                mark: "\u2039",
                accessibleName: "Close settings",
                onPress: onClose,
                testId: testId ? `${testId}-close` : undefined,
              }
            : undefined
        }
        testId={testId ? `${testId}-bar` : undefined}
      />
      <Section title="Host" variant="label" testId={testId ? `${testId}-host-section` : undefined}>
        <Card style={styles.card}>
          <View
            accessible
            accessibilityLabel={settingsHostAccessibilityLabel(hostProfile, connectionPhase)}
            style={styles.hostRow}
            testID={testId ? `${testId}-host-row` : undefined}
          >
            <View style={styles.hostText}>
              <Text style={styles.hostTitle} numberOfLines={1}>
                {settingsHostTitle(hostProfile)}
              </Text>
              <Text style={styles.hostDetail} numberOfLines={1}>
                {settingsHostDetail(hostProfile)}
              </Text>
            </View>
            <StatusPill
              label={settingsHostStatus(connectionPhase).label}
              tone={settingsHostStatus(connectionPhase).tone}
              showDot
              testId={testId ? `${testId}-host-status` : undefined}
            />
          </View>
        </Card>
      </Section>
      <Section title="On this device" variant="label">
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
        <Section
          title="More"
          variant="label"
          testId={testId ? `${testId}-more-section` : undefined}
        >
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
    hostRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
    hostText: { flex: 1, gap: 2 },
    hostTitle: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.fontWeight.medium),
    },
    hostDetail: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
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
