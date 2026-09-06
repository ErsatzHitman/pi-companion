import type { Clipboard } from "@picompanion/frontend-core";

/** `Clipboard` backed by the async Clipboard API (plan.md §7.3). */
export function createBrowserClipboard(): Clipboard {
  return {
    async readText() {
      if (!navigator.clipboard?.readText) return null;
      try {
        return await navigator.clipboard.readText();
      } catch {
        // Permission denied or no clipboard access in this context.
        return null;
      }
    },
    async writeText(text) {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard write is not available in this browser context");
      }
      await navigator.clipboard.writeText(text);
    },
  };
}
