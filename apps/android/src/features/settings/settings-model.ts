/**
 * App settings — T32C1, plan.md §9.3 (haptics).
 *
 * `apps/android` had no settings surface at all: `features/approvals/
 * use-approvals-queue.ts` and `features/transcript/
 * transcript-status-haptics-model.ts` both hardcode `hapticsEnabled:
 * true` at their call sites, each with a doc comment naming this task as
 * the one that builds the real toggle. This is that store. RN-free like
 * every other `-model.ts` in this tree (`onboarding-model.ts`,
 * `connect-form-model.ts`) so it is unit-testable without a device; the
 * thin view is `SettingsScreen.tsx`.
 *
 * ## Persistence
 *
 * Goes through the *existing* `AppCore.keyValueStorage` abstraction
 * (`@picompanion/frontend-core`'s `KeyValueStorage`) under one JSON
 * envelope at `SETTINGS_STORAGE_KEY` — never `AsyncStorage` directly,
 * never a second storage module, matching `onboarding-model.ts`'s
 * convention exactly.
 *
 * ## The default-value rule
 *
 * Every setting must resolve to a defined value in four distinct
 * failure shapes: a missing key, a value that fails to parse as JSON, a
 * value that parses but has the wrong shape/type, and a storage read
 * that throws outright. All four fall back to `DEFAULT_SETTINGS`
 * (`hapticsEnabled: true`) — **never** to a disabled setting. Silently
 * turning haptics off because of a storage hiccup would be a worse
 * outcome than the reverse (a stray vibration), the same "which
 * direction is safe" judgment call `onboarding-model.ts` makes for
 * "never fall back to completed" in the opposite direction. `loadError`
 * is set on the snapshot so a caller *could* surface the failure; the
 * resolved value is identical whether or not it does.
 *
 * ## The secret-shaped guard
 *
 * `persist()` runs every field of the persisted record through
 * `frontend-core`'s `security.isSecretShaped` (T60A) before it ever
 * reaches `storage.setItem` — not a private redaction pattern list. No
 * setting this store defines today is ever secret-shaped (`hapticsEnabled`
 * is a plain boolean), so this is defence-in-depth for whatever a later
 * task adds to `PersistedSettings`, proven directly against
 * `assertSettingNotSecretShaped` in the test file since there is no
 * secret-shaped *current* setting to trigger it end-to-end.
 */
import { security, type KeyValueStorage } from "@picompanion/frontend-core";

export const SETTINGS_STORAGE_KEY = "picompanion.settings.v1";

/** The full set of persisted app settings. Add new fields here as later tasks introduce them — every field flows through the same `persist()`/secret-shaped guard automatically. */
export interface PersistedSettings {
  version: 1;
  /** plan.md §9.3: whether the four haptic triggers (approval, finished, error, blocked) are allowed to vibrate the device. */
  hapticsEnabled: boolean;
}

/** Resolved when storage is empty, unreadable, or holds a malformed/wrong-typed value — see this module's "default-value rule". Never a disabled setting. */
export const DEFAULT_SETTINGS: Readonly<Omit<PersistedSettings, "version">> = {
  hapticsEnabled: true,
};

export interface SettingsSnapshot {
  hapticsEnabled: boolean;
  /** False until `load()` has resolved once. Callers that read `hapticsEnabled` before this is true still get `DEFAULT_SETTINGS`, never `undefined`. */
  loaded: boolean;
  /** Set when `load()` fell back to defaults because of a missing/malformed/throwing read. Never reset by a later successful `set*` call within the same controller instance — mirrors `OnboardingSnapshot.loadError`'s convention. */
  loadError: boolean;
}

export type SettingsSnapshotListener = (snapshot: SettingsSnapshot) => void;

export interface SettingsController {
  getSnapshot(): SettingsSnapshot;
  subscribe(listener: SettingsSnapshotListener): () => void;
  /** Reads persisted state (or falls back to defaults) and publishes the resulting snapshot. Call once, from the screen's mount effect — mirrors `OnboardingController.load()`. */
  load(): Promise<void>;
  setHapticsEnabled(value: boolean): Promise<void>;
}

const INITIAL_SNAPSHOT: SettingsSnapshot = {
  ...DEFAULT_SETTINGS,
  loaded: false,
  loadError: false,
};

function isPersistedSettings(value: unknown): value is PersistedSettings {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["version"] === 1 && typeof record["hapticsEnabled"] === "boolean";
}

/**
 * Throws if `value` (under field name `key`) looks secret-shaped, per
 * `frontend-core`'s `security.isSecretShaped`. Exported standalone so
 * the guard itself is directly unit-testable even though no field
 * `PersistedSettings` defines today can ever trip it — see this file's
 * "secret-shaped guard" doc-comment section.
 */
export function assertSettingNotSecretShaped(key: string, value: unknown): void {
  if (typeof value !== "string") return;
  if (security.isSecretShaped(value, key)) {
    throw new Error(`settings: refusing to persist secret-shaped value for "${key}"`);
  }
}

/**
 * Indirection point so `persist()`'s wiring to `assertSettingNotSecretShaped`
 * is provable by a spy: `PersistedSettings` defines no field today that can
 * actually be secret-shaped (`hapticsEnabled` is a plain boolean, and the
 * guard itself is a no-op for non-string values), so a test cannot prove
 * the wiring by tripping the guard through the public API alone — only by
 * asserting the call happened. See `settings-model.test.ts`'s "the guard
 * is actually wired into persist()" test.
 */
export const settingsSecurityGuard = { assertSettingNotSecretShaped };

function assertRecordNotSecretShaped(record: PersistedSettings): void {
  for (const [key, value] of Object.entries(record)) {
    settingsSecurityGuard.assertSettingNotSecretShaped(key, value);
  }
}

export interface SettingsControllerDeps {
  storage: KeyValueStorage;
}

export function createSettingsController(deps: SettingsControllerDeps): SettingsController {
  let snapshot: SettingsSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<SettingsSnapshotListener>();

  function publish(next: SettingsSnapshot): void {
    snapshot = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  async function persist(record: PersistedSettings): Promise<void> {
    assertRecordNotSecretShaped(record);
    await deps.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(record));
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      let raw: string | null;
      try {
        raw = await deps.storage.getItem(SETTINGS_STORAGE_KEY);
      } catch {
        publish({ ...DEFAULT_SETTINGS, loaded: true, loadError: true });
        return;
      }

      if (raw === null) {
        publish({ ...DEFAULT_SETTINGS, loaded: true, loadError: false });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        publish({ ...DEFAULT_SETTINGS, loaded: true, loadError: true });
        return;
      }

      if (!isPersistedSettings(parsed)) {
        publish({ ...DEFAULT_SETTINGS, loaded: true, loadError: true });
        return;
      }

      publish({ hapticsEnabled: parsed.hapticsEnabled, loaded: true, loadError: false });
    },
    async setHapticsEnabled(value) {
      await persist({ version: 1, hapticsEnabled: value });
      publish({ ...snapshot, hapticsEnabled: value, loaded: true });
    },
  };
}
