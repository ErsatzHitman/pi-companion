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
 * **Re-checked directly for T282** (which wired `Composer.tsx`'s sibling
 * `transcribeClient` prop at the session mount and considered wiring
 * these two ports at the same time): neither package resolves from this
 * workspace today. `require.resolve("expo-image-picker", { paths:
 * ["apps/android/src"] })` and the same call for `expo-document-picker`
 * both throw `Cannot find module`, checked against both
 * `apps/android/node_modules` and the repository root's — this is still
 * a real install gap, not a stale claim carried forward unchecked.
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
  /**
   * T278: a local platform URI (`file://…`, `content://…`) for this
   * file, when the port has one cheaply available — every real picker
   * and camera API already hands back a URI before any bytes are read,
   * so this is never extra work for an implementation to provide.
   * Optional and orthogonal to `readAsBytes()`: `uri` is a rendering
   * hint for `Composer.tsx` to build an image thumbnail from (see
   * `attachment-model.ts`'s `StagedAttachment.previewUri` doc comment
   * for why a URI rather than reading the bytes up front), while
   * `readAsBytes()` remains the only path actual upload content ever
   * travels through — this module still never reads a file's bytes
   * itself. `undefined` for a file whose port has no cheap URI to hand
   * back (there is none today: `createUnavailableAttachmentSourcePort`/
   * `createUnavailableCameraCapturePort` below never produce a picked
   * file at all).
   */
  uri?: string;
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

/**
 * T278: capturing a NEW photo with the device camera, as a SIBLING port
 * to `AttachmentSourcePort` above — not an extra method on it. Argued,
 * not just asserted:
 *
 * - **Different OS permission.** `AttachmentSourcePort` gates Android's
 *   media-library/document access; a camera capture gates the separate
 *   `CAMERA` permission. Even within the one library this module's own
 *   header already commits to installing for `pickFiles`
 *   (`expo-image-picker`), the SDK itself keeps these apart:
 *   `getMediaLibraryPermissionsAsync`/`requestMediaLibraryPermissionsAsync`
 *   for the library picker versus `getCameraPermissionsAsync`/
 *   `requestCameraPermissionsAsync` for `launchCameraAsync`. Folding
 *   both onto one `PermissionPort` would make `AttachmentSourcePort`'s
 *   single `getPermissionStatus()` answer for two different OS grants
 *   depending on which method the caller was about to call — exactly
 *   the ambiguity `PermissionPort` (`permission-recovery.ts`) exists to
 *   avoid, and exactly why this feature renders permission recovery
 *   with a `PermissionKind` per real-world purpose (`"photo-capture"`,
 *   `permission-recovery.ts`, added by this same task) rather than
 *   reusing `"photos"` for a request that was never a photos-library
 *   read at all.
 * - **Different failure/cancel path.** Dismissing a file/photo chooser
 *   (`pickFiles` resolving to `[]`) and dismissing the system camera
 *   activity without taking a shot are different OS surfaces with
 *   different dismissal gestures, even though both resolve the same
 *   way at this port's boundary (see `capturePhoto`'s own doc comment).
 * - **Precedent already in this feature.** `../voice/voice-capture-port.ts`'s
 *   `VoiceCapturePort` is already a sibling `PermissionPort`, not a
 *   method bolted onto this interface or onto some other one — camera
 *   capture is the same shape of addition. T83's own fix
 *   (`mic-press-model.ts`) was never "one physical permission must have
 *   one port"; it was "one physical permission must be resolved
 *   EXACTLY ONCE per user press, regardless of how many ports read it".
 *   Camera and photo-library access are two DIFFERENT physical
 *   permissions, so giving them two ports does not reintroduce that
 *   bug — see `attachment-capture-model.ts`'s `runCapturePress` for how
 *   this port's own one-resolution-per-press discipline is kept, and
 *   that module's tests for the proof.
 *
 * No camera dependency is installed in this workspace either (same
 * constraint as `AttachmentSourcePort` above), so
 * `createUnavailableCameraCapturePort` below is this port's only
 * production implementation. To wire a real one, reuse the SAME
 * `expo-image-picker` install already named above (no additional
 * package needed — a standalone `expo-camera` dependency would only be
 * necessary for a custom in-app camera viewfinder, which this feature
 * does not build): call `launchCameraAsync` for `capturePhoto`, backed
 * by `getCameraPermissionsAsync`/`requestCameraPermissionsAsync` for
 * this port's `PermissionPort` half. Nothing in `attachment-model.ts`,
 * `attachment-capture-model.ts`, or `Composer.tsx` needs to change for
 * that swap — the whole point of this seam.
 */
export interface CameraCapturePort extends PermissionPort {
  /**
   * Opens the device camera and resolves with the photo taken, or
   * `null` (not a rejection) when the user backs out of the camera
   * activity without taking one — mirroring `AttachmentSourcePort.
   * pickFiles` resolving to `[]` on dismissal. Callers (see
   * `attachment-capture-model.ts`'s `runCapturePress`) only ever call
   * this AFTER `resolvePermission` on this same port has already
   * returned `"granted"` — a real implementation must not re-resolve
   * permission inside `capturePhoto` itself, or a capture press would
   * cost the user two OS prompts for one permission, the exact bug T83
   * closed for the microphone.
   */
  capturePhoto(): Promise<PickedAttachmentFile | null>;
}

/** This build's only production `CameraCapturePort` — see this interface's own doc comment. */
export function createUnavailableCameraCapturePort(): CameraCapturePort {
  return {
    async getPermissionStatus() {
      return "unavailable";
    },
    async requestPermission() {
      return "unavailable";
    },
    async capturePhoto() {
      return null;
    },
  };
}
