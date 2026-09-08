// T38B0c: contract fixture proving queue-mode changes and per-message
// streamingBehavior routing work end-to-end through a real daemon — not just
// through the individual unit-level seams (session.ts, agent-manager.ts,
// agent.ts) exercised elsewhere. This spins up an in-process test daemon
// (an ephemeral 127.0.0.1 port, never 6767/6768 — see createTestPaseoDaemon)
// with a real PiRpcAgentClient backed by FakePi (no real Pi process), then
// drives it with two independently connected clients: one issues every
// request, the other only ever subscribes and observes — proving the second
// client's view is kept current by the daemon's own broadcast, never by
// polling.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket, type RawData } from "ws";

import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { PiRpcAgentClient } from "../agent/providers/pi/agent.js";
import { FakePi } from "../agent/providers/pi/test-utils/fake-pi.js";
import type { SessionOutboundMessage } from "../messages.js";
import { WSOutboundMessageSchema, type WSOutboundMessage } from "../messages.js";

const TEST_TIMEOUT_MS = 20_000;
// CORRECTED (T262): this used to say the pi provider was only visible to a
// WS client whose declared appVersion cleared a MIN_VERSION_ALL_PROVIDERS
// gate in session.ts, below which only the legacy claude/codex/opencode
// providers broadcast agent_update at all. T262 retired that gate entirely
// (session.ts's isProviderVisibleToClient is now an unconditional `true`;
// see plan.md §18 item 13) because this product's own provider registry has
// always been pi-only and its own wire schema never restricted providers the
// way the gate assumed. Declaring an appVersion here is no longer load-bearing
// for provider visibility, but every connection in this file still declares
// one, matching a real client's hello.
const APP_VERSION = "1.0.0";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;
type AgentUpdatePayload = AgentUpdateMessage["payload"];
type AgentUpsertPayload = Extract<AgentUpdatePayload, { kind: "upsert" }>;

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), "queue-mode-routing-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectAgentUpdates(client: DaemonClient): {
  updates: AgentUpdatePayload[];
  unsub: () => void;
} {
  const updates: AgentUpdatePayload[] = [];
  const unsub = client.on("agent_update", (message) => {
    if (message.type === "agent_update") {
      updates.push(message.payload);
    }
  });
  return { updates, unsub };
}

function lastUpsertFor(
  updates: AgentUpdatePayload[],
  agentId: string,
): AgentUpsertPayload | undefined {
  return updates.findLast(
    (update): update is AgentUpsertPayload =>
      update.kind === "upsert" && update.agent.id === agentId,
  );
}

// The daemon does not yet expose typed DaemonClient methods for
// set_steering_mode_request / set_follow_up_mode_request / get_queue_modes_request,
// or a streamingBehavior parameter on sendAgentMessage — wiring the shared
// client is T38B1a's job (it depends on this task). This raw socket drives
// the wire protocol directly, the same way every other message type is
// exercised before a typed client wrapper exists for it.
function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(
  socket: WebSocket,
  matches: (message: WSOutboundMessage) => boolean,
): Promise<WSOutboundMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, TEST_TIMEOUT_MS);
    const onMessage = (data: RawData) => {
      const parsed = WSOutboundMessageSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success || !matches(parsed.data)) return;
      cleanup();
      resolve(parsed.data);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before the expected message arrived"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

function sendAndWait(
  socket: WebSocket,
  message: unknown,
  matches: (message: WSOutboundMessage) => boolean,
): Promise<WSOutboundMessage> {
  const response = waitForMessage(socket, matches);
  socket.send(JSON.stringify(message));
  return response;
}

async function connectRawSocket(port: number, clientId: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await waitForOpen(socket);
  await sendAndWait(
    socket,
    {
      type: "hello",
      clientId,
      clientType: "browser",
      protocolVersion: 1,
      appVersion: APP_VERSION,
    },
    (message) =>
      message.type === "session" &&
      message.message.type === "status" &&
      message.message.payload.status === "server_info",
  );
  return socket;
}

function sendSession(
  socket: WebSocket,
  message: unknown,
  matches: (message: WSOutboundMessage) => boolean,
) {
  return sendAndWait(socket, { type: "session", message }, matches);
}

interface SessionResponse {
  type: "session";
  message: { type: string; payload: Record<string, unknown> };
}

function sessionPayload(
  response: WSOutboundMessage,
  expectedType: string,
): Record<string, unknown> {
  if (response.type !== "session" || response.message.type !== expectedType) {
    throw new Error(`Expected session/${expectedType}, got ${JSON.stringify(response)}`);
  }
  return (response as unknown as SessionResponse).message.payload;
}

describe("T38B0c: queue-mode changes and per-message routing against a real daemon", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let fakePi: FakePi;
  let raw: WebSocket;

  beforeAll(async () => {
    fakePi = new FakePi();
    const piClient = new PiRpcAgentClient({
      logger: pino({ level: "silent" }),
      runtime: fakePi,
    });
    daemon = await createTestPaseoDaemon({
      agentClients: { ...createTestAgentClients(), pi: piClient },
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: APP_VERSION,
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "queue-mode-routing-test" } });
    raw = await connectRawSocket(daemon.port, "queue-mode-raw-client");
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    raw.terminate();
    await client.close();
    await daemon.close();
  }, TEST_TIMEOUT_MS);

  test(
    "both mode changes take effect live and broadcast to a second, passively-subscribed client",
    async () => {
      // client only ever creates the agent and subscribes — it never
      // issues a single mode-change request. Every mode change below is
      // driven exclusively by `raw`, the independent connection. If
      // client's view updates anyway, that update can only have reached
      // it through the daemon's own broadcast.
      const { updates, unsub } = collectAgentUpdates(client);
      const agent = await client.createAgent({ provider: "pi", cwd: tmpCwd() });
      await sleep(200);

      const steerResponse = await sendSession(
        raw,
        {
          type: "set_steering_mode_request",
          agentId: agent.id,
          mode: "all",
          requestId: "raw-steer-1",
        },
        (message) =>
          message.type === "session" && message.message.type === "set_steering_mode_response",
      );
      expect(sessionPayload(steerResponse, "set_steering_mode_response")).toEqual({
        requestId: "raw-steer-1",
        agentId: agent.id,
        accepted: true,
        error: null,
      });

      await sleep(300);
      const afterSteer = lastUpsertFor(updates, agent.id);
      expect(afterSteer?.agent.runtimeInfo?.extra).toMatchObject({ steeringMode: "all" });

      const followUpResponse = await sendSession(
        raw,
        {
          type: "set_follow_up_mode_request",
          agentId: agent.id,
          mode: "all",
          requestId: "raw-followup-1",
        },
        (message) =>
          message.type === "session" && message.message.type === "set_follow_up_mode_response",
      );
      expect(sessionPayload(followUpResponse, "set_follow_up_mode_response")).toEqual({
        requestId: "raw-followup-1",
        agentId: agent.id,
        accepted: true,
        error: null,
      });

      await sleep(300);
      const afterFollowUp = lastUpsertFor(updates, agent.id);
      expect(afterFollowUp?.agent.runtimeInfo?.extra).toEqual({
        steeringMode: "all",
        followUpMode: "all",
      });

      // get_queue_modes_request re-reads the live session rather than any
      // cached value — confirm it reports both changes together.
      const getModesResponse = await sendSession(
        raw,
        { type: "get_queue_modes_request", agentId: agent.id, requestId: "raw-get-1" },
        (message) =>
          message.type === "session" && message.message.type === "get_queue_modes_response",
      );
      expect(sessionPayload(getModesResponse, "get_queue_modes_response")).toEqual({
        requestId: "raw-get-1",
        agentId: agent.id,
        steeringMode: "all",
        followUpMode: "all",
        error: null,
      });

      unsub();
    },
    TEST_TIMEOUT_MS,
  );

  test.each(["steer", "followUp"] as const)(
    "send_agent_message_request routes streamingBehavior=%s to Pi's prompt command through the real daemon",
    async (streamingBehavior) => {
      const agent = await client.createAgent({ provider: "pi", cwd: tmpCwd() });

      const response = await sendSession(
        raw,
        {
          type: "send_agent_message_request",
          agentId: agent.id,
          text: `hello ${streamingBehavior}`,
          streamingBehavior,
          requestId: `raw-send-${streamingBehavior}`,
        },
        (message) =>
          message.type === "session" && message.message.type === "send_agent_message_response",
      );
      expect(sessionPayload(response, "send_agent_message_response")).toEqual({
        requestId: `raw-send-${streamingBehavior}`,
        agentId: agent.id,
        accepted: true,
        error: null,
      });

      const fakeSession = fakePi.latestSession();
      expect(fakeSession.prompts.at(-1)).toEqual({
        message: `hello ${streamingBehavior}`,
        imageCount: 0,
        streamingBehavior,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
