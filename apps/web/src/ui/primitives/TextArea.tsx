import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";

import "./primitives.css";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  error?: string;
  testId?: string;
}

/** TextArea primitive (plan.md §10.3); same label/error contract as `TextField`. */
export function TextArea({ label, error, required, testId, className, ...rest }: TextAreaProps) {
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
      <textarea
        id={inputId}
        className="pc-field__textarea"
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
