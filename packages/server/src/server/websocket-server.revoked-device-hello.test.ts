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
 * T300 — proves a revoked `clientId` cannot re-establish a trusted
 * connection via `handleHello`, in both directions:
 *
 *  - a brand-new hello (no prior `externalSessionsByKey` entry for this
 *    process) from a revoked `clientId` is rejected before a connection is
 *    ever created;
 *  - a hello that WOULD otherwise resume an existing in-memory session
 *    (the `existing` branch in `handleHello`) is rejected the same way,
 *    proving the check runs before either branch, not only the "new
 *    connection" one.
 *
 * The mutation this test is built to catch: removing the
 * `revokedDeviceStore.isRevoked(clientId)` consultation `handleHello` added
 * for T300 makes every assertion below that expects a close/rejection fail
 * — see this task's report for the observed red/green pair.
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

describe("handleHello refuses a revoked clientId (T300)", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  function withServer(fn: (internals: WebSocketServerInternals) => void | Promise<void>) {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-revoked-hello-"));
    cleanup = () => rmSync(home, { recursive: true, force: true });
    const server = createServer(home);
    return fn(asInternals<WebSocketServerInternals>(server));
  }

  test("a brand-new hello from a revoked clientId is closed, not admitted", async () => {
    await withServer(async (internals) => {
      internals.revokedDeviceStore.revoke("stolen-phone");

      const ws = createSocket();
      internals.handleHello({ ws, message: createHello("stolen-phone"), pending: createPending() });

      expect(ws.close).toHaveBeenCalledWith(4004, "Device revoked");
      expect(internals.externalSessionsByKey.has("stolen-phone")).toBe(false);
    });
  });

  test("a non-revoked clientId's hello is admitted normally (no false-positive rejection)", async () => {
    await withServer(async (internals) => {
      const ws = createSocket();
      internals.handleHello({
        ws,
        message: createHello("trusted-phone"),
        pending: createPending(),
      });

      expect(ws.close).not.toHaveBeenCalled();
      expect(internals.externalSessionsByKey.has("trusted-phone")).toBe(true);
    });
  });

  test("a hello that would otherwise RESUME an existing in-memory session is also refused once revoked", async () => {
    await withServer(async (internals) => {
      // First hello: admitted normally, creating a live externalSessionsByKey entry.
      const firstSocket = createSocket();
      internals.handleHello({
        ws: firstSocket,
        message: createHello("resumable-phone"),
        pending: createPending(),
      });
      expect(internals.externalSessionsByKey.has("resumable-phone")).toBe(true);

      // Now revoke it — directly against the store, simulating a revoke
      // issued while this clientId still has a live/resumable entry.
      internals.revokedDeviceStore.revoke("resumable-phone");

      // A second hello for the SAME clientId would, pre-T300, hit the
      // `existing` resume branch. It must be refused instead.
      const secondSocket = createSocket();
      internals.handleHello({
        ws: secondSocket,
        message: createHello("resumable-phone"),
        pending: createPending(),
      });

      expect(secondSocket.close).toHaveBeenCalledWith(4004, "Device revoked");
    });
  });

  test("survives a daemon restart: a fresh server built against the same paseoHome still refuses the revoked clientId", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-revoked-hello-restart-"));
    try {
      const first = asInternals<WebSocketServerInternals>(createServer(home));
      first.revokedDeviceStore.revoke("stolen-phone");

      // A brand-new server instance against the same paseoHome simulates a
      // daemon restart — real storage, not an in-memory fake.
      const second = asInternals<WebSocketServerInternals>(createServer(home));
      const ws = createSocket();
      second.handleHello({ ws, message: createHello("stolen-phone"), pending: createPending() });

      expect(ws.close).toHaveBeenCalledWith(4004, "Device revoked");
      expect(second.externalSessionsByKey.has("stolen-phone")).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("handleTrustedDeviceRevokeRequest revoking a device makes its NEXT hello refused — the end-to-end wiring, not just the store in isolation", async () => {
    await withServer(async (internals) => {
      const active = createConnection("owner-device");
      const target = createConnection("target-device");
      internals.externalSessionsByKey.set(active.clientId, active);
      internals.externalSessionsByKey.set(target.clientId, target);

      await internals.handleTrustedDeviceRevokeRequest(
        createSocket(),
        active,
        "req-1",
        "target-device",
      );

      expect(internals.revokedDeviceStore.isRevoked("target-device")).toBe(true);

      const ws = createSocket();
      internals.handleHello({
        ws,
        message: createHello("target-device"),
        pending: createPending(),
      });
      expect(ws.close).toHaveBeenCalledWith(4004, "Device revoked");
    });
  });
});
