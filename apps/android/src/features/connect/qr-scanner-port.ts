/**
 * Camera-scanner port — plan.md §7.1/§9.2/§12.1, T32A4 ("Add QR camera
 * pairing").
 *
 * A minimal, RN-free seam between `qr-scan-model.ts`'s pure permission
 * state machine and whatever native camera/barcode module actually
 * asks the OS for camera access. Only two operations: read the current
 * permission without prompting, and prompt for it. Deliberately not a
 * "give me frames"/"give me decoded barcodes" API — decoding is a
 * native camera view's job (`QrPairingPanel.tsx`'s, backed as of T392
 * by `./expo-camera-preview.tsx`), and this port's caller
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
 * included. `getPermissionStatus`/`requestPermission` can genuinely
 * report `"denied-permanently"` (Android's "don't ask again") as of
 * T392, because `./expo-camera-scanner-port.ts` maps `expo-camera`'s
 * `canAskAgain: false` result onto it; `qr-scan-model.ts`'s
 * `mapPermissionStatus` already handles it (see that module's own
 * comment for what it does with it).
 *
 * **The real camera is installed (T392).** `expo-camera@~17.0.10` — the
 * pin this app's own SDK-54 `expo` (`54.0.37`) gives in the package's
 * `bundledNativeModules.json` — is a dependency, and
 * `./expo-camera-scanner-port.ts`'s `createExpoCameraScannerPort` is the
 * production implementation behind both call sites (`QrPairingPanel.tsx`'s
 * `scanner` default and `onboarding-permissions-port.ts`'s camera
 * default).
 *
 * `createUnavailableCameraScannerPort` below is retained, not deleted:
 * it always reports `"unavailable"`, a distinct, honest state from a
 * user's own `"denied"` choice, so the fallback copy never claims a
 * user "denied" something they were never asked. Tests use it (or a
 * scripted fake) to keep `qr-scan-model.ts`'s phases driveable without a
 * native module, and a caller that wants camera pairing explicitly
 * disabled still passes it. `QrPairingPanel.tsx` renders a real preview
 * in its `"ready"` phase as of T392 (`./expo-camera-preview.tsx`),
 * behind an injectable seam that falls back to the panel's honest
 * placeholder when the native view cannot render.
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

/** The explicit "no camera" `CameraScannerPort` — retained for tests and for a caller that disables camera pairing; `./expo-camera-scanner-port.ts`'s `createExpoCameraScannerPort` is production's real implementation (see module docstring). */
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
