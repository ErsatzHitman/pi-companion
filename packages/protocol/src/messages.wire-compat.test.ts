import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AgentPermissionResolvedMessageSchema,
  AgentSnapshotPayloadSchema,
  AgentStreamEventPayloadSchema,
  AgentTimelineItemPayloadSchema,
  ServerInfoStatusPayloadSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

const LegacySubAgentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  error: z.unknown().nullable(),
  detail: z.object({
    type: z.literal("sub_agent"),
    subAgentType: z.string().optional(),
    description: z.string().optional(),
    log: z.string(),
    // Copied from v0.1.65-beta.3: actions was required even though the UI ignored it.
    actions: z.array(
      z.object({
        index: z.number().int().positive(),
        toolName: z.string(),
        summary: z.string().optional(),
      }),
    ),
  }),
});

const LegacyAgentCapabilityFlagsSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
});

const LegacyAgentSnapshotPayloadSchema = AgentSnapshotPayloadSchema.extend({
  capabilities: LegacyAgentCapabilityFlagsSchema,
});

describe("wire schema compatibility", () => {
  test("hello parses with and without the project update capability", () => {
    const legacy = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "legacy-client",
      clientType: "mobile",
      protocolVersion: 1,
    });
    const capable = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "capable-client",
      clientType: "mobile",
      protocolVersion: 1,
      capabilities: { project_updates: true },
    });

    expect([legacy, capable]).toEqual([
      {
        type: "hello",
        clientId: "legacy-client",
        clientType: "mobile",
        protocolVersion: 1,
      },
      {
        type: "hello",
        clientId: "capable-client",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: { project_updates: true },
      },
    ]);
  });

  test("server info strips unknown legacy features while accepting former turn identity", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "legacy-server",
      features: {
        workspaceGithubClone: true,
        agentTurnIdentity: true,
      },
    });

    expect(parsed).toEqual({
      status: "server_info",
      serverId: "legacy-server",
      hostname: null,
      version: null,
      features: { agentTurnIdentity: true },
    });
  });

  test("assistant timeline message ids are optional on the wire", () => {
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "old daemon shape",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "old daemon shape",
    });
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "new daemon shape",
        messageId: "msg-1",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "new daemon shape",
      messageId: "msg-1",
    });
  });

  test("user_message and assistant_message images round-trip through the wire schema (T52A1)", () => {
    const userMessage = {
      type: "user_message",
      text: "see attached",
      images: [{ mimeType: "image/png", path: "/tmp/paseo-attachments/abc123.png", bytes: 42 }],
    };
    expect(AgentTimelineItemPayloadSchema.parse(userMessage)).toEqual(userMessage);

    const assistantMessage = {
      type: "assistant_message",
      text: "here is a screenshot",
      images: [{ mimeType: "image/webp", path: "/tmp/paseo-attachments/def456.webp" }],
    };
    expect(AgentTimelineItemPayloadSchema.parse(assistantMessage)).toEqual(assistantMessage);

    // Older daemons/clients never sent `images` at all — must still parse
    // with no `images` key at all (not `undefined`), matching the pre-T52A1
    // wire shape exactly.
    const legacyUserMessage = { type: "user_message", text: "no picture here" };
    expect(AgentTimelineItemPayloadSchema.parse(legacyUserMessage)).toEqual(legacyUserMessage);
  });

  test("an agent_stream timeline event with a message image validates through the AOT fast-path validator (T52A1)", () => {
    // `validateWSOutboundMessage` is the zod-aot-compiled validator the
    // daemon actually runs on the hot path (see `validation/ws-outbound.ts`)
    // — a separately generated artifact from `AgentTimelineItemPayloadSchema`
    // above, so it needs its own proof the new `images` field is not
    // stripped or rejected there too.
    const message = {
      type: "session",
      message: {
        type: "agent_stream",
        payload: {
          agentId: "agent-1",
          event: {
            type: "timeline",
            provider: "pi",
            item: {
              type: "user_message",
              text: "see attached",
              images: [
                { mimeType: "image/png", path: "/tmp/paseo-attachments/abc123.png", bytes: 42 },
              ],
            },
          },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      },
    };

    const result = validateWSOutboundMessage(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(message);
    }
  });

  test("sub_agent tool-call payload still parses against the v0.1.65-beta.3 schema", () => {
    const parsed = LegacySubAgentToolCallSchema.parse({
      type: "tool_call",
      callId: "call-sub-agent-1",
      name: "Task",
      status: "completed",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        childSessionId: "child-session-1",
        log: "[Read] README.md",
        actions: [],
      },
    });

    expect(parsed.detail.actions).toEqual([]);
  });

  test("old clients parse agent snapshots with rewind capabilities", () => {
    const parsed = LegacyAgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
        supportsRewindFiles: true,
        supportsRewindBoth: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities).toEqual({
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    });
  });

  test("new clients parse agent snapshots without rewind capabilities", () => {
    const parsed = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
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
    });

    expect(parsed.capabilities.supportsRewindConversation).toBe(false);
    expect(parsed.capabilities.supportsRewindFiles).toBe(false);
    expect(parsed.capabilities.supportsRewindBoth).toBe(false);
  });

  test("agent_permission_resolved parses without answeredBy exactly like before T111", () => {
    // The pre-T111 wire shape: no `answeredBy` key at all. Every consumer
    // (`RequestArbitrator`, `outcome-notice.ts`) must keep behaving exactly
    // as it did before this field existed.
    const legacy = {
      agentId: "agt_fixture_0001",
      requestId: "perm_fixture_0001",
      resolution: { behavior: "allow", selectedActionId: "allow_once" },
    };
    const parsed = AgentPermissionResolvedMessageSchema.shape.payload.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect(parsed.answeredBy).toBeUndefined();
  });

  test("agent_permission_resolved round-trips answeredBy when the daemon supplies it (T111)", () => {
    const withAnsweredBy = {
      agentId: "agt_fixture_0001",
      requestId: "perm_fixture_0001",
      resolution: { behavior: "allow", selectedActionId: "allow_once" },
      answeredBy: { clientId: "clid_fixture_0002" },
    };
    const parsed = AgentPermissionResolvedMessageSchema.shape.payload.parse(withAnsweredBy);
    expect(parsed).toEqual(withAnsweredBy);

    // A daemon that only knows a human-readable label (no client id) is
    // equally valid — both fields on `answeredBy` are independently optional.
    const labelOnly = {
      agentId: "agt_fixture_0001",
      requestId: "perm_fixture_0001",
      resolution: { behavior: "deny" },
      answeredBy: { label: "Android" },
    };
    expect(AgentPermissionResolvedMessageSchema.shape.payload.parse(labelOnly)).toEqual(labelOnly);
  });

  test("an agent_permission_resolved message with answeredBy validates through the AOT fast-path validator (T111)", () => {
    // Same "the hand-written zod schema is not the only place this must
    // work" proof `messages.attachments.test.ts`'s images test above uses:
    // `validateWSOutboundMessage` is the separately-generated zod-aot
    // validator the daemon actually runs on the hot path.
    const message = {
      type: "session",
      message: {
        type: "agent_permission_resolved",
        payload: {
          agentId: "agt_fixture_0001",
          requestId: "perm_fixture_0001",
          resolution: { behavior: "allow", selectedActionId: "allow_once" },
          answeredBy: { clientId: "clid_fixture_0002" },
        },
      },
    };

    const result = validateWSOutboundMessage(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(message);
    }
  });

  test("pi.ui.action.response parses without answeredBy exactly like before T128", () => {
    // The pre-T128 wire shape: no `answeredBy` key at all. Every consumer
    // (`ExtensionActionController`) must keep behaving exactly as it did
    // before this field existed.
    const legacy = { requestId: "req_fixture_action_0004", ok: true, error: null };
    const parsed = SessionOutboundMessageSchema.parse({
      type: "pi.ui.action.response",
      payload: legacy,
    });
    expect(parsed).toEqual({ type: "pi.ui.action.response", payload: legacy });
    if (parsed.type === "pi.ui.action.response") {
      expect(parsed.payload.answeredBy).toBeUndefined();
    }
  });

  test("pi.ui.action.response round-trips answeredBy when the daemon supplies it (T128)", () => {
    const withAnsweredBy = {
      requestId: "req_fixture_action_0004",
      ok: true,
      error: null,
      answeredBy: { clientId: "clid_fixture_0002" },
    };
    const parsed = SessionOutboundMessageSchema.parse({
      type: "pi.ui.action.response",
      payload: withAnsweredBy,
    });
    expect(parsed).toEqual({ type: "pi.ui.action.response", payload: withAnsweredBy });

    // A daemon that only knows a human-readable label (no client id) is
    // equally valid — both fields on `answeredBy` are independently optional.
    const labelOnly = {
      requestId: "req_fixture_action_0005",
      ok: false,
      error: "denied",
      answeredBy: { label: "Android" },
    };
    expect(
      SessionOutboundMessageSchema.parse({ type: "pi.ui.action.response", payload: labelOnly }),
    ).toEqual({ type: "pi.ui.action.response", payload: labelOnly });
  });

  test("pi_ui_action_result parses without answeredBy exactly like before T128", () => {
    const legacy = {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
    };
    const parsed = AgentStreamEventPayloadSchema.parse(legacy);
    expect(parsed).toEqual(legacy);
    if (parsed.type === "pi_ui_action_result") {
      expect(parsed.answeredBy).toBeUndefined();
    }
  });

  test("pi_ui_action_result round-trips answeredBy when the daemon supplies it (T128)", () => {
    const withAnsweredBy = {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
      answeredBy: { clientId: "clid_fixture_0002" },
    };
    expect(AgentStreamEventPayloadSchema.parse(withAnsweredBy)).toEqual(withAnsweredBy);
  });

  test("a pi_ui_action_result agent_stream event with answeredBy validates through the AOT fast-path validator (T128)", () => {
    // `validateWSOutboundMessage` is the zod-aot-compiled validator the
    // daemon actually runs on the hot path — a separately generated artifact
    // from `AgentStreamEventPayloadSchema` above, so it needs its own proof
    // the new `answeredBy` field is not stripped or rejected there too.
    const message = {
      type: "session",
      message: {
        type: "agent_stream",
        payload: {
          agentId: "agt_fixture_0001",
          event: {
            type: "pi_ui_action_result",
            provider: "pi",
            result: { actionId: "undo", elementId: "arbitrage-suggestion", ok: true },
            answeredBy: { clientId: "clid_fixture_0002" },
          },
          timestamp: "2026-08-31T10:14:03.000Z",
        },
      },
    };

    const result = validateWSOutboundMessage(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(message);
    }
  });

  test("a pi.ui.action.response message with answeredBy validates through the AOT fast-path validator (T128)", () => {
    const message = {
      type: "session",
      message: {
        type: "pi.ui.action.response",
        payload: {
          requestId: "req_fixture_action_0004",
          ok: true,
          error: null,
          answeredBy: { clientId: "clid_fixture_0002" },
        },
      },
    };

    const result = validateWSOutboundMessage(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(message);
    }
  });
});
