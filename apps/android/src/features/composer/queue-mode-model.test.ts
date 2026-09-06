import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_QUEUE_MODES_STATE,
  createQueueModesController,
  describeQueueModesUnavailable,
  queueModeLabel,
  supportsQueueModes,
  type AgentQueueModes,
  type DaemonQueueModeSource,
  type QueueMode,
  type QueueModesState,
} from "./queue-mode-model.js";

/**
 * T39C: Android's session-wide queue-mode controller, over a counting
 * fake standing in for `@picompanion/client`'s real `DaemonClient` (see
 * `queue-mode-model.ts`'s module doc for exactly which real methods
 * `DaemonQueueModeSource` is named after).
 *
 * Every assertion below was mutation-checked by hand: the specific
 * construct each `it` names was deleted (or its guard inverted), this
 * file was re-run to confirm the exact test failed, then the change was
 * reverted byte-identically. This task's report carries the full run
 * log for the round-trip and concurrency-guard cases.
 */

/** A counting fake implementing every method — the "fully capable client" fixture most tests below start from. */
function createFullFake(overrides: Partial<DaemonQueueModeSource> = {}): {
  fake: Required<DaemonQueueModeSource>;
  getQueueModesCalls: string[];
  setSteeringModeCalls: Array<{ agentId: string; mode: QueueMode }>;
  setFollowUpModeCalls: Array<{ agentId: string; mode: QueueMode }>;
} {
  const getQueueModesCalls: string[] = [];
  const setSteeringModeCalls: Array<{ agentId: string; mode: QueueMode }> = [];
  const setFollowUpModeCalls: Array<{ agentId: string; mode: QueueMode }> = [];

  let modes: AgentQueueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };

  const fake: Required<DaemonQueueModeSource> = {
    getQueueModes: vi.fn(async (agentId: string) => {
      getQueueModesCalls.push(agentId);
      return { ...modes };
    }),
    setSteeringMode: vi.fn(async (agentId: string, mode: QueueMode) => {
      setSteeringModeCalls.push({ agentId, mode });
      modes = { ...modes, steeringMode: mode };
      return null;
    }),
    setFollowUpMode: vi.fn(async (agentId: string, mode: QueueMode) => {
      setFollowUpModeCalls.push({ agentId, mode });
      modes = { ...modes, followUpMode: mode };
      return null;
    }),
    ...overrides,
  };

  return { fake, getQueueModesCalls, setSteeringModeCalls, setFollowUpModeCalls };
}

describe("describeQueueModesUnavailable", () => {
  it("names the specific reason, never a generic sentence, for each non-ready availability", () => {
    expect(describeQueueModesUnavailable("no-client")).toMatch(/Connect to a daemon/);
    expect(describeQueueModesUnavailable("unsupported")).toMatch(/can't change the steer/);
    expect(describeQueueModesUnavailable("error", "relay unreachable")).toBe("relay unreachable");
    expect(describeQueueModesUnavailable("error")).toBe("Couldn't load the steer/follow-up mode.");
  });
});

describe("supportsQueueModes", () => {
  it("is false when no client is supplied", () => {
    expect(supportsQueueModes(undefined)).toBe(false);
  });

  it("is false when even one of the three methods is missing", () => {
    const { fake } = createFullFake();
    const { setFollowUpMode: _drop, ...partial } = fake;
    expect(supportsQueueModes(partial)).toBe(false);
  });

  it("is true only once all three methods are present", () => {
    const { fake } = createFullFake();
    expect(supportsQueueModes(fake)).toBe(true);
  });
});

describe("queueModeLabel", () => {
  it("names each real mode and a null (not-reported) mode distinctly", () => {
    expect(queueModeLabel("all")).toBe("All together");
    expect(queueModeLabel("one-at-a-time")).toBe("One at a time");
    expect(queueModeLabel(null)).toBe("Not reported");
  });
});

describe("createQueueModesController: availability", () => {
  it("stays no-client when no client is supplied at all, even after load()", async () => {
    const controller = createQueueModesController({ agentId: "agt_1" });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("no-client");
    expect(state.unavailableReason).toBe(describeQueueModesUnavailable("no-client"));
    expect(state.steeringMode).toBeNull();
  });

  it("reports unsupported when the client is missing even one of the three methods, without calling any of them", async () => {
    const { fake, getQueueModesCalls } = createFullFake();
    const { setSteeringMode: _drop, ...partial } = fake;
    const controller = createQueueModesController({ agentId: "agt_1", client: partial });
    await controller.load();
    expect(controller.getState().availability).toBe("unsupported");
    expect(getQueueModesCalls).toHaveLength(0);
  });

  it("loads a ready snapshot from a fully capable client", async () => {
    const { fake, getQueueModesCalls } = createFullFake();
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("ready");
    expect(state.steeringMode).toBe("one-at-a-time");
    expect(state.followUpMode).toBe("one-at-a-time");
    expect(getQueueModesCalls).toEqual(["agt_1"]);
  });

  it("reports error with the daemon's raw explanation when the initial fetch rejects", async () => {
    const { fake } = createFullFake({
      getQueueModes: vi.fn(async () => {
        throw new Error("relay unreachable");
      }),
    });
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("error");
    expect(state.unavailableReason).toBe("relay unreachable");
  });
});

describe("createQueueModesController: setSteeringMode round trip", () => {
  it("sends the new mode, re-fetches the authoritative snapshot, and clears isChangingSteeringMode", async () => {
    const { fake, setSteeringModeCalls, getQueueModesCalls } = createFullFake();
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    getQueueModesCalls.length = 0;

    await controller.setSteeringMode("all");

    expect(setSteeringModeCalls).toEqual([{ agentId: "agt_1", mode: "all" }]);
    // Deleting the `await refreshModes()` call in `setSteeringMode` (queue-mode-model.ts)
    // FAILS this assertion: the fake's own `setSteeringMode` mutates its internal `modes`,
    // so only a real re-fetch can pick that up — the value has to arrive at the fake AND
    // come back through a second `getQueueModes` call for this to pass.
    expect(getQueueModesCalls).toEqual(["agt_1"]);
    const state = controller.getState();
    expect(state.steeringMode).toBe("all");
    expect(state.isChangingSteeringMode).toBe(false);
  });

  it("carries the daemon's provider notice through to steeringNotice", async () => {
    const { fake } = createFullFake({
      setSteeringMode: vi.fn(async () => ({ type: "info" as const, message: "applies next turn" })),
    });
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    await controller.setSteeringMode("all");
    expect(controller.getState().steeringNotice).toEqual({
      type: "info",
      message: "applies next turn",
    });
  });

  it("is a no-op while unsupported (setSteeringMode is never called)", async () => {
    const { fake, setSteeringModeCalls } = createFullFake();
    const { setSteeringMode: _drop, ...partial } = fake;
    const controller = createQueueModesController({ agentId: "agt_1", client: partial });
    await controller.load();
    await controller.setSteeringMode("all");
    expect(setSteeringModeCalls).toHaveLength(0);
  });

  it("is a no-op while another change is already in flight (concurrency guard)", async () => {
    let resolveFirst: (() => void) | undefined;
    const { fake, setSteeringModeCalls, setFollowUpModeCalls } = createFullFake({
      setSteeringMode: vi.fn(
        (agentId: string, mode: QueueMode) =>
          new Promise<null>((resolve) => {
            setSteeringModeCalls.push({ agentId, mode });
            resolveFirst = () => resolve(null);
          }),
      ),
    });
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();

    const firstCall = controller.setSteeringMode("all");
    expect(controller.getState().isChangingSteeringMode).toBe(true);

    await controller.setFollowUpMode("all");
    expect(setFollowUpModeCalls).toHaveLength(0);

    resolveFirst?.();
    await firstCall;
    expect(setSteeringModeCalls).toHaveLength(1);
  });

  it("records the daemon's raw error and clears isChangingSteeringMode on rejection", async () => {
    const { fake } = createFullFake({
      setSteeringMode: vi.fn(async () => {
        throw new Error("daemon refused: unknown mode");
      }),
    });
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    await controller.setSteeringMode("all");
    const state = controller.getState();
    expect(state.changeError).toBe("daemon refused: unknown mode");
    expect(state.isChangingSteeringMode).toBe(false);
  });
});

describe("createQueueModesController: setFollowUpMode round trip", () => {
  it("sends the new mode, re-fetches the authoritative snapshot, and clears isChangingFollowUpMode", async () => {
    const { fake, setFollowUpModeCalls, getQueueModesCalls } = createFullFake();
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    getQueueModesCalls.length = 0;

    await controller.setFollowUpMode("all");

    expect(setFollowUpModeCalls).toEqual([{ agentId: "agt_1", mode: "all" }]);
    expect(getQueueModesCalls).toEqual(["agt_1"]);
    expect(controller.getState().followUpMode).toBe("all");
  });

  it("carries the daemon's provider notice through to followUpNotice", async () => {
    const { fake } = createFullFake({
      setFollowUpMode: vi.fn(async () => ({
        type: "warning" as const,
        message: "provider ignores this setting",
      })),
    });
    const controller = createQueueModesController({ agentId: "agt_1", client: fake });
    await controller.load();
    await controller.setFollowUpMode("all");
    expect(controller.getState().followUpNotice).toEqual({
      type: "warning",
      message: "provider ignores this setting",
    });
  });
});

describe("INITIAL_QUEUE_MODES_STATE", () => {
  it("starts unavailable, never showing a stale or guessed mode", () => {
    const state: QueueModesState = INITIAL_QUEUE_MODES_STATE;
    expect(state.availability).toBe("no-client");
    expect(state.steeringMode).toBeNull();
    expect(state.followUpMode).toBeNull();
  });
});
