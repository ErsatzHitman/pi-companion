/**
 * A1's search field and filter chips, as pure functions — T362.
 *
 * `HANDOFF.md` §7.3 puts a 40dp search bar and a row of chips (All /
 * Active / Idle / Needs you) above the session list, and prints each
 * group's heading as a mono `.lbl` reading "name · count". None of that
 * existed: the screen rendered every group it had, always, with no way
 * to narrow a long list on a phone.
 *
 * RN-free, so every decision here is proven by execution rather than by
 * source regex — plain `vitest` cannot parse `react-native`'s Flow
 * source (`CLAUDE.md`), and `sessions-screen.tsx` is the thin native
 * drawing of what this module decides, the same split
 * `sessions-model.ts` already established for that screen.
 *
 * ## The chips narrow the existing grouping; they do not replace it
 *
 * The artifact groups its rows by PROJECT ("pi-companion · 4") and
 * filters them by status. This list is already grouped by
 * `categorizeSession` — Needs attention, Active, Idle, Archived — and
 * that grouping is the one that changes what a reader does next: a
 * session waiting on an answer sits at the top of the screen rather
 * than under whichever project heading happens to sort first. Replacing
 * it with a project grouping would bury exactly the row the reader came
 * for, so the chips are layered over it instead: `All` shows every
 * group, and each other chip narrows to one. What is adopted from the
 * artifact is the heading's SHAPE — a name and a count, in the `.lbl`
 * style — not its subject.
 *
 * ## A filtered-empty list says so
 *
 * A chip or a query that matches nothing must not render as the empty
 * state, which says there are no sessions at all. That sentence would
 * be false and would send the reader to create one they already have.
 * `sessionFilterEmptyMessage` names the filter that is hiding the rows
 * and how to clear it.
 */
import type { SessionGroupKind, SessionGroupModel, SessionRowModel } from "./sessions-model";

/**
 * One filter chip. `group` is the session group it narrows to, or
 * `null` for "All" — a group kind rather than a raw status, because
 * `categorizeSession` already folds `requiresAttention` and an `error`
 * status into "needs attention", and a chip reading its own second
 * opinion off `SessionSummary.status` would disagree with the heading
 * directly above the rows it filtered.
 */
export interface SessionFilterChip {
  id: string;
  label: string;
  group: SessionGroupKind | null;
}

/**
 * The artifact's four chips, in its order. "Needs you" keeps the
 * artifact's wording rather than the group heading's "Needs attention":
 * on a chip the shorter label is the one that fits, and both name the
 * same set.
 */
export const SESSION_FILTER_CHIPS: readonly SessionFilterChip[] = [
  { id: "all", label: "All", group: null },
  { id: "active", label: "Active", group: "active" },
  { id: "idle", label: "Idle", group: "idle" },
  { id: "needs-you", label: "Needs you", group: "needs-attention" },
];

/** The chip a screen starts on. */
export const DEFAULT_SESSION_FILTER_CHIP_ID = "all";

/** The chip with this id, or the "All" chip when the id is unknown. */
export function sessionFilterChipById(id: string): SessionFilterChip {
  return (
    SESSION_FILTER_CHIPS.find((chip) => chip.id === id) ??
    SESSION_FILTER_CHIPS[0] ?? { id: "all", label: "All", group: null }
  );
}

/**
 * Whether a row matches the typed query.
 *
 * Case-insensitive over the row's visible title AND its meta line, so
 * typing a working directory finds the sessions in it — on this screen
 * the cwd is often the only thing that distinguishes two untitled
 * sessions. An all-whitespace query matches everything: a stray space
 * must not empty the list.
 */
export function matchesSessionQuery(row: SessionRowModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return row.title.toLowerCase().includes(needle) || row.meta.toLowerCase().includes(needle);
}

export interface SessionFilterInput {
  /** The selected chip's id; an unknown one is treated as "All". */
  chipId: string;
  query: string;
}

/**
 * Applies the chip and the query to already-grouped rows.
 *
 * A group left with no matching rows is dropped rather than rendered
 * empty, which is the same rule `groupSessionRows` already applies to a
 * group nobody is in — a heading with nothing under it reads as a
 * loading failure.
 */
export function filterSessionGroups(
  groups: readonly SessionGroupModel[],
  input: SessionFilterInput,
): SessionGroupModel[] {
  const chip = sessionFilterChipById(input.chipId);
  const result: SessionGroupModel[] = [];
  for (const group of groups) {
    if (chip.group !== null && group.kind !== chip.group) continue;
    const rows = group.rows.filter((row) => matchesSessionQuery(row, input.query));
    if (rows.length === 0) continue;
    result.push({ kind: group.kind, label: group.label, rows });
  }
  return result;
}

/**
 * A group heading in the artifact's `.lbl` shape: the group's name and
 * how many rows are under it, after filtering. The count is of what is
 * actually drawn, not of the whole group — a heading claiming four
 * while showing one would be the worse of the two lies.
 */
export function sessionGroupLabel(group: SessionGroupModel): string {
  return `${group.label} · ${group.rows.length}`;
}

/** Whether anything is currently narrowing the list. */
export function isSessionFilterActive(input: SessionFilterInput): boolean {
  return sessionFilterChipById(input.chipId).group !== null || input.query.trim().length > 0;
}

/**
 * What to show in place of the rows when the filter hides all of them,
 * or `null` when nothing is being hidden (the list is genuinely empty,
 * and the screen's own empty state is the right thing to draw).
 *
 * Names whichever filters are on, so the reader can see why a session
 * they know exists is missing.
 */
export function sessionFilterEmptyMessage(input: SessionFilterInput): string | null {
  if (!isSessionFilterActive(input)) return null;
  const chip = sessionFilterChipById(input.chipId);
  const query = input.query.trim();
  if (chip.group !== null && query.length > 0) {
    return `No ${chip.label.toLowerCase()} sessions match "${query}". Clear the search or pick All.`;
  }
  if (query.length > 0) {
    return `No sessions match "${query}". Clear the search to see them all.`;
  }
  return `No ${chip.label.toLowerCase()} sessions right now. Pick All to see the others.`;
}

/**
 * The chip row's accessible name, spoken before the chips themselves,
 * so a screen reader hears what the group of buttons is for rather than
 * four unexplained toggles.
 */
export const SESSION_FILTER_GROUP_LABEL = "Filter sessions by status";

/**
 * One chip's accessible name. TalkBack reads selection from
 * `accessibilityState`, so the name stays the plain label and does not
 * repeat "selected" into it.
 */
export function sessionFilterChipAccessibilityLabel(chip: SessionFilterChip): string {
  return chip.group === null ? "All sessions" : `${chip.label} sessions`;
}
