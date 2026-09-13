import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";

import { createDaemonSessionsClient } from "./daemon-sessions-client.js";

/**
 * Exercises `createDaemonSessionsClient` against the *real*
 * `@picompanion/client` `DaemonClient` (not a fake), wired to an
 * in-memory fake WebSocket that replays two recorded protocol fixtures:
 * `hello-capability-negotiation` (`@picompanion/protocol`, for the
 * connect handshake `createAgent` needs before it can send anything)
 * and `session-new` (for the create-agent request/response this
 * adapter's "round-trips against a dev daemon" acceptance criterion
 * covers). This is the same pattern
 * `packages/frontend-core/src/connection/daemon-client-lifecycle.fixture.test.ts`
 * uses for the hello handshake half.
 *
 * Loads fixture JSON directly by relative path (test-only; not copied
 * into `@picompanion/protocol`'s published dist — see
 * `packages/protocol/src/fixtures/README.md`).
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

interface ConnectedFixtureDaemon {
  daemonClient: DaemonClient;
  socket: FakeWebSocket;
}

/**
 * Connects a real `DaemonClient` to a fresh `FakeWebSocket`, replaying
 * the `hello-capability-negotiation` handshake fixture so the client is
 * ready to send session requests (T27B4, shared by the archive/delete
 * round-trip tests below as well as the create-side tests above).
 */
async function connectFixtureDaemonClient(clientId: string): Promise<ConnectedFixtureDaemon> {
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

function findSentSessionMessage<T extends { type: string; requestId: string }>(
  socket: FakeWebSocket,
  wireType: string,
): T {
  const sent = socket.sent
    .map((raw) => JSON.parse(raw) as { type: string; message?: T })
    .find((frame) => frame.type === "session" && frame.message?.type === wireType);
  if (!sent?.message) throw new Error(`expected a ${wireType} frame to be sent`);
  return sent.message;
}

describe("createDaemonSessionsClient (session-new fixture)", () => {
  it("round-trips session creation against the recorded protocol fixture", async () => {
    const helloFrames = loadFixtureFrames("hello-capability-negotiation.json");
    const sessionFrames = loadFixtureFrames("session-new.json");

    const sockets: FakeWebSocket[] = [];
    const webSocketFactory: WebSocketFactory = (_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    };

    const daemonClient = new DaemonClient({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_fixture_web_sessions_0001",
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

    const client = createDaemonSessionsClient(daemonClient);
    const createPromise = client.createSession({
      provider: "pi",
      cwd: "/synthetic/workspace/demo-repo",
    });
    await flushMicrotasks();

    const sentRequest = socket.sent
      .map(
        (raw) =>
          JSON.parse(raw) as {
            type: string;
            message?: {
              type: string;
              requestId: string;
              config: { provider: string; cwd: string };
            };
          },
      )
      .find((frame) => frame.type === "session" && frame.message?.type === "create_agent_request");
    if (!sentRequest?.message) throw new Error("expected a create_agent_request frame to be sent");
    const requestMessage = sentRequest.message;
    expect(requestMessage.config.provider).toBe("pi");
    expect(requestMessage.config.cwd).toBe("/synthetic/workspace/demo-repo");

    // Reply with the fixture's recorded acknowledgement, retargeted at the
    // requestId `DaemonClient` actually generated (the fixture's own id is
    // illustrative, not something this adapter can control).
    const statusFrame = frameById(sessionFrames, "status-agent-created-1");
    const statusMessage = JSON.parse(JSON.stringify(statusFrame.message)) as {
      message: { payload: { requestId: string } };
    };
    statusMessage.message.payload.requestId = requestMessage.requestId;
    socket.receiveJson(statusMessage);

    const session = await createPromise;
    expect(session.id).toBe("agt_fixture_0001");
    expect(session.provider).toBe("pi");
    expect(session.cwd).toBe("/synthetic/workspace/demo-repo");
    expect(session.status).toBe("running");
    expect(session.title).toBe("Summarize the open issues");

    await daemonClient.close();
  });

  it("propagates the daemon's raw explanation on agent_create_failed", async () => {
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
      clientId: "clid_fixture_web_sessions_0002",
      clientType: "browser",
      webSocketFactory,
      connectTimeoutMs: 5_000,
    });

    const connectPromise = daemonClient.connect();
    await flushMicrotasks();
    const socket = sockets[0];
    if (!socket) throw new Error("expected DaemonClient to open a WebSocket");
    socket.receiveJson(frameById(helloFrames, "server-info-1").message);
    await connectPromise;

    const client = createDaemonSessionsClient(daemonClient);
    const createPromise = client.createSession({ provider: "pi", cwd: "/does/not/exist" });
    await flushMicrotasks();

    const sentRequest = socket.sent
      .map(
        (raw) =>
          JSON.parse(raw) as {
            type: string;
            message?: { type: string; requestId: string };
          },
      )
      .find((frame) => frame.type === "session" && frame.message?.type === "create_agent_request");
    if (!sentRequest?.message) throw new Error("expected a create_agent_request frame to be sent");

    socket.receiveJson({
      type: "session",
      message: {
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId: sentRequest.message.requestId,
          error: "cwd is required",
        },
      },
    });

    await expect(createPromise).rejects.toThrow("cwd is required");
    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.archiveSession (T27B4, session-archive fixture)", () => {
  it("round-trips archiving a session against the recorded protocol fixture", async () => {
    const archiveFrames = loadFixtureFrames("session-archive.json");
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_archive_0001",
    );

    const client = createDaemonSessionsClient(daemonClient);
    const archivePromise = client.archiveSession?.("agt_fixture_0001");
    if (!archivePromise) throw new Error("expected archiveSession to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      agentId: string;
    }>(socket, "archive_agent_request");
    expect(requestMessage.agentId).toBe("agt_fixture_0001");

    const archivedFrame = frameById(archiveFrames, "agent-archived-1");
    const archivedMessage = JSON.parse(JSON.stringify(archivedFrame.message)) as {
      message: { payload: { requestId: string } };
    };
    archivedMessage.message.payload.requestId = requestMessage.requestId;
    socket.receiveJson(archivedMessage);

    const result = await archivePromise;
    expect(result.archivedAt).toBe("2026-08-31T12:00:00.000Z");

    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.fetchSessions (T27B6)", () => {
  it("round-trips a full-list reconcile against a constructed fetch_agents_response", async () => {
    // No recorded `fetch-agents` fixture exists yet in
    // `@picompanion/protocol`'s fixtures directory; this constructs the
    // `fetch_agents_response` reply directly from
    // `FetchAgentsResponseMessageSchema`, matching this file's existing
    // `agent_deleted` test's precedent for a response with no dedicated
    // fixture file.
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_fetch_0001",
    );

    const client = createDaemonSessionsClient(daemonClient);
    const fetchPromise = client.fetchSessions?.();
    if (!fetchPromise) throw new Error("expected fetchSessions to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      filter?: { includeArchived?: boolean };
    }>(socket, "fetch_agents_request");
    expect(requestMessage.filter?.includeArchived).toBe(true);

    // The full `AgentSnapshotPayload` shape below is copied from the
    // recorded `session-resume.json` fixture's `status(agent_resumed)`
    // frame (already proven schema-valid there) rather than hand-rolled,
    // since `AgentSnapshotPayloadSchema` and its nested `capabilities`
    // are otherwise easy to get subtly wrong by hand.
    const agentSnapshot = {
      id: "agt_fixture_0003",
      provider: "pi",
      cwd: "/synthetic/workspace/demo-repo",
      workspaceId: "ws_fixture_0001",
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
      availableModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      pendingPermissions: [],
      persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
      title: "Summarize the open issues",
      labels: {},
      archivedAt: null,
    };

    const project = {
      projectKey: "demo-repo",
      projectName: "demo-repo",
      checkout: {
        cwd: "/synthetic/workspace/demo-repo",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    };

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agents_response",
        payload: {
          requestId: requestMessage.requestId,
          subscriptionId: null,
          entries: [{ agent: agentSnapshot, project }],
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        },
      },
    });

    const sessions = await fetchPromise;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe("agt_fixture_0003");
    expect(sessions[0]?.status).toBe("idle");
    expect(sessions[0]?.title).toBe("Summarize the open issues");

    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.deleteSession (T27B4)", () => {
  it("round-trips deleting a session against a recorded-shape agent_deleted response", async () => {
    // No recorded `session-delete` fixture exists yet in
    // `@picompanion/protocol`'s fixtures directory (only `session-archive`
    // does); this constructs the `agent_deleted` reply directly from its
    // schema (`AgentDeletedMessageSchema`, `packages/protocol/src/messages.ts`)
    // instead, matching this file's existing `agent_create_failed` test's
    // precedent for a response with no dedicated fixture file.
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_delete_0001",
    );

    const client = createDaemonSessionsClient(daemonClient);
    const deletePromise = client.deleteSession?.("agt_fixture_0002");
    if (!deletePromise) throw new Error("expected deleteSession to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      agentId: string;
    }>(socket, "delete_agent_request");
    expect(requestMessage.agentId).toBe("agt_fixture_0002");

    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_deleted",
        payload: {
          agentId: "agt_fixture_0002",
          requestId: requestMessage.requestId,
        },
      },
    });

    await expect(deletePromise).resolves.toBeUndefined();
    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.forkSession (fork-agent-ui, real DaemonClient)", () => {
  it("always exposes forkSession on a real DaemonClient and round-trips a fork", async () => {
    // No recorded `agent.fork` fixture exists yet in
    // `@picompanion/protocol`'s fixtures directory; this constructs the
    // `agent.fork.response` reply directly from
    // `ForkAgentResponseMessageSchema` (`packages/protocol/src/messages.ts`),
    // matching this file's existing `agent_deleted`/`fetch_agents_response`
    // precedent for a response with no dedicated fixture file.
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_fork_0001",
    );
    expect(typeof daemonClient.forkAgent).toBe("function");

    const client = createDaemonSessionsClient(daemonClient);
    expect(typeof client.forkSession).toBe("function");
    const forkPromise = client.forkSession?.("agt_fixture_0001", {
      entryId: "entry-42",
      entryIndex: 3,
      name: "Branch A",
    });
    if (!forkPromise) throw new Error("expected forkSession to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      agentId: string;
      entryId: string;
      entryIndex?: number;
      name?: string;
    }>(socket, "agent.fork.request");
    expect(requestMessage.agentId).toBe("agt_fixture_0001");
    expect(requestMessage.entryId).toBe("entry-42");
    expect(requestMessage.entryIndex).toBe(3);
    expect(requestMessage.name).toBe("Branch A");

    // Full `AgentSnapshotPayload` shape copied from the `fetchSessions`
    // test above (proven schema-valid there) rather than hand-rolled.
    const agentSnapshot = {
      id: "agt_fixture_fork_0001",
      provider: "pi",
      cwd: "/synthetic/workspace/demo-repo",
      workspaceId: "ws_fixture_0001",
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
      availableModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      pendingPermissions: [],
      persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
      title: "Branch A",
      labels: {},
      archivedAt: null,
    };

    socket.receiveJson({
      type: "session",
      message: {
        type: "agent.fork.response",
        payload: {
          requestId: requestMessage.requestId,
          agentId: "agt_fixture_0001",
          agent: agentSnapshot,
          forkPoint: { messageId: "entry-42", index: 3 },
          error: null,
        },
      },
    });

    const result = await forkPromise;
    expect(result.session.id).toBe("agt_fixture_fork_0001");
    expect(result.session.title).toBe("Branch A");
    expect(result.forkPoint).toEqual({ messageId: "entry-42", index: 3 });

    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.cloneSession (wire-apps-followup, real DaemonClient)", () => {
  it("always exposes cloneSession on a real DaemonClient and round-trips a clone", async () => {
    // No recorded `agent.clone` fixture exists yet in
    // `@picompanion/protocol`'s fixtures directory; this constructs the
    // `agent.clone.response` reply directly from
    // `CloneAgentResponseMessageSchema` (`packages/protocol/src/messages.ts`),
    // matching this file's existing `agent_deleted`/`fetch_agents_response`
    // precedent for a response with no dedicated fixture file.
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_clone_0001",
    );
    expect(typeof daemonClient.cloneAgent).toBe("function");

    const client = createDaemonSessionsClient(daemonClient);
    expect(typeof client.cloneSession).toBe("function");
    const clonePromise = client.cloneSession?.("agt_fixture_0001", { name: "Copy" });
    if (!clonePromise) throw new Error("expected cloneSession to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      agentId: string;
      name?: string;
    }>(socket, "agent.clone.request");
    expect(requestMessage.agentId).toBe("agt_fixture_0001");
    expect(requestMessage.name).toBe("Copy");

    // Full `AgentSnapshotPayload` shape copied from the `forkSession`
    // test above (proven schema-valid there) rather than hand-rolled.
    const agentSnapshot = {
      id: "agt_fixture_clone_0001",
      provider: "pi",
      cwd: "/synthetic/workspace/demo-repo",
      workspaceId: "ws_fixture_0001",
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
      availableModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      pendingPermissions: [],
      persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
      title: "Copy",
      labels: {},
      archivedAt: null,
    };

    socket.receiveJson({
      type: "session",
      message: {
        type: "agent.clone.response",
        payload: {
          requestId: requestMessage.requestId,
          agentId: "agt_fixture_0001",
          agent: agentSnapshot,
          error: null,
        },
      },
    });

    const result = await clonePromise;
    expect(result.session.id).toBe("agt_fixture_clone_0001");
    expect(result.session.title).toBe("Copy");

    await daemonClient.close();
  });
});

describe("createDaemonSessionsClient.renameSession (wire-apps-followup, real DaemonClient)", () => {
  it("always exposes renameSession on a real DaemonClient and round-trips a rename", async () => {
    // Same no-fixture precedent as the clone test above, constructed from
    // `RenameAgentResponseMessageSchema` (`packages/protocol/src/messages.ts`).
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_sessions_rename_0001",
    );
    expect(typeof daemonClient.renameAgent).toBe("function");

    const client = createDaemonSessionsClient(daemonClient);
    expect(typeof client.renameSession).toBe("function");
    const renamePromise = client.renameSession?.("agt_fixture_0001", {
      name: "Renamed title",
    });
    if (!renamePromise) throw new Error("expected renameSession to be implemented");
    await flushMicrotasks();

    const requestMessage = findSentSessionMessage<{
      type: string;
      requestId: string;
      agentId: string;
      name: string;
    }>(socket, "agent.rename.request");
    expect(requestMessage.agentId).toBe("agt_fixture_0001");
    expect(requestMessage.name).toBe("Renamed title");

    // Full `AgentSnapshotPayload` shape copied from the clone test above
    // (proven schema-valid there) rather than hand-rolled.
    const agentSnapshot = {
      id: "agt_fixture_0001",
      provider: "pi",
      cwd: "/synthetic/workspace/demo-repo",
      workspaceId: "ws_fixture_0001",
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
      availableModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      pendingPermissions: [],
      persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
      title: "Renamed title",
      labels: {},
      archivedAt: null,
    };

    socket.receiveJson({
      type: "session",
      message: {
        type: "agent.rename.response",
        payload: {
          requestId: requestMessage.requestId,
          agentId: "agt_fixture_0001",
          agent: agentSnapshot,
          error: null,
        },
      },
    });

    const result = await renamePromise;
    expect(result.session.id).toBe("agt_fixture_0001");
    expect(result.session.title).toBe("Renamed title");

    await daemonClient.close();
  });
});
