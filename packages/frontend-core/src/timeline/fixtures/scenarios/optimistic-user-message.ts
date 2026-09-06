import type { TimelineFixtureScenario } from "../types.js";

/**
 * The user submits a prompt (added locally as an optimistic row, before any
 * daemon acknowledgment), the daemon streams back the confirmed
 * `user_message` row carrying the same `clientMessageId`, and finally an
 * assistant reply. Exercises reconciling the optimistic row away without
 * ever showing it twice, while an unrelated, still-unconfirmed submission
 * stays pending.
 */
export const optimisticUserMessageScenario: TimelineFixtureScenario = {
  scenario: "optimistic-user-message",
  description:
    "A confirmed user_message row carrying a clientMessageId reconciles the matching optimistic row, while a second, still-unconfirmed submission stays pending.",
  planRef: "plan.md §7.4 (reconcile optimistic user rows with accepted daemon rows)",
  frames: [
    {
      id: "confirmed-user-message",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline user_message)",
      note: "Confirms the client's own submission: same clientMessageId as the optimistic row added locally before this arrived.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20b_0002",
            epoch: "epoch-t20b-0002",
            seq: 30,
            timestamp: "2026-09-01T15:00:00.500Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "user_message",
                text: "Summarize the open pull requests.",
                messageId: "msg_t20b_0030",
                clientMessageId: "cmid_t20b_0001",
              },
            },
          },
        },
      },
    },
    {
      id: "assistant-reply",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t20b_0002",
            epoch: "epoch-t20b-0002",
            seq: 31,
            timestamp: "2026-09-01T15:00:02.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "There are three open pull requests awaiting review.",
                messageId: "msg_t20b_0031",
              },
            },
          },
        },
      },
    },
  ],
};
