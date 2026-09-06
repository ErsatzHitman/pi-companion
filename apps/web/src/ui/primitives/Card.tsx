import type { HTMLAttributes } from "react";

import "./primitives.css";

/** Card primitive (plan.md §10.3): elevated surface container. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ["pc-card", className].filter(Boolean).join(" ");
  return <div className={classes} {...rest} />;
}
