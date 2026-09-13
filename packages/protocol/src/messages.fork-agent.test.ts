import { describe, expect, test } from "vitest";

import {
  ForkAgentRequestMessageSchema,
  ForkAgentResponseMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

function agentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    provider: "claude",
    cwd: "/tmp/project",
    model: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    ...overrides,
  };
}

describe("fork agent messages", () => {
  test("agent.fork.request round-trips the full shape", () => {
    const request = {
      type: "agent.fork.request",
      agentId: "agent-1",
      entryId: "entry-42",
      entryIndex: 42,
      name: "explored branch",
      requestId: "fork-1",
    };
    expect(ForkAgentRequestMessageSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("agent.fork.request accepts the minimal shape without optionals", () => {
    const request = {
      type: "agent.fork.request",
      agentId: "agent-1",
      entryId: "entry-42",
      requestId: "fork-1",
    };
    const parsed = ForkAgentRequestMessageSchema.parse(request);
    expect(parsed).toEqual(request);
    expect(parsed.entryIndex).toBeUndefined();
    expect(parsed.name).toBeUndefined();
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("agent.fork.response round-trips a successful fork", () => {
    const response = {
      type: "agent.fork.response",
      payload: {
        requestId: "fork-1",
        agentId: "agent-1",
        agent: agentSnapshot({ id: "agent-2" }),
        forkPoint: { messageId: "entry-42", index: 42 },
        error: null,
      },
    };
    const parsed = ForkAgentResponseMessageSchema.parse(response);
    expect(parsed.payload.agent?.id).toBe("agent-2");
    expect(parsed.payload.forkPoint).toEqual({ messageId: "entry-42", index: 42 });
    expect(parsed.payload.error).toBeNull();
    expect(SessionOutboundMessageSchema.parse(response).type).toBe("agent.fork.response");
  });

  test("agent.fork.response carries a null agent and forkPoint on failure", () => {
    const response = {
      type: "agent.fork.response",
      payload: {
        requestId: "fork-1",
        agentId: "agent-1",
        agent: null,
        forkPoint: null,
        error: "unknown entry entry-42",
      },
    };
    expect(ForkAgentResponseMessageSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
