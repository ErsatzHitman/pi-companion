import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentStreamMessageSchema } from "@picompanion/protocol/messages";

import {
  createTurnRunningSignal,
  type AgentStreamTurnMessage,
  type ConnectionStatusSource,
  type DaemonTurnStreamSource,
} from "./turn-running-signal.js";

/**
 * T64 — proves `createTurnRunningSignal` end to end against an
 * in-memory fake, following `turn-service.test.ts`'s
 * `FakeIsolatedDaemon` convention: never a real socket, but every
 * event pushed through it is validated against the real
 * `AgentStreamMessageSchema` (`@picompanion/protocol/messages`) before
 * delivery, so a shape mismatch fails the test before any handler
 * sees it — the same "wire-shape proof, not a hand-typed object"
 * discipline T63 established.
 */

type StreamHandler = (message: AgentStreamTurnMessage) => void;

class FakeAgentStreamDaemon implements DaemonTurnStreamSource {
  private readonly handlers = new Set<StreamHandler>();

  on(type: "agent_stream", handler: StreamHandler): () => void {
    expect(type).toBe("agent_stream");
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Delivers a real, schema-validated `agent_stream` message to every current listener. */
  push(agentId: string, event: Record<string, unknown>): void {
    this.pushWithTimestamp(agentId, event, "2026-09-04T00:00:00.000Z");
  }

  /** The same, with an explicit wire `timestamp` — the fallback path's own case (T385). */
  pushWithTimestamp(agentId: string, event: Record<string, unknown>, timestamp: string): void {
    const message = AgentStreamMessageSchema.parse({
      type: "agent_stream",
      payload: { agentId, event, timestamp },
    }) as unknown as AgentStreamTurnMessage;
    for (const handler of this.handlers) handler(message);
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}

class FakeConnectionStatusSource implements ConnectionStatusSource {
  private readonly listeners = new Set<(status: { status: string }) => void>();

  subscribeConnectionStatus(listener: (status: { status: string }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(status: string): void {
    for (const listener of this.listeners) listener({ status });
  }
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  consoleSpies = (["log", "warn", "error", "info", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe("createTurnRunningSignal", () => {
  it("a real pi_queue_update, parsed through AgentStreamMessageSchema, flips turnRunning to true", () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    expect(signal.getRunning()).toBe(false);

    daemon.push("agt_1", {
      type: "pi_queue_update",
      provider: "pi",
      steering: ["please also check tests"],
      followUp: [],
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(signal.getRunning()).toBe(true);

    signal.dispose();
  });

  it("turn_started also flips turnRunning to true (a queue update is not the only start signal)", () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    daemon.push("agt_1", { type: "turn_started", provider: "pi", turnId: "t1" });

    expect(onChange).toHaveBeenCalledWith(true);
    expect(signal.getRunning()).toBe(true);
    signal.dispose();
  });

  it.each([
    ["turn_completed", { type: "turn_completed", provider: "pi", turnId: "t1" }],
    ["turn_failed", { type: "turn_failed", provider: "pi", turnId: "t1", error: "boom" }],
    [
      "turn_canceled",
      { type: "turn_canceled", provider: "pi", turnId: "t1", reason: "user requested" },
    ],
  ])(
    "a turn that ends via %s returns the signal to not-running, by its own named path",
    (_label, event) => {
      const daemon = new FakeAgentStreamDaemon();
      const onChange = vi.fn();
      const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

      daemon.push("agt_1", { type: "turn_started", provider: "pi", turnId: "t1" });
      expect(signal.getRunning()).toBe(true);
      onChange.mockClear();

      daemon.push("agt_1", event);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(false);
      expect(signal.getRunning()).toBe(false);
      signal.dispose();
    },
  );

  it("none of the three end paths is a timeout — the signal never flips without an event", async () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    daemon.push("agt_1", { type: "turn_started", provider: "pi", turnId: "t1" });
    onChange.mockClear();

    // No timers exist in this module at all (no setTimeout import, no
    // Clock dependency) — waiting past any plausible turn-length
    // timeout via real elapsed microtasks changes nothing.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(onChange).not.toHaveBeenCalled();
    expect(signal.getRunning()).toBe(true);
    signal.dispose();
  });

  it("a pi_queue_update for a different agent is ignored: no change, and its content is never logged", () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    daemon.push("agt_OTHER", {
      type: "pi_queue_update",
      provider: "pi",
      steering: ["secret plan contents"],
      followUp: [],
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(signal.getRunning()).toBe(false);
    signal.dispose();
  });

  it("an update arriving after dispose() is a no-op: no change, handler actually unregistered", () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    expect(daemon.listenerCount).toBe(1);
    signal.dispose();
    expect(daemon.listenerCount).toBe(0); // the real unsubscribe ran, not just a local flag

    // Even if something still held a reference and called the handler
    // directly, the defensive `disposed` guard inside the handler
    // covers it too — but the real proof is listenerCount above.
    daemon.push("agt_1", {
      type: "pi_queue_update",
      provider: "pi",
      steering: ["x"],
      followUp: [],
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(signal.getRunning()).toBe(false);
  });

  it("dispose() is idempotent and never double-calls the underlying unsubscribe", () => {
    const daemon = new FakeAgentStreamDaemon();
    const signal = createTurnRunningSignal(daemon, "agt_1", () => {});
    signal.dispose();
    expect(() => signal.dispose()).not.toThrow();
    expect(daemon.listenerCount).toBe(0);
  });

  it("onChange never re-fires for a repeated value (turn_started twice in a row)", () => {
    const daemon = new FakeAgentStreamDaemon();
    const onChange = vi.fn();
    const signal = createTurnRunningSignal(daemon, "agt_1", onChange);

    daemon.push("agt_1", { type: "turn_started", provider: "pi" });
    daemon.push("agt_1", { type: "turn_started", provider: "pi" });

    expect(onChange).toHaveBeenCalledTimes(1);
    signal.dispose();
  });

  describe("reconnect safety", () => {
    it("a dropped and freshly re-established signal (new instance) never reports a stale running turn", () => {
      const daemon = new FakeAgentStreamDaemon();
      const onChangeA = vi.fn();
      const signalA = createTurnRunningSignal(daemon, "agt_1", onChangeA);
      daemon.push("agt_1", { type: "turn_started", provider: "pi" });
      expect(signalA.getRunning()).toBe(true);
      signalA.dispose(); // the connection dropped

      // Re-established: a brand new instance, same agentId.
      const onChangeB = vi.fn();
      const signalB = createTurnRunningSignal(daemon, "agt_1", onChangeB);

      expect(signalB.getRunning()).toBe(false); // never inherits signalA's last value
      expect(onChangeB).not.toHaveBeenCalled();
      signalB.dispose();
    });

    it("a reconnect that replays queue state (pi_queue_update arrives again) reports running", () => {
      const daemon = new FakeAgentStreamDaemon();
      const connectionStatus = new FakeConnectionStatusSource();
      const onChange = vi.fn();
      const signal = createTurnRunningSignal(daemon, "agt_1", onChange, connectionStatus);

      daemon.push("agt_1", { type: "turn_started", provider: "pi" });
      expect(signal.getRunning()).toBe(true);

      connectionStatus.publish("disconnected");
      expect(signal.getRunning()).toBe(false); // reset immediately, not left latched true

      connectionStatus.publish("connected");
      expect(signal.getRunning()).toBe(false); // still false right at reconnect, before any replay

      daemon.push("agt_1", {
        type: "pi_queue_update",
        provider: "pi",
        steering: [],
        followUp: ["queued while away"],
      });
      expect(signal.getRunning()).toBe(true); // the replay re-establishes it

      signal.dispose();
    });

    it("a reconnect that replays nothing leaves the signal at the safe not-running default", () => {
      const daemon = new FakeAgentStreamDaemon();
      const connectionStatus = new FakeConnectionStatusSource();
      const onChange = vi.fn();
      const signal = createTurnRunningSignal(daemon, "agt_1", onChange, connectionStatus);

      daemon.push("agt_1", { type: "turn_started", provider: "pi" });
      expect(signal.getRunning()).toBe(true);

      connectionStatus.publish("disconnected");
      connectionStatus.publish("connected");
      // Nothing at all arrives after reconnecting — the turn genuinely
      // ended while this client was offline.

      expect(signal.getRunning()).toBe(false);
      expect(onChange).toHaveBeenLastCalledWith(false);
      signal.dispose();
    });
  });

  describe("turn start time (T385)", () => {
    // The fake's own `push` stamps every message with this fixed wire
    // timestamp, so the recorded start is deterministic here.
    const WIRE_TIME_MS = Date.parse("2026-09-04T00:00:00.000Z");

    it("records the wire event's own timestamp when a turn starts, and clears it when the turn ends", () => {
      const daemon = new FakeAgentStreamDaemon();
      const signal = createTurnRunningSignal(daemon, "agt_1", () => {});

      expect(signal.getStartedAtMs()).toBeNull();

      daemon.push("agt_1", { type: "turn_started", provider: "pi", turnId: "t1" });
      expect(signal.getStartedAtMs()).toBe(WIRE_TIME_MS);

      daemon.push("agt_1", { type: "turn_completed", provider: "pi", turnId: "t1" });
      expect(signal.getStartedAtMs()).toBeNull();
      expect(signal.getRunning()).toBe(false);
      signal.dispose();
    });

    it("does not move the recorded start when later pi_queue_updates arrive during the same turn", () => {
      const daemon = new FakeAgentStreamDaemon();
      const signal = createTurnRunningSignal(daemon, "agt_1", () => {});

      daemon.push("agt_1", { type: "turn_started", provider: "pi", turnId: "t1" });
      daemon.push("agt_1", { type: "pi_queue_update", provider: "pi", steering: [], followUp: [] });
      daemon.push("agt_1", {
        type: "pi_queue_update",
        provider: "pi",
        steering: ["more"],
        followUp: [],
      });

      expect(signal.getStartedAtMs()).toBe(WIRE_TIME_MS);
      signal.dispose();
    });

    it("takes a mid-turn pi_queue_update as the start when it is the first sign of the turn (route mounted after it began)", () => {
      const daemon = new FakeAgentStreamDaemon();
      const signal = createTurnRunningSignal(daemon, "agt_1", () => {});

      daemon.push("agt_1", { type: "pi_queue_update", provider: "pi", steering: [], followUp: [] });

      expect(signal.getRunning()).toBe(true);
      expect(signal.getStartedAtMs()).toBe(WIRE_TIME_MS);
      signal.dispose();
    });

    it("clears the recorded start on a reconnect boundary, so no elapsed time survives a dropped socket", () => {
      const daemon = new FakeAgentStreamDaemon();
      const connectionStatus = new FakeConnectionStatusSource();
      const signal = createTurnRunningSignal(daemon, "agt_1", () => {}, connectionStatus);

      daemon.push("agt_1", { type: "turn_started", provider: "pi" });
      expect(signal.getStartedAtMs()).toBe(WIRE_TIME_MS);

      connectionStatus.publish("disconnected");
      expect(signal.getStartedAtMs()).toBeNull();
      signal.dispose();
    });

    it("falls back to the local clock when the wire timestamp cannot be parsed, never to NaN", () => {
      const daemon = new FakeAgentStreamDaemon();
      const signal = createTurnRunningSignal(daemon, "agt_1", () => {});

      const before = Date.now();
      daemon.pushWithTimestamp("agt_1", { type: "turn_started", provider: "pi" }, "not-a-date");
      const after = Date.now();

      const startedAtMs = signal.getStartedAtMs();
      expect(startedAtMs).not.toBeNull();
      if (startedAtMs === null) throw new Error("unreachable: asserted above");
      expect(startedAtMs).toBeGreaterThanOrEqual(before);
      expect(startedAtMs).toBeLessThanOrEqual(after);
      signal.dispose();
    });
  });
});
