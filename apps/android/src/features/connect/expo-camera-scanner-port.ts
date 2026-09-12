/**
 * The real, `expo-camera`-backed `CameraScannerPort` (T392,
 * plan.md §7.1/§9.2/§12.1).
 *
 * Same seam `qr-scanner-port.ts` declares, just a second implementation:
 * `QrPairingPanel.tsx` and `onboarding-permissions-port.ts` now default
 * to `createExpoCameraScannerPort()`, and `createUnavailableCameraScannerPort`
 * stays in that RN-free module for tests and for any caller that wants
 * camera permission explicitly disabled. Nothing in `qr-scan-model.ts`
 * or the two call sites' control flow changed for the swap — that is
 * the whole point of the seam.
 *
 * ## RN-in-vitest split
 *
 * Deliberately a separate file from `qr-scanner-port.ts`, for the exact
 * reason `../composer/expo-camera-capture-port.ts` is split from
 * `../composer/attachment-source-port.ts` and
 * `../voice/expo-audio-voice-capture-port.ts` is split from its own
 * RN-free sibling: `expo-camera` imports `expo-modules-core`, whose
 * `Platform` module imports `react-native`, so importing `expo-camera`
 * transitively imports `react-native`. `qr-scanner-port.ts` — and
 * `qr-scan-model.test.ts`, which imports it directly — must stay clear
 * of that. `./expo-camera-scanner-port.test.ts` proves this file the
 * same established way: `vi.mock("expo-camera", ...)` before a dynamic
 * import of the module under test, so the real native package (and the
 * real `react-native`) is never loaded there.
 *
 * ## Why this file does not map `"unavailable"` itself
 *
 * `mapExpoPermission` below is exhaustive over what `expo-camera`'s own
 * `PermissionResponse` can say; it never fabricates `"unavailable"`.
 * That fifth state means "no native module exists to ask at all"
 * (`permission-recovery.ts`'s own definition), which is a fact about the
 * build, not something a working permission read can report. A build
 * without the module linked never reaches this file's calls at all: the
 * preview surface in `QrPairingPanel.tsx` is the piece that degrades to
 * its honest placeholder when `expo-camera`'s native view cannot render
 * (see `expo-camera-preview.tsx` and the panel's own docstring).
 */
import { Camera } from "expo-camera";

import type { PermissionState } from "../composer/permission-recovery.js";
import type { CameraScannerPort } from "./qr-scanner-port.js";

/** The exact fields this port reads off `expo-modules-core`'s `PermissionResponse` — narrowed the same way `../composer/expo-camera-capture-port.ts`'s own declared response is. */
export interface ExpoCameraPermissionResponse {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/** Everything this port needs from `expo-camera`, injectable so `./expo-camera-scanner-port.test.ts` never has to load the real native module. */
export interface CameraScannerBindings {
  getCameraPermissionsAsync(): Promise<ExpoCameraPermissionResponse>;
  requestCameraPermissionsAsync(): Promise<ExpoCameraPermissionResponse>;
}

const DEFAULT_BINDINGS: CameraScannerBindings = {
  getCameraPermissionsAsync: () => Camera.getCameraPermissionsAsync(),
  requestCameraPermissionsAsync: () => Camera.requestCameraPermissionsAsync(),
};

/**
 * Maps `expo-camera`'s `PermissionResponse` onto this app's own
 * five-state `PermissionState`, mirroring
 * `../composer/expo-camera-capture-port.ts`'s (and
 * `../voice/expo-audio-voice-capture-port.ts`'s) private mapper — same
 * shape, duplicated rather than shared because each port's response type
 * is its own declared shape. Expo's `canAskAgain: false` alongside
 * `status: "denied"` is exactly `"denied-permanently"` — Android's
 * "don't ask again".
 */
function mapExpoPermission(response: ExpoCameraPermissionResponse): PermissionState {
  if (response.granted) {
    return "granted";
  }
  if (response.status === "denied") {
    return response.canAskAgain === false ? "denied-permanently" : "denied";
  }
  return "undetermined";
}

/**
 * This build's real `CameraScannerPort` (T392). See this module's header
 * for why it lives apart from `qr-scanner-port.ts`.
 */
export function createExpoCameraScannerPort(
  bindings: CameraScannerBindings = DEFAULT_BINDINGS,
): CameraScannerPort {
  return {
    async getPermissionStatus() {
      return mapExpoPermission(await bindings.getCameraPermissionsAsync());
    },
    async requestPermission() {
      return mapExpoPermission(await bindings.requestCameraPermissionsAsync());
    },
  };
}
