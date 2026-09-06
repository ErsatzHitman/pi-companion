/**
 * Recovers in-flight turns after the process is killed mid-turn (T37C,
 * plan.md §7.1/§7.2/§12.5 "restore correctly when the process is killed
 * mid-turn... no duplicate submission occurs on restore... the
 * recovered turn continues or fails explicitly").
 *
 * This module adds no new queue, no new cache, and no reimplementation
 * of idempotency bookkeeping. `@picompanion/frontend-core`'s
 * `composer.OutboxController` (T22) already persists every queued
 * submission under a *stable client submission id* — generated once, at
 * `enqueue` time, **before** any network attempt — through the same
 * injected `StructuredStorage` this task's `SqliteStructuredStorage`
 * (`./sqlite-structured-storage.ts`, T37A) backs. That is precisely
 * "a stable key that survives the kill, persisted before the send" —
 * this module only adds the cold-start reconciliation pass over it.
 *
 * ## The three windows a kill can land in, and how the outbox already
 * shapes them
 *
 * 1. **Before the daemon received the turn.** The entry was `enqueue`d
 *    (so its stable id exists and is persisted) but the process died
 *    before `markSending` was ever called, or died between `enqueue`
 *    and the network call actually leaving the device. Either way the
 *    entry is found in `pending` at cold start. `pending` is already
 *    the "safe to (re)send automatically" status
 *    (`OutboxController.getAutoResendCandidates`'s own contract) — no
 *    action is needed here, and none is taken. Outcome: **resumed**.
 *
 * 2. **After the daemon received the turn but before it acknowledged.**
 *    `markSending` was called (so the entry is `sending`) and the
 *    request may or may not have reached the daemon before the kill —
 *    from the outbox's point of view this is indistinguishable from a
 *    kill landing later in window 1's own send attempt, and this
 *    module treats both identically, conservatively: an entry found
 *    `sending` at cold start might already be running on the daemon,
 *    so it is **never** silently resent. Unless the caller asserts
 *    (via `isIdempotencyVerified`) that the daemon is known to treat a
 *    resend of this entry's id as idempotent, the entry is parked
 *    `awaiting-confirmation` with a readable reason — the exact same
 *    "only an explicit `confirmResend` moves this back to `pending`"
 *    guard `OutboxController.markFailed` already enforces for a failed
 *    send. Outcome: **awaiting-confirmation** (or **resumed** only
 *    when idempotency is verified).
 *
 * 3. **After acknowledgement but before the response was cached.** Once
 *    the daemon acknowledges, the caller calls `markSent`, which
 *    deletes the entry outright (`OutboxController.markSent`'s own
 *    contract — its job is done). `loadAll` never returns a `sent`
 *    entry, so there is nothing here for this module to recover or
 *    resend: the turn is already the daemon's problem, and the
 *    session's normal reconnect/catch-up path (`./timeline-cache.ts`,
 *    T37B) is what reconciles its eventual response. This window is
 *    provably safe *because* there is nothing left to act on —
 *    `turn-recovery.test.ts`'s window-3 case asserts exactly that
 *    (an empty recovery result, not a skipped assertion).
 *
 * ## No silent third outcome
 *
 * `recoverInFlightTurns` never returns an entry still in the ambiguous
 * `sending` state — every row it looks at ends the pass as one of
 * exactly two named outcomes, {@link RecoveredTurnOutcome}: `"resumed"`
 * (safe to auto-resend; the composer/session layer's normal
 * `getAutoResendCandidates` flow picks it up from here) or
 * `"awaiting-confirmation"` (an explicit, user-readable "we don't know
 * if this ran; confirm to retry" state — never a silent drop, never a
 * silent duplicate resend). `turn-recovery.test.ts` asserts this
 * directly by checking every recovered row's outcome against
 * {@link RECOVERED_TURN_OUTCOMES}, not only the happy path.
 *
 * Replaying `recoverInFlightTurns` twice in a row over the same
 * storage state (e.g. the app is killed again immediately after the
 * first recovery pass, before anything else touched the outbox) is a
 * no-op the second time: an entry already moved to `pending` or
 * `awaiting-confirmation` by the first pass is reported again with the
 * same outcome and status, without a second `markFailed` call or any
 * further storage write. `turn-recovery.test.ts` proves this by
 * asserting the entry is byte-identical after the second pass.
 *
 * ## What a mount site needs
 *
 * Nothing in this repository constructs an `OutboxController` over this
 * task's storage yet, and nothing calls `recoverInFlightTurns`.
 * `app-shell/core.ts` (T32S9's grant this wave) is where `AppCore`
 * should call `createTurnOutbox` once at cold start (over the same
 * `SqliteStructuredStorage` instance this file's own doc comment and
 * `./index.ts` describe constructing, once T60C's `expo-sqlite` install
 * lands) and run `recoverInFlightTurns` before any UI reads the outbox,
 * then hand `"resumed"` rows to the composer's normal resend path and
 * surface `"awaiting-confirmation"` rows exactly as it would surface
 * any other outbox entry in that status (see `outbox.ts`'s own doc
 * comment — this module invents no new UI-facing state beyond what
 * `OutboxEntryStatus` already carries).
 */
import { composer as coreComposer } from "@picompanion/frontend-core";
import type { Clock, StructuredStorage } from "@picompanion/frontend-core";

/** The two named outcomes a recovered row can land in — see this module's doc comment. */
export type RecoveredTurnOutcome = "resumed" | "awaiting-confirmation";

/** Exhaustive list of {@link RecoveredTurnOutcome} values, for a direct "no unnamed outcome" assertion in tests. */
export const RECOVERED_TURN_OUTCOMES: readonly RecoveredTurnOutcome[] = [
  "resumed",
  "awaiting-confirmation",
];

/** Reason recorded on an entry parked `awaiting-confirmation` by recovery, distinct from an ordinary send failure's error text. */
export const TURN_RECOVERY_REASON =
  "recovered after process death mid-turn; daemon receipt could not be confirmed";

/** One outbox row's outcome after a `recoverInFlightTurns` pass. */
export interface RecoveredTurn {
  /** The entry's stable client submission id — unchanged by recovery; see this module's doc comment on why identity must survive the kill. */
  id: string;
  sessionId: string;
  kind: coreComposer.OutboxEntryKind;
  outcome: RecoveredTurnOutcome;
  /** The entry's `OutboxEntryStatus` after recovery. Never `"sending"` — see "No silent third outcome" above. */
  status: coreComposer.OutboxEntryStatus;
}

export interface RecoverInFlightTurnsOptions {
  /** Restrict recovery to one session's entries. Defaults to every session in the outbox. */
  sessionId?: string;
  /**
   * Per-entry idempotency assertion, mirroring
   * `OutboxController.markFailed`'s own `idempotencyVerified` option.
   * Defaults to `() => false` — the safe, conservative default this
   * codebase uses everywhere else (see `outbox.ts`'s doc comment):
   * nothing in this repository has yet verified the daemon treats a
   * resend of a submission id as idempotent, so an entry found
   * `sending` at cold start is parked for explicit user confirmation
   * unless a caller positively asserts otherwise.
   */
  isIdempotencyVerified?: (entry: coreComposer.OutboxEntry) => boolean;
}

/** Constructs the `OutboxController` this module's functions expect, over the given storage/clock. */
export function createTurnOutbox(
  storage: StructuredStorage,
  clock: Clock,
): coreComposer.OutboxController {
  return new coreComposer.OutboxController(storage, clock);
}

/**
 * Reconciles every non-terminal outbox entry (optionally scoped to one
 * session) into a named recovery outcome. Call once, at cold start,
 * before any other code reads the outbox — see this module's doc
 * comment for the three windows a kill can land in and why each
 * status is handled the way it is.
 *
 * Never creates a new outbox entry (no duplicate submission is
 * possible from this call: it only transitions entries by their
 * existing stable id) and never mutates an entry already in `pending`
 * or `awaiting-confirmation` (both are already a named, previously-
 * settled outcome — re-processing them would not be idempotent-safe
 * bookkeeping, it would just be unnecessary writes).
 */
export async function recoverInFlightTurns(
  outbox: coreComposer.OutboxController,
  options?: RecoverInFlightTurnsOptions,
): Promise<RecoveredTurn[]> {
  const isIdempotencyVerified = options?.isIdempotencyVerified ?? (() => false);
  const entries = await outbox.loadAll(options?.sessionId);
  const recovered: RecoveredTurn[] = [];

  for (const entry of entries) {
    if (entry.status === "pending") {
      recovered.push({
        id: entry.id,
        sessionId: entry.sessionId,
        kind: entry.kind,
        outcome: "resumed",
        status: "pending",
      });
      continue;
    }

    if (entry.status === "awaiting-confirmation") {
      recovered.push({
        id: entry.id,
        sessionId: entry.sessionId,
        kind: entry.kind,
        outcome: "awaiting-confirmation",
        status: "awaiting-confirmation",
      });
      continue;
    }

    if (entry.status === "sending") {
      const verified = isIdempotencyVerified(entry);
      const updated = await outbox.markFailed(entry.id, TURN_RECOVERY_REASON, {
        idempotencyVerified: verified,
      });
      // markFailed only returns null when the entry no longer exists —
      // unreachable here since we just loaded it in this same pass, but
      // guarded rather than asserted with `!` for the same reason
      // ./timeline-cache.ts's confirmTimelineCatchUp guards its own
      // just-written read: a future refactor that races this call
      // against something else fails loudly instead of silently
      // dropping the entry from the recovery report.
      if (!updated) {
        throw new Error(
          `recoverInFlightTurns: outbox entry "${entry.id}" disappeared mid-recovery`,
        );
      }
      recovered.push({
        id: updated.id,
        sessionId: updated.sessionId,
        kind: updated.kind,
        outcome: updated.status === "pending" ? "resumed" : "awaiting-confirmation",
        status: updated.status,
      });
      continue;
    }

    // "sent" is terminal and `markSent` deletes the entry, so
    // `loadAll` never returns one — see window 3 in this module's doc
    // comment. Guarded rather than silently ignored so a future
    // `OutboxEntryStatus` addition cannot fall through this pass
    // unnoticed.
    throw new Error(
      `recoverInFlightTurns: outbox entry "${entry.id}" has unexpected status "${entry.status}"`,
    );
  }

  return recovered;
}
