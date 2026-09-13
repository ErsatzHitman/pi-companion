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
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "srv_test_clone_rename",
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

function agentSnapshot() {
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

test("cloneAgent omits name for a minimal call and resolves the cloned agent", async () => {
  const { client, mock } = await connectClient("clone_minimal");

  const promise = client.cloneAgent("agt_1");
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  expect(request).toEqual({
    type: "agent.clone.request",
    requestId: expect.any(String),
    agentId: "agt_1",
  });
  expect(request).not.toHaveProperty("name");
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.clone.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: agentSnapshot(),
        error: null,
      },
    }),
  );

  const result = await promise;
  expect(result.agent?.id).toBe("agt_2");
});

test("cloneAgent sends name exactly as given", async () => {
  const { client, mock } = await connectClient("clone_full_options");

  const promise = client.cloneAgent("agt_1", { name: "cloned branch" });
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  expect(request).toEqual({
    type: "agent.clone.request",
    requestId: expect.any(String),
    agentId: "agt_1",
    name: "cloned branch",
  });
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.clone.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: agentSnapshot(),
        error: null,
      },
    }),
  );

  const result = await promise;
  expect(result.agent?.id).toBe("agt_2");
});

test("cloneAgent rejects with the daemon's own error", async () => {
  const { client, mock } = await connectClient("clone_error_passthrough");

  const promise = client.cloneAgent("agt_missing");
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.clone.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_missing",
        agent: null,
        error: "Unknown agent 'agt_missing'",
      },
    }),
  );

  await expect(promise).rejects.toThrow("Unknown agent 'agt_missing'");
});

test("renameAgent sends name and resolves the renamed agent", async () => {
  const { client, mock } = await connectClient("rename_ok");

  const promise = client.renameAgent("agt_1", "renamed agent");
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  expect(request).toEqual({
    type: "agent.rename.request",
    requestId: expect.any(String),
    agentId: "agt_1",
    name: "renamed agent",
  });
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.rename.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: { ...agentSnapshot(), id: "agt_1", title: "renamed agent" },
        error: null,
      },
    }),
  );

  const result = await promise;
  expect(result.agent?.title).toBe("renamed agent");
});

test("renameAgent rejects with the daemon's own error", async () => {
  const { client, mock } = await connectClient("rename_error_passthrough");

  const promise = client.renameAgent("agt_1", "renamed agent");
  const request = parseSentFrame(mock.sent[mock.sent.length - 1]) as { requestId: string };
  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.rename.response",
      payload: {
        requestId: request.requestId,
        agentId: "agt_1",
        agent: null,
        error: "Unknown agent 'agt_1'",
      },
    }),
  );

  await expect(promise).rejects.toThrow("Unknown agent 'agt_1'");
});
