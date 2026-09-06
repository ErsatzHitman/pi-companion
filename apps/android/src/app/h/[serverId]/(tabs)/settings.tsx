import { useLocalSearchParams } from "expo-router";

import { SettingsScreen } from "../../../../features/settings";
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
 * `serverId` is read but unused beyond proving this route resolved
 * (there is exactly one settings surface per app install today, not
 * one per host) — kept in the signature so a later per-host settings
 * split does not have to touch the route shape again.
 */
export default function SettingsRoute() {
  useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  return <SettingsScreen storage={core.keyValueStorage} testId="settings-screen" />;
}
