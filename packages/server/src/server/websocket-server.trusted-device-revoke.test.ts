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
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { LoopService } from "./loop-service.js";
import type { PushTokenStore } from "./push/token-store.js";
import type { ScheduleService } from "./schedule/service.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

/**
 * T299 — proves the actual consequence of a revoke, not merely that a
 * removal method was invoked: after `handleTrustedDeviceRevokeRequest`
 * runs, the revoked device's tokens are gone from `getAllTokens()` — the
 * exact list `push/notifications.ts`'s `send()` fans a push out to (see
 * `token-store.ts`'s class doc comment) — while an untouched device's
 * token survives. Removing the `pushTokenStore.removeTokensForClient`
 * call this task added to `handleTrustedDeviceRevokeRequest` makes the
 * "revoked device's tokens" assertion below fail; see this task's report
 * for the observed red/green pair.
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
    return {};
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
  session: { cleanup: () => Promise<void> };
  clientId: string;
  appVersion: string | null;
  clientCapabilities: Record<string, unknown> | null;
  connectionLogger: pino.Logger;
  sockets: Set<FakeWebSocket>;
  externalDisconnectCleanupTimeout: null;
  lastSeenAt: string;
}

interface WebSocketServerInternals {
  pushTokenStore: PushTokenStore;
  externalSessionsByKey: Map<string, FakeTrustedConnection>;
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
    session: { cleanup: vi.fn(async () => {}) },
    clientId,
    appVersion: null,
    clientCapabilities: null,
    connectionLogger: createLogger() as unknown as pino.Logger,
    sockets: new Set([createSocket()]),
    externalDisconnectCleanupTimeout: null,
    lastSeenAt: new Date().toISOString(),
  };
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

describe("handleTrustedDeviceRevokeRequest stops the revoked device's push notifications (T299)", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  function withServer(fn: (internals: WebSocketServerInternals) => Promise<void>) {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-revoke-"));
    cleanup = () => rmSync(home, { recursive: true, force: true });
    const server = createServer(home);
    return fn(asInternals<WebSocketServerInternals>(server));
  }

  test("revoking a device removes exactly that device's tokens — proven against getAllTokens(), the real send-time list", async () => {
    await withServer(async (internals) => {
      const active = createConnection("client-self");
      const target = createConnection("client-a");
      internals.externalSessionsByKey.set(active.clientId, active);
      internals.externalSessionsByKey.set(target.clientId, target);

      internals.pushTokenStore.addToken("ExponentPushToken[device-a]", "client-a");
      internals.pushTokenStore.addToken("ExponentPushToken[device-self]", "client-self");

      const requesterSocket = createSocket();
      await internals.handleTrustedDeviceRevokeRequest(
        requesterSocket,
        active,
        "req-1",
        "client-a",
      );

      // The bar this task set: an observable consequence at the point
      // notifications are actually sent from, not "removeTokensForClient
      // was called".
      expect(internals.pushTokenStore.getAllTokens()).toEqual(["ExponentPushToken[device-self]"]);

      // Sanity: the existing revoke response still reports success —
      // this task must not have broken that.
      expect(requesterSocket.send).toHaveBeenCalled();
      const [sentRaw] = requesterSocket.send.mock.calls[0] as [string];
      const sent = JSON.parse(sentRaw) as {
        message: { type: string; payload: { success: boolean } };
      };
      expect(sent.message.type).toBe("trusted_device.revoke.response");
      expect(sent.message.payload.success).toBe(true);
    });
  });

  test("a device with multiple registered tokens loses all of them on revoke, and an untouched device keeps all of its own", async () => {
    await withServer(async (internals) => {
      const active = createConnection("client-self");
      const target = createConnection("client-a");
      internals.externalSessionsByKey.set(active.clientId, active);
      internals.externalSessionsByKey.set(target.clientId, target);

      internals.pushTokenStore.addToken("ExponentPushToken[device-a-old]", "client-a");
      internals.pushTokenStore.addToken("ExponentPushToken[device-a-new]", "client-a");
      internals.pushTokenStore.addToken("ExponentPushToken[device-b-1]", "client-b");
      internals.pushTokenStore.addToken("ExponentPushToken[device-b-2]", "client-b");

      await internals.handleTrustedDeviceRevokeRequest(createSocket(), active, "req-2", "client-a");

      expect(internals.pushTokenStore.getAllTokens().sort()).toEqual(
        ["ExponentPushToken[device-b-1]", "ExponentPushToken[device-b-2]"].sort(),
      );
    });
  });
});
