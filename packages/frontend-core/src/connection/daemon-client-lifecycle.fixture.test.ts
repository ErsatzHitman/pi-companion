import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";
import { DaemonClientLifecycle } from "./daemon-client-lifecycle.js";

/**
 * Exercises `DaemonClientLifecycle` against the *real* `@picompanion/client`
 * `DaemonClient` (not a fake), wired to an in-memory fake WebSocket that
 * replays the recorded T06B fixture
 * (`@picompanion/protocol/fixtures/daemon-ws/hello-capability-negotiation`).
 * This is the acceptance-criterion test: "Recorded hello/capability
 * fixtures drive gate state correctly."
 *
 * Loads the fixture JSON directly by relative path (test-only; the JSON is
 * not copied into @picompanion/protocol's published dist — see
 * packages/protocol/src/fixtures/README.md). `fixtures.test.ts` in that
 * package already proves every frame here validates against the real wire
 * schema; this test proves this package's lifecycle wrapper reacts to it
 * correctly.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  here,
  "..",
  "..",
  "..",
  "protocol",
  "src",
  "fixtures",
  "daemon-ws",
  "hello-capability-negotiation.json",
);

interface FixtureFrame {
  id: string;
  direction: "client_to_daemon" | "daemon_to_client";
  message: unknown;
}

function loadFixtureFrames(): FixtureFrame[] {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { frames: FixtureFrame[] };
  return fixture.frames;
}

function frameById(frames: FixtureFrame[], id: string): FixtureFrame {
  const frame = frames.find((candidate) => candidate.id === id);
  if (!frame) {
    throw new Error(`hello-capability-negotiation fixture is missing frame "${id}"`);
  }
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

function makeFixtureLifecycle(): { lifecycle: DaemonClientLifecycle; sockets: FakeWebSocket[] } {
  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = (_url, _options) => {
    const socket = new FakeWebSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };
  const lifecycle = new DaemonClientLifecycle({
    url: "ws://fixture.invalid/ws",
    clientId: "clid_fixture_web_0001",
    clientType: "browser",
    appVersion: "0.1.0-fixture",
    webSocketFactory,
    connectTimeoutMs: 5_000,
  });
  return { lifecycle, sockets };
}

describe("DaemonClientLifecycle (hello-capability-negotiation fixture)", () => {
  it("sends a hello with Pi Companion's declared capabilities and negotiates feature gates from the recorded server_info", async () => {
    const frames = loadFixtureFrames();
    const { lifecycle, sockets } = makeFixtureLifecycle();

    const connectPromise = lifecycle.connect();
    await flushMicrotasks();

    const socket = sockets[0];
    if (!socket) throw new Error("expected DaemonClientLifecycle to open a WebSocket");
    expect(socket.sent).toHaveLength(1);
    const sentHello = JSON.parse(socket.sent[0] ?? "{}") as {
      type: string;
      clientId: string;
      capabilities: Record<string, boolean>;
    };
    expect(sentHello.type).toBe("hello");
    expect(sentHello.clientId).toBe("clid_fixture_web_0001");

    const fixtureHello = frameById(frames, "hello-1").message as {
      capabilities: Record<string, boolean>;
    };
    // The wire hello carries the union of @picompanion/client's own
    // hardcoded capabilities and PI_COMPANION_CLIENT_CAPABILITIES; the
    // fixture's declared set must be a subset (every capability the
    // fixture expects is actually declared, with the same value).
    for (const [capabilityId, expected] of Object.entries(fixtureHello.capabilities)) {
      expect(sentHello.capabilities[capabilityId]).toBe(expected);
    }

    // Deliver the recorded server_info reply and let hello resolve.
    const serverInfoFrame = frameById(frames, "server-info-1");
    socket.receiveJson(serverInfoFrame.message);
    await connectPromise;

    expect(lifecycle.getStatus()).toBe("connected");
    const gates = lifecycle.getFeatureGates();
    expect(gates.negotiated).toBe(true);
    expect(gates.serverId).toBe("srv_fixture_0001");
    expect(gates.hostname).toBe("fixture-daemon");
    expect(gates.version).toBe("0.1.0-fixture");
    expect(gates.desktopManaged).toBe(false);
    // The fixture's `capabilities.voice` is shaped as a bare
    // `{enabled, reason}` pair, but the current protocol
    // `ServerCapabilitiesSchema` expects `voice: { dictation, voice }`
    // (each itself `{enabled, reason}`) — a pre-existing T06B fixture/schema
    // mismatch, not something T19A owns. `ServerCapabilitiesFromUnknownSchema`
    // safe-parses and drops the whole field rather than throwing, so
    // `capabilities` ends up undefined here; assert that real behavior.
    expect(gates.capabilities).toBeUndefined();

    // Every feature the fixture's server_info advertised as true gates on;
    // a feature the fixture never mentions gates off (absent means disabled).
    expect(lifecycle.isFeatureEnabled("rewind")).toBe(true);
    expect(lifecycle.isFeatureEnabled("workspaceMultiplicity")).toBe(true);
    expect(lifecycle.isFeatureEnabled("piUiBridge")).toBe(true);
    expect(lifecycle.isFeatureEnabled("trustedDevices")).toBe(true);
    expect(lifecycle.isFeatureEnabled("agentThinkingUpdate")).toBe(false);

    await lifecycle.dispose();
  });

  it("negotiates feature gates exactly once per connection even if server_info is somehow observed twice", async () => {
    const frames = loadFixtureFrames();
    const { lifecycle, sockets } = makeFixtureLifecycle();

    const connectPromise = lifecycle.connect();
    await flushMicrotasks();
    const socket = sockets[0];
    if (!socket) throw new Error("expected DaemonClientLifecycle to open a WebSocket");

    const serverInfoFrame = frameById(frames, "server-info-1");
    socket.receiveJson(serverInfoFrame.message);
    await connectPromise;

    const negotiatedSnapshots: boolean[] = [];
    lifecycle.subscribeFeatureGates((snapshot) => negotiatedSnapshots.push(snapshot.negotiated));
    const firstSnapshot = lifecycle.getFeatureGates();

    // A second, differently-featured server_info arriving on the same
    // connection (the daemon does not do this in practice, but the
    // "exactly once" contract must hold regardless) must not retrigger
    // negotiation or change the frozen snapshot.
    const mutatedServerInfoMessage = JSON.parse(JSON.stringify(serverInfoFrame.message)) as {
      message: { payload: { features: Record<string, boolean> } };
    };
    mutatedServerInfoMessage.message.payload.features.rewind = false;
    socket.receiveJson(mutatedServerInfoMessage);

    expect(lifecycle.getFeatureGates()).toBe(firstSnapshot);
    expect(lifecycle.isFeatureEnabled("rewind")).toBe(true);
    expect(negotiatedSnapshots).toEqual([true]);

    await lifecycle.dispose();
  });

  it("connect/disconnect/dispose is leak-free: dispose() closes the socket and no further hello is sent", async () => {
    const { lifecycle, sockets } = makeFixtureLifecycle();
    const frames = loadFixtureFrames();

    const connectPromise = lifecycle.connect();
    await flushMicrotasks();
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error("expected a socket");
    firstSocket.receiveJson(frameById(frames, "server-info-1").message);
    await connectPromise;

    await lifecycle.disconnect();
    expect(firstSocket.readyState).toBe(3);
    expect(lifecycle.getStatus()).toBe("disconnected");

    const reconnectPromise = lifecycle.connect();
    await flushMicrotasks();
    const secondSocket = sockets[1];
    if (!secondSocket) throw new Error("expected a second socket after reconnect");
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.receiveJson(frameById(frames, "server-info-1").message);
    await reconnectPromise;
    expect(lifecycle.getFeatureGates().negotiated).toBe(true);

    await lifecycle.dispose();
    expect(secondSocket.readyState).toBe(3);
    expect(lifecycle.getStatus()).toBe("disposed");

    await expect(lifecycle.connect()).rejects.toThrow(/disposed/i);
    expect(sockets).toHaveLength(2); // dispose() opened no further socket
  });
});
