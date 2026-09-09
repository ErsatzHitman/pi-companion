/**
 * Settings feature barrel (T32C1). See `settings-model.ts` for the
 * persisted store, `SettingsScreen.tsx` for the thin view over it, and
 * `settings-navigation-model.ts` for the devices/diagnostics navigation
 * seam (T301).
 *
 * **Live importer:** `app/h/[serverId]/(tabs)/settings.tsx` mounts
 * `SettingsScreen` on the real `/h/:serverId/settings` tab route,
 * passing `AppCore.keyValueStorage` (T32S11, P5-W16) and, since T301,
 * real `onOpenDevices`/`onOpenDiagnostics` callbacks built from
 * `settings-navigation-model.ts`. The "no route mounts this yet" gap
 * this comment used to record is closed; the shared `SettingsController`
 * it reads now lives on `AppCore.settings` (`app-shell/core.ts`),
 * constructed once per process.
 */
export {
  assertSettingNotSecretShaped,
  createSettingsController,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  settingsSecurityGuard,
  type PersistedSettings,
  type SettingsController,
  type SettingsControllerDeps,
  type SettingsSnapshot,
  type SettingsSnapshotListener,
} from "./settings-model.js";
export {
  buildDevicesHref,
  buildDiagnosticsHref,
  pressOpenDevices,
  pressOpenDiagnostics,
  type SettingsNavRouter,
} from "./settings-navigation-model.js";
export { SettingsScreen, type SettingsScreenProps } from "./SettingsScreen.js";
