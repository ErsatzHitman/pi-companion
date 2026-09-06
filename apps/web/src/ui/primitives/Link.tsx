import type { AnchorHTMLAttributes } from "react";

import "./primitives.css";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  external?: boolean;
}

/**
 * Link primitive (plan.md §10.3). A plain `<a>` so it gets native keyboard
 * operation, the `link` role, and browser history for free; `external`
 * opens in a new tab with `rel="noopener noreferrer"` and appends a
 * screen-reader-only "(opens in a new tab)" cue instead of relying on
 * colour or an icon alone.
 */
export function Link({ external, target, rel, className, children, ...rest }: LinkProps) {
  const classes = ["pc-link", className].filter(Boolean).join(" ");
  return (
    <a
      className={classes}
      target={external ? "_blank" : target}
      rel={external ? "noopener noreferrer" : rel}
      {...rest}
    >
      {children}
      {external ? <span className="pc-visually-hidden"> (opens in a new tab)</span> : null}
    </a>
  );
}
