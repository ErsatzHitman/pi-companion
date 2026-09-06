import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";

import { createDaemonSessionResumeClient } from "./daemon-session-resume-client.js";

/**
 * Exercises `createDaemonSessionResumeClient` against the *real*
 * `@picompanion/client` `DaemonClient` (not a fake), wired to an
 * in-memory fake WebSocket, matching
 * `daemon-sessions-client.fixture.test.ts`'s pattern (T27B2) for this
 * same feature. The connect handshake replays the recorded
 * `hello-capability-negotiation` fixture; the `fetch_agent_request`/
 * `fetch_agent_timeline_request` round trips are constructed inline
 * (no recorded fixture for either exists yet — `session-resume.json`
 * covers the different `resume_agent_request`/persistence-handle path,
 * not this one), each shaped to the real
 * `FetchAgentResponseMessageSchema`/`FetchAgentTimelineResponseMessageSchema`
 * (`packages/protocol/src/messages.ts`) so `DaemonClient` accepts them.
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

interface SentFrame {
  type: string;
  message?: { type: string; requestId: string; agentId?: string };
}

async function connectFixtureDaemon(clientId: string): Promise<{
  daemonClient: DaemonClient;
  socket: FakeWebSocket;
}> {
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

/** A minimal, schema-valid `AgentSnapshotPayload` for `fetch_agent_response`. */
const RESUMED_AGENT = {
  id: "agt_fixture_resume_0001",
  provider: "pi",
  cwd: "/synthetic/workspace/resumed-repo",
  workspaceId: "ws_fixture_resume_0001",
  model: "fixture-model-large",
  thinkingOptionId: "medium",
  effectiveThinkingOptionId: "medium",
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T11:30:00.000Z",
  lastUserMessageAt: "2026-08-31T11:29:00.000Z",
  status: "idle",
  activeTurn: null,
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
  persistence: { provider: "pi", sessionId: "pi-sess-fixture-resume-0001" },
  title: "Summarize the open issues",
  labels: {},
  archivedAt: null,
};

describe("createDaemonSessionResumeClient (T27B3)", () => {
  it("resumes an existing session: fetches its snapshot and folds its timeline", async () => {
    const { daemonClient, socket } = await connectFixtureDaemon("clid_fixture_web_resume_0001");
    const client = createDaemonSessionResumeClient(daemonClient);

    const resumePromise = client.resumeSession("agt_fixture_resume_0001");
    await flushMicrotasks();

    const fetchAgentRequest = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .find((frame) => frame.type === "session" && frame.message?.type === "fetch_agent_request");
    if (!fetchAgentRequest?.message) throw new Error("expected a fetch_agent_request frame");
    expect(fetchAgentRequest.message.agentId).toBe("agt_fixture_resume_0001");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agent_response",
        payload: {
          requestId: fetchAgentRequest.message.requestId,
          agent: RESUMED_AGENT,
          project: null,
          error: null,
        },
      },
    });
    await flushMicrotasks();

    const fetchTimelineRequest = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .find(
        (frame) =>
          frame.type === "session" && frame.message?.type === "fetch_agent_timeline_request",
      );
    if (!fetchTimelineRequest?.message) {
      throw new Error("expected a fetch_agent_timeline_request frame");
    }
    expect(fetchTimelineRequest.message.agentId).toBe("agt_fixture_resume_0001");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agent_timeline_response",
        payload: {
          requestId: fetchTimelineRequest.message.requestId,
          agentId: "agt_fixture_resume_0001",
          agent: null,
          direction: "tail",
          projection: "projected",
          epoch: "epoch-fixture-resume-0001",
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 0, maxSeq: 1, nextSeq: 2 },
          startCursor: { epoch: "epoch-fixture-resume-0001", seq: 0 },
          endCursor: { epoch: "epoch-fixture-resume-0001", seq: 1 },
          hasOlder: false,
          hasNewer: false,
          entries: [
            {
              provider: "pi",
              item: { type: "user_message", text: "What are the open issues?" },
              timestamp: "2026-08-31T11:28:00.000Z",
              seqStart: 0,
              seqEnd: 0,
              sourceSeqRanges: [{ startSeq: 0, endSeq: 0 }],
              collapsed: [],
            },
            {
              provider: "pi",
              item: {
                type: "assistant_message",
                text: "Here is a summary of the open issues.",
                messageId: "msg_fixture_resume_0001",
              },
              timestamp: "2026-08-31T11:29:00.000Z",
              seqStart: 1,
              seqEnd: 1,
              sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }],
              collapsed: [],
            },
          ],
          error: null,
        },
      },
    });

    const result = await resumePromise;

    expect(result.session).toMatchObject({
      id: "agt_fixture_resume_0001",
      title: "Summarize the open issues",
      provider: "pi",
      cwd: "/synthetic/workspace/resumed-repo",
      status: "idle",
    });
    expect(result.timeline.epoch).toBe("epoch-fixture-resume-0001");
    expect(result.timeline.rows).toHaveLength(2);
    expect(result.timeline.rows[0]?.item).toMatchObject({ type: "user_message" });
    expect(result.timeline.rows[1]?.item).toMatchObject({ type: "assistant_message" });

    await daemonClient.close();
  });

  it("rejects with the daemon's raw explanation when the session does not exist", async () => {
    const { daemonClient, socket } = await connectFixtureDaemon("clid_fixture_web_resume_0002");
    const client = createDaemonSessionResumeClient(daemonClient);

    const resumePromise = client.resumeSession("agt_missing");
    await flushMicrotasks();

    const fetchAgentRequest = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .find((frame) => frame.type === "session" && frame.message?.type === "fetch_agent_request");
    if (!fetchAgentRequest?.message) throw new Error("expected a fetch_agent_request frame");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agent_response",
        payload: {
          requestId: fetchAgentRequest.message.requestId,
          agent: null,
          project: null,
          error: "Agent not found: agt_missing",
        },
      },
    });

    await expect(resumePromise).rejects.toThrow("Agent not found: agt_missing");
    await daemonClient.close();
  });
});
