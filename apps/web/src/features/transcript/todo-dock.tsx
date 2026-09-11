import { useId, useState } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { TaskRows } from "../../ui/recipes/index.js";
import type { TaskRowItem } from "../../ui/recipes/index.js";
import "./todo-dock.css";

/** The `todo` transcript entry kind (plan.md §11.1). */
export type TodoTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "todo" }>;

export function isTodoEntry(entry: timeline.TranscriptEntry): entry is TodoTranscriptEntry {
  return entry.kind === "todo";
}

/**
 * The latest `todo` entry in a session's timeline, or `null` when the
 * session has never emitted one.
 *
 * `transcript.tsx`'s `isRenderableEntry` deliberately still excludes
 * `{ kind: "todo" }` from the scrolling transcript: the mockup draws the
 * task list *docked above the prompt bar* (`.dock-todo` inside
 * `.composer-inner`), not as a turn in the scroll. This selector is that
 * dock's data source — the same `transcriptEntries` array the transcript
 * reads, scanned from the tail so the newest list wins.
 */
export function selectLatestTodoEntry(
  entries: readonly timeline.TranscriptEntry[],
): TodoTranscriptEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && isTodoEntry(entry)) {
      return entry;
    }
  }
  return null;
}

export interface TodoDockProps {
  entry: TodoTranscriptEntry;
  testId?: string;
}

/**
 * The task dock the mockup pins directly above the prompt bar
 * (`.dock-todo`).
 *
 * It draws the reference's head — an 18px progress ring, `Task list`, the
 * current item, an `n of m` count and a chevron toggle — then the list
 * itself through the existing `TaskRows` recipe (plan.md §10.2 "one
 * approved visual treatment per component"), rather than forking a second
 * todo-list treatment in this feature. `TaskRows` already gives each row a
 * non-colour status word and strikes completed titles through; the dock's
 * own stylesheet flattens its per-row cards so they sit inside the dock's
 * single raised panel instead of stacking six more raised cards.
 *
 * Ring geometry is the Android todo row's own (`apps/android/src/features/
 * transcript/todo-row-model.ts`): an 18px ring drawn as a stroked circle at
 * r=8, stroke 2, with `strokeDasharray` the exact `2πr` circumference and
 * `strokeDashoffset` the unfinished fraction of it — computed here rather
 * than copied as the artifact's rounded `50.27`, so it cannot drift if the
 * radius ever changes.
 *
 * Accessibility (plan.md §10.5): the ring is `aria-hidden`; the head prints
 * the literal `n of m` count and the current item's words; every row's
 * state is visible text ("Done"/"In progress"/"Pending") from `TaskRows`,
 * and the toggle is a real button with `aria-expanded`/`aria-controls`. A
 * done row's strikethrough is a reinforcing cue on top of that text, never
 * the only signal.
 */
const RING_RADIUS = 8;
const RING_STROKE = 2;
/** The artifact's 18px box: `2r` plus the stroke drawn centred on that radius. */
const RING_SIZE = RING_RADIUS * 2 + RING_STROKE;
/** `2πr`, not the artifact's rounded `50.27`. */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function TodoDock({ entry, testId }: TodoDockProps) {
  const [open, setOpen] = useState(true);
  const listId = useId();

  const total = entry.items.length;
  const done = entry.items.filter((item) => item.completed).length;
  const current = entry.items.find((item) => !item.completed);
  // An empty list is 0/0: draw an empty ring rather than claiming "all done".
  const fraction = total === 0 ? 0 : done / total;
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, fraction)));

  // The first still-open item is the one being worked on; every later open
  // item is waiting. `TaskRows`' own status vocabulary renders this as
  // "In progress" / "Pending" text, never a tint alone.
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
    <section className="pc-todo-dock" aria-label="Task list" data-testid={testId}>
      <div className="pc-todo-dock__head">
        <svg
          className="pc-todo-dock__ring"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          aria-hidden="true"
        >
          <circle
            className="pc-todo-dock__ring-track"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            strokeWidth={RING_STROKE}
          />
          <circle
            className="pc-todo-dock__ring-arc"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
            strokeDashoffset={dashOffset.toFixed(2)}
          />
        </svg>
        <span className="pc-todo-dock__title">Task list</span>
        <span className="pc-todo-dock__now">{current ? current.text : "All done"}</span>
        <span className="pc-todo-dock__count">{`${done} of ${total}`}</span>
        <button
          type="button"
          className="pc-todo-dock__toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? "Collapse task list" : "Expand task list"}
          onClick={() => setOpen((value) => !value)}
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <svg
            className="pc-todo-dock__chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 15 6-6 6 6" />
          </svg>
        </button>
      </div>
      {/* `hidden` rather than unmounting: the toggle keeps referencing a
          real element through `aria-controls`, and a collapsed list is a
          state, not a removed one. */}
      <div id={listId} className="pc-todo-dock__list" hidden={!open}>
        <TaskRows
          items={items}
          ariaLabel="Task list items"
          testId={testId ? `${testId}-items` : undefined}
        />
      </div>
    </section>
  );
}

export default TodoDock;
