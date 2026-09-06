import "./recipes.css";

export type WorkflowStepStatus = "complete" | "active" | "upcoming" | "error";

export interface WorkflowStepItem {
  id: string;
  label: string;
  status: WorkflowStepStatus;
}

export interface WorkflowStepsProps {
  items: readonly WorkflowStepItem[];
  ariaLabel: string;
  testId?: string;
}

const statusText: Record<WorkflowStepStatus, string> = {
  complete: "Complete",
  active: "In progress",
  upcoming: "Upcoming",
  error: "Failed",
};

/**
 * WorkflowSteps recipe (plan.md §10.4): a multi-step operation tracker
 * (pairing, connecting, syncing). Clean-specification recipe (plan.md
 * §10.1).
 *
 * Accessibility (plan.md §10.5): an ordered list with `aria-current="step"`
 * on the active step (the ARIA-defined way to mark the current step in a
 * process), and each step's status is visible text, not marker colour
 * alone.
 */
export function WorkflowSteps({ items, ariaLabel, testId }: WorkflowStepsProps) {
  return (
    <ol className="pc-workflow-steps" aria-label={ariaLabel} data-testid={testId}>
      {items.map((item) => (
        <li
          key={item.id}
          className={`pc-workflow-step pc-workflow-step--${item.status}`}
          aria-current={item.status === "active" ? "step" : undefined}
        >
          <span className="pc-workflow-step__marker" aria-hidden="true" />
          <span className="pc-workflow-step__label">{item.label}</span>
          <span className="pc-workflow-step__status">{statusText[item.status]}</span>
        </li>
      ))}
    </ol>
  );
}

export default WorkflowSteps;
