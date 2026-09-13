import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentManager } from "../agent-manager.js";
import type {
  AgentClient,
  AgentSession,
  AgentSessionConfig,
  FetchCatalogOptions,
} from "../agent-sdk-types.js";
import { FakeRewindSession, REWIND_TEST_CAPABILITIES } from "./test-rewind-session.js";

class FakeRewindClient implements AgentClient {
  readonly provider = "claude";
  readonly capabilities = REWIND_TEST_CAPABILITIES;

  constructor(readonly session: FakeRewindSession) {}

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    return this.session;
  }

  async resumeSession(): Promise<AgentSession> {
    return this.session;
  }

  async fetchCatalog(_options: FetchCatalogOptions) {
    return { models: [], modes: [] };
  }

  async isAvailable() {
    return true;
  }
}

class RewindHistoryGate {
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  hold(): void {
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  release(): void {
    this.releaseGate?.();
    this.releaseGate = null;
    this.gate = null;
  }

  async wait(): Promise<void> {
    await this.gate;
  }
}

async function createRewindHarness(options: { historyGate?: RewindHistoryGate } = {}) {
  const session = new FakeRewindSession(options.historyGate?.wait.bind(options.historyGate));
  const manager = new AgentManager({
    clients: { claude: new FakeRewindClient(session) },
    logger: createTestLogger(),
    idFactory: () => "00000000-0000-4000-8000-000000000901",
  });
  const agent = await manager.createAgent(
    {
      provider: "claude",
      cwd: process.cwd(),
    },
    undefined,
    { workspaceId: undefined },
  );
  return { manager, session, agentId: agent.id };
}

async function createForkHarness() {
  const session = new FakeRewindSession();
  let counter = 0;
  const manager = new AgentManager({
    clients: { claude: new FakeRewindClient(session) },
    logger: createTestLogger(),
    idFactory: () => `00000000-0000-4000-8000-0000000009${String(11 + counter++).padStart(2, "0")}`,
  });
  const agent = await manager.createAgent({ provider: "claude", cwd: process.cwd() }, undefined, {
    workspaceId: undefined,
  });
  await manager.hydrateTimelineFromProvider(agent.id, { force: true });
  return { manager, session, agentId: agent.id };
}

describe("AgentManager rewind", () => {
  test("rewinds the conversation and rehydrates the timeline", async () => {
    const { manager, session, agentId } = await createRewindHarness();

    await manager.rewind(agentId, "message-1", "conversation");

    expect(session.recordedRewinds).toEqual([{ mode: "conversation", messageId: "message-1" }]);
    expect(session.historyReadCount).toBe(1);
    expect(manager.fetchTimeline(agentId, { limit: 0 }).rows.map((row) => row.item)).toEqual([
      { type: "user_message", text: "before", messageId: "message-1" },
    ]);
  });

  test("rewinds files without rehydrating the conversation timeline", async () => {
    const { manager, session, agentId } = await createRewindHarness();

    await manager.rewind(agentId, "message-1", "files");

    expect(session.recordedRewinds).toEqual([
      { mode: "files", messageId: "message-1", force: false },
    ]);
    expect(session.historyReadCount).toBe(0);
  });

  test("forwards force to the provider for a files rewind", async () => {
    const { manager, session, agentId } = await createRewindHarness();

    await manager.rewind(agentId, "message-1", "files", { force: true });

    expect(session.recordedRewinds).toEqual([
      { mode: "files", messageId: "message-1", force: true },
    ]);
  });

  test("aborts an in-flight turn before rewinding", async () => {
    const { manager, session, agentId } = await createRewindHarness();
    const run = manager.streamAgent(agentId, "keep working");
    await run.next();

    await manager.rewind(agentId, "message-1", "files");

    expect(session.aborted).toBe(true);
    expect(session.recordedRewinds).toEqual([
      { mode: "files", messageId: "message-1", force: false },
    ]);
  });

  test("does not rewind when the in-flight turn rejects cancellation", async () => {
    class RejectingInterruptSession extends FakeRewindSession {
      override async interrupt(): Promise<void> {
        throw new Error("provider still owns the active turn");
      }
    }

    const session = new RejectingInterruptSession();
    const manager = new AgentManager({
      clients: { claude: new FakeRewindClient(session) },
      logger: createTestLogger(),
      idFactory: () => "00000000-0000-4000-8000-000000000902",
    });
    const agent = await manager.createAgent({ provider: "claude", cwd: process.cwd() }, undefined, {
      workspaceId: undefined,
    });
    const run = manager.streamAgent(agent.id, "keep working");
    await run.next();

    await expect(manager.rewind(agent.id, "message-1", "files")).rejects.toThrow(
      `Cannot rewind agent ${agent.id} because its active run cancellation was not acknowledged`,
    );
    expect(session.recordedRewinds).toEqual([]);
    expect(manager.getAgent(agent.id)).toMatchObject({
      lifecycle: "running",
      activeForegroundTurnId: "turn-1",
    });
  });

  test("blocks new prompts until the rehydrate epoch broadcasts", async () => {
    const historyGate = new RewindHistoryGate();
    historyGate.hold();
    const { manager, agentId } = await createRewindHarness({ historyGate });

    const rewind = manager.rewind(agentId, "message-1", "both");

    expect(() => manager.streamAgent(agentId, "too early")).toThrow(
      "Agent 00000000-0000-4000-8000-000000000901 already has an active run",
    );

    historyGate.release();
    await rewind;
  });
});

describe("AgentManager fork active-turn handling", () => {
  test("forks the conversation into a child seeded with truncated history", async () => {
    const { manager, agentId } = await createForkHarness();

    const result = await manager.forkAgent(agentId, "message-1");
    const childId = result.agent.id;

    expect(childId).not.toBe(agentId);
    expect(result.forkPoint).toEqual({ messageId: "message-1", index: 0 });
    // Relationship store records parent -> child for fork-context consumers.
    expect(manager.getForkParent(childId)).toBe(agentId);
    expect(manager.getForkChildren(agentId)).toEqual([childId]);
    expect(result.agent.labels["paseo.parent-agent-id"]).toBe(agentId);
    // Child timeline carries the truncated source history through the fork point.
    expect(manager.fetchTimeline(childId, { limit: 0 }).rows.map((row) => row.item)).toEqual([
      { type: "user_message", text: "before", messageId: "message-1" },
    ]);
  });

  test("refuses while a turn is active with the revertConversation error", async () => {
    const { manager, agentId } = await createForkHarness();
    const run = manager.streamAgent(agentId, "keep working");
    await run.next();

    await expect(manager.forkAgent(agentId, "message-1")).rejects.toThrow(
      "Cannot rewind the Pi conversation while a turn is active",
    );
  });

  test("rejects an unknown entry without creating a child", async () => {
    const { manager, agentId } = await createForkHarness();
    const before = manager.getForkChildren(agentId);

    await expect(manager.forkAgent(agentId, "entry-missing")).rejects.toThrow(
      "unknown entry entry-missing",
    );
    expect(manager.getForkChildren(agentId)).toEqual(before);
  });

  test("rejects an unknown agent", async () => {
    const { manager } = await createForkHarness();

    await expect(
      manager.forkAgent("00000000-0000-4000-8000-000000009999", "message-1"),
    ).rejects.toThrow("Unknown agent");
  });
});
