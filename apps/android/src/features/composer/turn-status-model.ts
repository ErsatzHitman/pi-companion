/**
 * Retry and compaction status for the Android compact composer (T39C,
 * plan.md §11.1's "compaction and summarization retry" group). RN-free,
 * like every other `-model.ts` in this workspace (`vitest` cannot render
 * anything that reaches `react-native`, the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times) —
 * `TurnStatusBanner.tsx` is the thin view that mirrors this controller's
 * `getState()` into `useState` after each event.
 *
 * ## Why this reads the raw stream directly, instead of going through
 * `frontend-core`'s shared timeline domain
 *
 * `packages/frontend-core`'s shared `timeline.TranscriptEntry` already
 * has a `"compaction"` member (`apps/web/src/features/transcript/compaction-row.tsx`
 * consumes it), but that file's own doc comment records — and this
 * module verified by reading it — that **retry has no home there at
 * all**: a live `pi_retry` `AgentStreamEvent` reaching
 * `packages/frontend-core/src/timeline/reducer.ts`'s `ingestAgentStreamMessage`
 * is silently dropped before it ever becomes a `TimelineRow`
 * (`reducer.ts`'s `ingestAgentStreamMessage` doc comment, "every other
 * `AgentStreamEvent` variant ... belongs to a different frontend-core
 * domain ... and is a no-op
 * here"). Closing that gap needs a `packages/frontend-core` change
 * neither `compaction-row.tsx`'s task nor this one owns (T39C's `Owns`
 * grant is `apps/android/src/features/composer/` only).
 *
 * Rather than build half a surface on top of a domain that drops retry
 * silently, this file reads BOTH signals directly off the same raw
 * `agent_stream` push every other live-data seam in this workspace
 * eventually bottoms out on (`DaemonClient.on("agent_stream", handler)`,
 * `packages/client/src/daemon-client.ts`) — independent of
 * `frontend-core`'s timeline reducer entirely, so it is not blocked by
 * the gap above and does not need it closed to be real. The two signals
 * it reads, both already real wire shapes today (no protocol change
 * needed):
 *
 *  - `{ type: "pi_retry", phase, attempt, maxAttempts, delayMs?, error?,
 *    turnId? }` — a top-level `AgentStreamEvent` variant
 *    (the `AgentStreamEvent` union's `"pi_retry"` member in
 *    `packages/protocol/src/agent-types.ts`).
 *  - `{ type: "timeline", item: { type: "compaction", status, trigger?,
 *    preTokens?, summary?, estimatedTokensAfter?, filesRead?,
 *    filesModified? } }` — the `timeline` variant wrapping a
 *    `CompactionTimelineItem` (`agent-types.ts`), the exact same payload
 *    `compaction-row.tsx` renders on web, just read here before it would
 *    reach any reducer. The last four fields are T143's: Pi's own
 *    compaction result, no longer discarded at the daemon boundary.
 *
 * `DaemonTurnStatusSource.on` below is named and shaped after the REAL
 * `DaemonClient.on<TType>(type, handler): () => void` overload in
 * `daemon-client.ts`, narrowed to the one literal `"agent_stream"`
 * this feature needs — same "match the real method so a real client
 * satisfies this structurally, no adapter" convention
 * `model-thinking-model.ts`'s `DaemonModelThinkingSource` and
 * `queue-mode-model.ts`'s `DaemonQueueModeSource` both use. It is
 * OPTIONAL, so an object implementing none of it (no connection yet, or
 * a test harness) still structurally satisfies this interface. **T132**
 * wires the real thing: `../app-shell/session-route-daemon-clients.ts`'s
 * `resolveTurnStatusClient` reads
 * `AppCore.connection.getActiveLifecycle()?.getDaemonClient()` (live
 * since T32A1B) and passes it as `Composer`'s `turnStatusClient` prop,
 * so the production route now reaches `"ready"` once a real daemon
 * connection is active.
 *
 * Unlike `queue-mode-model.ts`, there is no request/response round trip
 * here at all — this is a pure subscribe-and-reduce surface, so
 * `TurnStatusAvailability` has only three states (no `"loading"`/`"error"`
 * from a fetch that never happens): `"no-client"`, `"unsupported"` (the
 * client omits `on`), and `"ready"` (subscribed, whether or not any
 * event has arrived yet — `state.retry`/`state.compaction` start `null`
 * either way, which IS the correct "nothing in progress" rendering, not
 * an error).
 */

/** The `pi_retry` `AgentStreamEvent` variant, matched field-for-field (the `AgentStreamEvent` union's `"pi_retry"` member in `packages/protocol/src/agent-types.ts`). */
export interface TurnRetryEvent {
  readonly type: "pi_retry";
  readonly phase: "assistant" | "compaction" | "branchSummary";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs?: number;
  readonly error?: string;
  readonly turnId?: string;
}

/** The `CompactionTimelineItem` shape, matched field-for-field
 * (`packages/protocol/src/agent-types.ts`'s `CompactionTimelineItem`). T143
 * added `summary`, `estimatedTokensAfter`, `filesRead` and `filesModified` —
 * Pi's own compaction result, previously discarded at the daemon boundary
 * (`result?: unknown` on `compaction_end`); this module picks them up the
 * same way it already read `preTokens`. */
export interface TurnCompactionTimelineItem {
  readonly type: "compaction";
  readonly status: "loading" | "completed";
  readonly trigger?: "auto" | "manual";
  readonly preTokens?: number;
  readonly summary?: string;
  readonly estimatedTokensAfter?: number;
  readonly filesRead?: readonly string[];
  readonly filesModified?: readonly string[];
}

/** The `timeline` `AgentStreamEvent` variant, narrowed to a compaction item — every other timeline item kind is ignored by `applyTurnStreamEvent` below, matching `compaction-row.tsx`'s own scope. */
export interface TurnTimelineEvent {
  readonly type: "timeline";
  readonly item:
    | TurnCompactionTimelineItem
    | { readonly type: string; readonly [key: string]: unknown };
}

/**
 * Any real `AgentStreamEvent` is one of these three shapes from this
 * module's point of view: the two it reads, or an untyped catch-all for
 * every other real variant (`thread_started`, `turn_started`, ...),
 * which `applyTurnStreamEvent` below ignores rather than rejects.
 */
export type TurnStreamEvent =
  | TurnRetryEvent
  | TurnTimelineEvent
  | { readonly type: string; readonly [key: string]: unknown };

/** One `agent_stream` wire message's payload, narrowed to the fields this feature reads (`packages/protocol/src/messages.ts`'s `AgentStreamMessageSchema`). */
export interface TurnStreamMessage {
  readonly agentId: string;
  readonly event: TurnStreamEvent;
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * feature needs — see this module's doc comment.
 */
export interface DaemonTurnStatusSource {
  /** Matches `DaemonClient.on("agent_stream", handler)`, narrowed to this feature's one event type. */
  on?(type: "agent_stream", handler: (message: TurnStreamMessage) => void): () => void;
}

export type TurnStatusAvailability = "no-client" | "unsupported" | "ready";

export function describeTurnStatusUnavailable(
  availability: Exclude<TurnStatusAvailability, "ready">,
): string {
  if (availability === "no-client") {
    return "Connect to a daemon to see retry and compaction status.";
  }
  return "This connection can't report retry or compaction status.";
}

/** The most recent retry in progress for this agent, or `null` once none is (a `pi_retry` event carries no "finished" signal of its own — `clearRetry`/a new turn is what clears it; see the controller below). */
export interface TurnRetryStatus {
  readonly phase: "assistant" | "compaction" | "branchSummary";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs?: number;
  readonly error?: string;
  /**
   * Wall-clock time this `pi_retry` event was applied, stamped by
   * `applyTurnStreamEvent`'s injectable `now` clock (defaults to
   * `Date.now`, never read directly by this render-free module — see
   * that function below). `retryCountdownSecondsRemaining` measures
   * elapsed time from this field, not from when a view happens to
   * render.
   */
  readonly receivedAtMs: number;
}

/** The most recent compaction's own status for this agent, replaced (never merged) by the next `timeline`/compaction event. */
export interface TurnCompactionStatus {
  readonly status: "loading" | "completed";
  readonly trigger?: "auto" | "manual";
  readonly preTokens?: number;
  /** T143: Pi's own compaction summary, when the daemon has it. */
  readonly summary?: string;
  /** T143: Pi's own post-compaction token estimate. */
  readonly estimatedTokensAfter?: number;
  /** T143: paths Pi read while producing the summary, when the daemon has them. */
  readonly filesRead?: readonly string[];
  /** T143: paths whose content changed, when the daemon has them. */
  readonly filesModified?: readonly string[];
}

export interface TurnStatusState {
  readonly availability: TurnStatusAvailability;
  readonly unavailableReason: string | null;
  readonly retry: TurnRetryStatus | null;
  readonly compaction: TurnCompactionStatus | null;
}

export const INITIAL_TURN_STATUS_STATE: TurnStatusState = {
  availability: "no-client",
  unavailableReason: describeTurnStatusUnavailable("no-client"),
  retry: null,
  compaction: null,
};

/**
 * Whole seconds left before `retry` fires again, measured from `nowMs`
 * against `retry.receivedAtMs + retry.delayMs`, clamped so it never goes
 * negative. Returns `null` when there is no retry in progress, or when
 * the `pi_retry` event that produced it carried no `delayMs` at all —
 * that field is optional on the wire (the `AgentStreamEvent` union's
 * `"pi_retry"` member in `packages/protocol/src/agent-types.ts`), and
 * this function must never invent a countdown the daemon never sent.
 * Pure and render-free, like every other function in this module — a
 * caller re-derives this on each tick from the current time rather than
 * this module owning a timer of its own.
 */
export function retryCountdownSecondsRemaining(
  retry: TurnRetryStatus | null,
  nowMs: number,
): number | null {
  if (!retry || retry.delayMs === undefined) return null;
  const remainingMs = retry.receivedAtMs + retry.delayMs - nowMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * Plain-language sentence for the current retry status, or `null` when
 * nothing is retrying. `remainingSeconds` — normally the result of
 * `retryCountdownSecondsRemaining` above — is optional so every existing
 * single-argument call site keeps compiling unchanged; passing it only
 * changes the sentence when `retry.delayMs` was actually present on the
 * wire (never fabricated for a retry that carried none).
 *
 * **Deliberate spec deviation:** the confirmed Android design (frame
 * `s6`) also appends "(ctrl+c to cancel)" to the countdown line. That is
 * dropped here on purpose, not missed — there is no ctrl+c on a touch
 * device, and the same frame's own label above the block ("tap to retry
 * now") already says the real affordance is a tap, not a key chord.
 *
 * **A second deviation, in the opposite direction: the phase label is
 * kept for `compaction`/`branchSummary`, even though it is absent from
 * the countdown line this function's byte-for-byte match target came
 * from.** That target frame draws exactly one countdown, and it is an
 * `assistant` retry — the frame settles what an assistant countdown
 * reads like, and says nothing at all about what a compaction or
 * branch-summary countdown should read like, because the design never
 * drew either. Copying the frame's wording onto those two phases
 * regardless would make them indistinguishable from an assistant retry
 * on-screen, throwing away information this reducer already has
 * (`retry.phase`) and this function already surfaced for the
 * no-countdown case just below. So only the `assistant` branch matches
 * the frame verbatim; the other two keep their phase word, built from
 * the same `phaseLabel` the no-countdown branch already computes.
 *
 * **No "tap to retry now" action.** The spec's block also carries
 * `data-act="retry"`, an immediate-retry action. Checked, not assumed:
 * `grep -rniE "retry.*now|force.*retry|retryImmediate|triggerRetry"
 * packages/protocol/src packages/client/src` finds no request that forces
 * an immediate `pi_retry` — the daemon's retry loop runs on its own
 * schedule, and nothing in either package lets a caller cut a countdown
 * short. So this function renders the countdown only; wiring a tap
 * action would need a wire request that does not exist today, which is
 * out of this module's scope regardless.
 */
export function describeRetryStatus(
  retry: TurnRetryStatus | null,
  remainingSeconds?: number | null,
): string | null {
  if (!retry) return null;
  const phaseLabel =
    retry.phase === "compaction"
      ? "Compaction"
      : retry.phase === "branchSummary"
        ? "Summary"
        : "Response";
  let base: string;
  if (retry.delayMs !== undefined && remainingSeconds !== undefined && remainingSeconds !== null) {
    // "Response" is the no-countdown label; the countdown line for that
    // same phase reads "Retrying", matching the design's one drawn
    // frame verbatim. The other two phases keep `phaseLabel` — see this
    // function's own doc comment above for why.
    const countdownVerb = phaseLabel === "Response" ? "Retrying" : `${phaseLabel} retry`;
    base =
      remainingSeconds > 0
        ? `${countdownVerb} (${retry.attempt}/${retry.maxAttempts}) in ${remainingSeconds}s`
        : `${countdownVerb} (${retry.attempt}/${retry.maxAttempts}) now`;
  } else {
    base = `${phaseLabel} retry ${retry.attempt}/${retry.maxAttempts}`;
  }
  return retry.error ? `${base} — ${retry.error}` : `${base}…`;
}

function formatTokenCount(tokens: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(tokens)));
}

/** T143: "N files read, M files modified" note for a completed compaction,
 * or `""` when the daemon supplied neither list. */
function describeCompactionFiles(
  filesRead: readonly string[] | undefined,
  filesModified: readonly string[] | undefined,
): string {
  const readCount = filesRead?.length ?? 0;
  const modifiedCount = filesModified?.length ?? 0;
  if (readCount === 0 && modifiedCount === 0) return "";
  const parts: string[] = [];
  if (readCount > 0) parts.push(`${readCount} file${readCount === 1 ? "" : "s"} read`);
  if (modifiedCount > 0) {
    parts.push(`${modifiedCount} file${modifiedCount === 1 ? "" : "s"} modified`);
  }
  return ` (${parts.join(", ")})`;
}

/** Plain-language sentence for the current compaction status, or `null` when none is known. */
export function describeCompactionStatus(compaction: TurnCompactionStatus | null): string | null {
  if (!compaction) return null;
  const trigger =
    compaction.trigger === "manual" ? "Manual" : compaction.trigger === "auto" ? "Automatic" : null;
  const prefix = trigger ? `${trigger} compaction` : "Compaction";
  if (compaction.status === "loading") {
    return `${prefix} in progress — condensing earlier turns to free up context space.`;
  }
  const tokenNote =
    compaction.preTokens !== undefined
      ? ` The conversation was using about ${formatTokenCount(compaction.preTokens)} tokens beforehand.`
      : "";
  // T143: Pi's own summary and file-tracking details, when the daemon has
  // structured data for this compaction (previously discarded entirely —
  // `result?: unknown` on the daemon's `compaction_end` mirror).
  const summaryNote = compaction.summary ? ` Summary: ${compaction.summary}` : "";
  const filesNote = describeCompactionFiles(compaction.filesRead, compaction.filesModified);
  return `${prefix} completed — earlier turns were condensed to free up context space.${tokenNote}${summaryNote}${filesNote}`;
}

/**
 * Reduces one incoming `agent_stream` event onto `state`. A `pi_retry`
 * event replaces `state.retry` outright (the daemon never emits a
 * "retry finished" event of its own — Pi's own retry loop just stops
 * emitting them once it succeeds or gives up, mirrored exactly here: a
 * new turn starting is what should clear a stale retry, via
 * `clearRetryForNewTurn` below, not this reducer). A `timeline`
 * compaction item replaces `state.compaction` outright. Every other
 * event type is ignored, leaving `state` unchanged (referentially, so a
 * caller can cheaply skip re-rendering on an ignored event).
 *
 * `now` stamps a fresh `pi_retry`'s `receivedAtMs` — an injectable clock,
 * defaulting to `Date.now`, threaded the same way
 * `TurnStatusControllerDeps.clock` below threads it into the controller.
 * Existing callers that only ever passed `(state, event)` keep compiling
 * and keep using the real wall clock, unchanged.
 */
export function applyTurnStreamEvent(
  state: TurnStatusState,
  event: TurnStreamEvent,
  now: () => number = Date.now,
): TurnStatusState {
  if (event.type === "pi_retry") {
    const { phase, attempt, maxAttempts, delayMs, error } = event as TurnRetryEvent;
    return {
      ...state,
      retry: { phase, attempt, maxAttempts, delayMs, error, receivedAtMs: now() },
    };
  }
  if (event.type === "timeline") {
    const item = (event as TurnTimelineEvent).item;
    if (item.type === "compaction") {
      const compactionItem = item as TurnCompactionTimelineItem;
      return {
        ...state,
        compaction: {
          status: compactionItem.status,
          trigger: compactionItem.trigger,
          preTokens: compactionItem.preTokens,
          summary: compactionItem.summary,
          estimatedTokensAfter: compactionItem.estimatedTokensAfter,
          filesRead: compactionItem.filesRead,
          filesModified: compactionItem.filesModified,
        },
      };
    }
  }
  return state;
}

/** Clears a stale retry banner once a fresh turn starts (`turn_started`), so a retry from a previous turn never lingers forever. */
export function clearRetryForNewTurn(state: TurnStatusState): TurnStatusState {
  if (!state.retry) return state;
  return { ...state, retry: null };
}

export interface TurnStatusControllerDeps {
  agentId: string;
  client?: DaemonTurnStatusSource;
  /** Clock used to stamp a fresh `pi_retry`'s `receivedAtMs`, threaded into `applyTurnStreamEvent`. Defaults to `Date.now`; a test supplies a fake clock so `receivedAtMs` assertions are exact, not `expect.any(Number)`. */
  clock?: () => number;
}

export interface TurnStatusController {
  getState(): TurnStatusState;
  /**
   * Subscribes to this agent's live stream. Idempotent-ish: calling
   * again re-subscribes (the previous subscription's unsubscribe, if
   * any, is not called automatically — callers own their own lifecycle,
   * matching `onQueueUpdate`'s established convention in this
   * workspace). `onChange`, when given, is called synchronously after
   * every processed event (whether or not it actually changed `state`)
   * — this controller holds no React state of its own (same rationale
   * as `model-thinking-model.ts`'s controller), so a view driving
   * `useState` from `getState()` needs this hook to know a new render
   * is due; omitting it is fine for a caller that polls `getState()` on
   * its own schedule instead.
   */
  subscribe(onChange?: () => void): void;
  /** Stops the live subscription, if one is active. */
  unsubscribe(): void;
}

/**
 * Builds a `TurnStatusController`. One instance per composer/agent
 * surface — mirrors `createQueueModesController`'s shape: a plain
 * closure over mutable state, no React, driven entirely by its returned
 * methods.
 */
export function createTurnStatusController(deps: TurnStatusControllerDeps): TurnStatusController {
  const { agentId, client, clock = Date.now } = deps;

  let state: TurnStatusState = INITIAL_TURN_STATUS_STATE;
  let unsubscribeFn: (() => void) | null = null;

  function supports(): boolean {
    return typeof client?.on === "function";
  }

  function subscribe(onChange?: () => void): void {
    if (!client) {
      state = {
        ...INITIAL_TURN_STATUS_STATE,
        availability: "no-client",
        unavailableReason: describeTurnStatusUnavailable("no-client"),
      };
      return;
    }
    if (!supports()) {
      state = {
        ...INITIAL_TURN_STATUS_STATE,
        availability: "unsupported",
        unavailableReason: describeTurnStatusUnavailable("unsupported"),
      };
      return;
    }

    state = { ...state, availability: "ready", unavailableReason: null };
    unsubscribeFn = client.on!("agent_stream", (message: TurnStreamMessage) => {
      if (message.agentId !== agentId) return;
      if (message.event.type === "turn_started") {
        state = clearRetryForNewTurn(state);
        onChange?.();
        return;
      }
      state = applyTurnStreamEvent(state, message.event, clock);
      onChange?.();
    });
  }

  function unsubscribe(): void {
    unsubscribeFn?.();
    unsubscribeFn = null;
  }

  return {
    getState: () => state,
    subscribe,
    unsubscribe,
  };
}
