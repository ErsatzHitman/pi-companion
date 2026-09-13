import { describe, expect, it } from "vitest";
import {
  GetAutoRetryRequestMessageSchema,
  GetAutoRetryResponseMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  SetAutoRetryRequestMessageSchema,
  SetAutoRetryResponseMessageSchema,
} from "./messages.js";

// Auto-retry wire: same "set + dedicated get, modeled as its own
// request/response pair" shape as auto-compaction. Mirrors Pi's
// `set_auto_retry` RPC command in
// `packages/server/src/server/agent/providers/pi/rpc-types.ts`'s
// `PiRpcCommand` union.

describe("set_auto_retry / get_auto_retry request+response types", () => {
  it("round-trips a set_auto_retry request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "set_auto_retry_request",
      agentId: "agent-1",
      enabled: false,
      requestId: "req-retry-1",
    });

    expect(parsed).toEqual(
      SetAutoRetryRequestMessageSchema.parse({
        type: "set_auto_retry_request",
        agentId: "agent-1",
        enabled: false,
        requestId: "req-retry-1",
      }),
    );
  });

  it("round-trips a set_auto_retry response through the outbound union", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "set_auto_retry_response",
      payload: { requestId: "req-retry-1", agentId: "agent-1", accepted: true, error: null },
    });

    expect(parsed).toEqual(
      SetAutoRetryResponseMessageSchema.parse({
        type: "set_auto_retry_response",
        payload: { requestId: "req-retry-1", agentId: "agent-1", accepted: true, error: null },
      }),
    );
  });

  it("round-trips a get_auto_retry request through the inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "get_auto_retry_request",
      agentId: "agent-1",
      requestId: "req-retry-2",
    });

    expect(parsed).toEqual(
      GetAutoRetryRequestMessageSchema.parse({
        type: "get_auto_retry_request",
        agentId: "agent-1",
        requestId: "req-retry-2",
      }),
    );
  });

  it("round-trips a get_auto_retry response carrying a value", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "get_auto_retry_response",
      payload: { requestId: "req-retry-2", agentId: "agent-1", enabled: true, error: null },
    });

    expect(parsed).toEqual(
      GetAutoRetryResponseMessageSchema.parse({
        type: "get_auto_retry_response",
        payload: { requestId: "req-retry-2", agentId: "agent-1", enabled: true, error: null },
      }),
    );
  });

  it("accepts a null get_auto_retry value with an error (unsupported provider)", () => {
    const parsed = GetAutoRetryResponseMessageSchema.parse({
      type: "get_auto_retry_response",
      payload: {
        requestId: "req-retry-3",
        agentId: "agent-1",
        enabled: null,
        error: "Agent session does not support auto-retry",
      },
    });

    expect(parsed.payload.enabled).toBeNull();
  });

  it("rejects a set_auto_retry request with a non-boolean enabled flag", () => {
    const parsed = SetAutoRetryRequestMessageSchema.safeParse({
      type: "set_auto_retry_request",
      agentId: "agent-1",
      enabled: "yes",
      requestId: "req-retry-4",
    });

    expect(parsed.success).toBe(false);
  });
});
