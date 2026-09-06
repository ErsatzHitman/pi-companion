/**
 * T61B — `DaemonClient.unregisterPushToken` (packages/client's push path).
 *
 * Proves the wire shape against T61's server-defined
 * `UnregisterPushTokenMessageSchema` (packages/protocol/src/messages.ts)
 * without opening a real socket: an in-memory fake `DaemonTransport`
 * records every frame `unregisterPushToken`/`registerPushToken` send.
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
  let onClose: (_event?: unknown) => void = () => {};
  let onError: (_event?: unknown) => void = () => {};
  let serverInfoOrdinal = 1;

  const transport: DaemonTransport = {
    send: (data) => {
      sent.push(data);
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
              serverId: `srv_test_${serverInfoOrdinal++}`,
              hostname: null,
              version: null,
            },
          },
        }),
      );
    },
    triggerClose: (event?: unknown) => onClose(event),
    triggerError: (event?: unknown) => onError(event),
  };
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

async function connectedClient(logger: ReturnType<typeof createMockLogger>) {
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "push_unit_test",
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

test("unregisterPushToken sends the unregister_push_token request T61 defined", async () => {
  const logger = createMockLogger();
  const { client, mock } = await connectedClient(logger);

  client.unregisterPushToken("ExponentPushToken[abc123]");

  expect(mock.sent).toHaveLength(1);
  const frame = parseSentFrame(mock.sent[0]);
  expect(frame.message).toEqual({
    type: "unregister_push_token",
    token: "ExponentPushToken[abc123]",
  });
});

test("unregisterPushToken sends the identical request shape for a token the daemon never registered", async () => {
  // The client has no way to know whether the daemon actually holds a
  // given token — and must not behave differently depending on a guess.
  // Both calls must produce byte-identical frame shapes (module keyed by
  // token) so nothing on the wire, or in this method's own control flow,
  // could let a caller infer which token was "real".
  const logger = createMockLogger();
  const { client, mock } = await connectedClient(logger);

  client.unregisterPushToken("token-daemon-has-never-seen");

  expect(mock.sent).toHaveLength(1);
  const frame = parseSentFrame(mock.sent[0]);
  expect(frame.message).toEqual({
    type: "unregister_push_token",
    token: "token-daemon-has-never-seen",
  });
  expect(() => client.unregisterPushToken("token-daemon-has-never-seen")).not.toThrow();
});

test("neither registerPushToken nor unregisterPushToken ever logs the raw token", async () => {
  const logger = createMockLogger();
  const { client, mock: _mock } = await connectedClient(logger);

  client.registerPushToken("super-secret-token-value");
  client.unregisterPushToken("super-secret-token-value");

  const allLogCalls = [
    ...logger.debug.mock.calls,
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
  ];
  for (const call of allLogCalls) {
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain("super-secret-token-value");
  }
});
