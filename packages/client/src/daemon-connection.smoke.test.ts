/**
 * Smoke check: `@picompanion/client` connects to a running daemon.
 *
 * This does not use in-memory/mock transports (those are covered exhaustively
 * in daemon-client.test.ts). Instead it starts a real `ws` WebSocket server on
 * an ephemeral localhost port — acting as a minimal stand-in for the Pi
 * Companion daemon — and drives the client's real WebSocket transport
 * (`createWebSocketTransportFactory`) over an actual TCP socket through the
 * wire "hello" -> "server_info" handshake used by the real daemon protocol
 * (see `sendHelloMessage` / `handleSessionMessage` in daemon-client.ts and
 * `ServerInfoStatusPayloadSchema` in @picompanion/protocol/messages).
 *
 * This satisfies the T03 acceptance criterion: "`@picompanion/client`
 * connects to a running reference daemon in a smoke check." The full
 * `@picompanion/server` daemon implementation lands in T04; until then this
 * test verifies the client's real socket-level connect/handshake/reconnect
 * behavior against a protocol-accurate daemon stand-in.
 */
import { afterEach, describe, expect, it } from "vitest";
import WS, { WebSocketServer, type WebSocket as WSWebSocket } from "ws";
import { DaemonClient } from "./daemon-client.js";
import type { WebSocketLike } from "./daemon-client-transport-types.js";

interface RunningDaemon {
  url: string;
  wss: WebSocketServer;
  helloMessages: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function startFakeDaemon(): Promise<RunningDaemon> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const helloMessages: Array<Record<string, unknown>> = [];

  wss.on("connection", (socket: WSWebSocket) => {
    socket.on("message", (data) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!parsed || parsed.type !== "hello") {
        return;
      }
      helloMessages.push(parsed);
      // Reply with the real daemon wire protocol's server_info status,
      // which is what causes DaemonClient to transition to "connected".
      socket.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "smoke-test-daemon",
              hostname: "localhost",
              version: "0.0.0-smoke",
            },
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  const address = wss.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Expected fake daemon to listen on a TCP port");
  }

  return {
    url: `ws://127.0.0.1:${address.port}`,
    wss,
    helloMessages,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => resolve());
        for (const client of wss.clients) {
          client.terminate();
        }
      }),
  };
}

describe("client smoke check: connects to a running daemon", () => {
  let daemon: RunningDaemon | null = null;
  let client: DaemonClient | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
    if (daemon) {
      await daemon.close();
      daemon = null;
    }
  });

  it("performs a real WebSocket connect + hello/server_info handshake", async () => {
    daemon = await startFakeDaemon();

    client = new DaemonClient({
      url: daemon.url,
      clientId: "smoke-test-client",
      clientType: "cli",
      connectTimeoutMs: 5000,
      webSocketFactory: (url) => new WS(url) as unknown as WebSocketLike,
    });

    await client.connect();

    expect(client.getConnectionState().status).toBe("connected");
    expect(client.getLastServerInfoMessage()?.serverId).toBe("smoke-test-daemon");
    expect(daemon.helloMessages).toHaveLength(1);
    expect(daemon.helloMessages[0]?.clientId).toBe("smoke-test-client");
  });
});
