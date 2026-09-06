/**
 * First-run onboarding state machine (plan.md §7.3/§9.1/§12.1, T32A6
 * "Build first-run onboarding").
 *
 * This is the whole of what "onboarding completes on a clean install"
 * and "onboarding is skipped on subsequent launches" actually mean —
 * one persisted state machine, RN-free like every other `-model.ts`/
 * `*-store.ts` in this directory (`connect-form-model.ts`,
 * `daemon-connection-store.ts`, `qr-scan-model.ts`), so it is
 * unit-testable against a scripted `KeyValueStorage` fake rather than a
 * device or emulator. `OnboardingGate.tsx` is the thin view over it.
 *
 * Persistence goes through the *existing* `AppCore.keyValueStorage`
 * abstraction (`@picompanion/frontend-core`'s `KeyValueStorage`,
 * Expo-backed at runtime by `../../platform/key-value-storage.ts`) —
 * never `AsyncStorage` directly, and never a second storage module, per
 * this task's brief. One key, `ONBOARDING_STORAGE_KEY`, holds a small
 * JSON envelope (`PersistedOnboardingState`).
 *
 * ## The resume rule
 *
 * Onboarding has exactly two steps, `"welcome"` then `"permissions"`.
 * `advance()` persists progress *before* moving on, so a process death
 * or force-quit mid-flow — between `"welcome"` and finishing
 * `"permissions"` — resumes at the step the user had reached, never
 * restarting from `"welcome"` and never silently skipping straight to
 * `"completed"`. Only `complete()` (called once the permissions step's
 * own "Continue" is pressed, regardless of grant outcome —
 * `OnboardingGate.tsx` renders that button unconditionally, independent
 * of camera-permission state) ever writes `status: "completed"`.
 *
 * ## The storage-failure rule
 *
 * A `KeyValueStorage.getItem` rejection (or unparsable JSON already
 * sitting under the key) is treated as "no completed record" — `load()`
 * falls back to running onboarding from `"welcome"`, *never* to
 * `"completed"`. Skipping onboarding is the one outcome a storage
 * failure must never produce, since it would strand a user who has
 * never actually paired a host on a blank connect screen with no
 * explanation. `snapshot.loadError` is set so a caller *could* surface
 * that fact, but the fallback step is identical whether or not it does.
 */
import type { KeyValueStorage } from "@picompanion/frontend-core";

export const ONBOARDING_STORAGE_KEY = "picompanion.onboarding.v1";

export type OnboardingStepId = "welcome" | "permissions";

const STEP_ORDER: readonly OnboardingStepId[] = ["welcome", "permissions"];

interface PersistedOnboardingState {
  version: 1;
  status: "in-progress" | "completed";
  step: OnboardingStepId;
}

export type OnboardingPhase = "loading" | OnboardingStepId | "completed";

export interface OnboardingSnapshot {
  phase: OnboardingPhase;
  /** Set once `load()` could not read (or could not parse) persisted state. Onboarding still runs — see module docstring. Never reset to `false` once `load()` has run; a fresh controller is built each time the gate remounts, mirroring `qr-scan-model.ts`'s controller-per-mount convention. */
  loadError: boolean;
}

export type OnboardingSnapshotListener = (snapshot: OnboardingSnapshot) => void;

export interface OnboardingController {
  getSnapshot(): OnboardingSnapshot;
  subscribe(listener: OnboardingSnapshotListener): () => void;
  /** Reads persisted state and publishes the resulting phase. Call once, from the gate's mount effect. */
  load(): Promise<void>;
  /** Moves from `"welcome"` to `"permissions"`, persisting the new step first. No-op (does not throw, does not move) if called outside the `"welcome"` phase. */
  advance(): Promise<void>;
  /** Marks onboarding finished. Persists `status: "completed"` and publishes phase `"completed"`. No-op if called before `load()` has resolved. */
  complete(): Promise<void>;
}

const LOADING_SNAPSHOT: OnboardingSnapshot = { phase: "loading", loadError: false };

function isPersistedOnboardingState(value: unknown): value is PersistedOnboardingState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["version"] === 1 &&
    (record["status"] === "in-progress" || record["status"] === "completed") &&
    (record["step"] === "welcome" || record["step"] === "permissions")
  );
}

export interface OnboardingControllerDeps {
  storage: KeyValueStorage;
}

export function createOnboardingController(deps: OnboardingControllerDeps): OnboardingController {
  let snapshot: OnboardingSnapshot = LOADING_SNAPSHOT;
  const listeners = new Set<OnboardingSnapshotListener>();

  function publish(next: OnboardingSnapshot): void {
    snapshot = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  async function persist(state: PersistedOnboardingState): Promise<void> {
    await deps.storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
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
        raw = await deps.storage.getItem(ONBOARDING_STORAGE_KEY);
      } catch {
        publish({ phase: "welcome", loadError: true });
        return;
      }

      if (raw === null) {
        publish({ phase: "welcome", loadError: false });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        publish({ phase: "welcome", loadError: true });
        return;
      }

      if (!isPersistedOnboardingState(parsed)) {
        publish({ phase: "welcome", loadError: true });
        return;
      }

      if (parsed.status === "completed") {
        publish({ phase: "completed", loadError: false });
        return;
      }

      publish({ phase: parsed.step, loadError: false });
    },
    async advance() {
      if (snapshot.phase !== "welcome") return;
      const nextStep = STEP_ORDER[STEP_ORDER.indexOf(snapshot.phase) + 1];
      if (!nextStep) return;
      await persist({ version: 1, status: "in-progress", step: nextStep });
      publish({ phase: nextStep, loadError: snapshot.loadError });
    },
    async complete() {
      if (snapshot.phase === "loading") return;
      await persist({ version: 1, status: "completed", step: "permissions" });
      publish({ phase: "completed", loadError: snapshot.loadError });
    },
  };
}
