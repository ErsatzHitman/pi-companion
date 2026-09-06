/**
 * File picking interface (plan.md §7.3).
 *
 * Deliberately platform-neutral: no DOM `File`/`Blob`, no Expo
 * `DocumentPicker` types. Content is read lazily so large files are not
 * forced into memory before the caller decides to use them.
 */
export interface PickedFile {
  name: string;
  mimeType?: string;
  size?: number;
  readAsBytes(): Promise<Uint8Array>;
}

export interface FilePickOptions {
  /** MIME type filters, e.g. `["image/*", "text/plain"]`. */
  accept?: string[];
  multiple?: boolean;
}

export interface FilePicker {
  pickFiles(options?: FilePickOptions): Promise<PickedFile[]>;
}
