import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";

import { createDaemonDiscoveredSessionsClient } from "./daemon-discovered-sessions-client.js";

/**
 * Exercises `createDaemonDiscoveredSessionsClient` against the *real*
 * `@picompanion/client` `DaemonClient` (not a fake), wired to an
 * in-memory fake WebSocket, matching `daemon-sessions-client.fixture.
 * test.ts`'s and `daemon-session-resume-client.fixture.test.ts`'s
 * pattern for this feature.
 *
 * The `import_agent_request`/`status(agent_resumed)` round trip
 * (T27B5's "an imported terminal session appears correctly and can be
 * opened" acceptance criterion) replays the recorded
 * `session-import-terminal` fixture verbatim — the daemon
 * acknowledges an import exactly like a resume, per that fixture's own
 * description. No recorded fixture exists yet for
 * `fetch_recent_provider_sessions_request`/`_response`, so that round
 * trip and the repeated-import ("already imported") rejection are
 * constructed inline from `RecentProviderSessionDescriptorPayloadSchema`/
 * `AgentCreateFailedStatusPayloadSchema` (`packages/protocol/src/
 * messages.ts`), matching `daemon-sessions-client.fixture.test.ts`'s
 * `agent_create_failed` precedent for a response with no dedicated
 * fixture file.
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
  message?: {
    type: string;
    requestId: string;
    providerHandleId?: string;
    providerId?: string;
    cwd?: string;
  };
}

async function connectFixtureDaemon(
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

function findSentImportRequest(socket: FakeWebSocket): NonNullable<SentFrame["message"]> {
  const sent = socket.sent
    .map((raw) => JSON.parse(raw) as SentFrame)
    .find((frame) => frame.type === "session" && frame.message?.type === "import_agent_request");
  if (!sent?.message) throw new Error("expected an import_agent_request frame to be sent");
  return sent.message;
}

describe("createDaemonDiscoveredSessionsClient.importSession (T27B5, session-import-terminal fixture)", () => {
  it("round-trips importing a terminal-started session against the recorded protocol fixture", async () => {
    const importFrames = loadFixtureFrames("session-import-terminal.json");
    const { daemonClient, socket } = await connectFixtureDaemon(
      "clid_fixture_web_discover_import_0001",
    );
    const client = createDaemonDiscoveredSessionsClient(daemonClient);

    const importPromise = client.importSession({
      providerId: "pi",
      providerHandleId: "pi-terminal-fixture-handle-0002",
      cwd: "/synthetic/workspace/terminal-project",
    });
    await flushMicrotasks();

    const requestMessage = findSentImportRequest(socket);
    expect(requestMessage.providerHandleId).toBe("pi-terminal-fixture-handle-0002");
    expect(requestMessage.cwd).toBe("/synthetic/workspace/terminal-project");

    const resumedFrame = frameById(importFrames, "status-agent-resumed-1");
    const resumedMessage = JSON.parse(JSON.stringify(resumedFrame.message)) as {
      message: { payload: { requestId: string } };
    };
    resumedMessage.message.payload.requestId = requestMessage.requestId;
    socket.receiveJson(resumedMessage);

    const session = await importPromise;
    // Imported terminal session appears correctly (T27B5 acceptance):
    // real fields from the fixture's `agent_resumed` payload, ready to
    // render as an ordinary, openable `SessionSummary` row. The
    // model/mode/thinking fields below are the same fixture payload's
    // own values, carried through `toSessionSummary` for the rail row
    // meta line and the session head (this task's fidelity work).
    expect(session).toEqual({
      id: "agt_fixture_0002",
      title: "Imported terminal session",
      provider: "pi",
      cwd: "/synthetic/workspace/terminal-project",
      status: "idle",
      archivedAt: null,
      updatedAt: "2026-08-31T09:05:00.000Z",
      model: "fixture-model-large",
      currentModeId: "default",
      availableModes: [{ id: "default", label: "Default" }],
      thinkingOptionId: "medium",
    });

    await daemonClient.close();
  });

  it("rejects an already-imported handle with the daemon's raw explanation (import idempotency, no duplicate agent)", async () => {
    const { daemonClient, socket } = await connectFixtureDaemon(
      "clid_fixture_web_discover_import_0002",
    );
    const client = createDaemonDiscoveredSessionsClient(daemonClient);

    const importPromise = client.importSession({
      providerId: "pi",
      providerHandleId: "pi-terminal-fixture-handle-0002",
      cwd: "/synthetic/workspace/terminal-project",
    });
    await flushMicrotasks();
    const requestMessage = findSentImportRequest(socket);

    // Matches `import-sessions.ts`'s `importProviderSessionNow` error
    // text for a session that is already imported and active — the
    // daemon-side half of "import is idempotent when run twice": it
    // never creates a second agent for the same handle.
    socket.receiveJson({
      type: "session",
      message: {
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId: requestMessage.requestId,
          error: "Provider session is already imported: pi-terminal-fixture-handle-0002",
        },
      },
    });

    await expect(importPromise).rejects.toThrow(/already imported/i);
    await daemonClient.close();
  });
});

describe("createDaemonDiscoveredSessionsClient.listDiscoveredSessions (T27B5)", () => {
  it("round-trips fetching discovered sessions from a schema-shaped fetch_recent_provider_sessions_response", async () => {
    // No recorded `fetch-recent-provider-sessions` fixture exists yet
    // in `@picompanion/protocol`'s fixtures directory; this constructs
    // the response directly from
    // `RecentProviderSessionDescriptorPayloadSchema`
    // (`packages/protocol/src/messages.ts`), matching this file's
    // "already imported" test's precedent for a response with no
    // dedicated fixture file.
    const { daemonClient, socket } = await connectFixtureDaemon(
      "clid_fixture_web_discover_list_0001",
    );
    const client = createDaemonDiscoveredSessionsClient(daemonClient);

    const listPromise = client.listDiscoveredSessions({ cwd: "/synthetic/workspace/demo-repo" });
    await flushMicrotasks();

    const sentRequest = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .find(
        (frame) =>
          frame.type === "session" &&
          frame.message?.type === "fetch_recent_provider_sessions_request",
      );
    if (!sentRequest?.message) {
      throw new Error("expected a fetch_recent_provider_sessions_request frame to be sent");
    }
    expect(sentRequest.message.cwd).toBe("/synthetic/workspace/demo-repo");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_recent_provider_sessions_response",
        payload: {
          requestId: sentRequest.message.requestId,
          entries: [
            {
              providerId: "pi",
              providerLabel: "Pi",
              providerHandleId: "pi-terminal-fixture-handle-0003",
              cwd: "/synthetic/workspace/demo-repo",
              title: null,
              firstPromptPreview: "help me fix the build",
              lastPromptPreview: "run it again",
              lastActivityAt: "2026-08-31T08:00:00.000Z",
            },
          ],
          filteredAlreadyImportedCount: 2,
        },
      },
    });

    const discovered = await listPromise;
    expect(discovered).toEqual([
      {
        providerId: "pi",
        providerLabel: "Pi",
        providerHandleId: "pi-terminal-fixture-handle-0003",
        cwd: "/synthetic/workspace/demo-repo",
        title: null,
        firstPromptPreview: "help me fix the build",
        lastPromptPreview: "run it again",
        lastActivityAt: "2026-08-31T08:00:00.000Z",
      },
    ]);

    await daemonClient.close();
  });
});
