import type { HTMLAttributes, ReactNode } from "react";

import "./primitives.css";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  children: ReactNode;
}

/**
 * Section primitive (plan.md §10.3): a labelled landmark-like grouping.
 * Uses `<section aria-labelledby>` so screen readers announce the group
 * with its heading, per plan.md §10.5's "screen-reader role and state".
 */
export function Section({ title, children, className, id, ...rest }: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  const classes = ["pc-section", className].filter(Boolean).join(" ");
  return (
    <section className={classes} id={id} aria-labelledby={headingId} {...rest}>
      <h2 className="pc-section__title" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  );
}
