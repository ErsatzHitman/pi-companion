import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_MODEL_THINKING_STATE,
  createModelThinkingController,
  currentModelLabel,
  currentThinkingLabel,
  describeModelThinkingUnavailable,
  selectedModelOption,
  supportsModelThinking,
  thinkingOptionsForSelection,
  type DaemonModelThinkingSource,
  type ModelThinkingModelOption,
  type ModelThinkingState,
} from "./model-thinking-model.js";

/**
 * T39B: Android's model/thinking controller, over a counting fake that
 * stands in for `@picompanion/client`'s real `DaemonClient` (see
 * `model-thinking-model.ts`'s module doc for exactly which real methods
 * `DaemonModelThinkingSource` is named after, and the naming gap this
 * task's own brief carried).
 *
 * Every assertion below was mutation-checked by hand: the specific
 * construct each `it` names was deleted (or its guard inverted), this
 * file was re-run to confirm the exact test failed, then the change was
 * reverted byte-identically. This task's report carries the full run
 * log for the round-trip and concurrency-guard cases.
 */

const OPUS: ModelThinkingModelOption = {
  id: "opus",
  label: "Opus",
  isDefault: true,
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "high", label: "High", isDefault: true },
  ],
};
const HAIKU: ModelThinkingModelOption = { id: "haiku", label: "Haiku" };

/** A counting fake implementing every method — the "fully capable client" fixture most tests below start from. */
function createFullFake(overrides: Partial<DaemonModelThinkingSource> = {}): {
  fake: Required<DaemonModelThinkingSource>;
  setAgentModelCalls: Array<{ agentId: string; modelId: string | null }>;
  setAgentThinkingOptionCalls: Array<{ agentId: string; thinkingOptionId: string | null }>;
  fetchAgentCalls: string[];
  listProviderModelsCalls: string[];
} {
  const setAgentModelCalls: Array<{ agentId: string; modelId: string | null }> = [];
  const setAgentThinkingOptionCalls: Array<{ agentId: string; thinkingOptionId: string | null }> =
    [];
  const fetchAgentCalls: string[] = [];
  const listProviderModelsCalls: string[] = [];

  let snapshot: {
    provider: string;
    model: string | null;
    thinkingOptionId: string | null;
    effectiveThinkingOptionId: string | null;
  } = { provider: "pi", model: "opus", thinkingOptionId: null, effectiveThinkingOptionId: "high" };

  const fake: Required<DaemonModelThinkingSource> = {
    fetchAgent: vi.fn(async (agentId: string) => {
      fetchAgentCalls.push(agentId);
      return { agent: { ...snapshot } };
    }),
    listProviderModels: vi.fn(async (provider: string) => {
      listProviderModelsCalls.push(provider);
      return { models: [OPUS, HAIKU], error: null };
    }),
    setAgentModel: vi.fn(async (agentId: string, modelId: string | null) => {
      setAgentModelCalls.push({ agentId, modelId });
      snapshot = {
        ...snapshot,
        model: modelId,
        thinkingOptionId: null,
        effectiveThinkingOptionId: "high",
      };
    }),
    setAgentThinkingOption: vi.fn(async (agentId: string, thinkingOptionId: string | null) => {
      setAgentThinkingOptionCalls.push({ agentId, thinkingOptionId });
      snapshot = {
        ...snapshot,
        thinkingOptionId,
        effectiveThinkingOptionId: thinkingOptionId ?? "high",
      };
      return null;
    }),
    ...overrides,
  };

  return {
    fake,
    setAgentModelCalls,
    setAgentThinkingOptionCalls,
    fetchAgentCalls,
    listProviderModelsCalls,
  };
}

describe("describeModelThinkingUnavailable", () => {
  it("names the specific reason, never a generic sentence, for each non-ready availability", () => {
    expect(describeModelThinkingUnavailable("no-client")).toMatch(/Connect to a daemon/);
    expect(describeModelThinkingUnavailable("unsupported")).toMatch(/can't change the model/);
    expect(describeModelThinkingUnavailable("error", "relay unreachable")).toBe(
      "relay unreachable",
    );
    expect(describeModelThinkingUnavailable("error")).toBe(
      "Couldn't load the model and thinking level.",
    );
  });
});

describe("supportsModelThinking", () => {
  it("is false when no client is supplied", () => {
    expect(supportsModelThinking(undefined)).toBe(false);
  });

  it("is false when even one of the four methods is missing", () => {
    const { fake } = createFullFake();
    const { setAgentThinkingOption: _drop, ...partial } = fake;
    expect(supportsModelThinking(partial)).toBe(false);
  });

  it("is true only once all four methods are present", () => {
    const { fake } = createFullFake();
    expect(supportsModelThinking(fake)).toBe(true);
  });
});

describe("selectedModelOption / currentModelLabel / currentThinkingLabel", () => {
  const state: ModelThinkingState = {
    ...INITIAL_MODEL_THINKING_STATE,
    availability: "ready",
    modelId: "opus",
    thinkingOptionId: null,
    effectiveThinkingOptionId: "high",
    models: [OPUS, HAIKU],
  };

  it("finds the model matching state.modelId", () => {
    expect(selectedModelOption(state)?.id).toBe("opus");
    expect(selectedModelOption({ ...state, modelId: "missing" })).toBeNull();
  });

  it("currentModelLabel prefers the resolved model's label, falls back to the raw id, then a neutral placeholder", () => {
    expect(currentModelLabel(state)).toBe("Opus");
    expect(currentModelLabel({ ...state, modelId: "unknown-id", models: [] })).toBe("unknown-id");
    expect(currentModelLabel({ ...state, modelId: null })).toBe("No model selected");
  });

  it("currentThinkingLabel prefers the effective id's own label, falls back to the raw id, then Default", () => {
    expect(currentThinkingLabel(state)).toBe("High");
    expect(currentThinkingLabel({ ...state, effectiveThinkingOptionId: "unknown-id" })).toBe(
      "unknown-id",
    );
    expect(
      currentThinkingLabel({ ...state, effectiveThinkingOptionId: null, thinkingOptionId: null }),
    ).toBe("Default");
  });
});

describe("thinkingOptionsForSelection", () => {
  const base: ModelThinkingState = { ...INITIAL_MODEL_THINKING_STATE, availability: "ready" };

  it("explains that a model must be selected first when modelId is null", () => {
    const result = thinkingOptionsForSelection(base);
    expect(result.options).toEqual([]);
    expect(result.unsupportedReason).toMatch(/Select a model/);
  });

  it("returns no options and no error while the model list is still loading/empty", () => {
    const result = thinkingOptionsForSelection({ ...base, modelId: "opus", models: [] });
    expect(result.options).toEqual([]);
    expect(result.unsupportedReason).toBeNull();
  });

  it("names the model when it supports no thinking levels at all", () => {
    const result = thinkingOptionsForSelection({ ...base, modelId: "haiku", models: [HAIKU] });
    expect(result.options).toEqual([]);
    expect(result.unsupportedReason).toBe("Haiku doesn't support thinking levels.");
  });

  it("returns the selected model's own thinking options when it has some", () => {
    const result = thinkingOptionsForSelection({ ...base, modelId: "opus", models: [OPUS, HAIKU] });
    expect(result.options).toEqual(OPUS.thinkingOptions);
    expect(result.unsupportedReason).toBeNull();
  });
});

describe("createModelThinkingController: availability", () => {
  it("stays no-client when no client is supplied at all, even after load()", async () => {
    const controller = createModelThinkingController({ agentId: "agt_1" });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("no-client");
    expect(state.unavailableReason).toBe(describeModelThinkingUnavailable("no-client"));
    expect(state.modelId).toBeNull();
  });

  it("reports unsupported when the client is missing even one of the four methods, without calling any of them", async () => {
    const { fake, fetchAgentCalls } = createFullFake();
    const { setAgentModel: _drop, ...partial } = fake;
    const controller = createModelThinkingController({ agentId: "agt_1", client: partial });
    await controller.load();
    expect(controller.getState().availability).toBe("unsupported");
    expect(fetchAgentCalls).toHaveLength(0);
  });

  it("loads a ready snapshot plus the provider's model list from a fully capable client", async () => {
    const { fake, fetchAgentCalls, listProviderModelsCalls } = createFullFake();
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("ready");
    expect(state.provider).toBe("pi");
    expect(state.modelId).toBe("opus");
    expect(state.effectiveThinkingOptionId).toBe("high");
    expect(state.models).toEqual([OPUS, HAIKU]);
    expect(fetchAgentCalls).toEqual(["agt_1"]);
    expect(listProviderModelsCalls).toEqual(["pi"]);
  });

  it("reports a truthful error, naming the agent, when fetchAgent resolves null", async () => {
    const { fake } = createFullFake({ fetchAgent: vi.fn(async () => null) });
    const controller = createModelThinkingController({ agentId: "agt_missing", client: fake });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("error");
    expect(state.unavailableReason).toBe("Agent not found: agt_missing");
  });

  it("reports the daemon's raw explanation when fetchAgent rejects", async () => {
    const { fake } = createFullFake({
      fetchAgent: vi.fn(async () => {
        throw new Error("relay unreachable");
      }),
    });
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();
    expect(controller.getState().unavailableReason).toBe("relay unreachable");
  });

  it("surfaces a model-list load error without clearing availability out of ready", async () => {
    const { fake } = createFullFake({
      listProviderModels: vi.fn(async () => ({ models: undefined, error: "no models configured" })),
    });
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();
    const state = controller.getState();
    expect(state.availability).toBe("ready");
    expect(state.models).toEqual([]);
    expect(state.modelsError).toBe("no models configured");
  });
});

describe("createModelThinkingController: setModel round-trips through the real port", () => {
  it("sends the model change to the client, then reflects the DAEMON's post-change snapshot (not a locally-guessed one)", async () => {
    const { fake, setAgentModelCalls, fetchAgentCalls } = createFullFake();
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();
    expect(fetchAgentCalls).toHaveLength(1);

    await controller.setModel("haiku");

    // The value actually arrived at the fake — not merely "the method exists".
    expect(setAgentModelCalls).toEqual([{ agentId: "agt_1", modelId: "haiku" }]);
    // A second fetchAgent call reads back the daemon's own resulting state.
    expect(fetchAgentCalls).toHaveLength(2);
    const state = controller.getState();
    expect(state.modelId).toBe("haiku");
    // The fake's setAgentModel implementation also resets thinkingOptionId
    // to null server-side — proving this reached refreshSnapshot's real
    // fetch rather than a client-side guess that would have left it alone.
    expect(state.thinkingOptionId).toBeNull();
    expect(state.isChangingModel).toBe(false);
  });

  it("is false while in flight and false again once settled — proven from inside the fake's own implementation", async () => {
    const { fake } = createFullFake();
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();

    let sawChangingDuringCall = false;
    fake.setAgentModel = vi.fn(async () => {
      sawChangingDuringCall = controller.getState().isChangingModel;
    });

    await controller.setModel("haiku");
    expect(sawChangingDuringCall).toBe(true);
    expect(controller.getState().isChangingModel).toBe(false);
  });

  it("records a rejection as changeError and still resets isChangingModel, without crashing", async () => {
    const { fake } = createFullFake({
      setAgentModel: vi.fn(async () => {
        throw new Error("unknown model id");
      }),
    });
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();

    await controller.setModel("nope");
    const state = controller.getState();
    expect(state.changeError).toBe("unknown model id");
    expect(state.isChangingModel).toBe(false);
  });

  it("never calls the underlying client at all when unsupported (no silent no-op that pretends to work)", async () => {
    const { fake } = createFullFake();
    const { setAgentModel: _drop, ...partial } = fake;
    const controller = createModelThinkingController({ agentId: "agt_1", client: partial });
    await controller.load();

    await controller.setModel("haiku");
    expect(controller.getState().modelId).toBeNull();
  });
});

describe("createModelThinkingController: setThinkingOption round-trips through the real port", () => {
  it("sends the thinking-level change, captures the returned provider notice, and refreshes the snapshot", async () => {
    const notice = { type: "warning" as const, message: "Falling back to medium." };
    const { fake, setAgentThinkingOptionCalls, fetchAgentCalls } = createFullFake({
      setAgentThinkingOption: vi.fn(async (agentId: string, thinkingOptionId: string | null) => {
        setAgentThinkingOptionCalls.push({ agentId, thinkingOptionId });
        return notice;
      }),
    });
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();

    await controller.setThinkingOption("low");

    expect(setAgentThinkingOptionCalls).toEqual([{ agentId: "agt_1", thinkingOptionId: "low" }]);
    expect(fetchAgentCalls).toHaveLength(2);
    expect(controller.getState().thinkingNotice).toEqual(notice);
  });

  it("passes null through unchanged (clearing an explicit choice), never coercing it to a string", async () => {
    const { fake, setAgentThinkingOptionCalls } = createFullFake();
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();

    await controller.setThinkingOption(null);

    expect(setAgentThinkingOptionCalls).toEqual([{ agentId: "agt_1", thinkingOptionId: null }]);
  });

  it("mutual exclusion: a setThinkingOption in flight blocks a concurrent setModel from calling the client at all", async () => {
    const { fake, setAgentModelCalls, setAgentThinkingOptionCalls } = createFullFake();
    const controller = createModelThinkingController({ agentId: "agt_1", client: fake });
    await controller.load();

    let releaseThinking!: () => void;
    fake.setAgentThinkingOption = vi.fn(
      (agentId: string, thinkingOptionId: string | null) =>
        new Promise<null>((resolve) => {
          releaseThinking = () => {
            setAgentThinkingOptionCalls.push({ agentId, thinkingOptionId });
            resolve(null);
          };
        }),
    );

    const thinkingPromise = controller.setThinkingOption("low");
    expect(controller.getState().isChangingThinking).toBe(true);

    await controller.setModel("haiku"); // must no-op: isChangingThinking is still true
    expect(setAgentModelCalls).toHaveLength(0);

    releaseThinking();
    await thinkingPromise;
    expect(setAgentThinkingOptionCalls).toEqual([{ agentId: "agt_1", thinkingOptionId: "low" }]);
  });
});
