/**
 * RN-free model for the redesign's todo widget (`HANDOFF.md` §7.2's
 * `.ov`) — T360.
 *
 * Kept free of any React Native import so every decision below is
 * provable by execution under this workspace's plain `vitest`, which
 * cannot parse `react-native`'s Flow source (`CLAUDE.md`). The row that
 * draws it is `./todo-row.tsx`.
 *
 * ## Three visible states from one wire boolean
 *
 * The daemon sends `{ text, completed }` per item — two states. The
 * design draws three: a done item, the one being worked on, and the
 * ones still waiting. `todoItemStates` derives the third the only way
 * that is honest: the FIRST item that is not completed is the current
 * one, and every later incomplete item is waiting. That matches how
 * every agent this product talks to actually works a list — top to
 * bottom — and it is the same rule the artifact's own script animates.
 *
 * It is a derivation and not a fact from the wire, so it is allowed to
 * be wrong about an agent that works out of order. What it costs when
 * it is wrong is one row tinted teal instead of plain; what it buys
 * when it is right is the reader seeing where the work is. Nothing
 * about which items are DONE depends on it — that half comes straight
 * from `completed`.
 *
 * ## The ring
 *
 * An 18px ring drawn as a stroked circle at r=8, stroke 2, with
 * `strokeDasharray` its full circumference and `strokeDashoffset` the
 * unfinished fraction of it. The circumference is computed here rather
 * than written as the artifact's rounded `50.27`, because `2πr` is
 * exact and a literal drifts the moment the radius changes.
 */

import type { timeline } from "@picompanion/frontend-core";

export type TodoTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "todo" }>;

export function isTodoEntry(entry: timeline.TranscriptEntry): entry is TodoTranscriptEntry {
  return entry.kind === "todo";
}

/** The artifact's ring geometry. */
export const RING_RADIUS = 8;
export const RING_STROKE = 2;
/** `2πr`, not the artifact's rounded 50.27 — see this module's doc comment. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type TodoItemState = "done" | "current" | "waiting";

/** The artifact's own per-state glyph. Text, so the state is never colour alone. */
export function todoGlyph(state: TodoItemState): string {
  if (state === "done") return "✓";
  if (state === "current") return "◐";
  return "○";
}

/** The `theme.colors` key a row's glyph reads from. */
export function todoGlyphInk(state: TodoItemState): "green" | "orange" | "ink-3" {
  if (state === "done") return "green";
  if (state === "current") return "orange";
  return "ink-3";
}

/** The `theme.colors` key a row's subject reads from. */
export function todoSubjectInk(state: TodoItemState): "ink-2" | "teal" | "ink" {
  if (state === "done") return "ink-2";
  if (state === "current") return "teal";
  return "ink";
}

export interface TodoRow {
  /** 1-based, matching the visible `#n`. */
  readonly number: number;
  readonly state: TodoItemState;
  readonly subject: string;
  /** `└─` for the last row, `├─` for every other — the artifact's own tree. */
  readonly connector: string;
  /** `true` only for a done row, which the design strikes through. */
  readonly struck: boolean;
}

export interface TodoItemLike {
  readonly text: string;
  readonly completed: boolean;
}

/**
 * Resolves each item's visible state. See this module's doc comment for
 * why "current" is the first incomplete item rather than something the
 * wire states.
 */
export function todoItemStates(items: readonly TodoItemLike[]): TodoItemState[] {
  let currentTaken = false;
  return items.map((item) => {
    if (item.completed) return "done";
    if (currentTaken) return "waiting";
    currentTaken = true;
    return "current";
  });
}

export function buildTodoRows(items: readonly TodoItemLike[]): TodoRow[] {
  const states = todoItemStates(items);
  return items.map((item, index) => {
    const state = states[index] ?? "waiting";
    return {
      number: index + 1,
      state,
      subject: item.text,
      connector: index === items.length - 1 ? "└─" : "├─",
      struck: state === "done",
    };
  });
}

export interface TodoProgress {
  readonly done: number;
  readonly total: number;
  /** `0` for an empty list, so the ring is drawn empty rather than full. */
  readonly fraction: number;
  readonly complete: boolean;
}

export function todoProgress(items: readonly TodoItemLike[]): TodoProgress {
  const total = items.length;
  const done = items.filter((item) => item.completed).length;
  // An empty list is 0/0. Treating that as "all done" would paint a
  // full green ring for a list with nothing in it.
  const fraction = total === 0 ? 0 : done / total;
  return { done, total, fraction, complete: total > 0 && done === total };
}

/**
 * How much of the ring to leave unpainted: the artifact's
 * `50.27 × (1 − done/total)`, with the real circumference.
 */
export function ringDashOffset(
  fraction: number,
  circumference: number = RING_CIRCUMFERENCE,
): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return circumference * (1 - clamped);
}

/** Orange while there is work left, green once there is not. */
export function ringInk(progress: TodoProgress): "orange" | "green" {
  return progress.complete ? "green" : "orange";
}

/** The head's `● Todos (n/m)` — the count in text, never only in the ring. */
export function todoHeadline(progress: TodoProgress): string {
  return `Todos (${progress.done}/${progress.total})`;
}

/** `●` while anything is still open, `○` once the list is finished. */
export function todoHeadGlyph(progress: TodoProgress): string {
  return progress.complete ? "○" : "●";
}

/** The `theme.colors` key the head's glyph and label read from. */
export function todoHeadInk(progress: TodoProgress): "teal" | "ink-3" {
  return progress.complete ? "ink-3" : "teal";
}

/**
 * What a screen reader hears for the whole widget: the counts and the
 * current item's own words, so the ring and the tints carry nothing on
 * their own.
 */
export function todoAccessibilityLabel(items: readonly TodoItemLike[]): string {
  const progress = todoProgress(items);
  const head = `Todos, ${progress.done} of ${progress.total} done`;
  const current = buildTodoRows(items).find((row) => row.state === "current");
  return current === undefined ? head : `${head}. Current: ${current.subject}`;
}
