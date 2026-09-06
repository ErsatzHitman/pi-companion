import type { TimelineFixtureScenario } from "../types.js";

/**
 * A live agent_stream assistant_message row is redelivered verbatim (dedupe
 * by epoch/seq), then corrected in place by a later assistant_message
 * carrying replaceMessageId, mirroring the corrected-message-end behavior
 * recorded at the Pi RPC level in
 * packages/protocol/fixtures/pi-rpc-events/scenarios/corrected-message-end.json.
 */
export const assistantMessageCorrectionScenario: TimelineFixtureScenario = {
  scenario: "assistant-message-correction",
  description:
    "A live agent_stream assistant_message row is redelivered verbatim (dedupe by epoch/seq), then corrected in place by a later assistant_message carrying replaceMessageId.",
  planRef:
    "plan.md §7.4 (deduplicate by epoch and sequence; apply replaceMessageId corrections in place; preserve daemon timestamps)",
  frames: [
    {
      id: "assistant-delta-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      note: "Streamed, not-yet-final assistant row.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0001",
            epoch: "epoch-t20a-0001",
            seq: 10,
            timestamp: "2026-09-01T10:00:00.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Draft answer for /synthetic/workspace/demo-repo",
                messageId: "msg_t20a_0001",
              },
            },
          },
        },
      },
    },
    {
      id: "assistant-delta-1-resend",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      note: "Exact re-delivery of assistant-delta-1 (same epoch+seq): must dedupe to a no-op, never a second row.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0001",
            epoch: "epoch-t20a-0001",
            seq: 10,
            timestamp: "2026-09-01T10:00:00.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Draft answer for /synthetic/workspace/demo-repo",
                messageId: "msg_t20a_0001",
              },
            },
          },
        },
      },
    },
    {
      id: "assistant-correction-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message corrected)",
      note: "Authoritative correction: replaceMessageId targets msg_t20a_0001 and must replace that row in place, not append a new one.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0001",
            epoch: "epoch-t20a-0001",
            seq: 11,
            timestamp: "2026-09-01T10:00:05.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Final answer for /synthetic/workspace/demo-repo/README.md.",
                messageId: "msg_t20a_0002",
                replaceMessageId: "msg_t20a_0001",
                corrected: true,
              },
            },
          },
        },
      },
    },
  ],
};
