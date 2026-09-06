import { Banner, Dialog, TextField } from "../../ui/primitives/index.js";
import { explainSessionsActionError } from "./sessions-client.js";
import type { RenameSessionController } from "./use-rename-session.js";

export interface RenameSessionDialogProps {
  controller: RenameSessionController;
}

/**
 * The rename dialog (T38A4). Composes the existing `Dialog` primitive
 * (matching `CreateSessionDialog`'s precedent: a `TextField` child plus
 * a `Banner` for a failed submit's error, never a bare colour cue) with
 * one `TextField` for the new name. A validation failure (empty, or
 * over `MAX_EXPLICIT_AGENT_TITLE_CHARS`) is surfaced through
 * `TextField`'s own `error` prop and never calls the client at all —
 * `use-rename-session.ts`'s `confirmRename` returns before submitting
 * when `validateSessionName` rejects the draft.
 */
export function RenameSessionDialog({ controller }: RenameSessionDialogProps) {
  const target = controller.renameTarget;
  const title = target?.title ?? "Untitled session";
  const submitting = controller.renamePhase === "renaming";
  const explanation = controller.renameErrorMessage
    ? explainSessionsActionError("rename", controller.renameErrorMessage)
    : null;

  return (
    <Dialog
      open={controller.renameDialogOpen}
      title="Rename this session"
      description={`Choose a new name for "${title}".`}
      confirmLabel={submitting ? "Renaming…" : "Rename"}
      cancelLabel="Cancel"
      onConfirm={controller.confirmRename}
      onClose={controller.cancelRename}
      testId="rename-session-dialog"
    >
      <TextField
        label="Name"
        value={controller.renameDraft}
        onChange={(event) => controller.setRenameDraft(event.target.value)}
        placeholder="Session name"
        required
        error={controller.renameValidationError ?? undefined}
        testId="rename-session-name-field"
        autoComplete="off"
        spellCheck={false}
      />
      {explanation ? (
        <Banner
          tone="danger"
          message={`${explanation.title}: ${explanation.description}`}
          testId="rename-session-error-banner"
        />
      ) : null}
    </Dialog>
  );
}
