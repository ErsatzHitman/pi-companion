/**
 * Sharing interface (plan.md §7.3).
 *
 * Covers the outbound "share this text/file elsewhere" intent used by
 * attachments and export flows. Web adapters use the Web Share API with
 * a download fallback; Android adapters use the native share sheet.
 */
export interface ShareableFile {
  name: string;
  mimeType?: string;
  data: Uint8Array;
}

export interface ShareTextOptions {
  title?: string;
}

export interface ShareFilesOptions {
  title?: string;
}

export interface Sharing {
  isAvailable(): Promise<boolean>;
  shareText(text: string, options?: ShareTextOptions): Promise<void>;
  shareFiles(files: ShareableFile[], options?: ShareFilesOptions): Promise<void>;
}
