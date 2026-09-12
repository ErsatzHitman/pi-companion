/**
 * Files feature barrel (T30B1, T30B2). Route screens and tests import
 * from here rather than reaching into individual modules.
 */
export {
  FILE_BROWSER_NOT_CONNECTED,
  explainFileBrowserError,
  isNotADirectoryError,
} from "./file-browser-client.js";
export type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
  FileBrowserEntryKind,
  FileBrowserErrorExplanation,
} from "./file-browser-client.js";

export { createPendingConnectionFileBrowserClient } from "./pending-connection-file-browser-client.js";

export {
  FILE_READ_NOT_CONNECTED,
  MAX_PREVIEWABLE_FILE_BYTES,
  explainFileReadError,
  explainRefusedFileKind,
} from "./file-read-client.js";
export type {
  FileReadClient,
  FileReadErrorExplanation,
  FileReadKind,
  FileReadResult,
} from "./file-read-client.js";

export { createPendingConnectionFileReadClient } from "./pending-connection-file-read-client.js";

export {
  syntaxClassName,
  syntaxCssVar,
  syntaxHighlightStyleColors,
  tokenizeFileContent,
} from "./file-syntax-highlight.js";
export type { HighlightToken } from "./file-syntax-highlight.js";

export {
  FILE_WRITE_NOT_CONNECTED,
  explainFileWriteError,
  explainFileWriteResult,
} from "./file-write-client.js";
export type {
  FileWriteClient,
  FileWriteConflictVersion,
  FileWriteErrorExplanation,
  FileWriteInput,
  FileWriteResult,
} from "./file-write-client.js";

export { createPendingConnectionFileWriteClient } from "./pending-connection-file-write-client.js";

export { explainFileOpsError, FILE_OPS_NOT_CONNECTED } from "./file-ops-client.js";
export type { FileOpsClient, FileOpsErrorExplanation } from "./file-ops-client.js";
export { createPendingConnectionFileOpsClient } from "./pending-connection-file-ops-client.js";
export { FileOpsPanel } from "./file-ops-panel.js";
export type { FileOpsPanelProps } from "./file-ops-panel.js";
export { useFileOps } from "./use-file-ops.js";
export type {
  FileOpsController,
  FileOpsOperation,
  FileOpsState,
  FileOpsStatus,
  UseFileOpsOptions,
} from "./use-file-ops.js";

export {
  FILE_UPLOAD_NOT_CONNECTED,
  explainFileUploadError,
  explainFileUploadResult,
  explainUploadCancelNotConfirmed,
} from "./file-upload-client.js";
export type {
  FileUploadAttachment,
  FileUploadCancelResult,
  FileUploadClient,
  FileUploadErrorExplanation,
  FileUploadInput,
  FileUploadResult,
} from "./file-upload-client.js";

export { createPendingConnectionFileUploadClient } from "./pending-connection-file-upload-client.js";

export {
  FILE_DOWNLOAD_NOT_CONNECTED,
  FILE_DOWNLOAD_NO_ORIGIN,
  buildFileDownloadUrl,
  explainFileDownloadError,
  explainFileDownloadTokenResult,
} from "./file-download-client.js";
export type {
  FileDownloadClient,
  FileDownloadErrorExplanation,
  FileDownloadTokenResult,
} from "./file-download-client.js";

export { createPendingConnectionFileDownloadClient } from "./pending-connection-file-download-client.js";

export { formatFileSize, formatModifiedAt } from "./format.js";

export { normalizeFileBrowserPath, useFileBrowser } from "./use-file-browser.js";
export type {
  FileBrowserController,
  FileBrowserError,
  FileBrowserState,
  FileBrowserStatus,
  UseFileBrowserOptions,
} from "./use-file-browser.js";

export { useFileExplorer } from "./use-file-explorer.js";
export type {
  FileExplorerController,
  FileExplorerError,
  FileExplorerState,
  FileExplorerStatus,
  UseFileExplorerOptions,
} from "./use-file-explorer.js";

export { decodeFileText, useFileEditor } from "./use-file-editor.js";
export type {
  FileEditorController,
  FileEditorErrorState,
  FileEditorMode,
  FileEditorState,
  UseFileEditorOptions,
} from "./use-file-editor.js";

export { useFileConflictResolution } from "./use-file-conflict-resolution.js";
export type {
  FileConflictResolutionState,
  FileConflictResolutionStatus,
  UseFileConflictResolutionOptions,
} from "./use-file-conflict-resolution.js";
export { FileConflictResolutionPanel } from "./file-conflict-resolution-panel.js";
export type { FileConflictResolutionPanelProps } from "./file-conflict-resolution-panel.js";

// `computeFileDiff` and its bound constants are deliberately NOT
// re-exported here (type-only exports below are compiled away, but a
// runtime re-export is not): `file-diff-view.tsx` dynamically imports
// `./file-diff.js` directly so it lands in its own bundle chunk
// (T30B6's "the diff chunk is lazily loaded" acceptance criterion,
// plan.md §14.5). A runtime re-export from this barrel would make the
// module statically reachable from every route that imports this
// barrel, which silences the dynamic import entirely — confirmed by
// Rolldown's `INEFFECTIVE_DYNAMIC_IMPORT` warning during `vite build`
// before this comment was added. `file-diff.test.ts` imports the
// module directly (`./file-diff.js`) for the same reason.
export type { FileDiffChunk, FileDiffLine, FileDiffLineType, FileDiffResult } from "./file-diff.js";
export { FileDiffView } from "./file-diff-view.js";
export type { FileDiffViewProps } from "./file-diff-view.js";

export { FileBrowserBreadcrumbs } from "./file-browser-breadcrumbs.js";
export { FileBrowserEntryList } from "./file-browser-entry-list.js";
export { FileContentView } from "./file-content-view.js";
export type { FileContentViewProps } from "./file-content-view.js";
export { FileCodeEditor } from "./file-code-editor.js";
export type { FileCodeEditorProps } from "./file-code-editor.js";
export { FileEditorPanel } from "./file-editor-panel.js";
export type { FileEditorPanelProps } from "./file-editor-panel.js";
export { FileDownloadAction } from "./file-download-action.js";
export type { FileDownloadActionProps } from "./file-download-action.js";
export { FileUploadPanel } from "./file-upload-panel.js";
export type { FileUploadPanelProps } from "./file-upload-panel.js";
export { useFileUpload } from "./use-file-upload.js";
export type {
  FileUploadController,
  FileUploadState,
  FileUploadStatus,
  UseFileUploadOptions,
} from "./use-file-upload.js";
export { useFileDownload } from "./use-file-download.js";
export type {
  FileDownloadController,
  FileDownloadState,
  FileDownloadStatus,
  MinimalFetch,
  MinimalFetchInit,
  MinimalFetchResponse,
  MinimalStreamReader,
  UseFileDownloadOptions,
} from "./use-file-download.js";
export { FileSearchPanel } from "./file-search-panel.js";
export type { FileSearchPanelProps } from "./file-search-panel.js";
export {
  FILE_SEARCH_DEBOUNCE_MS,
  FILE_SEARCH_MAX_DIRECTORIES_VISITED,
  FILE_SEARCH_MAX_RESULTS,
  useFileSearch,
} from "./use-file-search.js";
export type {
  FileSearchController,
  FileSearchError,
  FileSearchState,
  FileSearchStatus,
  UseFileSearchOptions,
} from "./use-file-search.js";
export { FileBrowserView } from "./file-browser-view.js";
export type { FileBrowserViewProps } from "./file-browser-view.js";
export { FileBrowserScreen } from "./file-browser-screen.js";
export type { FileBrowserScreenProps } from "./file-browser-screen.js";

// T41A1a: the single path-authorization door. Exported so any future
// file-access entry point in this feature — or a test proving one
// routes through it — imports the same function every existing entry
// point above already calls, rather than inventing a second check.
export {
  authorizeWorkspacePath,
  PathAuthorizationError,
  PATH_OUTSIDE_WORKSPACE_MESSAGE,
} from "./path-authorization.js";
export type { AuthorizedWorkspacePath } from "./path-authorization.js";
