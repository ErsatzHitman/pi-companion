/**
 * Attachment-picker port (T33B7, plan.md §9.2/§12.4). This feature is
 * the sole owner of Android attachment picking this wave — see this
 * directory's other files' doc comments and this task's report.
 *
 * A minimal, RN-free seam between `attachment-model.ts`'s pure staging
 * logic and whatever native picker actually asks the OS for photo/file
 * access and returns picked files, mirroring
 * `../connect/qr-scanner-port.ts`'s `CameraScannerPort` shape exactly
 * (permission read/request) plus the one extra operation a file picker
 * needs: `pickFiles`.
 *
 * `PickedAttachmentFile` mirrors `packages/frontend-core/src/platform/
 * file-picker.ts`'s `PickedFile` field-for-field (name/mimeType/size/
 * lazy `readAsBytes()`) rather than inventing a shape, but is declared
 * locally instead of imported: that file's `FilePicker` is the *web*
 * DOM-file-input seam (plan.md §7.3's platform-neutral contract apps/web
 * already implements over a hidden `<input type="file">`), and
 * `packages/frontend-core` is out of scope to edit this wave. Android
 * has no such adapter yet — see below.
 *
 * **No photo/document picker dependency is installed in this
 * workspace.** `apps/android/package.json` carries no `expo-image-
 * picker` or `expo-document-picker` today, and this task may not run
 * `npm install`. `createUnavailableAttachmentSourcePort` below is
 * therefore this module's only production implementation: it always
 * reports `"unavailable"` and never returns a picked file, which
 * `Composer.tsx` renders through `permission-recovery.ts`'s own
 * `"unavailable"` copy — a distinct, honest state from a user's own
 * `"denied"` choice.
 *
 * To wire a real picker once available (versions pinned exactly per
 * `apps/android/node_modules/expo/bundledNativeModules.json` — read
 * from *this app's own* installed `expo` (54.0.37, matching
 * `apps/android/package.json`'s `"expo": "^54.0.18"`), not the
 * differently-versioned `expo` (57.0.18) hoisted into the repo root's
 * `node_modules` from other worktrees' installs — those pins are for a
 * different Expo SDK and would mismatch this app's):
 *
 *   npm install --workspace=@picompanion/android expo-image-picker@~17.0.11
 *   npm install --workspace=@picompanion/android expo-document-picker@~14.0.8
 *
 * — then add a second implementation of `AttachmentSourcePort` backed
 * by `expo-image-picker`'s `getMediaLibraryPermissionsAsync`/
 * `requestMediaLibraryPermissionsAsync` (mapping its
 * `PermissionStatus`/`canAskAgain` onto `PermissionState` — Expo's
 * `canAskAgain: false` alongside `status: "denied"` is exactly
 * `"denied-permanently"`) and `launchImageLibraryAsync`/
 * `expo-document-picker`'s `getDocumentAsync` for `pickFiles`, wrapping
 * each result's `uri` in a `readAsBytes()` that reads it lazily via
 * `expo-file-system`. Nothing in `attachment-model.ts` or
 * `Composer.tsx` needs to change for that swap — the whole point of
 * this seam.
 */
import type { PermissionPort } from "./permission-recovery.js";

/**
 * A single file selected from the OS picker. Content is read lazily so
 * a large file is not forced into memory before the caller decides to
 * upload it — same rationale as `packages/frontend-core`'s
 * `PickedFile`.
 */
export interface PickedAttachmentFile {
  name: string;
  mimeType?: string;
  size?: number;
  readAsBytes(): Promise<Uint8Array>;
}

export interface AttachmentFilePickOptions {
  multiple?: boolean;
}

export interface AttachmentSourcePort extends PermissionPort {
  /**
   * Opens the native picker and resolves with every file the user
   * selected. Resolves to `[]` (not a rejection) when the user
   * dismisses the picker without choosing anything, or when this port
   * is `"unavailable"`.
   */
  pickFiles(options?: AttachmentFilePickOptions): Promise<PickedAttachmentFile[]>;
}

/** This build's only production `AttachmentSourcePort` — see module docstring. */
export function createUnavailableAttachmentSourcePort(): AttachmentSourcePort {
  return {
    async getPermissionStatus() {
      return "unavailable";
    },
    async requestPermission() {
      return "unavailable";
    },
    async pickFiles() {
      return [];
    },
  };
}
