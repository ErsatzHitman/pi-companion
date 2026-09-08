/**
 * The real, `expo-document-picker`-backed `AttachmentSourcePort` (T290,
 * plan.md §9.2/§12.4). See `./attachment-source-port.ts`'s own header
 * for the full design decision (why `expo-document-picker` alone, why
 * `getPermissionStatus`/`requestPermission` always resolve `"granted"`,
 * and the `expo-file-system`-free byte-reading story) — this file only
 * carries the implementation.
 *
 * ## RN-in-vitest split
 *
 * Deliberately a separate file from `attachment-source-port.ts`, for
 * the identical reason `../voice/expo-audio-voice-capture-port.ts` is
 * split from `../voice/voice-capture-port.ts` (see that file's header):
 * `expo-document-picker` imports `expo-modules-core`, whose `src/
 * index.ts` exports `Platform` from `./Platform`, which does
 * `import { Platform as ReactNativePlatform } from "react-native"` at
 * its top level — so importing `expo-document-picker` transitively
 * imports `react-native`, the RN-in-vitest limitation this repository's
 * CLAUDE.md catalogues (any test importing a module that reaches
 * `react-native` fails with a RolldownError). `attachment-source-port.ts`
 * (and every test that imports it directly — `attachment-capture-
 * model.test.ts`, `attachment-wiring.test.ts`, `permission-recovery.
 * test.ts`) stays untouched by that limitation because it never imports
 * this file. `./expo-attachment-source-port.test.ts` proves itself the
 * same way `expo-audio-voice-capture-port.test.ts` does: `vi.mock
 * ("expo-document-picker", ...)` before a dynamic import of the module
 * under test, so the real native package — and the real `react-native`
 * it would drag in — is never actually loaded.
 */
import * as DocumentPicker from "expo-document-picker";

import { readUriAsBytes } from "./attachment-source-port.js";
import type {
  AttachmentFilePickOptions,
  AttachmentSourcePort,
  PickedAttachmentFile,
} from "./attachment-source-port.js";

/** One document-picker result asset this port reads — the subset `expo-document-picker`'s real `DocumentPickerAsset` provides. */
export interface DocumentPickerResultAsset {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

/** Mirrors `expo-document-picker`'s `DocumentPickerResult` discriminated union. */
export type DocumentPickerResult =
  | { canceled: true }
  | { canceled: false; assets: DocumentPickerResultAsset[] };

/** Everything this port needs from `expo-document-picker`, injectable so `./expo-attachment-source-port.test.ts` never has to load the real native module. */
export interface AttachmentSourceBindings {
  getDocumentAsync(options: {
    type: string;
    multiple: boolean;
    copyToCacheDirectory: boolean;
  }): Promise<DocumentPickerResult>;
}

const DEFAULT_BINDINGS: AttachmentSourceBindings = {
  getDocumentAsync: (options) => DocumentPicker.getDocumentAsync(options),
};

/**
 * This build's real `AttachmentSourcePort` (T290) — the session route
 * mount's own default as of this task (see
 * `apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx`'s
 * "T290 mount" doc comment). See `./attachment-source-port.ts`'s header
 * for why `getPermissionStatus`/`requestPermission` always resolve
 * `"granted"` — the document picker this port opens needs no Android
 * permission at all.
 */
export function createExpoAttachmentSourcePort(
  bindings: AttachmentSourceBindings = DEFAULT_BINDINGS,
): AttachmentSourcePort {
  return {
    async getPermissionStatus() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },
    async pickFiles(options?: AttachmentFilePickOptions): Promise<PickedAttachmentFile[]> {
      const result = await bindings.getDocumentAsync({
        type: "*/*",
        multiple: options?.multiple ?? false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return [];
      }
      return result.assets.map((asset) => ({
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        uri: asset.uri,
        readAsBytes: () => readUriAsBytes(asset.uri),
      }));
    },
  };
}
