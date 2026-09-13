import { memo, useRef } from "react";

import { Card } from "../../ui/primitives/index.js";
import { TaskRows } from "../../ui/recipes/index.js";
import type { TaskRowItem } from "../../ui/recipes/index.js";
import { isTodoEntry } from "./todo-dock.js";
import type { TodoTranscriptEntry } from "./todo-dock.js";

export { isTodoEntry };
export type { TodoTranscriptEntry } from "./todo-dock.js";

export interface TranscriptTodoRowProps {
  entry: TodoTranscriptEntry;
  testId?: string;
}

/**
 * One `todo` entry as an inline transcript row.
 *
 * This sits alongside — not instead of — `todo-dock.tsx`'s pinned dock:
 * the dock (composed above the composer) always shows the session's
 * *latest* list so the current task stays readable at any scroll
 * position, while this row keeps every list *in history*, in
 * chronological order, so a reader scrolling back sees what the plan was
 * at that point in the conversation rather than a gap where a turn used
 * to be.
 *
 * It draws through the same `TaskRows` recipe the dock uses (plan.md
 * §10.2 "one approved visual treatment per component"), with the same
 * first-incomplete-item-is-current rule, so the inline row and the dock
 * describe the same list the same way. The headline prints the literal
 * `n of m` count, and every row's state is visible text from `TaskRows`
 * ("Done"/"In progress"/"Pending"), never colour alone.
 */
function TranscriptTodoRowImpl({ entry, testId }: TranscriptTodoRowProps) {
  // Same render-count instrumentation as `TranscriptErrorRow`, for the
  // same reason — see that component's doc comment.
  const renderCount = useRef(0);
  renderCount.current += 1;

  const total = entry.items.length;
  const done = entry.items.filter((item) => item.completed).length;
  const headline = total === 0 ? "Task list — 0 of 0" : `Task list — ${done} of ${total} done`;

  // The first still-open item is the one being worked on; every later
  // open item is waiting — the same derivation `TodoDock` uses.
  let currentTaken = false;
  const items: TaskRowItem[] = entry.items.map((item, index) => {
    let status: TaskRowItem["status"] = "pending";
    if (item.completed) {
      status = "done";
    } else if (!currentTaken) {
      currentTaken = true;
      status = "in-progress";
    }
    return { id: `${entry.id}-${index}`, title: item.text, status };
  });

  return (
    <div data-render-count={renderCount.current}>
      <Card data-testid={testId}>
        <p className="pc-tool-call__meta">{headline}</p>
        {items.length > 0 ? (
          <TaskRows
            items={items}
            ariaLabel="Task list"
            testId={testId ? `${testId}-items` : undefined}
          />
        ) : null}
      </Card>
    </div>
  );
}

function areTodoRowPropsEqual(
  previous: TranscriptTodoRowProps,
  next: TranscriptTodoRowProps,
): boolean {
  if (previous.entry.id !== next.entry.id || previous.testId !== next.testId) {
    return false;
  }
  if (previous.entry.items.length !== next.entry.items.length) {
    return false;
  }
  return previous.entry.items.every(
    (item, index) =>
      item.text === next.entry.items[index]?.text &&
      item.completed === next.entry.items[index]?.completed,
  );
}

export const TranscriptTodoRow = memo(TranscriptTodoRowImpl, areTodoRowPropsEqual);
