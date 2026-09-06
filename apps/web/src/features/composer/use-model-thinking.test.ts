import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentModelOption } from "./agent-turn-client.js";
import { FakeAgentTurnClient } from "./test-doubles.js";
import { useModelThinking } from "./use-model-thinking.js";

/** Guards a `waitFor` that depends on this hook's own promise chains settling. */
const SETTLE_WAIT = { timeout: 5_000 } as const;

const MODEL_WITH_THINKING: AgentModelOption = {
  id: "pi-default",
  label: "Pi Default",
  isDefault: true,
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ],
  defaultThinkingOptionId: "medium",
};

const MODEL_WITHOUT_THINKING: AgentModelOption = {
  id: "pi-lite",
  label: "Pi Lite",
};

describe("useModelThinking", () => {
  it("starts (and stays) at 'no-client' availability without a client wired", () => {
    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1" }));
    expect(result.current.availability).toBe("no-client");
    expect(result.current.modelId).toBeNull();
    expect(result.current.models).toEqual([]);
  });

  it("reflects the daemon's current model and thinking state once loaded", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: "high",
      effectiveThinkingOptionId: "high",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    expect(result.current.provider).toBe("pi");
    expect(result.current.modelId).toBe("pi-default");
    expect(result.current.thinkingOptionId).toBe("high");
    expect(result.current.effectiveThinkingOptionId).toBe("high");
    await waitFor(() => expect(result.current.models).toEqual([MODEL_WITH_THINKING]), SETTLE_WAIT);
    expect(result.current.thinkingOptions).toEqual(MODEL_WITH_THINKING.thinkingOptions);
    expect(client.getAgentModelSnapshotCalls).toEqual(["session-1"]);
    expect(client.listAvailableModelsCalls).toEqual(["pi"]);
  });

  it("reports 'unsupported' with a reason when the client omits the model/thinking methods", async () => {
    const client = new FakeAgentTurnClient();
    // Simulate an older/narrower client that never implemented this
    // group, the same "no client yet" seam `onQueueUpdate`/`listCommands`
    // already document.
    (client as { getAgentModelSnapshot?: unknown }).getAgentModelSnapshot = undefined;

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("unsupported"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toBeTruthy();
  });

  it("reports 'error' with the daemon's raw explanation when the snapshot fetch fails", async () => {
    const client = new FakeAgentTurnClient();
    client.getAgentModelSnapshotError = "agent not found";

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("error"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toBe("agent not found");
  });

  it("explains, rather than empties, the thinking picker when the selected model supports no thinking levels", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-lite",
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITHOUT_THINKING], error: null });

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));

    await waitFor(
      () => expect(result.current.models).toEqual([MODEL_WITHOUT_THINKING]),
      SETTLE_WAIT,
    );
    expect(result.current.thinkingOptions).toEqual([]);
    expect(result.current.thinkingUnsupportedReason).toBe(
      "Pi Lite does not support thinking levels.",
    );
  });

  it("explains a model-list load failure via modelsError rather than silently emptying it", async () => {
    const client = new FakeAgentTurnClient();
    client.availableModelsByProvider.set("pi", { models: [], error: "provider offline" });

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.modelsError).toBe("provider offline"), SETTLE_WAIT);
    expect(result.current.models).toEqual([]);
  });

  it("setModel round-trips through the daemon and re-fetches the authoritative snapshot", async () => {
    const client = new FakeAgentTurnClient();
    client.availableModelsByProvider.set("pi", {
      models: [MODEL_WITH_THINKING, MODEL_WITHOUT_THINKING],
      error: null,
    });

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await act(async () => {
      await result.current.setModel("pi-lite");
    });

    expect(client.setAgentModelCalls).toEqual([{ agentId: "session-1", modelId: "pi-lite" }]);
    expect(result.current.modelId).toBe("pi-lite");
    expect(result.current.isChangingModel).toBe(false);
    // The re-fetched snapshot is what drives the new value, not a guess:
    // `getAgentModelSnapshot` is called once on mount and once more after
    // the change.
    expect(client.getAgentModelSnapshotCalls).toEqual(["session-1", "session-1"]);
  });

  it("setModel surfaces the daemon's raw rejection via changeError without changing modelId", async () => {
    const client = new FakeAgentTurnClient();
    client.setAgentModelError = "unknown model id";

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    const originalModelId = result.current.modelId;

    await act(async () => {
      await result.current.setModel("does-not-exist");
    });

    expect(result.current.changeError).toBe("unknown model id");
    expect(result.current.modelId).toBe(originalModelId);
  });

  it("setThinkingOption round-trips, clears with null, and surfaces a provider notice", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: null,
      effectiveThinkingOptionId: "medium",
    };
    client.thinkingNoticeToReturn = { type: "warning", message: "falling back to medium" };

    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await act(async () => {
      await result.current.setThinkingOption("high");
    });

    expect(client.setAgentThinkingOptionCalls).toEqual([
      { agentId: "session-1", thinkingOptionId: "high" },
    ]);
    expect(result.current.thinkingOptionId).toBe("high");
    expect(result.current.thinkingNotice).toEqual({
      type: "warning",
      message: "falling back to medium",
    });

    await act(async () => {
      await result.current.setThinkingOption(null);
    });
    expect(client.setAgentThinkingOptionCalls[1]).toEqual({
      agentId: "session-1",
      thinkingOptionId: null,
    });
  });

  it("reflects a live agent_update push from another connected client", async () => {
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() => useModelThinking({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    act(() => {
      client.emitAgentModelSnapshot("session-1", {
        provider: "pi",
        modelId: "pi-lite",
        thinkingOptionId: null,
        effectiveThinkingOptionId: null,
      });
    });

    expect(result.current.modelId).toBe("pi-lite");

    act(() => {
      client.emitAgentModelSnapshot("session-other", {
        provider: "pi",
        modelId: "should-not-apply",
        thinkingOptionId: null,
        effectiveThinkingOptionId: null,
      });
    });
    expect(result.current.modelId).toBe("pi-lite");
  });
});
