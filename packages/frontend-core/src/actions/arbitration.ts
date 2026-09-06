/**
 * Single-answer arbitration for daemon-mediated approvals and dialogs
 * (plan.md §12.3; T47A1a).
 *
 * Web and Android can both be live on the same session at once. Both
 * observe the same `AgentPermissionRequest` (plan.md §11.2 — this wire
 * shape already covers both "real" tool/plan/mode permission requests and
 * the four Tier-1 extension dialog kinds, so "approvals and dialogs" is one
 * request shape, not two — see `../permissions/types.ts`'s module doc), and
 * either one may answer it. The daemon accepts exactly one answer and
 * broadcasts the authoritative resolution to every connected client
 * (`agent_permission_resolved`). plan.md §12.3 requires that the *losing*
 * client's local answer resolve as a real, observable state — "superseded"
 * — never as an error and never silently:
 *
 * > A second answer resolves as superseded — not as an error, and never
 * > silently — carrying the outcome and, where the daemon supplies it,
 * > which client answered. The losing client closes with a readable
 * > explanation rather than having the dialog vanish.
 *
 * This module defines that outcome and the small state machine that
 * produces it. It does not own a transport, a timer, or a wire schema: a
 * caller (T21A's `PermissionsController` today; T47A2's web dialog
 * rendering next) feeds it two kinds of local fact —
 *
 * - `submitLocalAnswer` — this client's own optimistic answer, the instant
 *   the user responds, before the daemon confirms anything;
 * - `applyResolution` — the daemon's authoritative resolution, which always
 *   wins (plan.md §7.2) and is terminal.
 *
 * **T47A1b's regression guard (a test, not a change to this file's
 * behavior).** A prompt submitted while another client's turn is running
 * is *not* one of the "two kinds of local fact" above — it is this
 * client's own new message, and it keeps following the existing
 * steer-or-queue rule: `OutboxEntryKind` in `../composer/outbox.ts` queues
 * a prompt/steer/follow-up as its own independent submission under a
 * stable id, and server-side, the already-active-turn branch of
 * `packages/server/src/server/agent/providers/pi/agent.ts`'s `startTurn`
 * reads the per-message `options?.streamingBehavior` and calls
 * `runtimeSession.steer()`/`.followUp()` (T107). That rule never answers
 * one `requestId` exactly once across clients the way this module does —
 * every client's own prompt/steer/follow-up independently reaches the
 * daemon — so it must never be modeled as an `ArbitrationOutcome`. This
 * module's test file asserts `RequestArbitrator`'s public surface stays
 * limited to the answer/resolve methods below; a method that enqueued a
 * brand-new client-initiated submission would be exactly the second path
 * T47A1b's checkbox forbids.
 *
 * — and reads back one `ArbitrationOutcome` per `requestId` that is always
 * one of exactly five literal `status` values, so "the request was
 * answered by someone else" can never be confused with "the request
 * failed" (there is no `"error"` status here at all — a denial is a normal
 * `response` value, not an arbitration failure) or with "nothing has
 * happened yet" (`"pending"`, distinct from every settled status).
 *
 * ## Attribution on the wire
 *
 * plan.md §12.3 says the superseded outcome carries who answered "where the
 * daemon supplies it". **It does, for permissions, as of T111**
 * (`8129dfc`/`67d96ac`/`328a43d`, P6-W7): `agent_permission_resolved`'s
 * payload carries an optional `answeredBy` alongside
 * `{ agentId, requestId, resolution }`, threaded from the answering
 * connection's own `clientId` through the real arbitrator. So `won()`'s
 * exact path is reachable in production, and the best-effort comparison
 * documented on `won()` below is now the FALLBACK — for pre-T111 daemons
 * and for unattributed auto-resolutions (e.g. the auto-deny path, which
 * correctly supplies no `answeredBy`) — rather than the normal case.
 *
 * CORRECTED (P6-W7 merge gate): this section previously said
 * `agent_permission_resolved` had "no client identity field" and that the
 * exact path would arrive "the day a protocol task adds" one. T111 was
 * that task, in the wave this correction closes.
 *
 * `pi.ui.action.response`/`pi_ui_action_result` close the other half as of
 * T128: both wire messages now carry the same optional `answeredBy` shape
 * as `agent_permission_resolved`, reusing `PermissionAnsweredBySchema`
 * verbatim rather than inventing a parallel type (`AnsweredBy` below
 * mirrors it field-for-field). `pi.ui.action.response`'s one real
 * production site — `session.ts`'s `dispatchPiUiMessage` — always
 * populates it with the answering connection's own `clientId`, the same
 * self-attribution pattern T111 established for permissions.
 * `pi_ui_action_result` has the wire schema and a generic `agent_stream`
 * pass-through that preserves whatever `answeredBy` it is given, but no
 * production emitter in this codebase constructs one carrying it yet — so
 * that half of the gap is closed at the protocol layer and open only in
 * the sense that nothing yet exercises it in production. `AnsweredBy` and
 * `applyResolution`'s `resolution.answeredBy` remain optional regardless,
 * since an auto-resolution can still legitimately omit it.
 *
 * Neither Pi UI action message is consumed by `RequestArbitrator` (this
 * file's own class) — Pi UI action dispatch/settlement is tracked by
 * `../extensions/action-controller.ts`'s `ExtensionActionController`
 * instead, a separate, single-client-scoped mechanism (T21C) with no
 * win/lose arbitration semantics of its own: every dispatch reaches the
 * daemon independently, so a Pi UI action result's `answeredBy` may
 * legitimately name a *different* connection than the one asking, without
 * that ever being modeled as this class's `"superseded"` outcome. See that
 * file's `SettledExtensionAction.answeredBy` for the Pi UI action
 * rendering path.
 */

import type { Clock } from "../platform/clock.js";

/**
 * Identifies which client produced an authoritative resolution, when the
 * daemon supplies it. Permissions carry it since T111; `pi.ui.action.response`
 * and `pi_ui_action_result` carry the same shape since T128 — though only
 * `pi.ui.action.response` has a production emitter that actually populates
 * it today (see the module doc's "Attribution on the wire" section above)
 * — and auto-resolutions legitimately omit it regardless. So every field
 * here is optional and callers must not assume either is present.
 */
export interface AnsweredBy {
  /** The daemon/connection-domain client id (e.g. `clid_...`), if known. */
  readonly clientId?: string;
  /** A human-readable label for the answering client (e.g. "Android"), if known. */
  readonly label?: string;
}

/**
 * This client's current view of one arbitrated request. Exactly one of
 * these five literal `status` values at a time — never an `Error`, never
 * `undefined`/`null` in place of a value, and `"pending"` (nothing has
 * happened) is a distinct status from every settled one, so silence can
 * never be read as an answer.
 */
export type ArbitrationOutcome<TAnswer> =
  | { readonly status: "pending" }
  | {
      readonly status: "answered-locally";
      readonly localResponse: TAnswer;
      readonly answeredAt: number;
    }
  | {
      readonly status: "confirmed";
      readonly response: TAnswer;
      readonly answeredBy: AnsweredBy | undefined;
      readonly resolvedAt: number;
    }
  | {
      readonly status: "superseded";
      readonly localResponse: TAnswer;
      readonly response: TAnswer;
      readonly answeredBy: AnsweredBy | undefined;
      readonly resolvedAt: number;
    }
  | {
      readonly status: "resolved-elsewhere";
      readonly response: TAnswer;
      readonly answeredBy: AnsweredBy | undefined;
      readonly resolvedAt: number;
    };

/** Every possible `ArbitrationOutcome["status"]` value, for exhaustiveness checks. */
export type ArbitrationStatus = ArbitrationOutcome<unknown>["status"];

/** The daemon's authoritative resolution for one request, as fed to `applyResolution`. */
export interface AuthoritativeResolution<TAnswer> {
  readonly response: TAnswer;
  /** Present only once the wire gap noted in the module doc above is closed. */
  readonly answeredBy?: AnsweredBy;
}

export type ArbitrationListener<TAnswer> = (
  requestId: string,
  outcome: ArbitrationOutcome<TAnswer>,
) => void;

export interface RequestArbitratorOptions<TAnswer> {
  readonly clock: Clock;
  /**
   * This client's own connection-domain client id, compared against a
   * resolution's `answeredBy.clientId` (when both are present) to decide
   * `"confirmed"` vs `"superseded"` without ambiguity. Omit when the host
   * does not yet know its own client id; `won()` falls back to the
   * documented best-effort comparison in that case too.
   */
  readonly selfClientId?: string;
  /**
   * Overrides the default structural-equality fallback `won()` uses when a
   * resolution carries no `answeredBy` (or `selfClientId` above is unset).
   * Mainly for tests that want an exact comparator for a non-JSON-shaped
   * `TAnswer`.
   */
  readonly answersEqual?: (a: TAnswer, b: TAnswer) => boolean;
}

interface ArbitrationEntry<TAnswer> {
  outcome: ArbitrationOutcome<TAnswer>;
  /** Once true, `applyResolution` never overwrites this entry again. */
  terminal: boolean;
}

/**
 * Deep, order-independent structural equality over plain JSON-shaped
 * values (objects/arrays/primitives — exactly the shape of
 * `AgentPermissionResponse` and `PiUiActionResult`). A key present with
 * value `undefined` is treated as absent, matching how those wire types
 * use optional fields. This is only ever the *fallback* comparator `won()`
 * reaches for when no `answeredBy` identity is available — see the module
 * doc's "known, documented limitation" note on `won()` below.
 */
function defaultAnswersEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => defaultAnswersEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord)
    .filter((key) => aRecord[key] !== undefined)
    .sort();
  const bKeys = Object.keys(bRecord)
    .filter((key) => bRecord[key] !== undefined)
    .sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key, index) => key === bKeys[index] && defaultAnswersEqual(aRecord[key], bRecord[key]),
  );
}

/**
 * Tracks, per `requestId`, whether this client's own answer to an approval
 * or dialog request was the one the daemon accepted. One instance
 * represents one connected client's view; the two-client fixture in this
 * module's test constructs two instances (one per simulated client) fed
 * the same broadcast resolution, and asserts both land on a consistent
 * final `response` while their own `status` correctly differs
 * (`"confirmed"` for the winner, `"superseded"` for the loser).
 */
export class RequestArbitrator<TAnswer> {
  private readonly clock: Clock;
  private readonly selfClientId: string | undefined;
  private readonly answersEqual: (a: TAnswer, b: TAnswer) => boolean;
  private readonly entries = new Map<string, ArbitrationEntry<TAnswer>>();
  private readonly listeners = new Set<ArbitrationListener<TAnswer>>();
  private disposed = false;

  constructor(options: RequestArbitratorOptions<TAnswer>) {
    this.clock = options.clock;
    this.selfClientId = options.selfClientId;
    this.answersEqual =
      options.answersEqual ?? (defaultAnswersEqual as (a: TAnswer, b: TAnswer) => boolean);
  }

  subscribe(listener: ArbitrationListener<TAnswer>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** This client's current view of `requestId`. `"pending"` for anything never seen. */
  getOutcome(requestId: string): ArbitrationOutcome<TAnswer> {
    return this.entries.get(requestId)?.outcome ?? { status: "pending" };
  }

  /** True only once `applyResolution` has settled `requestId` (either terminal outcome or not). */
  isTerminal(requestId: string): boolean {
    return this.entries.get(requestId)?.terminal ?? false;
  }

  /** Convenience: true exactly when the current outcome is `"superseded"`. */
  isSuperseded(requestId: string): boolean {
    return this.getOutcome(requestId).status === "superseded";
  }

  /**
   * Registers `requestId` as known/pending if this arbitrator has not seen
   * it yet. Idempotent — mirrors the "duplicate events never produce
   * duplicate rows" invariant (plan.md §7.4) applied to request bookkeeping.
   */
  open(requestId: string): void {
    if (!this.entries.has(requestId)) {
      this.setEntry(requestId, { status: "pending" }, false);
    }
  }

  /**
   * Records this client's own optimistic answer to `requestId`. A no-op
   * that returns the existing (terminal) outcome unchanged once
   * `applyResolution` has already settled the request — a late local
   * answer must never un-terminate a request the daemon has already
   * resolved, and must never silently vanish either, which is why the
   * unchanged terminal outcome is returned rather than `void`.
   */
  submitLocalAnswer(requestId: string, response: TAnswer): ArbitrationOutcome<TAnswer> {
    const existing = this.entries.get(requestId);
    if (existing?.terminal) {
      return existing.outcome;
    }
    const outcome: ArbitrationOutcome<TAnswer> = {
      status: "answered-locally",
      localResponse: response,
      answeredAt: this.clock.now(),
    };
    this.setEntry(requestId, outcome, false);
    return outcome;
  }

  /**
   * Applies the daemon's authoritative resolution for `requestId`. Always
   * wins over any local state (plan.md §7.2) and is terminal: once a
   * request has an outcome from this method, a further call — including an
   * exact duplicate delivery of the same resolution — is ignored and
   * returns the original outcome unchanged, rather than silently
   * re-deciding a request a renderer may have already shown the user a
   * final state for.
   *
   * - No local answer was ever submitted here -> `"resolved-elsewhere"`.
   * - A local answer was submitted and it won (per `won()` below) ->
   *   `"confirmed"`.
   * - A local answer was submitted and it lost -> `"superseded"`, carrying
   *   both the losing `localResponse` and the winning `response`, plus
   *   `answeredBy` whenever the caller supplied it.
   */
  applyResolution(
    requestId: string,
    resolution: AuthoritativeResolution<TAnswer>,
  ): ArbitrationOutcome<TAnswer> {
    const existing = this.entries.get(requestId);
    if (existing?.terminal) {
      return existing.outcome;
    }

    const resolvedAt = this.clock.now();
    const localAnswer =
      existing?.outcome.status === "answered-locally" ? existing.outcome : undefined;

    let outcome: ArbitrationOutcome<TAnswer>;
    if (!localAnswer) {
      outcome = {
        status: "resolved-elsewhere",
        response: resolution.response,
        answeredBy: resolution.answeredBy,
        resolvedAt,
      };
    } else if (this.won(localAnswer.localResponse, resolution)) {
      outcome = {
        status: "confirmed",
        response: resolution.response,
        answeredBy: resolution.answeredBy,
        resolvedAt,
      };
    } else {
      outcome = {
        status: "superseded",
        localResponse: localAnswer.localResponse,
        response: resolution.response,
        answeredBy: resolution.answeredBy,
        resolvedAt,
      };
    }

    this.setEntry(requestId, outcome, true);
    return outcome;
  }

  /**
   * Decides whether `localResponse` (this client's own submitted answer)
   * is the one `resolution` reflects.
   *
   * Exact when the daemon supplies `answeredBy.clientId` and this
   * arbitrator was constructed with its own `selfClientId`: a plain id
   * comparison, correct regardless of what either client answered.
   *
   * Best-effort otherwise (see the module doc's wire-gap note): falls back
   * to comparing `localResponse` against `resolution.response` for
   * structural equality. This is a **known, documented limitation** — two
   * different clients that happen to submit an identical answer are
   * indistinguishable, under this fallback, from this client having won.
   * It never produces a false `"superseded"` (a losing client whose answer
   * differs from the resolution is always caught), only a possible false
   * `"confirmed"` when both clients agreed, which is the safer direction
   * to be wrong in: the user is never shown a spurious "someone else
   * answered" for an outcome that matches what they themselves chose.
   */
  private won(localResponse: TAnswer, resolution: AuthoritativeResolution<TAnswer>): boolean {
    if (resolution.answeredBy?.clientId !== undefined && this.selfClientId !== undefined) {
      return resolution.answeredBy.clientId === this.selfClientId;
    }
    return this.answersEqual(localResponse, resolution.response);
  }

  private setEntry(
    requestId: string,
    outcome: ArbitrationOutcome<TAnswer>,
    terminal: boolean,
  ): void {
    this.entries.set(requestId, { outcome, terminal });
    if (!this.disposed) {
      for (const listener of this.listeners) listener(requestId, outcome);
    }
  }

  /** Clears every tracked entry and subscriber. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entries.clear();
    this.listeners.clear();
  }
}
