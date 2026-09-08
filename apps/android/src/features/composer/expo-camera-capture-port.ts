/**
 * The real, `expo-image-picker`-backed `CameraCapturePort` (T290,
 * plan.md §9.2/§12.4). See `./attachment-source-port.ts`'s
 * `CameraCapturePort` doc comment for the full design (why this is a
 * sibling port to `AttachmentSourcePort`, the one-resolution-per-press
 * invariant, and the disclosed native-layer double permission check
 * inside `launchCameraAsync` itself) — this file only carries the
 * implementation.
 *
 * ## RN-in-vitest split
 *
 * Deliberately a separate file from `attachment-source-port.ts`, for
 * the identical reason `./expo-attachment-source-port.ts` and
 * `../voice/expo-audio-voice-capture-port.ts` are each split from their
 * RN-free sibling (see either file's header): `expo-image-picker`
 * imports `expo-modules-core`, whose `src/index.ts` exports `Platform`
 * from `./Platform`, which does
 * `import { Platform as ReactNativePlatform } from "react-native"` at
 * its top level — so importing `expo-image-picker` transitively imports
 * `react-native`. `attachment-source-port.ts` (and every test that
 * imports it directly — `attachment-capture-model.test.ts`,
 * `attachment-wiring.test.ts`, `permission-recovery.test.ts`) stays
 * untouched by that limitation because it never imports this file.
 * `./expo-camera-capture-port.test.ts` proves itself the same way:
 * `vi.mock("expo-image-picker", ...)` before a dynamic import of the
 * module under test, so the real native package — and the real
 * `react-native` it would drag in — is never actually loaded.
 *
 * ## Deliberately NOT calling `resolvePermission` here
 *
 * This port's `getPermissionStatus`/`requestPermission` are read/write
 * primitives only — `capturePhoto` below never calls either, matching
 * `CameraCapturePort.capturePhoto`'s own doc comment ("a real
 * implementation must not re-resolve permission inside `capturePhoto`
 * itself"). `runCapturePress` (`attachment-capture-model.ts`) is the
 * one and only call site that sequences resolve-then-capture, and its
 * own test (`attachment-capture-model.test.ts`) proves the "exactly one
 * port-level resolution per press" invariant with a counting fake. See
 * `attachment-source-port.ts`'s `CameraCapturePort` doc comment for the
 * one thing this file's code cannot control: `launchCameraAsync` itself
 * re-checks the OS permission internally, one layer beneath this port.
 */
import * as ImagePicker from "expo-image-picker";

import { readUriAsBytes } from "./attachment-source-port.js";
import type { CameraCapturePort, PickedAttachmentFile } from "./attachment-source-port.js";
import type { PermissionState } from "./permission-recovery.js";

/** Mirrors `expo-image-picker`'s `PermissionResponse` (from `expo-modules-core`) — the subset this port reads. */
export interface ExpoCameraPermissionResponse {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/** One camera-capture result asset this port reads — the subset `expo-image-picker`'s real `ImagePickerAsset` provides. */
export interface CameraCaptureResultAsset {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string;
}

/** Mirrors `expo-image-picker`'s `ImagePickerResult` discriminated union. */
export type CameraCaptureResult =
  | { canceled: true }
  | { canceled: false; assets: CameraCaptureResultAsset[] };

/** Everything this port needs from `expo-image-picker`, injectable so `./expo-camera-capture-port.test.ts` never has to load the real native module. */
export interface CameraCaptureBindings {
  getCameraPermissionsAsync(): Promise<ExpoCameraPermissionResponse>;
  requestCameraPermissionsAsync(): Promise<ExpoCameraPermissionResponse>;
  launchCameraAsync(): Promise<CameraCaptureResult>;
}

const DEFAULT_BINDINGS: CameraCaptureBindings = {
  getCameraPermissionsAsync: () => ImagePicker.getCameraPermissionsAsync(),
  requestCameraPermissionsAsync: () => ImagePicker.requestCameraPermissionsAsync(),
  launchCameraAsync: () => ImagePicker.launchCameraAsync(),
};

/**
 * Maps `expo-image-picker`'s `PermissionResponse` onto this app's own
 * five-state `PermissionState` — mirrors `../voice/expo-audio-voice-
 * capture-port.ts`'s private `mapExpoPermission` (same shape,
 * duplicated rather than shared: that function is unexported and this
 * port's response type, while structurally identical today, is its own
 * declared shape per this file's own `ExpoCameraPermissionResponse`).
 * Expo's `canAskAgain: false` alongside `status: "denied"` is exactly
 * `"denied-permanently"` — Android's "don't ask again".
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
 * This build's real `CameraCapturePort` (T290) — the session route
 * mount's own default as of this task (see
 * `apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx`'s
 * "T290 mount" doc comment).
 */
export function createExpoCameraCapturePort(
  bindings: CameraCaptureBindings = DEFAULT_BINDINGS,
): CameraCapturePort {
  return {
    async getPermissionStatus() {
      return mapExpoPermission(await bindings.getCameraPermissionsAsync());
    },
    async requestPermission() {
      return mapExpoPermission(await bindings.requestCameraPermissionsAsync());
    },
    async capturePhoto(): Promise<PickedAttachmentFile | null> {
      const result = await bindings.launchCameraAsync();
      if (result.canceled || result.assets.length === 0) {
        return null;
      }
      const asset = result.assets[0]!;
      return {
        name: asset.fileName ?? "photo.jpg",
        mimeType: asset.mimeType,
        size: asset.fileSize,
        uri: asset.uri,
        readAsBytes: () => readUriAsBytes(asset.uri),
      };
    },
  };
}
