import { Banner, Dialog, Select, TextField } from "../../ui/primitives/index.js";
import { explainSessionsCreateError } from "./sessions-client.js";
import type { CreateSessionController } from "./use-create-session.js";

export interface CreateSessionDialogProps {
  controller: CreateSessionController;
}

/**
 * The "create a session" dialog (T27B2, plan.md §8.3 "left: sessions,
 * host state, search, and session creation"). Composes only existing
 * primitives: `Dialog` for the modal shell, `TextField` for the working
 * directory, `Select` for the provider, and `Banner` for a failed
 * create's error — never a bare colour cue. A failed submit re-opens
 * with every typed field intact (`useCreateSession` never clears the
 * draft on failure).
 */
export function CreateSessionDialog({ controller }: CreateSessionDialogProps) {
  const explanation = controller.errorMessage
    ? explainSessionsCreateError(controller.errorMessage)
    : null;
  const submitting = controller.phase === "submitting";

  return (
    <Dialog
      open={controller.open}
      title="New session"
      description="Start a new Pi session in a working directory on this host."
      confirmLabel={submitting ? "Creating…" : "Create"}
      cancelLabel="Cancel"
      onConfirm={() => void controller.submit()}
      onClose={controller.closeDialog}
      testId="create-session-dialog"
    >
      <Select
        label="Provider"
        options={[{ value: "pi", label: "Pi" }]}
        value={controller.provider}
        onChange={(event) => controller.setProvider(event.target.value)}
        testId="create-session-provider-field"
      />
      <TextField
        label="Working directory"
        value={controller.cwd}
        onChange={(event) => controller.setCwd(event.target.value)}
        placeholder="/home/me/project"
        required
        error={controller.errors.cwd}
        testId="create-session-cwd-field"
        autoComplete="off"
        spellCheck={false}
      />
      {explanation ? (
        <Banner
          tone="danger"
          message={`${explanation.title}: ${explanation.description}`}
          testId="create-session-error-banner"
        />
      ) : null}
    </Dialog>
  );
}
