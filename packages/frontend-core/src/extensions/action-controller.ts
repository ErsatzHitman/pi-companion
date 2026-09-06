/**
 * Extension action controller (plan.md §7.1, §12.3; T21C).
 *
 * Implements the client half of the Pi UI action round trip:
 *
 * ```text
 * user action
 *   -> platform confirmation if required
 *   -> frontend-core ExtensionActionController   <- this module
 *   -> pi.ui.action.request
 *   -> daemon action router
 *   -> /pi_ui_event <base64url payload>
 *   -> owning Pi extension namespace
 *   -> extension state update
 *   -> pi_ui_delta or action result
 *   -> pending action resolves
 * ```
 *
 * Two distinct daemon acknowledgments settle a dispatched action:
 *
 * - `pi.ui.action.response` — the synchronous RPC reply keyed by `requestId`
 *   (see `packages/server/.../pi/ui-bridge/actions.ts` `PiUiActionRouter`).
 *   `ok: false` here means the daemon could not even route the request
 *   (unknown/ambiguous element, or the extension's `prompt()` call itself
 *   failed) and settles the action immediately.
 * - `pi_ui_action_result` — an async `AgentStreamEvent` emitted once the
 *   owning extension namespace actually handles the routed action. This is
 *   the "real" outcome for a request that was routed successfully.
 *
 * Wire-shape constraint that drives this module's design: neither message
 * carries the composite `(agentId, namespace, elementId, actionId)` identity
 * in full.
 *
 * - `pi.ui.action.request`/`.response` carry `requestId`, so they
 *   unambiguously settle exactly one pending entry.
 * - `pi_ui_action_result` carries only `actionId`/`elementId` (plus the
 *   outer `agent_stream` envelope's `agentId` — the event payload itself has
 *   no `agentId` and no `requestId`, mirroring the daemon's
 *   `AgentStreamEvent` union). It cannot name a `namespace` at all, because
 *   the daemon resolves that server-side when it looks up the request's
 *   `elementId` against its own Pi UI state (the same ambiguity rule
 *   `state.ts`'s `resolveRemoveKey` implements for a bare-id `remove` delta).
 *
 * So this controller tracks pending actions under the full composite key
 * `(agentId, namespace, elementId, actionId, requestId)` — the identity
 * plan.md §12.3 specifies, which is what actually prevents two elements
 * (possibly from different namespaces, possibly sharing a bare id) from
 * colliding in *this client's* bookkeeping and in the "current state of this
 * button" view renderers read — while still being able to settle a
 * `pi_ui_action_result` that only carries `(agentId, elementId, actionId)`,
 * by resolving it against the oldest still-pending entry for that narrower
 * key (FIFO), the same conservative "don't guess when ambiguous" posture
 * `state.ts` uses, applied to the one axis (`requestId` order) this module
 * can actually observe.
 */

import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { SessionInboundMessage, SessionOutboundMessage } from "@picompanion/protocol/messages";
import type { PiUiAction, PiUiActionResult } from "@picompanion/protocol/pi-ui-bridge/schema";
import type { AnsweredBy } from "../actions/arbitration.js";
import type { Clock, TimerHandle } from "../platform/clock.js";

/** Wire shape sent to the daemon for one dispatched action. */
export type PiUiActionRequestMessage = Extract<
  SessionInboundMessage,
  { type: "pi.ui.action.request" }
>;

/** Wire shape of the synchronous RPC-level acknowledgment. */
export type PiUiActionResponseMessage = Extract<
  SessionOutboundMessage,
  { type: "pi.ui.action.response" }
>;

/** The RPC-level acknowledgment payload alone (what `ingestActionResponse` consumes). */
export type PiUiActionResponsePayload = PiUiActionResponseMessage["payload"];

/**
 * Composite Pi UI action identity (plan.md §12.3). `namespace` is mandatory
 * here for exactly the reason `ns` is mandatory in `identity.ts`: two
 * extensions may both expose an element/action pair with the same bare ids,
 * and a renderer must never mix up one element's pending/settled action
 * state with another's.
 */
export interface ExtensionActionTarget {
  agentId: string;
  namespace: string;
  elementId: string;
  actionId: string;
}

/** Deterministic string key for one composite `ExtensionActionTarget`. */
export function extensionActionTargetKey(target: ExtensionActionTarget): string {
  return [target.agentId, target.namespace, target.elementId, target.actionId].join("\u0001");
}

/** Narrower key covering only what a `pi_ui_action_result` event can name. */
function resultMatchKey(agentId: string, elementId: string, actionId: string): string {
  return [agentId, elementId, actionId].join("\u0001");
}

/** Input to `ExtensionActionController.dispatch`. */
export interface DispatchActionInput {
  agentId: string;
  namespace: string;
  elementId: string;
  actionId: string;
  payload?: Record<string, unknown>;
  /**
   * The `PiUiAction` this dispatch is for, when the caller has it (usually
   * read off the rendered element's `actions` array). Optional, but
   * required for the dangerous-action confirmation gate below to apply —
   * omitting it (e.g. for an action known not to be dangerous) skips the
   * gate entirely.
   */
  action?: PiUiAction;
  /**
   * Must be `true` when `action.confirm` is set. `dispatch` throws
   * `ExtensionActionConfirmationRequiredError` instead of sending anything
   * when a `confirm`-bearing action is dispatched without it — the "platform
   * confirmation if required" step in plan.md §12.3 happens before this
   * call, driven by `getActionConfirmation`/`requiresConfirmation` below.
   */
  confirmed?: boolean;
  /** Overrides the generated `requestId` (tests; replaying a fixed fixture). */
  requestId?: string;
}

/** One settled (non-pending) outcome for a dispatched action. */
export interface SettledExtensionAction {
  target: ExtensionActionTarget;
  requestId: string;
  status: "success" | "rejected" | "timeout" | "cancelled";
  error?: string;
  /**
   * `true` when the element's known revision (per `getElementRevision`, if
   * the controller was constructed with one) changed between dispatch and
   * settlement. A stale revision never blocks or alters settlement — the
   * action round trip is keyed on wire identity, not on Pi UI Bridge
   * revision — it is only a signal a renderer can use to decide whether the
   * element it originally rendered the action from is still current.
   */
  staleRevision: boolean;
  /** Which acknowledgment settled this action. */
  source: "response" | "result" | "timeout" | "cancel";
  settledAt: number;
  /**
   * The connected client the daemon says answered this action, when it
   * supplied one (T128, mirroring `agent_permission_resolved`'s `answeredBy`
   * since T111). For a `source: "response"` settlement this always names
   * *this* connection (the RPC ack is private, so it can only ever be
   * self-attributed — see `session.ts`'s `dispatchPiUiMessage`). For a
   * `source: "result"` settlement it may legitimately name a *different*
   * connection: this controller places no win/lose arbitration over Pi UI
   * action dispatch (unlike `../actions/arbitration.ts`'s
   * `RequestArbitrator` for permissions) — every dispatch reaches the
   * daemon independently. Absent entirely (not merely `undefined`) whenever
   * the daemon did not supply one, matching every other optional field on
   * this wire shape.
   */
  answeredBy?: AnsweredBy;
}

/** Current view-model state of one composite action target. */
export type ExtensionActionState =
  | { status: "idle" }
  | { status: "pending"; target: ExtensionActionTarget; requestId: string; dispatchedAt: number }
  | SettledExtensionAction;

export type ExtensionActionListener = (
  target: ExtensionActionTarget,
  state: ExtensionActionState,
) => void;

/** Thrown by `dispatch` when a `confirm`-bearing action is sent unconfirmed. */
export class ExtensionActionConfirmationRequiredError extends Error {
  constructor(
    readonly target: ExtensionActionTarget,
    readonly confirmMessage: string,
  ) {
    super(
      `Action "${target.actionId}" on "${target.namespace}:${target.elementId}" requires confirmation: ${confirmMessage}`,
    );
    this.name = "ExtensionActionConfirmationRequiredError";
  }
}

/** The dangerous-action confirmation hook (plan.md §12.3 "platform confirmation if required"). */
export interface ActionConfirmation {
  required: boolean;
  message?: string;
}

/**
 * Pure hook a renderer calls before dispatching a `PiUiAction`, to decide
 * whether to show a platform confirmation prompt first. `frontend-core`
 * cannot show that prompt itself (no DOM/native alert access here — plan.md
 * §7.3), so this only ever answers "is confirmation required, and with what
 * message" and leaves showing it to the platform layer.
 */
export function getActionConfirmation(action: PiUiAction | undefined): ActionConfirmation {
  if (!action || action.confirm === undefined) return { required: false };
  return { required: true, message: action.confirm };
}

/** Convenience boolean form of `getActionConfirmation`. */
export function requiresConfirmation(action: PiUiAction | undefined): boolean {
  return getActionConfirmation(action).required;
}

interface PendingEntry {
  target: ExtensionActionTarget;
  requestId: string;
  dispatchedAt: number;
  dispatchRevision: number | undefined;
  timeoutHandle: TimerHandle;
  routed: boolean;
  settle: (outcome: SettledExtensionAction) => void;
}

/** Constructor options for `ExtensionActionController`. */
export interface ExtensionActionControllerOptions {
  clock: Clock;
  /**
   * Sends one `pi.ui.action.request` over the live connection. Injected
   * rather than owned here: `frontend-core` stays platform-neutral and this
   * controller has no `DaemonClient` of its own (plan.md §7.3) — the
   * connection domain wires a real transport into this callback.
   */
  sendRequest: (message: PiUiActionRequestMessage) => void;
  /** Default request timeout. Mirrors `@picompanion/client`'s session RPC default (60s). */
  timeoutMs?: number;
  /**
   * Reads an agent's current Pi UI Bridge revision, e.g.
   * `PiUiElementStore.getRevision.bind(store)`. Optional: without it,
   * `staleRevision` is always `false`.
   */
  getElementRevision?: (agentId: string) => number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Tracks every in-flight and most-recently-settled Pi UI action per
 * composite `(agentId, namespace, elementId, actionId)` target, and resolves
 * the promise `dispatch` returns once a `pi.ui.action.response` rejects the
 * request, a matching `pi_ui_action_result` arrives, or the request times
 * out.
 */
export class ExtensionActionController {
  private readonly clock: Clock;
  private readonly sendRequest: (message: PiUiActionRequestMessage) => void;
  private readonly timeoutMs: number;
  private readonly getElementRevision: ((agentId: string) => number) | undefined;

  /** Every currently pending entry, keyed by `requestId` (globally unique). */
  private readonly pendingByRequestId = new Map<string, PendingEntry>();
  /** `requestId`s still awaiting a `pi_ui_action_result`, per narrower result key, oldest first. */
  private readonly pendingResultOrder = new Map<string, string[]>();
  /**
   * Most recently *settled* outcome per composite target. `getActionState`
   * only falls back to this when nothing for that target is pending any
   * more — see its doc comment for why an older concurrent request settling
   * must never clobber a newer still-pending one's visible state.
   */
  private readonly lastSettledByTargetKey = new Map<string, SettledExtensionAction>();

  private readonly listeners = new Set<ExtensionActionListener>();
  private requestSeq = 0;

  constructor(options: ExtensionActionControllerOptions) {
    this.clock = options.clock;
    this.sendRequest = options.sendRequest;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.getElementRevision = options.getElementRevision;
  }

  /** Subscribes to every pending/settled state transition. */
  subscribe(listener: ExtensionActionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(target: ExtensionActionTarget, state: ExtensionActionState): void {
    for (const listener of this.listeners) listener(target, state);
  }

  /** Every entry in `pendingByRequestId` for one composite target, oldest first. */
  private pendingEntriesFor(target: ExtensionActionTarget): PendingEntry[] {
    const key = extensionActionTargetKey(target);
    return [...this.pendingByRequestId.values()]
      .filter((entry) => extensionActionTargetKey(entry.target) === key)
      .sort((a, b) => a.dispatchedAt - b.dispatchedAt);
  }

  /**
   * Current state of one composite action target (`"idle"` if never
   * dispatched). Computed fresh from `pendingByRequestId` rather than cached,
   * so it stays correct even when two requests for the exact same composite
   * target are in flight at once (e.g. a double-dispatch, or a fixture
   * replay): while *any* of them is still pending, the target reads as
   * `"pending"` (representing the newest dispatch) — an older one settling
   * first must not make the target look idle/settled while a newer one is
   * still outstanding.
   */
  getActionState(target: ExtensionActionTarget): ExtensionActionState {
    const pending = this.pendingEntriesFor(target);
    const newest = pending.at(-1);
    if (newest) {
      return {
        status: "pending",
        target: newest.target,
        requestId: newest.requestId,
        dispatchedAt: newest.dispatchedAt,
      };
    }
    return this.lastSettledByTargetKey.get(extensionActionTargetKey(target)) ?? { status: "idle" };
  }

  /** True while any request for this exact composite target is in flight. */
  isPending(target: ExtensionActionTarget): boolean {
    return this.pendingEntriesFor(target).length > 0;
  }

  /** Every currently pending entry, in dispatch order. */
  listPending(): Array<{ target: ExtensionActionTarget; requestId: string; dispatchedAt: number }> {
    return [...this.pendingByRequestId.values()]
      .sort((a, b) => a.dispatchedAt - b.dispatchedAt)
      .map((entry) => ({
        target: entry.target,
        requestId: entry.requestId,
        dispatchedAt: entry.dispatchedAt,
      }));
  }

  private nextRequestId(): string {
    this.requestSeq += 1;
    return `req_${this.clock.now()}_${this.requestSeq}`;
  }

  /**
   * Dispatches one Pi UI action and resolves once it settles (success,
   * rejection, or timeout). Never rejects the returned promise: a failed or
   * timed-out action is a normal `SettledExtensionAction`, not a thrown
   * error, so callers do not need a try/catch for the expected daemon-level
   * failure paths. It still *throws* synchronously,
   * before sending anything, when a `confirm`-bearing action is dispatched
   * without `confirmed: true` (plan.md §12.3's "platform confirmation if
   * required" step was skipped).
   */
  dispatch(input: DispatchActionInput): Promise<SettledExtensionAction> {
    const confirmation = getActionConfirmation(input.action);
    const target: ExtensionActionTarget = {
      agentId: input.agentId,
      namespace: input.namespace,
      elementId: input.elementId,
      actionId: input.actionId,
    };
    if (confirmation.required && input.confirmed !== true) {
      throw new ExtensionActionConfirmationRequiredError(target, confirmation.message!);
    }

    const requestId = input.requestId ?? this.nextRequestId();
    const dispatchedAt = this.clock.now();
    const dispatchRevision = this.getElementRevision?.(input.agentId);

    return new Promise<SettledExtensionAction>((resolve) => {
      const timeoutHandle = this.clock.setTimeout(() => {
        this.settle(requestId, "timeout", "timeout");
      }, this.timeoutMs);

      const entry: PendingEntry = {
        target,
        requestId,
        dispatchedAt,
        dispatchRevision,
        timeoutHandle,
        routed: false,
        settle: resolve,
      };
      this.pendingByRequestId.set(requestId, entry);

      const resultKey = resultMatchKey(target.agentId, target.elementId, target.actionId);
      const order = this.pendingResultOrder.get(resultKey) ?? [];
      order.push(requestId);
      this.pendingResultOrder.set(resultKey, order);

      this.broadcast(target, { status: "pending", target, requestId, dispatchedAt });

      this.sendRequest({
        type: "pi.ui.action.request",
        agentId: input.agentId,
        actionId: input.actionId,
        elementId: input.elementId,
        payload: input.payload,
        requestId,
      });
    });
  }

  /**
   * Ingests a `pi.ui.action.response` (the synchronous RPC ack keyed by
   * `requestId`). `ok: false` settles the action immediately as rejected —
   * the daemon never routed it to an extension, so no `pi_ui_action_result`
   * will ever follow. `ok: true` only marks the request as routed; the
   * action stays pending until the matching `pi_ui_action_result` (or the
   * timeout) settles it.
   */
  ingestActionResponse(response: PiUiActionResponsePayload): void {
    const entry = this.pendingByRequestId.get(response.requestId);
    if (!entry) return;
    if (!response.ok) {
      this.settle(
        response.requestId,
        "rejected",
        "response",
        response.error ?? undefined,
        response.answeredBy,
      );
      return;
    }
    entry.routed = true;
  }

  /**
   * Ingests one `pi_ui_action_result` for `agentId` (the outer `agent_stream`
   * envelope's `agentId` — the event payload itself carries none). Resolves
   * against the oldest still-pending entry whose `(agentId, elementId,
   * actionId)` matches, since the wire event cannot name a `requestId` or a
   * `namespace` to disambiguate further (see this module's header comment).
   *
   * `answeredBy` (T128) is the daemon's attribution of this specific result,
   * when it supplied one — passed through verbatim onto the settled action.
   */
  ingestActionResult(
    agentId: string,
    result: PiUiActionResult,
    answeredBy?: AnsweredBy,
  ): SettledExtensionAction | null {
    const resultKey = resultMatchKey(agentId, result.elementId, result.actionId);
    const order = this.pendingResultOrder.get(resultKey);
    const requestId = order?.[0];
    if (!requestId) return null;
    return this.settle(
      requestId,
      result.ok ? "success" : "rejected",
      "result",
      result.ok ? undefined : (result.error ?? undefined),
      answeredBy,
    );
  }

  /**
   * Dispatches one `AgentStreamEvent` from the frontend-core event parser
   * (plan.md §12.2). `agentId` must come from the enclosing `agent_stream`
   * envelope (see `ingestActionResult`). Returns `null` for any event this
   * controller does not own (mirrors `PiUiElementStore.ingestEvent`).
   */
  ingestAgentStreamEvent(agentId: string, event: AgentStreamEvent): SettledExtensionAction | null {
    if (event.type !== "pi_ui_action_result") return null;
    return this.ingestActionResult(agentId, event.result, event.answeredBy);
  }

  /**
   * Cancels a pending action locally (e.g. the renderer that dispatched it
   * unmounted) without waiting for a daemon acknowledgment. Idempotent: a
   * `requestId` that is not pending is a no-op.
   */
  cancel(requestId: string): SettledExtensionAction | null {
    return this.settle(requestId, "cancelled", "cancel");
  }

  private settle(
    requestId: string,
    status: SettledExtensionAction["status"],
    source: SettledExtensionAction["source"],
    error?: string,
    answeredBy?: AnsweredBy,
  ): SettledExtensionAction | null {
    const entry = this.pendingByRequestId.get(requestId);
    if (!entry) return null;

    this.pendingByRequestId.delete(requestId);
    this.clock.clearTimeout(entry.timeoutHandle);

    const resultKey = resultMatchKey(
      entry.target.agentId,
      entry.target.elementId,
      entry.target.actionId,
    );
    const order = this.pendingResultOrder.get(resultKey);
    if (order) {
      const idx = order.indexOf(requestId);
      if (idx !== -1) order.splice(idx, 1);
      if (order.length === 0) this.pendingResultOrder.delete(resultKey);
    }

    const currentRevision = this.getElementRevision?.(entry.target.agentId);
    const staleRevision =
      entry.dispatchRevision !== undefined &&
      currentRevision !== undefined &&
      currentRevision !== entry.dispatchRevision;

    const settled: SettledExtensionAction = {
      target: entry.target,
      requestId: entry.requestId,
      status,
      error,
      staleRevision,
      source,
      settledAt: this.clock.now(),
      ...(answeredBy ? { answeredBy } : {}),
    };

    this.lastSettledByTargetKey.set(extensionActionTargetKey(entry.target), settled);
    this.broadcast(entry.target, settled);
    entry.settle(settled);
    return settled;
  }
}
