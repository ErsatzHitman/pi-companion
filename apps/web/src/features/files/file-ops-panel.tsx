import { useState } from "react";

import {
  Banner,
  Button,
  Dialog,
  IconButton,
  TextField,
  Toggle,
} from "../../ui/primitives/index.js";
import { FilePopoverButton } from "./file-popover-button.js";
import type { FileOpsController } from "./use-file-ops.js";
import "./files.css";

export interface FileOpsActionProps {
  controller: FileOpsController;
}

/**
 * Per-action UI for the files feature's four daemon mutations (UI-W7,
 * plan.md §12.4). This used to be one always-open `FileOpsPanel`
 * stacking all four operations above the listing; `useFileOps`'s wiring
 * is unchanged here — same client calls (`controller.mkdir`/
 * `createFile`/`rename`/`deleteEntry`), same `authorizeWorkspacePath`
 * "single door" (inside the hook, untouched), same running/success/error
 * shape — only the presentation is split so each operation is reached
 * from where it is relevant: `FileNewFolderPopover`/`FileNewFilePopover`
 * from the toolbar (`file-toolbar.tsx`), `FileRenameAction`/
 * `FileDeleteAction` per listing row (`file-browser-entry-list.tsx`).
 * All four share the one `FileOpsController` instance `FileBrowserView`
 * builds, same as before; each checks `state.operation` before showing a
 * banner so one action's result never bleeds into another's popover or
 * dialog.
 */
export function FileNewFolderPopover({ controller }: FileOpsActionProps) {
  const { state } = controller;
  const running = state.status === "running" && state.operation === "mkdir";
  const [path, setPath] = useState("");

  return (
    <FilePopoverButton
      icon="folder-plus"
      accessibleName="New folder"
      testId="file-ops-mkdir-trigger"
    >
      {() => (
        <div className="pc-file-ops__group" data-testid="file-ops-mkdir-panel">
          <TextField
            label="New folder path"
            placeholder="src/components"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            testId="file-ops-mkdir-path"
          />
          <Button
            kind="primary"
            disabled={running}
            onClick={() => controller.mkdir(path)}
            data-testid="file-ops-mkdir-submit"
          >
            Create folder
          </Button>
          {state.operation === "mkdir" && state.status === "success" && state.message ? (
            <Banner
              tone="success"
              message={state.message}
              actionLabel="Dismiss"
              onAction={controller.reset}
              testId="file-ops-success"
            />
          ) : null}
          {state.operation === "mkdir" && state.status === "error" && state.error ? (
            <Banner tone="danger" message={state.error.description} testId="file-ops-error" />
          ) : null}
        </div>
      )}
    </FilePopoverButton>
  );
}

export function FileNewFilePopover({ controller }: FileOpsActionProps) {
  const { state } = controller;
  const running = state.status === "running" && state.operation === "create-file";
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");

  return (
    <FilePopoverButton
      icon="file-plus"
      accessibleName="New file"
      testId="file-ops-create-file-trigger"
    >
      {() => (
        <div className="pc-file-ops__group" data-testid="file-ops-create-file-panel">
          <TextField
            label="New file path"
            placeholder="src/notes.md"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            testId="file-ops-create-file-path"
          />
          <TextField
            label="Initial content (optional)"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            testId="file-ops-create-file-content"
          />
          <Button
            kind="primary"
            disabled={running}
            onClick={() => controller.createFile(path, content)}
            data-testid="file-ops-create-file-submit"
          >
            Create file
          </Button>
          {state.operation === "create-file" && state.status === "success" && state.message ? (
            <Banner
              tone="success"
              message={state.message}
              actionLabel="Dismiss"
              onAction={controller.reset}
              testId="file-ops-success"
            />
          ) : null}
          {state.operation === "create-file" && state.status === "error" && state.error ? (
            <Banner tone="danger" message={state.error.description} testId="file-ops-error" />
          ) : null}
        </div>
      )}
    </FilePopoverButton>
  );
}

export interface FileRowOpsActionProps extends FileOpsActionProps {
  /** Workspace-relative path of the row this action belongs to. */
  path: string;
  /** Display name, folded into the action's accessible name. */
  name: string;
}

/** Per-row rename (UI-W7): a popover pre-filled with the row's current path. */
export function FileRenameAction({ controller, path, name }: FileRowOpsActionProps) {
  const { state } = controller;
  const running = state.status === "running" && state.operation === "rename";
  const [nextPath, setNextPath] = useState(path);

  return (
    <FilePopoverButton
      icon="edit"
      accessibleName={`Rename ${name}`}
      testId={`file-ops-rename-trigger-${path}`}
    >
      {() => (
        <div className="pc-file-ops__group" data-testid={`file-ops-rename-panel-${path}`}>
          <TextField
            label="Rename to"
            value={nextPath}
            onChange={(event) => setNextPath(event.target.value)}
            testId={`file-ops-rename-to-${path}`}
          />
          <Button
            kind="primary"
            disabled={running}
            onClick={() => controller.rename(path, nextPath)}
            data-testid={`file-ops-rename-submit-${path}`}
          >
            Rename
          </Button>
          {state.operation === "rename" && state.status === "success" && state.message ? (
            <Banner
              tone="success"
              message={state.message}
              actionLabel="Dismiss"
              onAction={controller.reset}
              testId="file-ops-success"
            />
          ) : null}
          {state.operation === "rename" && state.status === "error" && state.error ? (
            <Banner tone="danger" message={state.error.description} testId="file-ops-error" />
          ) : null}
        </div>
      )}
    </FilePopoverButton>
  );
}

export interface FileDeleteActionProps extends FileRowOpsActionProps {
  kind: "file" | "directory";
}

/**
 * Per-row delete (UI-W7): a trash icon button opens the same shared
 * `Dialog` in its `dangerous` (`role="alertdialog"`) form the old
 * standing panel used, now with the "delete folders and their contents"
 * `Toggle` inside it (only for a directory row — a file delete is never
 * recursive). Only the dialog's own confirm calls
 * `controller.deleteEntry`, so a stray click can never remove anything.
 */
export function FileDeleteAction({ controller, path, name, kind }: FileDeleteActionProps) {
  const { state } = controller;
  const [confirming, setConfirming] = useState(false);
  const [recursive, setRecursive] = useState(false);

  function submit(): void {
    setConfirming(false);
    controller.deleteEntry(path, kind === "directory" ? recursive : false);
  }

  return (
    <>
      <IconButton
        icon="trash"
        accessibleName={`Delete ${name}`}
        onClick={() => setConfirming(true)}
        data-testid={`file-ops-delete-trigger-${path}`}
      />
      <Dialog
        open={confirming}
        title="Delete this entry?"
        description={`This removes ${path} from the workspace. It cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        onConfirm={submit}
        onClose={() => setConfirming(false)}
        testId={`file-ops-delete-dialog-${path}`}
      >
        {kind === "directory" ? (
          <Toggle
            label="Delete folders and their contents"
            checked={recursive}
            onCheckedChange={setRecursive}
            testId="file-ops-delete-recursive"
          />
        ) : null}
      </Dialog>
      {state.operation === "delete" && state.status === "success" && state.message ? (
        <Banner
          tone="success"
          message={state.message}
          actionLabel="Dismiss"
          onAction={controller.reset}
          testId="file-ops-success"
        />
      ) : null}
      {state.operation === "delete" && state.status === "error" && state.error ? (
        <Banner tone="danger" message={state.error.description} testId="file-ops-error" />
      ) : null}
    </>
  );
}
