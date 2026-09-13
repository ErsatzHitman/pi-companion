import { vi, type Mock } from "vitest";

import { getAgentProviderDefinition } from "@picompanion/protocol/provider-manifest";

import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "../agent/agent-sdk-types.js";
import type {
  AgentManagerProviderState,
  ProviderDiagnosticResult,
  ResolvedProviderCreateConfig,
} from "../agent/provider-snapshot-manager.js";
import { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import type { SessionOptions } from "../session.js";
import type { SessionOutboundMessage } from "@picompanion/protocol/messages";
import { asInternals, createStub } from "./class-mocks.js";

// ---------------------------------------------------------------------------
// Typed stub wrappers — unsafe cast is in createStub (class-mocks.ts), never
// directly in test files. Wrapper signatures narrow the accepted key set so
// callers get compile-time feedback on typos in method names.
// ---------------------------------------------------------------------------

export function asSessionLogger(stub: {
  [K in keyof SessionOptions["logger"]]?: unknown;
}): SessionOptions["logger"] {
  return createStub<SessionOptions["logger"]>(stub);
}

export function asAgentManager(stub: {
  [K in keyof SessionOptions["agentManager"]]?: unknown;
}): SessionOptions["agentManager"] {
  return createStub<SessionOptions["agentManager"]>(stub);
}

export function asAgentStorage(stub: {
  [K in keyof SessionOptions["agentStorage"]]?: unknown;
}): SessionOptions["agentStorage"] {
  return createStub<SessionOptions["agentStorage"]>(stub);
}

export function asDownloadTokenStore(): SessionOptions["downloadTokenStore"] {
  return createStub<SessionOptions["downloadTokenStore"]>({});
}

export function asPushTokenStore(): SessionOptions["pushTokenStore"] {
  return createStub<SessionOptions["pushTokenStore"]>({});
}

export function asChatService(): SessionOptions["chatService"] {
  return createStub<SessionOptions["chatService"]>({});
}

export function asScheduleService(): SessionOptions["scheduleService"] {
  return createStub<SessionOptions["scheduleService"]>({});
}

export function asLoopService(): SessionOptions["loopService"] {
  return createStub<SessionOptions["loopService"]>({});
}

export function asWorkspaceAutoName(stub: {
  [K in keyof SessionOptions["workspaceAutoName"]]?: unknown;
}): SessionOptions["workspaceAutoName"] {
  return createStub<SessionOptions["workspaceAutoName"]>(stub);
}

export function asProviderUsageService(stub: {
  [K in keyof SessionOptions["providerUsageService"]]?: unknown;
}): SessionOptions["providerUsageService"] {
  return createStub<SessionOptions["providerUsageService"]>(stub);
}

export function asCheckoutDiffManager(stub: {
  [K in keyof SessionOptions["checkoutDiffManager"]]?: unknown;
}): SessionOptions["checkoutDiffManager"] {
  return createStub<SessionOptions["checkoutDiffManager"]>(stub);
}

export function asDaemonConfigStore(stub: {
  [K in keyof SessionOptions["daemonConfigStore"]]?: unknown;
}): SessionOptions["daemonConfigStore"] {
  return createStub<SessionOptions["daemonConfigStore"]>(stub);
}

export function asTerminalManager(stub: {
  [K in keyof NonNullable<SessionOptions["terminalManager"]>]?: unknown;
}): NonNullable<SessionOptions["terminalManager"]> {
  return createStub<NonNullable<SessionOptions["terminalManager"]>>({
    subscribeTerminalWorkspaceContributionChanged: () => () => {},
    ...stub,
  });
}

export function asGitHubService(stub: {
  [K in keyof NonNullable<SessionOptions["github"]>]?: unknown;
}): NonNullable<SessionOptions["github"]> {
  return createStub<NonNullable<SessionOptions["github"]>>(stub);
}

export function asWorkspaceGitService(stub: {
  [K in keyof SessionOptions["workspaceGitService"]]?: unknown;
}): SessionOptions["workspaceGitService"] {
  return createStub<SessionOptions["workspaceGitService"]>(stub);
}

export function asServiceProxy(stub: {
  [K in keyof NonNullable<SessionOptions["serviceProxy"]>]?: unknown;
}): NonNullable<SessionOptions["serviceProxy"]> {
  return createStub<NonNullable<SessionOptions["serviceProxy"]>>(stub);
}

export function asWorkspaceScriptRuntimeStore(stub: {
  [K in keyof NonNullable<SessionOptions["scriptRuntimeStore"]>]?: unknown;
}): NonNullable<SessionOptions["scriptRuntimeStore"]> {
  return createStub<NonNullable<SessionOptions["scriptRuntimeStore"]>>(stub);
}

// ---------------------------------------------------------------------------
// Private session access — delegates to asInternals so test files need no cast
// ---------------------------------------------------------------------------

export { asInternals as asSessionInternals };

// ---------------------------------------------------------------------------
// Type guard for SessionOutboundMessage — avoids casting unknown in test emit overrides
// ---------------------------------------------------------------------------

export function isSessionOutboundMessage(m: unknown): m is SessionOutboundMessage {
  return typeof m === "object" && m !== null && "type" in m;
}

// ---------------------------------------------------------------------------
// Message helpers — type-safe filtering without casts in test files
// ---------------------------------------------------------------------------

export function filterByType<T extends SessionOutboundMessage["type"]>(
  messages: SessionOutboundMessage[],
  type: T,
): Array<Extract<SessionOutboundMessage, { type: T }>> {
  return messages.filter((m): m is Extract<SessionOutboundMessage, { type: T }> => m.type === type);
}

export function findByType<T extends SessionOutboundMessage["type"]>(
  messages: SessionOutboundMessage[],
  type: T,
): Extract<SessionOutboundMessage, { type: T }> | undefined {
  return messages.find((m): m is Extract<SessionOutboundMessage, { type: T }> => m.type === type);
}

// ---------------------------------------------------------------------------
// ProviderSnapshotManager stub — returns spies separately to avoid
// unbound-method lint errors when using expect(spy).toHaveBeenCalled()
// ---------------------------------------------------------------------------

export interface ProviderSnapshotManagerSpies {
  getSnapshot: Mock<(cwd?: string) => ProviderSnapshotEntry[]>;
  refreshSnapshotForCwd: Mock<(arg: unknown) => Promise<void>>;
  refreshSettingsSnapshot: Mock<(arg: unknown) => Promise<void>>;
  warmUpSnapshotForCwd: Mock<(arg: unknown) => Promise<void>>;
  listRegisteredProviderIds: Mock<() => AgentProvider[]>;
  hasProvider: Mock<(provider: AgentProvider) => boolean>;
  getProviderLabel: Mock<(provider: AgentProvider) => string>;
  getAgentManagerProviderState: Mock<() => AgentManagerProviderState>;
  listProviders: Mock<(arg: unknown) => Promise<ProviderSnapshotEntry[]>>;
  getProvider: Mock<(arg: unknown) => Promise<ProviderSnapshotEntry>>;
  listModels: Mock<(arg: unknown) => Promise<AgentModelDefinition[]>>;
  listModes: Mock<(arg: unknown) => Promise<AgentMode[]>>;
  resolveCreateConfig: Mock<(arg: unknown) => Promise<ResolvedProviderCreateConfig>>;
  resolveDefaultModel: Mock<(arg: unknown) => Promise<string | undefined>>;
  getProviderDiagnostic: Mock<(provider: AgentProvider) => Promise<ProviderDiagnosticResult>>;
  applyMutableProviderConfig: Mock<(arg: unknown) => AgentManagerProviderState>;
  destroy: Mock<() => void>;
}

export function createProviderSnapshotManagerStub(): {
  manager: ProviderSnapshotManager;
} & ProviderSnapshotManagerSpies {
  const getSnapshot = vi.fn<(cwd?: string) => ProviderSnapshotEntry[]>(() => []);
  const refreshSnapshotForCwd = vi.fn<(arg: unknown) => Promise<void>>(async () => {});
  const refreshSettingsSnapshot = vi.fn<(arg: unknown) => Promise<void>>(async () => {});
  const warmUpSnapshotForCwd = vi.fn<(arg: unknown) => Promise<void>>(async () => {});
  const listRegisteredProviderIds = vi.fn<() => AgentProvider[]>(() => []);
  const hasProvider = vi.fn<(provider: AgentProvider) => boolean>(() => false);
  const getProviderLabel = vi.fn<(provider: AgentProvider) => string>((provider) => {
    try {
      return getAgentProviderDefinition(provider).label;
    } catch {
      return provider;
    }
  });
  const getAgentManagerProviderState = vi.fn<() => AgentManagerProviderState>(() => ({
    providerDefinitions: {},
    clients: {},
  }));
  const listProviders = vi.fn<(arg: unknown) => Promise<ProviderSnapshotEntry[]>>(async () => []);
  const getProvider = vi.fn<(arg: unknown) => Promise<ProviderSnapshotEntry>>(async () => {
    throw new Error("createProviderSnapshotManagerStub: getProvider not stubbed");
  });
  const listModels = vi.fn<(arg: unknown) => Promise<AgentModelDefinition[]>>(async () => []);
  const listModes = vi.fn<(arg: unknown) => Promise<AgentMode[]>>(async () => []);
  const resolveCreateConfig = vi.fn<(arg: unknown) => Promise<ResolvedProviderCreateConfig>>(
    async () => ({
      modeId: undefined,
      featureValues: undefined,
    }),
  );
  const resolveDefaultModel = vi.fn<(arg: unknown) => Promise<string | undefined>>(
    async () => undefined,
  );
  const getProviderDiagnostic = vi.fn<
    (provider: AgentProvider) => Promise<ProviderDiagnosticResult>
  >(async (provider) => ({ provider, diagnostic: "No diagnostic available for this provider." }));
  const applyMutableProviderConfig = vi.fn<(arg: unknown) => AgentManagerProviderState>(() => ({
    providerDefinitions: {},
    clients: {},
  }));
  const on = vi.fn();
  const off = vi.fn();
  const destroy = vi.fn<() => void>();
  const stub = {
    getSnapshot,
    refreshSnapshotForCwd,
    refreshSettingsSnapshot,
    warmUpSnapshotForCwd,
    listRegisteredProviderIds,
    hasProvider,
    getProviderLabel,
    getAgentManagerProviderState,
    listProviders,
    getProvider,
    listModels,
    listModes,
    resolveCreateConfig,
    resolveDefaultModel,
    getProviderDiagnostic,
    applyMutableProviderConfig,
    on,
    off,
    destroy,
  };
  on.mockImplementation(() => stub);
  off.mockImplementation(() => stub);
  const manager = createStub<ProviderSnapshotManager>(stub);
  return {
    manager,
    getSnapshot,
    refreshSnapshotForCwd,
    refreshSettingsSnapshot,
    warmUpSnapshotForCwd,
    listRegisteredProviderIds,
    hasProvider,
    getProviderLabel,
    getAgentManagerProviderState,
    listProviders,
    getProvider,
    listModels,
    listModes,
    resolveCreateConfig,
    resolveDefaultModel,
    getProviderDiagnostic,
    applyMutableProviderConfig,
    destroy,
  };
}
