import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";
import { actions, permissions } from "@picompanion/frontend-core";

import {
  sendPermissionAnswer,
  wirePermissionsController,
  wireRequestArbitrator,
} from "./daemon-permissions-client.js";
import { FakeClock } from "./test-doubles.js";

/**
 * Exercises `wirePermissionsController`/`sendPermissionAnswer` against
 * the *real* `@picompanion/client` `DaemonClient` (not a hand-rolled
 * fake), wired to an in-memory fake WebSocket that replays the recorded
 * `permission-dialog.json` protocol fixture
 * (`packages/protocol/src/fixtures/daemon-ws/`, plan.md §14.2 "permission
 * ... dialog"). Mirrors
 * `features/composer/daemon-agent-turn-client.fixture.test.ts`'s
 * real-client-plus-fake-socket pattern for T28B3's own acceptance
 * criteria, applied here to T28B7's "the decision round-trips and the
 * turn continues correctly" criterion.
 *
 * `permissions.test.ts` (`packages/frontend-core/src/permissions/`)
 * already proves the same fixture drives `PermissionsController` in
 * isolation (no daemon involved); this test proves the *wire* half:
 * a real `DaemonClient` receiving the request push, this adapter
 * feeding it to the controller, the controller's `answer()` producing
 * exactly the fixture's recorded response frame, and that frame
 * actually reaching the socket — plus the daemon's resolution push
 * closing the loop.
 */
const here = dirname(fileURLToPath(import.meta.url));

interface FixtureFrame {
  id: string;
  direction: "client_to_daemon" | "daemon_to_client";
  message: unknown;
}

function loadFixtureFrames(name: string): FixtureFrame[] {
  const path = join(
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
    name,
  );
  const fixture = JSON.parse(readFileSync(path, "utf8")) as { frames: FixtureFrame[] };
  return fixture.frames;
}

function frameById(frames: FixtureFrame[], id: string): FixtureFrame {
  const frame = frames.find((candidate) => candidate.id === id);
  if (!frame) throw new Error(`fixture is missing frame "${id}"`);
  return frame;
}

/** Minimal in-memory `WebSocketLike` double, driven by the test (copied shape from `daemon-agent-turn-client.fixture.test.ts`). */
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
    if (typeof data === "string") {
      this.sent.push(data);
    }
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "test close" });
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
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

async function connectFixtureDaemonClient(
  clientId: string,
): Promise<{ daemonClient: DaemonClient; socket: FakeWebSocket }> {
  const helloFrames = loadFixtureFrames("hello-capability-negotiation.json");

  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = (_url, _options) => {
    const socket = new FakeWebSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };

  const daemonClient = new DaemonClient({
    url: "ws://fixture.invalid/ws",
    clientId,
    clientType: "browser",
    appVersion: "0.1.0-fixture",
    webSocketFactory,
    connectTimeoutMs: 5_000,
  });

  const connectPromise = daemonClient.connect();
  await flushMicrotasks();
  const socket = sockets[0];
  if (!socket) throw new Error("expected DaemonClient to open a WebSocket");
  socket.receiveJson(frameById(helloFrames, "server-info-1").message);
  await connectPromise;

  return { daemonClient, socket };
}

interface SentFrame {
  type: string;
  message?: { type: string; agentId?: string; requestId?: string; response?: unknown };
}

describe("wirePermissionsController / sendPermissionAnswer (permission-dialog.json fixture)", () => {
  it("ingests a live agent_permission_request, answers it, and reconciles the daemon's agent_permission_resolved push", async () => {
    const fixture = loadFixtureFrames("permission-dialog.json");
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_approvals_0001",
    );

    const controller = new permissions.PermissionsController({ clock: new FakeClock() });
    const unsubscribe = wirePermissionsController(controller, daemonClient);

    expect(controller.getPending()).toHaveLength(0);

    // The daemon pushes a live permission request over the real socket,
    // exactly the recorded fixture frame.
    socket.receiveJson(frameById(fixture, "permission-request-1").message);
    await flushMicrotasks();

    const pending = controller.getPending();
    expect(pending).toHaveLength(1);
    const [view] = pending;
    expect(view.requestId).toBe("perm_fixture_0001");
    expect(view.presentation).toBe("tool-actions");
    expect(view.actions.map((action) => action.id)).toEqual(["allow_once", "allow_always", "deny"]);

    const allowOnce = view.actions.find((action) => action.id === "allow_once");
    if (!allowOnce) throw new Error("fixture missing allow_once action");

    const sentAnswer = await sendPermissionAnswer(
      controller,
      daemonClient,
      view.requestId,
      permissions.buildActionResponse(allowOnce),
    );
    if (!sentAnswer) throw new Error("expected sendPermissionAnswer to send a wire message");
    await flushMicrotasks();

    // The exact response frame the fixture records the client sending.
    const expectedResponse = (frameById(fixture, "permission-response-1").message as SentFrame)
      .message;
    const sentFrame = socket.sent
      .map((raw) => JSON.parse(raw) as SentFrame)
      .find(
        (frame) => frame.type === "session" && frame.message?.type === "agent_permission_response",
      );
    expect(sentFrame?.message).toEqual(expectedResponse);

    expect(controller.get(view.requestId)?.status).toBe("answered");
    expect(controller.getPending()).toHaveLength(0);

    // The daemon confirms the resolution over the same live socket.
    socket.receiveJson(frameById(fixture, "permission-resolved-1").message);
    await flushMicrotasks();

    const entry = controller.get(view.requestId);
    expect(entry?.status).toBe("answered");
    expect(entry?.resolution).toEqual({ behavior: "allow", selectedActionId: "allow_once" });

    unsubscribe();
    await daemonClient.close();
  }, 10_000);

  it("resolves null and sends nothing for a stale answer (already answered)", async () => {
    const fixture = loadFixtureFrames("permission-dialog.json");
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_approvals_0002",
    );

    const controller = new permissions.PermissionsController({ clock: new FakeClock() });
    const unsubscribe = wirePermissionsController(controller, daemonClient);

    socket.receiveJson(frameById(fixture, "permission-request-1").message);
    await flushMicrotasks();
    const [view] = controller.getPending();

    const first = await sendPermissionAnswer(
      controller,
      daemonClient,
      view.requestId,
      permissions.buildDenyResponse(),
    );
    expect(first).not.toBeNull();
    const sentCountAfterFirst = socket.sent.length;

    const second = await sendPermissionAnswer(
      controller,
      daemonClient,
      view.requestId,
      permissions.buildDenyResponse(),
    );
    expect(second).toBeNull();
    expect(socket.sent.length).toBe(sentCountAfterFirst);

    unsubscribe();
    await daemonClient.close();
  }, 10_000);

  it("T111: round-trips the fixture's recorded answeredBy through wireRequestArbitrator against a real DaemonClient", async () => {
    const fixture = loadFixtureFrames("permission-dialog.json");
    const { daemonClient, socket } = await connectFixtureDaemonClient(
      "clid_fixture_web_approvals_0003",
    );

    const arbitrator = new actions.RequestArbitrator<permissions.AgentPermissionResponse>({
      clock: new FakeClock(),
    });
    const unsubscribe = wireRequestArbitrator(arbitrator, daemonClient);

    socket.receiveJson(frameById(fixture, "permission-request-1").message);
    await flushMicrotasks();

    // The fixture's own recorded resolution frame carries
    // `answeredBy: { clientId: "clid_fixture_0002" }`
    // (`packages/protocol/src/fixtures/daemon-ws/permission-dialog.json`).
    // This client never answered locally, so the outcome is
    // "resolved-elsewhere" — the real daemon-attributed identity must
    // reach it unchanged.
    socket.receiveJson(frameById(fixture, "permission-resolved-1").message);
    await flushMicrotasks();

    const outcome = arbitrator.getOutcome("perm_fixture_0001");
    expect(outcome.status).toBe("resolved-elsewhere");
    if (outcome.status !== "resolved-elsewhere") throw new Error("expected resolved-elsewhere");
    expect(outcome.answeredBy).toEqual({ clientId: "clid_fixture_0002" });

    unsubscribe();
    await daemonClient.close();
  }, 10_000);
});
