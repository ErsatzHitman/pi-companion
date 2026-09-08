import type { ClipboardEvent as ReactClipboardEvent } from "react";

import type { PickedFile } from "@picompanion/frontend-core";

import { filesFromClipboardItems } from "./browser-file-inputs.js";

export interface UseClipboardPasteOptions {
  /** Every pasted file, converted to `PickedFile` — pass this straight to `useAttachments.addFiles`. */
  onFiles: (files: readonly PickedFile[]) => void;
  /** Composer-injected "now", for deterministic synthesized names (see `browser-file-inputs.ts`). */
  now: () => number;
}

/**
 * Paste handling for the composer's draft textarea (T279).
 *
 * **The rule, argued.** A paste becomes an attachment only when the
 * clipboard carries real file bytes — a `kind: "file"` entry in
 * `clipboardData.items` — never because the pasted *text* merely looks
 * like a URL. A bare pasted link
 * (`clipboardData.getData("text")` is e.g. `"https://example.com"`,
 * with no file item present at all) is overwhelmingly ordinary prose —
 * the user linking Pi to a page to discuss, not handing over a file — so
 * `handlePaste` below does nothing at all for it: no
 * `preventDefault()`, no attachment, the browser's default paste
 * (inserting that text into the draft) proceeds completely untouched.
 * Treating URL-shaped text as an attachment would require actually
 * *fetching* that URL to have bytes to upload — a feature this task was
 * never asked to build, and one with its own SSRF-shaped risk this
 * repository has no reason to take on for a composer paste handler. This
 * is "the URL that stays text."
 *
 * **The explicit signal that flips it — "the URL that becomes an
 * attachment."** Copying an image *from a web page* (Chrome's own
 * "Copy image" context-menu item is the common case) hands the paste
 * event BOTH a `kind: "file"` item — the actual decoded image bytes —
 * AND a `kind: "string"` `text/plain` (sometimes `text/uri-list`) item
 * carrying that image's source URL. Left alone, the browser's default
 * paste would insert that leftover URL text into the draft right next to
 * the new attachment chip: confusing, and not anything the user typed.
 * So whenever at least one file item is present, `handlePaste` calls
 * `preventDefault()` — suppressing that redundant text for the whole
 * paste event — and every file item is staged as an attachment through
 * `onFiles` (in practice `useAttachments.addFiles`, the same
 * ceiling/upload path every other input source uses). The paste event
 * nominally carries a URL in its text/plain slot; the presence of real
 * file bytes, never the URL text, is what decided the outcome.
 *
 * A screenshot with no file name at all (macOS's screenshot-to-clipboard,
 * most Windows Snipping Tool captures) is exactly the "no text/plain
 * fallback" case: `filesFromClipboardItems` synthesizes a name for it
 * (`browser-file-inputs.ts`'s own doc comment), and `preventDefault()`
 * still applies — there was nothing textual to preserve regardless.
 */
export function useComposerPaste(
  options: UseClipboardPasteOptions,
): (event: ReactClipboardEvent<HTMLElement>) => void {
  const { onFiles, now } = options;
  return function handlePaste(event: ReactClipboardEvent<HTMLElement>): void {
    const files = filesFromClipboardItems(event.clipboardData?.items, now());
    if (files.length === 0) return; // plain text, including a bare URL: never swallowed
    event.preventDefault();
    onFiles(files);
  };
}
