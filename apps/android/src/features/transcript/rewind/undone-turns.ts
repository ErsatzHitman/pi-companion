/**
 * The undone-turns record — T395, `plan.md` §4.2 ("Workspace checkpoint
 * snapshots").
 *
 * Each successful rewind this app session performs is remembered locally as
 * the message it rewound *to*: the daemon exposes no list of past rewinds
 * (`agent.rewind.response` carries only `ok` and an `error` string), so a
 * screen that offered a "return to that turn" affordance without recording
 * it itself would be inventing daemon state it does not have. This module
 * is the honest local record: a bounded, in-memory list of
 * `{ messageId, snippet, mode }`, owned by the hook
 * (`use-rewind-to-here.ts`) and rendered by `RewindSheet.tsx` under an
 * explicit "local record, not daemon state" label.
 *
 * **Why the rewound-to turn, not the turns it removed.** The removed turns'
 * ids are no protection against a return: for a submitted prompt the client
 * only ever holds the `clientMessageId`, and `agent-manager.rewind` maps
 * that to the provider's tree entry through the live timeline row
 * (`packages/server/src/server/agent/agent-manager.ts`). Once a rewind
 * removes that row, the mapping is gone and a return would call Pi's
 * `navigateTree` with an id that is not a tree entry. The turn a rewind
 * targeted is retained, so its id always resolves, and re-issuing a
 * conversation rewind to it is exactly "return to that turn".
 *
 * The record is deliberately **not** persisted: it is a record of actions
 * taken in this app session, so a process restart starts it empty rather
 * than pretending the list survived one. `MAX_UNDONE_TURNS` bounds it.
 *
 * This module imports nothing at all, so its tests are plain data
 * assertions — the same shape `rewind-scopes.ts` documents.
 */
import type { rewind } from "@picompanion/frontend-core";

/** See `rewind-scopes.ts`'s identical alias. */
export type RewindMode = rewind.RewindMode;

export interface UndoneTurn {
  /** The daemon message id the rewind targeted — the id a return re-issues. */
  readonly messageId: string;
  /** A bounded, single-line excerpt of the message, for an identifiable list row. */
  readonly snippet: string;
  /** The scope that rewind used, which the list row shows. */
  readonly mode: RewindMode;
}

/** Longest snippet this module keeps, in characters (including the ellipsis). */
export const SNIPPET_MAX_CHARS = 80;

/** Newest-first cap; a long session cannot grow this list without bound. */
export const MAX_UNDONE_TURNS = 20;

/**
 * Collapses whitespace and bounds `text` to `max` characters, appending a
 * single-character ellipsis when it truncates. Never returns a multi-line
 * string, so a list row is always one line.
 */
export function snippetFor(text: string, max: number = SNIPPET_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, max - 1))}…`;
}

/** Builds the record entry for one successful rewind. */
export function buildUndoneTurn(
  target: { readonly messageId: string; readonly snippet: string },
  mode: RewindMode,
): UndoneTurn {
  return { messageId: target.messageId, snippet: target.snippet, mode };
}

/**
 * Prepends `turn`, newest-first, dropping any earlier entry for the same
 * `(messageId, mode)` pair (a repeated rewind is one list row, not two) and
 * capping the list at `MAX_UNDONE_TURNS`.
 */
export function addUndoneTurn(
  current: readonly UndoneTurn[],
  turn: UndoneTurn,
): readonly UndoneTurn[] {
  const withoutDuplicate = current.filter(
    (candidate) => !(candidate.messageId === turn.messageId && candidate.mode === turn.mode),
  );
  return [turn, ...withoutDuplicate].slice(0, MAX_UNDONE_TURNS);
}
