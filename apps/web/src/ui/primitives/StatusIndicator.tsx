import { StatusPill } from "./StatusPill.js";
import type { StatusTone } from "./StatusPill.js";
import "./primitives.css";

export type { StatusTone };

export interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  statusText: string;
  testId?: string;
  /**
   * `"inline"` (default): today's bare dot + `label:` + `statusText` line,
   * for block-level status text (`DiagnosticsScreen`, `BootstrapConnectStatus`,
   * `ModelThinkingPicker` notices). `"pill"`: renders through the shared
   * `StatusPill` primitive instead — the mockup's `.pill` treatment, reserved
   * for session/turn state (ATOMS-1, plan.md §10.3). Most callers keep the
   * default; do not convert every call site to `"pill"`.
   */
  variant?: "inline" | "pill";
}

/**
 * StatusIndicator primitive (plan.md §10.3): a coloured dot is always
 * paired with visible status text (plan.md §10.5 "non-color status
 * text"), and `role="status"` announces changes to assistive tech
 * without stealing focus.
 */
export function StatusIndicator({
  label,
  tone,
  statusText,
  testId,
  variant = "inline",
}: StatusIndicatorProps) {
  if (variant === "pill") {
    return (
      <StatusPill
        label={statusText}
        tone={tone}
        accessibleLabel={`${label}: ${statusText}`}
        testId={testId}
      />
    );
  }
  return (
    <span className={`pc-status pc-status--${tone}`} role="status" data-testid={testId}>
      <span className="pc-status__dot" aria-hidden="true" />
      <span className="pc-status__label">{label}:</span>
      <span className="pc-status__text">{statusText}</span>
    </span>
  );
}
