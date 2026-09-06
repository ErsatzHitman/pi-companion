/**
 * Camera-scanner port — plan.md §7.1/§9.2/§12.1, T32A4 ("Add QR camera
 * pairing").
 *
 * A minimal, RN-free seam between `qr-scan-model.ts`'s pure permission
 * state machine and whatever native camera/barcode module actually
 * asks the OS for camera access. Only two operations: read the current
 * permission without prompting, and prompt for it. Deliberately not a
 * "give me frames"/"give me decoded barcodes" API — decoding is a
 * native camera view's job (`QrPairingPanel.tsx`'s job once a real
 * camera library is installed), and this port's caller
 * (`qr-scan-model.ts`) only ever receives already-decoded text through
 * its own `handleScannedText`, the same shape a paste box or any other
 * text source could feed it.
 *
 * **Permission vocabulary (T60E, P5-W17):** this module used to declare
 * its own four-state `CameraPermissionStatus` alias — a structural
 * subset of `../composer/permission-recovery.ts`'s five-state
 * `PermissionState` that happened to need no cast anywhere it was
 * consumed, which is exactly why it survived T60D's unification unseen
 * (see that module's header and `scripts/ci/guard-no-duplicate-
 * permission-state.mjs`'s history for the full story). T60E deleted it
 * and this port now reads/returns `PermissionState` directly — the
 * same vocabulary every other permission port in this tree uses, camera
 * included. `getPermissionStatus`/`requestPermission` can now genuinely
 * report `"denied-permanently"` (Android's "don't ask again") the
 * moment a real camera module lands; `qr-scan-model.ts`'s
 * `mapPermissionStatus` already handles it (see that module's own
 * comment for what it does with it).
 *
 * **No camera dependency is installed in this workspace.**
 * `apps/android/package.json` carries no `expo-camera` (or
 * `expo-barcode-scanner`) today, and this task may not run `npm
 * install`. `createUnavailableCameraScannerPort` below is therefore
 * this module's only production implementation: it always reports
 * `"unavailable"`, which `qr-scan-model.ts` renders as its own
 * `"unavailable"` phase — a distinct, honest state from a user's own
 * `"denied"` choice, so the fallback copy never claims a user "denied"
 * something they were never asked. `QrPairingPanel.tsx` never opens a
 * camera preview in this build; it only ever proves against this port
 * or a scripted fake of it.
 *
 * To wire a real camera once available:
 *
 *   npm install --workspace=@picompanion/android expo-camera@<version
 *   from apps/android/node_modules/expo/bundledNativeModules.json>
 *
 * — then add a second implementation of `CameraScannerPort` backed by
 * `expo-camera`'s `Camera.getCameraPermissionsAsync`/
 * `requestCameraPermissionsAsync` (mapping its `PermissionStatus`,
 * including Android's "don't ask again" result, onto `PermissionState`
 * below), and pass it as `QrPairingPanel`'s `scanner` prop in place of
 * `createUnavailableCameraScannerPort()`. Nothing in `qr-scan-model.ts`
 * or `QrPairingPanel.tsx` needs to change for that swap — the whole
 * point of this seam.
 */
import type { PermissionState } from "../composer/permission-recovery.js";

export interface CameraScannerPort {
  /** Reads the current permission without prompting the user or the OS. */
  getPermissionStatus(): Promise<PermissionState>;
  /**
   * Prompts for camera permission. A real implementation must only
   * ever surface the OS's own native prompt here — never call this
   * speculatively; `qr-scan-model.ts` already guarantees it is only
   * reached from a user-initiated moment (entering the scan surface,
   * or an explicit retry), never at app launch.
   */
  requestPermission(): Promise<PermissionState>;
}

/** This build's only production `CameraScannerPort` — see module docstring. */
export function createUnavailableCameraScannerPort(): CameraScannerPort {
  return {
    async getPermissionStatus() {
      return "unavailable";
    },
    async requestPermission() {
      return "unavailable";
    },
  };
}
