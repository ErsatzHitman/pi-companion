import { describe, expect, it, vi } from "vitest";

import {
  createContextUsageSignal,
  type AgentUpdateUsageMessage,
  type ContextUsageAgentFields,
  type DaemonAgentUsageSource,
} from "./context-usage-signal";

/**
 * T352 real behavioural coverage — this module imports no React and no
 * React Native, so every case below calls the real function with a real
 * fake daemon and asserts on real values, never on source text.
 */
function createFakeDaemon(options?: { snapshot?: ContextUsageAgentFields | null }) {
  let handler: ((message: AgentUpdateUsageMessage) => void) | undefined;
  let unsubscribed = 0;
  const daemon: DaemonAgentUsageSource & {
    push: (message: AgentUpdateUsageMessage) => void;
    unsubscribeCount: () => number;
    hasHandler: () => boolean;
  } = {
    on: (type, next) => {
      expect(type).toBe("agent_update");
      handler = next;
      return () => {
        unsubscribed += 1;
        handler = undefined;
      };
    },
    fetchAgent: options
      ? async () => (options.snapshot ? { agent: options.snapshot } : null)
      : undefined,
    push: (message) => handler?.(message),
    unsubscribeCount: () => unsubscribed,
    hasHandler: () => handler !== undefined,
  };
  return daemon;
}

function upsert(agent: ContextUsageAgentFields): AgentUpdateUsageMessage {
  return { type: "agent_update", payload: { kind: "upsert", agent } };
}

describe("createContextUsageSignal", () => {
  it("starts with no usage at all, never a fabricated zero", () => {
    const daemon = createFakeDaemon();
    const signal = createContextUsageSignal(daemon, "agt_1", vi.fn());
    expect(signal.getUsage()).toBeNull();
    signal.dispose();
  });

  it("reports the usage the daemon pushes on agent_update", () => {
    const daemon = createFakeDaemon();
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    daemon.push(upsert({ id: "agt_1", lastUsage: { contextWindowUsedTokens: 100 } }));

    expect(signal.getUsage()).toEqual({ contextWindowUsedTokens: 100 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ contextWindowUsedTokens: 100 });
    signal.dispose();
  });

  it("ignores another session's numbers entirely — one shared DaemonClient, many open sessions", () => {
    const daemon = createFakeDaemon();
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    daemon.push(upsert({ id: "agt_other", lastUsage: { contextWindowUsedTokens: 999 } }));

    expect(signal.getUsage()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    signal.dispose();
  });

  it("does not re-fire when the daemon re-sends the same numbers on an unrelated snapshot change", () => {
    const daemon = createFakeDaemon();
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 5 } }));
    daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 5 } }));
    daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 6 } }));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(signal.getUsage()).toEqual({ inputTokens: 6 });
    signal.dispose();
  });

  it("leaves the last reading alone on a remove push rather than reading it as zero", () => {
    const daemon = createFakeDaemon();
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 5 } }));
    daemon.push({ type: "agent_update", payload: { kind: "remove", agentId: "agt_1" } });

    expect(signal.getUsage()).toEqual({ inputTokens: 5 });
    expect(onChange).toHaveBeenCalledTimes(1);
    signal.dispose();
  });

  it("ignores a snapshot carrying no usage at all rather than clearing what it has", () => {
    const daemon = createFakeDaemon();
    const signal = createContextUsageSignal(daemon, "agt_1", vi.fn());

    daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 5 } }));
    daemon.push(upsert({ id: "agt_1" }));

    expect(signal.getUsage()).toEqual({ inputTokens: 5 });
    signal.dispose();
  });

  it("bootstraps from fetchAgent, so a session resumed between turns shows its real window at once", async () => {
    const daemon = createFakeDaemon({
      snapshot: { id: "agt_1", lastUsage: { contextWindowUsedTokens: 82_400 } },
    });
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(signal.getUsage()).toEqual({ contextWindowUsedTokens: 82_400 });
    signal.dispose();
  });

  it("survives a daemon that reports no such agent", async () => {
    const daemon = createFakeDaemon({ snapshot: null });
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    await Promise.resolve();
    await Promise.resolve();
    expect(signal.getUsage()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    signal.dispose();
  });

  it("issues no bootstrap request with no agentId", () => {
    const fetchAgent = vi.fn(async () => null);
    const daemon: DaemonAgentUsageSource = { on: () => () => {}, fetchAgent };
    const signal = createContextUsageSignal(daemon, "", vi.fn());
    expect(fetchAgent).not.toHaveBeenCalled();
    signal.dispose();
  });

  it("unsubscribes on dispose, and a push arriving afterwards is a no-op rather than a stale report", () => {
    const daemon = createFakeDaemon();
    const onChange = vi.fn();
    const signal = createContextUsageSignal(daemon, "agt_1", onChange);

    signal.dispose();
    expect(daemon.unsubscribeCount()).toBe(1);
    expect(daemon.hasHandler()).toBe(false);

    signal.dispose();
    expect(daemon.unsubscribeCount()).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never logs, on any path", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      const daemon = createFakeDaemon();
      const signal = createContextUsageSignal(daemon, "agt_1", vi.fn());
      daemon.push(upsert({ id: "agt_1", lastUsage: { inputTokens: 1 } }));
      daemon.push(upsert({ id: "agt_other", lastUsage: { inputTokens: 2 } }));
      daemon.push({ type: "agent_update", payload: { kind: "remove", agentId: "agt_1" } });
      signal.dispose();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
