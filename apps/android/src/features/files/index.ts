/**
 * Files feature barrel (T35A1, extended by T35A2 with the read path).
 * The route (`../../app/h/[serverId]/session/[agentId]/files/
 * [...path].tsx`, off limits to this task) imports
 * `FilesScreen`/`FilesScreenProps` from here, unchanged since T32S1C
 * created this barrel.
 */
export { FilesScreen, type FilesScreenProps } from "./files-screen";

export {
  FILE_BROWSER_NOT_CONNECTED,
  FILE_BROWSER_TIMEOUT,
  FILE_DOWNLOAD_CANCELLED,
  FILE_DOWNLOAD_NOT_CONNECTED,
  FILE_DOWNLOAD_NO_ORIGIN,
  FILE_DOWNLOAD_NO_RELAY_ORIGIN,
  FILE_DOWNLOAD_TOKEN_TIMEOUT,
  FILE_DOWNLOAD_TRANSFER_FAILED,
  FILE_READ_NOT_CONNECTED,
  FILE_READ_TIMEOUT,
  FILE_UPLOAD_CANCELLED,
  FILE_UPLOAD_NOT_CONNECTED,
  FILE_UPLOAD_TIMEOUT,
  FILE_WRITE_NOT_CONNECTED,
  FILE_WRITE_TIMEOUT,
  MAX_DOWNLOAD_BYTES,
  MAX_PREVIEWABLE_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  buildFileDownloadUrl,
  explainFileBrowserError,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
  explainFileReadError,
  explainFileUploadError,
  explainFileUploadResult,
  explainFileWriteError,
  explainFileWriteResult,
  explainOversizedDownload,
  explainOversizedFile,
  explainOversizedUpload,
  explainRefusedFileKind,
  isNotADirectoryError,
  isPathNotFoundError,
} from "./file-browser-client";
export type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
  FileBrowserEntryKind,
  FileBrowserErrorExplanation,
  FileDownloadTokenResult,
  FileReadKind,
  FileReadResult,
  FileUploadAttachment,
  FileUploadInput,
  FileUploadResult,
  FileWriteConflictVersion,
  FileWriteInput,
  FileWriteResult,
} from "./file-browser-client";

export {
  DEFAULT_FILE_UPLOAD_TIMEOUT_MS,
  createFileUploadController,
  uploadFileWithTimeout,
} from "./file-upload-model";
export type {
  FileUploadController,
  FileUploadControllerOptions,
  FileUploadState,
  FileUploadStatus,
} from "./file-upload-model";

export {
  DEFAULT_FILE_DOWNLOAD_TOKEN_TIMEOUT_MS,
  createFileDownloadController,
  requestDownloadTokenWithTimeout,
} from "./file-download-model";
export type {
  DownloadedFile,
  DownloadFetch,
  DownloadFetchResponse,
  DownloadStreamReader,
  FileDownloadController,
  FileDownloadControllerOptions,
  FileDownloadState,
  FileDownloadStatus,
} from "./file-download-model";

export {
  DEFAULT_FILE_EDIT_TIMEOUT_MS,
  FILE_EDIT_LIMITS,
  MAX_EDITABLE_FILE_BYTES,
  MAX_EDITABLE_LINE_LENGTH,
  createFileEditController,
  describeFileEditLimits,
  explainFileEditLimitRefusal,
  longestLineLength,
  utf8ByteLength,
  writeFileWithTimeout,
} from "./file-edit-model";
export type {
  FileEditController,
  FileEditControllerOptions,
  FileEditErrorState,
  FileEditLimitRefusal,
  FileEditLimits,
  FileEditMode,
  FileEditState,
} from "./file-edit-model";

export {
  createFileViewController,
  initialFileViewState,
  refuseFileViewForSize,
} from "./file-view-model";
export type {
  FileViewController,
  FileViewControllerOptions,
  FileViewError,
  FileViewState,
  FileViewStatus,
} from "./file-view-model";

export {
  decodeUtf8Bytes,
  isLezerOnlyLanguageSupported,
  syntaxColorKey,
  tokenizeFileContent,
} from "./file-syntax-highlight";
export type { HighlightStyle, HighlightToken } from "./file-syntax-highlight";

export {
  DEFAULT_FILES_REQUEST_TIMEOUT_MS,
  buildFilesBreadcrumbs,
  createFilesBrowserController,
  createFilesClock,
  listDirectoryWithTimeout,
  normalizeFilesPath,
  parentFilesPath,
  pathSegments,
  sortFilesEntries,
} from "./files-model";
export type {
  FilesBreadcrumb,
  FilesBrowserController,
  FilesBrowserControllerOptions,
  FilesListError,
  FilesListState,
  FilesListStatus,
} from "./files-model";
