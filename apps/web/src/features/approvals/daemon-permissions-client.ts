/**
 * Real `PermissionsController` wiring over a `DaemonClient`-shaped
 * object (T28B7, plan.md §7.1/§12.3 "Pi UI action" — the same request/
 * response round trip applies to `agent_permission_request`/
 * `agent_permission_response`/`agent_permission_resolved`, not only
 * `pi.ui.action.request`).
 *
 * Mirrors `features/composer/daemon-agent-turn-client.ts`'s narrow-
 * adapter convention: this module only depends on the slice of
 * `@picompanion/client`'s `DaemonClient` it actually calls
 * (`respondToPermission`, `on("agent_permission_request" | "agent_permission_resolved", ...)`),
 * so it never has to import `@picompanion/client` to stay structurally
 * compatible with it — a real `DaemonClient` satisfies
 * `DaemonPermissionsSource` as-is.
 * `daemon-permissions-client.fixture.test.ts` proves that against the
 * real class and the recorded `permission-dialog.json` fixture
 * (`packages/protocol/src/fixtures/daemon-ws/`).
 *
 * `DaemonClient.on(type, handler)` (unlike its normalized `subscribe()`)
 * hands back the *raw* wire message shape — `{ type, payload: { ... } }`
 * — for whichever `SessionOutboundMessage` type is requested. For
 * `"agent_permission_request"`/`"agent_permission_resolved"` that shape
 * is exactly what `PermissionsController.handleMessage` already parses
 * (`AgentPermissionRequestMessageSchema`/`AgentPermissionResolvedMessageSchema`
 * in `@picompanion/protocol/messages`), so `wirePermissionsController`
 * below feeds every push straight through rather than re-deriving
 * `ingestRequest`/`applyResolution` calls by hand.
 */
import type { actions, permissions } from "@picompanion/frontend-core";

/** Raw `agent_permission_request` wire message shape this adapter reads. */
export interface DaemonPermissionRequestMessage {
  type: "agent_permission_request";
  payload: {
    agentId: string;
    request: permissions.AgentPermissionRequest;
  };
}

/** Raw `agent_permission_resolved` wire message shape this adapter reads. */
export interface DaemonPermissionResolvedMessage {
  type: "agent_permission_resolved";
  payload: {
    agentId: string;
    requestId: string;
    resolution: permissions.AgentPermissionResponse;
    /**
     * Which client's answer this resolution reflects, when the daemon
     * knows it (T111, `PermissionAnsweredBySchema` in
     * `@picompanion/protocol/messages`). Absent entirely — not present
     * with an `undefined` value — on an older daemon or for a
     * resolution nobody attributes (matches the wire schema's own
     * `.optional()`), so every caller from before T111 keeps compiling
     * and behaving unchanged. Shape mirrors `actions.AnsweredBy`
     * (`packages/frontend-core/src/actions/arbitration.ts`) exactly,
     * so `wireRequestArbitrator` below forwards it as-is.
     */
    answeredBy?: { clientId?: string; label?: string };
  };
}

/** Selects which raw wire message shape `DaemonPermissionsSource.on` resolves to, mirroring `daemon-agent-turn-client.ts`'s own `DaemonAgentEventMessage`. */
type DaemonPermissionEventMessage<
  TType extends "agent_permission_request" | "agent_permission_resolved",
> = TType extends "agent_permission_request"
  ? DaemonPermissionRequestMessage
  : DaemonPermissionResolvedMessage;

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter needs. A real `DaemonClient` satisfies this as-is.
 */
export interface DaemonPermissionsSource {
  /** Matches `DaemonClient.respondToPermission(agentId, requestId, response)`. */
  respondToPermission(
    agentId: string,
    requestId: string,
    response: permissions.AgentPermissionResponse,
  ): Promise<void>;
  /**
   * `type` is generic (rather than a plain string-literal union
   * parameter) for the same reason `daemon-agent-turn-client.ts`'s `on`
   * is: TypeScript does not substitute a generic source overload's type
   * parameter against a non-generic target parameter type, so a plain
   * literal parameter here would make every real `DaemonClient` fail
   * this interface even though it satisfies it at runtime.
   */
  on<TType extends "agent_permission_request" | "agent_permission_resolved">(
    type: TType,
    handler: (message: DaemonPermissionEventMessage<TType>) => void,
  ): () => void;
}

/**
 * Feeds every live `agent_permission_request`/`agent_permission_resolved`
 * push from `daemon` into `controller` (`PermissionsController.handleMessage`,
 * T21A) so pending/answered state and the "daemon resolution always wins"
 * rule (plan.md §7.2, `controller.ts`'s own doc comment) apply to real
 * daemon traffic exactly the way `permissions.test.ts`'s fixture-driven
 * unit tests already prove for the message shapes alone. Returns one
 * combined unsubscribe function.
 */
export function wirePermissionsController(
  controller: permissions.PermissionsController,
  daemon: DaemonPermissionsSource,
): () => void {
  const offRequest = daemon.on("agent_permission_request", (message) => {
    controller.handleMessage(message);
  });
  const offResolved = daemon.on("agent_permission_resolved", (message) => {
    controller.handleMessage(message);
  });
  return () => {
    offRequest();
    offResolved();
  };
}

/**
 * Feeds the same live `agent_permission_request`/`agent_permission_resolved`
 * pushes into a `RequestArbitrator` (T47A1a,
 * `packages/frontend-core/src/actions/arbitration.ts`, reached here through
 * the package specifier `@picompanion/frontend-core` per T103) so this
 * client can tell whether its own answer to a request was the one the
 * daemon accepted (T47A2, plan.md §12.3). Mirrors
 * `wirePermissionsController` above exactly, feeding the identical message
 * stream to a second, independent consumer — the arbitrator carries no
 * transport or view-model concerns of its own, only the pending/
 * answered-locally/confirmed/superseded/resolved-elsewhere state machine.
 *
 * `agent_permission_resolved`'s wire payload carries an optional
 * `answeredBy` (T111, `PermissionAnsweredBySchema` in
 * `@picompanion/protocol/messages`) whenever the daemon knows which
 * client's answer a resolution reflects, so it is forwarded to
 * `applyResolution` here as-is (the two shapes already match field for
 * field). Older daemons, and any resolution nobody attributes, omit the
 * field entirely rather than sending it as `undefined`; `message.payload.answeredBy`
 * is then itself `undefined` and `RequestArbitrator` degrades to its
 * documented best-effort comparison exactly as it did before T111 —
 * see `arbitration.ts`'s module doc for that fallback.
 */
export function wireRequestArbitrator(
  arbitrator: actions.RequestArbitrator<permissions.AgentPermissionResponse>,
  daemon: DaemonPermissionsSource,
): () => void {
  const offRequest = daemon.on("agent_permission_request", (message) => {
    arbitrator.open(message.payload.request.id);
  });
  const offResolved = daemon.on("agent_permission_resolved", (message) => {
    arbitrator.applyResolution(message.payload.requestId, {
      response: message.payload.resolution,
      answeredBy: message.payload.answeredBy,
    });
  });
  return () => {
    offRequest();
    offResolved();
  };
}

/**
 * Dispatches a user's answer through `controller.answer` (T21A) and, if
 * that produced a real outbound message (i.e. the request was still
 * `"pending"` — a stale UI action on an already-answered/timed-out
 * request returns `null` and sends nothing), sends it to `daemon`.
 * Resolves with the wire message that was sent, or `null` for a stale
 * action. Never resolves before the network call settles: a caller that
 * wants to show inline "submitting…"/error state (`use-approvals-queue.ts`)
 * awaits this directly rather than racing it.
 */
export async function sendPermissionAnswer(
  controller: permissions.PermissionsController,
  daemon: DaemonPermissionsSource,
  requestId: string,
  response: permissions.AgentPermissionResponse,
): Promise<permissions.AgentPermissionResponseWireMessage | null> {
  const wireMessage = controller.answer(requestId, response);
  if (!wireMessage) {
    return null;
  }
  await daemon.respondToPermission(
    wireMessage.agentId,
    wireMessage.requestId,
    wireMessage.response,
  );
  return wireMessage;
}
