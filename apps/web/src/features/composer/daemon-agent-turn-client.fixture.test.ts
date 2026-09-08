import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";

import { createDaemonAgentTurnClient } from "./daemon-agent-turn-client.js";

/**
 * Exercises `createDaemonAgentTurnClient` against the *real*
 * `@picompanion/client` `DaemonClient` (not `FakeAgentTurnClient`),
 * wired to an in-memory fake WebSocket that replays a recorded protocol
 * fixture for the connect handshake
 * (`hello-capability-negotiation`, `@picompanion/protocol`) plus a
 * synthesized `agent_stream` frame shaped exactly like
 * `packages/protocol/src/messages.ts`'s schema (no fixture file recorded
 * for this yet — see `packages/protocol/src/fixtures/README.md` for the
 * existing set). This is the same real-client-plus-fake-socket pattern
 * `features/sessions/daemon-sessions-client.fixture.test.ts` uses for
 * T27B2's own "round-trips against a dev daemon" criterion.
 *
 * This is a genuine wire round trip through the real, production
 * `DaemonClient` request/response machinery — not the in-memory
 * `FakeAgentTurnClient` `Composer.test.tsx`/`use-composer.test.ts` use
 * for UI-behavior coverage. The "queue-mode fixtures, T38B1a" describe
 * block near the end genuinely round-trips all four:
 * `getQueueModes`/`setSteeringMode`/`setFollowUpMode` against a real
 * `set_*_response`/`get_queue_modes_response` (T110, landed earlier in
 * the P6-W6 wave), and `onQueueModesChange` against a real `agent_update`
 * push (needs only `daemon.on`, already implemented, independent of
 * T110).
 *
 * CORRECTED (T127): the paragraph above used to say the three sent
 * methods were proven `undefined` against a real `DaemonClient`,
 * "nothing yet to round-trip" pending T110 — stale even at P6-W6's own
 * merge gate, which rewrote the block below to round-trip them. The
 * `setSteeringMode` round-trip below also now asserts the resolved
 * `AgentProviderNotice` itself (not merely `undefined`), since T127 is
 * what stopped `createDaemonAgentTurnClient`'s adapter from discarding it.
 *
 * The `listCommands` describe block below (T28B4) covers the real
 * request/response half instead: `list_commands_request` /
 * `list_commands_response`, synthesized the same way (no recorded
 * fixture file for it yet).
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
  /** Binary frames sent via `send()` (T28B6: `DaemonClient.uploadFile`'s `FileBegin`/`FileChunk`/`FileEnd` frames). */
  sentBinary: Uint8Array[] = [];
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
    if (typeof data === "string") {
      this.sent.push(data);
      return;
    }
    this.sentBinary.push(data instanceof Uint8Array ? data : new Uint8Array(data));
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

describe("createDaemonAgentTurnClient (queue-update fixtures)", () => {
  it("round-trips onQueueUpdate against a live agent_stream pi_queue_update push", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0001",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const received: Array<{ steering: readonly string[]; followUp: readonly string[] }> = [];
    const unsubscribe = turnClient.onQueueUpdate?.("agt_fixture_0001", (update) => {
      received.push(update);
    });
    if (!unsubscribe) throw new Error("expected onQueueUpdate to be implemented");

    // A live queue-depth push, exactly the wire shape
    // `AgentStreamMessageSchema`/`pi_queue_update` in
    // `packages/protocol/src/messages.ts` describes — this half of the
    // queue contract already works against today's dev daemon, since
    // the ported Pi provider genuinely emits `queue_update`.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_stream",
        payload: {
          agentId: "agt_fixture_0001",
          timestamp: "2024-01-01T00:00:00.000Z",
          event: {
            type: "pi_queue_update",
            provider: "pi",
            steering: ["fix the failing test"],
            followUp: ["then update the changelog"],
          },
        },
      },
    });
    await flushMicrotasks();

    expect(received).toEqual([
      { steering: ["fix the failing test"], followUp: ["then update the changelog"] },
    ]);

    // A push for a different agentId is filtered out, not misdelivered.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_stream",
        payload: {
          agentId: "agt_fixture_other",
          timestamp: "2024-01-01T00:00:01.000Z",
          event: { type: "pi_queue_update", provider: "pi", steering: ["unrelated"], followUp: [] },
        },
      },
    });
    await flushMicrotasks();
    expect(received).toHaveLength(1);

    unsubscribe();
    await daemonClient.close();
  }, 10_000);
});

describe("createDaemonAgentTurnClient (listCommands fixtures)", () => {
  it("round-trips listCommands against a live list_commands_response, in daemon order", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0002",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const listPromise = turnClient.listCommands?.("agt_fixture_0001");
    if (!listPromise) throw new Error("expected listCommands to be implemented");
    await flushMicrotasks();

    const sentRequest = socket.sent
      .map(
        (raw) =>
          JSON.parse(raw) as {
            type: string;
            message?: { type: string; requestId: string; agentId: string };
          },
      )
      .find((frame) => frame.type === "session" && frame.message?.type === "list_commands_request");
    if (!sentRequest?.message) throw new Error("expected a list_commands_request frame to be sent");
    expect(sentRequest.message.agentId).toBe("agt_fixture_0001");

    // A live `list_commands_response`, exactly the wire shape
    // `ListCommandsResponseSchema` in `packages/protocol/src/messages.ts`
    // describes — no fixture file recorded for this yet, synthesized here
    // the same way the queue-update test above synthesizes its push frame.
    socket.receiveJson({
      type: "session",
      message: {
        type: "list_commands_response",
        payload: {
          agentId: "agt_fixture_0001",
          requestId: sentRequest.message.requestId,
          error: null,
          commands: [
            { name: "compact", description: "Compact the conversation", argumentHint: "[reason]" },
            {
              name: "undo",
              description: "Undo the last change",
              argumentHint: "",
              kind: "command",
            },
          ],
        },
      },
    });

    const commands = await listPromise;
    expect(commands).toEqual([
      { name: "compact", description: "Compact the conversation", argumentHint: "[reason]" },
      { name: "undo", description: "Undo the last change", argumentHint: "", kind: "command" },
    ]);

    await daemonClient.close();
  }, 10_000);

  it("propagates the daemon's raw explanation when list_commands_response reports an error", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0003",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const listPromise = turnClient.listCommands?.("agt_fixture_0001");
    if (!listPromise) throw new Error("expected listCommands to be implemented");
    await flushMicrotasks();

    const sentRequest = socket.sent
      .map(
        (raw) => JSON.parse(raw) as { type: string; message?: { type: string; requestId: string } },
      )
      .find((frame) => frame.type === "session" && frame.message?.type === "list_commands_request");
    if (!sentRequest?.message) throw new Error("expected a list_commands_request frame to be sent");

    socket.receiveJson({
      type: "session",
      message: {
        type: "list_commands_response",
        payload: {
          agentId: "agt_fixture_0001",
          requestId: sentRequest.message.requestId,
          error: "provider does not support commands",
          commands: [],
        },
      },
    });

    await expect(listPromise).rejects.toThrow("provider does not support commands");
    await daemonClient.close();
  }, 10_000);
});

/**
 * A minimal, schema-valid `AgentSnapshotPayload` for `fetch_agent_response`
 * and `agent_update`'s `upsert` payload, matching the constant
 * `daemon-session-resume-client.fixture.test.ts` already established for
 * T27B3's own `fetch_agent_request` round trip.
 */
const FIXTURE_AGENT = {
  id: "agt_fixture_0001",
  provider: "pi",
  cwd: "/synthetic/workspace/fixture-repo",
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
  persistence: { provider: "pi", sessionId: "pi-sess-fixture-0001" },
  title: "Fixture session",
  labels: {},
  archivedAt: null,
};

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

describe("createDaemonAgentTurnClient (model/thinking fixtures, T28B5)", () => {
  it("round-trips getAgentModelSnapshot against a live fetch_agent_response", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0004",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const snapshotPromise = turnClient.getAgentModelSnapshot?.("agt_fixture_0001");
    if (!snapshotPromise) throw new Error("expected getAgentModelSnapshot to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "fetch_agent_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");

    socket.receiveJson({
      type: "session",
      message: {
        type: "fetch_agent_response",
        payload: { requestId: sentRequest.requestId, agent: FIXTURE_AGENT, error: null },
      },
    });

    await expect(snapshotPromise).resolves.toEqual({
      provider: "pi",
      modelId: "fixture-model-large",
      thinkingOptionId: "medium",
      effectiveThinkingOptionId: "medium",
    });

    await daemonClient.close();
  }, 10_000);

  it("round-trips onAgentModelSnapshotChange against a live agent_update push, filtered by agentId", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0005",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const received: Array<{ modelId: string | null }> = [];
    const unsubscribe = turnClient.onAgentModelSnapshotChange?.("agt_fixture_0001", (snapshot) => {
      received.push({ modelId: snapshot.modelId });
    });
    if (!unsubscribe) throw new Error("expected onAgentModelSnapshotChange to be implemented");

    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: { kind: "upsert", agent: { ...FIXTURE_AGENT, model: "fixture-model-small" } },
      },
    });
    await flushMicrotasks();
    expect(received).toEqual([{ modelId: "fixture-model-small" }]);

    // A push for a different agentId is filtered out, not misdelivered.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: { ...FIXTURE_AGENT, id: "agt_fixture_other", model: "unrelated" },
        },
      },
    });
    // A `remove` push carries no model fields and must not be misparsed.
    socket.receiveJson({
      type: "session",
      message: { type: "agent_update", payload: { kind: "remove", agentId: "agt_fixture_0001" } },
    });
    await flushMicrotasks();
    expect(received).toHaveLength(1);

    unsubscribe();
    await daemonClient.close();
  }, 10_000);

  it("round-trips listAvailableModels against a live list_provider_models_response", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0006",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const modelsPromise = turnClient.listAvailableModels?.("pi");
    if (!modelsPromise) throw new Error("expected listAvailableModels to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "list_provider_models_request");
    expect(sentRequest.provider).toBe("pi");

    socket.receiveJson({
      type: "session",
      message: {
        type: "list_provider_models_response",
        payload: {
          provider: "pi",
          requestId: sentRequest.requestId,
          fetchedAt: "2026-08-31T12:00:00.000Z",
          error: null,
          models: [
            {
              provider: "pi",
              id: "fixture-model-large",
              label: "Fixture Large",
              isDefault: true,
              thinkingOptions: [{ id: "medium", label: "Medium", isDefault: true }],
            },
          ],
        },
      },
    });

    // `DaemonClient.listProviderModels` normalizes a missing
    // `defaultThinkingOptionId` from whichever `thinkingOptions` entry is
    // `isDefault` (`normalizeAgentModelDefinition`), so the resolved value
    // carries one even though the wire payload above did not send it.
    await expect(modelsPromise).resolves.toEqual({
      models: [
        {
          provider: "pi",
          id: "fixture-model-large",
          label: "Fixture Large",
          isDefault: true,
          thinkingOptions: [{ id: "medium", label: "Medium", isDefault: true }],
          defaultThinkingOptionId: "medium",
        },
      ],
      error: null,
    });

    await daemonClient.close();
  }, 10_000);

  it("round-trips setAgentModel against a live set_agent_model_response, and rejects on the daemon's raw explanation", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0007",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const setPromise = turnClient.setAgentModel?.("agt_fixture_0001", "fixture-model-large");
    if (!setPromise) throw new Error("expected setAgentModel to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "set_agent_model_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");
    expect(sentRequest.modelId).toBe("fixture-model-large");

    socket.receiveJson({
      type: "session",
      message: {
        type: "set_agent_model_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: true,
          error: null,
        },
      },
    });
    await expect(setPromise).resolves.toBeUndefined();

    const rejectedPromise = turnClient.setAgentModel!("agt_fixture_0001", "does-not-exist");
    await flushMicrotasks();
    const rejectedRequest = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .filter(
        (frame) => frame.type === "session" && frame.message?.type === "set_agent_model_request",
      )
      .at(-1)?.message;
    if (!rejectedRequest) throw new Error("expected a second set_agent_model_request frame");
    socket.receiveJson({
      type: "session",
      message: {
        type: "set_agent_model_response",
        payload: {
          requestId: rejectedRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: false,
          error: "unknown model id",
        },
      },
    });
    await expect(rejectedPromise).rejects.toThrow("unknown model id");

    await daemonClient.close();
  }, 10_000);

  it("round-trips setAgentThinkingOption against a live set_agent_thinking_response, carrying its provider notice", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0008",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const setPromise = turnClient.setAgentThinkingOption?.("agt_fixture_0001", null);
    if (!setPromise) throw new Error("expected setAgentThinkingOption to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "set_agent_thinking_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");
    expect(sentRequest.thinkingOptionId).toBeNull();

    socket.receiveJson({
      type: "session",
      message: {
        type: "set_agent_thinking_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: true,
          error: null,
          notice: { type: "info", message: "using the provider default" },
        },
      },
    });

    await expect(setPromise).resolves.toEqual({
      type: "info",
      message: "using the provider default",
    });

    await daemonClient.close();
  }, 10_000);
});

describe("createDaemonAgentTurnClient (uploadFile fixture, T28B6)", () => {
  it("round-trips uploadFile against a live file.upload.response, sending the file over binary frames first", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0009",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const bytes = new TextEncoder().encode("hello attachment");
    const uploadPromise = turnClient.uploadFile?.({
      fileName: "notes.txt",
      mimeType: "text/plain",
      bytes,
    });
    if (!uploadPromise) throw new Error("expected uploadFile to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "file.upload.request");
    expect(sentRequest.fileName).toBe("notes.txt");
    expect(sentRequest.mimeType).toBe("text/plain");
    expect(sentRequest.size).toBe(bytes.byteLength);
    // The file's bytes travel over the existing binary file-transfer
    // frames (plan.md §12.4 "binary frames"), not inside the JSON request.
    expect(socket.sentBinary.length).toBeGreaterThanOrEqual(3);

    socket.receiveJson({
      type: "session",
      message: {
        type: "file.upload.response",
        payload: {
          requestId: sentRequest.requestId,
          error: null,
          file: {
            type: "uploaded_file",
            id: "upl_fixture_0001",
            fileName: "notes.txt",
            mimeType: "text/plain",
            size: bytes.byteLength,
            path: "/uploads/upl_fixture_0001",
          },
        },
      },
    });

    await expect(uploadPromise).resolves.toEqual({
      type: "uploaded_file",
      id: "upl_fixture_0001",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      path: "/uploads/upl_fixture_0001",
    });

    await daemonClient.close();
  }, 10_000);

  it("rejects with the daemon's raw explanation when file.upload.response reports an error", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0010",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const uploadPromise = turnClient.uploadFile?.({
      fileName: "too-big.bin",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1, 2, 3]),
    });
    if (!uploadPromise) throw new Error("expected uploadFile to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "file.upload.request");

    socket.receiveJson({
      type: "session",
      message: {
        type: "file.upload.response",
        payload: { requestId: sentRequest.requestId, error: "File too large", file: null },
      },
    });

    await expect(uploadPromise).rejects.toThrow("File too large");

    await daemonClient.close();
  }, 10_000);
});

describe("createDaemonAgentTurnClient (queue-mode fixtures, T38B1a)", () => {
  // REWRITTEN (P6-W6 merge gate). This block used to hold a single
  // assertion that all three methods were `undefined` against a real
  // `DaemonClient`, with a comment saying it should be "rewritten to a
  // round-trip test like the ones above it, not deleted" the moment T110
  // landed. T110 landed FIRST in this same wave (`5806cff`, before this
  // task's `a3c3c82`), so the assertion was already false on arrival:
  // it failed 1/12 at HEAD. These three round-trips are that rewrite.
  it("round-trips getQueueModes against a live get_queue_modes_response", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0011",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const getPromise = turnClient.getQueueModes?.("agt_fixture_0001");
    if (!getPromise) throw new Error("expected getQueueModes to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "get_queue_modes_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");

    socket.receiveJson({
      type: "session",
      message: {
        type: "get_queue_modes_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          steeringMode: "one-at-a-time",
          followUpMode: "all",
          error: null,
        },
      },
    });

    await expect(getPromise).resolves.toEqual({
      steeringMode: "one-at-a-time",
      followUpMode: "all",
    });

    await daemonClient.close();
  }, 10_000);

  it("round-trips setSteeringMode against a live set_steering_mode_response, carrying the chosen mode on the wire and the resolved provider notice back to the caller (T127)", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0011b",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const setPromise = turnClient.setSteeringMode?.("agt_fixture_0001", "one-at-a-time");
    if (!setPromise) throw new Error("expected setSteeringMode to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "set_steering_mode_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");
    expect(sentRequest.mode).toBe("one-at-a-time");

    socket.receiveJson({
      type: "session",
      message: {
        type: "set_steering_mode_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: true,
          error: null,
          notice: { type: "info", message: "steering mode applies from the next turn" },
        },
      },
    });

    // CORRECTED (T127): this used to assert `.resolves.toBeUndefined()`,
    // which stayed green even while the adapter awaited and discarded the
    // daemon's real `notice` payload above — the actual defect T127
    // closed. Asserting the notice itself is what makes this
    // mutation-provable: reverting `daemon-agent-turn-client.ts`'s
    // `setSteeringMode` to `await daemon.setSteeringMode!(...)` (dropping
    // its return value) fails this exact assertion.
    await expect(setPromise).resolves.toEqual({
      type: "info",
      message: "steering mode applies from the next turn",
    });

    await daemonClient.close();
  }, 10_000);

  it("round-trips setFollowUpMode against a live set_follow_up_mode_response, and rejects when the daemon reports an error", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0011c",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const setPromise = turnClient.setFollowUpMode?.("agt_fixture_0001", "all");
    if (!setPromise) throw new Error("expected setFollowUpMode to be implemented");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "set_follow_up_mode_request");
    expect(sentRequest.agentId).toBe("agt_fixture_0001");
    expect(sentRequest.mode).toBe("all");

    socket.receiveJson({
      type: "session",
      message: {
        type: "set_follow_up_mode_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: false,
          error: "provider rejected the follow-up mode",
        },
      },
    });

    await expect(setPromise).rejects.toThrow("provider rejected the follow-up mode");

    await daemonClient.close();
  }, 10_000);

  it("round-trips onQueueModesChange against a live agent_update push today, independent of T110 — it only needs the daemon's existing push", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0012",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const received: Array<{ steeringMode: string | null; followUpMode: string | null }> = [];
    const unsubscribe = turnClient.onQueueModesChange?.("agt_fixture_0001", (modes) => {
      received.push(modes);
    });
    if (!unsubscribe) throw new Error("expected onQueueModesChange to be implemented");

    // A live `agent_update` push carrying both modes inside
    // `runtimeInfo.extra` (T38B0c's `getRuntimeInfo()` shape) — exactly
    // the wire shape a real dev daemon emits today.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            runtimeInfo: {
              provider: "pi",
              sessionId: "pi-sess-fixture-0001",
              extra: { steeringMode: "all", followUpMode: "one-at-a-time" },
            },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(received).toEqual([{ steeringMode: "all", followUpMode: "one-at-a-time" }]);

    // A provider that reports no queue modes at all (no `runtimeInfo`, or
    // `extra` values that are not real `QueueMode` literals) is reflected
    // as `null`, never misparsed into a fabricated mode.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            runtimeInfo: { provider: "pi", sessionId: "pi-sess-fixture-0001", extra: {} },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(received.at(-1)).toEqual({ steeringMode: null, followUpMode: null });

    // A push for a different agentId is filtered out, not misdelivered.
    socket.receiveJson({
      type: "session",
      message: {
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            ...FIXTURE_AGENT,
            id: "agt_fixture_other",
            runtimeInfo: {
              provider: "pi",
              sessionId: "pi-sess-fixture-0001",
              extra: { steeringMode: "all", followUpMode: "all" },
            },
          },
        },
      },
    });
    await flushMicrotasks();
    expect(received).toHaveLength(2);

    unsubscribe();
    await daemonClient.close();
  }, 10_000);
});

describe("createDaemonAgentTurnClient (sendAgentMessage streamingBehavior, T38B1b)", () => {
  it("carries no streamingBehavior on the wire when the caller does not choose one", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0013",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const sendPromise = turnClient.sendAgentMessage("agt_fixture_0001", "hello");
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "send_agent_message_request");
    expect(sentRequest).not.toHaveProperty("streamingBehavior");

    socket.receiveJson({
      type: "session",
      message: {
        type: "send_agent_message_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: true,
          error: null,
        },
      },
    });
    await sendPromise;

    await daemonClient.close();
  }, 10_000);

  // CLOSED (P6-W7 merge gate). This was a `GAP:` test asserting that an
  // explicit routing choice was silently DROPPED by the real
  // `DaemonClient`, with its own comment saying that when
  // `packages/client` was fixed the assertion would fail and must then be
  // replaced by a round-trip rather than widened. That is what happened:
  // the gate added `streamingBehavior` to `SendMessageOptions` and the
  // conditional spread in `sendAgentMessage`, so the choice now reaches
  // the wire. The `GAP` doc block in `daemon-agent-turn-client.ts` was
  // deleted alongside it. The sibling test below still proves the spread
  // stays conditional.
  it("carries an explicit streamingBehavior choice all the way onto the send_agent_message_request wire frame", async () => {
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_composer_0014",
    );
    const turnClient = createDaemonAgentTurnClient(daemonClient);

    const sendPromise = turnClient.sendAgentMessage("agt_fixture_0001", "steer this one", {
      streamingBehavior: "steer",
    });
    await flushMicrotasks();

    const sentRequest = findSentRequest(socket, "send_agent_message_request");
    // The whole point of T38B1b: a real caller asked for "steer", and the
    // real, shipped `DaemonClient` put that exact value on the frame the
    // daemon reads (`session.ts`'s `handleSendAgentMessageRequest` lifts it
    // into `runOptions`).
    expect(sentRequest.streamingBehavior).toBe("steer");

    socket.receiveJson({
      type: "session",
      message: {
        type: "send_agent_message_response",
        payload: {
          requestId: sentRequest.requestId,
          agentId: "agt_fixture_0001",
          accepted: true,
          error: null,
        },
      },
    });
    await sendPromise;

    await daemonClient.close();
  }, 10_000);
});
