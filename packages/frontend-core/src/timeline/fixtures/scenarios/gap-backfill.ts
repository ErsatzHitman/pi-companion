import type { TimelineFixtureScenario } from "../types.js";

/**
 * A live agent_stream push jumps from seq 10 straight to seq 20, opening a
 * gap over [11, 19]. Two `fetch_agent_timeline_response` backfill pages
 * (each covering part of the hole, mirroring the daemon's projected-window
 * collapsing of several source sequences into one row) close it: the first
 * still leaves a smaller gap behind, and only the second fully resolves it
 * — exercising "pages until complete" rather than a single-page backfill.
 */
export const gapBackfillScenario: TimelineFixtureScenario = {
  scenario: "gap-backfill",
  description:
    "A live-stream seq jump opens a gap; two fetch_agent_timeline_response backfill pages close it in sequence, proving gap detection pages to completion rather than resolving in one round-trip.",
  planRef: "plan.md §7.4 (detect gaps and page until complete)",
  frames: [
    {
      id: "live-seq-10",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline user_message)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20b_0001",
            epoch: "epoch-t20b-0001",
            seq: 10,
            timestamp: "2026-09-01T14:00:00.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: { type: "user_message", text: "Investigate the failing build." },
            },
          },
        },
      },
    },
    {
      id: "live-seq-20",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      note: "Jumps straight from seq 10 to seq 20: seqs 11-19 are missing and must be detected as a gap, not silently skipped.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20b_0001",
            epoch: "epoch-t20b-0001",
            seq: 20,
            timestamp: "2026-09-01T14:00:10.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Found the root cause; opening a fix.",
                messageId: "msg_t20b_0020",
              },
            },
          },
        },
      },
    },
    {
      id: "gap-backfill-page-1",
      direction: "daemon_to_client",
      wireType: "session(fetch_agent_timeline_response)",
      note: "First backfill page, requested going backward from seq 20: covers source seqs 15-19 as one collapsed projected row, still leaving 11-14 missing.",
      message: {
        type: "session",
        message: {
          type: "fetch_agent_timeline_response",
          payload: {
            requestId: "req_t20b_gap_0001",
            agentId: "agt_fixture_t20b_0001",
            agent: null,
            direction: "before",
            projection: "projected",
            epoch: "epoch-t20b-0001",
            reset: false,
            staleCursor: false,
            gap: false,
            window: { minSeq: 15, maxSeq: 19, nextSeq: 20 },
            startCursor: { epoch: "epoch-t20b-0001", seq: 15 },
            endCursor: { epoch: "epoch-t20b-0001", seq: 19 },
            hasOlder: true,
            hasNewer: false,
            mergeWindow: true,
            entries: [
              {
                provider: "pi",
                item: { type: "reasoning", text: "Bisecting recent commits for the regression." },
                timestamp: "2026-09-01T14:00:05.000Z",
                seqStart: 15,
                seqEnd: 19,
                sourceSeqRanges: [{ startSeq: 15, endSeq: 19 }],
                collapsed: ["reasoning_merge"],
              },
            ],
            error: null,
          },
        },
      },
    },
    {
      id: "gap-backfill-page-2",
      direction: "daemon_to_client",
      wireType: "session(fetch_agent_timeline_response)",
      note: "Second backfill page, requested going backward from the now-earliest loaded seq (15): covers the remaining 11-14 hole and closes the gap.",
      message: {
        type: "session",
        message: {
          type: "fetch_agent_timeline_response",
          payload: {
            requestId: "req_t20b_gap_0002",
            agentId: "agt_fixture_t20b_0001",
            agent: null,
            direction: "before",
            projection: "projected",
            epoch: "epoch-t20b-0001",
            reset: false,
            staleCursor: false,
            gap: false,
            window: { minSeq: 11, maxSeq: 14, nextSeq: 15 },
            startCursor: { epoch: "epoch-t20b-0001", seq: 11 },
            endCursor: { epoch: "epoch-t20b-0001", seq: 14 },
            hasOlder: false,
            hasNewer: false,
            mergeWindow: true,
            entries: [
              {
                provider: "pi",
                item: {
                  type: "tool_call",
                  callId: "call_t20b_0001",
                  name: "bash",
                  status: "completed",
                  error: null,
                  detail: {
                    type: "shell",
                    command: "git bisect run npm test",
                    output: "first bad commit found\n",
                    exitCode: 0,
                  },
                },
                timestamp: "2026-09-01T14:00:02.000Z",
                seqStart: 11,
                seqEnd: 14,
                sourceSeqRanges: [{ startSeq: 11, endSeq: 14 }],
                collapsed: ["tool_lifecycle"],
              },
            ],
            error: null,
          },
        },
      },
    },
  ],
};
