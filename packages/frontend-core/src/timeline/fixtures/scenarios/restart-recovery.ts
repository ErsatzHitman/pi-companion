import type { TimelineFixtureScenario } from "../types.js";

/**
 * The user submits a prompt mid-turn (an optimistic row, not yet
 * daemon-confirmed) and the daemon restarts before acknowledging it. On
 * reconnect the client's cursor is unreadable (new epoch), so the response
 * is a full reset — but it replays the submission as a confirmed
 * `user_message` carrying the same `clientMessageId`, plus the tool call
 * the turn had already started. Recovery must both discard the stale
 * pre-restart epoch's rows and reconcile the still-pending optimistic
 * submission against the replayed one, without ever duplicating it.
 */
export const restartRecoveryScenario: TimelineFixtureScenario = {
  scenario: "restart-recovery",
  description:
    "A daemon restart occurs mid-turn, after the client added an optimistic row for its own not-yet-confirmed submission. The reset replay window confirms that same submission (matching clientMessageId) alongside the turn's tool call, and the optimistic row must reconcile rather than duplicate.",
  planRef:
    "plan.md §7.4 (recover after app restart during an active turn; reconcile optimistic user rows with accepted daemon rows)",
  frames: [
    {
      id: "fetch-timeline-response-restart",
      direction: "daemon_to_client",
      wireType: "session(fetch_agent_timeline_response)",
      note: "epoch changed across the daemon restart: reset=true forces a full replay. The replay includes the client's own in-flight submission, now confirmed with the daemon-assigned messageId but the same clientMessageId the optimistic row used.",
      message: {
        type: "session",
        message: {
          type: "fetch_agent_timeline_response",
          payload: {
            requestId: "req_t20b_restart_0001",
            agentId: "agt_fixture_t20b_0003",
            agent: null,
            direction: "tail",
            projection: "projected",
            epoch: "epoch-t20b-0003-after-restart",
            reset: true,
            staleCursor: true,
            gap: true,
            window: { minSeq: 0, maxSeq: 1, nextSeq: 2 },
            startCursor: { epoch: "epoch-t20b-0003-after-restart", seq: 0 },
            endCursor: { epoch: "epoch-t20b-0003-after-restart", seq: 1 },
            hasOlder: false,
            hasNewer: false,
            entries: [
              {
                provider: "pi",
                item: {
                  type: "user_message",
                  text: "Continue the refactor and run the tests.",
                  messageId: "msg_t20b_0040",
                  clientMessageId: "cmid_t20b_0002",
                },
                timestamp: "2026-09-01T16:00:00.000Z",
                seqStart: 0,
                seqEnd: 0,
                sourceSeqRanges: [{ startSeq: 0, endSeq: 0 }],
                collapsed: [],
              },
              {
                provider: "pi",
                item: {
                  type: "tool_call",
                  callId: "call_t20b_0002",
                  name: "bash",
                  status: "running",
                  error: null,
                  detail: { type: "shell", command: "npm test" },
                },
                timestamp: "2026-09-01T16:00:01.000Z",
                seqStart: 1,
                seqEnd: 1,
                sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }],
                collapsed: [],
              },
            ],
            error: null,
          },
        },
      },
    },
  ],
};
