import type { Sharing } from "@picompanion/frontend-core";

/**
 * `Sharing` backed by the Web Share API, falling back to a download
 * anchor for files when the API (or file sharing support) is unavailable
 * (plan.md §7.3).
 */
export function createWebShareSharing(): Sharing {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return {
    async isAvailable() {
      return canShare;
    },
    async shareText(text, options) {
      if (canShare) {
        await navigator.share({ text, title: options?.title });
        return;
      }
      throw new Error("Sharing is not available in this browser context");
    },
    async shareFiles(files, options) {
      const shareableFiles = files.map(
        (file) => new File([file.data as BlobPart], file.name, { type: file.mimeType }),
      );
      if (
        canShare &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: shareableFiles })
      ) {
        await navigator.share({ files: shareableFiles, title: options?.title });
        return;
      }
      for (const file of shareableFiles) {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.style.display = "none";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    },
  };
}
