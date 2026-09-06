import type { ButtonHTMLAttributes } from "react";

import { Icon, type IconName } from "./icons.js";
import "./primitives.css";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-label"
> {
  icon: IconName;
  /** Required: the icon alone is `aria-hidden`, so this is the button's only accessible name. */
  accessibleName: string;
}

/**
 * IconButton primitive (plan.md §10.3). Icon-only affordance with a
 * mandatory `accessibleName` (plan.md §10.5: "a visible label or
 * accessible name") exposed via `aria-label` and a native `title` so
 * sighted mouse users get a tooltip too.
 */
export function IconButton({ icon, accessibleName, className, ...rest }: IconButtonProps) {
  const classes = ["pc-icon-button", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-label={accessibleName}
      title={accessibleName}
      {...rest}
    >
      <Icon name={icon} className="pc-icon-button__glyph" />
    </button>
  );
}
