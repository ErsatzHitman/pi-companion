/**
 * Android devices screen (T42A1, plan.md §9.3 devices surface — see
 * `docs/issues-from-plan.md`'s T42A1 acceptance boxes). Mirrors
 * `../diagnostics/DiagnosticsScreen.tsx`'s controller/view split exactly:
 * all logic lives in `trusted-devices-model.ts`/`use-trusted-devices.ts`/
 * `device-push-status-model.ts`/`use-device-push-status.ts`; this
 * component only renders. `react-native` component modules can't be
 * rendered under this workspace's plain `vitest` setup (the
 * "RN-in-vitest limitation" this repo's `CLAUDE.md` names) — like every
 * other screen in this tree, this file's own shape is proven by
 * `DevicesScreen.test.ts`'s anchored source-text assertions.
 *
 * **Mounted at `/h/:serverId/devices`** by `app/h/[serverId]/devices.tsx`
 * — the one route this task's `Owns` grant permits (`features/devices/`
 * only, per this task's brief).
 *
 * **Nothing currently taps a UI element to reach this route.** That is
 * the same state `../diagnostics/DiagnosticsScreen.tsx` shipped in at
 * T42A3 and still carries as of this task (confirmed by grep: no `Link`
 * or `router.push` targeting `/diagnostics` or `/devices` exists anywhere
 * under `apps/android/src` outside those two routes' own files). Filed
 * rather than hidden — see this task's report for the exact seam that
 * would close it: an `onOpenDevices` callback prop added to
 * `../settings/SettingsScreen.tsx` (rendering a "Devices" row only when
 * it is supplied, the same "omit the affordance entirely rather than
 * render it broken" convention `DiagnosticsScreen.tsx`'s missing-Clipboard
 * note already establishes), wired from `useRouter().push(...)` in
 * `app/h/[serverId]/(tabs)/settings.tsx` — both outside this task's Owns
 * grant (`features/devices/**` plus the one route file), so neither is
 * touched here.
 *
 * **Revocation is NOT this screen's job — T42A2 owns it.** The seam this
 * screen leaves: `DeviceRow` below takes no action prop today. T42A2
 * should add an `onRevoke?: (clientId: string) => void` prop to
 * `DevicesScreen`, thread it into `DeviceRow`, and render a "Revoke"
 * `Button` only when it is supplied (never a disabled/dead one). Wire it
 * from the route via
 * `core.connection.getActiveLifecycle()?.getDaemonClient()?.
 * revokeTrustedDevice(clientId)`, then call this screen's own `refresh()`
 * (returned by `useTrustedDevices`, not currently exposed outside this
 * file) on a successful revoke so the device disappears without a manual
 * reload — see `trusted-devices-model.ts`'s header for why
 * `revokeTrustedDevice` itself is deliberately absent from that module.
 *
 * **Never a secret on screen.** See `trusted-devices-model.ts`'s "Never a
 * secret on screen" section — the wire payload carries no password, key,
 * or token, and `summarizeTrustedDevice` is an explicit allow-list
 * projection. This device's own push-registration TOKEN never reaches
 * this component at all — see `device-push-status-model.ts`'s header.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Section,
  StatusIndicator,
} from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import type { PermissionState } from "../composer/permission-recovery.js";
import { describeDevicePushStatus } from "./device-push-status-model.js";
import {
  sortTrustedDevices,
  summarizeTrustedDevice,
  type TrustedDeviceRowSummary,
  type TrustedDevicesClient,
} from "./trusted-devices-model.js";
import { useDevicePushStatus } from "./use-device-push-status.js";
import { useTrustedDevices } from "./use-trusted-devices.js";

export interface DevicesScreenProps {
  /** This app's own daemon `clientId` (`ANDROID_DAEMON_CLIENT_ID`) — used only to mark which row is "This device", never to filter it out. */
  thisClientId: string;
  getClient: () => TrustedDevicesClient | null;
  getPermissionStatus: () => Promise<PermissionState>;
  isRegistered: () => boolean;
  subscribeToConnectionChanges?: (onChange: () => void) => () => void;
  /** Overridable for deterministic tests/screenshots; defaults to `() => new Date()`. */
  now?: () => Date;
  testId?: string;
}

function DeviceRow({ summary, testId }: { summary: TrustedDeviceRowSummary; testId?: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createRowStyles(theme), [theme]);
  return (
    <View style={styles.row} testID={testId}>
      <View style={styles.headline}>
        <Text
          style={styles.clientId}
          selectable
          testID={testId ? `${testId}-client-id` : undefined}
        >
          {summary.clientId}
        </Text>
        {summary.isThisDevice ? (
          <Text style={styles.badge} testID={testId ? `${testId}-this-device` : undefined}>
            This device
          </Text>
        ) : null}
      </View>
      <StatusIndicator
        label="Status"
        tone={summary.connected ? "success" : "neutral"}
        statusText={summary.connected ? "Connected" : "Not connected"}
        testId={testId ? `${testId}-status` : undefined}
      />
      <Text style={styles.meta}>{summary.appVersionLabel}</Text>
      <Text style={styles.meta}>Last seen {summary.lastSeenLabel}</Text>
    </View>
  );
}

export function DevicesScreen({
  thisClientId,
  getClient,
  getPermissionStatus,
  isRegistered,
  subscribeToConnectionChanges,
  now,
  testId,
}: DevicesScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createScreenStyles(theme), [theme]);

  const { snapshot, refresh: refreshDevices } = useTrustedDevices({
    getClient,
    subscribeToConnectionChanges,
  });
  const { snapshot: pushStatus, refresh: refreshPushStatus } = useDevicePushStatus({
    getPermissionStatus,
    isRegistered,
    subscribeToConnectionChanges,
  });

  const rows = useMemo(() => {
    const sorted = sortTrustedDevices(snapshot.devices, thisClientId);
    const asOf = now?.();
    return sorted.map((device) => summarizeTrustedDevice(device, { thisClientId, now: asOf }));
  }, [snapshot.devices, thisClientId, now]);

  function handleRefresh(): void {
    refreshDevices();
    refreshPushStatus();
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID={testId}>
      <Section title="This device" testId={testId ? `${testId}-this-device-section` : undefined}>
        <Card style={styles.card}>
          <Text style={styles.pushStatus} testID={testId ? `${testId}-push-status` : undefined}>
            {describeDevicePushStatus(pushStatus)}
          </Text>
        </Card>
      </Section>
      <Section title="Trusted devices" testId={testId ? `${testId}-devices-section` : undefined}>
        <Button
          kind="secondary"
          label="Refresh"
          onPress={handleRefresh}
          testId={testId ? `${testId}-refresh` : undefined}
        />
        {snapshot.status === "loaded" && rows.length === 0 ? (
          <EmptyState
            title="No trusted devices"
            description="No device has connected to this daemon yet."
            testId={testId ? `${testId}-empty` : undefined}
          />
        ) : null}
        {snapshot.status === "unavailable" ? (
          <EmptyState
            title="Device list unavailable"
            description="This connection can't list trusted devices yet."
            testId={testId ? `${testId}-unavailable` : undefined}
          />
        ) : null}
        {snapshot.status === "error" ? (
          <ErrorState
            title="Couldn't load trusted devices"
            description={snapshot.error ?? "Something went wrong."}
            testId={testId ? `${testId}-error` : undefined}
          />
        ) : null}
        {rows.map((summary) => (
          <DeviceRow
            key={summary.clientId}
            summary={summary}
            testId={testId ? `${testId}-device-${summary.clientId}` : undefined}
          />
        ))}
      </Section>
    </ScrollView>
  );
}

function createScreenStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    container: { padding: theme.spacing[4], gap: theme.spacing[4] },
    card: { gap: theme.spacing[2] },
    pushStatus: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}

function createRowStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[3],
      minHeight: 48,
      // Dashed hairline row divider (docs/beautiful-ui-reference.md "the
      // single most recognisable trait") — same treatment
      // `../../ui/primitives/RecordList.tsx` uses for a device/record row.
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.line,
    },
    headline: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
    clientId: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    badge: {
      color: theme.colors.accent,
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    meta: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.label.fontSize,
    },
  });
}

export default DevicesScreen;
