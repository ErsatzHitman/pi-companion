import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_SESSION_CONTROLS_STATE,
  createSessionControlsController,
  currentModeLabel,
  describeAutoCompaction,
  describeSessionControlsUnavailable,
  supportsSessionControls,
  type DaemonSessionControlsSource,
  type SessionModeOption,
} from "./session-controls-model.js";

/**
 * T354: Android's Build/Plan mode and auto-compaction controller, over a
 * counting fake standing in for `@picompanion/client`'s real
 * `DaemonClient` — the same shape `model-thinking-model.test.ts` uses,
 * and for the same reason (this controller is RN-free, so every claim
 * below is proven by execution rather than by a source-regex pin).
 *
 * Each `it` was mutation-checked by hand: the construct it names was
 * deleted or its guard inverted, this file re-run to confirm that exact
 * case failed, and the change reverted byte-identically.
 */

const BUILD: SessionModeOption = { id: "build", label: "Build", description: "Edit and run" };
const PLAN: SessionModeOption = { id: "plan", label: "Plan", description: "Read and propose" };

interface FullFake {
  fake: Required<DaemonSessionControlsSource>;
  fetchAgentCalls: string[];
  listProviderModesCalls: string[];
  setAgentModeCalls: Array<{ agentId: string; modeId: string }>;
  setAutoCompactionCalls: Array<{ agentId: string; enabled: boolean }>;
  getAutoCompactionCalls: string[];
}

/** A fully capable fake whose snapshot really moves when a setter is called. */
function createFullFake(overrides: Partial<DaemonSessionControlsSource> = {}): FullFake {
  const fetchAgentCalls: string[] = [];
  const listProviderModesCalls: string[] = [];
  const setAgentModeCalls: Array<{ agentId: string; modeId: string }> = [];
  const setAutoCompactionCalls: Array<{ agentId: string; enabled: boolean }> = [];
  const getAutoCompactionCalls: string[] = [];

  let currentModeId: string | null = "build";
  let autoCompaction = false;

  const fake: Required<DaemonSessionControlsSource> = {
    fetchAgent: vi.fn(async (agentId: string) => {
      fetchAgentCalls.push(agentId);
      return { agent: { provider: "pi", currentModeId, availableModes: [BUILD, PLAN] } };
    }),
    listProviderModes: vi.fn(async (provider: string) => {
      listProviderModesCalls.push(provider);
      return { modes: [BUILD, PLAN], error: null };
    }),
    setAgentMode: vi.fn(async (agentId: string, modeId: string) => {
      setAgentModeCalls.push({ agentId, modeId });
      currentModeId = modeId;
      return null;
    }),
    getAutoCompaction: vi.fn(async (agentId: string) => {
      getAutoCompactionCalls.push(agentId);
      return autoCompaction;
    }),
    setAutoCompaction: vi.fn(async (agentId: string, enabled: boolean) => {
      setAutoCompactionCalls.push({ agentId, enabled });
      autoCompaction = enabled;
      return null;
    }),
    ...overrides,
  } as Required<DaemonSessionControlsSource>;

  return {
    fake,
    fetchAgentCalls,
    listProviderModesCalls,
    setAgentModeCalls,
    setAutoCompactionCalls,
    getAutoCompactionCalls,
  };
}

describe("supportsSessionControls", () => {
  it("is false for no client at all", () => {
    expect(supportsSessionControls(undefined)).toBe(false);
  });

  it("is false when even one of the five methods is missing", () => {
    const { fake } = createFullFake();
    const partial: DaemonSessionControlsSource = { ...fake };
    delete partial.setAutoCompaction;
    expect(supportsSessionControls(partial)).toBe(false);
  });

  it("is true only for a client carrying every one of the five", () => {
    expect(supportsSessionControls(createFullFake().fake)).toBe(true);
  });
});

describe("describeSessionControlsUnavailable", () => {
  it("names the connection, not a generic failure, for each non-error state", () => {
    expect(describeSessionControlsUnavailable("no-client")).toMatch(/Connect to a daemon/);
    expect(describeSessionControlsUnavailable("unsupported")).toMatch(/can't change the mode/);
  });

  it("passes the daemon's own explanation through rather than replacing it", () => {
    expect(describeSessionControlsUnavailable("error", "provider refused")).toBe(
      "provider refused",
    );
  });

  it("still says something truthful when an error carries no reason", () => {
    expect(describeSessionControlsUnavailable("error", null)).toMatch(/Couldn't load/);
  });
});

describe("currentModeLabel", () => {
  it("shows the mode's own label, not its wire id", () => {
    expect(
      currentModeLabel({
        ...INITIAL_SESSION_CONTROLS_STATE,
        modes: [BUILD, PLAN],
        currentModeId: "plan",
      }),
    ).toBe("Plan");
  });

  it("falls back to the id when the provider reports a mode it did not list", () => {
    expect(
      currentModeLabel({
        ...INITIAL_SESSION_CONTROLS_STATE,
        modes: [BUILD],
        currentModeId: "ghost",
      }),
    ).toBe("ghost");
  });

  it("says Default when the provider reports no mode at all", () => {
    expect(currentModeLabel(INITIAL_SESSION_CONTROLS_STATE)).toBe("Default");
  });
});

describe("describeAutoCompaction", () => {
  it("distinguishes unknown from off — the two differ by whether the session survives", () => {
    expect(describeAutoCompaction(null)).toMatch(/unknown/);
    expect(describeAutoCompaction(false)).toBe("Auto-compaction off");
    expect(describeAutoCompaction(true)).toBe("Auto-compaction on");
  });
});

describe("createSessionControlsController", () => {
  it("starts in the no-client state, with a sentence that says so", () => {
    const controller = createSessionControlsController({ agentId: "a1" });
    expect(controller.getState()).toEqual(INITIAL_SESSION_CONTROLS_STATE);
    expect(controller.getState().unavailableReason).toMatch(/Connect to a daemon/);
  });

  it("lands in unsupported — never in an enabled control — for a partial client", async () => {
    const { fake } = createFullFake();
    const partial: DaemonSessionControlsSource = { ...fake };
    delete partial.setAgentMode;

    const controller = createSessionControlsController({ agentId: "a1", client: partial });
    await controller.load();

    expect(controller.getState().availability).toBe("unsupported");
    expect(controller.getState().unavailableReason).toMatch(/can't change the mode/);
    expect(fake.fetchAgent).not.toHaveBeenCalled();
  });

  it("loads provider, modes, current mode and auto-compaction from one snapshot", async () => {
    const { fake, fetchAgentCalls, listProviderModesCalls, getAutoCompactionCalls } =
      createFullFake();
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();
    const state = controller.getState();

    expect(state.availability).toBe("ready");
    expect(state.unavailableReason).toBeNull();
    expect(state.provider).toBe("pi");
    expect(state.modes).toEqual([BUILD, PLAN]);
    expect(state.currentModeId).toBe("build");
    expect(state.autoCompaction).toBe(false);
    expect(fetchAgentCalls).toEqual(["a1"]);
    expect(getAutoCompactionCalls).toEqual(["a1"]);
    // The snapshot already carried the modes, so the provider-level
    // lookup is not paid for.
    expect(listProviderModesCalls).toEqual([]);
  });

  it("falls back to listProviderModes only when the snapshot carries no modes", async () => {
    const { fake, listProviderModesCalls } = createFullFake({
      fetchAgent: async () => ({ agent: { provider: "claude", currentModeId: null } }),
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();

    expect(listProviderModesCalls).toEqual(["claude"]);
    expect(controller.getState().modes).toEqual([BUILD, PLAN]);
    expect(controller.getState().currentModeId).toBeNull();
  });

  it("explains an empty mode list rather than silently showing none", async () => {
    const { fake } = createFullFake({
      fetchAgent: async () => ({ agent: { provider: "claude" } }),
      listProviderModes: async () => ({ modes: [], error: "provider offline" }),
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();

    expect(controller.getState().availability).toBe("ready");
    expect(controller.getState().modes).toEqual([]);
    expect(controller.getState().modesError).toBe("provider offline");
  });

  it("keeps the panel usable when only the mode lookup throws", async () => {
    const { fake } = createFullFake({
      fetchAgent: async () => ({ agent: { provider: "claude" } }),
      listProviderModes: async () => {
        throw new Error("socket closed");
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();

    expect(controller.getState().availability).toBe("ready");
    expect(controller.getState().modesError).toBe("socket closed");
  });

  it("reports a missing agent by name instead of pretending the panel loaded", async () => {
    const { fake } = createFullFake({ fetchAgent: async () => null });
    const controller = createSessionControlsController({ agentId: "gone", client: fake });

    await controller.load();

    expect(controller.getState().availability).toBe("error");
    expect(controller.getState().unavailableReason).toBe("Agent not found: gone");
  });

  it("carries the thrown message into the error state", async () => {
    const { fake } = createFullFake({
      fetchAgent: async () => {
        throw new Error("daemon unreachable");
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();

    expect(controller.getState().availability).toBe("error");
    expect(controller.getState().unavailableReason).toBe("daemon unreachable");
  });

  it("leaves auto-compaction unknown — never false — when the daemon refuses the read", async () => {
    const { fake } = createFullFake({
      getAutoCompaction: async () => {
        throw new Error("unsupported by provider");
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.load();

    expect(controller.getState().availability).toBe("ready");
    expect(controller.getState().autoCompaction).toBeNull();
  });

  it("sends the mode change and shows what the daemon reports back, not what was asked", async () => {
    const { fake, setAgentModeCalls } = createFullFake();
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setMode("plan");

    expect(setAgentModeCalls).toEqual([{ agentId: "a1", modeId: "plan" }]);
    expect(controller.getState().currentModeId).toBe("plan");
    expect(controller.getState().isChangingMode).toBe(false);
  });

  it("keeps the provider's notice from a successful mode change", async () => {
    const { fake } = createFullFake({
      setAgentMode: async () => ({ type: "warning" as const, message: "Plan mode is read-only" }),
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setMode("plan");

    expect(controller.getState().notice).toEqual({
      type: "warning",
      message: "Plan mode is read-only",
    });
  });

  it("shows a failed mode change instead of a silently unchanged control", async () => {
    const { fake } = createFullFake({
      setAgentMode: async () => {
        throw new Error("provider refused");
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setMode("plan");

    expect(controller.getState().changeError).toBe("provider refused");
    expect(controller.getState().isChangingMode).toBe(false);
    expect(controller.getState().currentModeId).toBe("build");
  });

  it("refuses a mode change before the panel is ready", async () => {
    const { fake, setAgentModeCalls } = createFullFake();
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.setMode("plan");

    expect(setAgentModeCalls).toEqual([]);
  });

  it("does not send a second mode change while the first is still in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setAgentModeCalls: string[] = [];
    const { fake } = createFullFake({
      setAgentMode: async (_agentId: string, modeId: string) => {
        setAgentModeCalls.push(modeId);
        await gate;
        return null;
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    const first = controller.setMode("plan");
    expect(controller.getState().isChangingMode).toBe(true);
    await controller.setMode("build");
    expect(setAgentModeCalls).toEqual(["plan"]);

    release?.();
    await first;
    expect(controller.getState().isChangingMode).toBe(false);
  });

  it("reads auto-compaction back after writing it, rather than trusting the request", async () => {
    const { fake, setAutoCompactionCalls, getAutoCompactionCalls } = createFullFake();
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setAutoCompaction(true);

    expect(setAutoCompactionCalls).toEqual([{ agentId: "a1", enabled: true }]);
    expect(getAutoCompactionCalls).toEqual(["a1", "a1"]);
    expect(controller.getState().autoCompaction).toBe(true);
  });

  it("shows unknown when the write succeeds but the read-back is refused", async () => {
    let reads = 0;
    const { fake } = createFullFake({
      getAutoCompaction: async () => {
        reads += 1;
        if (reads > 1) throw new Error("read refused");
        return false;
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setAutoCompaction(true);

    expect(controller.getState().autoCompaction).toBeNull();
  });

  it("shows a failed compaction change and leaves the previous reading alone", async () => {
    const { fake } = createFullFake({
      setAutoCompaction: async () => {
        throw new Error("provider refused");
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setAutoCompaction(true);

    expect(controller.getState().changeError).toBe("provider refused");
    expect(controller.getState().isChangingAutoCompaction).toBe(false);
    expect(controller.getState().autoCompaction).toBe(false);
  });

  it("refuses an auto-compaction change before the panel is ready", async () => {
    const { fake, setAutoCompactionCalls } = createFullFake();
    const controller = createSessionControlsController({ agentId: "a1", client: fake });

    await controller.setAutoCompaction(true);

    expect(setAutoCompactionCalls).toEqual([]);
  });

  it("does not send a second compaction change while the first is still in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enabledSeen: boolean[] = [];
    const { fake } = createFullFake({
      setAutoCompaction: async (_agentId: string, enabled: boolean) => {
        enabledSeen.push(enabled);
        await gate;
        return null;
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    const first = controller.setAutoCompaction(true);
    expect(controller.getState().isChangingAutoCompaction).toBe(true);
    await controller.setAutoCompaction(false);
    expect(enabledSeen).toEqual([true]);

    release?.();
    await first;
    expect(controller.getState().isChangingAutoCompaction).toBe(false);
  });

  it("clears a previous error and notice when a new change starts", async () => {
    let fail = true;
    const { fake } = createFullFake({
      setAgentMode: async () => {
        if (fail) throw new Error("first attempt refused");
        return { type: "info" as const, message: "switched" };
      },
    });
    const controller = createSessionControlsController({ agentId: "a1", client: fake });
    await controller.load();

    await controller.setMode("plan");
    expect(controller.getState().changeError).toBe("first attempt refused");

    fail = false;
    await controller.setMode("plan");
    expect(controller.getState().changeError).toBeNull();
    expect(controller.getState().notice).toEqual({ type: "info", message: "switched" });
  });
});
