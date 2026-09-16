import "./primitives.css";

/**
 * Defined here, not in `StatusIndicator.tsx`: `StatusIndicator` imports
 * `StatusPill` for its `variant="pill"` case, so the tone vocabulary has to
 * live on whichever side does not import the other, to avoid a module
 * cycle. `StatusIndicator.tsx` re-exports this type for existing callers.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusPillProps {
  /** The pill's own visible word/phrase (e.g. "Running", "Idle · needs attention"). */
  label: string;
  tone: StatusTone;
  /**
   * Overrides the announced name when it should say more than the drawn
   * text (mirrors `StatusIndicator`'s `label:` prefix for its `"pill"`
   * variant). Defaults to `label`.
   */
  accessibleLabel?: string;
  testId?: string;
}

/**
 * StatusPill primitive (plan.md's ATOMS-1 work package, §10.3): a faithful
 * port of the design reference's `.pill` — 22px height, a 6px dot, a 6px
 * content gap, `0 9px` padding, fully rounded, a tone-tinted background
 * paired with tone-tinted text (plan.md §10.5: tone is never colour alone,
 * the visible word carries the state too).
 *
 * Promoted out of `features/sessions/session-status.css`'s
 * `.pc-session-pill` — that block was already a faithful port of this same
 * reference rule, just sitting in a feature-owned stylesheet instead of the
 * shared primitive layer. `features/sessions/session-status-pill.tsx` is now
 * a thin wrapper over this component.
 */
export function StatusPill({ label, tone, accessibleLabel, testId }: StatusPillProps) {
  return (
    <span
      className={`pc-status-pill pc-status-pill--${tone}`}
      role="status"
      aria-label={accessibleLabel}
      data-testid={testId}
    >
      <span className="pc-status-pill__dot" aria-hidden="true" />
      <span className="pc-status-pill__label">{label}</span>
    </span>
  );
}
