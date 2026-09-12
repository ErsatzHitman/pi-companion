/**
 * The real, `expo-sharing`/`expo-file-system`-backed `Sharing` (T32S11).
 * See `./sharing.ts`'s own header for the full design (the text-vs-file
 * split, the per-file sequencing, and the refusal vocabulary) — this file
 * only constructs the `NativeFileShareModule`/`ShareableFileWriter` pair
 * from the real native packages and hands it, with RN's own `Share.share`
 * for text, to `createAndroidSharing`.
 *
 * ## RN-in-vitest split
 *
 * Deliberately a separate file from `./sharing.ts`, for the identical
 * reason `../features/composer/expo-attachment-source-port.ts` is split from
 * its RN-free sibling: `expo-sharing` and `expo-file-system/legacy` each
 * import `expo-modules-core`, whose `Platform.ts` imports `react-native`,
 * which this workspace's plain `vitest` cannot transform. `./sharing.ts`
 * (and `./sharing.test.ts`) stay provable without that limitation because
 * they never import this file. `./expo-sharing-port.test.ts` proves this
 * file the same way: `vi.mock` of the native packages before a dynamic
 * import, so the real packages are never actually loaded.
 *
 * `bytesToBase64` is a separate, RN-free module (`./bytes-to-base64.ts`)
 * because it is the one piece of this file with real logic of its own; see
 * that module's header for why a hand-rolled encoder rather than a global.
 */
import type { ShareableFile, Sharing as SharingPort } from "@picompanion/frontend-core";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { bytesToBase64 } from "./bytes-to-base64.js";
import { createRNShareModule } from "./native-share-module.js";
import {
  createAndroidSharing,
  type NativeFileShareModule,
  type NativeShareModule,
  type ShareableFileWriter,
} from "./sharing.js";

/**
 * Writes one `ShareableFile`'s bytes to a local cache path and resolves with
 * the `file://` URI `expo-sharing`'s `shareAsync` opens — the real
 * implementation `./sharing.ts`'s `ShareableFileWriter` doc comment names:
 * base64-encode the raw bytes, then `expo-file-system`'s
 * `writeAsStringAsync(uri, base64, { encoding: EncodingType.Base64 })`
 * against `cacheDirectory + file.name`. `cacheDirectory` is typed
 * `string | null`; on a real device it is always set, and a null is a real
 * platform failure surfaced honestly rather than a `file.name`-only URI.
 */
export async function writeShareableFileToCache(file: ShareableFile): Promise<string> {
  const directory = FileSystem.cacheDirectory;
  if (!directory) {
    throw new Error("expo-file-system reported no cache directory to write a shareable file into");
  }
  const uri = `${directory}${file.name}`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(file.data), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/**
 * Everything this module needs from the native packages and RN's `Share`,
 * injectable so `./expo-sharing-port.test.ts` can prove the composition
 * without loading any of them. `DEFAULT_BINDINGS` below is the object that
 * actually wires to them.
 */
export interface ExpoSharingBindings {
  nativeShare: NativeShareModule;
  nativeFileShare: NativeFileShareModule;
  writeShareableFile: ShareableFileWriter;
}

const DEFAULT_BINDINGS: ExpoSharingBindings = {
  nativeShare: createRNShareModule(),
  nativeFileShare: {
    isAvailableAsync: () => Sharing.isAvailableAsync(),
    shareAsync: (url, options) => Sharing.shareAsync(url, options),
  },
  writeShareableFile: writeShareableFileToCache,
};

/**
 * This build's real `Sharing` — `../app-shell/core.ts`'s
 * `AppCore["sharing"]` construction (T32S11). `shareText` reaches RN's own
 * `Share.share` through `createRNShareModule()`; `shareFiles` writes each
 * file to cache and opens the OS share sheet through `expo-sharing`.
 */
export function createExpoSharing(bindings: ExpoSharingBindings = DEFAULT_BINDINGS): SharingPort {
  return createAndroidSharing(bindings);
}
