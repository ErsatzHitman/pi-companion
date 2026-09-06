import "./primitives.css";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  statusText: string;
  testId?: string;
}

/**
 * StatusIndicator primitive (plan.md §10.3): a coloured dot is always
 * paired with visible status text (plan.md §10.5 "non-color status
 * text"), and `role="status"` announces changes to assistive tech
 * without stealing focus.
 */
export function StatusIndicator({ label, tone, statusText, testId }: StatusIndicatorProps) {
  return (
    <span className={`pc-status pc-status--${tone}`} role="status" data-testid={testId}>
      <span className="pc-status__dot" aria-hidden="true" />
      <span className="pc-status__label">{label}:</span>
      <span className="pc-status__text">{statusText}</span>
    </span>
  );
}
