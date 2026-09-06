import { Dialog } from "../../ui/primitives/index.js";
import type { SessionActionsController } from "./use-session-actions.js";

export interface DeleteSessionDialogProps {
  controller: SessionActionsController;
}

/**
 * The delete-confirmation dialog (T27B4 acceptance: "Delete requires
 * explicit confirmation"). Composes the existing `Dialog` primitive in
 * its `dangerous` mode (`role="alertdialog"`, danger-styled confirm
 * button — plan.md §10.3/§10.5), naming the session being deleted so a
 * user with several sessions open can't confuse which one they are
 * about to lose.
 */
export function DeleteSessionDialog({ controller }: DeleteSessionDialogProps) {
  const target = controller.deleteTarget;
  const title = target?.title ?? "Untitled session";

  return (
    <Dialog
      open={controller.deleteDialogOpen}
      title="Delete this session?"
      description={`"${title}" will be permanently deleted. This can't be undone.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      dangerous
      onConfirm={controller.confirmDelete}
      onClose={controller.cancelDelete}
      testId="delete-session-dialog"
    />
  );
}
