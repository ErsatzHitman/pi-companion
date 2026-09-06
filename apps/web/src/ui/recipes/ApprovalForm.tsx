import { Button } from "../primitives/Button.js";
import "../primitives/primitives.css";
import "./recipes.css";

export interface ApprovalFormProps {
  toolLabel: string;
  detail: string;
  dangerous?: boolean;
  onApprove: () => void;
  onDeny: () => void;
  testId?: string;
}

/**
 * ApprovalForm recipe (plan.md §10.4): a tool-call permission request
 * ("Pi wants to write src/x.ts — Approve / Deny"). Clean-specification
 * recipe (plan.md §10.1).
 *
 * Accessibility (plan.md §10.5): a `<fieldset>`/`<legend>` gives the
 * whole request an accessible group name; a dangerous request adds
 * visible "Requires extra caution" text rather than colour alone; both
 * actions are native buttons operable from the keyboard, and Deny is the
 * default focus target so a keyboard user cannot accidentally Tab+Enter
 * into approving a dangerous action.
 */
export function ApprovalForm({
  toolLabel,
  detail,
  dangerous,
  onApprove,
  onDeny,
  testId,
}: ApprovalFormProps) {
  return (
    <fieldset
      className={`pc-approval${dangerous ? " pc-approval--dangerous" : ""}`}
      data-testid={testId}
    >
      <legend className="pc-approval__legend">{toolLabel} needs your approval</legend>
      <p className="pc-approval__detail">{detail}</p>
      {dangerous ? (
        <p className="pc-approval__warning">Requires extra caution — this cannot be undone.</p>
      ) : null}
      <div className="pc-approval__actions">
        <Button kind="secondary" onClick={onDeny} autoFocus>
          Deny
        </Button>
        <Button kind={dangerous ? "danger" : "primary"} onClick={onApprove}>
          Approve
        </Button>
      </div>
    </fieldset>
  );
}

export default ApprovalForm;
