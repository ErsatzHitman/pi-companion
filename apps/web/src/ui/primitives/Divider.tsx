import "./primitives.css";

/** Divider primitive (plan.md §10.3): a semantic `<hr>` separator. */
export function Divider({ className }: { className?: string }) {
  const classes = ["pc-divider", className].filter(Boolean).join(" ");
  return <hr className={classes} />;
}
