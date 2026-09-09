import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";
import { createProviderSnapshotManagerStub } from "../../test-utils/session-stubs.js";
import * as atomicFile from "../../atomic-file.js";
import { AgentManager } from "../agent-manager.js";
import { AgentStorage } from "../agent-storage.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import { createAgentCommand } from "./create.js";
import type { ManagedAgent } from "../agent-manager.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentProvider,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../agent-sdk-types.js";

const logger = createTestLogger();

function createRealAgentManager(storage: AgentStorage): AgentManager {
  return new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
}

// Creates a worktree directory under repoRoot and reports it back as a fresh
// workspace so the command can stamp the agent with it (mirrors the production
// worktree service).
function fakeWorktreeCreator(args: { repoRoot: string; createdWorkspaceId: string }) {
  const worktreePath = join(args.repoRoot, "worktree");
  const workspaceCwd = join(worktreePath, "packages", "core");
  mkdirSync(workspaceCwd, { recursive: true });
  return async (): Promise<CreatePaseoWorktreeWorkflowResult> =>
    ({
      worktree: { worktreePath },
      intent: {},
      workspace: { workspaceId: args.createdWorkspaceId, cwd: workspaceCwd },
      repoRoot: args.repoRoot,
      created: true,
      setupContinuation: { kind: "agent" as const, startAfterAgentCreate: () => {} },
    }) as unknown as CreatePaseoWorktreeWorkflowResult;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const CONTROLLABLE_CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

// A minimal AgentSession whose dispatched turn stays "running" until the test
// explicitly calls `finishTurn()` -- see T297. This is what lets the test
// FORCE the ordering the historical bug depended on (the completion-triggered
// background persist is not even enqueued until the turn genuinely finishes)
// instead of hoping the fast fixtures elsewhere in this file happen to race.
class ControllableAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly capabilities = CONTROLLABLE_CAPABILITIES;
  readonly id = randomUUID();
  private subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnIdCounter = 0;
  private releaseTurn: Deferred<void> | null = null;

  constructor(private readonly config: AgentSessionConfig) {
    this.provider = config.provider;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    const turnId = `turn-${++this.turnIdCounter}`;
    this.releaseTurn = deferred<void>();
    void (async () => {
      this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
      await this.releaseTurn?.promise;
      this.pushEvent({ type: "turn_completed", provider: this.provider, turnId });
    })();
    return { turnId };
  }

  // Lets the turn started above actually complete. Until this is called, the
  // dispatched run stays genuinely "running" -- nothing has enqueued a
  // completion-triggered background persist yet.
  finishTurn(): void {
    this.releaseTurn?.resolve();
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private pushEvent(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      callback(event);
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class ControllableAgentClient implements AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities = CONTROLLABLE_CAPABILITIES;
  readonly createdSessions: ControllableAgentSession[] = [];

  constructor(provider: AgentProvider = "codex") {
    this.provider = provider;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new ControllableAgentSession(config);
    this.createdSessions.push(session);
    return session;
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    const session = new ControllableAgentSession({
      provider: this.provider,
      cwd: config?.cwd ?? process.cwd(),
    });
    this.createdSessions.push(session);
    return session;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }
}

test("session create forwards clientMessageId to the initial prompt run options", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const streamAgent = vi.fn(() => (async function* noop() {})());
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent: vi.fn(async () => snapshot),
      getAgent: vi.fn(() => snapshot),
      tryRunOutOfBand: vi.fn(() => false),
      hasInFlightRun: vi.fn(() => false),
      streamAgent,
      waitForAgentRunStart: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
  };

  await createAgentCommand(dependencies, {
    kind: "session",
    config: { provider: "codex", cwd: "/tmp/paseo-create-test" },
    workspaceId: "ws-create-test",
    initialPrompt: "hello from create",
    clientMessageId: "msg-create-1",
    labels: {},
    provisionalTitle: null,
    firstAgentContext: { attachments: [] },
    buildSessionConfig: async (config) => ({ sessionConfig: config }),
  });

  expect(streamAgent).toHaveBeenCalledWith("agent-1", "hello from create", {
    clientMessageId: "msg-create-1",
  });
});

test("session create validates the requested mode against the provider's modes", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "opencode",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const stub = createProviderSnapshotManagerStub();
  stub.resolveCreateConfig.mockRejectedValue(
    new Error("Invalid mode 'plan' for provider 'opencode'. Available modes: build, myplan"),
  );
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: stub.manager,
  };

  await expect(
    createAgentCommand(dependencies, {
      kind: "session",
      config: { provider: "opencode", cwd: "/tmp/paseo-create-test", modeId: "plan" },
      workspaceId: "ws-create-test",
      labels: {},
      provisionalTitle: null,
      firstAgentContext: { attachments: [] },
      buildSessionConfig: async (config) => ({ sessionConfig: config }),
    }),
  ).rejects.toThrow("Invalid mode 'plan'");

  expect(stub.resolveCreateConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "opencode",
      cwd: "/tmp/paseo-create-test",
      requestedMode: "plan",
    }),
  );
  expect(createAgent).not.toHaveBeenCalled();
});

test("session create applies the resolved mode from the provider create config", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "opencode",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const stub = createProviderSnapshotManagerStub();
  stub.resolveCreateConfig.mockResolvedValue({
    modeId: "build",
    featureValues: { auto_accept: true },
  });
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
      getAgent: vi.fn(() => snapshot),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: stub.manager,
  };

  await createAgentCommand(dependencies, {
    kind: "session",
    config: { provider: "opencode", cwd: "/tmp/paseo-create-test", modeId: "build" },
    workspaceId: "ws-create-test",
    labels: {},
    provisionalTitle: null,
    firstAgentContext: { attachments: [] },
    buildSessionConfig: async (config) => ({ sessionConfig: config }),
  });

  expect(createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      modeId: "build",
      featureValues: { auto_accept: true },
    }),
    undefined,
    expect.anything(),
  );
});

test("mcp create accepts provider-only internal input and leaves model undefined", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "claude",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
      getAgent: vi.fn(() => snapshot),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: {
      resolveCreateConfig: vi.fn(async (input) => {
        expect(input.provider).toBe("claude");
        return {};
      }),
    } as Parameters<typeof createAgentCommand>[0]["providerSnapshotManager"],
  };

  await createAgentCommand(dependencies, {
    kind: "mcp",
    provider: "claude",
    cwd: "/tmp/paseo-create-test",
    workspaceId: "ws-create-test",
    title: "provider default",
    initialPrompt: "hello",
    background: true,
    notifyOnFinish: false,
  });

  expect(createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "claude",
      model: undefined,
    }),
    undefined,
    expect.objectContaining({
      workspaceId: "ws-create-test",
    }),
  );
});

test("session create stamps the requested workspaceId when no worktree setup runs", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const created = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-source",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({ sessionConfig: config }),
      },
    );
    settleBackgroundDispatch = created.settleBackgroundDispatch;

    const stored = await storage.get(created.snapshot.id);
    expect(stored?.workspaceId).toBe("ws-source");
  } finally {
    // `AgentStorage` queues record writes and exposes `flush()` to await them;
    // `writeFileAtomic` lands a `.<name>.<pid>.<ts>.<uuid>.tmp` sibling and then
    // renames it. Without awaiting the writes a dispatch queues, an in-flight
    // write can create that temp file in `agents/` AFTER `rmSync` has already
    // enumerated the directory, so the final `rmdir` fails with `ENOTEMPTY` and
    // the whole file fails with ZERO assertion failures. Observed on CI at run
    // 34205088229, the first failure in fifteen runs, on a commit touching no
    // server file.
    //
    // CORRECTED at T280: this comment used to say `await storage.flush()`
    // alone closed the observed window without proving it could not lose --
    // "it closes the observed window... it is not a proof that no ordering
    // can lose." That was true: `flush()` snapshots `pendingWrites` before
    // awaiting it, so a write queued by a still-running dispatch AFTER that
    // snapshot was still outside it, and the missing piece was
    // `AgentManager`'s own background-persist queue, not `AgentStorage`'s.
    // `settleBackgroundDispatch()` (returned by `createAgentCommand`, see its
    // doc comment in `create.ts`) closes it for real: it awaits
    // `AgentManager.waitForAgentEvent(..., { waitForActive: true })` --
    // which cannot resolve until AFTER `emitState` has already queued this
    // dispatch's last background persist, by construction, not by timing --
    // then drains `AgentManager.flush()` and `AgentStorage.flush()`. Every
    // one of this file's real-storage tests below calls it in place of the
    // bare `storage.flush()` this comment used to describe.
    //
    // What that sentence does NOT mean, disclosed at the P9-R merge gate so
    // a future reader does not over-read it: `createAgentCommand` only
    // returns a REAL handle when it actually dispatched an initial prompt
    // (`create.ts` assigns it under `if (initialPromptStarted)`, leaving the
    // `() => Promise.resolve()` default otherwise). Two of this file's
    // real-storage cases create without a prompt, so for those the thing
    // being awaited is that no-op default and closes nothing. Measured at
    // the same gate, `AgentStorage.pendingWrites.size` is 0 at that point in
    // both of them, so there is no live window there to close — but the
    // protection is narrower than "every real-storage test", and a future
    // prompt-less case that DOES queue a write would not be covered.
    //
    // CORRECTED at T297: this used to say "T297 owns landing the
    // deterministic reproduction and a prompt-bearing case" as an open item.
    // It is landed -- see the prompt-bearing "a background persist not yet
    // enqueued..." test at the end of this file, which forces (never sleeps
    // for) exactly the two things this comment describes: a completion
    // persist not yet enqueued when settleBackgroundDispatch() is called,
    // and that write's on-disk landing held at the temp-file stage so a
    // premature removal reproduces a real ENOTEMPTY. Reverting
    // `waitForBackgroundDispatchToSettle` to a bare `agentStorage.flush()`
    // makes that test fail with a real assertion (not a timeout), proven at
    // T297. The prompt-less gap named above is otherwise still open: no test
    // in this file covers a prompt-less create whose background persist
    // queues a write.
    //
    // This is the T240 measure-the-source rule rather than a timeout bump:
    // it removes the write from the race instead of widening the window the
    // race has to lose in.
    await settleBackgroundDispatch();
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("session create stamps the new worktree's workspaceId when a setup continuation runs", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const created = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-source",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({
          sessionConfig: config,
          setupContinuation: { kind: "agent", startAfterAgentCreate: () => {} },
          createdWorkspaceId: "ws-new-worktree",
        }),
      },
    );
    settleBackgroundDispatch = created.settleBackgroundDispatch;

    const stored = await storage.get(created.snapshot.id);
    expect(stored?.workspaceId).toBe("ws-new-worktree");
  } finally {
    await settleBackgroundDispatch(); // see the first such cleanup in this file for why
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("mcp create stamps the new worktree's workspaceId, not the parent's", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const providerSnapshotManager = createProviderSnapshotManagerStub().manager;
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const { snapshot: parent } = await createAgentCommand(
      { agentManager, agentStorage: storage, logger, providerSnapshotManager },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-parent",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({ sessionConfig: config }),
      },
    );

    const { snapshot: child, settleBackgroundDispatch: settleChildDispatch } =
      await createAgentCommand(
        {
          agentManager,
          agentStorage: storage,
          logger,
          providerSnapshotManager,
          createPaseoWorktree: fakeWorktreeCreator({
            repoRoot: workdir,
            createdWorkspaceId: "ws-new-worktree",
          }),
        },
        {
          kind: "mcp",
          provider: "codex/gpt-5.4",
          title: "child",
          initialPrompt: "do the thing",
          background: true,
          notifyOnFinish: false,
          callerAgentId: parent.id,
          worktree: { worktreeName: "feature", baseBranch: "main" },
        },
      );
    settleBackgroundDispatch = settleChildDispatch;

    const storedChild = await storage.get(child.id);
    expect(storedChild?.workspaceId).toBe("ws-new-worktree");
    expect(child.cwd).toBe(join(workdir, "worktree", "packages", "core"));
  } finally {
    await settleBackgroundDispatch(); // see the first such cleanup in this file for why
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("mcp create exposes the created worktree before dispatching the initial prompt", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-worktree-callback-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const createdWorktree = await fakeWorktreeCreator({
    repoRoot: workdir,
    createdWorkspaceId: "ws-created-worktree",
  })();
  let observed:
    | {
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
        lifecycle: ManagedAgent["lifecycle"] | null;
      }
    | undefined;
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const created = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: {
          async resolveCreateConfig() {
            return {};
          },
        },
        createPaseoWorktree: async () => createdWorktree,
      },
      {
        kind: "mcp",
        provider: "codex",
        cwd: workdir,
        title: "worktree callback",
        initialPrompt: "Say done.",
        background: true,
        notifyOnFinish: false,
        worktree: { worktreeName: "feature", baseBranch: "main" },
        onCreated: ({ agentId, createdWorktree: callbackWorktree }) => {
          observed = {
            createdWorktree: callbackWorktree,
            lifecycle: agentManager.getAgent(agentId)?.lifecycle ?? null,
          };
        },
      },
    );
    settleBackgroundDispatch = created.settleBackgroundDispatch;

    expect(observed).toEqual({ createdWorktree, lifecycle: "idle" });
  } finally {
    await settleBackgroundDispatch(); // see the first such cleanup in this file for why
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("session create keeps the prompt title after the initial prompt settles", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-title-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const title = "Implement auth retries with backoff";
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const result = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-title-source",
        initialPrompt: `${title}\n\ninclude tests`,
        labels: {},
        provisionalTitle: title,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({ sessionConfig: config }),
      },
    );
    settleBackgroundDispatch = result.settleBackgroundDispatch;

    const created = await storage.get(result.snapshot.id);
    expect(created?.title).toBe(title);

    await settleBackgroundDispatch();

    const settled = await storage.get(result.snapshot.id);
    expect(settled?.title).toBe(title);
  } finally {
    await settleBackgroundDispatch(); // see the first such cleanup in this file for why
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("session create keeps an explicit title after the initial prompt settles", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-explicit-title-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const title = "Explicit override";
  let settleBackgroundDispatch: () => Promise<void> = () => Promise.resolve();

  try {
    const result = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir, title },
        workspaceId: "ws-explicit-title-source",
        initialPrompt: "Implement auth retries with backoff",
        labels: {},
        provisionalTitle: title,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({ sessionConfig: config }),
      },
    );
    settleBackgroundDispatch = result.settleBackgroundDispatch;

    const created = await storage.get(result.snapshot.id);
    expect(created?.title).toBe(title);

    await settleBackgroundDispatch();

    const settled = await storage.get(result.snapshot.id);
    expect(settled?.title).toBe(title);
  } finally {
    await settleBackgroundDispatch(); // see the first such cleanup in this file for why
    rmSync(workdir, { recursive: true, force: true });
  }
});

// T297: lands the deterministic ENOTEMPTY reproduction this file's first
// cleanup comment (above) promised. Two things are FORCED explicitly here,
// neither by sleep nor by hoping today's fast fixtures happen to race:
//
//   1. The dispatched turn is held "running" (via ControllableAgentSession)
//      until this test calls `finishTurn()`, so the completion-triggered
//      background persist genuinely has not been enqueued yet at the moment
//      `settleBackgroundDispatch()` is invoked -- reproducing the exact gap
//      `waitForAgentEvent(..., { waitForActive: true })` closes.
//   2. Once that write DOES start, its on-disk landing (writeJsonFileAtomic's
//      temp-file-then-rename) is held open at the temp-file stage via a spy
//      on the imported `writeJsonFileAtomic`, so a directory enumeration
//      taken before the write started provably does not include the file
//      that is, at that exact moment, sitting on disk.
test("a background persist not yet enqueued when settleBackgroundDispatch is called is not missed, and a premature removal would ENOTEMPTY (T297)", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-enotempty-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const client = new ControllableAgentClient("codex");
  const agentManager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
  });

  let recordPath: string | null = null;
  let holdRename = false;
  let releaseRename: (() => void) | undefined;
  const tempFileCreated = deferred<void>();
  const originalWriteJsonFileAtomic = atomicFile.writeJsonFileAtomic;
  const writeSpy = vi
    .spyOn(atomicFile, "writeJsonFileAtomic")
    .mockImplementation(async (filePath: string, value: unknown) => {
      recordPath = filePath;
      if (!holdRename) {
        return originalWriteJsonFileAtomic(filePath, value);
      }
      // One-shot: only the write this test arms is held; everything else
      // (including whatever else might be in flight) proceeds normally.
      holdRename = false;
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      const tempPath = join(dir, `.late-write-${randomUUID()}.tmp`);
      await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
      tempFileCreated.resolve();
      await new Promise<void>((resolve) => {
        releaseRename = resolve;
      });
      await rename(tempPath, filePath);
    });

  try {
    const created = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-enotempty",
        initialPrompt: "hello",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
        buildSessionConfig: async (config) => ({ sessionConfig: config }),
      },
    );

    // Prompt-bearing: the handle under test is real, not the `() =>
    // Promise.resolve()` default assigned when no prompt was dispatched.
    expect(created.initialPromptStarted).toBe(true);
    expect(client.createdSessions).toHaveLength(1);
    const session = client.createdSessions[0]!;
    expect(recordPath).not.toBeNull();

    const recordDir = dirname(recordPath!);
    // Captured BEFORE the completion write starts: only the creation record.
    const entriesBeforeLateWrite = readdirSync(recordDir);

    // Invoke the real, currently-shipped settleBackgroundDispatch(), but do
    // not await it yet -- the dispatched turn is still "running" (finishTurn
    // has not been called), so nothing has enqueued the completion persist.
    let settled = false;
    const settlePromise = created.settleBackgroundDispatch().then(() => {
      settled = true;
    });

    // Forced ordering check #1: settleBackgroundDispatch() must NOT resolve
    // while the turn is still active. A reverted create.ts (bare
    // `agentStorage.flush()`, no `waitForAgentEvent` first) has nothing of
    // this agent's completion queued at this instant and resolves almost
    // immediately -- this bounded race (the same technique already used by
    // this package's own `agent-manager.test.ts` to prove the identical
    // `waitForAgentEvent` primitive is still pending) would then see
    // "resolved", not "pending".
    const earlyOutcome = await Promise.race([
      settlePromise.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    expect(earlyOutcome).toBe("pending");
    expect(settled).toBe(false);

    // Now arm the write-level hold and let the turn actually finish. This is
    // when `emitState` -> `enqueueBackgroundPersist` -> `applySnapshot`
    // fires for real, for the first time.
    holdRename = true;
    session.finishTurn();

    // Explicit signal, not a sleep: wait until the held write has genuinely
    // created its temp file on disk.
    await tempFileCreated.promise;

    // Forced ordering check #2: settleBackgroundDispatch() is STILL pending
    // -- agentStorage.flush() (its last step) is legitimately waiting on the
    // very write this test is holding mid-rename.
    expect(settled).toBe(false);

    // The forced ENOTEMPTY reproduction itself: a caller who acted on the
    // pre-T280 signal (or no signal at all) would believe it is safe to
    // remove now. The temp file this enumeration never saw is still on disk.
    for (const name of entriesBeforeLateWrite) {
      rmSync(join(recordDir, name), { force: true });
    }
    let removalError: NodeJS.ErrnoException | null = null;
    try {
      rmdirSync(recordDir);
    } catch (error) {
      removalError = error as NodeJS.ErrnoException;
    }
    expect(removalError?.code).toBe("ENOTEMPTY");

    // Let the held write finish and prove settleBackgroundDispatch() only
    // resolves once it has genuinely landed.
    releaseRename?.();
    await settlePromise;
    expect(settled).toBe(true);

    // Now a real cleanup, done the way every other test in this file does
    // it (await settleBackgroundDispatch() first), succeeds cleanly -- the
    // write has fully landed, so there is nothing left for rmSync to race.
    rmSync(workdir, { recursive: true, force: true });
  } finally {
    writeSpy.mockRestore();
    rmSync(workdir, { recursive: true, force: true });
  }
});
