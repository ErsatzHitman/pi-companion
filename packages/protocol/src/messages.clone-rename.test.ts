import { describe, expect, test } from "vitest";

import {
  CloneAgentRequestMessageSchema,
  CloneAgentResponseMessageSchema,
  RenameAgentRequestMessageSchema,
  RenameAgentResponseMessageSchema,
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

describe("clone agent messages", () => {
  test("agent.clone.request round-trips the full shape", () => {
    const request = {
      type: "agent.clone.request",
      agentId: "agent-1",
      name: "cloned branch",
      requestId: "clone-1",
    };
    expect(CloneAgentRequestMessageSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("agent.clone.request accepts the minimal shape without name", () => {
    const request = {
      type: "agent.clone.request",
      agentId: "agent-1",
      requestId: "clone-1",
    };
    const parsed = CloneAgentRequestMessageSchema.parse(request);
    expect(parsed).toEqual(request);
    expect(parsed.name).toBeUndefined();
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("agent.clone.response round-trips a successful clone", () => {
    const response = {
      type: "agent.clone.response",
      payload: {
        requestId: "clone-1",
        agentId: "agent-1",
        agent: agentSnapshot({ id: "agent-2" }),
        error: null,
      },
    };
    const parsed = CloneAgentResponseMessageSchema.parse(response);
    expect(parsed.payload.agent?.id).toBe("agent-2");
    expect(parsed.payload.error).toBeNull();
    expect(SessionOutboundMessageSchema.parse(response).type).toBe("agent.clone.response");
  });

  test("agent.clone.response carries a null agent on failure", () => {
    const response = {
      type: "agent.clone.response",
      payload: {
        requestId: "clone-1",
        agentId: "agent-1",
        agent: null,
        error: "Unknown agent 'agent-1'",
      },
    };
    expect(CloneAgentResponseMessageSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("rename agent messages", () => {
  test("agent.rename.request round-trips the full shape", () => {
    const request = {
      type: "agent.rename.request",
      agentId: "agent-1",
      name: "renamed agent",
      requestId: "rename-1",
    };
    expect(RenameAgentRequestMessageSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("agent.rename.response round-trips a successful rename", () => {
    const response = {
      type: "agent.rename.response",
      payload: {
        requestId: "rename-1",
        agentId: "agent-1",
        agent: agentSnapshot({ title: "renamed agent" }),
        error: null,
      },
    };
    const parsed = RenameAgentResponseMessageSchema.parse(response);
    expect(parsed.payload.agent?.title).toBe("renamed agent");
    expect(parsed.payload.error).toBeNull();
    expect(SessionOutboundMessageSchema.parse(response).type).toBe("agent.rename.response");
  });

  test("agent.rename.response carries a null agent on failure", () => {
    const response = {
      type: "agent.rename.response",
      payload: {
        requestId: "rename-1",
        agentId: "agent-1",
        agent: null,
        error: "name must be a non-empty string",
      },
    };
    expect(RenameAgentResponseMessageSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
