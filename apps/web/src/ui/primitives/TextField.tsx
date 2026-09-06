import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import "./primitives.css";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  /** Stable identifier for critical-flow test hooks (plan.md §10.5). */
  testId?: string;
}

/**
 * TextField primitive (plan.md §10.3). Label is a real `<label for>` (not
 * a placeholder), and an error is announced via `aria-describedby` +
 * `aria-invalid` plus visible text — never colour alone (plan.md §10.5).
 */
export function TextField({ label, error, required, testId, className, ...rest }: TextFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const classes = ["pc-field", error ? "pc-field--error" : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <label className="pc-field__label" htmlFor={inputId}>
        {label}
        {required ? (
          <span className="pc-field__required" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <input
        id={inputId}
        className="pc-field__input"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-testid={testId}
        {...rest}
      />
      {error ? (
        <p className="pc-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
