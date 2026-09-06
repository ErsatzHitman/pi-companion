import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentModelOption,
  AgentModelSnapshot,
  AgentProviderNotice,
  AgentThinkingOption,
  AgentTurnClient,
} from "./agent-turn-client.js";

/**
 * Model and thinking-level selection (T28B5, plan.md §11.1's "model and
 * reasoning" RPC group).
 *
 * `availability` distinguishes *why* the picker might have nothing
 * useful to show, rather than collapsing every case into an empty list
 * (plan.md §11.4 "unavailable options are explained"):
 *
 * - `"no-client"`: no live turn-control client is wired at all — the
 *   same "no client yet" seam the rest of this feature already
 *   documents (`use-composer.ts`, `use-slash-commands.ts`).
 * - `"unsupported"`: a client is wired but omits one or more of the
 *   four model/thinking methods (`getAgentModelSnapshot`,
 *   `listAvailableModels`, `setAgentModel`, `setAgentThinkingOption`) —
 *   this connection genuinely cannot change the model, so the picker
 *   says so rather than silently doing nothing.
 * - `"loading"`: the initial snapshot fetch is in flight.
 * - `"error"`: the initial snapshot fetch failed; `unavailableReason`
 *   carries the daemon's raw explanation.
 * - `"ready"`: a snapshot has loaded; `modelId`/`thinkingOptionId`
 *   reflect this agent's real state (T28B5's "reflecting … session
 *   state" acceptance criterion) and are visible without opening either
 *   picker (native `<select>` always shows its current value collapsed).
 *
 * Reflecting *and* changing session state (T28B5's "round-trips and
 * persists" acceptance criterion): `setModel`/`setThinkingOption` call
 * the daemon, then re-fetch the authoritative snapshot rather than
 * guessing the result locally — the daemon, not this hook, decides the
 * post-change state (for example, changing model can silently reset an
 * incompatible thinking level). `onAgentModelSnapshotChange`, when the
 * client implements it, additionally reflects a change made by a
 * *different* connected client (plan.md §12.3).
 */
export interface UseModelThinkingOptions {
  /** Conversation target this picker reads/changes (session or agent id). */
  sessionId: string;
  /** Live turn-control client; the four model/thinking methods on it are themselves optional. */
  client?: AgentTurnClient;
}

export type ModelThinkingAvailability = "no-client" | "unsupported" | "loading" | "ready" | "error";

export interface ModelThinkingState {
  availability: ModelThinkingAvailability;
  /** Human explanation for a non-`"ready"` `availability`, or `null` once ready. */
  unavailableReason: string | null;
  /** This agent's provider, or `null` before the first snapshot loads. */
  provider: string | null;
  /** The currently selected model id, or `null` if none is set yet. */
  modelId: string | null;
  /** Every model `listAvailableModels` returned for this agent's provider. */
  models: readonly AgentModelOption[];
  /** Explains — rather than silently empties — the model list when it failed to load. */
  modelsError: string | null;
  /** This agent's own explicit thinking-level choice; `null` means "use the default". */
  thinkingOptionId: string | null;
  /** What the provider is actually applying right now (may differ from `thinkingOptionId`). */
  effectiveThinkingOptionId: string | null;
  /** The selected model's own thinking options (`[]` if it does not support any, or no model is selected). */
  thinkingOptions: readonly AgentThinkingOption[];
  /** Explains why `thinkingOptions` is empty (unsupported model, no model selected yet), or `null`. */
  thinkingUnsupportedReason: string | null;
  /** `true` while a `setModel` call is in flight. */
  isChangingModel: boolean;
  /** `true` while a `setThinkingOption` call is in flight. */
  isChangingThinking: boolean;
  /** The most recent `setModel`/`setThinkingOption` failure, or `null`. Cleared at the start of the next call. */
  changeError: string | null;
  /** A provider notice attached to the most recent successful thinking-level change (e.g. an unsupported-level fallback), or `null`. */
  thinkingNotice: AgentProviderNotice | null;
  /** Changes this agent's model. No-op while `availability !== "ready"` or another change is already in flight. */
  setModel: (modelId: string) => Promise<void>;
  /** Changes this agent's thinking level (`null` clears an explicit choice). Same guards as `setModel`. */
  setThinkingOption: (thinkingOptionId: string | null) => Promise<void>;
}

const REQUIRED_METHODS = [
  "getAgentModelSnapshot",
  "listAvailableModels",
  "setAgentModel",
  "setAgentThinkingOption",
] as const;

function supportsModelThinking(client: AgentTurnClient): boolean {
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export function useModelThinking({
  sessionId,
  client,
}: UseModelThinkingOptions): ModelThinkingState {
  const [availability, setAvailability] = useState<ModelThinkingAvailability>("no-client");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AgentModelSnapshot | null>(null);
  const [models, setModels] = useState<readonly AgentModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [isChangingThinking, setIsChangingThinking] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [thinkingNotice, setThinkingNotice] = useState<AgentProviderNotice | null>(null);

  // Latest snapshot, readable synchronously from `setModel`/`setThinkingOption`
  // without adding `snapshot` to their own dependency lists.
  const snapshotRef = useRef<AgentModelSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const supported = client ? supportsModelThinking(client) : false;

  // Initial snapshot fetch (T28B5): resets on every agent/client identity
  // change, matching `useComposer`'s `onQueueUpdate` subscription
  // lifecycle.
  useEffect(() => {
    setSnapshot(null);
    setModels([]);
    setModelsError(null);
    setChangeError(null);
    setThinkingNotice(null);

    if (!client) {
      setAvailability("no-client");
      setUnavailableReason("Connect to a daemon to change the model or thinking level.");
      return;
    }
    if (!supported) {
      setAvailability("unsupported");
      setUnavailableReason("This connection cannot change the model or thinking level.");
      return;
    }

    setAvailability("loading");
    setUnavailableReason(null);
    let cancelled = false;

    client.getAgentModelSnapshot!(sessionId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setAvailability("error");
          setUnavailableReason(`Agent not found: ${sessionId}`);
          return;
        }
        setSnapshot(result);
        setAvailability("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setAvailability("error");
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `supported` is derived from `client` each render, not independent state.
  }, [client, sessionId]);

  // Live reflection of a change made by another connected client (T28B5,
  // plan.md §12.3): optional, independent of the initial-fetch support
  // check above.
  useEffect(() => {
    if (!client?.onAgentModelSnapshotChange) return;
    return client.onAgentModelSnapshotChange(sessionId, (update) => {
      setSnapshot(update);
      setAvailability("ready");
      setUnavailableReason(null);
    });
  }, [client, sessionId]);

  // Model-list fetch (T28B5): re-runs whenever the known provider changes,
  // i.e. once after the initial snapshot resolves.
  const provider = snapshot?.provider ?? null;
  useEffect(() => {
    if (!client?.listAvailableModels || !provider) {
      setModels([]);
      setModelsError(null);
      return;
    }
    let cancelled = false;
    client
      .listAvailableModels(provider)
      .then((result) => {
        if (cancelled) return;
        setModels(result.models);
        setModelsError(result.error);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setModels([]);
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [client, provider]);

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    if (!client?.getAgentModelSnapshot) return;
    const result = await client.getAgentModelSnapshot(sessionId);
    if (result) setSnapshot(result);
  }, [client, sessionId]);

  const setModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (!client?.setAgentModel || isChangingModel || isChangingThinking) return;
      setIsChangingModel(true);
      setChangeError(null);
      try {
        await client.setAgentModel(sessionId, modelId);
        await refreshSnapshot();
      } catch (cause) {
        setChangeError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsChangingModel(false);
      }
    },
    [client, isChangingModel, isChangingThinking, sessionId, refreshSnapshot],
  );

  const setThinkingOption = useCallback(
    async (thinkingOptionId: string | null): Promise<void> => {
      if (!client?.setAgentThinkingOption || isChangingModel || isChangingThinking) return;
      setIsChangingThinking(true);
      setChangeError(null);
      setThinkingNotice(null);
      try {
        const notice = await client.setAgentThinkingOption(sessionId, thinkingOptionId);
        setThinkingNotice(notice);
        await refreshSnapshot();
      } catch (cause) {
        setChangeError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsChangingThinking(false);
      }
    },
    [client, isChangingModel, isChangingThinking, sessionId, refreshSnapshot],
  );

  const selectedModel = models.find((model) => model.id === snapshot?.modelId) ?? null;
  let thinkingOptions: readonly AgentThinkingOption[] = [];
  let thinkingUnsupportedReason: string | null = null;
  if (!snapshot?.modelId) {
    thinkingUnsupportedReason = "Select a model to see its thinking levels.";
  } else if (!selectedModel) {
    thinkingUnsupportedReason = null; // model list still loading or empty; not itself an error.
  } else if (!selectedModel.thinkingOptions || selectedModel.thinkingOptions.length === 0) {
    thinkingUnsupportedReason = `${selectedModel.label} does not support thinking levels.`;
  } else {
    thinkingOptions = selectedModel.thinkingOptions;
  }

  return {
    availability,
    unavailableReason,
    provider,
    modelId: snapshot?.modelId ?? null,
    models,
    modelsError,
    thinkingOptionId: snapshot?.thinkingOptionId ?? null,
    effectiveThinkingOptionId: snapshot?.effectiveThinkingOptionId ?? null,
    thinkingOptions,
    thinkingUnsupportedReason,
    isChangingModel,
    isChangingThinking,
    changeError,
    thinkingNotice,
    setModel,
    setThinkingOption,
  };
}
