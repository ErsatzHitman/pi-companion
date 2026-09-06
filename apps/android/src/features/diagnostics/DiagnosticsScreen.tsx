/**
 * Android diagnostics screen body (T42A3, plan.md §13 Phase 7:
 * "Diagnostics screen with versions, capabilities, connection path, and
 * exportable redacted logs"). Mirrors
 * `apps/web/src/features/diagnostics/DiagnosticsScreen.tsx` — same
 * unconditional render (no loading/error branch hiding the screen,
 * because `useDiagnosticsSnapshot` never has "no data" to wait on:
 * disconnected is itself a fully-formed, truthful snapshot), same
 * export-control-alongside-sections layout.
 *
 * All logic lives in `diagnostics-model.ts`/`diagnostics-export.ts`/
 * `use-diagnostics-snapshot.ts`/`use-diagnostics-export.ts`; this
 * component only renders. `react-native` component modules can't be
 * rendered under this workspace's plain `vitest` setup (the
 * "RN-in-vitest limitation" this repo's `CLAUDE.md` names) — like every
 * other screen in this tree, this file's real logic is proven by the
 * `-model.ts`/`-export.ts` unit tests, and this file's own shape by
 * `DiagnosticsScreen.test.ts`'s anchored source-text assertions.
 *
 * **Not mounted anywhere yet.** No route under `apps/android/src/app/`
 * renders this screen — `app/`/`app-shell/` are outside this task's
 * `Owns` grant this wave (mirrors `SettingsScreen.tsx`'s identical,
 * already-accepted disclosure). See this task's report for the exact
 * route file and props this needs.
 *
 * **No per-field copy action.** Web's `CopyableField.tsx` copies through
 * `@picompanion/frontend-core`'s `Clipboard` platform interface; Android
 * has no `Clipboard` implementation anywhere in `apps/android/src/
 * platform/` yet (confirmed: no `clipboard.ts` file exists there, unlike
 * `sharing.ts`/`secure-storage.ts`/every other platform interface this
 * app does implement) — installing one is outside this task's Owns grant
 * (`features/diagnostics/` only) and outside its stated acceptance
 * criteria. Values are rendered as plain, selectable-by-the-OS text
 * instead of a broken/no-op copy button — see this repository's "a
 * silent no-op is worse than a visible failure" rule, applied here as
 * "no affordance is safer than a fake one".
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { Sharing } from "@picompanion/frontend-core";

import { Button, Section, StatusIndicator } from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import type {
  DiagnosticsField,
  DiagnosticsHostProfile,
  DiagnosticsSection,
} from "./diagnostics-model.js";
import { useDiagnosticsExport } from "./use-diagnostics-export.js";
import {
  useDiagnosticsSnapshot,
  type DiagnosticsConnectionSource,
  type DiagnosticsDaemonClient,
} from "./use-diagnostics-snapshot.js";

export interface DiagnosticsScreenProps {
  appVersion: string;
  clientId: string;
  connectionSource: DiagnosticsConnectionSource;
  profile: DiagnosticsHostProfile | null;
  getDaemonClient: () => DiagnosticsDaemonClient | null;
  /**
   * Real Sharing sink for the export action. `undefined` renders the
   * screen with NO export control at all — never a button wired to
   * nothing (mirrors `files-screen.tsx`'s established "omit the
   * affordance entirely when its platform dependency is missing, rather
   * than rendering it broken" convention).
   */
  sharing?: Sharing;
  /** Overridable for deterministic tests/screenshots; defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  testId?: string;
}

function DiagnosticsFieldRow({ field, testId }: { field: DiagnosticsField; testId?: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createFieldStyles(theme), [theme]);
  return (
    <View style={styles.row} testID={testId}>
      <Text style={styles.label} testID={testId ? `${testId}-label` : undefined}>
        {field.label}
      </Text>
      <Text style={styles.value} selectable testID={testId ? `${testId}-value` : undefined}>
        {field.value}
      </Text>
    </View>
  );
}

function DiagnosticsSectionView({
  section,
  testId,
}: {
  section: DiagnosticsSection;
  testId?: string;
}) {
  return (
    <Section title={section.title} testId={testId ? `${testId}-${section.id}` : undefined}>
      {section.fields.map((field) => (
        <DiagnosticsFieldRow
          key={field.id}
          field={field}
          testId={testId ? `${testId}-${section.id}-${field.id}` : undefined}
        />
      ))}
    </Section>
  );
}

/**
 * The exportable-redacted-log half of this screen. Builds the SAME
 * `sections` already rendered above into one shared, redacted JSON
 * bundle (`diagnostics-export.ts`) — never a second, separately
 * maintained list of fields. A redaction refusal
 * (`DiagnosticsExportRedactionError`, surfaced by `useDiagnosticsExport`
 * as `state.status === "error"`) is shown as a visible failure, not a
 * silent no-op.
 */
function DiagnosticsExportControl({
  sections,
  appVersion,
  clientId,
  sharing,
  now,
  testId,
}: {
  sections: DiagnosticsSection[];
  appVersion: string;
  clientId: string;
  sharing: Sharing;
  now?: () => string;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createExportStyles(theme), [theme]);
  const { state, exportNow } = useDiagnosticsExport({
    sections,
    meta: { appVersion, clientId },
    sharing,
    now,
  });
  const statusTestId = testId ? `${testId}-status` : undefined;

  return (
    <View style={styles.root} testID={testId}>
      <Button
        kind="secondary"
        label="Export diagnostics"
        onPress={() => void exportNow()}
        testId={testId ? `${testId}-button` : undefined}
      />
      <Text style={styles.hint}>
        A redacted bundle of everything below — passwords, keys, and tokens in the connection
        endpoint are stripped before it is shared.
      </Text>
      {state.status === "success" ? (
        <StatusIndicator label="Export" tone="success" statusText="Shared" testId={statusTestId} />
      ) : null}
      {state.status === "error" ? (
        <StatusIndicator
          label="Export"
          tone="danger"
          statusText={`Export failed — ${state.error}`}
          testId={statusTestId}
        />
      ) : null}
    </View>
  );
}

export function DiagnosticsScreen({
  appVersion,
  clientId,
  connectionSource,
  profile,
  getDaemonClient,
  sharing,
  now,
  testId,
}: DiagnosticsScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createScreenStyles(theme), [theme]);
  const sections = useDiagnosticsSnapshot({
    appVersion,
    clientId,
    connectionSource,
    profile,
    getDaemonClient,
  });
  const exportTestId = testId ? `${testId}-export` : undefined;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
      <Text style={styles.intro}>
        Versions, capabilities, and connection path — every field below reflects this connection's
        real state, including while no daemon is reachable.
      </Text>
      {sharing ? (
        <DiagnosticsExportControl
          sections={sections}
          appVersion={appVersion}
          clientId={clientId}
          sharing={sharing}
          now={now}
          testId={exportTestId}
        />
      ) : null}
      {sections.map((section) => (
        <DiagnosticsSectionView key={section.id} section={section} testId={testId} />
      ))}
    </ScrollView>
  );
}

function createScreenStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    intro: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.body.fontWeight),
    },
  });
}

function createExportStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { gap: theme.spacing[2] },
    hint: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}

function createFieldStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { gap: theme.spacing[1], minHeight: 48, justifyContent: "center" },
    label: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    value: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}

export default DiagnosticsScreen;
