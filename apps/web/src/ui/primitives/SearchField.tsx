import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import "./primitives.css";

export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  label: string;
  testId?: string;
}

/**
 * SearchField primitive (plan.md §10.3): `type="search"` for the right
 * native semantics/clear affordance, with a visually-hidden `<label>`
 * (search fields are conventionally unlabelled visually but must still
 * have an accessible name — plan.md §10.5).
 */
export function SearchField({ label, testId, className, ...rest }: SearchFieldProps) {
  const inputId = useId();
  const classes = ["pc-search-field", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <label className="pc-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        className="pc-search-field__input"
        data-testid={testId}
        {...rest}
      />
    </div>
  );
}
