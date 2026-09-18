import { useEffect, useMemo, useState } from "react";
import Animated from "react-native-reanimated";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import type { DaemonConnectionPhase } from "../connect/daemon-connection-store";

import { Banner } from "../../ui/primitives/Banner";
import { Card } from "../../ui/primitives/Card";
import { Divider } from "../../ui/primitives/Divider";
import { PadEntrance } from "../../ui/primitives/PadEntrance";
import { Section } from "../../ui/primitives/Section";
import { StatusPill } from "../../ui/primitives/StatusPill";
import { ScreenBar } from "../../ui/recipes/ScreenBar";
import { Toggle } from "../../ui/primitives/Toggle";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import { usePressScale } from "../../ui/theme/use-press-scale";
import { createSettingsController, type SettingsSnapshot } from "./settings-model";
import { DRAWING_EXTENSIONS, silentExtensionsSummary } from "./settings-extension-coverage";
import { VoiceVocabularySection } from "../voice";
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
   * Opens one extension's static detail screen (ANDROID-EXT-1), given
   * its `name`. Same omit-when-absent convention as `onOpenDevices`/
   * `onOpenDiagnostics` above, wired from `(tabs)/settings.tsx` through
   * `settings-navigation-model.ts`'s `pressOpenExtension`. Unlike those
   * two this is per-row rather than per-section: each row in "Extensions
   * that draw" below calls it with its own `row.name`, so a caller
   * without a router still gets a rendered (if unpressable-looking) list
   * rather than losing the whole section.
   */
  onOpenExtension?: (name: string) => void;
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
 * App settings (T32C1, plan.md §9.3). The persisted settings are the
 * haptics toggle both `features/approvals/use-approvals-queue.ts` and
 * `features/transcript/transcript-status-haptics-model.ts` need — see
 * this task's report for the two-line seam filed at each real call
 * site, which live outside this task's `Owns` grant — and the voice
 * vocabulary list, owned by `../voice/voice-vocabulary-model.ts` and
 * drawn by its `VoiceVocabularySection` (mounted below, between "On
 * this device" and "More").
 *
 * All persistence/default/validation logic lives in `settings-model.ts`,
 * unit tested there; this component only renders the current snapshot
 * and forwards the toggle press — mirrors `OnboardingGate.tsx`'s
 * controller/view split exactly. The voice vocabulary list below it is the
 * same split one level down: `../voice/voice-vocabulary-model.ts` owns
 * the store, `../voice/voice-vocabulary-section.tsx` draws it, and this
 * screen only mounts that section with the same `storage` it already
 * receives.
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
 * **Two of `HANDOFF.md` §7.5's rows are deliberately not drawn, and
 * this is the reason.** Model and Thinking effort, and Auto-compaction
 * and "Ask before every tool", are per-AGENT on the wire: every method
 * that reads or writes them (`session-controls-model.ts`'s
 * `listProviderModes`, `setAgentMode`, `getAutoCompaction`,
 * `setAutoCompaction`) takes an `agentId`, and this screen is
 * per-host — it has no session to name. Drawing them here would mean
 * either a local preference nothing on the wire reads, or a control
 * that silently applied to one arbitrary session. Both are worse than
 * their absence, and both pairs of rows are already reachable where
 * they belong: the session's own prompt controls menu.
 *
 * **UI-A5 — the other two of §7.5's regions are informational, not
 * per-agent state, and are drawn.** The "extensions that draw" list and
 * the "Loaded but silent" card name CAPABILITIES this app supports —
 * which extension namespaces get a dedicated Pi UI Bridge element and
 * which only change agent behavior — not live state belonging to any
 * one session, so the per-agent argument above does not apply to them.
 * Both are static, honest copy sourced from plan.md §11.7 rather than
 * the mockup's own invented sample text, via
 * `./settings-extension-coverage.ts` — that module's own doc comment
 * explains why: neither `../extensions/registry.ts` nor any sibling
 * renderer module keeps a namespace -> extension-name table at runtime
 * for this to read back live.
 *
 * **PAD-FADEUP — A3's own `.pad>.row,.pad>.card` entrance
 * (`android-spec.html`).** This screen has no single flat `.pad` of
 * `.lbl`/`.row`/`.card` siblings the way the spec's raw markup does — it
 * is a `Section`+`Card` pair per group, and `Section` (not owned by this
 * task) renders its own label and children as one unit, so there is no
 * separate JSX slot to wrap a bare label in. The chosen mapping: each
 * `Section`'s label is left unwrapped (it is never a `.row`/`.card` kind
 * either way and renders identically whether or not it is passed through
 * `PadEntrance`) but still CONSUMES one zero-based `.pad`-sibling
 * position — see `pad-entrance-model.ts`'s own doc comment, section 1,
 * for why a `.lbl`-kind sibling must still be counted — and each
 * group's `Card` (or, for the voice-vocabulary group, the whole
 * `VoiceVocabularySection` — a real settings block, closer to a `.card`
 * than a bare label, even though this task does not own that file to
 * wrap its own internal Card) is wrapped in `PadEntrance` at the next
 * position. Positions, in render order: Host label (0, unwrapped) / Host
 * card (1, nth-child(2) -> 45ms) / On-this-device label (2, unwrapped)
 * / Haptics card (3, nth-child(4) -> 135ms) / VoiceVocabularySection
 * (4, nth-child(5) -> 180ms) / Extensions-that-draw label (5,
 * unwrapped) / Extensions card (6, nth-child(7) -> 270ms) / Loaded-but-
 * silent label (7, unwrapped) / Loaded-but-silent card (8, past
 * PAD_ENTRANCE_LAST_STAGGERED_CHILD -> 0ms, the spec-literal choice —
 * see `pad-entrance-model.ts`'s doc comment, section 2) / More label (9,
 * unwrapped, only when `onOpenDevices`/`onOpenDiagnostics` render the
 * section at all) / More card (10, also past the schedule -> 0ms).
 */
const PAD_POSITION_HOST_CARD = 1;
const PAD_POSITION_HAPTICS_CARD = 3;
const PAD_POSITION_VOICE_VOCABULARY = 4;
const PAD_POSITION_EXTENSIONS_CARD = 6;
const PAD_POSITION_SILENT_CARD = 8;
const PAD_POSITION_MORE_CARD = 10;

export function SettingsScreen({
  storage,
  onOpenDevices,
  onOpenDiagnostics,
  onOpenExtension,
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
        <PadEntrance kind="card" position={PAD_POSITION_HOST_CARD}>
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
        </PadEntrance>
      </Section>
      <Section title="On this device" variant="label">
        <PadEntrance kind="card" position={PAD_POSITION_HAPTICS_CARD}>
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
        </PadEntrance>
      </Section>
      <PadEntrance kind="card" position={PAD_POSITION_VOICE_VOCABULARY}>
        <VoiceVocabularySection
          storage={storage}
          testId={testId ? `${testId}-voice-vocabulary` : undefined}
        />
      </PadEntrance>
      {/*
        UI-A5: the two informational A3 regions the module doc's
        "other two ... are informational" paragraph describes — static,
        honest copy from `./settings-extension-coverage.ts`. Each row in
        "Extensions that draw" is a Pressable (ANDROID-EXT-1) opening
        that extension's own static detail screen via onOpenExtension;
        "Loaded but silent" stays a plain card, since none of its
        namespaces has a detail screen to open.
      */}
      <Section
        title="Extensions that draw"
        variant="label"
        testId={testId ? `${testId}-extensions-drawing-section` : undefined}
      >
        <PadEntrance kind="card" position={PAD_POSITION_EXTENSIONS_CARD}>
          <Card style={styles.navCard}>
            {DRAWING_EXTENSIONS.map((row, index) => (
              <View key={row.name}>
                <ExtensionRow
                  name={row.name}
                  description={row.description}
                  onPress={onOpenExtension ? () => onOpenExtension(row.name) : undefined}
                  testId={testId ? `${testId}-extension-${row.name}` : undefined}
                />
                {index < DRAWING_EXTENSIONS.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
        </PadEntrance>
      </Section>
      <Section
        title="Loaded but silent"
        variant="label"
        testId={testId ? `${testId}-extensions-silent-section` : undefined}
      >
        <PadEntrance kind="card" position={PAD_POSITION_SILENT_CARD}>
          <Card style={styles.card}>
            <Text
              style={styles.silentSummary}
              testID={testId ? `${testId}-extensions-silent-summary` : undefined}
            >
              {silentExtensionsSummary()}
            </Text>
          </Card>
        </PadEntrance>
      </Section>
      {onOpenDevices || onOpenDiagnostics ? (
        <Section
          title="More"
          variant="label"
          testId={testId ? `${testId}-more-section` : undefined}
        >
          <PadEntrance kind="card" position={PAD_POSITION_MORE_CARD}>
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
          </PadEntrance>
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

/**
 * One row of "Extensions that draw" (ANDROID-EXT-1): the same 48dp
 * `Pressable`/`usePressScale` shape `NavRow` above uses, applied to a
 * name-then-description stack instead of a single label. Opens
 * `ExtensionDetailScreen.tsx` for `name` via `onPress` when the caller
 * supplies `onOpenExtension`; when it does not (the same
 * omit-affordance-when-absent convention `onOpenDevices`/
 * `onOpenDiagnostics` use), the row still renders its copy but carries
 * no `Pressable`, no chevron, and no button role — never an unpressable
 * button pretending it works.
 */
function ExtensionRow({
  name,
  description,
  onPress,
  testId,
}: {
  name: string;
  description: string;
  onPress?: () => void;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createExtensionRowStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();

  const content = (
    <View style={styles.textGroup}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );

  if (!onPress) {
    return (
      <View style={styles.touchArea} testID={testId}>
        <View style={styles.row}>{content}</View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${description}`}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testId}
      style={styles.touchArea}
    >
      <Animated.View style={[styles.row, pressStyle]}>
        {content}
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
    // UI-A5: the "Loaded but silent" card's paragraph, mirroring the
    // mockup's `.card p`.
    silentSummary: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
      lineHeight: theme.typography.variant.body.lineHeight,
    },
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

function createExtensionRowStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: { minHeight: 48, justifyContent: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
    },
    // UI-A5: the extensions-that-draw row's name-then-description
    // stack, mirroring the mockup's `.row .n`/`.s` shape via theme
    // tokens.
    textGroup: { flex: 1, gap: 2 },
    name: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.fontWeight.medium),
    },
    description: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    chevron: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.heading.fontSize,
    },
  });
}
