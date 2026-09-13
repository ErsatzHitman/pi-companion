/**
 * `DaemonClient.unrevokeTrustedDevice` — the client half of the device
 * un-revoke wire pair (`trusted_device.unrevoke.request` /
 * `trusted_device.unrevoke.response`, packages/protocol/src/messages.ts).
 *
 * Proves the wire shape without opening a real socket: an in-memory fake
 * `DaemonTransport` records the frame `unrevokeTrustedDevice` sends and a
 * canned daemon response resolves the awaiting call — the same harness
 * shape `daemon-client.test.ts`'s `listDirectory` case uses.
 */
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { DaemonClient, type DaemonTransport } from "./daemon-client";

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createMockTransport() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  let serverInfoOrdinal = 1;

  const transport: DaemonTransport = {
    send: (data) => {
      sent.push(data);
      if (typeof data !== "string") return;
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
    onClose: () => () => {},
    onError: () => () => {},
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
              serverId: `srv_test_${serverInfoOrdinal++}`,
              hostname: null,
              version: null,
            },
          },
        }),
      );
    },
    triggerMessage: (data: unknown) => onMessage(data),
  };
}

function wrapSessionMessage(message: unknown): string {
  return JSON.stringify({ type: "session", message });
}

function parseSentFrame(data: string | Uint8Array | ArrayBuffer | undefined): {
  type: string;
  message: Record<string, unknown>;
} {
  if (typeof data !== "string") throw new Error("Expected string frame");
  return z
    .object({ type: z.literal("session"), message: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(data)) as { type: string; message: Record<string, unknown> };
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients.length = 0;
});

async function connectedClient() {
  const logger = createMockLogger();
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "unrevoke_unit_test",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);
  const connectPromise = client.connect();
  mock.triggerOpen();
  await connectPromise;
  return { client, mock };
}

function respondUnrevoke(
  mock: ReturnType<typeof createMockTransport>,
  payload: { requestId: string; clientId: string; success: boolean; error: string | null },
): void {
  mock.triggerMessage(
    wrapSessionMessage({
      type: "trusted_device.unrevoke.response",
      payload,
    }),
  );
}

test("unrevokeTrustedDevice sends a trusted_device.unrevoke.request and resolves the success payload", async () => {
  const { client, mock } = await connectedClient();

  const responsePromise = client.unrevokeTrustedDevice("clid_target_0001", {
    requestId: "req-unrevoke-1",
  });

  expect(mock.sent).toHaveLength(1);
  expect(parseSentFrame(mock.sent[0]).message).toEqual({
    type: "trusted_device.unrevoke.request",
    requestId: "req-unrevoke-1",
    clientId: "clid_target_0001",
  });

  respondUnrevoke(mock, {
    requestId: "req-unrevoke-1",
    clientId: "clid_target_0001",
    success: true,
    error: null,
  });

  await expect(responsePromise).resolves.toEqual({
    requestId: "req-unrevoke-1",
    clientId: "clid_target_0001",
    success: true,
    error: null,
  });
});

test("unrevokeTrustedDevice mints a requestId when the caller does not supply one", async () => {
  const { client, mock } = await connectedClient();

  const responsePromise = client.unrevokeTrustedDevice("clid_target_0001");

  expect(mock.sent).toHaveLength(1);
  const sent = parseSentFrame(mock.sent[0]).message;
  expect(sent.type).toBe("trusted_device.unrevoke.request");
  expect(typeof sent.requestId).toBe("string");
  expect((sent.requestId as string).length).toBeGreaterThan(0);

  respondUnrevoke(mock, {
    requestId: sent.requestId as string,
    clientId: "clid_target_0001",
    success: true,
    error: null,
  });

  await expect(responsePromise).resolves.toMatchObject({
    clientId: "clid_target_0001",
    success: true,
    error: null,
  });
});

test("unrevokeTrustedDevice resolves — never rejects — a daemon failure envelope", async () => {
  const { client, mock } = await connectedClient();

  const responsePromise = client.unrevokeTrustedDevice("clid_target_0001", {
    requestId: "req-unrevoke-2",
  });

  respondUnrevoke(mock, {
    requestId: "req-unrevoke-2",
    clientId: "clid_target_0001",
    success: false,
    error: "Invalid clientId",
  });

  await expect(responsePromise).resolves.toEqual({
    requestId: "req-unrevoke-2",
    clientId: "clid_target_0001",
    success: false,
    error: "Invalid clientId",
  });
});
