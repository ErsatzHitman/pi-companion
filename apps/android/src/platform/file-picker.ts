import type { FilePickOptions, FilePicker, PickedFile } from "@picompanion/frontend-core";

import type { PermissionPort, PermissionState } from "../features/composer/permission-recovery.js";
import { resolvePermission } from "../features/composer/permission-recovery.js";

/**
 * Real `FilePicker` for Android — T32P2.
 *
 * `apps/web/src/platform/file-picker.ts` backs the same `@picompanion/
 * frontend-core` `FilePicker` interface with a hidden `<input
 * type="file">`; this module is Android's counterpart, implementing
 * that interface — not a second one — the way `../platform/
 * native-network-reachability.ts` implements `NetworkReachability`
 * against an injected `NetInfoModule`-shaped port: no
 * `expo-document-picker` or `expo-image-picker` import here, so this
 * file stays provable in plain `vitest` against scripted fakes the same
 * way that `NetInfoModule` port already is. **CORRECTED (T290)**: this
 * used to give the reason as "neither is installed in this workspace
 * (`apps/android/package.json` carries neither...)" — the owner
 * installed both at `488c4dc` and T290 used them for
 * `../features/composer`'s own `AttachmentSourcePort`/
 * `CameraCapturePort`. `apps/android/package.json` now carries both;
 * this file still declares two small ports shaped exactly like those
 * libraries' real exports (`DocumentPickerModule`,
 * `ImageLibraryPickerModule`) and a byte-reading port
 * (`FileUriBytesReader`), and takes all three as constructor
 * dependencies, so every rule below is real and provable in plain
 * `vitest` against scripted fakes (see `file-picker.test.ts`) with zero
 * native import anywhere in this file.
 *
 * ---------------------------------------------------------------------
 * Why two picker ports, not one
 * ---------------------------------------------------------------------
 * `../features/composer/attachment-source-port.ts` (T33B7) already
 * documents the real production plan for Android file picking: generic
 * files go through `expo-document-picker`'s system picker (Android's
 * Storage Access Framework — an OS-owned activity that needs no
 * `PermissionPort` of its own, unlike iOS), while an image-only request
 * goes through `expo-image-picker`'s media-library picker, which *is*
 * permission-gated (`getMediaLibraryPermissionsAsync`/
 * `requestMediaLibraryPermissionsAsync`). This module reuses that same
 * split rather than inventing a different one: `pickFiles` routes to
 * the image-library port only when every requested `accept` pattern is
 * image-only (`isImageOnlyAccept` below); everything else — including
 * no filter at all — goes through the document picker, matching what a
 * generic "attach a file" affordance (this interface's actual caller,
 * `../features/files/file-upload-model.ts`) needs.
 *
 * The permission surface itself is not reinvented either:
 * `imageLibraryPermission` is `../features/composer/
 * permission-recovery.ts`'s existing `PermissionPort`, and this module
 * calls that file's own `resolvePermission` (read first, prompt only
 * when genuinely `"undetermined"`) — the exact same rule
 * `attachment-source-port.ts`'s eventual real port and
 * `../features/connect/qr-scanner-port.ts`'s camera port both follow.
 * `describePermissionRecovery("photos", state)` already exists there
 * for this exact kind (`"Photo and file" access, "attach files to a
 * message"`), so no fourth permission vocabulary is declared here.
 *
 * ---------------------------------------------------------------------
 * Refusal vocabulary (T32P2's "every refusal path lands in a named
 * state" acceptance criterion)
 * ---------------------------------------------------------------------
 * `FilePicker.pickFiles` returns `Promise<PickedFile[]>` — there is no
 * room in that signature for a distinct "refused" value alongside a
 * result, so refusals are expressed the same way
 * `../features/files/file-upload-model.ts`'s `selectFile()` already
 * anticipates them (see that method's own `.catch()` comment: "A
 * picker rejection (permission denial, unsupported environment) is not
 * this file's fault"): a *rejection* whose `Error.message` is one of
 * the sentinel constants below, so a caller (or a future explaining
 * layer) can `switch` on the exact string the way
 * `../features/files/file-browser-client.ts`'s `explainFileUploadError`
 * already does for `FILE_UPLOAD_NOT_CONNECTED` and friends.
 *
 * - **Cancelled**: the user dismissed the native picker without
 *   choosing anything. Both `DocumentPickerResult` and
 *   `ImagePickerResult` report this as `{ canceled: true }` — a real,
 *   always-reported signal from both libraries, not inferred — and
 *   this module resolves `[]` for it, matching web's `FilePicker`
 *   convention (an empty array, not a rejection) and
 *   `file-upload-model.ts`'s own `if (!picked) return;` no-op path.
 * - **Permission denied / denied permanently / unavailable**: only
 *   reachable on the image-library branch (the document picker has no
 *   permission concept on Android — see above). Rejects with
 *   `FILE_PICKER_PERMISSION_DENIED`, `FILE_PICKER_PERMISSION_DENIED_
 *   PERMANENTLY`, or `FILE_PICKER_UNAVAILABLE` for the matching
 *   `PermissionState`.
 * - **Unsupported type**: Android's Storage Access Framework treats a
 *   provider's declared `type` filter as advisory — some document
 *   providers return files that do not match it. This module re-checks
 *   every document-picker result's `mimeType` against the requested
 *   `accept` patterns after the fact (`matchesAccept`) and rejects the
 *   whole pick with `FILE_PICKER_UNSUPPORTED_TYPE` if anything slipped
 *   through unmatched, rather than silently keeping a partial,
 *   surprising subset. A `mimeType` the provider never reported at all
 *   is let through unchecked — there is nothing left here to validate
 *   against, and the OS was already asked to filter by `type`.
 * - **Oversize**: deliberately *not* one of this module's refusal
 *   states. `file-upload-model.ts`'s `runUpload()` already refuses an
 *   oversized selection pre-flight (against `MAX_UPLOAD_BYTES`,
 *   *before* `readAsBytes()`/`client.uploadFile` when the size is
 *   already known) and renders that as its own `"refused"` state with
 *   `explainOversizedUpload`. If this module also refused at pick time,
 *   `selectFile()`'s blanket `.catch()` would swallow that rejection
 *   silently — no selection, no `"refused"` UI, strictly *worse* than
 *   today's already-tested behaviour. So a picked file's declared (or
 *   unknown) size is always passed through here, exactly as the OS
 *   reported it, and the existing upload controller keeps owning the
 *   bound. See `./sharing.ts` for where an oversize refusal *does*
 *   belong on this task's two adapters.
 *
 * ---------------------------------------------------------------------
 * What is not yet installed, named exactly (T32P2's "name it" rule)
 * ---------------------------------------------------------------------
 * Nothing in this file constructs `createAndroidFilePicker` in
 * production — there is no live `DocumentPickerModule`/
 * `ImageLibraryPickerModule`/`FileUriBytesReader` to hand it yet, and
 * wiring one is the router root's job (T32S11), not this task's — see
 * this task's report for the exact call site. **CORRECTED (T290)**: the
 * two `npm install` commands below used to both be open; the owner ran
 * the first two (not the third) at `488c4dc`:
 *
 *     npm install --workspace=@picompanion/android expo-document-picker@~14.0.8   [DONE, 488c4dc]
 *     npm install --workspace=@picompanion/android expo-image-picker@~17.0.11    [DONE, 488c4dc]
 *     npm install --workspace=@picompanion/android expo-file-system@~19.0.24     [still open]
 *
 * (versions pinned by *this app's own*
 * `apps/android/node_modules/expo/bundledNativeModules.json`, matching
 * `apps/android/package.json`'s `"expo": "^54.0.18"` — not whatever a
 * differently-versioned `expo` hoisted from another worktree's install
 * happens to report at the repo root.) T290 used the first two for
 * `../features/composer`'s own `AttachmentSourcePort`/
 * `CameraCapturePort` — see that feature's `expo-attachment-source-
 * port.ts` for why `expo-file-system` turned out to be avoidable there
 * (a `copyToCacheDirectory: true` default makes every URI `file://`,
 * which `fetch`/`Blob`/`FileReader` reads reliably with no new
 * dependency). **Noticed, not resolved, while making that same check
 * here**: `createAndroidFilePicker`'s own document-picker branch below
 * also hardcodes `copyToCacheDirectory: true`, which — by the identical
 * reasoning — would also produce `file://` URIs, not the `content://`
 * ones this section's very next paragraph says motivate
 * `expo-file-system`. Whether that makes `expo-file-system` avoidable
 * here too (for the document-picker branch; the image-library branch's
 * URI shape was not checked) is `T32S11`'s question to answer when it
 * actually wires this file, not decided either way by this task.
 *
 * `expo-document-picker`'s and `expo-image-picker`'s default exports
 * already structurally satisfy `DocumentPickerModule` and
 * `ImageLibraryPickerModule` as declared below — no wrapper needed
 * beyond the import itself, exactly like `NetInfoModule`. `FileUriBytesReader`
 * has no single matching native export: the real implementation reads
 * `expo-file-system`'s `readAsStringAsync(uri, { encoding:
 * EncodingType.Base64 })` and decodes the result to `Uint8Array` — a
 * plain `fetch(uri)` is *not* a safe substitute here, because Android's
 * Storage Access Framework hands back `content://` URIs, which RN's
 * `fetch` polyfill does not reliably read.
 */

/** Sentinel `Error.message` this module rejects `pickFiles()` with when the image-library permission read/request settles on `"denied"`. */
export const FILE_PICKER_PERMISSION_DENIED = "FILE_PICKER_PERMISSION_DENIED";

/** Sentinel for Android's "don't ask again" permission state — see `../features/composer/permission-recovery.ts`'s `"denied-permanently"`. */
export const FILE_PICKER_PERMISSION_DENIED_PERMANENTLY =
  "FILE_PICKER_PERMISSION_DENIED_PERMANENTLY";

/** Sentinel for a `PermissionState` of `"unavailable"` — no native permission module to ask at all. Also what `createUnavailableFilePicker` below always rejects with. */
export const FILE_PICKER_UNAVAILABLE = "FILE_PICKER_UNAVAILABLE";

/** Sentinel `pickFiles()` rejects with when a document-picker result contains a file whose `mimeType` does not match any requested `accept` pattern — see this module's doc comment. */
export const FILE_PICKER_UNSUPPORTED_TYPE = "FILE_PICKER_UNSUPPORTED_TYPE";

/** One file the document picker returned. Mirrors `expo-document-picker`'s `DocumentPickerAsset` field-for-field (the subset this module reads). */
export interface DocumentPickerAsset {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

/** Mirrors `expo-document-picker`'s `DocumentPickerResult` discriminated union exactly. */
export type DocumentPickerResult =
  | { canceled: true }
  | { canceled: false; assets: DocumentPickerAsset[] };

export interface DocumentPickerOptions {
  /** MIME type filter(s) — passed straight through from `FilePickOptions.accept`. A wildcard everything-pattern means no filter. */
  type?: string | string[];
  multiple?: boolean;
  copyToCacheDirectory?: boolean;
}

/** Shaped exactly like `expo-document-picker`'s default export's `getDocumentAsync`. */
export interface DocumentPickerModule {
  getDocumentAsync(options?: DocumentPickerOptions): Promise<DocumentPickerResult>;
}

/** One asset the image-library picker returned. Mirrors `expo-image-picker`'s `ImagePickerAsset` (the subset this module reads). */
export interface ImagePickerAsset {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string;
}

/** Mirrors `expo-image-picker`'s `ImagePickerResult` discriminated union exactly. */
export type ImagePickerResult =
  | { canceled: true }
  | { canceled: false; assets: ImagePickerAsset[] };

export interface ImageLibraryPickerOptions {
  allowsMultipleSelection?: boolean;
}

/** Shaped exactly like `expo-image-picker`'s default export's `launchImageLibraryAsync`. Permission methods live on the injected `PermissionPort` instead, so this port only needs the launch call. */
export interface ImageLibraryPickerModule {
  launchImageLibraryAsync(options?: ImageLibraryPickerOptions): Promise<ImagePickerResult>;
}

/**
 * Reads a picked file's full bytes from its native `uri` (`content://`
 * or `file://`). Not shaped after one specific native export — see this
 * module's doc comment for why `expo-file-system`'s
 * `readAsStringAsync` + base64 decode, not `fetch`, is the real
 * implementation once that package is installed.
 */
export type FileUriBytesReader = (uri: string) => Promise<Uint8Array>;

export interface AndroidFilePickerDeps {
  documentPicker: DocumentPickerModule;
  imageLibraryPicker: ImageLibraryPickerModule;
  /** Gates `imageLibraryPicker` — read/request follows `resolvePermission`'s rule (read first, prompt only when `"undetermined"`). */
  imageLibraryPermission: PermissionPort;
  readBytes: FileUriBytesReader;
}

/** True only when every requested pattern is image-specific (`"image/*"` or `"image/png"`, etc.) — see this module's doc comment for why that alone routes to the permission-gated image-library picker instead of the document picker. */
export function isImageOnlyAccept(accept?: string[]): boolean {
  if (!accept || accept.length === 0) return false;
  return accept.every((pattern) => pattern.startsWith("image/"));
}

/** True when `mimeType` matches at least one `accept` pattern (exact match, or a `"type/*"` wildcard prefix match), or when there is no filter, or when `mimeType` itself is unknown (nothing left to validate against). */
export function matchesAccept(mimeType: string | undefined, accept?: string[]): boolean {
  if (!accept || accept.length === 0) return true;
  if (!mimeType) return true;
  return accept.some((pattern) => {
    if (pattern === "*/*") return true;
    if (pattern.endsWith("/*")) return mimeType.startsWith(pattern.slice(0, -1));
    return mimeType === pattern;
  });
}

function toPickedFile(
  name: string,
  mimeType: string | undefined,
  size: number | undefined,
  uri: string,
  readBytes: FileUriBytesReader,
): PickedFile {
  return {
    name,
    mimeType,
    size,
    readAsBytes: () => readBytes(uri),
  };
}

/** Maps an image-library `PermissionState` to the sentinel `pickFiles()` rejects with. `"granted"` and `"undetermined"` (resolved by `resolvePermission` before this is ever called) never reach here. */
function permissionDenialSentinel(state: PermissionState): string {
  switch (state) {
    case "denied":
      return FILE_PICKER_PERMISSION_DENIED;
    case "denied-permanently":
      return FILE_PICKER_PERMISSION_DENIED_PERMANENTLY;
    case "unavailable":
      return FILE_PICKER_UNAVAILABLE;
    default:
      return FILE_PICKER_PERMISSION_DENIED;
  }
}

/**
 * The real `FilePicker` this task builds — see the module doc comment
 * for the full routing/refusal rules. Not constructed anywhere in this
 * app yet; see this task's report for the exact `AppCore` seam T32S11
 * still needs to wire, once the packages named above are installed.
 */
export function createAndroidFilePicker(deps: AndroidFilePickerDeps): FilePicker {
  return {
    async pickFiles(options?: FilePickOptions): Promise<PickedFile[]> {
      if (isImageOnlyAccept(options?.accept)) {
        const state = await resolvePermission(deps.imageLibraryPermission);
        if (state !== "granted") {
          throw new Error(permissionDenialSentinel(state));
        }
        const result = await deps.imageLibraryPicker.launchImageLibraryAsync({
          allowsMultipleSelection: options?.multiple ?? false,
        });
        if (result.canceled) return [];
        return result.assets.map((asset) =>
          toPickedFile(
            asset.fileName ?? "image",
            asset.mimeType,
            asset.fileSize,
            asset.uri,
            deps.readBytes,
          ),
        );
      }

      const result = await deps.documentPicker.getDocumentAsync({
        type: options?.accept && options.accept.length > 0 ? options.accept : "*/*",
        multiple: options?.multiple ?? false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return [];

      const files = result.assets.map((asset) =>
        toPickedFile(asset.name, asset.mimeType, asset.size, asset.uri, deps.readBytes),
      );
      const hasUnsupported = result.assets.some(
        (asset) => !matchesAccept(asset.mimeType, options?.accept),
      );
      if (hasUnsupported) {
        throw new Error(FILE_PICKER_UNSUPPORTED_TYPE);
      }
      return files;
    },
  };
}

/**
 * The only production `FilePicker` this build can construct today —
 * mirrors `../features/composer/attachment-source-port.ts`'s
 * `createUnavailableAttachmentSourcePort` exactly (same reason: no
 * picker package is installed). Every call rejects with
 * `FILE_PICKER_UNAVAILABLE`, landing in `file-upload-model.ts`'s
 * existing `selectFile()` `.catch()` — an honest "nothing happened",
 * never a fabricated empty success.
 */
export function createUnavailableFilePicker(): FilePicker {
  return {
    async pickFiles(): Promise<PickedFile[]> {
      throw new Error(FILE_PICKER_UNAVAILABLE);
    },
  };
}
