import type { TimelineFixtureScenario } from "../types.js";

/**
 * A user message carrying one referenced image alongside text, and a
 * text-only assistant reply, followed by a corrected assistant message
 * (`replaceMessageId`) that itself now carries an image — the `custom`
 * message shape `history-mapper.ts` can map to `assistant_message` when it
 * carries a display-eligible image (T52A1). Exercises T52A2's `images`
 * passthrough on both `user-message` and `assistant-message` transcript
 * entries, including the "entries without them are unchanged" case (the
 * plain-text assistant reply carries no `images` key at all).
 */
export const messageAttachmentsScenario: TimelineFixtureScenario = {
  scenario: "message-attachments",
  description:
    "A user_message with one referenced image, a text-only assistant_message with no images, and a corrected assistant_message that carries an image (T52A1/T52A2).",
  planRef: "plan.md §7.4, §11.1, §11.6 (transcript view model); T52A1/T52A2",
  frames: [
    {
      id: "user-message-with-image",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline user_message)",
      note: "The image is referenced (materialized path), never inlined base64 (T52A1 acceptance).",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t52a2_0001",
            epoch: "epoch-t52a2-0001",
            seq: 1,
            timestamp: "2026-09-02T10:00:00.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "user_message",
                text: "What is wrong with this screenshot?",
                messageId: "msg_t52a2_0001",
                images: [
                  {
                    mimeType: "image/png",
                    path: "/synthetic/attachments/t52a2-0001.png",
                    bytes: 48213,
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      id: "assistant-reply-draft",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      note: "Plain text-only reply: carries no images key at all.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t52a2_0001",
            epoch: "epoch-t52a2-0001",
            seq: 2,
            timestamp: "2026-09-02T10:00:01.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Looking at it now...",
                messageId: "msg_t52a2_0002",
              },
            },
          },
        },
      },
    },
    {
      id: "assistant-reply-correction-with-image",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:timeline assistant_message)",
      note: "Replaces msg_t52a2_0002 in place and adds an annotated image.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t52a2_0001",
            epoch: "epoch-t52a2-0001",
            seq: 3,
            timestamp: "2026-09-02T10:00:02.000Z",
            event: {
              type: "timeline",
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "The button is missing its focus ring, see the annotated version.",
                messageId: "msg_t52a2_0002",
                replaceMessageId: "msg_t52a2_0002",
                corrected: true,
                images: [
                  {
                    mimeType: "image/png",
                    path: "/synthetic/attachments/t52a2-0002-annotated.png",
                    bytes: 51002,
                  },
                ],
              },
            },
          },
        },
      },
    },
  ],
};
