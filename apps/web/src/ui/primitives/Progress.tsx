import "./primitives.css";

export interface ProgressProps {
  label: string;
  /** 0-1, or `null` for an indeterminate (unknown-duration) operation. */
  value: number | null;
  testId?: string;
}

/**
 * Progress primitive (plan.md §10.3). Native `progressbar` semantics via
 * `role="progressbar"`; indeterminate state omits `aria-valuenow` (per the
 * ARIA spec) rather than faking a value, and the percentage is always
 * shown as visible text, not colour/width alone (plan.md §10.5).
 */
export function Progress({ label, value, testId }: ProgressProps) {
  const percentText = value === null ? "In progress" : `${Math.round(value * 100)}%`;
  const classes = ["pc-progress", value === null ? "pc-progress--indeterminate" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className="pc-progress__label-row">
        <span>{label}</span>
        <span>{percentText}</span>
      </div>
      <div
        className="pc-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        data-testid={testId}
      >
        <div
          className="pc-progress__fill"
          style={value === null ? undefined : { width: `${Math.round(value * 100)}%` }}
        />
      </div>
    </div>
  );
}
