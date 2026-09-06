import "./primitives.css";

export interface PlaceholderStateProps {
  title: string;
  description: string;
  testId?: string;
}

/**
 * EmptyState primitive (plan.md §10.3): a neutral "nothing here yet"
 * placeholder. Plain content, no live-region role (nothing changed).
 */
export function EmptyState({ title, description, testId }: PlaceholderStateProps) {
  return (
    <div className="pc-placeholder-state" data-testid={testId}>
      <p className="pc-placeholder-state__title">{title}</p>
      <p className="pc-placeholder-state__description">{description}</p>
    </div>
  );
}

/**
 * ErrorState primitive (plan.md §10.3): `role="alert"` so assistive tech
 * announces the failure as soon as it renders, plus visible (non-colour)
 * error text (plan.md §10.5).
 */
export function ErrorState({ title, description, testId }: PlaceholderStateProps) {
  return (
    <div
      className="pc-placeholder-state pc-placeholder-state--error"
      role="alert"
      data-testid={testId}
    >
      <p className="pc-placeholder-state__title">{title}</p>
      <p className="pc-placeholder-state__description">{description}</p>
    </div>
  );
}

/**
 * LoadingState primitive (plan.md §10.3): `role="status"` (a polite live
 * region) with visible "Loading…" text and a spinner that respects
 * `prefers-reduced-motion` (see `primitives.css`).
 */
export function LoadingState({ title, description, testId }: PlaceholderStateProps) {
  return (
    <div className="pc-placeholder-state" role="status" data-testid={testId}>
      <span className="pc-placeholder-state__spinner" aria-hidden="true" />
      <p className="pc-placeholder-state__title">{title}</p>
      <p className="pc-placeholder-state__description">{description}</p>
    </div>
  );
}
