/**
 * Onboarding camera-permission port (plan.md §7.1/§9.1/§12.1, T32A6
 * "Build first-run onboarding"; unified onto `../composer/
 * permission-recovery.ts` by T60D, P5-W15).
 *
 * The one OS permission first-run onboarding actually gates today is
 * **camera**, for QR pairing (`QrPairingPanel.tsx`/`qr-scan-model.ts`,
 * T32A4).
 *
 * Before T60D this module declared its own five-state
 * `OnboardingPermissionStatus` vocabulary (`CameraPermissionStatus` plus
 * a locally-added `"denied-permanently"`) and its own
 * `describeCameraPermissionRecovery` copy table — built in the same
 * P5-W13 wave as `../composer/permission-recovery.ts`'s near-identical
 * `PermissionState`/`describePermissionRecovery`, independently, because
 * neither task could own a shared module that wave. T60D deleted both:
 * this file now only declares the one thing that is genuinely
 * connect-specific — `OnboardingPermissionsPort`, which is composer's
 * `PermissionPort` (`getPermissionStatus`/`requestPermission`) plus the
 * one extra operation camera's `"denied-permanently"` recovery needs,
 * `openAppSettings`. All copy and state vocabulary comes from
 * `../composer/permission-recovery.ts`'s `"camera"` `PermissionKind`
 * (also added by T60D) — `OnboardingGate.tsx` calls
 * `describePermissionRecovery("camera", state)` directly.
 *
 * Kept free of React Native/Expo, like every other `-model.ts` in this
 * directory, so it stays trivially assignable without a device or
 * emulator — there is no logic left here to unit-test on its own; the
 * shared recovery-copy logic is `permission-recovery.test.ts`'s job, and
 * `onboarding-permissions.test.ts` now proves this file's one remaining
 * job — that `OnboardingPermissionsPort` is a real superset of
 * `PermissionPort` — via the type system plus a structural fake.
 */
import type { PermissionPort } from "../composer/permission-recovery.js";

export type {
  PermissionKind,
  PermissionPort,
  PermissionState,
} from "../composer/permission-recovery.js";
export { describePermissionRecovery } from "../composer/permission-recovery.js";

/**
 * The port onboarding's permission step talks to. Production
 * implementation: `onboarding-permissions-port.ts`.
 *
 * `getPermissionStatus`/`requestPermission` come straight from
 * `PermissionPort` — no `getCameraPermissionStatus`/
 * `requestCameraPermission` renaming, the pre-T60D vocabulary this
 * module used to declare. `openAppSettings` is the one addition:
 * camera's `"denied-permanently"` recovery (`describePermissionRecovery
 * ("camera", "denied-permanently")`'s `action: "open-settings"`) needs
 * somewhere to route to, and only this feature knows how to open the OS
 * app-settings screen.
 */
export interface OnboardingPermissionsPort extends PermissionPort {
  /** Opens the OS app-settings screen. The only recovery for `"denied-permanently"` — the OS itself refuses to re-prompt once a user has chosen "Don't ask again". */
  openAppSettings(): Promise<void>;
}
