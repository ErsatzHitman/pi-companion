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
 * **GAP CLOSED by T290.** Until this task, `apps/android/package.json`
 * carried no `expo-image-picker` or `expo-document-picker`, and
 * `createUnavailableAttachmentSourcePort` below was this module's only
 * production implementation. The owner ran the install at `488c4dc`
 * (`expo-image-picker@~17.0.11`, `expo-document-picker@~14.0.8`, both
 * the pins this app's own `expo@54.0.37` gives in
 * `apps/android/node_modules/expo/bundledNativeModules.json`), and the
 * real port now lives in `./expo-attachment-source-port.ts`
 * (`createExpoAttachmentSourcePort`) — a separate file for the same
 * reason `../voice/expo-audio-voice-capture-port.ts` is split from
 * `../voice/voice-capture-port.ts`: `expo-document-picker` transitively
 * imports `react-native` (via `expo-modules-core`'s `Platform.ts`),
 * which this file and every test that imports it directly must stay
 * clear of.
 *
 * **The real port is backed by `expo-document-picker` alone, not
 * `expo-image-picker` — measured, not the design this header used to
 * sketch before either package was installed.** Two things were
 * measured directly against the resolved packages' own Android source,
 * not assumed from either README:
 *
 * - `expo-document-picker`'s `AndroidManifest.xml` declares no
 *   `<uses-permission>` at all (only an intent `<queries>` entry), and
 *   its `DocumentPickerModule.kt` contains zero permission checks —
 *   Android's Storage Access Framework (`ACTION_OPEN_DOCUMENT`) needs no
 *   app-level grant on any SDK. Its system browser UI already surfaces
 *   "Images", "Downloads", "Recent" and every other document provider
 *   in one screen, which is literally "pick images and documents" from
 *   a single native affordance — matching this port's one `pickFiles()`
 *   call with no accept filter to route on the way
 *   `../../platform/file-picker.ts` (T32P2, unwired pending this same
 *   install) already routes an unfiltered request to the document
 *   picker rather than the image library.
 * - `expo-image-picker`'s own `getMediaLibraryPermissions` (Android
 *   source: `ImagePickerModule.kt`) requests **zero** Android
 *   permissions on API 33+ (`Build.VERSION.SDK_INT >=
 *   Build.VERSION_CODES.TIRAMISU` branches to `emptyArray<String>()`),
 *   because `launchImageLibraryAsync` on those devices opens the system
 *   Photo Picker, which itself needs no runtime grant. `READ_MEDIA_
 *   IMAGES` — the permission Android 13 is commonly assumed to have
 *   introduced for this purpose — is never referenced anywhere in this
 *   package's Android source (`grep -rn "READ_MEDIA_IMAGES"
 *   node_modules/expo-image-picker` returns nothing). Below API 33 it
 *   requests the legacy `WRITE_EXTERNAL_STORAGE`/`READ_EXTERNAL_STORAGE`
 *   pair. Routing `pickFiles` through this path instead would have
 *   added a real permission dance for a picker that, on modern Android,
 *   needs none either — strictly worse for the user with no capability
 *   gained, since the document picker's own UI already includes images.
 *
 * So `getPermissionStatus`/`requestPermission` below genuinely have
 * nothing to gate and always resolve `"granted"` — an honest state, not
 * a shortcut: there is no OS permission standing between a press and
 * the picker opening. `permission-recovery.ts`'s `"photos"` copy
 * (`Composer.tsx`'s `PermissionRecoveryNotice kind="photos"`) stays
 * declared for the vocabulary's sake and is simply never rendered by
 * this real port, the same way it already renders nothing for any
 * `"granted"` read (`PermissionRecoveryNotice.tsx`'s own doc comment).
 *
 * `expo-image-picker` is still a real, used dependency: it backs
 * `./expo-camera-capture-port.ts`'s `CameraCapturePort` below. Both
 * packages the owner installed are in real production use, just for
 * different ports.
 *
 * `readUriAsBytes` below (shared by both real ports) reads a picked or
 * captured file's bytes using only `fetch`/`Blob`/`FileReader` — the
 * same globals React Native itself ships that
 * `../voice/expo-audio-voice-capture-port.ts` already relies on for the
 * identical reason: `apps/android/package.json` declares no
 * `expo-file-system`, and the only resolvable copy from
 * `apps/android/src` is the repository root's differently-versioned
 * hoist (`57.0.6`, for a different Expo SDK generation than this app's
 * own `54.0.37`). This task may not edit `package.json`. It also turns
 * out to be moot either way: `expo-document-picker`'s default
 * `copyToCacheDirectory: true` (kept as the default in
 * `expo-attachment-source-port.ts`) makes a copied result's `uri` a
 * plain `file://` URI in the app's own cache directory — measured
 * directly against `DocumentPickerModule.kt`'s
 * `copyDocumentToCacheDirectory`, which returns
 * `Uri.fromFile(outputFile)`, never the `content://` URI Storage Access
 * Framework hands back for `copyToCacheDirectory: false`. React
 * Native's `fetch` reads a local `file://` URI reliably (the
 * `content://` case that motivated `expo-file-system` in the first
 * place never arises here), so no new dependency is needed.
 *
 * CORRECTED at the P9-Q merge gate: the paragraph above opens by calling
 * `readUriAsBytes` "shared by both real ports" and then grounds the
 * no-`expo-file-system` conclusion entirely in `expo-document-picker` —
 * `copyToCacheDirectory` is not an option `launchCameraAsync` even has, so
 * one of the two ports was never measured. The conclusion does hold for the
 * camera port, by a different mechanism the paragraph never names:
 * `expo-image-picker`'s `MediaHandler.kt`'s `handleImage` returns
 * `Uri.fromFile(outputFile)`, so a captured photo is also a plain `file://`
 * URI. `attachment-model.ts` already carries the correct two-source version
 * of this claim ("`expo-document-picker`'s `copyToCacheDirectory: true`,
 * `expo-image-picker`'s `launchCameraAsync` — both measured directly against
 * their Android source"); prefer that wording if this is ever restated.
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

/**
 * Reads a local `file://` URI's full bytes using only globals React
 * Native itself ships (`fetch`/`Blob`/`FileReader`) — see this module's
 * header for why `expo-file-system` is neither available nor needed.
 * Shared by both real ports (`./expo-attachment-source-port.ts`'s
 * `pickFiles`, `./expo-camera-capture-port.ts`'s `capturePhoto`) so
 * `PickedAttachmentFile.readAsBytes()` behaves identically regardless
 * of which source produced the file. Declared here (not in either real
 * port file) because it needs no `expo-image-picker`/`expo-document-
 * picker` import at all — only globals — so it stays reachable from
 * this RN-free file without dragging `react-native` into it. Mirrors
 * `../voice/expo-audio-voice-capture-port.ts`'s `readClipAsBase64`,
 * swapping `readAsDataURL` for `readAsArrayBuffer` since this port's
 * contract (`PickedAttachmentFile.readAsBytes`) promises raw bytes, not
 * base64.
 */
export async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read the picked file"));
    };
    reader.onloadend = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error("Unexpected FileReader result reading the picked file"));
        return;
      }
      resolve(new Uint8Array(result));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * This build's DEFAULT injection fallback for `AttachmentSourcePort` —
 * used whenever a caller passes none (`Composer.tsx`'s
 * `attachmentSource ?? createUnavailableAttachmentSourcePort()`) or
 * wants attachment picking explicitly disabled. `./expo-attachment-
 * source-port.ts`'s `createExpoAttachmentSourcePort` is the real
 * production port the session mount actually passes (T290) — see this
 * module's header.
 */
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
 * **GAP CLOSED by T290.** The real port lives in
 * `./expo-camera-capture-port.ts` (`createExpoCameraCapturePort`),
 * reusing the same `expo-image-picker` install `./expo-attachment-
 * source-port.ts`'s header names (no additional package needed — a
 * standalone `expo-camera` dependency is only necessary for a custom
 * in-app camera viewfinder, which this feature does not build):
 * `getCameraPermissionsAsync`/`requestCameraPermissionsAsync` back this
 * port's `PermissionPort` half, and `launchCameraAsync` backs
 * `capturePhoto`. Nothing in `attachment-model.ts`,
 * `attachment-capture-model.ts`, or `Composer.tsx` changed for it — the
 * whole point of this seam.
 *
 * **One disclosed limit `capturePhoto`'s doc comment below cannot fully
 * hold to, measured directly against `expo-image-picker`'s own Android
 * source, not assumed.** That comment says a real implementation "must
 * not re-resolve permission inside `capturePhoto` itself" — true of
 * every line this port's own code writes: `capturePhoto` calls
 * `launchCameraAsync` and nothing else, never a second
 * `getCameraPermissionsAsync`/`requestCameraPermissionsAsync`. But
 * `expo-image-picker`'s native `launchCameraAsync` handler
 * (`ImagePickerModule.kt`'s `AsyncFunction("launchCameraAsync")`)
 * unconditionally calls its own private `ensureCameraPermissionsAreGranted()`
 * first, which issues a REAL `askForPermissions(CAMERA)` call inside the
 * vendor library — a second native-layer permission check this port's
 * TypeScript code neither makes nor can prevent, since it happens
 * beneath `launchCameraAsync`'s own boundary. In practice this causes no
 * double prompt: Android's permission API no-ops (shows no dialog) for
 * a permission already granted, and by the time `capturePhoto` runs,
 * `runCapturePress` (`attachment-capture-model.ts`) has already resolved
 * it to `"granted"` via this port's own methods. But it means the
 * on-device call graph genuinely asks the OS for `CAMERA` twice per
 * press — something no counting-fake test at the port boundary
 * (`attachment-capture-model.test.ts`) can see or prevent, since it
 * originates inside the vendor library's native code, not in this
 * port's TypeScript. Disclosed here rather than hidden: this is a
 * property of `expo-image-picker` itself, not a resolution this port's
 * own code adds (the exact trap this task's brief warned against
 * adding deliberately).
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

/**
 * This build's DEFAULT injection fallback for `CameraCapturePort` — used
 * whenever a caller passes none or wants camera capture explicitly
 * disabled. `./expo-camera-capture-port.ts`'s
 * `createExpoCameraCapturePort` is the real production port the session
 * mount actually passes (T290) — see this interface's own doc comment.
 */
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
