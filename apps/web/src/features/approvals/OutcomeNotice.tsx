import { Button, StatusIndicator } from "../../ui/primitives/index.js";
import "../../ui/primitives/primitives.css";
import { useModalBehavior } from "../../ui/primitives/use-modal-behavior.js";
import "../../ui/recipes/recipes.css";
import "./approvals.css";
import type { OutcomeNoticeViewModel } from "./outcome-notice.js";

export interface OutcomeNoticeDialogProps {
  notice: OutcomeNoticeViewModel;
  onDismiss: () => void;
  testId?: string;
}

/**
 * The "readable explanation rather than vanishing" surface T47A2 requires
 * (plan.md §12.3) for a request another connected client contested or
 * superseded. Takes over the same modal slot `PermissionDialog` occupies
 * (`ApprovalsHost` renders at most one of the two at a time) and reuses
 * the same shared modal chrome and `.pc-approval*` recipe classes
 * `PermissionDialog.tsx` does, for the same reasons documented on that
 * component: compose the existing primitives, do not fork a new dialog
 * shell for one more layout.
 *
 * `role="alertdialog"` unconditionally (not just when the request was
 * flagged dangerous, unlike `PermissionDialog`) — this panel always
 * reports something the user did not expect (their own answer silently
 * losing, or a request closing out from under them), so it always
 * deserves the more urgent role.
 *
 * The outcome is conveyed in text on two independent elements — the
 * `StatusIndicator`'s `statusText` (`role="status"`, plan.md §10.5
 * "non-colour status text") and the full sentence in `message` below it
 * — never by the `StatusIndicator`'s tone colour alone, so an
 * accessible-text read of this panel (or a colour-blind reading of it)
 * loses nothing a sighted reader gets.
 */
export function OutcomeNoticeDialog({ notice, onDismiss, testId }: OutcomeNoticeDialogProps) {
  const panelRef = useModalBehavior(true, onDismiss);
  const dialogTestId = testId ?? "approvals-outcome-notice";

  return (
    <div
      className="pc-overlay-scrim pc-overlay-scrim--dialog"
      data-testid="approvals-overlay"
      onMouseDown={onDismiss}
    >
      <div
        ref={panelRef}
        className="pc-approvals-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={`${notice.title} — ${notice.statusLabel}`}
        tabIndex={-1}
        data-testid={dialogTestId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <fieldset className="pc-approval" data-testid={`${dialogTestId}-panel`}>
          <legend className="pc-approval__legend">{notice.title}</legend>
          <StatusIndicator
            label="Status"
            tone="warning"
            statusText={notice.statusLabel}
            testId={`${dialogTestId}-status`}
          />
          <p className="pc-approvals-notice__message" data-testid={`${dialogTestId}-message`}>
            {notice.message}
          </p>
          <div className="pc-approval__actions">
            <Button kind="primary" onClick={onDismiss} autoFocus>
              OK
            </Button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

export default OutcomeNoticeDialog;
