import type { ReactNode } from "react";

import { Icon } from "./icons.js";
import "./primitives.css";

export type ChipTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  onRemove?: () => void;
  testId?: string;
}

/**
 * Chip primitive (plan.md §10.3). When `onRemove` is supplied the chip
 * becomes a real `<button>` (keyboard operable) whose accessible name is
 * `"Remove <label>"`; tone is always paired with the label text, never
 * colour alone (plan.md §10.5).
 */
export function Chip({ label, tone = "neutral", onRemove, testId }: ChipProps) {
  if (onRemove) {
    return (
      <button
        type="button"
        className={`pc-chip pc-chip--${tone} pc-chip--removable`}
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        data-testid={testId}
      >
        {label}
        <Icon name="close" className="pc-chip__remove" width="10" height="10" />
      </button>
    );
  }
  return (
    <span className={`pc-chip pc-chip--${tone}`} data-testid={testId}>
      {label}
    </span>
  );
}

export function ChipGroup({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  return (
    <div className="pc-chip-group" role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
