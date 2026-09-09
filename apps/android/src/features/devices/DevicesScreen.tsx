/**
 * Android devices screen (T42A1/T42A2, plan.md §9.3 devices surface —
 * see `docs/issues-from-plan.md`'s T42A1/T42A2 acceptance boxes). Mirrors
 * `../diagnostics/DiagnosticsScreen.tsx`'s controller/view split exactly:
 * all logic lives in `trusted-devices-model.ts`/`use-trusted-devices.ts`/
 * `device-push-status-model.ts`/`use-device-push-status.ts`/
 * `revoke-device-model.ts`; this component only renders. `react-native`
 * component modules can't be rendered under this workspace's plain
 * `vitest` setup (the "RN-in-vitest limitation" this repo's `CLAUDE.md`
 * names) — like every other screen in this tree, this file's own shape
 * is proven by `DevicesScreen.test.ts`'s anchored source-text assertions.
 *
 * **Mounted at `/h/:serverId/devices`** by `app/h/[serverId]/devices.tsx`
 * — the one route this task's `Owns` grant permits (`features/devices/`
 * only, per this task's brief).
 *
 * **Reachable from the Settings tab (T301).** This was the same
 * unreachable state `../diagnostics/DiagnosticsScreen.tsx` shipped in at
 * T42A3 — no `Link` or `router.push` anywhere under `apps/android/src`
 * targeted `/diagnostics` or `/devices` outside those two routes' own
 * files, confirmed by grep at the time. T301 closed it exactly the way
 * this comment used to describe it should be closed: a "Devices" row on
 * `../settings/SettingsScreen.tsx`, rendered only when its
 * `onOpenDevices` callback prop is supplied (the same "omit the
 * affordance entirely rather than render it broken" convention
 * `DiagnosticsScreen.tsx`'s missing-Clipboard note establishes), wired
 * from `features/settings/settings-navigation-model.ts`'s
 * `pressOpenDevices` inside `app/h/[serverId]/(tabs)/settings.tsx`'s real
 * `useRouter()`.
 *
 * **Revocation (T42A2).** `DeviceRow` renders a "Revoke" `Button` only
 * for a device that both (a) isn't this device (`isThisDevice`, matching
 * `packages/server/src/server/websocket-server.ts`'s own
 * `handleTrustedDeviceRevokeRequest` "Cannot revoke current device"
 * rule — this screen simply never offers the dead end) and (b) has a
 * client that actually supports it (`canRevoke`, below — never a
 * disabled/dead button). Tapping it opens `revoke-device-model.ts`'s
 * confirmation dialog (`RevokeDeviceState.target`); only confirming it
 * (`handleConfirmRevoke`) calls `getClient()?.revokeTrustedDevice`, never
 * a single tap. There is no separate `onRevoke` prop — see
 * `revoke-device-model.ts`'s header ("Why there is no separate `onRevoke`
 * prop") for why revocation goes through the same `getClient()` accessor
 * listing already uses. A successful revoke calls this screen's own
 * `refreshDevices()` so the device disappears without a manual reload; a
 * failure surfaces as a named `Banner`, and the row stays present.
 *
 * CORRECTED (T300): this section used to say "a revoked device cannot
 * silently re-register" was NOT true end-to-end, naming it as a
 * `packages/server` gap this task's `Owns` grant forbade fixing here. T300
 * closed that gap in `packages/server` (a persisted `RevokedDeviceStore`
 * consulted by `handleHello`) — see `revoke-device-model.ts`'s header for
 * the full correction. The confirmation dialog's description was updated
 * in the same commit to say so, rather than left claiming a reconnect
 * "doesn't block that."
 *
 * **One disclosed gap this screen still cannot close** — un-revoking a
 * device has no wire message or UI control. T300's `RevokedDeviceStore`
 * supports removal at the storage layer (tested directly there), but
 * nothing in this app calls it. See `revoke-device-model.ts`'s header for
 * why: it needs a protocol addition and a "list of revoked devices"
 * surface, neither of which exists today, both outside T300's `Owns`
 * grant.
 *
 * **A second risk T300 makes sharper, disclosed rather than papered over
 * by the dialog copy above:** `app-shell/core.ts`'s `ANDROID_DAEMON_CLIENT_ID`
 * is a single hardcoded string (`"picompanion-android"`, T32A1B), not a
 * per-install id — every Android install of this app presents the SAME
 * `clientId`. Revoking a row whose `clientId` equals that constant (only
 * possible from a device OTHER than the one being revoked — the "isThisDevice"
 * guard above prevents an Android client from ever revoking itself) now
 * durably denylists it (T300), and because the id is shared, that denylist
 * entry blocks every future Android install, including the owner's own
 * replacement phone re-pairing after a loss — there is no "pair again to
 * get back in" recovery today, and (per the gap immediately above) no
 * in-app un-revoke either. This is a pre-existing platform limitation
 * (T32A1B), not something T300 introduces, but T300 raises its stakes from
 * "revoke doesn't really stick" to "revoke may need a manual
 * `RevokedDeviceStore.unrevoke()` on the daemon to undo" — filed for
 * whoever next replaces the fixed Android `clientId` with a real
 * per-install one, or wires un-revoke.
 *
 * CORRECTED (T299): this section used to also name "revoking stops
 * notifications" as a live gap. `packages/server/src/server/push/
 * token-store.ts`'s `PushTokenStore` now attributes every token to the
 * `clientId` that registered it, and `handleTrustedDeviceRevokeRequest`
 * removes a revoked device's tokens alongside its sockets — so a
 * revoke DOES stop notifications for any token registered under this
 * fix. The residual: a token this daemon persisted BEFORE T299 has no
 * recorded `clientId` to revoke by (grandfathered — see `token-store.ts`'s
 * "Migration decision (T299)"), so revoking a device whose only
 * registered token predates that daemon version does not stop it; it
 * clears itself the next time that device's OS issues a fresh token and
 * the app registers it again. The confirmation dialog's description
 * says so.
 *
 * **Never a secret on screen.** See `trusted-devices-model.ts`'s "Never a
 * secret on screen" section — the wire payload carries no password, key,
 * or token, and `summarizeTrustedDevice` is an explicit allow-list
 * projection. This device's own push-registration TOKEN never reaches
 * this component at all — see `device-push-status-model.ts`'s header.
 * `trusted_device.revoke.response` carries only `requestId`/`clientId`/
 * `success`/`error` — see `revoke-device-model.ts`'s own copy of this
 * section.
 */
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Banner,
  Button,
  Card,
  Dialog,
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
  IDLE_REVOKE_DEVICE_STATE,
  beginConfirmedRevokeDevice,
  completeRevokeDevice,
  dismissRevokeRequest,
  failRevokeDevice,
  performRevokeDevice,
  requestRevokeDevice,
  type RevokeDeviceState,
} from "./revoke-device-model.js";
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

function DeviceRow({
  summary,
  onRequestRevoke,
  revoking,
  testId,
}: {
  summary: TrustedDeviceRowSummary;
  /** Omitted (never a disabled button) for this device's own row, and whenever the client doesn't support revocation — see `canRevoke` in `DevicesScreen` below. */
  onRequestRevoke?: () => void;
  revoking: boolean;
  testId?: string;
}) {
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
      {onRequestRevoke ? (
        <View style={styles.rowActions}>
          <Button
            kind="danger"
            label={revoking ? "Revoking…" : "Revoke"}
            onPress={onRequestRevoke}
            disabled={revoking}
            testId={testId ? `${testId}-revoke` : undefined}
          />
        </View>
      ) : null}
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
  const [revokeState, setRevokeState] = useState<RevokeDeviceState>(IDLE_REVOKE_DEVICE_STATE);

  const rows = useMemo(() => {
    const sorted = sortTrustedDevices(snapshot.devices, thisClientId);
    const asOf = now?.();
    return sorted.map((device) => summarizeTrustedDevice(device, { thisClientId, now: asOf }));
  }, [snapshot.devices, thisClientId, now]);

  // Re-read on every render, the same fresh-read convention `getClient`
  // itself follows everywhere else in this file — a reconnect can swap
  // in a client that (dis)gained the capability. Never gates on a stale
  // snapshot of the client taken once at mount.
  const canRevoke = Boolean(getClient()?.revokeTrustedDevice);

  function handleRefresh(): void {
    refreshDevices();
    refreshPushStatus();
  }

  function handleRequestRevoke(target: TrustedDeviceRowSummary): void {
    setRevokeState((current) => requestRevokeDevice(current, target));
  }

  function handleDismissRevoke(): void {
    setRevokeState((current) => dismissRevokeRequest(current));
  }

  // T42A2: "confirmed explicitly" — this is the only path that ever
  // calls performRevokeDevice, and it is only reachable once
  // beginConfirmedRevokeDevice has consumed a target that
  // handleRequestRevoke opened and the Dialog's own confirm button (not
  // its dismiss) triggered.
  function handleConfirmRevoke(): void {
    const begin = beginConfirmedRevokeDevice(revokeState);
    if (!begin.clientId) return;
    const clientId = begin.clientId;
    setRevokeState(begin.state);
    void performRevokeDevice(getClient(), clientId).then((outcome) => {
      if (outcome.status === "success") {
        setRevokeState((current) => completeRevokeDevice(current, clientId));
        // Only now — from the daemon's own confirmation — does the
        // device disappear, never spliced out ahead of it.
        refreshDevices();
        return;
      }
      const message =
        outcome.status === "unavailable"
          ? "Device revocation isn't available on this connection."
          : (outcome.error ?? "Couldn't revoke this device.");
      setRevokeState((current) => failRevokeDevice(current, clientId, message));
    });
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
        {revokeState.error ? (
          <Banner
            tone="danger"
            message={revokeState.error.message}
            testId={testId ? `${testId}-revoke-error` : undefined}
          />
        ) : null}
        {rows.map((summary) => (
          <DeviceRow
            key={summary.clientId}
            summary={summary}
            onRequestRevoke={
              canRevoke && !summary.isThisDevice ? () => handleRequestRevoke(summary) : undefined
            }
            revoking={
              revokeState.phase === "revoking" && revokeState.pendingClientId === summary.clientId
            }
            testId={testId ? `${testId}-device-${summary.clientId}` : undefined}
          />
        ))}
      </Section>
      <Dialog
        open={revokeState.target !== null}
        title="Revoke this device?"
        description={
          revokeState.target
            ? `"${revokeState.target.clientId}" will be disconnected immediately and can no longer reconnect, even if it can still authenticate to this daemon. Push notifications to it stop too, unless it registered for them before this update — those may keep arriving until it registers again. This can't be undone from the app yet, so only revoke a device you're sure you want permanently blocked.`
            : ""
        }
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        dangerous
        onConfirm={handleConfirmRevoke}
        onClose={handleDismissRevoke}
        testId={testId ? `${testId}-revoke-dialog` : undefined}
      />
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
    rowActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingTop: theme.spacing[1],
    },
  });
}

export default DevicesScreen;
