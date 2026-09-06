import { ConnectionShell, OnboardingGate } from "../features/connect";
import { useAppCore } from "./core-context";

/**
 * `/connect` — the "connect" Phase 5 feature family's route stub —
 * T32S1C.
 *
 * Matches `navigationIntentToPath({ type: "connect" })` (`frontend-core`'s
 * navigation module, T24) exactly, and — like every other stub this task
 * creates — imports its screen from the matching
 * `apps/android/src/features/*` directory rather than containing any
 * feature logic itself. Unlike the other five families, `features/connect/`
 * already has a real (if Phase-1-fake) screen (`ConnectionShell`, built by
 * T16), so this route is a thin wrapper from day one rather than a
 * placeholder later tasks (T32A1–T32A6) replace piece by piece.
 *
 * **T32S10 mount**: T32A6's `OnboardingGate` (`features/connect/
 * OnboardingGate.tsx`) had no live importer — see that component's own
 * "Seam" doc comment, which names this exact file. It takes
 * `AppCore.keyValueStorage` (`app-shell/core.ts`, already constructed and
 * threaded through this same `useAppCore()` context every other screen in
 * this tree reads from) and renders `ConnectionShell` as its `children`
 * only once the persisted onboarding state resolves to `"completed"` —
 * on a fresh install it now runs the welcome/permissions steps first,
 * exactly the behaviour `onboarding-model.test.ts` proves against a
 * scripted `KeyValueStorage`. No permissions port is passed, so
 * `OnboardingGate` falls back to its own real
 * `createOnboardingPermissionsPort()` default (camera via
 * `qr-scanner-port.ts`, settings via RN `Linking`) rather than a second
 * one constructed here.
 */
export default function ConnectRoute() {
  const core = useAppCore();
  return (
    <OnboardingGate storage={core.keyValueStorage} testId="connect-onboarding">
      <ConnectionShell />
    </OnboardingGate>
  );
}
