import { Banner, Button, Progress } from "../../ui/primitives/index.js";
import type { FileDownloadController } from "./use-file-download.js";
import "./files.css";

export interface FileDownloadActionProps {
  controller: FileDownloadController;
  /** The daemon-side workspace root (protocol `cwd`) `path` is relative to. */
  cwd: string;
  path: string;
  fileName: string;
}

/**
 * A single file's download affordance (T30B4, plan.md §12.4). Shared by
 * `FileBrowserEntryList` (one per row, so a binary/oversized file that
 * can never be previewed can still be fetched) and `FileEditorPanel`
 * (for the file currently open). All instances share one
 * `FileDownloadController` (`FileBrowserView` builds it once), so only
 * one download is ever in flight; every button before the active one
 * finishes stays a plain "Download" button, and only the row matching
 * `controller.state.path` shows live progress or a retryable error —
 * the selection (which file is being downloaded) is never lost on
 * failure.
 *
 * T41A3: Cancel is reachable for the whole time `busy` is true and lands
 * on a distinct "cancelled" status — never the "error" banner, which
 * would read as a failure the user didn't cause. Because a partial
 * download's bytes are only ever combined into a saveable blob after the
 * whole stream finishes (`use-file-download.ts`), cancelling — at any
 * point — genuinely leaves no partial file on the user's disk.
 */
export function FileDownloadAction({ controller, cwd, path, fileName }: FileDownloadActionProps) {
  const { state } = controller;
  const isActive = state.path === path;
  const busy = isActive && (state.status === "requesting-token" || state.status === "downloading");

  return (
    <div className="pc-file-download">
      <Button
        kind="secondary"
        onClick={() => controller.download(cwd, path, fileName)}
        disabled={busy}
        data-testid={`file-download-button-${path}`}
      >
        {busy ? "Downloading…" : "Download"}
      </Button>
      {isActive && state.status === "requesting-token" ? (
        <div className="pc-file-download__progress-row">
          <Progress
            label={`Requesting ${fileName}`}
            value={null}
            testId={`file-download-progress-${path}`}
          />
          <Button kind="secondary" onClick={controller.cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {isActive && state.status === "downloading" ? (
        <div className="pc-file-download__progress-row">
          <Progress
            label={`Downloading ${fileName}`}
            value={state.progress}
            testId={`file-download-progress-${path}`}
          />
          <Button kind="secondary" onClick={controller.cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {isActive && state.status === "cancelled" ? (
        <Banner
          tone="info"
          message={`${fileName} download cancelled.`}
          testId={`file-download-cancelled-${path}`}
        />
      ) : null}
      {isActive && state.status === "success" ? (
        <Banner
          tone="success"
          message={`${fileName} downloaded`}
          testId={`file-download-success-${path}`}
        />
      ) : null}
      {isActive && state.status === "error" && state.error ? (
        <div className="pc-file-download__error">
          <Banner
            tone="danger"
            message={state.error.description}
            testId={`file-download-error-${path}`}
          />
          <Button kind="secondary" onClick={controller.retry}>
            Retry download
          </Button>
        </div>
      ) : null}
    </div>
  );
}
