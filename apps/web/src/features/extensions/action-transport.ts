/**
 * Web transport wiring for the Pi UI action round trip (plan.md §12.3).
 *
 * `frontend-core`'s `ExtensionActionController` owns the pending/settled
 * bookkeeping but no connection (plan.md §7.3): it takes a `sendRequest`
 * callback at construction and exposes `ingestActionResponse` for the
 * daemon's synchronous ack. This module is the web app's one place that
 * adapts `@picompanion/client`'s `DaemonClient` to those two seams, so the
 * contract lives here rather than inline in the route component that mounts
 * the controller:
 *
 * ```text
 * controller.dispatch -> sendPiUiActionRequest   -> client.sendPiUiAction -> pi.ui.action.request
 * client "pi.ui.action.response" -> subscribePiUiActionResponses -> controller.ingestActionResponse
 * client "agent_stream" pi_ui_action_result -> controller.ingestAgentStreamEvent (already routed by the route)
 * ```
 *
 * The narrow `PiUiActionTransportClient` interface (never the full
 * `DaemonClient`) keeps these functions unit-testable against a plain fake
 * — no socket, no React — while the real `DaemonClient` satisfies it
 * structurally.
 */
import type { extensions } from "@picompanion/frontend-core";
import type { SessionOutboundMessage } from "@picompanion/protocol/messages";

/** The two `DaemonClient` methods the web Pi UI action transport needs. */
export interface PiUiActionTransportClient {
  sendPiUiAction(input: {
    agentId: string;
    actionId: string;
    elementId: string;
    payload?: Record<string, unknown>;
    requestId?: string;
  }): Promise<unknown>;
  on<TType extends "pi.ui.action.response">(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void;
}

/**
 * Forwards one `ExtensionActionController` dispatch to `client.sendPiUiAction`,
 * preserving the controller's own `requestId` so the daemon's
 * `pi.ui.action.response` ack correlates with the controller's pending entry.
 *
 * Fire-and-forget by design: the controller settles from the ack subscription
 * below (or from the matching `agent_stream` `pi_ui_action_result`), not from
 * this promise's value. A missing client (no daemon connected yet) is a
 * no-op, exactly as the controller's own timeout already models — it will
 * honestly settle the dispatch as `"timeout"` rather than reporting a faked
 * success.
 */
export function sendPiUiActionRequest(
  client: PiUiActionTransportClient | null | undefined,
  message: extensions.PiUiActionRequestMessage,
): void {
  if (!client) return;
  void client
    .sendPiUiAction({
      agentId: message.agentId,
      actionId: message.actionId,
      elementId: message.elementId,
      ...(message.payload !== undefined ? { payload: message.payload } : {}),
      requestId: message.requestId,
    })
    .catch(() => undefined);
}

/**
 * Routes every `pi.ui.action.response` the daemon sends into `controller`,
 * the synchronous-ack half of the round trip. The async result half
 * (`pi_ui_action_result`) travels on `agent_stream` and is fed to
 * `controller.ingestAgentStreamEvent` by the caller's existing stream
 * subscription.
 */
export function subscribePiUiActionResponses(
  client: PiUiActionTransportClient,
  controller: extensions.ExtensionActionController,
): () => void {
  return client.on("pi.ui.action.response", (message) => {
    controller.ingestActionResponse(message.payload);
  });
}
