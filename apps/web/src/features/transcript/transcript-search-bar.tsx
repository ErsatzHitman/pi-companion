import { timeline } from "@picompanion/frontend-core";

import { Button, SearchField } from "../../ui/primitives/index.js";

export interface TranscriptSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** `-1` when there is no current match (no query, or no hits). */
  currentIndex: number;
  totalCount: number;
  onNext: () => void;
  onPrevious: () => void;
  testId?: string;
}

/**
 * Transcript search bar (plain-text find over the transcript —
 * `timeline.findTranscriptSearchMatches`, `@picompanion/frontend-core`).
 *
 * A controlled bar: the query, the match list, and the cursor live in
 * the transcript that owns the scrolled list (`transcript.tsx`), which
 * is the only place that can scroll to a match. This component only
 * renders the field, the one shared count label
 * (`timeline.formatTranscriptSearchCount`), and the two navigation
 * buttons — no matching logic of its own, so it cannot disagree with
 * the list about what "3 of 8" means.
 *
 * Composed from `SearchField`/`Button` (`ui/primitives`, plan.md
 * §10.3) and styled from `@picompanion/design-tokens` in
 * `transcript.css` (`.pc-transcript-search`) — no raw colour, space, or
 * radius here or there. The count is a `role="status"` live region so a
 * narrowing query announces its new count; the buttons are disabled
 * (never hidden) with no matches, the same "reasoned rejection, not a
 * hidden affordance" treatment `message-row.tsx` gives its own gated
 * buttons.
 */
export function TranscriptSearchBar({
  query,
  onQueryChange,
  currentIndex,
  totalCount,
  onNext,
  onPrevious,
  testId,
}: TranscriptSearchBarProps) {
  const count = timeline.formatTranscriptSearchCount(currentIndex, totalCount, query);
  const hasMatches = totalCount > 0;
  return (
    <div className="pc-transcript-search" data-testid={testId}>
      <SearchField
        label="Search transcript"
        placeholder="Search transcript"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        testId={testId ? `${testId}-input` : undefined}
      />
      {count.length > 0 ? (
        <span
          className="pc-transcript-search__count"
          role="status"
          data-testid={testId ? `${testId}-count` : undefined}
        >
          {count}
        </span>
      ) : null}
      <Button
        kind="secondary"
        disabled={!hasMatches}
        onClick={onPrevious}
        aria-label="Previous match"
        data-testid={testId ? `${testId}-previous` : undefined}
      >
        Previous
      </Button>
      <Button
        kind="secondary"
        disabled={!hasMatches}
        onClick={onNext}
        aria-label="Next match"
        data-testid={testId ? `${testId}-next` : undefined}
      >
        Next
      </Button>
    </div>
  );
}

export default TranscriptSearchBar;
