/**
 * Settings feature barrel (T32C1). See `settings-model.ts` for the
 * persisted store, `SettingsScreen.tsx` for the thin view over it,
 * `settings-navigation-model.ts` for the devices/diagnostics/extension
 * navigation seams (T301, ANDROID-EXT-1), and
 * `settings-extension-coverage.ts`/`ExtensionDetailScreen.tsx` for the
 * extension detail screen itself.
 *
 * **Live importer:** `app/h/[serverId]/(tabs)/settings.tsx` mounts
 * `SettingsScreen` on the real `/h/:serverId/settings` tab route,
 * passing `AppCore.keyValueStorage` (T32S11, P5-W16) and, since T301,
 * real `onOpenDevices`/`onOpenDiagnostics` callbacks built from
 * `settings-navigation-model.ts`. The "no route mounts this yet" gap
 * this comment used to record is closed; the shared `SettingsController`
 * it reads now lives on `AppCore.settings` (`app-shell/core.ts`),
 * constructed once per process. `app/h/[serverId]/extensions/
 * [name].tsx` mounts `ExtensionDetailScreen` the same way, reached from
 * `SettingsScreen`'s "Extensions that draw" rows via `onOpenExtension`
 * and `pressOpenExtension`.
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
  buildExtensionHref,
  pressOpenDevices,
  pressOpenDiagnostics,
  pressOpenExtension,
  type SettingsNavRouter,
} from "./settings-navigation-model.js";
export {
  settingsHostAccessibilityLabel,
  settingsHostDetail,
  settingsHostStatus,
  settingsHostTitle,
  type SettingsHostProfileView,
  type SettingsHostStatus,
} from "./settings-host-model.js";
export {
  DRAWING_EXTENSIONS,
  SILENT_EXTENSION_NAMESPACES,
  silentExtensionsSummary,
  type ExtensionCoverageContractTerm,
  type ExtensionCoverageRow,
} from "./settings-extension-coverage.js";
export { SettingsScreen, type SettingsScreenProps } from "./SettingsScreen.js";
export { ExtensionDetailScreen, type ExtensionDetailScreenProps } from "./ExtensionDetailScreen.js";
