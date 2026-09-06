import { describe, expect, it } from "vitest";
import {
  GetQueueModesRequestMessageSchema,
  GetQueueModesResponseMessageSchema,
  SendAgentMessageRequestSchema,
  SendAgentMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  SetFollowUpModeRequestMessageSchema,
  SetFollowUpModeResponseMessageSchema,
  SetSteeringModeRequestMessageSchema,
  SetSteeringModeResponseMessageSchema,
} from "./messages.js";

// T38B0a — queue-mode (steering / follow-up) and per-message routing protocol
// types. Verified against the installed Pi
// (C:\Users\aksha\AppData\Local\pi-node\current\node_modules\@earendil-works\pi-coding-agent):
// dist/modes/rpc/rpc-mode.js:405-412 handles "set_steering_mode" and
// "set_follow_up_mode"; RpcSessionState in dist/modes/rpc/rpc-types.d.ts
// carries steeringMode/followUpMode; RpcCommand's "prompt" variant carries an
// optional streamingBehavior: "steer" | "followUp".

describe("prompt message streamingBehavior — omission preserves today's behaviour", () => {
  const basePayload = {
    type: "send_agent_message_request" as const,
    requestId: "req-1",
    agentId: "agent-1",
    text: "hello",
  };

  it("round-trips with the field absent (today's behaviour, unchanged)", () => {
    const parsed = SendAgentMessageRequestSchema.parse(basePayload);

    expect(parsed.streamingBehavior).toBeUndefined();
    expect("streamingBehavior" in basePayload).toBe(false);
    // The parsed value survives a JSON round trip identically to the input:
    // no key materializes for the field that was never sent.
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(basePayload);
  });

  it("round-trips through the SessionInboundMessageSchema union with the field absent", () => {
    const parsed = SessionInboundMessageSchema.parse(basePayload);

    expect(parsed.type).toBe("send_agent_message_request");
    if (parsed.type !== "send_agent_message_request") {
      throw new Error("Expected send_agent_message_request");
    }
    expect(parsed.streamingBehavior).toBeUndefined();
  });

  it("accepts an explicit steer routing", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      ...basePayload,
      streamingBehavior: "steer",
    });

    expect(parsed.streamingBehavior).toBe("steer");
  });

  it("accepts an explicit followUp routing", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      ...basePayload,
      streamingBehavior: "followUp",
    });

    expect(parsed.streamingBehavior).toBe("followUp");
  });

  it("rejects a value outside Pi's steer | followUp union", () => {
    const parsed = SendAgentMessageRequestSchema.safeParse({
      ...basePayload,
      streamingBehavior: "queue",
    });

    expect(parsed.success).toBe(false);
  });

  it("also round-trips on the fire-and-forget send_agent_message variant", () => {
    const withField = SendAgentMessageSchema.parse({
      type: "send_agent_message",
      agentId: "agent-1",
      text: "hello",
      streamingBehavior: "steer",
    });
    const withoutField = SendAgentMessageSchema.parse({
      type: "send_agent_message",
      agentId: "agent-1",
      text: "hello",
    });

    expect(withField.streamingBehavior).toBe("steer");
    expect(withoutField.streamingBehavior).toBeUndefined();
  });
});

describe("set_steering_mode / set_follow_up_mode request+response types", () => {
  it("round-trips a set_steering_mode request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "set_steering_mode_request",
      agentId: "agent-1",
      mode: "all",
      requestId: "req-2",
    });

    expect(parsed).toEqual(
      SetSteeringModeRequestMessageSchema.parse({
        type: "set_steering_mode_request",
        agentId: "agent-1",
        mode: "all",
        requestId: "req-2",
      }),
    );
  });

  it("round-trips a set_follow_up_mode request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "set_follow_up_mode_request",
      agentId: "agent-1",
      mode: "one-at-a-time",
      requestId: "req-3",
    });

    expect(parsed).toEqual(
      SetFollowUpModeRequestMessageSchema.parse({
        type: "set_follow_up_mode_request",
        agentId: "agent-1",
        mode: "one-at-a-time",
        requestId: "req-3",
      }),
    );
  });

  it("rejects a mode outside Pi's all | one-at-a-time union", () => {
    const steering = SetSteeringModeRequestMessageSchema.safeParse({
      type: "set_steering_mode_request",
      agentId: "agent-1",
      mode: "sometimes",
      requestId: "req-4",
    });
    const followUp = SetFollowUpModeRequestMessageSchema.safeParse({
      type: "set_follow_up_mode_request",
      agentId: "agent-1",
      mode: "sometimes",
      requestId: "req-4",
    });

    expect(steering.success).toBe(false);
    expect(followUp.success).toBe(false);
  });

  it("round-trips set_steering_mode and set_follow_up_mode responses through the outbound union", () => {
    const steeringResponse = SessionOutboundMessageSchema.parse({
      type: "set_steering_mode_response",
      payload: {
        requestId: "req-2",
        agentId: "agent-1",
        accepted: true,
        error: null,
      },
    });
    const followUpResponse = SessionOutboundMessageSchema.parse({
      type: "set_follow_up_mode_response",
      payload: {
        requestId: "req-3",
        agentId: "agent-1",
        accepted: true,
        error: null,
      },
    });

    expect(steeringResponse).toEqual(
      SetSteeringModeResponseMessageSchema.parse({
        type: "set_steering_mode_response",
        payload: { requestId: "req-2", agentId: "agent-1", accepted: true, error: null },
      }),
    );
    expect(followUpResponse).toEqual(
      SetFollowUpModeResponseMessageSchema.parse({
        type: "set_follow_up_mode_response",
        payload: { requestId: "req-3", agentId: "agent-1", accepted: true, error: null },
      }),
    );
  });
});

describe("get_queue_modes request+response types", () => {
  it("round-trips a request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "get_queue_modes_request",
      agentId: "agent-1",
      requestId: "req-5",
    });

    expect(parsed).toEqual(
      GetQueueModesRequestMessageSchema.parse({
        type: "get_queue_modes_request",
        agentId: "agent-1",
        requestId: "req-5",
      }),
    );
  });

  it("round-trips a response carrying both modes, sourced rather than cached", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "get_queue_modes_response",
      payload: {
        requestId: "req-5",
        agentId: "agent-1",
        steeringMode: "all",
        followUpMode: "one-at-a-time",
        error: null,
      },
    });

    expect(parsed).toEqual(
      GetQueueModesResponseMessageSchema.parse({
        type: "get_queue_modes_response",
        payload: {
          requestId: "req-5",
          agentId: "agent-1",
          steeringMode: "all",
          followUpMode: "one-at-a-time",
          error: null,
        },
      }),
    );
  });

  it("accepts null modes for an agent whose provider is not Pi", () => {
    const parsed = GetQueueModesResponseMessageSchema.parse({
      type: "get_queue_modes_response",
      payload: {
        requestId: "req-6",
        agentId: "agent-1",
        steeringMode: null,
        followUpMode: null,
        error: null,
      },
    });

    expect(parsed.payload.steeringMode).toBeNull();
    expect(parsed.payload.followUpMode).toBeNull();
  });
});
