import { IconButton } from "../primitives/IconButton.js";
import type { IconName } from "../primitives/icons.js";
import "../primitives/primitives.css";
import "./recipes.css";

export interface SelectionAction {
  id: string;
  label: string;
  icon: IconName;
}

export interface SelectionActionsProps {
  selectionSummary: string;
  actions: readonly SelectionAction[];
  onAction: (id: string) => void;
  testId?: string;
}

/**
 * SelectionActions recipe (plan.md §10.4): a floating toolbar that
 * appears after selecting transcript text (Copy / Quote in reply /
 * Dismiss). Clean-specification recipe (plan.md §10.1).
 *
 * Accessibility (plan.md §10.5): `role="toolbar"` with a visible summary
 * of what is selected as real text (not just an implicit browser
 * selection), and each action is an `IconButton` with its own accessible
 * name so keyboard/screen-reader users don't need the icon to understand
 * the action.
 */
export function SelectionActions({
  selectionSummary,
  actions,
  onAction,
  testId,
}: SelectionActionsProps) {
  return (
    <div
      className="pc-selection-actions"
      role="toolbar"
      aria-label="Selection actions"
      data-testid={testId}
    >
      <span className="pc-selection-actions__summary">{selectionSummary}</span>
      <div className="pc-selection-actions__buttons">
        {actions.map((action) => (
          <IconButton
            key={action.id}
            icon={action.icon}
            accessibleName={action.label}
            onClick={() => onAction(action.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default SelectionActions;
