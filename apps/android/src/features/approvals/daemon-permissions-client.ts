/**
 * Real `PermissionsController` wiring over a `DaemonClient`-shaped
 * object (T33B5; plan.md §7.1/§12.3 "Pi UI action" — the same request/
 * response round trip applies to `agent_permission_request`/
 * `agent_permission_response`/`agent_permission_resolved`).
 *
 * A byte-for-byte structural port of
 * `apps/web/src/features/approvals/daemon-permissions-client.ts` (this
 * task's required reading — "match its vocabulary"), not a fork: same
 * exported names (`DaemonPermissionsSource`, `wirePermissionsController`,
 * `sendPermissionAnswer`), same narrow-adapter convention `composer-
 * model.ts`'s `TurnService` and `daemon-connect-attempt.ts` already use
 * on Android — this module only depends on the slice of
 * `@picompanion/client`'s `DaemonClient` it actually calls
 * (`respondToPermission`, `on("agent_permission_request" |
 * "agent_permission_resolved", ...)`), so a real `DaemonClient` (already
 * imported elsewhere on Android, e.g. `features/connect/daemon-connect-
 * attempt.ts`, via `@picompanion/frontend-core`'s `connection` module)
 * satisfies `DaemonPermissionsSource` as-is with no adapter class
 * needed. `DaemonClient.respondToPermission` is defined at
 * `packages/client/src/daemon-client.ts:4728`.
 *
 * No Android route wires a live `DaemonClient` into this feature yet —
 * see this task's report for exactly what a mount needs.
 */
import type { permissions } from "@picompanion/frontend-core";

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
  };
}

/** Selects which raw wire message shape `DaemonPermissionsSource.on` resolves to. */
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
   * parameter) because TypeScript does not substitute a generic
   * source-overload type parameter against a non-generic target
   * parameter type, so a plain literal parameter here would make every
   * real `DaemonClient` fail this interface even though it satisfies it
   * at runtime — same reasoning the web adapter's doc comment gives.
   */
  on<TType extends "agent_permission_request" | "agent_permission_resolved">(
    type: TType,
    handler: (message: DaemonPermissionEventMessage<TType>) => void,
  ): () => void;
}

/**
 * Feeds every live `agent_permission_request`/`agent_permission_resolved`
 * push from `daemon` into `controller`
 * (`PermissionsController.handleMessage`, T21A) so the "daemon
 * resolution always wins" rule (plan.md §7.2) applies to real daemon
 * traffic. Returns one combined unsubscribe function.
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
 * Dispatches a user's answer through `controller.answer` and, if that
 * produced a real outbound message (the request was still `"pending"`
 * — a stale UI action on an already-answered/timed-out/withdrawn
 * request returns `null` and sends nothing), sends it to `daemon`.
 * Resolves with the wire message that was sent, or `null` for a stale
 * action. Never resolves before the network call settles, so a caller
 * that wants to show inline error state (`use-approvals-queue.ts`)
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
