import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { FileBackedChatService } from "./chat/chat-service.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { RevokedDeviceStore } from "./devices/revoked-device-store.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { LoopService } from "./loop-service.js";
import type { PushTokenStore } from "./push/token-store.js";
import type { ScheduleService } from "./schedule/service.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

/**
 * Device un-revoke — the undo half of `trusted_device.revoke`.
 *
 * Proves `handleTrustedDeviceUnrevokeRequest` removes the denylist entry
 * `handleTrustedDeviceRevokeRequest` (via `RevokedDeviceStore.revoke`)
 * created, so the device's NEXT `hello` is admitted again — alongside the
 * envelope contract (every failure, including a storage failure, is a
 * `success: false` envelope, never a throw) and the idempotency rule
 * (un-revoking a `clientId` that was never revoked succeeds without
 * changing anything).
 *
 * The mutation these tests are built to catch: deleting the
 * `revokedDeviceStore.unrevoke` call (or the dispatch branch that reaches
 * it) makes the "no longer revoked" and "hello admitted again"
 * assertions fail while the response envelope still reports success.
 */

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }
    close() {}
  }
  return { MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: function Session() {
    return {
      updateAppVersion: vi.fn(),
      updateClientCapabilities: vi.fn(),
      getSessionId: () => "session-1",
      cleanup: vi.fn(async () => {}),
    };
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

interface FakeWebSocket {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

interface FakeTrustedConnection {
  kind: "trusted";
  session: {
    cleanup: () => Promise<void>;
    updateAppVersion: (v: string) => void;
    updateClientCapabilities: (c: unknown, ws: unknown) => void;
    getSessionId: () => string;
  };
  clientId: string;
  appVersion: string | null;
  clientCapabilities: Record<string, unknown> | null;
  connectionLogger: pino.Logger;
  sockets: Set<FakeWebSocket>;
  externalDisconnectCleanupTimeout: null;
  lastSeenAt: string;
}

interface FakePendingConnection {
  connectionLogger: pino.Logger;
  helloTimeout: null;
  identity: {
    connectionId: string;
    transport: "direct" | "relay";
    peer: "loopback" | "local_ipc" | "external";
    browserOrigin: boolean;
    clientId?: string;
    sessionId?: string;
    appVersion?: string;
  };
}

interface FakeHelloMessage {
  type: "hello";
  clientId: string;
  clientType: "mobile";
  protocolVersion: number;
}

interface UnrevokeEnvelope {
  message: {
    type: string;
    payload: { requestId: string; clientId: string; success: boolean; error: string | null };
  };
}

interface WebSocketServerInternals {
  revokedDeviceStore: RevokedDeviceStore;
  pushTokenStore: PushTokenStore;
  externalSessionsByKey: Map<string, FakeTrustedConnection>;
  handleHello(params: {
    ws: FakeWebSocket;
    message: FakeHelloMessage;
    pending: FakePendingConnection;
  }): void;
  handleTrustedDeviceRevokeRequest(
    ws: FakeWebSocket,
    activeConnection: FakeTrustedConnection,
    requestId: string,
    targetClientId: string,
  ): Promise<void>;
  handleTrustedDeviceUnrevokeRequest(
    ws: FakeWebSocket,
    activeConnection: FakeTrustedConnection,
    requestId: string,
    targetClientId: string,
  ): void;
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createSocket(): FakeWebSocket {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function createConnection(clientId: string): FakeTrustedConnection {
  return {
    kind: "trusted",
    session: {
      cleanup: vi.fn(async () => {}),
      updateAppVersion: vi.fn(),
      updateClientCapabilities: vi.fn(),
      getSessionId: () => `session-${clientId}`,
    },
    clientId,
    appVersion: null,
    clientCapabilities: null,
    connectionLogger: createLogger() as unknown as pino.Logger,
    sockets: new Set([createSocket()]),
    externalDisconnectCleanupTimeout: null,
    lastSeenAt: new Date().toISOString(),
  };
}

function createPending(): FakePendingConnection {
  return {
    connectionLogger: createLogger() as unknown as pino.Logger,
    helloTimeout: null,
    identity: {
      connectionId: "conn-1",
      transport: "direct",
      peer: "loopback",
      browserOrigin: false,
    },
  };
}

function createHello(clientId: string): FakeHelloMessage {
  return { type: "hello", clientId, clientType: "mobile", protocolVersion: 1 };
}

function parseUnrevokeEnvelope(socket: FakeWebSocket): UnrevokeEnvelope {
  expect(socket.send).toHaveBeenCalled();
  const [sentRaw] = socket.send.mock.calls[0] as [string];
  return JSON.parse(sentRaw) as UnrevokeEnvelope;
}

function createServer(paseoHome: string) {
  const agentManager = {
    subscribe: vi.fn(() => () => {}),
    setAgentAttentionCallback: vi.fn(),
    getAgent: vi.fn(() => ({ workspaceId: "workspace-1", pendingPermissions: new Map() })),
    getLastAssistantMessage: vi.fn(async () => null),
    getMetricsSnapshot: vi.fn(() => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: { totalItems: 0, maxItemsPerAgent: 0 },
    })),
  };
  const daemonConfigStore = { onChange: vi.fn(() => () => {}) };

  return new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    paseoHome,
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    createStub<WorkspaceAutoName>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<FileBackedChatService>({}),
    createStub<LoopService>({}),
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
  );
}

describe("handleTrustedDeviceUnrevokeRequest", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  function withServer(fn: (internals: WebSocketServerInternals) => void | Promise<void>) {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-unrevoke-"));
    cleanup = () => rmSync(home, { recursive: true, force: true });
    const server = createServer(home);
    return fn(asInternals<WebSocketServerInternals>(server));
  }

  test("un-revoking a revoked device removes the denylist entry and responds success", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      const target = createConnection("target-device");
      internals.externalSessionsByKey.set(active.clientId, active);
      internals.externalSessionsByKey.set(target.clientId, target);

      await internals.handleTrustedDeviceRevokeRequest(
        createSocket(),
        active,
        "req-revoke",
        "target-device",
      );
      expect(internals.revokedDeviceStore.isRevoked("target-device")).toBe(true);

      const requesterSocket = createSocket();
      internals.handleTrustedDeviceUnrevokeRequest(
        requesterSocket,
        active,
        "req-unrevoke",
        "target-device",
      );

      expect(internals.revokedDeviceStore.isRevoked("target-device")).toBe(false);
      const sent = parseUnrevokeEnvelope(requesterSocket);
      expect(sent.message.type).toBe("trusted_device.unrevoke.response");
      expect(sent.message.payload).toEqual({
        requestId: "req-unrevoke",
        clientId: "target-device",
        success: true,
        error: null,
      });
    });
  });

  test("un-revoking a clientId that was never revoked is an idempotent success, not an error", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      internals.externalSessionsByKey.set(active.clientId, active);

      const requesterSocket = createSocket();
      expect(() =>
        internals.handleTrustedDeviceUnrevokeRequest(
          requesterSocket,
          active,
          "req-1",
          "never-revoked",
        ),
      ).not.toThrow();

      expect(internals.revokedDeviceStore.isRevoked("never-revoked")).toBe(false);
      const sent = parseUnrevokeEnvelope(requesterSocket);
      expect(sent.message.type).toBe("trusted_device.unrevoke.response");
      expect(sent.message.payload.success).toBe(true);
      expect(sent.message.payload.error).toBeNull();
    });
  });

  test("a blank clientId responds with an Invalid clientId envelope and never throws", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      internals.externalSessionsByKey.set(active.clientId, active);

      const requesterSocket = createSocket();
      expect(() =>
        internals.handleTrustedDeviceUnrevokeRequest(requesterSocket, active, "req-1", "   "),
      ).not.toThrow();

      const sent = parseUnrevokeEnvelope(requesterSocket);
      expect(sent.message.type).toBe("trusted_device.unrevoke.response");
      expect(sent.message.payload.success).toBe(false);
      expect(sent.message.payload.error).toBe("Invalid clientId");
    });
  });

  test("a storage failure is reported as an error envelope, never a throw", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      internals.externalSessionsByKey.set(active.clientId, active);

      internals.revokedDeviceStore = createStub<RevokedDeviceStore>({
        unrevoke: () => {
          throw new Error("disk is gone");
        },
      });

      const requesterSocket = createSocket();
      expect(() =>
        internals.handleTrustedDeviceUnrevokeRequest(
          requesterSocket,
          active,
          "req-1",
          "target-device",
        ),
      ).not.toThrow();

      const sent = parseUnrevokeEnvelope(requesterSocket);
      expect(sent.message.type).toBe("trusted_device.unrevoke.response");
      expect(sent.message.payload).toEqual({
        requestId: "req-1",
        clientId: "target-device",
        success: false,
        error: "disk is gone",
      });
    });
  });

  test("end to end: revoke refuses the next hello, un-revoke admits it again", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      const target = createConnection("target-device");
      internals.externalSessionsByKey.set(active.clientId, active);
      internals.externalSessionsByKey.set(target.clientId, target);

      await internals.handleTrustedDeviceRevokeRequest(
        createSocket(),
        active,
        "req-revoke",
        "target-device",
      );

      const refused = createSocket();
      internals.handleHello({
        ws: refused,
        message: createHello("target-device"),
        pending: createPending(),
      });
      expect(refused.close).toHaveBeenCalledWith(4004, "Device revoked");

      internals.handleTrustedDeviceUnrevokeRequest(
        createSocket(),
        active,
        "req-unrevoke",
        "target-device",
      );

      const admitted = createSocket();
      internals.handleHello({
        ws: admitted,
        message: createHello("target-device"),
        pending: createPending(),
      });
      expect(admitted.close).not.toHaveBeenCalled();
      expect(internals.externalSessionsByKey.has("target-device")).toBe(true);
    });
  });
});
