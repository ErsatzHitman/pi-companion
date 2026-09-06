/**
 * Real `PiNoticeStore` attachment over a `DaemonClient`-shaped object
 * (T112). Mirrors the narrow-adapter convention
 * `features/telemetry/daemon-session-cost-client.ts` (T48A2) and
 * `features/sessions/daemon-sessions-client.ts` (T27B2) established:
 * this module only depends on the slice of `@picompanion/client`'s
 * `DaemonClient` it actually calls (`on("agent_stream", ...)`), so it
 * never has to import `@picompanion/client` to stay structurally
 * compatible with it — a real `DaemonClient` satisfies
 * `DaemonPiNoticeClient` as-is.
 *
 * `on` is declared generic (`<TType extends "agent_stream">`), not with
 * a plain literal `"agent_stream"` parameter, for the same reason
 * `daemon-session-cost-client.ts`'s own `DaemonSessionCostClient.on`
 * is: `@picompanion/client`'s real `DaemonClient.on` is itself generic
 * over `SessionOutboundMessage["type"]`, and a plain literal parameter
 * here would make a real `DaemonClient` fail this interface even though
 * it satisfies it at runtime.
 *
 * `event` is typed as `DaemonPiNoticeWireEvent` — a loose duck-typed
 * shape carrying only the fields a `pi_notice` event needs — rather than
 * the daemon's full `AgentStreamEventPayload` (`messages.ts`) or
 * frontend-core's independently declared `AgentStreamEvent`
 * (`@picompanion/protocol/agent-types`). `root-route.tsx`'s
 * `ExtensionRailContent` already documents that those two full unions
 * are not directly assignable to each other without an explicit
 * `as unknown as` cast; this adapter only ever reads one variant of
 * either union, so it sidesteps that entirely by declaring just the
 * fields it needs and narrowing at runtime (`isPiNoticeEvent`) instead
 * of trusting a compile-time cast.
 */
import type { PiNoticeSourceEvent, PiNoticeStore } from "./pi-notice-store.js";

/** The loose shape this adapter reads off any `agent_stream` event. */
export interface DaemonPiNoticeWireEvent {
  type: string;
  provider?: string;
  level?: string;
  message?: string;
  source?: string;
  turnId?: string;
}

/** Raw `agent_stream` wire message shape this adapter reads. */
export interface DaemonPiNoticeStreamMessage {
  type: "agent_stream";
  payload: {
    agentId: string;
    event: DaemonPiNoticeWireEvent;
  };
}

type DaemonPiNoticeEventMessage<TType extends "agent_stream"> = TType extends "agent_stream"
  ? DaemonPiNoticeStreamMessage
  : never;

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter needs. A real `DaemonClient` satisfies this as-is.
 */
export interface DaemonPiNoticeClient {
  on<TType extends "agent_stream">(
    type: TType,
    handler: (message: DaemonPiNoticeEventMessage<TType>) => void,
  ): () => void;
}

function isPiNoticeEvent(event: DaemonPiNoticeWireEvent): event is PiNoticeSourceEvent {
  return (
    event.type === "pi_notice" &&
    typeof event.provider === "string" &&
    (event.level === "info" || event.level === "warning" || event.level === "error") &&
    typeof event.message === "string"
  );
}

/**
 * Attaches a `PiNoticeStore` to one session's live `agent_stream`
 * pushes, ingesting only `pi_notice` events addressed to `agentId`.
 * Returns an unsubscribe function; call it when the session route
 * unmounts or switches to a different `agentId`.
 */
export function attachPiNoticeStore(
  daemon: DaemonPiNoticeClient,
  agentId: string,
  store: PiNoticeStore,
): () => void {
  return daemon.on("agent_stream", (message) => {
    if (message.payload.agentId !== agentId) return;
    const event = message.payload.event;
    if (!isPiNoticeEvent(event)) return;
    store.ingest(event);
  });
}
