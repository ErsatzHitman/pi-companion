import "./primitives.css";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface BannerProps {
  tone: StatusTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

/**
 * Banner primitive (plan.md §10.3): a persistent, in-flow status strip
 * (e.g. "connected through a relay"). `role="status"`/polite live region;
 * the optional action is a real `<button>`, never a bare colour cue.
 */
export function Banner({ tone, message, actionLabel, onAction, testId }: BannerProps) {
  return (
    <div className={`pc-banner pc-banner--${tone}`} role="status" data-testid={testId}>
      <span className="pc-banner__message">{message}</span>
      {actionLabel ? (
        <button type="button" className="pc-banner__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
