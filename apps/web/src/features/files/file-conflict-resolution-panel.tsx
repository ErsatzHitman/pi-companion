import { Banner, Button, ErrorState, LoadingState } from "../../ui/primitives/index.js";
import { FileDiffView } from "./file-diff-view.js";
import type { FileReadClient } from "./file-read-client.js";
import type { FileWriteConflictVersion } from "./file-write-client.js";
import { useFileConflictResolution } from "./use-file-conflict-resolution.js";
import "./files.css";

export interface FileConflictResolutionPanelProps {
  readClient: FileReadClient;
  /** The daemon-side workspace root (protocol `cwd`) this file belongs to. */
  workspaceRoot: string;
  /** The file's path, relative to `workspaceRoot`. */
  path: string;
  /** The conflict payload from the failed save (`FileEditorErrorState.conflictVersion`). */
  version: FileWriteConflictVersion;
  /** The user's in-progress buffer ("mine"), compared against the daemon's current content ("theirs"). */
  localText: string;
  /** True while a save is in flight (e.g. "Keep mine" resubmitted) — disables every action here. */
  saving: boolean;
  /**
   * Overwrites the daemon's current content with `localText`, rebased
   * onto the just-fetched version so the write is checked against it
   * instead of the stale basis that produced this conflict. Only
   * offered once the other version has actually loaded.
   */
  onKeepMine: (basis: { modifiedAt: string; revision?: string }) => void;
  /**
   * Discards `localText` and reloads the daemon's current content.
   * Never writes anything.
   */
  onTakeTheirs: () => void;
  /**
   * Keeps `localText` for further hand editing, rebased onto the
   * just-fetched version, so a later manual `save()` is checked against
   * it. Only offered once the other version has actually loaded.
   */
  onMergeByHand: (basis: { modifiedAt: string; revision?: string }) => void;
  /** Discards `localText` without writing anything. */
  onCancel: () => void;
}

/**
 * The conflict-resolution flow (T41A2, plan.md §12.4): shown by
 * `FileEditorPanel` in place of the ordinary editor once a save comes
 * back `"conflict"` (`use-file-editor.ts`'s `state.error.isConflict`).
 *
 * Fetches the daemon's current content (`useFileConflictResolution`,
 * since the conflict payload itself carries no bytes) and renders it
 * against `localText` with the same `FileDiffView` the editor's "Show
 * changes" toggle uses — including that component's existing bounded
 * chunking and truncation banner (`file-diff.ts`'s `MAX_DIFF_INPUT_LINES`/
 * `MAX_DIFF_OUTPUT_LINES`), so a very large conflicting file degrades the
 * same honest way an ordinary large diff does rather than presenting a
 * silently-truncated comparison as complete.
 *
 * Three resolution actions, once the fetch resolves: overwrite with the
 * local buffer ("Keep mine"), discard the local buffer for the daemon's
 * content ("Use their version"), or keep editing the local buffer with
 * the basis moved forward so a later manual save succeeds ("Merge by
 * hand"). "Cancel" is always available and always a pure discard — it
 * routes to the same `cancelEditing()` the ordinary editor's Cancel
 * button uses, so it never issues a write.
 */
export function FileConflictResolutionPanel({
  readClient,
  workspaceRoot,
  path,
  version,
  localText,
  saving,
  onKeepMine,
  onTakeTheirs,
  onMergeByHand,
  onCancel,
}: FileConflictResolutionPanelProps) {
  const resolution = useFileConflictResolution({ readClient, workspaceRoot, path, version });

  return (
    <div className="pc-file-conflict" data-testid="file-conflict-resolution">
      <Banner
        tone="warning"
        message="Someone else changed this file since you opened it. Choose how to resolve it before saving."
        testId="file-conflict-banner"
      />

      {resolution.status === "loading" ? (
        <LoadingState
          title="Loading the other version…"
          description={`Reading the daemon's current copy of ${path}`}
          testId="file-conflict-loading"
        />
      ) : null}

      {resolution.status === "missing" ? (
        <ErrorState
          title="This file was deleted"
          description="It no longer exists on the daemon, so there is nothing to compare or overwrite. You can discard your edit, or cancel and keep it for later."
          testId="file-conflict-missing"
        />
      ) : null}

      {resolution.status === "unavailable" ? (
        <ErrorState
          title={resolution.error?.title ?? "Couldn't load the other version"}
          description={
            resolution.error?.description ??
            "The daemon returned an unknown error while checking the current file."
          }
          testId="file-conflict-unavailable"
        />
      ) : null}

      {resolution.status === "ready" && resolution.remoteFile ? (
        <FileDiffView
          path={path}
          oldText={resolution.remoteText ?? ""}
          newText={localText}
          testId="file-conflict-diff"
        />
      ) : null}

      <div className="pc-file-editor__actions">
        {resolution.status === "ready" && resolution.remoteFile ? (
          <>
            <Button
              kind="primary"
              disabled={saving}
              onClick={() =>
                onKeepMine({
                  modifiedAt: resolution.remoteFile!.modifiedAt,
                  revision: resolution.remoteFile!.revision,
                })
              }
            >
              Keep mine
            </Button>
            <Button kind="secondary" disabled={saving} onClick={onTakeTheirs}>
              Use their version
            </Button>
            <Button
              kind="secondary"
              disabled={saving}
              onClick={() =>
                onMergeByHand({
                  modifiedAt: resolution.remoteFile!.modifiedAt,
                  revision: resolution.remoteFile!.revision,
                })
              }
            >
              Merge by hand
            </Button>
          </>
        ) : null}
        {resolution.status === "missing" || resolution.status === "unavailable" ? (
          <Button kind="secondary" disabled={saving} onClick={onTakeTheirs}>
            Discard my edit
          </Button>
        ) : null}
        <Button kind="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
