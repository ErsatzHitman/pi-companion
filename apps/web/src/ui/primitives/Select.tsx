import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

import "./primitives.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: readonly SelectOption[];
  testId?: string;
}

/** Select primitive (plan.md §10.3): native `<select>` for full keyboard/AT support. */
export function Select({ label, options, testId, className, ...rest }: SelectProps) {
  const inputId = useId();
  const classes = ["pc-field", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <label className="pc-field__label" htmlFor={inputId}>
        {label}
      </label>
      <select id={inputId} className="pc-field__select" data-testid={testId} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
