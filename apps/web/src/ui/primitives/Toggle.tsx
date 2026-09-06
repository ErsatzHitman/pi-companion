import { useId } from "react";

import "./primitives.css";

export interface ToggleProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

/**
 * Toggle primitive (plan.md §10.3): `role="switch"` with `aria-checked`
 * kept in sync with `checked`, native `<button>` keyboard operation
 * (Space/Enter toggles), and a visible label associated by
 * `aria-labelledby` rather than colour alone conveying state (plan.md
 * §10.5 — state is also in the accessible name via `aria-checked`).
 */
export function Toggle({ label, checked, onCheckedChange, disabled, testId }: ToggleProps) {
  const labelId = useId();
  return (
    <div className="pc-toggle-row">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className="pc-toggle"
        disabled={disabled}
        data-testid={testId}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="pc-toggle__knob" />
      </button>
      <span id={labelId} className="pc-toggle-row__label">
        {label}
      </span>
    </div>
  );
}
