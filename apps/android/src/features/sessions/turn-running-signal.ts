/**
 * Turns the daemon's `pi_queue_update` (and the plain turn-boundary
 * events next to it on the wire) into a `turnRunning` boolean the
 * session route can read (T64; wave P5-W19).
 *
 * `app/h/[serverId]/session/[agentId]/index.tsx` used to hard-code
 * `turnRunning={false}` on `Composer` — that file's own doc comment
 * (T32S12, P5-W18) named the exact gap this task closes: "deriving it
 * from a real running-turn signal needs the `pi_queue_update` wire push
 * T63's report names as a still-open gap". T32S13 mounted this module
 * there later in the same wave (P5-W19): that route now renders
 * `turnRunning = submitting || signalRunning`, where `signalRunning`
 * is this module's `getRunning()` mirrored through `onChange`. This
 * module only produces the signal; it does not read
 * `useLocalSearchParams`, render anything, or touch `AppCore`.
 *
 * WIRE SHAPE (verified against `packages/protocol/src/messages.ts`,
 * not invented): every one of these arrives wrapped in one
 * `agent_stream` message —
 * `{ type: "agent_stream", payload: { agentId, event, timestamp, ... } }`
 * (`AgentStreamMessageSchema`) — with `payload.event.type` one of the
 * discriminated variants below. `pi_queue_update` itself carries only
 * `{ provider, steering: string[], followUp: string[], turnId? }`: a
 * read-only push of queued interjections, never a `{running: boolean}`
 * field (`turn-service.ts`'s doc comment already found this same gap
 * for `setMode` and named it there). So a `turnRunning` signal has to
 * be assembled from *this* event plus the plain turn-boundary events
 * next to it on the same discriminated union — `turn_started` (a new
 * turn began), and `turn_completed` / `turn_failed` / `turn_canceled`
 * (a turn ended, by three distinct named outcomes, never inferred from
 * a timeout). `pi_queue_update` only ever arrives while a turn is
 * in flight (steering/follow-up only make sense against a running
 * turn), so treating its arrival as a "still running" signal is
 * faithful to the protocol, not a guess — and it is the signal this
 * task's acceptance criteria name explicitly.
 *
 * RECONNECT SAFETY (the third acceptance criterion, and the one this
 * module's doc comment calls out as "where the bug will be"): a
 * `TurnRunningSignal` never carries `running` state across a dropped
 * and re-established connection.
 *   - A **fresh `TurnRunningSignal`** (a new `createTurnRunningSignal`
 *     call, e.g. after a route remount) always starts at `running:
 *     false`, regardless of what any prior instance last reported —
 *     state lives entirely on the instance, never module-level, so
 *     there is nothing to inherit.
 *   - A **long-lived instance carried across a reconnect** (the
 *     `connectionStatus` constructor option) resets to `running:
 *     false` on *every* connection-status transition it is told about
 *     — including the transition back to `"connected"` — before any
 *     replay traffic can arrive. A reconnect that then replays queue
 *     state (`pi_queue_update` arrives again) flips it back to `true`;
 *     a reconnect that replays nothing leaves it at the safe `false`
 *     default. This is deliberately conservative: per this task's
 *     brief, "a signal that latches running forever after a dropped
 *     socket is worse than no signal" — this module would rather
 *     under-report (briefly show not-running right after a reconnect
 *     that turns out to still be mid-turn) than over-report.
 *
 * Never logs. No handler here reads, logs, or otherwise surfaces
 * `steering`/`followUp` array contents, `error`, or `reason` text —
 * only the bare `event.type` and `payload.agentId` are inspected, and
 * neither is ever passed to `console.*` or any other sink.
 * `turn-running-signal.test.ts`'s "never logs" case spies on every
 * `console` method across every scenario in this file to prove that,
 * not merely by omission.
 *
 * T385: the signal also records WHEN the current turn started — the
 * wire event's own `timestamp`, so the Live screen's bar can tick a
 * real elapsed reading rather than a constant. It is cleared on exactly
 * the paths `running` becomes `false` (every end event and every
 * reconnect boundary), and the repeated `pi_queue_update`s that arrive
 * during one turn do not move it.
 */

/** The subset of `AgentStreamEventPayload` (protocol `messages.ts`) this module reacts to. */
export type TurnRunningStreamEvent =
  | { type: "turn_started"; provider: string; turnId?: string }
  | { type: "turn_completed"; provider: string; turnId?: string }
  | {
      type: "turn_failed";
      provider: string;
      turnId?: string;
      error: string;
      code?: string;
      diagnostic?: string;
    }
  | { type: "turn_canceled"; provider: string; turnId?: string; reason: string }
  | {
      type: "pi_queue_update";
      provider: string;
      steering: string[];
      followUp: string[];
      turnId?: string;
    }
  // Every other `AgentStreamEventPayload` variant (`timeline`,
  // `permission_requested`, `pi_status`, ...) is real traffic this
  // module simply has nothing to say about — matched here so a real
  // `agent_stream` message of any kind structurally satisfies this
  // type without this module needing to enumerate the rest of the
  // union it does not act on.
  | { type: string; [key: string]: unknown };

/**
 * The narrow `agent_stream` wire message shape this module reads.
 * `timestamp` is the daemon's own event time (`AgentStreamMessageSchema`
 * requires it, `packages/protocol/src/messages.ts`); it is optional here
 * so a caller that hands this module a synthetic message without one
 * still compiles, and the signal then falls back to its own clock
 * reading for the turn's start (T385).
 */
export interface AgentStreamTurnMessage {
  type: "agent_stream";
  payload: {
    agentId: string;
    event: TurnRunningStreamEvent;
    timestamp?: string;
  };
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * module needs: `on("agent_stream", handler)` is already public there
 * (declared on `DaemonClient` in `packages/client/src/daemon-client.ts`),
 * so a real `DaemonClient` satisfies this as-is — same narrow-adapter convention
 * `turn-service.ts`'s `DaemonTurnTransport` and `daemon-permissions-
 * client.ts`'s `DaemonPermissionsSource` already established.
 */
export interface DaemonTurnStreamSource {
  on(type: "agent_stream", handler: (message: AgentStreamTurnMessage) => void): () => void;
}

/**
 * The narrowest slice of connection-status reporting this module can
 * use to reset `running` across a reconnect. Matches
 * `DaemonClient.subscribeConnectionStatus`
 * (declared on `DaemonClient` in `packages/client/src/daemon-client.ts`)
 * structurally — a real
 * `DaemonClient` (or `AppCore.connection`, which re-exposes the same
 * shape — see `app-shell/core.ts`) satisfies this as-is. Optional: a
 * caller that only ever creates one `TurnRunningSignal` per
 * connection attempt (a fresh instance per mount) does not need it —
 * see this module's doc comment.
 */
export interface ConnectionStatusSource {
  subscribeConnectionStatus(listener: (status: { status: string }) => void): () => void;
}

const NOT_RUNNING_EVENT_TYPES = new Set(["turn_completed", "turn_failed", "turn_canceled"]);

/**
 * A message's own event time in epoch milliseconds, falling back to the
 * local clock only when the wire carried no parseable `timestamp` — a
 * wire event's time is the truth about when the turn started, not when
 * this process happened to read it (T385).
 */
function messageTimeMs(message: AgentStreamTurnMessage): number {
  const timestamp = message.payload.timestamp;
  if (timestamp !== undefined) {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

/** A live `turnRunning` signal for one `agentId`, and its disposer. */
export interface TurnRunningSignal {
  /** The current value. Never stale after `dispose()` — see this module's doc comment. */
  getRunning(): boolean;
  /**
   * When the current turn started, in epoch milliseconds — the wire
   * `timestamp` of the `turn_started` that began it, the mid-turn
   * `pi_queue_update` that first reported it (when a route mounted
   * after the turn had begun), or this signal's own `Date.now()` when
   * the wire carried no parseable timestamp (T385). `null` exactly when
   * `getRunning()` is `false`, and cleared on the same reconnect
   * boundary — so a caller can never count elapsed time for a turn that
   * is not running.
   */
  getStartedAtMs(): number | null;
  /** Stops listening. Idempotent; safe to call more than once. */
  dispose(): void;
}

/**
 * Builds a live `turnRunning` signal for `agentId` over `daemon`.
 * `onChange` fires only on an actual value transition (never twice in
 * a row with the same value, so a consumer wiring this into
 * `useState` never schedules a redundant render) — proven by
 * `turn-running-signal.test.ts`'s "does not re-fire onChange when the
 * value does not change" case.
 *
 * A `pi_queue_update` or `turn_started` for a *different* `agentId`
 * (this session route renders one agent at a time, but the underlying
 * `DaemonClient` is shared across every open session — see
 * `app-shell/core.ts`) is ignored outright: never inspected past
 * `payload.agentId`, never logged, never changes `running`.
 *
 * If `connectionStatus` is supplied, `running` resets to `false` on
 * every connection-status transition delivered through it — see this
 * module's doc comment's "RECONNECT SAFETY" section.
 */
export function createTurnRunningSignal(
  daemon: DaemonTurnStreamSource,
  agentId: string,
  onChange: (running: boolean) => void,
  connectionStatus?: ConnectionStatusSource,
): TurnRunningSignal {
  let running = false;
  let startedAtMs: number | null = null;
  let disposed = false;

  /**
   * `refreshStart` only ever matters when `next === running`: an
   * explicit `turn_started` for an already-running signal refreshes the
   * start, while the `pi_queue_update`s that arrive repeatedly during
   * one turn must NOT restart the elapsed clock. A real transition
   * always (re)sets it, and any transition to `false` clears it.
   */
  function setRunning(next: boolean, atMs: number | null, refreshStart: boolean): void {
    if (disposed) return;
    if (next === running) {
      if (next && refreshStart && atMs !== null) startedAtMs = atMs;
      return;
    }
    running = next;
    startedAtMs = next ? atMs : null;
    onChange(running);
  }

  const offStream = daemon.on("agent_stream", (message) => {
    if (disposed) return; // an update arriving after dispose() is a no-op, not a stale report
    if (message.payload.agentId !== agentId) return; // a different agent's turn never touches this signal
    const eventType = message.payload.event.type;
    if (eventType === "turn_started") {
      setRunning(true, messageTimeMs(message), true);
    } else if (eventType === "pi_queue_update") {
      // Only the arrival that flips this signal to running counts as a
      // start; the queue updates that follow it during the same turn
      // must leave the clock alone.
      setRunning(true, messageTimeMs(message), false);
    } else if (NOT_RUNNING_EVENT_TYPES.has(eventType)) {
      setRunning(false, null, false);
    }
    // Every other event.type (timeline, pi_status, ...) is left alone.
  });

  const offConnection = connectionStatus?.subscribeConnectionStatus(() => {
    // Every connection-status transition — including back to
    // "connected" — is a reconnect boundary: reset first, and let
    // whatever the daemon replays (or doesn't) re-establish the real
    // value. See this module's doc comment.
    setRunning(false, null, false);
  });

  return {
    getRunning: () => running,
    getStartedAtMs: () => startedAtMs,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offStream();
      offConnection?.();
    },
  };
}
