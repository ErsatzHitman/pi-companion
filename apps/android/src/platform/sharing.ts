import type {
  ShareFilesOptions,
  ShareTextOptions,
  ShareableFile,
  Sharing,
} from "@picompanion/frontend-core";

import { MAX_DOWNLOAD_BYTES } from "../features/files/file-browser-client.js";

/**
 * Real `Sharing` for Android — T32P2.
 *
 * `apps/web/src/platform/sharing.ts` backs the same `@picompanion/
 * frontend-core` `Sharing` interface with the Web Share API, letting a
 * user-cancelled `navigator.share()` rejection simply propagate rather
 * than inventing a caught "cancelled" state of its own; this module
 * follows the same policy on Android (see "Cancellation" below) and,
 * like `./file-picker.ts` and `../platform/
 * native-network-reachability.ts`'s `NetInfoModule`, never imports a
 * native package directly — every native call goes through an injected
 * port shaped like that package's real export, so this file is fully
 * provable in plain `vitest` against scripted fakes (see
 * `sharing.test.ts`) with zero `expo-sharing`/`react-native` import.
 *
 * ---------------------------------------------------------------------
 * Text sharing: genuinely installable today, still ported behind a port
 * ---------------------------------------------------------------------
 * Unlike `expo-document-picker`/`expo-image-picker`/`expo-sharing`
 * (none installed — see below), plain-text sharing on Android needs
 * nothing beyond `react-native`'s own `Share.share()`, which *is*
 * already a dependency of this app. This module still declares
 * `NativeShareModule` as an injected port rather than importing
 * `react-native` directly, for the same reason `../platform/
 * lifecycle.ts` and `../platform/haptics/vibration-platform.ts` keep
 * their own `react-native` imports out of every RN-free sibling: this
 * workspace's plain `vitest` cannot transform `react-native`'s entry
 * point (see this repo's `CLAUDE.md`'s "VITEST LIMITATION" note), and
 * keeping the binding itself thin and swappable is the established
 * pattern here, not new to this task. `NativeShareModule.share` mirrors
 * RN's real `Share.share(content, options)` signature and resolves
 * shape exactly, so `Share.share` (imported at the construction site,
 * outside this task's grant — see this task's report) satisfies this
 * port with no wrapper.
 *
 * ---------------------------------------------------------------------
 * File sharing: genuinely blocked on two uninstalled packages
 * ---------------------------------------------------------------------
 * `ShareableFile` carries raw `data: Uint8Array` — Android's native
 * share sheet (and `expo-sharing`'s `shareAsync`) takes a file URI, not
 * bytes, so those bytes must be written to a local file before sharing
 * can happen at all. Two ports cover that: `ShareableFileWriter`
 * (writes one `ShareableFile`'s bytes to a cache path and returns its
 * URI — the real implementation is `expo-file-system`'s
 * `writeAsStringAsync(uri, base64Data, { encoding: EncodingType.Base64
 * })` against a path under `FileSystem.cacheDirectory`, not installed)
 * and `NativeFileShareModule` (mirrors `expo-sharing`'s
 * `isAvailableAsync`/`shareAsync`, not installed either).
 *
 * `expo-sharing`'s real `shareAsync(url, options)` accepts exactly one
 * URL — there is no `ACTION_SEND_MULTIPLE` equivalent in that API. This
 * module honors that real limitation rather than inventing a batched
 * one: `shareFiles` writes and shares each file in `files` in sequence,
 * which is a real (if unglamorous — one native sheet per file) behaviour
 * rather than a fabricated single "share these N files together"
 * capability the underlying library does not have. Every caller in this
 * codebase today (`../features/files/files-screen.tsx`'s `DownloadPanel`)
 * only ever passes one file, so this sequencing has no visible effect
 * yet.
 *
 * ---------------------------------------------------------------------
 * Refusal vocabulary
 * ---------------------------------------------------------------------
 * - **Oversize**: `shareFiles` refuses *before* `writeShareableFile` is
 *   ever called for any file whose `data.byteLength` exceeds
 *   `MAX_DOWNLOAD_BYTES` — imported from `../features/files/
 *   file-browser-client.ts`, not redeclared, per this task's brief
 *   ("match their vocabulary rather than inventing a second one"). That
 *   ceiling is the right one to reuse here (not a new number): every
 *   file this app can hand to `Sharing.shareFiles` today came from
 *   `../features/files/file-download-model.ts`'s download flow, which
 *   is already bounded by the same constant — a file `Sharing` would
 *   refuse is a file the download flow could never have produced in
 *   the first place, so this is defence in depth against a future
 *   caller, not a live gap. Rejects with `SHARING_OVERSIZE_FILE`.
 * - **Unavailable**: `isAvailable()` reflects `expo-sharing`'s own
 *   `isAvailableAsync()` (true `Sharing.isAvailable()` reports whether
 *   a target app for file-sharing exists on-device, which text sharing
 *   never lacks on Android — RN's `Share.share()` always has the OS
 *   intent chooser to fall back to). `shareFiles` re-checks the same
 *   flag right before sharing and rejects with `SHARING_FILES_
 *   UNAVAILABLE` if it has gone false, rather than calling `shareAsync`
 *   against a target that was already known to not exist.
 * - **Cancellation**: deliberately *not* a distinct rejection here,
 *   mirroring web's own `Sharing` above. `react-native`'s `Share.share`
 *   resolves — it does not reject — when the user dismisses the native
 *   share sheet (`{ action: "dismissedAction" }`, reliable on iOS;
 *   Android's intent chooser does not reliably report dismissal at
 *   all, per RN's own documented caveat), so `shareText`/`shareFiles`
 *   simply resolve `void` in that case exactly as they do on an actual
 *   share — there is no real signal here to turn into a named refusal
 *   without fabricating one the platform does not provide. `./
 *   file-picker.ts` is where a real, always-reported cancellation
 *   signal exists (`DocumentPickerResult`/`ImagePickerResult`'s
 *   `{ canceled: true }`) and is asserted.
 * - **Permission denied**: not applicable to either Android sharing
 *   path. `ACTION_SEND`/`ACTION_CHOOSER` need no runtime permission,
 *   and writing to this app's own cache directory needs none either.
 *
 * ---------------------------------------------------------------------
 * What is not yet installed, named exactly
 * ---------------------------------------------------------------------
 * Nothing in this file constructs `createAndroidSharing` in production.
 * Once installed (versions pinned by *this app's own*
 * `apps/android/node_modules/expo/bundledNativeModules.json`, matching
 * `apps/android/package.json`'s `"expo": "^54.0.18"`):
 *
 *     npm install --workspace=@picompanion/android expo-sharing@~14.0.8
 *     npm install --workspace=@picompanion/android expo-file-system@~19.0.24
 *
 * `expo-sharing`'s default export already structurally satisfies
 * `NativeFileShareModule` as declared below. `react-native`'s
 * `Share.share` already structurally satisfies `NativeShareModule` and
 * needs no new install at all. `ShareableFileWriter` has no single
 * matching native export — the real implementation base64-encodes
 * `ShareableFile.data` and calls `expo-file-system`'s
 * `writeAsStringAsync` against a path under `FileSystem.
 * cacheDirectory + file.name`.
 */

/** Sentinel `Error.message` `shareFiles()` rejects with when any file's `data.byteLength` exceeds `MAX_DOWNLOAD_BYTES`, before any write or share call is made. */
export const SHARING_OVERSIZE_FILE = "SHARING_OVERSIZE_FILE";

/** Sentinel `shareFiles()` rejects with when `nativeFileShare.isAvailableAsync()` reports `false` — no target app exists to share a file with on this device. */
export const SHARING_FILES_UNAVAILABLE = "SHARING_FILES_UNAVAILABLE";

/** Mirrors `react-native`'s `ShareContent`/`ShareOptions` (the subset this module sends) and its `Share.share()` resolved shape. */
export interface NativeShareContent {
  message?: string;
  title?: string;
}

export interface NativeShareOptions {
  dialogTitle?: string;
}

export interface NativeShareResult {
  action: string;
  activityType?: string | null;
}

/** Shaped exactly like `react-native`'s `Share.share`. */
export interface NativeShareModule {
  share(content: NativeShareContent, options?: NativeShareOptions): Promise<NativeShareResult>;
}

export interface NativeFileShareOptions {
  mimeType?: string;
  dialogTitle?: string;
}

/** Shaped exactly like `expo-sharing`'s default export. */
export interface NativeFileShareModule {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(url: string, options?: NativeFileShareOptions): Promise<void>;
}

/** Writes one `ShareableFile`'s bytes to a local path and resolves with a URI `NativeFileShareModule.shareAsync` can open. See this module's doc comment for the real `expo-file-system`-backed implementation. */
export type ShareableFileWriter = (file: ShareableFile) => Promise<string>;

export interface AndroidSharingDeps {
  nativeShare: NativeShareModule;
  nativeFileShare: NativeFileShareModule;
  writeShareableFile: ShareableFileWriter;
}

/**
 * The real `Sharing` this task builds — see the module doc comment for
 * the full refusal rules. Not constructed anywhere in this app yet; see
 * this task's report for the exact `AppCore` seam T32S11 still needs to
 * wire, once the packages named above are installed.
 */
export function createAndroidSharing(deps: AndroidSharingDeps): Sharing {
  return {
    async isAvailable(): Promise<boolean> {
      return deps.nativeFileShare.isAvailableAsync();
    },

    async shareText(text: string, options?: ShareTextOptions): Promise<void> {
      await deps.nativeShare.share({ message: text, title: options?.title });
    },

    async shareFiles(files: ShareableFile[], options?: ShareFilesOptions): Promise<void> {
      if (files.length === 0) return;

      for (const file of files) {
        if (file.data.byteLength > MAX_DOWNLOAD_BYTES) {
          throw new Error(SHARING_OVERSIZE_FILE);
        }
      }

      const available = await deps.nativeFileShare.isAvailableAsync();
      if (!available) {
        throw new Error(SHARING_FILES_UNAVAILABLE);
      }

      for (const file of files) {
        const uri = await deps.writeShareableFile(file);
        await deps.nativeFileShare.shareAsync(uri, {
          mimeType: file.mimeType,
          dialogTitle: options?.title,
        });
      }
    },
  };
}

/**
 * A `Sharing` whose file-sharing half is honestly inert — both
 * uninstalled-package deps (`nativeFileShare`, `writeShareableFile`)
 * always report/reject unavailable — while `shareText` still goes
 * through a real, injected `nativeShare`. Deliberately *not* a single
 * blanket "everything unavailable" stub like `./file-picker.ts`'s
 * `createUnavailableFilePicker`: unlike every one of that module's
 * paths, this interface's text-sharing half needs no uninstalled
 * package at all — `react-native`'s own `Share.share` already
 * satisfies `NativeShareModule` today (see this module's doc comment).
 * A stub that also refused `shareText` would misrepresent that as
 * blocked when it is not. `../features/files/files-screen.tsx` already
 * treats a missing `sharing` prop as "no download affordance" (`canSave
 * ={Boolean(sharing)}`) — this export exists for a caller (T32S11) that
 * wants a present, real-for-text `Sharing` before the file-sharing
 * installs land, instead of `undefined` or a fully-fake object.
 */
export function createFileSharingUnavailableSharing(nativeShare: NativeShareModule): Sharing {
  return {
    async isAvailable(): Promise<boolean> {
      return false;
    },
    async shareText(text: string, options?: ShareTextOptions): Promise<void> {
      await nativeShare.share({ message: text, title: options?.title });
    },
    async shareFiles(): Promise<void> {
      throw new Error(SHARING_FILES_UNAVAILABLE);
    },
  };
}
