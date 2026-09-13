import { memo, useRef } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { Card, RecordList } from "../../ui/primitives/index.js";
import { summarizeRailElement } from "../rail/summarize-rail-element.js";

/** The `extension-snapshot` transcript entry kind (`transcript-view.ts`'s
 * `pi_ui_snapshot` -> `"extension-snapshot"` projection, a durable Pi UI
 * Bridge snapshot that became a timeline item).
 *
 * A snapshot is history, not live state: it renders here as a bounded
 * summary card (one line per element through the rail's own
 * `summarizeRailElement`, so a snapshot says the same thing about an
 * element the rail would have said live) rather than through the live
 * per-element pipeline (`PiUiElementView`), which needs an
 * `ExtensionActionController` this scroll does not have and would imply
 * actions a recorded snapshot cannot dispatch. */
export type ExtensionSnapshotTranscriptEntry = Extract<
  timeline.TranscriptEntry,
  { kind: "extension-snapshot" }
>;

export function isExtensionSnapshotEntry(
  entry: timeline.TranscriptEntry,
): entry is ExtensionSnapshotTranscriptEntry {
  return entry.kind === "extension-snapshot";
}

export interface TranscriptExtensionSnapshotRowProps {
  entry: ExtensionSnapshotTranscriptEntry;
  testId?: string;
}

/** Bound on how many snapshot elements this row lists (the same shape of
 * cap `tool-call-row.tsx`'s `MAX_LIST_ROWS` puts on search results): a
 * huge snapshot still shows its first elements plus a visible count of
 * what was hidden, rather than freezing the row. */
const MAX_ELEMENT_ROWS = 20;

function elementTitle(element: { title?: string; kind: string; ns: string; id: string }): string {
  const trimmed = element.title?.trim();
  if (trimmed) {
    return trimmed;
  }
  return `${element.ns}/${element.kind}`;
}

/**
 * Renders one `extension-snapshot` transcript entry as a summary card:
 * the element count in words (never the card's presence alone), then the
 * bounded per-element list. An empty snapshot still renders its headline
 * rather than vanishing — an explicit "no elements" is history too.
 */
function TranscriptExtensionSnapshotRowImpl({
  entry,
  testId,
}: TranscriptExtensionSnapshotRowProps) {
  // Same render-count instrumentation as `TranscriptErrorRow`, for the
  // same reason — see that component's doc comment.
  const renderCount = useRef(0);
  renderCount.current += 1;

  const elements = entry.state.elements;
  const total = elements.length;
  const shown = elements.slice(0, MAX_ELEMENT_ROWS);
  const hiddenCount = total - shown.length;
  const headline =
    total === 0
      ? "Extension snapshot — no elements"
      : `Extension snapshot — ${total} element${total === 1 ? "" : "s"}`;

  return (
    <div data-render-count={renderCount.current}>
      <Card data-testid={testId}>
        <p className="pc-tool-call__meta">{headline}</p>
        {shown.length > 0 ? (
          <RecordList
            ariaLabel="Extension snapshot elements"
            columns={[
              { key: "title", header: "Element" },
              { key: "detail", header: "Summary" },
            ]}
            rows={shown.map((element, index) => ({
              id: `${index}-${element.ns}-${element.id}`,
              cells: { title: elementTitle(element), detail: summarizeRailElement(element) },
            }))}
          />
        ) : null}
        {hiddenCount > 0 ? (
          <p className="pc-tool-call__meta">{hiddenCount} more elements not shown</p>
        ) : null}
      </Card>
    </div>
  );
}

function areExtensionSnapshotRowPropsEqual(
  previous: TranscriptExtensionSnapshotRowProps,
  next: TranscriptExtensionSnapshotRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.testId === next.testId &&
    JSON.stringify(previous.entry.state) === JSON.stringify(next.entry.state)
  );
}

export const TranscriptExtensionSnapshotRow = memo(
  TranscriptExtensionSnapshotRowImpl,
  areExtensionSnapshotRowPropsEqual,
);
