/**
 * The session screen's own live activity — what the S7 app bar's pill
 * announces (this task; plan.md §9.2).
 *
 * The redesign's pill cycles `Idle` → `Thinking` → `Working` → `Needs
 * you`, and every one of those is a fact about the SESSION, not about
 * the socket. `header-model.ts` used to derive its pill from the
 * connection alone (`TranscriptStatus`), which made `streaming`
 * unreachable in production and left a pending approval with no pill
 * state at all. This module derives the missing fact from the wire and
 * hands it to that model as one closed value.
 *
 * WIRE SHAPE (verified against `packages/protocol/src/agent-types.ts`
 * and the Pi provider in `packages/server/src/server/agent/providers/
 * pi/agent.ts`, not invented): every one of these arrives inside one
 * `agent_stream` message, with `payload.event.type` naming it —
 *
 * - `turn_started` / `pi_queue_update` — a turn is in flight;
 *   `turn_completed` / `turn_failed` / `turn_canceled` end it (the same
 *   turn-boundary set `features/sessions/turn-running-signal.ts`
 *   already reads, kept separate here because the pill needs more than
 *   the boolean: a running turn may be thinking or working).
 * - `timeline` with `item.type === "tool_call"` — the call's `callId`
 *   joins the running set on `status: "running"` and leaves it on
 *   `completed`/`failed`/`canceled`. Two tool calls can overlap, so
 *   this is a set and not one id.
 * - `permission_requested` / `permission_resolved` — the daemon's own
 *   request/resolution pair (`AgentPermissionRequest`'s `requestId` is
 *   the key). A request that is still pending is exactly the artifact's
 *   "Needs you": the turn cannot proceed until the user answers.
 *
 * PRIORITY, highest first: a pending approval (the turn is BLOCKED on
 * the user), then a running tool call (the session is doing something
 * visible), then a running turn with no tool in flight (the model is
 * thinking), then idle. That order is the whole product decision and it
 * is one pure function, `deriveSessionActivity`, tested by execution.
 *
 * RECONNECT SAFETY, the same rule `turn-running-signal.ts` documents: a
 * fresh instance starts `idle` with nothing remembered, and a long-lived
 * instance resets on every connection-status transition — including
 * back to `"connected"` — before whatever the daemon replays can
 * re-establish the real value. A pill that latches `Working` forever
 * after a dropped socket is worse than one that briefly under-reports.
 *
 * Never logs, like the turn-running signal: only `event.type`,
 * `payload.agentId` and the ids needed for the two sets are read, and
 * none is ever passed to a sink.
 */

/** The four states the S7 pill draws, in the artifact's own vocabulary. */
export type SessionActivity = "idle" | "thinking" | "working" | "needs-you";

/** The narrow slice of an `agent_stream` event this module reads. */
export interface SessionActivityStreamEvent {
  type: string;
  [key: string]: unknown;
}

/** The narrow `agent_stream` wire message shape this module reads. */
export interface AgentStreamActivityMessage {
  type: "agent_stream";
  payload: {
    agentId: string;
    event: SessionActivityStreamEvent;
  };
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * module needs — structurally identical to `turn-running-signal.ts`'s
 * `DaemonTurnStreamSource`, so a real `DaemonClient` satisfies it as-is.
 */
export interface DaemonActivityStreamSource {
  on(type: "agent_stream", handler: (message: AgentStreamActivityMessage) => void): () => void;
}

/** Same shape `turn-running-signal.ts` takes; optional for a caller that re-creates its signal per connection. */
export interface ConnectionStatusSource {
  subscribeConnectionStatus(listener: (status: { status: string }) => void): () => void;
}

/** The raw facts `deriveSessionActivity` reduces to one state. */
export interface SessionActivityState {
  readonly pendingPermissionCount: number;
  readonly runningToolCallCount: number;
  readonly turnRunning: boolean;
}

/**
 * The one product decision in this module: which of the four states wins
 * when more than one is true. See this file's header for why that order
 * is the honest one.
 */
export function deriveSessionActivity(state: SessionActivityState): SessionActivity {
  if (state.pendingPermissionCount > 0) return "needs-you";
  if (state.runningToolCallCount > 0) return "working";
  if (state.turnRunning) return "thinking";
  return "idle";
}

export interface SessionActivitySignal {
  /** The current state. Never stale after `dispose()`. */
  getActivity(): SessionActivity;
  /** The raw counts behind the state, for a test or a diagnostics surface. */
  getState(): SessionActivityState;
  /** Stops listening. Idempotent. */
  dispose(): void;
}

const TURN_RUNNING_EVENT_TYPES = new Set(["turn_started", "pi_queue_update"]);
const TURN_ENDED_EVENT_TYPES = new Set(["turn_completed", "turn_failed", "turn_canceled"]);
const TOOL_ENDED_STATUSES = new Set(["completed", "failed", "canceled"]);

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}

/** The `requestId` an `AgentPermissionRequest` carries, or `null` when the payload is not shaped the way the protocol says. */
function permissionRequestId(event: SessionActivityStreamEvent): string | null {
  const request = event.request;
  return stringField(request, "requestId");
}

/** A `timeline` event's `item`, when it really is a tool call with a `callId` and a status. */
function toolCallItem(
  event: SessionActivityStreamEvent,
): { callId: string; status: string } | null {
  const item = event.item;
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  if (record.type !== "tool_call") return null;
  const callId = stringField(item, "callId");
  const status = stringField(item, "status");
  if (callId === null || status === null) return null;
  return { callId, status };
}

/**
 * Builds a live activity signal for `agentId` over `daemon`.
 * `onChange` fires only on an actual state transition, so a consumer
 * wiring this into `useState` never schedules a redundant render.
 */
export function createSessionActivitySignal(
  daemon: DaemonActivityStreamSource,
  agentId: string,
  onChange: (activity: SessionActivity) => void,
  connectionStatus?: ConnectionStatusSource,
): SessionActivitySignal {
  const pendingPermissions = new Set<string>();
  const runningToolCalls = new Set<string>();
  let turnRunning = false;
  let disposed = false;
  let activity: SessionActivity = "idle";

  function currentState(): SessionActivityState {
    return {
      pendingPermissionCount: pendingPermissions.size,
      runningToolCallCount: runningToolCalls.size,
      turnRunning,
    };
  }

  function recompute(): void {
    if (disposed) return;
    const next = deriveSessionActivity(currentState());
    if (next === activity) return;
    activity = next;
    onChange(activity);
  }

  function reset(): void {
    pendingPermissions.clear();
    runningToolCalls.clear();
    turnRunning = false;
    recompute();
  }

  const offStream = daemon.on("agent_stream", (message) => {
    if (disposed) return; // an update arriving after dispose() is a no-op, not a stale report
    if (message.payload.agentId !== agentId) return; // a different agent's turn never touches this signal
    const event = message.payload.event;

    if (TURN_RUNNING_EVENT_TYPES.has(event.type)) {
      turnRunning = true;
    } else if (TURN_ENDED_EVENT_TYPES.has(event.type)) {
      turnRunning = false;
      // No tool can still be running once its turn has ended; the
      // daemon's own boundary events are the authority for that.
      runningToolCalls.clear();
    } else if (event.type === "permission_requested") {
      const requestId = permissionRequestId(event);
      if (requestId !== null) pendingPermissions.add(requestId);
    } else if (event.type === "permission_resolved") {
      const requestId = stringField(event, "requestId");
      if (requestId !== null) pendingPermissions.delete(requestId);
    } else if (event.type === "timeline") {
      const item = toolCallItem(event);
      if (item !== null) {
        if (item.status === "running") {
          runningToolCalls.add(item.callId);
        } else if (TOOL_ENDED_STATUSES.has(item.status)) {
          runningToolCalls.delete(item.callId);
        }
      }
    }
    recompute();
  });

  const offConnection = connectionStatus?.subscribeConnectionStatus(() => {
    // Every connection-status transition — including back to
    // "connected" — is a reconnect boundary: drop what the old socket
    // told us and let a replay re-establish the truth.
    reset();
  });

  return {
    getActivity: () => activity,
    getState: currentState,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offStream();
      offConnection?.();
    },
  };
}
