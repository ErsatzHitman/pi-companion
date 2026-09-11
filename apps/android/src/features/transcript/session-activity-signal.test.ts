import { describe, expect, it, vi } from "vitest";

import {
  createSessionActivitySignal,
  deriveSessionActivity,
  type AgentStreamActivityMessage,
  type ConnectionStatusSource,
  type DaemonActivityStreamSource,
  type SessionActivity,
} from "./session-activity-signal";

type Handler = (message: AgentStreamActivityMessage) => void;

interface FakeActivitySource extends DaemonActivityStreamSource {
  connectionStatus: ConnectionStatusSource;
  emit(eventType: string, extra?: Record<string, unknown>, agentId?: string): void;
  transitionConnectionStatus(status: string): void;
}

function createFakeSource(): FakeActivitySource {
  const handlers = new Set<Handler>();
  const disconnectedHandlers = new Set<(status: { status: string }) => void>();
  const fake: FakeActivitySource = {
    on: (_type, handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    connectionStatus: {
      subscribeConnectionStatus: (listener) => {
        disconnectedHandlers.add(listener);
        return () => disconnectedHandlers.delete(listener);
      },
    },
    emit(eventType, extra = {}, agentId = "agent-1") {
      const message: AgentStreamActivityMessage = {
        type: "agent_stream",
        payload: { agentId, event: { type: eventType, ...extra } },
      };
      for (const handler of [...handlers]) handler(message);
    },
    transitionConnectionStatus(status) {
      for (const handler of [...disconnectedHandlers]) handler({ status });
    },
  };
  return fake;
}

describe("deriveSessionActivity: the one priority decision", () => {
  it("reports a pending approval above everything else, because the turn is blocked on the user", () => {
    expect(
      deriveSessionActivity({
        pendingPermissionCount: 1,
        runningToolCallCount: 3,
        turnRunning: true,
      }),
    ).toBe("needs-you");
  });

  it("reports a running tool call as Working", () => {
    expect(
      deriveSessionActivity({
        pendingPermissionCount: 0,
        runningToolCallCount: 1,
        turnRunning: true,
      }),
    ).toBe("working");
  });

  it("reports a running turn with nothing visible in flight as Thinking", () => {
    expect(
      deriveSessionActivity({
        pendingPermissionCount: 0,
        runningToolCallCount: 0,
        turnRunning: true,
      }),
    ).toBe("thinking");
  });

  it("reports Idle when nothing is true", () => {
    expect(
      deriveSessionActivity({
        pendingPermissionCount: 0,
        runningToolCallCount: 0,
        turnRunning: false,
      }),
    ).toBe("idle");
  });
});

describe("createSessionActivitySignal", () => {
  it("starts idle", () => {
    const fake = createFakeSource();
    const signal = createSessionActivitySignal(fake, "agent-1", () => undefined);
    expect(signal.getActivity()).toBe("idle");
    signal.dispose();
  });

  it("walks the artifact's own cycle: Idle → Thinking → Working → Needs you", () => {
    const fake = createFakeSource();
    const seen: SessionActivity[] = [];
    const signal = createSessionActivitySignal(fake, "agent-1", (activity) => seen.push(activity));

    fake.emit("turn_started");
    expect(signal.getActivity()).toBe("thinking");
    fake.emit("timeline", {
      item: { type: "tool_call", callId: "call-1", status: "running" },
    });
    expect(signal.getActivity()).toBe("working");
    fake.emit("permission_requested", { request: { requestId: "perm-1" } });
    expect(signal.getActivity()).toBe("needs-you");
    fake.emit("permission_resolved", { requestId: "perm-1" });
    expect(signal.getActivity()).toBe("working");
    fake.emit("timeline", {
      item: { type: "tool_call", callId: "call-1", status: "completed" },
    });
    expect(signal.getActivity()).toBe("thinking");
    fake.emit("turn_completed");
    expect(signal.getActivity()).toBe("idle");
    expect(seen).toEqual(["thinking", "working", "needs-you", "working", "thinking", "idle"]);
    signal.dispose();
  });

  it("tracks overlapping tool calls as a set, not one id", () => {
    const fake = createFakeSource();
    const signal = createSessionActivitySignal(fake, "agent-1", () => undefined);
    fake.emit("turn_started");
    fake.emit("timeline", { item: { type: "tool_call", callId: "a", status: "running" } });
    fake.emit("timeline", { item: { type: "tool_call", callId: "b", status: "running" } });
    fake.emit("timeline", { item: { type: "tool_call", callId: "a", status: "completed" } });
    expect(signal.getActivity()).toBe("working");
    fake.emit("timeline", { item: { type: "tool_call", callId: "b", status: "failed" } });
    expect(signal.getActivity()).toBe("thinking");
    signal.dispose();
  });

  it("clears running tool calls when the turn itself ends, so a completion the client never saw cannot latch Working", () => {
    const fake = createFakeSource();
    const signal = createSessionActivitySignal(fake, "agent-1", () => undefined);
    fake.emit("turn_started");
    fake.emit("timeline", { item: { type: "tool_call", callId: "a", status: "running" } });
    fake.emit("turn_failed", { error: "boom" });
    expect(signal.getActivity()).toBe("idle");
    expect(signal.getState().runningToolCallCount).toBe(0);
    signal.dispose();
  });

  it("fires onChange only on a real transition", () => {
    const fake = createFakeSource();
    const onChange = vi.fn();
    const signal = createSessionActivitySignal(fake, "agent-1", onChange);
    fake.emit("turn_started");
    fake.emit("pi_queue_update", { steering: [], followUp: [] });
    fake.emit("turn_started");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("thinking");
    signal.dispose();
  });

  it("ignores every event for a different agent", () => {
    const fake = createFakeSource();
    const onChange = vi.fn();
    const signal = createSessionActivitySignal(fake, "agent-1", onChange);
    fake.emit("turn_started", {}, "agent-2");
    fake.emit("permission_requested", { request: { requestId: "p" } }, "agent-2");
    expect(signal.getActivity()).toBe("idle");
    expect(onChange).not.toHaveBeenCalled();
    signal.dispose();
  });

  it("ignores an event type it has nothing to say about, and a malformed payload", () => {
    const fake = createFakeSource();
    const signal = createSessionActivitySignal(fake, "agent-1", () => undefined);
    fake.emit("pi_status", { state: "ready" });
    fake.emit("permission_requested", { request: {} });
    fake.emit("permission_resolved", {});
    fake.emit("timeline", { item: { type: "tool_call", status: "running" } });
    fake.emit("timeline", { item: { type: "assistant_message", text: "hi" } });
    expect(signal.getActivity()).toBe("idle");
    signal.dispose();
  });

  it("resets to idle on every connection-status transition, including a reconnect", () => {
    const fake = createFakeSource();
    const signal = createSessionActivitySignal(
      fake,
      "agent-1",
      () => undefined,
      fake.connectionStatus,
    );
    fake.emit("turn_started");
    fake.emit("permission_requested", { request: { requestId: "p" } });
    expect(signal.getActivity()).toBe("needs-you");
    fake.transitionConnectionStatus("connected");
    expect(signal.getActivity()).toBe("idle");
    signal.dispose();
  });

  it("stops reporting after dispose, and does not fire onChange from a late event", () => {
    const fake = createFakeSource();
    const onChange = vi.fn();
    const signal = createSessionActivitySignal(fake, "agent-1", onChange);
    signal.dispose();
    fake.emit("turn_started");
    expect(onChange).not.toHaveBeenCalled();
    expect(signal.getActivity()).toBe("idle");
  });
});
