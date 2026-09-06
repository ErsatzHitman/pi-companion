import { Banner, Button, Progress } from "../../ui/primitives/index.js";
import { formatFileSize } from "./format.js";
import type { FileUploadController } from "./use-file-upload.js";
import "./files.css";

export interface FileUploadPanelProps {
  controller: FileUploadController;
}

/**
 * The files feature's upload affordance (T30B4, plan.md §12.4). Copy is
 * deliberately explicit that this stages a file with the daemon rather
 * than adding it to the folder being browsed — the daemon's upload RPC
 * has no notion of a target workspace path (see `file-upload-client.ts`'s
 * header comment) — so nothing here implies a placement this feature
 * cannot actually perform.
 *
 * Progress is shown for every phase this app controls: reading the
 * picked file's bytes and sending it are both real states (not a static
 * spinner), even though the daemon's upload RPC gives no per-chunk ack to
 * turn the "sending" phase into an exact percentage (again, see
 * `file-upload-client.ts`) — this panel is honest about that by using
 * `Progress`'s indeterminate (`value={null}`) mode for that phase rather
 * than fabricating one.
 *
 * T41A3: Cancel is reachable for the whole time `busy` is true (reading
 * or uploading) and lands on a distinct "cancelled" status — never the
 * "error" banner, which would read as a failure the user didn't cause.
 *
 * T165: cancelling mid-upload no longer claims "cancelled" on the spot.
 * It shows a transient "Cancelling…" progress state while
 * `client.cancelUpload()` is in flight, then follows the daemon's own
 * answer — "cancelled" only once the daemon confirms the discard, or a
 * distinct "cancel-failed" banner (still not the "error" banner, which
 * would misreport a cause) when it cannot confirm one. See
 * `use-file-upload.ts`'s header comment for the full state machine.
 */
export function FileUploadPanel({ controller }: FileUploadPanelProps) {
  const { state } = controller;
  const busy =
    state.status === "reading" || state.status === "uploading" || state.status === "cancelling";

  return (
    <div className="pc-file-upload" data-testid="file-upload-panel">
      <div className="pc-file-upload__row">
        <Button kind="secondary" onClick={controller.selectFile} disabled={busy}>
          Choose a file to upload
        </Button>
        {state.selection ? (
          <span className="pc-file-upload__selection">
            {state.selection.name}
            {typeof state.selection.size === "number"
              ? ` (${formatFileSize(state.selection.size)})`
              : ""}
          </span>
        ) : null}
        {state.selection && !busy ? (
          <Button kind="primary" onClick={controller.upload}>
            Upload to daemon
          </Button>
        ) : null}
      </div>
      <p className="pc-file-upload__hint">
        Uploaded files are staged with the daemon for this session, not added to the folder
        you&rsquo;re browsing.
      </p>
      {state.status === "reading" ? (
        <div className="pc-file-upload__progress-row">
          <Progress label="Reading file" value={null} testId="file-upload-progress" />
          <Button kind="secondary" onClick={controller.cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {state.status === "uploading" ? (
        <div className="pc-file-upload__progress-row">
          <Progress label="Uploading" value={null} testId="file-upload-progress" />
          <Button kind="secondary" onClick={controller.cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {state.status === "cancelling" ? (
        <div className="pc-file-upload__progress-row">
          <Progress label="Cancelling" value={null} testId="file-upload-progress" />
        </div>
      ) : null}
      {state.status === "cancelled" ? (
        <Banner tone="info" message="Upload cancelled." testId="file-upload-cancelled" />
      ) : null}
      {state.status === "cancel-failed" && state.error ? (
        <Banner
          tone="warning"
          message={state.error.description}
          testId="file-upload-cancel-failed"
        />
      ) : null}
      {state.status === "success" && state.result ? (
        <Banner
          tone="success"
          message={`${state.result.fileName} uploaded (${formatFileSize(state.result.size)})`}
          actionLabel="Upload another"
          onAction={controller.reset}
          testId="file-upload-success"
        />
      ) : null}
      {state.status === "error" && state.error ? (
        <div className="pc-file-upload__error">
          <Banner tone="danger" message={state.error.description} testId="file-upload-error" />
          <Button kind="secondary" onClick={controller.retry}>
            Retry upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}
