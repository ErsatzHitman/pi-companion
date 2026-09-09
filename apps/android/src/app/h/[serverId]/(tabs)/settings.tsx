import { useLocalSearchParams, useRouter } from "expo-router";

import {
  SettingsScreen,
  pressOpenDevices,
  pressOpenDiagnostics,
} from "../../../../features/settings";
import { useAppCore } from "../../../core-context";

/**
 * `/h/:serverId/settings` — the "settings" Phase 5 feature family's route
 * — T32S1C stubbed it against `RoutePlaceholder`; T32S11 (P5-W16) mounts
 * the real screen T32C1 built.
 *
 * Matches `navigationIntentToPath({ type: "settings", serverId })`
 * exactly (`host-tabs.ts`'s `TAB_ROUTE_NAME.settings` is this file's own
 * name, `"settings"`).
 *
 * `features/settings/index.ts`'s doc comment used to say "no route entry
 * exists" and name this exact file as the one that needed to change —
 * that gap is closed here. `SettingsScreen` needs only
 * `AppCore.keyValueStorage` (`../../../../app-shell/core.ts`), the same real adapter
 * `sessions.tsx` already threads through for its own persisted reads —
 * no fake, no second storage module.
 *
 * `serverId` is read for two things now (T301): proving this route
 * resolved, and building the real `/h/:serverId/devices` /
 * `/h/:serverId/diagnostics` hrefs `onOpenDevices`/`onOpenDiagnostics`
 * navigate to below — there is exactly one settings surface per app
 * install today, but devices/diagnostics are still per-host, so this
 * route is where the two meet.
 *
 * `onOpenDevices`/`onOpenDiagnostics` go through `features/settings/
 * settings-navigation-model.ts`'s `pressOpenDevices`/
 * `pressOpenDiagnostics` rather than a hand-built template string here,
 * so the real `useRouter()` this route holds is the only router either
 * function ever sees — `SettingsScreen` itself never imports `expo-
 * router` (T301, closing the gap `../../../../features/devices/
 * DevicesScreen.tsx`'s own doc comment named).
 */
export default function SettingsRoute() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  const router = useRouter();
  return (
    <SettingsScreen
      storage={core.keyValueStorage}
      onOpenDevices={() => pressOpenDevices(router, serverId)}
      onOpenDiagnostics={() => pressOpenDiagnostics(router, serverId)}
      testId="settings-screen"
    />
  );
}
