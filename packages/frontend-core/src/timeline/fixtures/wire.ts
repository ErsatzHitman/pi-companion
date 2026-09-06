/**
 * Shared helpers for turning a recorded `FixtureFrame` (this directory's
 * scenarios, or `@picompanion/protocol`'s `daemon-ws` fixtures) into the
 * typed wire message the timeline reducer actually consumes, validated
 * through the real `WSOutboundMessageSchema` rather than an invented shape.
 *
 * Extracted from T20A's `reducer.test.ts` so T20B's additional test files
 * (gap backfill, optimistic reconciliation, restart recovery) can reuse the
 * exact same validation instead of duplicating it.
 */
import { WSOutboundMessageSchema } from "@picompanion/protocol/messages";
import type {
  AgentStreamMessage,
  FetchAgentTimelineResponseMessage,
} from "@picompanion/protocol/messages";

/** Validates a fixture frame's envelope through the real wire schema and
 * extracts its inner `agent_stream` message. */
export function agentStreamMessageFromFrame(frame: { message: unknown }): AgentStreamMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session" || parsed.message.type !== "agent_stream") {
    throw new Error(`fixture frame did not contain an agent_stream message: ${parsed.type}`);
  }
  return parsed.message;
}

/** Validates a fixture frame's envelope through the real wire schema and
 * extracts its inner `fetch_agent_timeline_response` message. */
export function fetchAgentTimelineResponseFromFrame(frame: {
  message: unknown;
}): FetchAgentTimelineResponseMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session" || parsed.message.type !== "fetch_agent_timeline_response") {
    throw new Error(
      `fixture frame did not contain a fetch_agent_timeline_response message: ${parsed.type}`,
    );
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
