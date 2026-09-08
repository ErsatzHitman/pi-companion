import type { PickedFile } from "@picompanion/frontend-core";

/**
 * DOM `File`/`DataTransfer`/`ClipboardEvent` -> `PickedFile` conversion
 * (T279), shared by the drop (`use-drag-and-drop.ts`) and paste
 * (`use-clipboard-paste.ts`) input paths. Deliberately DOM-typed — this
 * module lives under `apps/web/src`, not `packages/frontend-core`, so
 * browser globals are fine here (plan.md §6's platform boundary is about
 * `frontend-core`, not the apps built on top of it).
 *
 * Kept separate from `apps/web/src/platform/file-picker.ts`'s own
 * `toPickedFile`: that one is the platform's `FilePicker` adapter
 * (plan.md §7.3), a different seam this feature depends on through the
 * `FilePicker` interface rather than a source-relative import (plan.md
 * §3.3's "package exports, never source-relative cross-workspace
 * paths" is about crossing *workspace* boundaries; this file and that
 * one are both inside `apps/web`, but the platform adapter is still not
 * this feature's file to import from directly — `use-attachments.ts`
 * only ever receives a `FilePicker` value, never reaches into how one is
 * built).
 */

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function extensionForImageMimeType(mimeType: string): string {
  return IMAGE_EXTENSIONS[mimeType] ?? "png";
}

/**
 * Names a nameless pasted image (T279's "a screenshot arrives as a
 * `File` with no name — synthesize one, and say what you synthesize").
 *
 * **What is synthesized:** `pasted-image-<now>.<ext>`, where `<now>` is
 * the composer's own injected `Clock.now()` value (never `Date.now()`
 * directly) — the same source every other id/name in this feature
 * already derives from (`use-composer.ts`'s `defaultGenerateClientMessageId`,
 * this directory's own `defaultGenerateAttachmentId`) — and `<ext>` is
 * guessed from the pasted file's MIME type (`image/png` -> `png`,
 * falling back to `png` for an unrecognized `image/*` type, since a
 * literal, unfamiliar MIME subtype makes for a worse filename than a
 * plausible guess).
 */
export function synthesizePastedImageName(mimeType: string, now: number): string {
  return `pasted-image-${now}.${extensionForImageMimeType(mimeType)}`;
}

/**
 * Reads a DOM `File`/`Blob` via `FileReader` rather than `Blob.arrayBuffer()`
 * — both are standard and universally supported in real browsers, but this
 * repository's pinned jsdom (20.0.3, confirmed directly rather than assumed)
 * implements `FileReader` and not `Blob.prototype.arrayBuffer`/`.text()`, so
 * this is the one of the two that actually works under `apps/web`'s own test
 * environment as well as in production.
 */
function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read "${file.name}"`));
    reader.readAsArrayBuffer(file);
  });
}

/** Converts one DOM `File` into a `PickedFile` (plan.md §7.3's platform-neutral shape). */
export function toPickedFile(file: File, nameOverride?: string): PickedFile {
  return {
    name: nameOverride ?? file.name,
    mimeType: file.type || undefined,
    size: file.size,
    readAsBytes: () => readFileAsBytes(file),
  };
}

/**
 * `PickedFile`s dropped via `DataTransfer.files` (T279). A drop always
 * carries the file's real name from disk, so no name synthesis applies
 * here — only pasted files (below) can arrive nameless.
 */
export function filesFromDataTransfer(dataTransfer: DataTransfer | null): PickedFile[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files).map((file) => toPickedFile(file));
}

/**
 * `PickedFile`s pasted via `ClipboardEvent.clipboardData.items` (T279).
 * Only items whose `kind` is `"file"` become a `PickedFile` — a plain
 * text paste (a link, a sentence) has no `"file"` item at all and is
 * never touched by this function's caller
 * (`use-clipboard-paste.ts`'s own doc comment states and argues that
 * rule in full).
 *
 * Every file whose own `name` is empty gets a synthesized one via
 * `synthesizePastedImageName` above, each stamped with a distinct `now`
 * offset so two nameless files pasted in the same event do not collide.
 */
export function filesFromClipboardItems(
  items: DataTransferItemList | null | undefined,
  now: number,
): PickedFile[] {
  if (!items) return [];
  const files: PickedFile[] = [];
  let syntheticNameOffset = 0;
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (file.name) {
      files.push(toPickedFile(file));
      continue;
    }
    const name = synthesizePastedImageName(file.type || "image/png", now + syntheticNameOffset);
    syntheticNameOffset += 1;
    files.push(toPickedFile(file, name));
  }
  return files;
}
