import type { TimelineFixtureScenario } from "../types.js";

/**
 * Two interleaved tool calls stream start/update/end rows over agent_stream.
 * Updates for the same callId must stay attached to their one row (never
 * fork a second row), independent calls must stay independent, and an exact
 * re-delivery must dedupe to a no-op.
 */
export const toolCallLifecycleScenario: TimelineFixtureScenario = {
  scenario: "tool-call-lifecycle",
  description:
    "Two interleaved tool calls stream start/update/end rows over agent_stream, exercising callId attachment and dedupe.",
  planRef:
    "plan.md §7.4 (deduplicate by epoch and sequence; keep tool execution updates attached to their tool call; preserve daemon timestamps)",
  frames: [
    {
      id: "tool-call-a-start",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call running)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 20,
            timestamp: "2026-09-01T11:00:00.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0001",
                name: "read_file",
                status: "running",
                error: null,
                detail: {
                  type: "read",
                  filePath: "/synthetic/workspace/demo-repo/README.md",
                },
              },
            },
          },
        },
      },
    },
    {
      id: "tool-call-b-start",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call running)",
      note: "A second, independent tool call interleaved between call_t20a_0001's own updates.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 21,
            timestamp: "2026-09-01T11:00:01.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0002",
                name: "bash",
                status: "running",
                error: null,
                detail: {
                  type: "shell",
                  command: "echo synthetic",
                },
              },
            },
          },
        },
      },
    },
    {
      id: "tool-call-a-update",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call running)",
      note: "Streaming update for call_t20a_0001 must merge into its existing row, not create a third row.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 22,
            timestamp: "2026-09-01T11:00:02.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0001",
                name: "read_file",
                status: "running",
                error: null,
                detail: {
                  type: "read",
                  filePath: "/synthetic/workspace/demo-repo/README.md",
                  content: "partial synthetic content",
                },
              },
            },
          },
        },
      },
    },
    {
      id: "tool-call-a-end",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call completed)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 23,
            timestamp: "2026-09-01T11:00:03.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0001",
                name: "read_file",
                status: "completed",
                error: null,
                detail: {
                  type: "read",
                  filePath: "/synthetic/workspace/demo-repo/README.md",
                  content: "full synthetic content",
                },
              },
            },
          },
        },
      },
    },
    {
      id: "tool-call-a-end-resend",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call completed)",
      note: "Exact re-delivery of tool-call-a-end (same epoch+seq): must dedupe to a no-op.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 23,
            timestamp: "2026-09-01T11:00:03.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0001",
                name: "read_file",
                status: "completed",
                error: null,
                detail: {
                  type: "read",
                  filePath: "/synthetic/workspace/demo-repo/README.md",
                  content: "full synthetic content",
                },
              },
            },
          },
        },
      },
    },
    {
      id: "tool-call-b-end",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline tool_call completed)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20a_0002",
            epoch: "epoch-t20a-0002",
            seq: 24,
            timestamp: "2026-09-01T11:00:04.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "tool_call",
                callId: "call_t20a_0002",
                name: "bash",
                status: "completed",
                error: null,
                detail: {
                  type: "shell",
                  command: "echo synthetic",
                  output: "synthetic\n",
                  exitCode: 0,
                },
              },
            },
          },
        },
      },
    },
  ],
};
