import type { ReactNode } from "react";

import "./primitives.css";

export interface CodeBlockProps {
  code: string;
  language?: string;
  testId?: string;
  /**
   * Overrides the rendered body while `code` still carries the plain-text
   * content (e.g. for callers that need the untokenized string on hand).
   * Lets richer renderers (T30B2's syntax-highlighted file view) compose
   * this primitive instead of duplicating its `<pre><code>` shell and
   * class names to add per-token markup.
   */
  children?: ReactNode;
}

/**
 * CodeBlock primitive (plan.md §10.3): a labelled `<pre><code>` region.
 * Syntax highlighting (T28A/T29A's richer renderers) layers on top of
 * this; the primitive itself only guarantees monospace layout, horizontal
 * scroll instead of clipping, and a visible language label.
 */
export function CodeBlock({ code, language, testId, children }: CodeBlockProps) {
  return (
    <div>
      {language ? <span className="pc-code-block__language">{language}</span> : null}
      <pre className="pc-code-block" data-testid={testId}>
        <code>{children ?? code}</code>
      </pre>
    </div>
  );
}
