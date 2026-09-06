import type { FilePicker, PickedFile } from "@picompanion/frontend-core";

function toPickedFile(file: File): PickedFile {
  return {
    name: file.name,
    mimeType: file.type || undefined,
    size: file.size,
    async readAsBytes() {
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}

/** `FilePicker` backed by a hidden `<input type="file">` element (plan.md §7.3). */
export function createBrowserFilePicker(): FilePicker {
  return {
    pickFiles(options) {
      return new Promise<PickedFile[]>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = options?.multiple ?? false;
        if (options?.accept?.length) {
          input.accept = options.accept.join(",");
        }
        input.style.display = "none";

        const cleanup = () => {
          input.removeEventListener("change", onChange);
          input.remove();
        };
        const onChange = () => {
          const files = Array.from(input.files ?? []).map(toPickedFile);
          cleanup();
          resolve(files);
        };
        input.addEventListener("change", onChange);
        // A `cancel` listener would let us resolve immediately, but browser
        // support is inconsistent; the promise simply never resolves if the
        // user dismisses the dialog without choosing a file.
        document.body.append(input);
        input.click();
      });
    },
  };
}
