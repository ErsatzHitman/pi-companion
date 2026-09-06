import "./recipes.css";

export interface DiffSummaryProps {
  path: string;
  added: number;
  removed: number;
  modified: number;
  testId?: string;
}

/**
 * DiffSummary recipe (plan.md §10.4): the compact +/-/~ line-count badge
 * shown next to a changed file. Clean-specification recipe (plan.md
 * §10.1).
 *
 * Accessibility (plan.md §10.5): every count is prefixed with a `+`/`-`/`~`
 * sign in the visible text (not colour alone) and the whole summary has
 * a single accessible name via `aria-label` summarising the counts in
 * words, so a screen reader doesn't have to parse three separate spans.
 */
export function DiffSummary({ path, added, removed, modified, testId }: DiffSummaryProps) {
  const summary = `${path}: ${added} added, ${removed} removed${modified ? `, ${modified} modified` : ""}`;
  return (
    <div className="pc-diff-summary" aria-label={summary} data-testid={testId}>
      <span className="pc-diff-summary__path">{path}</span>
      <span className="pc-diff-summary__stat pc-diff-summary__stat--added">+{added}</span>
      <span className="pc-diff-summary__stat pc-diff-summary__stat--removed">-{removed}</span>
      {modified > 0 ? (
        <span className="pc-diff-summary__stat pc-diff-summary__stat--modified">~{modified}</span>
      ) : null}
    </div>
  );
}

export default DiffSummary;
