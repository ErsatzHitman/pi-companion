import { useLocalSearchParams } from "expo-router";

import { ANDROID_DAEMON_CLIENT_ID } from "../../../app-shell/core";
import { createUnavailablePushRegistrationPort } from "../../../features/notifications/push-registration-port";
import { DevicesScreen } from "../../../features/devices";
import type { TrustedDevicesClient } from "../../../features/devices";
import { useAppCore } from "../../core-context";

/**
 * `/h/:serverId/devices` — mounts the real `DevicesScreen` T42A1 built.
 * Same shape as this app's other feature routes not under `(tabs)/`
 * (`../diagnostics.tsx`): the route supplies real adapters off
 * `useAppCore()` and owns nothing else.
 *
 * **Reachable from the Settings tab (T301).** The "Devices" row on
 * `app/h/[serverId]/(tabs)/settings.tsx` navigates here via
 * `features/settings/settings-navigation-model.ts`'s `pressOpenDevices`
 * — see `DevicesScreen.tsx`'s own doc comment for the full history of
 * this gap.
 *
 * Dependency notes, each one a real adapter and never a fake:
 *
 * - `getClient` re-reads `getActiveLifecycle()` on every call rather than
 *   closing over one client, exactly like `../diagnostics.tsx`'s
 *   `getDaemonClient` — a reconnect swaps in a new instance. `@picompanion/
 *   frontend-core`'s `DaemonClientLike` (what `getDaemonClient()` actually
 *   returns) does not declare `listTrustedDevices`, so this uses the same
 *   `as unknown as` narrow-cast `../diagnostics.tsx` already uses for its
 *   own gap (`on()`) — the real, production `DaemonClient`
 *   (`packages/client/src/daemon-client.ts`) genuinely has the method; the
 *   cast documents the interface gap, it does not invent a capability.
 * - `subscribeToConnectionChanges` wraps `core.connection.subscribe` into
 *   the plain no-argument callback `useTrustedDevices`/
 *   `useDevicePushStatus` expect, so a reconnect re-fetches both the
 *   device list and this device's push status automatically.
 * - `getPermissionStatus` is `createUnavailablePushRegistrationPort()`'s
 *   `getPermissionStatus` — this build's only production
 *   `PushRegistrationPort` (no `expo-notifications`/`expo-device`
 *   install; see that port's own doc comment for the exact install
 *   command). Constructed fresh here rather than reading a persisted
 *   `AppCore` field, because the port is stateless (every method always
 *   resolves the same "unavailable" answer) — identical to how
 *   `AppCore.startPushRegistration` itself constructs one inline.
 * - `isRegistered` reads `core.pushRegistration.getLastRegisteredToken()
 *   !== null` — the real T61B `PushRegistrationController` already
 *   threaded through `AppCore`, never a second one.
 *
 * `serverId` is read but otherwise unused, matching `../diagnostics.tsx`
 * and `(tabs)/settings.tsx`: every value this screen shows describes the
 * one connection this app has open, not anything scoped by host.
 */
export default function DevicesRoute() {
  useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  const pushPort = createUnavailablePushRegistrationPort();

  return (
    <DevicesScreen
      thisClientId={ANDROID_DAEMON_CLIENT_ID}
      getClient={() =>
        (core.connection.getActiveLifecycle()?.getDaemonClient() as unknown as
          | TrustedDevicesClient
          | undefined) ?? null
      }
      subscribeToConnectionChanges={(onChange) => core.connection.subscribe(() => onChange())}
      getPermissionStatus={() => pushPort.getPermissionStatus()}
      isRegistered={() => core.pushRegistration.getLastRegisteredToken() !== null}
      testId="devices-screen"
    />
  );
}
