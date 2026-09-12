import { composer as coreComposer } from "@picompanion/frontend-core";

/**
 * The composer's `@` candidate list (T389).
 *
 * Rendered above the prompt bar while an `@file`/`@skill` token is open.
 * Keyboard navigation lives in `Composer` (the textarea keeps focus and the
 * composer moves the highlight), so each option is a plain
 * `role="option"`; the listbox is labelled and every option names its kind
 * in visible text, never colour alone (plan.md §10.5).
 */
export interface ReferenceSuggestionsProps {
  /** Id the composer's textarea points `aria-controls` at. */
  listboxId: string;
  items: readonly coreComposer.ReferenceCandidate[];
  activeIndex: number;
  onSelect: (candidate: coreComposer.ReferenceCandidate) => void;
  label?: string;
  testId?: string;
}

export function ReferenceSuggestions({
  listboxId,
  items,
  activeIndex,
  onSelect,
  label = "References",
  testId,
}: ReferenceSuggestionsProps) {
  return (
    <div className="pc-composer__references" data-testid={testId}>
      <ul id={listboxId} role="listbox" aria-label={label} className="pc-composer__reference-list">
        {items.map((item, index) => (
          <li
            key={`${item.kind}:${item.id}`}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`pc-composer__reference-option${
              index === activeIndex ? " pc-composer__reference-option--active" : ""
            }`}
            onMouseDown={(event) => {
              // Keep focus in the textarea; choosing must not blur it first.
              event.preventDefault();
              onSelect(item);
            }}
          >
            <span className="pc-composer__reference-label">{item.label}</span>
            <span className="pc-composer__reference-kind">{item.kind}</span>
            {item.description ? (
              <span className="pc-composer__reference-hint">{item.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ReferenceSuggestions;
