/**
 * Shared helpers for turning one of this directory's recorded
 * `FixtureFrame`s into the typed wire message it actually is, validated
 * through the real wire schemas (`@picompanion/protocol/messages`) rather
 * than an invented shape.
 *
 * Mirrors `../../timeline/fixtures/wire.ts` (T20A/T20B), extracted for this
 * directory because a `pi.ui.action.request` frame travels
 * `client_to_daemon` through `WSInboundMessageSchema` — a schema the
 * timeline fixtures' helper never needed.
 */
import { WSInboundMessageSchema, WSOutboundMessageSchema } from "@picompanion/protocol/messages";
import type {
  AgentStreamMessage,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "@picompanion/protocol/messages";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";

/** Validates a `daemon_to_client` frame through the real wire schema and
 * extracts its inner `agent_stream` message. */
export function agentStreamMessageFromFrame(frame: { message: unknown }): AgentStreamMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session" || parsed.message.type !== "agent_stream") {
    throw new Error(`fixture frame did not contain an agent_stream message: ${parsed.type}`);
  }
  return parsed.message;
}

/** Validates a `daemon_to_client` `agent_stream` frame and extracts its
 * `AgentStreamEvent`, typed exactly as `frontend-core`'s event parser and
 * `PiUiElementStore.ingestEvent` consume it (plan.md §12.2). */
export function agentStreamEventFromFrame(frame: { message: unknown }): AgentStreamEvent {
  return agentStreamMessageFromFrame(frame).payload.event as AgentStreamEvent;
}

/** Validates a `client_to_daemon` frame through the real inbound wire schema
 * and extracts its inner session message. */
export function sessionInboundMessageFromFrame(frame: { message: unknown }): SessionInboundMessage {
  const parsed = WSInboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session") {
    throw new Error(`fixture frame did not contain a session message: ${parsed.type}`);
  }
  return parsed.message;
}

/** Validates a `daemon_to_client` non-`agent_stream` session frame (e.g. a
 * `pi.ui.action.response` ack) through the real outbound wire schema. */
export function sessionOutboundMessageFromFrame(frame: {
  message: unknown;
}): SessionOutboundMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session") {
    throw new Error(`fixture frame did not contain a session message: ${parsed.type}`);
  }
  return parsed.message;
}

export function frameById<T extends { id: string }>(frames: readonly T[], id: string): T {
  const frame = frames.find((candidate) => candidate.id === id);
  if (!frame) {
    throw new Error(`fixture is missing frame "${id}"`);
  }
  return frame;
}
