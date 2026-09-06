import type { testing } from "@picompanion/frontend-core";

import "../primitives/primitives.css";
import "./recipes.css";

export interface ToolChipItem {
  id: string;
  label: string;
  tone: testing.LabTone;
  statusText: string;
}

export interface ToolChipsProps {
  items: readonly ToolChipItem[];
  ariaLabel: string;
  testId?: string;
}

/**
 * ToolChips recipe (plan.md §10.4): the row of tool-permission chips
 * shown next to a tool call (Read/Write/Bash/Network, each with an
 * allow/needs-approval/denied state). Clean-specification recipe
 * (plan.md §10.1).
 *
 * Accessibility (plan.md §10.5): rendered as a labelled `role="list"` of
 * `role="listitem"`s; each chip's status is duplicated as visible text
 * (not just the tone colour), so "Denied" reads the same whether or not
 * colour is perceivable.
 */
export function ToolChips({ items, ariaLabel, testId }: ToolChipsProps) {
  return (
    <ul className="pc-tool-chips" role="list" aria-label={ariaLabel} data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} className={`pc-tool-chip pc-tool-chip--${item.tone}`}>
          <span className="pc-tool-chip__label">{item.label}</span>
          <span className="pc-tool-chip__status">{item.statusText}</span>
        </li>
      ))}
    </ul>
  );
}

export default ToolChips;
