import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { connection } from "@picompanion/frontend-core";

import { parseConnectAddress } from "./connect-form-model.js";
import { createDaemonConnectAttempt } from "./daemon-connect-attempt.js";

/**
 * Exercises `createDaemonConnectAttempt` against the *real*
 * `@picompanion/frontend-core` `connection.DaemonClientLifecycle` (which
 * itself wraps the real `@picompanion/client` `DaemonClient`, never a
 * fake), wired to an in-memory scripted fake WebSocket — the same
 * approach and the same recorded T19A/T06B fixture
 * `daemon-client-lifecycle.fixture.test.ts` uses. This is this task's
 * acceptance-criterion test: "Submitting a valid `ws://host:port`
 * constructs a real `DaemonClientLifecycle` and completes the hello
 * exchange, proven against the recorded fixtures T19A already uses."
 *
 * Also proves the second acceptance criterion — "Connection failures
 * (refused, timed out, wrong daemon key) surface as distinct named
 * errors" — by scripting the fake socket to fail three different ways
 * and asserting three different `ConnectAttemptFailure.kind`s.
 *
 * No test in this file opens a real socket or touches an emulator: the
 * `webSocketFactory` seam is exactly `createDaemonConnectAttempt`'s
 * injectable transport (this task's fourth acceptance criterion).
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
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

/** The socket shape `DaemonClientLifecycleConfig["webSocketFactory"]` returns, extracted structurally so this test never has to import `@picompanion/client` itself. */
type WebSocketFactory = NonNullable<connection.DaemonClientLifecycleConfig["webSocketFactory"]>;
type WebSocketLike = ReturnType<WebSocketFactory>;

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
    this.closeWith(1000, "test close");
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  /** Simulates the daemon (or an intermediary) closing the socket with a specific close code/reason. */
  closeWith(code: number, reason: string): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
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

function makeAttempt(webSocketFactory: WebSocketFactory) {
  return createDaemonConnectAttempt({
    clientId: "clid_fixture_android_0001",
    clientType: "mobile",
    appVersion: "0.1.0-fixture",
    connectTimeoutMs: 200,
    webSocketFactory,
  });
}

function parsedAddress(raw: string) {
  const result = parseConnectAddress(raw);
  if (!result.ok) throw new Error(`test fixture address failed to parse: ${result.error}`);
  return result.value;
}

describe("createDaemonConnectAttempt (hello-capability-negotiation fixture)", () => {
  it("succeeds: sends a hello and negotiates feature gates from the recorded server_info", async () => {
    const frames = loadFixtureFrames();
    const sockets: FakeWebSocket[] = [];
    const attempt = makeAttempt((_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    });

    const resultPromise = attempt(parsedAddress("ws://192.168.1.10:6767"));
    await flushMicrotasks();

    const socket = sockets[0];
    if (!socket) throw new Error("expected the attempt to open a WebSocket");
    expect(socket.sent).toHaveLength(1);
    const sentHello = JSON.parse(socket.sent[0] ?? "{}") as { type: string; clientId: string };
    expect(sentHello.type).toBe("hello");
    expect(sentHello.clientId).toBe("clid_fixture_android_0001");

    socket.receiveJson(frameById(frames, "server-info-1").message);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.lifecycle.getStatus()).toBe("connected");
    expect(result.lifecycle.getFeatureGates().negotiated).toBe(true);
    expect(result.lifecycle.isFeatureEnabled("rewind")).toBe(true);
    expect(result.lifecycle.isFeatureEnabled("agentThinkingUpdate")).toBe(false);

    await result.lifecycle.dispose();
  });

  it("classifies a refused connection as 'unreachable', distinct from other failures", async () => {
    const sockets: FakeWebSocket[] = [];
    const attempt = makeAttempt((_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      // Never opens — the transport immediately reports the close a
      // refused TCP connection produces, before any hello is sent.
      queueMicrotask(() => socket.closeWith(1006, "ECONNREFUSED"));
      return socket;
    });

    const result = await attempt(parsedAddress("ws://192.168.1.10:6767"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("unreachable");
    expect(result.error).toBe("Could not reach the daemon. Check the address and try again.");
  });

  it("classifies a connect timeout as 'unreachable' via the real DaemonClient timeout path", async () => {
    const attempt = makeAttempt(() => {
      // A socket that never opens and never closes — only the
      // `connectTimeoutMs` configured above fires.
      return new FakeWebSocket();
    });

    const result = await attempt(parsedAddress("ws://192.168.1.10:6767"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("unreachable");
    expect(result.error).toBe("Could not reach the daemon. Check the address and try again.");
  });

  it("classifies an incorrect password as 'wrong-password', distinct from 'unreachable'", async () => {
    const sockets: FakeWebSocket[] = [];
    const attempt = makeAttempt((_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    });

    const resultPromise = attempt(parsedAddress("ws://192.168.1.10:6767"), "wrong-token");
    await flushMicrotasks();
    const socket = sockets[0];
    if (!socket) throw new Error("expected the attempt to open a WebSocket");
    // WS_CLOSE_DAEMON_AUTH_FAILED's exact reason — see
    // `daemon-connection-error.ts`'s module docstring.
    socket.closeWith(4401, "Incorrect password");

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-password");
    expect(result.error).toBe("Incorrect password");
  });

  it("classifies a decryption failure as 'wrong-daemon-key', distinct from 'wrong-password' and 'unreachable'", async () => {
    const sockets: FakeWebSocket[] = [];
    const attempt = makeAttempt((_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    });

    const resultPromise = attempt(parsedAddress("wss://192.168.1.10:6767"));
    await flushMicrotasks();
    const socket = sockets[0];
    if (!socket) throw new Error("expected the attempt to open a WebSocket");
    socket.closeWith(1011, "Decryption failed");

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-daemon-key");
    // Android's connect form is direct-only today (no relay pairing
    // link) — see `daemon-connection-error.ts`'s module docstring — so
    // the direct describer still degrades this to the generic "unknown"
    // copy rather than mentioning a daemon key this path doesn't have.
    expect(result.error).toBe(
      "Could not sign in to this daemon. Check the address and access token, then try again.",
    );
  });

  it("disposes the lifecycle on failure — no connecting generation is left running in the background", async () => {
    const sockets: FakeWebSocket[] = [];
    const attempt = makeAttempt((_url, _options) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.closeWith(1006, "ECONNREFUSED"));
      return socket;
    });

    const result = await attempt(parsedAddress("ws://192.168.1.10:6767"));
    expect(result.ok).toBe(false);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.readyState).toBe(3);
  });
});
