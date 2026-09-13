import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import type { SessionOutboundMessage } from "./messages.js";
import { Session, type SessionOptions } from "./session.js";
import {
  asAgentManager,
  asAgentStorage,
  asChatService,
  asCheckoutDiffManager,
  asDaemonConfigStore,
  asDownloadTokenStore,
  asGitHubService,
  asLoopService,
  asPushTokenStore,
  asScheduleService,
  asWorkspaceGitService,
  createProviderSnapshotManagerStub,
} from "./test-utils/session-stubs.js";

function makeManagedAgent(id: string) {
  return {
    id,
    provider: "pi",
    cwd: "/tmp/paseo-fork-test",
    workspaceId: undefined,
    session: null,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
      supportsRewindConversation: true,
      supportsRewindFiles: false,
      supportsRewindBoth: false,
    },
    config: { provider: "pi", cwd: "/tmp/paseo-fork-test" },
    runtimeInfo: undefined,
    lifecycle: "idle",
    createdAt: new Date("2026-09-13T00:00:00.000Z"),
    updatedAt: new Date("2026-09-13T00:00:00.000Z"),
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    activeForegroundTurnId: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    persistence: null,
    historyPrimed: true,
    lastUserMessageAt: null,
    lastUsage: undefined,
    lastError: undefined,
    attention: { requiresAttention: false },
    internal: false,
    labels: {},
  };
}

function createSessionForForkTest(
  options: {
    messages?: SessionOutboundMessage[];
    agentManager?: { [K in keyof SessionOptions["agentManager"]]?: unknown };
    agentStorage?: { [K in keyof SessionOptions["agentStorage"]]?: unknown };
  } = {},
): { session: Session; messages: SessionOutboundMessage[] } {
  const logger = pino({ level: "silent" });
  const messages = (options.messages ?? []) as SessionOutboundMessage[];
  const github = {
    invalidate: vi.fn(),
    searchIssuesAndPrs: vi.fn(),
    createPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
  };
  const sessionOptions: SessionOptions = {
    clientId: "test-client",
    onMessage: (message) => messages.push(message),
    logger,
    downloadTokenStore: asDownloadTokenStore(),
    pushTokenStore: asPushTokenStore(),
    paseoHome: "/tmp/paseo-home",
    agentManager: asAgentManager({
      listAgents: vi.fn(() => []),
      listProviderSubagentActivity: vi.fn(() => []),
      subscribe: vi.fn(() => () => {}),
      ...options.agentManager,
    }),
    agentStorage: asAgentStorage({
      get: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      ...options.agentStorage,
    }),
    projectRegistry: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getOrCreateActiveByRoot: vi.fn(),
      upsert: vi.fn(),
      archive: vi.fn(),
      remove: vi.fn(),
      initialize: vi.fn(),
      existsOnDisk: vi.fn(),
    },
    workspaceRegistry: {
      get: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
    chatService: asChatService(),
    scheduleService: asScheduleService(),
    loopService: asLoopService(),
    checkoutDiffManager: asCheckoutDiffManager({ scheduleRefreshForCwd: vi.fn() }),
    github: asGitHubService(github),
    workspaceGitService: asWorkspaceGitService({
      getCheckout: vi.fn(),
      getCheckoutDiff: vi.fn(),
      getSnapshot: vi.fn(),
      suggestBranchesForCwd: vi.fn(),
      listStashes: vi.fn(),
      peekSnapshot: vi.fn(),
      validateBranchRef: vi.fn(),
      hasLocalBranch: vi.fn(),
      resolveRepoRemoteUrl: vi.fn(),
      resolveRepoRoot: vi.fn(),
      getWorkspaceGitMetadata: vi.fn(),
      resolveForge: vi.fn().mockResolvedValue({ forge: "github", service: github }),
      invalidateForge: vi.fn(),
      getProjectSlug: vi.fn(),
    }),
    daemonConfigStore: asDaemonConfigStore({
      get: vi.fn(() => ({ mcp: { injectIntoAgents: false }, providers: {} })),
      onChange: vi.fn(() => () => {}),
    }),
    stt: null,
    tts: null,
    terminalManager: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    scopes: ["*"],
  };
  return { session: new Session(sessionOptions), messages };
}

function forkRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: "agent.fork.request",
    agentId: "agent-1",
    entryId: "entry-42",
    requestId: "fork-1",
    ...overrides,
  } as const;
}

describe("session agent.fork.request", () => {
  test("dispatches to agent.fork.response with the forked agent payload", async () => {
    const source = makeManagedAgent("agent-1");
    const child = makeManagedAgent("agent-2");
    const forkAgent = vi.fn(async () => ({
      ...child,
      agent: { ...child },
      forkPoint: { messageId: "entry-42", index: 0 },
    }));
    const { session, messages } = createSessionForForkTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn((id: string) => (id === "agent-1" ? source : null)),
        forkAgent,
      },
    });

    await session.handleMessage(forkRequest());

    expect(forkAgent).toHaveBeenCalledTimes(1);
    const response = messages.find((msg) => msg.type === "agent.fork.response");
    expect(response).toMatchObject({
      type: "agent.fork.response",
      payload: {
        requestId: "fork-1",
        agentId: "agent-1",
        agent: expect.objectContaining({ id: "agent-2" }),
        forkPoint: { messageId: "entry-42", index: 0 },
        error: null,
      },
    });
  });

  test("forwards an optional name to forkAgent", async () => {
    const source = makeManagedAgent("agent-1");
    const child = makeManagedAgent("agent-2");
    const forkAgent = vi.fn(async () => ({
      ...child,
      agent: { ...child },
      forkPoint: { messageId: "entry-42", index: 0 },
    }));
    const { session } = createSessionForForkTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        forkAgent,
      },
    });

    await session.handleMessage(forkRequest({ name: "explored branch" }));

    expect(forkAgent).toHaveBeenCalledWith("agent-1", "entry-42", "explored branch");
  });

  test("emits an error envelope without throwing when forkAgent rejects", async () => {
    const source = makeManagedAgent("agent-1");
    const forkAgent = vi.fn(async () => {
      throw new Error("unknown entry entry-missing");
    });
    const { session, messages } = createSessionForForkTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        forkAgent,
      },
    });

    await expect(
      session.handleMessage(forkRequest({ entryId: "entry-missing", requestId: "fork-err" })),
    ).resolves.toBeUndefined();

    expect(messages).toContainEqual({
      type: "agent.fork.response",
      payload: {
        requestId: "fork-err",
        agentId: "agent-1",
        agent: null,
        forkPoint: null,
        error: "unknown entry entry-missing",
      },
    });
  });

  test("emits an error envelope for an unknown agent without throwing", async () => {
    const { session, messages } = createSessionForForkTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => null),
      },
      agentStorage: {
        get: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      session.handleMessage(
        forkRequest({ agentId: "agent-missing", requestId: "fork-unknown-agent" }),
      ),
    ).resolves.toBeUndefined();

    const response = messages.find((msg) => msg.type === "agent.fork.response");
    expect(response).toMatchObject({
      type: "agent.fork.response",
      payload: {
        requestId: "fork-unknown-agent",
        agentId: "agent-missing",
        agent: null,
        forkPoint: null,
        error: expect.stringContaining("agent-missing"),
      },
    });
  });

  test("emits an error envelope for an unknown entryId without throwing", async () => {
    const source = makeManagedAgent("agent-1");
    const forkAgent = vi.fn(async () => {
      throw new Error("unknown entry entry-missing");
    });
    const { session, messages } = createSessionForForkTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        forkAgent,
      },
    });

    await expect(
      session.handleMessage(
        forkRequest({ entryId: "entry-missing", requestId: "fork-unknown-entry" }),
      ),
    ).resolves.toBeUndefined();

    expect(messages).toContainEqual({
      type: "agent.fork.response",
      payload: {
        requestId: "fork-unknown-entry",
        agentId: "agent-1",
        agent: null,
        forkPoint: null,
        error: "unknown entry entry-missing",
      },
    });
  });
});
