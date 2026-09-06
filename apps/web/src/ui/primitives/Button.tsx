import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./primitives.css";

export type ButtonKind = "primary" | "secondary" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  kind?: ButtonKind;
  children: ReactNode;
  /** HTML `type`; defaults to `"button"` so buttons never accidentally submit a form. */
  type?: "button" | "submit" | "reset";
}

/**
 * Button primitive (plan.md §10.3). One visual treatment; `kind` selects a
 * semantic role (primary/secondary/danger), not an alternate style.
 * Native `<button>` gives keyboard operation (Space/Enter), the
 * `button` role, and `disabled` state for free.
 */
export function Button({ kind = "primary", type = "button", className, ...rest }: ButtonProps) {
  const classes = ["pc-button", `pc-button--${kind}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
