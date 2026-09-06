import { useState } from "react";

import { Banner, Button, ErrorState, Toggle } from "../../ui/primitives/index.js";
import { FileCodeEditor } from "./file-code-editor.js";
import { FileConflictResolutionPanel } from "./file-conflict-resolution-panel.js";
import { FileContentView } from "./file-content-view.js";
import { FileDiffView } from "./file-diff-view.js";
import { FileDownloadAction } from "./file-download-action.js";
import { formatFileSize, formatModifiedAt } from "./format.js";
import {
  explainRefusedFileKind,
  type FileReadClient,
  type FileReadResult,
} from "./file-read-client.js";
import type { FileWriteClient } from "./file-write-client.js";
import type { FileDownloadController } from "./use-file-download.js";
import { decodeFileText, useFileEditor } from "./use-file-editor.js";
import "./files.css";

export interface FileEditorPanelProps {
  file: FileReadResult;
  /** The daemon-side workspace root (protocol `cwd`) this file belongs to. */
  workspaceRoot: string;
  writeClient: FileWriteClient;
  /**
   * Used only by the conflict-resolution flow (T41A2), to re-read the
   * daemon's current content once a save comes back `"conflict"` — the
   * conflict payload itself carries no bytes (see
   * `use-file-conflict-resolution.ts`).
   */
  readClient: FileReadClient;
  downloadController: FileDownloadController;
  /** Reloads `file` from the daemon after a save is confirmed written (`useFileExplorer`'s `retry`). */
  onSaved: () => void;
}

/**
 * The `/h/:serverId/session/:agentId/files/*` screen's file body once a
 * path resolves to a file (T30B3, plan.md §12.4). Read mode reuses
 * T30B2's `FileContentView` unchanged and adds an "Edit" affordance;
 * edit mode swaps in the lazily-loaded `FileCodeEditor` with Save/Cancel
 * controls. A refused file (`explainRefusedFileKind` — binary, image, or
 * oversized) never offers Edit, since the daemon's write path refuses
 * those for the same reasons the read path does.
 *
 * While editing, a "Show changes" `Toggle` (T30B6, plan.md §12.4) swaps
 * `FileCodeEditor` for the lazily-loaded `FileDiffView`, comparing the
 * file's last-saved bytes (`decodeFileText(file.bytes)`) against the
 * live edit buffer — one approved treatment (plan.md §10.1), not a
 * simultaneous split view. The toggle resets to off whenever a fresh
 * edit session starts (Edit) or is discarded (Cancel), so the diff
 * never survives to describe a different buffer than the one it was
 * shown for.
 *
 * A save that comes back `"conflict"` (`state.error.isConflict`, T41A1b)
 * replaces the toggle/editor/Save-Cancel body below with
 * `FileConflictResolutionPanel` (T41A2) instead of just showing the
 * error text: the user picks "Keep mine" (overwrite, rebased onto the
 * fresh version), "Use their version" (discard the local buffer for the
 * daemon's), or "Merge by hand" (keep editing, rebased, and save
 * manually once satisfied) — or Cancel, which never writes anything.
 */
export function FileEditorPanel({
  file,
  workspaceRoot,
  writeClient,
  readClient,
  downloadController,
  onSaved,
}: FileEditorPanelProps) {
  const controller = useFileEditor({ writeClient, workspaceRoot, file, onSaved });
  const { state } = controller;
  const editable = explainRefusedFileKind(file) === null;
  const [showDiff, setShowDiff] = useState(false);

  if (state.mode === "read") {
    return (
      <div className="pc-file-editor" data-testid="file-editor-panel">
        <FileContentView file={file} />
        <div className="pc-file-editor__actions">
          {editable ? (
            <Button
              kind="secondary"
              onClick={() => {
                setShowDiff(false);
                controller.startEditing();
              }}
            >
              Edit
            </Button>
          ) : null}
          <FileDownloadAction
            controller={downloadController}
            cwd={workspaceRoot}
            path={file.path}
            fileName={file.path.split("/").pop() ?? file.path}
          />
        </div>
      </div>
    );
  }

  const saving = state.mode === "saving";
  // T41A2: a conflict swaps the whole body below for the resolution
  // flow. `conflictVersion` is only ever set alongside `isConflict`
  // (`use-file-editor.ts`'s `save()`), but both are checked so a
  // malformed/partial error state falls back to the plain error text
  // instead of rendering a resolution panel with nothing to resolve.
  const conflict =
    state.error?.isConflict && state.error.conflictVersion ? state.error.conflictVersion : null;

  return (
    <div className="pc-file-editor pc-file-editor--editing" data-testid="file-editor-panel">
      <div className="pc-file-content__meta">
        <span className="pc-file-content__path">{file.path}</span>
        <span className="pc-file-content__meta-item">{formatFileSize(file.size)}</span>
        <span className="pc-file-content__meta-item">{formatModifiedAt(file.modifiedAt)}</span>
      </div>
      {conflict ? (
        <FileConflictResolutionPanel
          readClient={readClient}
          workspaceRoot={workspaceRoot}
          path={file.path}
          version={conflict}
          localText={state.buffer}
          saving={saving}
          onKeepMine={(basis) => {
            controller.rebase(basis);
            controller.save();
          }}
          onTakeTheirs={() => {
            setShowDiff(false);
            controller.cancelEditing();
            onSaved();
          }}
          onMergeByHand={(basis) => {
            controller.rebase(basis);
          }}
          onCancel={() => {
            setShowDiff(false);
            controller.cancelEditing();
          }}
        />
      ) : (
        <>
          {state.error ? (
            <ErrorState
              title={state.error.title}
              description={state.error.description}
              testId="file-editor-error"
            />
          ) : state.remoteChanged ? (
            // T41A1b: detection only. `save()` still writes against the
            // version this edit began from, so worst case if the user
            // ignores this the daemon's own conflict check fires and
            // T41A2's resolution flow above takes over.
            <Banner
              tone="warning"
              message="This file changed on the daemon while you were editing. Saving now is still safe — it won't overwrite the newer version — but you may want to review it first."
              testId="file-editor-remote-changed"
            />
          ) : null}
          <Toggle
            label="Show changes"
            checked={showDiff}
            onCheckedChange={setShowDiff}
            testId="file-editor-diff-toggle"
          />
          {showDiff ? (
            <FileDiffView
              path={file.path}
              oldText={decodeFileText(file.bytes)}
              newText={state.buffer}
              testId="file-editor-diff"
            />
          ) : (
            <FileCodeEditor
              path={file.path}
              value={state.buffer}
              onChange={controller.updateBuffer}
              readOnly={saving}
              testId="file-editor-code"
            />
          )}
          <div className="pc-file-editor__actions">
            <Button kind="primary" onClick={controller.save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                setShowDiff(false);
                controller.cancelEditing();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
