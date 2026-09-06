import "../primitives/primitives.css";
import "./recipes.css";

export interface CodeListingProps {
  path: string;
  language: string;
  code: string;
  highlightLine?: number;
  testId?: string;
}

/**
 * CodeListing recipe (plan.md §10.4): a file-path-labelled, numbered code
 * excerpt, e.g. a snippet Pi quotes while explaining a change, with an
 * optional highlighted line. Clean-specification recipe (plan.md §10.1),
 * layered on the `CodeBlock` primitive's typography.
 *
 * Accessibility (plan.md §10.5): line numbers are `aria-hidden` (they are
 * a visual aid, not part of the code's accessible name); the highlighted
 * line gets a visible left border *and* a screen-reader-only "(changed
 * line)" suffix rather than colour alone.
 */
export function CodeListing({ path, language, code, highlightLine, testId }: CodeListingProps) {
  const lines = code.split("\n");
  return (
    <div className="pc-code-listing" data-testid={testId}>
      <div className="pc-code-listing__header">
        <span className="pc-code-listing__path">{path}</span>
        <span className="pc-code-listing__language">{language}</span>
      </div>
      <pre className="pc-code-listing__body">
        <code>
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const isHighlighted = lineNumber === highlightLine;
            return (
              <span
                key={lineNumber}
                className={`pc-code-listing__line${isHighlighted ? " pc-code-listing__line--highlighted" : ""}`}
              >
                <span className="pc-code-listing__line-number" aria-hidden="true">
                  {lineNumber}
                </span>
                <span className="pc-code-listing__line-text">
                  {line}
                  {isHighlighted ? (
                    <span className="pc-visually-hidden"> (changed line)</span>
                  ) : null}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

export default CodeListing;
