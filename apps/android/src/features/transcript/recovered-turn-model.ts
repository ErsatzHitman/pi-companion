/**
 * Pure selection/formatting over T76's `TurnOutboxOwner.getRecoveredTurns()`
 * — surfaced in the transcript by T95 (docs/issues-from-plan.md "T95 —
 * Surface a recovered awaiting-confirmation turn in the transcript").
 *
 * `../../platform/offline/turn-recovery.ts`'s own doc comment named this
 * exact gap: a turn recovered `"awaiting-confirmation"` after a
 * simulated process death is a real value with a real getter
 * (`AppCore.turnOutbox.getRecoveredTurns()`, `../../app-shell/core.ts`),
 * but nothing in this repository ever read it. This module is the pure
 * "which rows, said how" half of closing that; `./recovered-turn-
 * banner.tsx` is the thin native view over it, and
 * `../../app/h/[serverId]/session/[agentId]/index.tsx`'s
 * `SessionTranscript` is the one production mount site.
 *
 * Kept free of any React/React Native import (this repository's frontend
 * rule; see `./thinking-row-model.ts`'s doc comment for the identical
 * reasoning) so it is unit-testable under this workspace's plain
 * `vitest` setup — including against the real, unmocked
 * `TurnOutboxOwner`/`recoverInFlightTurns` pipeline
 * (`./recovered-turn-model.test.ts`'s second suite), never only a
 * hand-rolled `RecoveredTurn` fixture standing in for a real recovery
 * pass.
 *
 * Deliberately narrow: this module only selects and describes
 * `"awaiting-confirmation"` rows. A `"resumed"` row is never rendered
 * here — `app-shell/core.ts`'s `resumePendingTurnOutboxEntries` already
 * auto-resends it before any screen would have a chance to show it, and
 * `turn-recovery.ts`'s own doc comment names silent auto-resend of the
 * *other* outcome as the one behaviour plan.md §7.2 forbids; this module
 * does not touch that boundary.
 *
 * **T106**: `confirmRecoveredTurn`/`discardRecoveredTurn` below close the
 * "display-only, no action reaches `OutboxController`" gap T95 disclosed
 * in its own report. Both take a `RecoveredTurnOutbox` — the narrow
 * `confirmResend`/`remove` slice of `composer.OutboxController`
 * (`@picompanion/frontend-core`) — so a real `OutboxController` instance
 * satisfies it unchanged (structural typing, no adapter needed) and a
 * plain counting fake can stand in for it in a test, per this
 * repository's "no fake pretending to be it" rule wherever the real
 * thing is reachable. `./recovered-turn-banner.tsx` is the one caller;
 * see its own doc comment for the view-layer wiring — **T121** wired the
 * one production mount (`../../app/h/[serverId]/session/[agentId]/
 * index.tsx`) to pass the real, shared `OutboxController` from
 * `AppCore.turnOutbox.getOutbox()` here, closing the separate wiring gap
 * this module's own doc comment used to disclose. That instance is backed
 * by a real `expo-sqlite` file since T390 on a device with the native
 * `ExpoSQLite` module present, so a recovered row can be displayed and
 * acted on there.)
 */
import { composer as coreComposer } from "@picompanion/frontend-core";

import type { RecoveredTurn } from "../../platform/offline";

/** A `RecoveredTurn` narrowed to the one outcome this module ever selects or describes. */
export interface AwaitingConfirmationTurn extends RecoveredTurn {
  outcome: "awaiting-confirmation";
}

function isAwaitingConfirmation(turn: RecoveredTurn): turn is AwaitingConfirmationTurn {
  return turn.outcome === "awaiting-confirmation";
}

/**
 * Every `"awaiting-confirmation"` row belonging to `sessionId`, in the
 * order `TurnOutboxOwner.getRecoveredTurns()` reported them — never
 * re-sorted, never grouped.
 *
 * `null` input (every `TurnOutboxOwnerStatus` but `"ready"` — see that
 * getter's own doc comment, including a `"degraded"` owner on a build
 * with no native `ExpoSQLite` module) yields an
 * empty array, never a thrown error: "nothing recovered yet" and
 * "recovery ran and found nothing" render identically, both as nothing.
 */
export function selectRecoveredTurnsForSession(
  recoveredTurns: readonly RecoveredTurn[] | null,
  sessionId: string,
): AwaitingConfirmationTurn[] {
  if (!recoveredTurns) {
    return [];
  }
  return recoveredTurns.filter(
    (turn): turn is AwaitingConfirmationTurn =>
      turn.sessionId === sessionId && isAwaitingConfirmation(turn),
  );
}

/**
 * The one full sentence a `Banner` renders for a recovered, unconfirmed
 * turn — never a bare status word or an internal id, matching this
 * repository's "a full sentence, never a colour-only cue" convention
 * (`../../platform/offline/stale-announcement.ts`'s identical rule for
 * staleness banners). Takes the turn (rather than being a bare constant)
 * so a later task can vary the sentence by `kind` without widening this
 * function's signature.
 */
export function describeRecoveredTurn(_turn: AwaitingConfirmationTurn): string {
  return (
    "A message from before the app closed could not be confirmed as sent. " +
    "It has not been resent automatically."
  );
}

/**
 * The narrow slice of `composer.OutboxController`
 * (`@picompanion/frontend-core`) `confirmRecoveredTurn`/
 * `discardRecoveredTurn` need. A real `OutboxController` instance
 * satisfies this unchanged — nothing here reimplements either method's
 * behaviour, it only calls through.
 */
export interface RecoveredTurnOutbox {
  confirmResend(id: string): Promise<coreComposer.OutboxEntry | null>;
  remove(id: string): Promise<void>;
}

/**
 * The banner's "Resend" action — the *only* path `outbox.ts` exposes
 * back from `awaiting-confirmation` to `pending` (`confirmResend`'s own
 * contract). This IS the user's explicit confirmation plan.md §12.5
 * requires before an uncertain send is retried automatically; nothing
 * else in this call chain resends anything on its own.
 *
 * Returns whether the entry really was awaiting confirmation —
 * `confirmResend` no-ops (returns `null`) for any other status, so a
 * stale/duplicate tap can never resurrect an entry that already moved
 * on.
 */
export async function confirmRecoveredTurn(
  outbox: RecoveredTurnOutbox,
  turn: AwaitingConfirmationTurn,
): Promise<boolean> {
  const result = await outbox.confirmResend(turn.id);
  return result !== null;
}

/**
 * The banner's "Discard" action — removes the entry outright via
 * `outbox.remove`, the same call `Composer.tsx`'s own `handleRetry`
 * uses to drop an orphaned entry (`composer/Composer.tsx`'s
 * `handleRetry` doc comment). Never resends; this is the "give up on
 * this one" counterpart to `confirmRecoveredTurn` above.
 */
export async function discardRecoveredTurn(
  outbox: RecoveredTurnOutbox,
  turn: AwaitingConfirmationTurn,
): Promise<void> {
  await outbox.remove(turn.id);
}
