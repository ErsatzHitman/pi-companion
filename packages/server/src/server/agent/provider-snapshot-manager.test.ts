import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  FetchCatalogOptions,
  ResolveAgentCreateConfigInput,
} from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import {
  GLOBAL_PROVIDER_SNAPSHOT_KEY,
  ProviderSnapshotManager,
  resolveSnapshotCwd,
} from "./provider-snapshot-manager.js";

const TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;
const TEST_REFRESH_TIMEOUT_MS = 120_000;

// Builds an AgentClient that can be injected via the public extraClients option.
// extraClients is the only injection surface the manager exposes for tests.
function createExtraClient(
  provider: AgentProvider,
  overrides: Partial<AgentClient> = {},
): AgentClient {
  return {
    provider,
    capabilities: TEST_CAPABILITIES,
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    async fetchCatalog(_options: FetchCatalogOptions) {
      return { models: [] as AgentModelDefinition[], modes: [] as AgentMode[] };
    },
    async isAvailable() {
      return false;
    },
    ...overrides,
  } satisfies AgentClient;
}

describe("ProviderSnapshotManager public surface", () => {
  test("listRegisteredProviderIds includes the built-in providers", () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      const ids = manager.listRegisteredProviderIds();
      expect(ids).toEqual(expect.arrayContaining(["pi"]));
    } finally {
      manager.destroy();
    }
  });

  test("hasProvider reflects the built-in set and providerOverrides additions", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        "zai-pi": { extends: "pi", label: "ZAI", enabled: true },
      },
    });
    try {
      expect(manager.hasProvider("pi")).toBe(true);
      expect(manager.hasProvider("zai-pi")).toBe(true);
      expect(manager.hasProvider("not-a-provider" as AgentProvider)).toBe(false);
    } finally {
      manager.destroy();
    }
  });

  test("getProviderLabel returns the override label when provided", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        "qwen-pi": { extends: "pi", label: "Qwen Code", enabled: true },
      },
    });
    try {
      expect(manager.getProviderLabel("qwen-pi")).toBe("Qwen Code");
      expect(manager.getProviderLabel("pi")).toBe("Pi");
    } finally {
      manager.destroy();
    }
  });

  test("getSnapshot returns loading entries for built-in providers before warmup", () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      const snapshot = manager.getSnapshot("/tmp/project");
      const pi = snapshot.find((entry) => entry.provider === "pi");
      expect(pi?.status).toBe("loading");
      expect(pi?.label).toBe("Pi");
    } finally {
      manager.destroy();
    }
  });

  test("providerOverrides with enabled:false marks the provider as unavailable without probing", async () => {
    const isAvailable = vi.fn(async () => true);
    const fetchCatalog = vi.fn(async () => ({
      models: [] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: {
        pi: createExtraClient("pi", { isAvailable, fetchCatalog }),
      },
    });
    try {
      const entries = await manager.listProviders({ cwd: "/tmp/project", wait: true });
      const pi = entries.find((entry) => entry.provider === "pi");
      expect(pi).toMatchObject({ provider: "pi", enabled: false, status: "unavailable" });
      expect(isAvailable).not.toHaveBeenCalled();
      expect(fetchCatalog).not.toHaveBeenCalled();
    } finally {
      manager.destroy();
    }
  });

  test("extraClients with isAvailable=false routes to unavailable without fetching", async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { pi: createExtraClient("pi", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({
        cwd: "/tmp/project",
        provider: "pi",
        wait: true,
      });
      expect(entry.provider).toBe("pi");
      expect(entry.status).toBe("unavailable");
      expect(isAvailable).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
    }
  });

  test("wait:true returns a warm provider without refreshing it", async () => {
    const cwd = "/tmp/project";
    const isAvailable = vi.fn(async () => true);
    const fetchCatalog = vi.fn(async () => ({
      models: [
        {
          provider: "pi",
          id: "gpt-5.4-mini",
          label: "GPT 5.4 Mini",
        },
      ] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", { isAvailable, fetchCatalog }),
      },
    });
    const listener = vi.fn();
    manager.on("change", listener);
    try {
      const [first] = await manager.listProviders({ cwd, providers: ["pi"], wait: true });
      expect(first).toMatchObject({ provider: "pi", status: "ready" });
      expect(isAvailable).toHaveBeenCalledTimes(1);
      expect(fetchCatalog).toHaveBeenCalledTimes(1);

      listener.mockClear();
      const [second] = await manager.listProviders({ cwd, providers: ["pi"], wait: true });

      expect(second).toEqual(first);
      expect(isAvailable).toHaveBeenCalledTimes(1);
      expect(fetchCatalog).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      manager.destroy();
    }
  });

  test("ready snapshots publish the catalog's capability-aware default mode", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [],
            modes: [{ id: "default", label: "Default", description: "Ask before running tools" }],
            defaultModeId: "default",
          }),
        }),
      },
    });

    try {
      const entry = await manager.getProvider({
        cwd: "/tmp/project",
        provider: "pi",
        wait: true,
      });

      expect(entry).toMatchObject({ status: "ready", defaultModeId: "default" });
    } finally {
      manager.destroy();
    }
  });

  test("explicit refresh re-probes only the requested warm provider", async () => {
    const cwd = "/tmp/project";
    const isAvailablePi = vi.fn(async () => true);
    const fetchPiCatalog = vi.fn(async () => ({
      models: [
        {
          provider: "pi",
          id: "gpt-5.4-mini",
          label: "GPT 5.4 Mini",
        },
      ] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const isAvailableZAI = vi.fn(async () => true);
    const fetchZAICatalog = vi.fn(async () => ({
      models: [
        {
          provider: "zai",
          id: "zai-opus-4.5",
          label: "ZAI Opus 4.5",
        },
      ] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        zai: { extends: "pi", label: "ZAI" },
      },
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: isAvailablePi,
          fetchCatalog: fetchPiCatalog,
        }),
        zai: createExtraClient("zai", {
          isAvailable: isAvailableZAI,
          fetchCatalog: fetchZAICatalog,
        }),
      },
    });
    try {
      await manager.listProviders({ cwd, providers: ["pi", "zai"], wait: true });
      await manager.refreshSnapshotForCwd({ cwd, providers: ["pi"] });

      expect(isAvailablePi).toHaveBeenCalledTimes(2);
      expect(fetchPiCatalog).toHaveBeenCalledTimes(2);
      expect(isAvailableZAI).toHaveBeenCalledTimes(1);
      expect(fetchZAICatalog).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
    }
  });

  test("refreshTimeoutMs option overrides the default and yields a timeout error", async () => {
    // never-resolving isAvailable forces the timeout path
    const isAvailable = vi.fn(() => new Promise<boolean>(() => {}));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 1,
      extraClients: { pi: createExtraClient("pi", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({
        cwd: "/tmp/project",
        provider: "pi",
        wait: true,
      });
      expect(entry.provider).toBe("pi");
      expect(entry.status).toBe("error");
      expect(entry.error).toMatch(/after 1ms/);
    } finally {
      manager.destroy();
    }
  });

  test("PASEO_PROVIDER_REFRESH_TIMEOUT_MS env var is honored when no option is given", async () => {
    vi.stubEnv("PASEO_PROVIDER_REFRESH_TIMEOUT_MS", "1");
    const isAvailable = vi.fn(() => new Promise<boolean>(() => {}));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { pi: createExtraClient("pi", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({
        cwd: "/tmp/project",
        provider: "pi",
        wait: true,
      });
      expect(entry.status).toBe("error");
      expect(entry.error).toMatch(/after 1ms/);
    } finally {
      manager.destroy();
      vi.unstubAllEnvs();
    }
  });

  test("PASEO_PROVIDER_REFRESH_TIMEOUT_MS env var is ignored when option is provided", async () => {
    vi.stubEnv("PASEO_PROVIDER_REFRESH_TIMEOUT_MS", "1");
    const isAvailable = vi.fn(() => new Promise<boolean>(() => {}));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 5,
      extraClients: { pi: createExtraClient("pi", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({
        cwd: "/tmp/project",
        provider: "pi",
        wait: true,
      });
      expect(entry.status).toBe("error");
      // explicit option (5) wins over env var (1)
      expect(entry.error).toMatch(/after 5ms/);
    } finally {
      manager.destroy();
      vi.unstubAllEnvs();
    }
  });

  test("listProviders returns an entry per registered provider", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      const entries = await manager.listProviders({ cwd: "/tmp/project", wait: true });
      const providers = entries.map((entry) => entry.provider).sort();
      expect(providers).toEqual(["pi"]);
      for (const entry of entries) {
        expect(entry.enabled).toBe(false);
        expect(entry.status).toBe("unavailable");
      }
    } finally {
      manager.destroy();
    }
  });

  test("getProvider throws when the provider is not configured", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false } },
    });
    try {
      await expect(
        manager.getProvider({
          cwd: "/tmp/project",
          provider: "not-a-provider" as AgentProvider,
          wait: true,
        }),
      ).rejects.toThrow(/not configured/);
    } finally {
      manager.destroy();
    }
  });

  test("listModels rejects when the provider is disabled", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false } },
    });
    try {
      await expect(
        manager.listModels({ cwd: "/tmp/project", provider: "pi", wait: true }),
      ).rejects.toThrow(/disabled/);
    } finally {
      manager.destroy();
    }
  });

  test("listModes rejects when the provider is disabled", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false } },
    });
    try {
      await expect(
        manager.listModes({ cwd: "/tmp/project", provider: "pi", wait: true }),
      ).rejects.toThrow(/disabled/);
    } finally {
      manager.destroy();
    }
  });

  test("resolveDefaultModel returns the requested model verbatim when provided", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false } },
    });
    try {
      const id = await manager.resolveDefaultModel({
        provider: "pi",
        requestedModel: "gpt-5.4",
        cwd: "/tmp/project",
      });
      expect(id).toBe("gpt-5.4");
    } finally {
      manager.destroy();
    }
  });

  test("resolveDefaultModel returns undefined when the provider is disabled and no override is given", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false } },
    });
    try {
      const id = await manager.resolveDefaultModel({ provider: "pi", cwd: "/tmp/project" });
      expect(id).toBeUndefined();
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic returns the diagnostic from the injected client and appends snapshot models/status", async () => {
    const getDiagnostic = vi.fn(async () => ({ diagnostic: "pi is ready" }));
    const client = createExtraClient("pi", { getDiagnostic });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { pi: client },
    });
    try {
      const result = await manager.getProviderDiagnostic("pi");
      expect(result.provider).toBe("pi");
      expect(result.diagnostic).toContain("pi is ready");
      expect(result.diagnostic).toContain("Models:");
      expect(result.diagnostic).toContain("Status:");
      expect(getDiagnostic).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic force-refreshes the snapshot and appends models/status", async () => {
    const catalogModels: AgentModelDefinition[] = [
      { provider: "pi", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
    ];
    const catalogModes: AgentMode[] = [{ id: "agent", label: "Agent" }];
    const fetchCatalog = vi.fn(async () => ({
      models: catalogModels,
      modes: catalogModes,
    }));
    const client = createExtraClient("pi", {
      isAvailable: async () => true,
      fetchCatalog,
    });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { pi: client },
    });
    try {
      const result = await manager.getProviderDiagnostic("pi");
      expect(fetchCatalog).toHaveBeenCalledTimes(1);
      expect(fetchCatalog.mock.calls[0]?.[0]).toMatchObject({ scope: "global", force: true });
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic falls back to a default message when the client has no getDiagnostic and appends snapshot models/status", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { pi: createExtraClient("pi") },
    });
    try {
      const result = await manager.getProviderDiagnostic("pi");
      expect(result.provider).toBe("pi");
      expect(result.diagnostic).toMatch(/no diagnostic/i);
      expect(result.diagnostic).toContain("Models:");
      expect(result.diagnostic).toContain("Status:");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic turns provider diagnostic failures into diagnostic text", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [{ provider: "pi", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" }],
            modes: [] as AgentMode[],
          }),
          getDiagnostic: async () => {
            throw new Error("diagnostic probe exploded");
          },
        }),
      },
    });
    try {
      const result = await manager.getProviderDiagnostic("pi");
      expect(result.diagnostic).toContain("Error: diagnostic probe exploded");
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic starts provider diagnostics before waiting for snapshot refresh", async () => {
    vi.useFakeTimers();
    let diagnosticStarted = false;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: async () => new Promise(() => {}),
          getDiagnostic: async () => {
            diagnosticStarted = true;
            return { diagnostic: "pi diagnostics available" };
          },
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("pi");
      expect(diagnosticStarted).toBe(true);

      const diagnosticOrBlocked = Promise.race([
        diagnosticRequest.then(() => ({ type: "diagnostic" as const })),
        new Promise<{ type: "blocked" }>((finish) => {
          setTimeout(() => finish({ type: "blocked" }), 1);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(1);
      await expect(diagnosticOrBlocked).resolves.toEqual({ type: "blocked" });

      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS - 1);
      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain("pi diagnostics available");
      expect(result.diagnostic).toContain(
        `Status: Error: Timed out refreshing Pi after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic starts snapshot refresh even when provider diagnostics hang", async () => {
    vi.useFakeTimers();
    let diagnosticStarted = false;
    let snapshotStarted = false;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: async () => {
            snapshotStarted = true;
            return new Promise(() => {});
          },
          getDiagnostic: async () => {
            diagnosticStarted = true;
            return new Promise(() => {});
          },
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("pi");
      await vi.advanceTimersByTimeAsync(0);

      expect(diagnosticStarted).toBe(true);
      expect(snapshotStarted).toBe(true);

      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS);
      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain(
        `Error: Timed out collecting Pi diagnostic after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
      expect(result.diagnostic).toContain(
        `Status: Error: Timed out refreshing Pi after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic reports provider diagnostic timeout while preserving snapshot details", async () => {
    vi.useFakeTimers();
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [{ provider: "pi", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" }],
            modes: [] as AgentMode[],
          }),
          getDiagnostic: async () => new Promise(() => {}),
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("pi");
      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS);

      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain(
        `Error: Timed out collecting Pi diagnostic after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic returns an error diagnostic for an unknown provider", async () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      await expect(manager.getProviderDiagnostic("unknown-provider" as AgentProvider)).resolves
        .toMatchInlineSnapshot(`
          {
            "diagnostic": "unknown-provider
            Error: Provider unknown-provider is not configured",
            "provider": "unknown-provider",
          }
        `);
    } finally {
      manager.destroy();
    }
  });

  test("getAgentManagerProviderState exposes extraClients verbatim", () => {
    const piClient = createExtraClient("pi");
    const zaiClient = createExtraClient("zai");
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { zai: { extends: "pi", label: "ZAI" } },
      extraClients: { pi: piClient, zai: zaiClient },
    });
    try {
      const state = manager.getAgentManagerProviderState();
      expect(state.clients.pi).toBe(piClient);
      expect(state.clients.zai).toBe(zaiClient);
      expect(state.providerDefinitions.zai).toMatchObject({ enabled: true });
      expect(state.providerDefinitions.pi).toMatchObject({ enabled: true });
    } finally {
      manager.destroy();
    }
  });

  test("resolveCreateConfig reduces a managed parent to provider mode and unattended data", async () => {
    const resolverInputs: ResolveAgentCreateConfigInput[] = [];
    const childModes: AgentMode[] = [
      { id: "child-unattended", label: "Child", isUnattended: true },
    ];
    const parentModes: AgentMode[] = [
      { id: "parent-unattended", label: "Parent", isUnattended: true },
    ];
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        zai: { extends: "pi", label: "ZAI" },
      },
      extraClients: {
        pi: createExtraClient("pi", {
          async isAvailable() {
            return true;
          },
          async fetchCatalog() {
            return { models: [] as AgentModelDefinition[], modes: childModes };
          },
          async resolveCreateConfig(input) {
            resolverInputs.push(input);
            return {
              modeId: input.parent?.isUnattended ? "child-unattended" : undefined,
              featureValues: undefined,
            };
          },
        }),
        zai: createExtraClient("zai", {
          async isAvailable() {
            return true;
          },
          async fetchCatalog() {
            return { models: [] as AgentModelDefinition[], modes: parentModes };
          },
          isCreateConfigUnattended(input) {
            return input.modeId === "parent-unattended";
          },
        }),
      },
    });
    try {
      const parent = {
        id: "parent-agent",
        provider: "zai",
        currentModeId: "parent-unattended",
        availableModes: parentModes,
        config: { provider: "zai", cwd: "/tmp/project" },
      } as ManagedAgent;

      const resolved = await manager.resolveCreateConfig({
        cwd: "/tmp/project",
        provider: "pi",
        requestedMode: undefined,
        featureValues: undefined,
        parent,
        unattended: false,
      });

      expect(resolved).toEqual({ modeId: "child-unattended", featureValues: undefined });
      expect(resolverInputs).toEqual([
        {
          provider: "pi",
          requestedMode: undefined,
          featureValues: undefined,
          parent: {
            provider: "zai",
            modeId: "parent-unattended",
            isUnattended: true,
          },
          unattended: true,
          availableModes: childModes,
        },
      ]);
    } finally {
      manager.destroy();
    }
  });

  test("resolveCreateConfig passes explicit unattended intent to provider policy", async () => {
    const resolverInputs: ResolveAgentCreateConfigInput[] = [];
    const modes: AgentMode[] = [{ id: "worker", label: "Worker", isUnattended: true }];
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", {
          async isAvailable() {
            return true;
          },
          async fetchCatalog() {
            return { models: [] as AgentModelDefinition[], modes };
          },
          async resolveCreateConfig(input) {
            resolverInputs.push(input);
            return {
              modeId: input.unattended ? "worker" : undefined,
              featureValues: undefined,
            };
          },
        }),
      },
    });
    try {
      const resolved = await manager.resolveCreateConfig({
        cwd: "/tmp/project",
        provider: "pi",
        requestedMode: undefined,
        featureValues: { fast_mode: true },
        parent: null,
        unattended: true,
      });

      expect(resolved).toEqual({ modeId: "worker", featureValues: undefined });
      expect(resolverInputs).toEqual([
        {
          provider: "pi",
          requestedMode: undefined,
          featureValues: { fast_mode: true },
          parent: null,
          unattended: true,
          availableModes: modes,
        },
      ]);
    } finally {
      manager.destroy();
    }
  });
});

describe("ProviderSnapshotManager applyMutableProviderConfig", () => {
  test("adds a derived provider and includes it in subsequent reads", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      expect(manager.hasProvider("zai-pi")).toBe(false);

      const state = manager.applyMutableProviderConfig({
        "zai-pi": { extends: "pi", label: "ZAI", enabled: true },
      });

      expect(manager.hasProvider("zai-pi")).toBe(true);
      expect(state.providerDefinitions["zai-pi"]).toMatchObject({ enabled: true });
      expect(manager.listRegisteredProviderIds()).toContain("zai-pi");
      expect(manager.getSnapshot().find((entry) => entry.provider === "zai-pi")?.source).toBe(
        "custom",
      );
    } finally {
      manager.destroy();
    }
  });

  test("removes startup provider overrides from the live registry", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        "zai-pi": { extends: "pi", label: "ZAI", enabled: true },
      },
    });
    try {
      expect(manager.hasProvider("zai-pi")).toBe(true);

      const state = manager.applyMutableProviderConfig({}, { removeProviders: ["zai-pi"] });

      expect(manager.hasProvider("zai-pi")).toBe(false);
      expect(state.providerDefinitions["zai-pi"]).toBeUndefined();
      expect(manager.getSnapshot().some((entry) => entry.provider === "zai-pi")).toBe(false);

      manager.applyMutableProviderConfig({ pi: { enabled: false } });
      expect(manager.hasProvider("zai-pi")).toBe(false);
    } finally {
      manager.destroy();
    }
  });

  test("drops disabled built-in providers from clients while preserving providerDefinitions", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        zai: { extends: "pi", label: "ZAI", enabled: false },
      },
    });
    try {
      const before = manager.getAgentManagerProviderState();
      expect(before.providerDefinitions.zai).toMatchObject({ enabled: false });
      expect(before.clients.zai).toBeUndefined();
      expect(before.providerDefinitions.pi).toMatchObject({ enabled: true });
      expect(before.clients.pi).toBeDefined();

      const state = manager.applyMutableProviderConfig({ pi: { enabled: false } });
      expect(state.providerDefinitions.pi).toMatchObject({ enabled: false });
      expect(state.clients.pi).toBeUndefined();
      expect(state.providerDefinitions.zai).toMatchObject({ enabled: false });
      expect(state.clients.zai).toBeUndefined();
    } finally {
      manager.destroy();
    }
  });

  test("fires a change event on every primed snapshot cwd after applyMutableProviderConfig", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      const listener = vi.fn();
      manager.on("change", listener);

      // Prime two distinct cwd snapshots. resolve() makes the keys platform-
      // native so Windows ("D:\\tmp\\...") matches the assertion below.
      const cwdA = resolve("/tmp/project-a");
      const cwdB = resolve("/tmp/project-b");
      manager.getSnapshot(cwdA);
      manager.getSnapshot(cwdB);

      listener.mockClear();
      manager.applyMutableProviderConfig({
        "zai-pi": { extends: "pi", label: "ZAI", enabled: true },
      });

      const cwds = listener.mock.calls.map((call) => call[1]).sort();
      expect(cwds).toEqual([cwdA, cwdB].sort());
    } finally {
      manager.destroy();
    }
  });
});

describe("ProviderSnapshotManager lifecycle", () => {
  test("on/off attaches and detaches change listeners", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      const listener = vi.fn();
      manager.on("change", listener);
      manager.getSnapshot("/tmp/project");
      manager.applyMutableProviderConfig({});
      const firstCallCount = listener.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      manager.off("change", listener);
      manager.applyMutableProviderConfig({});
      expect(listener.mock.calls.length).toBe(firstCallCount);
    } finally {
      manager.destroy();
    }
  });

  test("destroy clears snapshots and prevents further change emissions", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    const listener = vi.fn();
    manager.on("change", listener);
    manager.getSnapshot("/tmp/project");
    manager.destroy();

    listener.mockClear();
    manager.applyMutableProviderConfig({});
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ProviderSnapshotManager cwd routing", () => {
  test("settings refresh passes the semantic global scope to providers", async () => {
    const fetchCatalog = vi.fn(async () => ({
      models: [] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: vi.fn(async () => true),
          fetchCatalog,
        }),
      },
    });
    try {
      await manager.refreshSettingsSnapshot({ providers: ["pi"] });

      expect(fetchCatalog.mock.calls[0]?.[0]).toMatchObject({ scope: "global", force: true });
    } finally {
      manager.destroy();
    }
  });

  test("global snapshot does not satisfy an explicit home workspace read", async () => {
    const fetchCatalog = vi.fn(async () => ({
      models: [] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        pi: createExtraClient("pi", {
          isAvailable: vi.fn(async () => true),
          fetchCatalog,
        }),
      },
    });
    try {
      await manager.refreshSettingsSnapshot({ providers: ["pi"] });
      await manager.listProviders({ cwd: homedir(), providers: ["pi"], wait: true });

      expect(fetchCatalog.mock.calls.map((call) => call[0])).toEqual([
        expect.objectContaining({ scope: "global", force: true }),
        expect.objectContaining({
          scope: "workspace",
          cwd: resolveSnapshotCwd(homedir()),
          force: false,
        }),
      ]);
    } finally {
      manager.destroy();
    }
  });

  test("different cwd keys produce independent snapshots", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      const a = manager.getSnapshot("/tmp/project-a");
      const b = manager.getSnapshot("/tmp/project-b");
      expect(a).not.toBe(b);
      expect(a.map((entry) => entry.provider).sort()).toEqual(
        b.map((entry) => entry.provider).sort(),
      );
    } finally {
      manager.destroy();
    }
  });

  test("getSnapshot called with no cwd resolves to the global snapshot key", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
    });
    try {
      const listener = vi.fn();
      manager.on("change", listener);
      manager.getSnapshot();
      manager.applyMutableProviderConfig({});
      const cwds = listener.mock.calls.map((call) => call[1]);
      expect(cwds).toContain(GLOBAL_PROVIDER_SNAPSHOT_KEY);
    } finally {
      manager.destroy();
    }
  });

  test("resolveSnapshotCwd normalizes pure drive letters to append backslash on Windows", () => {
    const resolved = resolveSnapshotCwd("C:");
    if (process.platform === "win32") {
      expect(resolved).toBe("C:\\");
    } else {
      expect(resolved).toBeDefined();
    }
  });
});
