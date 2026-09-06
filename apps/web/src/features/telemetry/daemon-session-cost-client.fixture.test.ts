import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";

import { attachSessionCostStore } from "./daemon-session-cost-client.js";
import { SessionCostStore } from "./session-cost-store.js";

/**
 * Exercises `attachSessionCostStore` against the *real*
 * `@picompanion/client` `DaemonClient` (not a fake), wired to an
 * in-memory fake WebSocket that replays the recorded connect-handshake
 * fixture (`hello-capability-negotiation`, `@picompanion/protocol`) plus
 * synthesized `fetch_agent_response`/`agent_update` frames shaped exactly
 * like `packages/protocol/src/messages.ts`'s schema — the same
 * real-client-plus-fake-socket, no-fixture-file-yet pattern
 * `features/composer/daemon-agent-turn-client.fixture.test.ts` uses for
 * its own `agent_update` round trip (T28B5).
 */
const here = dirname(fileURLToPath(import.meta.url));

function loadFixtureFrames(name: string): FixtureFrame[] {
  const path = join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "protocol",
    "src",
    "fixtures",
    "daemon-ws",
    name,
  );
  const fixture = JSON.parse(readFileSync(path, "utf8")) as { frames: FixtureFrame[] };
  return fixture.frames;
}

interface FixtureFrame {
  id: string;
  direction: "client_to_daemon" | "daemon_to_client";
  message: unknown;
}

function frameById(frames: FixtureFrame[], id: string): FixtureFrame {
  const frame = frames.find((candidate) => candidate.id === id);
  if (!frame) throw new Error(`fixture is missing frame "${id}"`);
  return frame;
}

/** Minimal in-memory `WebSocketLike` double, driven by the test. */
class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  binaryType?: string;
  sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(event: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  removeEventListener(event: string, listener: (event: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string | Uint8Array | ArrayBuffer): void {
    if (typeof data !== "string") {
      throw new Error("FakeWebSocket only expects text frames in this fixture");
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "test close" });
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  receiveJson(message: unknown): void {
    this.emit("message", JSON.stringify(message));
  }

  private emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? new Set()) {
      listener(payload);
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function connectFixtureDaemonClient(
  clientId: string,
): Promise<{ daemonClient: DaemonClient; socket: FakeWebSocket }> {
  const helloFrames = loadFixtureFrames("hello-capability-negotiation.json");

  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = (_url, _options) => {
    const socket = new FakeWebSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };

  const daemonClient = new DaemonClient({
    url: "ws://fixture.invalid/ws",
    clientId,
    clientType: "browser",
    appVersion: "0.1.0-fixture",
    webSocketFactory,
    connectTimeoutMs: 5_000,
  });

  const connectPromise = daemonClient.connect();
  await flushMicrotasks();
  const socket = sockets[0];
  if (!socket) throw new Error("expected DaemonClient to open a WebSocket");
  socket.receiveJson(frameById(helloFrames, "server-info-1").message);
  await connectPromise;

  return { daemonClient, socket };
}

interface SentFrame {
  type: string;
  message?: { type: string; requestId?: string; [key: string]: unknown };
}

function findSentRequest(socket: FakeWebSocket, type: string): NonNullable<SentFrame["message"]> {
  const found = socket.sent
    .map((raw) => JSON.parse(raw) as SentFrame)
    .find((frame) => frame.type === "session" && frame.message?.type === type);
  if (!found?.message) throw new Error(`expected a ${type} frame to be sent`);
  return found.message;
}

/**
 * A minimal, schema-valid `AgentSnapshotPayload` for `fetch_agent_response`
 * and `agent_update`'s `upsert` payload, matching the constant
 * `daemon-agent-turn-client.fixture.test.ts` already established for
 * T28B5's own round trip.
 */
const FIXTURE_AGENT = {
  id: "agt_fixture_0001",
  provider: "pi",
  cwd: "/synthetic/workspace/fixture-repo",
  model: "claude-sonnet-4",
  thinkingOptionId: "medium",
  effectiveThinkingOptionId: "medium",
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T11:30:00.000Z",
  lastUserMessageAt: "2026-08-31T11:29:00.000Z",
  status: "idle",
  activeTurn: null as { turnId: string; startedAt: string | null } | null,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsSessionListing: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
    supportsRewindConversation: true,
    supportsRewindFiles: true,
    supportsRewindBoth: true,
  },
  currentModeId: "default",
  availableModes: [{ id: "default", label: "Default" }],
  pendingPermissions: [],
  persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
  title: "Fixture session",
  labels: {},
  archivedAt: null,
};

describe("attachSessionCostStore (fixtures)", () => {
  it("bootstraps the model from a live fetch_agent_response, without seeding usage", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_telemetry_0001",
    );
    const store = new SessionCostStore();
    const detach = attachSessionCostStore(daemonClient, "agt_fixture_0001", store);
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "fetch_agent_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agent_response",
        payload: {
          requestId: sentRequest.requestId,
          agent: { ...FIXTURE_AGENT, lastUsage: { inputTokens: 999_999, outputTokens: 999_999 } },
          error: null,
        },
      },
    });
    await flushMicrotasks();

    // The bootstrap model is set, but the idle snapshot's `lastUsage` is
    // never ingested — this connection has not observed a live turn yet.
    expect(store.getSessionCost().status).toBe("unknown");

    detach();
    await daemonClient.close();
  }, 10_000);

  it("round-trips a running turn's cost against live agent_update pushes, filtered by agentId", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_telemetry_0002",
    );
    const store = new SessionCostStore();
    const detach = attachSessionCostStore(daemonClient, "agt_fixture_0001", store);
    await flushMicrotasks();
    findSentRequest(socket, "fetch_agent_request"); // consumed; response not required for this test

    // Turn starts and reports usage-so-far.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            status: "running",
            activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
            lastUsage: { inputTokens: 100_000, outputTokens: 0 },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(store.getSessionCost().status).toBe("known");
    expect(store.getSessionCost().totalUsd).toBeCloseTo(0.3, 6);

    // A push for a different agentId must not be attributed here.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            id: "agt_fixture_other",
            activeTurn: { turnId: "turn_other", startedAt: "2026-08-31T12:00:00.000Z" },
            lastUsage: { inputTokens: 5_000_000, outputTokens: 0 },
          },
        },
      },
    });
    // A `remove` push must not crash the adapter.
    socket.receiveJson({
      type: "session",
      message: { type: "agent_update", payload: { kind: "remove", agentId: "agt_fixture_0001" } },
    });
    await flushMicrotasks();
    expect(store.getSessionCost().totalUsd).toBeCloseTo(0.3, 6);

    // The same turn's cumulative usage grows — the readout updates in
    // place rather than accumulating on top of the earlier reading.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            status: "running",
            activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
            lastUsage: { inputTokens: 1_000_000, outputTokens: 0 },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(store.getSessionCost().totalUsd).toBeCloseTo(3, 6);
    expect(store.getSessionCost().pricedTurns).toBe(1);

    // The turn finishes: the agent goes idle, carrying the turn's final
    // usage — still attributed to turn_1, not a phantom new turn.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            status: "idle",
            activeTurn: null,
            lastUsage: { inputTokens: 1_000_000, outputTokens: 10_000 },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(store.getSessionCost().pricedTurns).toBe(1);
    expect(store.getSessionCost().totalUsd).toBeCloseTo(3 + 15 * 0.01, 6);

    detach();
    await daemonClient.close();
  }, 10_000);
});
