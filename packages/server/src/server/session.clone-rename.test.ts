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
  asProviderUsageService,
  asScheduleService,
  asWorkspaceAutoName,
  asWorkspaceGitService,
  createProviderSnapshotManagerStub,
} from "./test-utils/session-stubs.js";

function makeManagedAgent(id: string) {
  return {
    id,
    provider: "pi",
    cwd: "/tmp/paseo-clone-rename-test",
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
    config: { provider: "pi", cwd: "/tmp/paseo-clone-rename-test" },
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

function createSessionForCloneRenameTest(
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
      update: vi.fn(),
      archive: vi.fn(),
      remove: vi.fn(),
      initialize: vi.fn(),
      existsOnDisk: vi.fn(),
    },
    workspaceRegistry: {
      get: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      initialize: vi.fn(),
      existsOnDisk: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      archive: vi.fn(),
      remove: vi.fn(),
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
    workspaceAutoName: asWorkspaceAutoName({}),
    providerUsageService: asProviderUsageService({}),
    scopes: ["*"],
  };
  return { session: new Session(sessionOptions), messages };
}

describe("session agent.clone.request", () => {
  test("dispatches to agent.clone.response with the cloned agent payload", async () => {
    const source = makeManagedAgent("agent-1");
    const child = makeManagedAgent("agent-2");
    const cloneAgent = vi.fn(async () => child);
    const { session, messages } = createSessionForCloneRenameTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn((id: string) => (id === "agent-1" ? source : child)),
        cloneAgent,
      },
    });

    await session.handleMessage({
      type: "agent.clone.request",
      agentId: "agent-1",
      requestId: "clone-1",
    });

    expect(cloneAgent).toHaveBeenCalledWith("agent-1", undefined);
    const response = messages.find((msg) => msg.type === "agent.clone.response");
    expect(response).toMatchObject({
      type: "agent.clone.response",
      payload: {
        requestId: "clone-1",
        agentId: "agent-1",
        agent: expect.objectContaining({ id: "agent-2" }),
        error: null,
      },
    });
  });

  test("forwards an optional name to cloneAgent", async () => {
    const source = makeManagedAgent("agent-1");
    const child = makeManagedAgent("agent-2");
    const cloneAgent = vi.fn(async () => child);
    const { session } = createSessionForCloneRenameTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        cloneAgent,
      },
    });

    await session.handleMessage({
      type: "agent.clone.request",
      agentId: "agent-1",
      name: "cloned branch",
      requestId: "clone-1",
    });

    expect(cloneAgent).toHaveBeenCalledWith("agent-1", "cloned branch");
  });

  test("emits an error envelope without throwing when cloneAgent rejects", async () => {
    const source = makeManagedAgent("agent-1");
    const cloneAgent = vi.fn(async () => {
      throw new Error("Unknown agent 'agent-1'");
    });
    const { session, messages } = createSessionForCloneRenameTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        cloneAgent,
      },
    });

    await expect(
      session.handleMessage({
        type: "agent.clone.request",
        agentId: "agent-1",
        requestId: "clone-err",
      }),
    ).resolves.toBeUndefined();

    expect(messages).toContainEqual({
      type: "agent.clone.response",
      payload: {
        requestId: "clone-err",
        agentId: "agent-1",
        agent: null,
        error: "Unknown agent 'agent-1'",
      },
    });
  });
});

describe("session agent.rename.request", () => {
  test("dispatches to agent.rename.response with the renamed agent payload", async () => {
    const source = makeManagedAgent("agent-1");
    const renamed = { ...makeManagedAgent("agent-1"), title: "renamed agent" };
    const renameAgent = vi.fn(async () => renamed);
    const { session, messages } = createSessionForCloneRenameTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => renamed),
        renameAgent,
      },
    });

    await session.handleMessage({
      type: "agent.rename.request",
      agentId: "agent-1",
      name: "renamed agent",
      requestId: "rename-1",
    });

    expect(renameAgent).toHaveBeenCalledWith("agent-1", "renamed agent");
    const response = messages.find((msg) => msg.type === "agent.rename.response");
    expect(response).toMatchObject({
      type: "agent.rename.response",
      payload: {
        requestId: "rename-1",
        agentId: "agent-1",
        agent: expect.objectContaining({ id: "agent-1" }),
        error: null,
      },
    });
    void source;
  });

  test("emits an error envelope without throwing when renameAgent rejects", async () => {
    const source = makeManagedAgent("agent-1");
    const renameAgent = vi.fn(async () => {
      throw new Error("name must be a non-empty string");
    });
    const { session, messages } = createSessionForCloneRenameTest({
      agentManager: {
        waitForAgentClose: vi.fn(async () => undefined),
        getAgent: vi.fn(() => source),
        renameAgent,
      },
    });

    await expect(
      session.handleMessage({
        type: "agent.rename.request",
        agentId: "agent-1",
        name: "renamed agent",
        requestId: "rename-err",
      }),
    ).resolves.toBeUndefined();

    expect(messages).toContainEqual({
      type: "agent.rename.response",
      payload: {
        requestId: "rename-err",
        agentId: "agent-1",
        agent: null,
        error: "name must be a non-empty string",
      },
    });
  });
});
