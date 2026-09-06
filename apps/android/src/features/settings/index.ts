/**
 * Settings feature barrel (T32C1). See `settings-model.ts` for the
 * persisted store and `SettingsScreen.tsx` for the thin view over it.
 *
 * **Live importer:** `app/h/[serverId]/(tabs)/settings.tsx` mounts
 * `SettingsScreen` on the real `/h/:serverId/settings` tab route,
 * passing `AppCore.keyValueStorage` (T32S11, P5-W16). The "no route
 * mounts this yet" gap this comment used to record is closed; the
 * shared `SettingsController` it reads now lives on `AppCore.settings`
 * (`app-shell/core.ts`), constructed once per process.
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
export { SettingsScreen, type SettingsScreenProps } from "./SettingsScreen.js";
