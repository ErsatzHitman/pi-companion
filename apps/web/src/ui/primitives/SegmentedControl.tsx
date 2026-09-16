import type { CSSProperties } from "react";

import "./primitives.css";

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: string;
}

export interface SegmentedControlProps<Value extends string = string> {
  /** Accessible name for the `role="tablist"` group. */
  ariaLabel: string;
  options: readonly SegmentedControlOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
  testId?: string;
}

/**
 * SegmentedControl primitive (plan.md's ATOMS-1 work package, §10.3): a
 * `role="tablist"` of equal-width `role="tab"` segments with a sliding
 * highlight, sized from the design reference's own `.seg` rather than
 * beautiful-ui's `rounded-full` treatment: the track sits at
 * `--radius-control` (8px), each segment button at `--radius-chip` (6px).
 *
 * The highlight's position/width is driven entirely by two CSS custom
 * properties (`--pc-segmented-count`/`--pc-segmented-index`) set inline
 * below, so `primitives.css` never needs per-instance `calc()` inputs
 * measured in JS — `transform: translateX(N * 100%)` against a highlight
 * already sized to one column's width lands it exactly on the selected
 * segment, animated on `var(--motion-easing-standard)`.
 */
export function SegmentedControl<Value extends string = string>({
  ariaLabel,
  options,
  value,
  onChange,
  disabled = false,
  testId,
}: SegmentedControlProps<Value>) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const highlightStyle = {
    "--pc-segmented-count": options.length,
    "--pc-segmented-index": index,
  } as CSSProperties;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="pc-segmented"
      data-testid={testId}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <span aria-hidden="true" className="pc-segmented__highlight" style={highlightStyle} />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={disabled}
          className="pc-segmented__tab"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
