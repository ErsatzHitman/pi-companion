/**
 * Model and thinking-level selection for the Android compact composer
 * (T39B, plan.md §11.1's "model and reasoning" RPC group). Mirrors the
 * shape of T28B5's web counterpart
 * (`apps/web/src/features/composer/use-model-thinking.ts` and
 * `agent-turn-client.ts`) — same availability states, same "reflect the
 * daemon's post-change snapshot rather than guess" rule — but nothing
 * here is copied from that file: Android is React Native and this
 * repository's established Android convention for a `-model.ts` is a
 * plain closure over mutable state returned as a controller object
 * (`createVoiceCaptureController`, `../voice/voice-model.ts`), not a
 * React hook. RN-free, like every other `-model.ts` in this workspace:
 * `vitest` cannot render anything that reaches `react-native` (the
 * RolldownError on `node_modules/react-native/index.js:1:0`, proven 27+
 * times across this codebase), so every behavioural claim below is
 * plain data and pure/async functions, independent of `useState`/React.
 * `ModelThinkingPicker.tsx` is the thin view that mirrors this
 * controller's `getState()` into `useState` after each call.
 *
 * ## The port: `DaemonModelThinkingSource` — named after the REAL
 * `DaemonClient` methods, not the ones this task's own brief guessed
 *
 * This task's brief says to check for `listAgentModels`,
 * `listAgentThinkingOptions`, `setAgentModel`, and
 * `setAgentThinkingOption` on `packages/client/src/daemon-client.ts`.
 * Only the latter two exist under those exact names:
 * `grep -n "listAgentModels\|listAgentThinkingOptions"
 * packages/client/src/daemon-client.ts` returns nothing — those two
 * method names have never existed on `DaemonClient`. The real,
 * functionally equivalent surface is:
 *
 *  - `fetchAgent(agentId, requestId?): Promise<FetchAgentResult | null>`
 *    (declared on `DaemonClient` in
 *    `packages/client/src/daemon-client.ts`) — `.agent.provider`/
 *    `.model`/`.thinkingOptionId`/`.effectiveThinkingOptionId` is this
 *    agent's live model/thinking snapshot (`AgentSnapshotPayloadSchema` in
 *    `packages/protocol/src/messages.ts`).
 *  - `listProviderModels(provider, options?):
 *    Promise<ListProviderModelsPayload>` (also on `DaemonClient`) —
 *    `.models` is an array of `AgentModelDefinition` (`packages/protocol/src/
 *    agent-types.ts`), each carrying its OWN `.thinkingOptions`.
 *    There is no separate "list thinking options for this agent"
 *    request — same as web's `use-model-thinking.ts`, which derives
 *    `thinkingOptions` from the selected model, not a fifth RPC.
 *  - `setAgentModel(agentId, modelId): Promise<void>` (also on `DaemonClient`).
 *  - `setAgentThinkingOption(agentId, thinkingOptionId):
 *    Promise<AgentProviderNotice | null>` (also on `DaemonClient`).
 *
 * All four exist and are real, wire-connected methods — this is a
 * naming gap in the task brief, not a missing capability. See this
 * task's report for the full disclosure.
 *
 * `DaemonModelThinkingSource` below names its four methods identically
 * to `DaemonClient`'s real ones, narrowed to only the arguments this
 * feature passes, so a real `DaemonClient` satisfies it AS-IS — no
 * adapter class needed, same convention
 * `../approvals/daemon-permissions-client.ts`'s `DaemonPermissionsSource`
 * and `../sessions/session-tree-sheet-model.ts`'s `SessionTreeClientPort`
 * both use. Every method is OPTIONAL, so an object implementing none of
 * them still structurally satisfies this interface — the same "no
 * client yet" seam `TurnService`/`SessionTreeClientPort` already carry,
 * and what a lab mount or a route with no live connection gets.
 *
 * CORRECTED (T353): the sentence above used to give that seam's reason
 * as "`apps/android/package.json` does not declare `@picompanion/client`
 * as a dependency, and no Android route wires a live `DaemonClient`
 * into this feature yet". The second half is no longer true: the
 * production session route passes
 * `resolveModelThinkingClient(core.connection)`
 * (`../../app-shell/session-route-daemon-clients.ts`), so a real,
 * live `DaemonClient` reaches this port on every connected build. The
 * first half is a fact about the manifest and is beside the point —
 * this port is satisfied structurally, which is exactly why no
 * dependency on that package was ever needed. `supportsModelThinking`
 * below is what decides `"ready"` vs `"unsupported"` — see
 * `describeModelThinkingUnavailable` for the truthful, explained states
 * this produces instead of an enabled control whose only real-build
 * outcome is a failure banner (CLAUDE.md's "the failure mode this wave
 * keeps shipping").
 */

/** A single reasoning-effort option for a model — matches `AgentSelectOption` (`packages/protocol/src/agent-types.ts`) field-for-field. */
export interface ModelThinkingOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

/** A single selectable model — matches `AgentModelDefinition` field-for-field (extra fields on the real object are ignored). */
export interface ModelThinkingModelOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
  /** This model's own reasoning levels — different models under the same provider can support different ones, or none at all. */
  readonly thinkingOptions?: readonly ModelThinkingOption[];
}

/** A provider-sourced notice attached to a change response — matches `AgentProviderNotice` field-for-field. */
export interface ModelThinkingProviderNotice {
  readonly type: "info" | "warning" | "error";
  readonly message: string;
}

/** The slice of `AgentSnapshotPayload` this feature reads — real `fetchAgent` responses carry many more fields, all ignored here. */
export interface ModelThinkingAgentSnapshot {
  readonly provider: string;
  readonly model: string | null;
  readonly thinkingOptionId?: string | null;
  readonly effectiveThinkingOptionId?: string | null;
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * feature needs — see this module's doc comment. A real `DaemonClient`
 * satisfies this as-is; every method is optional so an object
 * implementing none of them (today's only real shape) still does too.
 */
export interface DaemonModelThinkingSource {
  /** Matches `DaemonClient.fetchAgent(agentId, requestId?)`. Resolves `null` if the daemon reports no such agent. */
  fetchAgent?(agentId: string): Promise<{ agent: ModelThinkingAgentSnapshot } | null>;
  /** Matches `DaemonClient.listProviderModels(provider, options?)`. */
  listProviderModels?(
    provider: string,
  ): Promise<{ models?: readonly ModelThinkingModelOption[]; error?: string | null }>;
  /** Matches `DaemonClient.setAgentModel(agentId, modelId)`. */
  setAgentModel?(agentId: string, modelId: string | null): Promise<void>;
  /** Matches `DaemonClient.setAgentThinkingOption(agentId, thinkingOptionId)`. */
  setAgentThinkingOption?(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<ModelThinkingProviderNotice | null>;
}

const REQUIRED_METHODS = [
  "fetchAgent",
  "listProviderModels",
  "setAgentModel",
  "setAgentThinkingOption",
] as const;

/** `true` only when every one of the four methods above is present. */
export function supportsModelThinking(client: DaemonModelThinkingSource | undefined): boolean {
  if (!client) return false;
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export type ModelThinkingAvailability = "no-client" | "unsupported" | "loading" | "ready" | "error";

/**
 * The truthful, user-facing sentence for a non-`"ready"` availability —
 * never "Something went wrong", always naming why. `"error"`'s `reason`
 * is the daemon's own raw explanation (or "agent not found: …"), so it
 * is passed through rather than replaced.
 */
export function describeModelThinkingUnavailable(
  availability: Exclude<ModelThinkingAvailability, "loading" | "ready">,
  reason?: string | null,
): string {
  if (availability === "no-client") {
    return "Connect to a daemon to change the model or thinking level.";
  }
  if (availability === "unsupported") {
    return "This connection can't change the model or thinking level.";
  }
  return reason ?? "Couldn't load the model and thinking level.";
}

export interface ModelThinkingState {
  readonly availability: ModelThinkingAvailability;
  /** Human explanation for a non-`"ready"` availability, or `null` once ready. */
  readonly unavailableReason: string | null;
  /** This agent's provider, or `null` before the first snapshot loads. */
  readonly provider: string | null;
  /** The currently selected model id, or `null` if none is set yet. */
  readonly modelId: string | null;
  /** This agent's own explicit thinking-level choice; `null` means "use the default". */
  readonly thinkingOptionId: string | null;
  /** What the provider is actually applying right now (may differ from `thinkingOptionId`). */
  readonly effectiveThinkingOptionId: string | null;
  /** Every model `listProviderModels` returned for this agent's provider. */
  readonly models: readonly ModelThinkingModelOption[];
  /** Explains — rather than silently empties — the model list when it failed to load. */
  readonly modelsError: string | null;
  /** `true` while a `setModel` call is in flight. */
  readonly isChangingModel: boolean;
  /** `true` while a `setThinkingOption` call is in flight. */
  readonly isChangingThinking: boolean;
  /** The most recent `setModel`/`setThinkingOption` failure, or `null`. Cleared at the start of the next call. */
  readonly changeError: string | null;
  /** A provider notice attached to the most recent successful thinking-level change, or `null`. */
  readonly thinkingNotice: ModelThinkingProviderNotice | null;
}

export const INITIAL_MODEL_THINKING_STATE: ModelThinkingState = {
  availability: "no-client",
  unavailableReason: describeModelThinkingUnavailable("no-client"),
  provider: null,
  modelId: null,
  thinkingOptionId: null,
  effectiveThinkingOptionId: null,
  models: [],
  modelsError: null,
  isChangingModel: false,
  isChangingThinking: false,
  changeError: null,
  thinkingNotice: null,
};

/** The currently selected model's own definition, or `null` if unset/not yet loaded. */
export function selectedModelOption(state: ModelThinkingState): ModelThinkingModelOption | null {
  return state.models.find((model) => model.id === state.modelId) ?? null;
}

/**
 * Display text for the current model — proves "the current selection
 * is visible without opening the picker" without needing a render: the
 * label is derivable from `state` alone, the same value
 * `ModelThinkingPicker.tsx` puts on its `Select` trigger (which shows
 * its current value collapsed).
 */
export function currentModelLabel(state: ModelThinkingState): string {
  return selectedModelOption(state)?.label ?? state.modelId ?? "No model selected";
}

/** Display text for the current *effective* thinking level (falls back to the explicit choice, then "Default"). */
export function currentThinkingLabel(state: ModelThinkingState): string {
  const activeId = state.effectiveThinkingOptionId ?? state.thinkingOptionId;
  if (!activeId) return "Default";
  const options = selectedModelOption(state)?.thinkingOptions ?? [];
  return options.find((option) => option.id === activeId)?.label ?? activeId;
}

/**
 * The selected model's own thinking options, plus a reason to show
 * instead whenever there are none — always read relative to whichever
 * model is currently selected, matching `use-model-thinking.ts`'s
 * identical derivation on web.
 */
export function thinkingOptionsForSelection(state: ModelThinkingState): {
  options: readonly ModelThinkingOption[];
  unsupportedReason: string | null;
} {
  if (!state.modelId) {
    return { options: [], unsupportedReason: "Select a model to see its thinking levels." };
  }
  const selected = selectedModelOption(state);
  if (!selected) {
    // Model list still loading or empty; not itself an error.
    return { options: [], unsupportedReason: null };
  }
  if (!selected.thinkingOptions || selected.thinkingOptions.length === 0) {
    return { options: [], unsupportedReason: `${selected.label} doesn't support thinking levels.` };
  }
  return { options: selected.thinkingOptions, unsupportedReason: null };
}

export interface ModelThinkingControllerDeps {
  /** Conversation target this controller reads/changes (session or agent id). */
  agentId: string;
  /** Live turn-control client; every method on it is itself optional — see this module's doc comment. */
  client?: DaemonModelThinkingSource;
}

export interface ModelThinkingController {
  getState(): ModelThinkingState;
  /**
   * Loads this agent's live snapshot, then that provider's model list.
   * Safe to call again (e.g. when the picker reopens, or `agentId`/
   * `client` changes) — always re-fetches rather than trusting a stale
   * cached value.
   */
  load(): Promise<void>;
  /** Changes this agent's model. No-op while unsupported or another change is already in flight. */
  setModel(modelId: string): Promise<void>;
  /** Changes this agent's thinking level (`null` clears an explicit choice). Same guards as `setModel`. */
  setThinkingOption(thinkingOptionId: string | null): Promise<void>;
}

/**
 * Builds a `ModelThinkingController`. One instance per composer/agent
 * surface — mirrors `createVoiceCaptureController`'s shape exactly: a
 * plain closure over mutable state, no React, driven entirely by its
 * returned methods.
 */
export function createModelThinkingController(
  deps: ModelThinkingControllerDeps,
): ModelThinkingController {
  const { agentId, client } = deps;

  let state: ModelThinkingState = INITIAL_MODEL_THINKING_STATE;

  function toString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function loadModelsForProvider(provider: string): Promise<void> {
    if (!client?.listProviderModels) {
      state = { ...state, models: [], modelsError: null };
      return;
    }
    try {
      const result = await client.listProviderModels(provider);
      state = { ...state, models: result.models ?? [], modelsError: result.error ?? null };
    } catch (error) {
      state = { ...state, models: [], modelsError: toString(error) };
    }
  }

  async function load(): Promise<void> {
    if (!client) {
      state = {
        ...INITIAL_MODEL_THINKING_STATE,
        availability: "no-client",
        unavailableReason: describeModelThinkingUnavailable("no-client"),
      };
      return;
    }
    if (!supportsModelThinking(client)) {
      state = {
        ...INITIAL_MODEL_THINKING_STATE,
        availability: "unsupported",
        unavailableReason: describeModelThinkingUnavailable("unsupported"),
      };
      return;
    }

    state = { ...state, availability: "loading", unavailableReason: null };
    try {
      const result = await client.fetchAgent!(agentId);
      if (!result) {
        state = {
          ...state,
          availability: "error",
          unavailableReason: describeModelThinkingUnavailable(
            "error",
            `Agent not found: ${agentId}`,
          ),
        };
        return;
      }
      state = {
        ...state,
        availability: "ready",
        unavailableReason: null,
        provider: result.agent.provider,
        modelId: result.agent.model,
        thinkingOptionId: result.agent.thinkingOptionId ?? null,
        effectiveThinkingOptionId: result.agent.effectiveThinkingOptionId ?? null,
      };
      await loadModelsForProvider(result.agent.provider);
    } catch (error) {
      state = {
        ...state,
        availability: "error",
        unavailableReason: describeModelThinkingUnavailable("error", toString(error)),
      };
    }
  }

  // Re-fetches the authoritative snapshot rather than guessing the
  // result locally — the daemon, not this controller, decides the
  // post-change state (for example, changing model can silently reset
  // an incompatible thinking level). Mirrors `use-model-thinking.ts`'s
  // `refreshSnapshot` exactly.
  async function refreshSnapshot(): Promise<void> {
    if (!client?.fetchAgent) return;
    const result = await client.fetchAgent(agentId);
    if (!result) return;
    state = {
      ...state,
      provider: result.agent.provider,
      modelId: result.agent.model,
      thinkingOptionId: result.agent.thinkingOptionId ?? null,
      effectiveThinkingOptionId: result.agent.effectiveThinkingOptionId ?? null,
    };
  }

  async function setModel(modelId: string): Promise<void> {
    if (!client?.setAgentModel || state.isChangingModel || state.isChangingThinking) return;
    state = { ...state, isChangingModel: true, changeError: null };
    try {
      await client.setAgentModel(agentId, modelId);
      await refreshSnapshot();
    } catch (error) {
      state = { ...state, changeError: toString(error) };
    } finally {
      state = { ...state, isChangingModel: false };
    }
  }

  async function setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    if (!client?.setAgentThinkingOption || state.isChangingModel || state.isChangingThinking) {
      return;
    }
    state = { ...state, isChangingThinking: true, changeError: null, thinkingNotice: null };
    try {
      const notice = await client.setAgentThinkingOption(agentId, thinkingOptionId);
      state = { ...state, thinkingNotice: notice };
      await refreshSnapshot();
    } catch (error) {
      state = { ...state, changeError: toString(error) };
    } finally {
      state = { ...state, isChangingThinking: false };
    }
  }

  return {
    getState: () => state,
    load,
    setModel,
    setThinkingOption,
  };
}
