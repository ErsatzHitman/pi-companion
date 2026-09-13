import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";

import { DaemonClient, type DaemonTransport } from "./daemon-client";

function createMockTransport() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];

  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  let onClose: (_event?: unknown) => void = () => {};
  let onError: (_event?: unknown) => void = () => {};

  const transport: DaemonTransport = {
    send: (data) => {
      sent.push(data);
      if (typeof data !== "string") {
        return;
      }
      const frame = JSON.parse(data) as { type?: string };
      if (frame.type === "ping") {
        onMessage(JSON.stringify({ type: "pong" }));
      }
    },
    close: () => {},
    onMessage: (handler) => {
      onMessage = handler;
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: (handler) => {
      onClose = handler;
      return () => {};
    },
    onError: (handler) => {
      onError = handler;
      return () => {};
    },
  };

  return {
    transport,
    sent,
    triggerOpen: () => {
      onOpen();
      // Ignore HELLO handshake payloads in assertions.
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "srv_test_fork",
              hostname: null,
              version: null,
            },
          },
        }),
      );
    },
    triggerClose: (event?: unknown) => onClose(event),
    triggerError: (event?: unknown) => onError(event),
    triggerMessage: (data: unknown) => onMessage(data),
  };
}

function wrapSessionMessage(message: unknown): string {
  return JSON.stringify({
    type: "session",
    message,
  });
}

function assertStr(data: string | Uint8Array | ArrayBuffer | undefined): string {
  if (typeof data !== "string") throw new Error("Expected string frame");
  return data;
}

function parseSentFrame(
  data: string | Uint8Array | ArrayBuffer | undefined,
): Record<string, unknown> {
  return z
    .object({
      type: z.literal("session"),
      message: z.record(z.string(), z.unknown()),
    })
    .parse(JSON.parse(assertStr(data))).message;
}

function forkedAgentSnapshot() {
  return {
    id: "agt_2",
    provider: "claude",
    cwd: "/tmp/project",
    model: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connectClient(clientId: string) {
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen();
  await connectPromise;
  return { client, mock };
}

test("forkAgent omits entryIndex/name for a minimal call and resolves the forked agent", async () => {
  const { client, mock } = await connectClient("fork_minimal");

  const promise = client.forkAgent("agt_1", { entryId: "entry-42" });
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  expect(request).toEqual({
    type: "agent.fork.request",
    requestId: expect.any(String),
    agentId: "agt_1",
    entryId: "entry-42",
  });
  expect(request).not.toHaveProperty("entryIndex");
  expect(request).not.toHaveProperty("name");
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.fork.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: forkedAgentSnapshot(),
        forkPoint: { messageId: "entry-42", index: 42 },
        error: null,
      },
    }),
  );

  const result = await promise;
  expect(result.agent?.id).toBe("agt_2");
  expect(result.forkPoint).toEqual({ messageId: "entry-42", index: 42 });
});

test("forkAgent sends entryIndex and name exactly as given", async () => {
  const { client, mock } = await connectClient("fork_full_options");

  const promise = client.forkAgent("agt_1", {
    entryId: "entry-42",
    entryIndex: 3,
    name: "explored branch",
  });
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  expect(request).toEqual({
    type: "agent.fork.request",
    requestId: expect.any(String),
    agentId: "agt_1",
    entryId: "entry-42",
    entryIndex: 3,
    name: "explored branch",
  });
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.fork.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: forkedAgentSnapshot(),
        forkPoint: { messageId: "entry-42", index: 3 },
        error: null,
      },
    }),
  );

  const result = await promise;
  expect(result.forkPoint).toEqual({ messageId: "entry-42", index: 3 });
});

test("forkAgent rejects with the daemon's own error", async () => {
  const { client, mock } = await connectClient("fork_error_passthrough");

  const promise = client.forkAgent("agt_1", { entryId: "entry-missing" });
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.fork.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: null,
        forkPoint: null,
        error: "unknown entry entry-missing",
      },
    }),
  );

  await expect(promise).rejects.toThrow("unknown entry entry-missing");
});
