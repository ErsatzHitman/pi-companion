import { useState } from "react";

import { Banner, Button, Dialog, TextField, Toggle } from "../../ui/primitives/index.js";
import type { FileOpsController } from "./use-file-ops.js";
import "./files.css";

export interface FileOpsPanelProps {
  controller: FileOpsController;
}

/**
 * The files feature's mutation affordances (plan.md §12.4): create a
 * folder, create a file, rename/move, and delete. Composed entirely from
 * `ui/primitives` (no one-off styled control), with the same
 * field/button/banner language as `FileUploadPanel`/`FileSearchPanel`.
 *
 * Every path field is a workspace-relative path (the panel never touches
 * a laptop path directly — the daemon is the only thing that does).
 * Delete is deliberately two-step: the danger button opens the shared
 * `Dialog` in its `dangerous` (`role="alertdialog"`) form, and only the
 * dialog's own confirm calls `controller.deleteEntry`, so a stray click
 * can never remove a file.
 *
 * The panel does not clear the path fields after a successful operation
 * until the user resets or edits them: `useFileOps`'s success/error
 * banners are the feedback, and keeping the typed value lets a failed
 * rename be retried without retyping.
 */
export function FileOpsPanel({ controller }: FileOpsPanelProps) {
  const { state } = controller;
  const running = state.status === "running";

  const [mkdirPath, setMkdirPath] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [deletePath, setDeletePath] = useState("");
  const [deleteRecursive, setDeleteRecursive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submitDelete(): void {
    setConfirmingDelete(false);
    controller.deleteEntry(deletePath, deleteRecursive);
  }

  return (
    <div className="pc-file-ops" data-testid="file-ops-panel">
      <div className="pc-file-ops__group">
        <TextField
          label="New folder path"
          placeholder="src/components"
          value={mkdirPath}
          onChange={(event) => setMkdirPath(event.target.value)}
          testId="file-ops-mkdir-path"
        />
        <Button
          kind="secondary"
          disabled={running}
          onClick={() => controller.mkdir(mkdirPath)}
          data-testid="file-ops-mkdir-submit"
        >
          Create folder
        </Button>
      </div>

      <div className="pc-file-ops__group">
        <TextField
          label="New file path"
          placeholder="src/notes.md"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
          testId="file-ops-create-file-path"
        />
        <TextField
          label="Initial content (optional)"
          value={fileContent}
          onChange={(event) => setFileContent(event.target.value)}
          testId="file-ops-create-file-content"
        />
        <Button
          kind="secondary"
          disabled={running}
          onClick={() => controller.createFile(filePath, fileContent)}
          data-testid="file-ops-create-file-submit"
        >
          Create file
        </Button>
      </div>

      <div className="pc-file-ops__group">
        <TextField
          label="Rename from"
          placeholder="src/old.ts"
          value={renameFrom}
          onChange={(event) => setRenameFrom(event.target.value)}
          testId="file-ops-rename-from"
        />
        <TextField
          label="Rename to"
          placeholder="src/new.ts"
          value={renameTo}
          onChange={(event) => setRenameTo(event.target.value)}
          testId="file-ops-rename-to"
        />
        <Button
          kind="secondary"
          disabled={running}
          onClick={() => controller.rename(renameFrom, renameTo)}
          data-testid="file-ops-rename-submit"
        >
          Rename
        </Button>
      </div>

      <div className="pc-file-ops__group">
        <TextField
          label="Delete path"
          placeholder="src/notes.md"
          value={deletePath}
          onChange={(event) => setDeletePath(event.target.value)}
          testId="file-ops-delete-path"
        />
        <Toggle
          label="Delete folders and their contents"
          checked={deleteRecursive}
          onCheckedChange={setDeleteRecursive}
          disabled={running}
          testId="file-ops-delete-recursive"
        />
        <Button
          kind="danger"
          disabled={running}
          onClick={() => setConfirmingDelete(true)}
          data-testid="file-ops-delete-submit"
        >
          Delete
        </Button>
      </div>

      <p className="pc-file-ops__hint">
        Paths are relative to this session&rsquo;s workspace folder.
      </p>

      {state.status === "success" && state.message ? (
        <Banner
          tone="success"
          message={state.message}
          actionLabel="Dismiss"
          onAction={controller.reset}
          testId="file-ops-success"
        />
      ) : null}
      {state.status === "error" && state.error ? (
        <Banner tone="danger" message={state.error.description} testId="file-ops-error" />
      ) : null}

      <Dialog
        open={confirmingDelete}
        title="Delete this entry?"
        description={`This removes ${deletePath || "the selected path"} from the workspace. It cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        onConfirm={submitDelete}
        onClose={() => setConfirmingDelete(false)}
        testId="file-ops-delete-dialog"
      />
    </div>
  );
}
