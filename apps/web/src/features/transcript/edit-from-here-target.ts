/**
 * Derives frontend-core's `sessions.EditFromHereTarget` (T38A1b,
 * `packages/frontend-core/src/sessions/tree-edit-shortcut.ts`) from this
 * app's rendered `TranscriptEntry[]` (plan.md §11.1, T105).
 *
 * `tree-edit-shortcut.ts` never reads a timeline itself — its own module
 * doc: "a caller such as the composer ... already has one and supplies
 * the two references it needs directly". This is that caller-side
 * mapping for the web transcript.
 *
 * `previous` is the immediately preceding CORE MESSAGE entry (user or
 * assistant) in submission order, skipping every non-message row
 * (`thinking`, `tool-call`, `compaction`, ...) in between — a fork point
 * is a shared point in the *conversation*, not a shared point in
 * whatever else happened to interleave between two messages. `index` is
 * this entry's position among core message entries alone (not the full
 * renderable list, which can contain non-message rows this domain never
 * forks from); that is all `resolveEditFromHereForkPoint` needs — a
 * value that increases monotonically with conversation order, unique
 * per message.
 *
 * Pure and stateless: this file never touches React, DOM, or any
 * platform global.
 */
import type { timeline } from "@picompanion/frontend-core";
import { sessions as coreSessions } from "@picompanion/frontend-core";

import { isCoreMessageEntry } from "./message-row.js";
import type { CoreMessageEntry } from "./message-row.js";

/**
 * Every `"user-message"` entry's derived `EditFromHereTarget`, keyed by
 * entry id. An entry present here with `target.previous === null` is the
 * first message in the session — a target `resolveEditFromHereForkPoint`
 * still rejects (mirrors ompweb's `canNavigate` guard disabling the
 * affordance rather than letting a click fail, per `tree-edit-shortcut.ts`'s
 * module doc); an id absent from this map altogether is not a user
 * message at all (an assistant message, or not a message row).
 */
export type EditFromHereTargetIndex = ReadonlyMap<string, coreSessions.EditFromHereTarget>;

/**
 * Builds `EditFromHereTargetIndex` for every user message in `entries`,
 * in one linear pass.
 */
export function buildEditFromHereTargets(
  entries: readonly timeline.TranscriptEntry[],
): EditFromHereTargetIndex {
  const targets = new Map<string, coreSessions.EditFromHereTarget>();
  let previous: CoreMessageEntry | null = null;
  let index = 0;

  for (const entry of entries) {
    if (!isCoreMessageEntry(entry)) continue;

    if (entry.kind === "user-message") {
      targets.set(entry.id, {
        role: "user",
        id: entry.id,
        index,
        text: entry.text,
        previous: previous ? { id: previous.id, index: index - 1 } : null,
      });
    }

    previous = entry;
    index += 1;
  }

  return targets;
}

/**
 * `true` only when `messageId` names a user message with a valid
 * predecessor to fork from — the same gate a caller uses to enable or
 * disable the "Edit from here" affordance itself
 * (`message-row.tsx`'s `canEditFromHere` prop).
 */
export function canEditFromHere(targets: EditFromHereTargetIndex, messageId: string): boolean {
  return targets.get(messageId)?.previous != null;
}
