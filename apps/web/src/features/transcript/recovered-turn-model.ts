/**
 * Pure selection/formatting over a parked `"awaiting-confirmation"` outbox
 * entry (FIX-W6, following the wave that closed the composer's duplicate-send
 * hole).
 *
 * Mirrors `apps/android/src/features/transcript/recovered-turn-model.ts`'s
 * behaviour contract — same status is selected, the same two actions
 * (`confirmRecoveredTurn`/`discardRecoveredTurn`) call through to the exact
 * same `composer.OutboxController` (`@picompanion/frontend-core`) methods,
 * and neither reimplements `OutboxController`'s own duplicate-avoidance
 * guarantee (`confirmResend`'s doc comment: "the only path back from
 * awaiting-confirmation to pending"). Deliberately NOT byte-identical to
 * that file: web has no cold-start recovery pass (no `TurnOutboxOwner`
 * equivalent) — `apps/web/src/features/composer/use-composer.ts`'s own
 * `submit()` is the only place an entry ever reaches
 * `"awaiting-confirmation"` here, via a live, in-session `markFailed` call
 * with no verified idempotency. So this module selects directly off
 * `OutboxController.loadAll`'s own `OutboxEntry[]`, never a separate
 * `RecoveredTurn` summary type Android's cold-start reconciliation
 * produces.
 *
 * Kept free of React so it stays unit-testable under plain `vitest`, the
 * same reasoning Android's file gives for keeping this layer framework-free.
 */
import type { composer as coreComposer } from "@picompanion/frontend-core";

/** An `OutboxEntry` narrowed to the one status this module ever selects or describes. */
export interface AwaitingConfirmationEntry extends coreComposer.OutboxEntry {
  status: "awaiting-confirmation";
}

function isAwaitingConfirmation(
  entry: coreComposer.OutboxEntry,
): entry is AwaitingConfirmationEntry {
  return entry.status === "awaiting-confirmation";
}

/**
 * Every `"awaiting-confirmation"` entry belonging to `sessionId`, in the
 * order the source list reported them — never re-sorted, never grouped.
 *
 * `null` input yields an empty array, never a thrown error, matching
 * Android's `selectRecoveredTurnsForSession`: "nothing parked yet" and "not
 * loaded yet" render identically, both as nothing.
 */
export function selectRecoveredTurnsForSession(
  entries: readonly coreComposer.OutboxEntry[] | null,
  sessionId: string,
): AwaitingConfirmationEntry[] {
  if (!entries) {
    return [];
  }
  return entries.filter(
    (entry): entry is AwaitingConfirmationEntry =>
      entry.sessionId === sessionId && isAwaitingConfirmation(entry),
  );
}

/**
 * The one full sentence a `Banner` renders for a parked, unconfirmed send —
 * never a bare status word or an internal id, matching this repository's
 * "a full sentence, never a colour-only cue" convention (see
 * `./OfflineTranscriptBanner.tsx`'s identical rule for the staleness
 * banner this mounts alongside).
 */
export function describeRecoveredTurn(_entry: AwaitingConfirmationEntry): string {
  return "A message could not be confirmed as sent. " + "It has not been resent automatically.";
}

/**
 * The narrow slice of `composer.OutboxController`
 * (`@picompanion/frontend-core`) `confirmRecoveredTurn`/
 * `discardRecoveredTurn` need. A real `OutboxController` instance satisfies
 * this unchanged — nothing here reimplements either method's behaviour, it
 * only calls through.
 */
export interface RecoveredTurnOutbox {
  confirmResend(id: string): Promise<coreComposer.OutboxEntry | null>;
  remove(id: string): Promise<void>;
}

/**
 * The banner's "Resend" action — the *only* path `outbox.ts` exposes back
 * from `awaiting-confirmation` to `pending` (`confirmResend`'s own
 * contract, `packages/frontend-core/src/composer/outbox.ts`). This flips the
 * SAME entry's status in place; it never enqueues a new one and never mints
 * a new `clientMessageId`, so the daemon's clientMessageId dedupe still sees
 * one logical submission — never a second user row for the same message.
 *
 * Returns whether the entry really was awaiting confirmation —
 * `confirmResend` no-ops (returns `null`) for any other status, so a
 * stale/duplicate click can never resurrect an entry that already moved on.
 */
export async function confirmRecoveredTurn(
  outbox: RecoveredTurnOutbox,
  turn: AwaitingConfirmationEntry,
): Promise<boolean> {
  const result = await outbox.confirmResend(turn.id);
  return result !== null;
}

/**
 * The banner's "Discard" action — removes the entry outright via
 * `outbox.remove`. Never resends; this is the "give up on this one"
 * counterpart to `confirmRecoveredTurn` above.
 */
export async function discardRecoveredTurn(
  outbox: RecoveredTurnOutbox,
  turn: AwaitingConfirmationEntry,
): Promise<void> {
  await outbox.remove(turn.id);
}
