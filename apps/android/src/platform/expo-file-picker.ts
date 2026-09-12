/**
 * The real, `expo-document-picker`/`expo-image-picker`-backed `FilePicker`
 * (T32S11). See `./file-picker.ts`'s own header for the full design (the
 * two-picker split, the refusal vocabulary, and why a `copyToCacheDirectory`
 * result is read with `fetch` rather than `expo-file-system`) — this file
 * only constructs the `DocumentPickerModule`/`ImageLibraryPickerModule`/
 * `FileUriBytesReader` triple from the real native packages and hands it to
 * `createAndroidFilePicker`.
 *
 * ## RN-in-vitest split
 *
 * Deliberately a separate file from `./file-picker.ts`, for the identical
 * reason `../features/composer/expo-attachment-source-port.ts` is split from
 * its RN-free sibling: both `expo-document-picker` and `expo-image-picker`
 * import `expo-modules-core`, whose `Platform.ts` imports `react-native`,
 * which this workspace's plain `vitest` cannot transform. `./file-picker.ts`
 * (and `./file-picker.test.ts`) stay provable without that limitation
 * because they never import this file. `./expo-file-picker.test.ts` proves
 * this file the same way `expo-attachment-source-port.test.ts` does:
 * `vi.mock` of the two native packages (and `expo-modules-core`) before a
 * dynamic import, so the real packages — and the real `react-native` they
 * would drag in — are never actually loaded.
 *
 * `readUriAsBytes` is imported from the composer feature rather than
 * re-declared: it is the same `fetch`/`Blob`/`FileReader` reader
 * `../features/composer/attachment-source-port.ts` already ships and tests,
 * and `./file-picker.ts`'s own header names it as this port's real
 * `FileUriBytesReader`. It is RN-free, so importing it here adds no native
 * graph.
 */
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { FilePicker } from "@picompanion/frontend-core";

import { readUriAsBytes } from "../features/composer/attachment-source-port.js";
import type { PermissionState } from "../features/composer/permission-recovery.js";
import {
  createAndroidFilePicker,
  type DocumentPickerModule,
  type FileUriBytesReader,
  type ImageLibraryPickerModule,
} from "./file-picker.js";

/** The exact fields this module reads off `expo-modules-core`'s `PermissionResponse`. */
export interface ExpoMediaLibraryPermissionResponse {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/**
 * Everything this module needs from the two native pickers, injectable so
 * `./expo-file-picker.test.ts` can prove the composition without loading the
 * real native packages. `DEFAULT_BINDINGS` below is the object that actually
 * wires to them.
 */
export interface ExpoFilePickerBindings {
  documentPicker: DocumentPickerModule;
  imageLibraryPicker: ImageLibraryPickerModule;
  getMediaLibraryPermissionsAsync(): Promise<ExpoMediaLibraryPermissionResponse>;
  requestMediaLibraryPermissionsAsync(): Promise<ExpoMediaLibraryPermissionResponse>;
  readBytes: FileUriBytesReader;
}

/**
 * Maps `expo-image-picker`'s `PermissionResponse` onto this app's own
 * five-state `PermissionState` — the same rule
 * `../features/composer/expo-camera-capture-port.ts`'s private
 * `mapExpoPermission` applies (duplicated here because that function is
 * unexported and this port's response type, while structurally identical
 * today, is its own declared shape). Expo's `canAskAgain: false` alongside
 * `status: "denied"` is Android's "don't ask again".
 */
function mapExpoPermission(response: ExpoMediaLibraryPermissionResponse): PermissionState {
  if (response.granted) {
    return "granted";
  }
  if (response.status === "denied") {
    return response.canAskAgain === false ? "denied-permanently" : "denied";
  }
  return "undetermined";
}

const DEFAULT_BINDINGS: ExpoFilePickerBindings = {
  documentPicker: {
    getDocumentAsync: (options) => DocumentPicker.getDocumentAsync(options),
  },
  imageLibraryPicker: {
    launchImageLibraryAsync: (options) => ImagePicker.launchImageLibraryAsync(options),
  },
  getMediaLibraryPermissionsAsync: () => ImagePicker.getMediaLibraryPermissionsAsync(),
  requestMediaLibraryPermissionsAsync: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
  readBytes: readUriAsBytes,
};

/**
 * This build's real `FilePicker` — `../app-shell/core.ts`'s
 * `AppCore["filePicker"]` construction (T32S11). The media-library
 * permission surface `./file-picker.ts` needs is derived here from
 * `expo-image-picker`'s own read/request calls through `mapExpoPermission`,
 * so callers only inject the two pickers and a byte reader.
 */
export function createExpoFilePicker(
  bindings: ExpoFilePickerBindings = DEFAULT_BINDINGS,
): FilePicker {
  return createAndroidFilePicker({
    documentPicker: bindings.documentPicker,
    imageLibraryPicker: bindings.imageLibraryPicker,
    imageLibraryPermission: {
      getPermissionStatus: async () =>
        mapExpoPermission(await bindings.getMediaLibraryPermissionsAsync()),
      requestPermission: async () =>
        mapExpoPermission(await bindings.requestMediaLibraryPermissionsAsync()),
    },
    readBytes: bindings.readBytes,
  });
}
