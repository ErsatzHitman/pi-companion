import { memo } from "react";
import { timeline } from "@picompanion/frontend-core";

/**
 * The head of one **work group** (T388): the disclosure row that stands in
 * for a consecutive thinking/tool-call run and carries its derived summary
 * (`buildTranscriptWorkGroups`, `@picompanion/frontend-core`).
 *
 * Rendered above the group's first member, inside that member's virtual row,
 * so a group does not shift the virtualizer's item indices while it is
 * expanded — the members stay individually virtualized and individually
 * measured. When the group is collapsed the caller keeps this head and drops
 * the remaining member rows entirely (`transcript.tsx`), so a collapsed group
 * costs exactly one line.
 *
 * Accessibility: a real `<button>` with `aria-expanded`, so the collapse
 * state is announced and keyboard-operable — the same pattern the
 * `ThinkingSection` recipe already uses. It deliberately does **not** carry
 * `aria-controls`: the body it controls is not a single element (it is a
 * series of sibling virtual rows, and is absent from the DOM entirely while
 * collapsed), and axe's `aria-valid-attr-value` correctly flags an
 * `aria-controls` pointing at an id that is not in the document.
 */
export interface TranscriptWorkGroupHeadProps {
  group: timeline.TranscriptWorkGroup;
  /** Resolved collapse state for this group (host override, else the
   * group's own `defaultCollapsed`). */
  collapsed: boolean;
  /** Called with the group's id when the disclosure is activated. Kept a
   * single stable callback (never a per-group closure) so this memoized
   * component's props stay comparable by reference. */
  onToggle: (groupId: string) => void;
  testId?: string;
}

function metaText(group: timeline.TranscriptWorkGroup): string {
  return timeline.formatWorkGroupMeta(group);
}

function TranscriptWorkGroupHeadImpl({
  group,
  collapsed,
  onToggle,
  testId,
}: TranscriptWorkGroupHeadProps) {
  return (
    <div className="pc-work-group">
      <button
        type="button"
        className={`pc-work-group__head${group.hasFailure ? " pc-work-group__head--failed" : ""}`}
        aria-expanded={!collapsed}
        aria-label={timeline.workGroupAccessibilityLabel(group)}
        onClick={() => onToggle(group.id)}
        data-testid={testId}
      >
        <span className="pc-work-group__chevron" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="pc-work-group__label">{group.summary.label}</span>
        <span className="pc-work-group__meta">{metaText(group)}</span>
      </button>
      {!collapsed && group.summary.detail ? (
        <p className="pc-work-group__detail">{group.summary.detail}</p>
      ) : null}
    </div>
  );
}

export const TranscriptWorkGroupHead = memo(TranscriptWorkGroupHeadImpl);

export default TranscriptWorkGroupHead;
