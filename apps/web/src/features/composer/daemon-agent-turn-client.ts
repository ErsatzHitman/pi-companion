/**
 * Real `AgentTurnClient` adapter over a `DaemonClient`-shaped object
 * (T28B3, plan.md §7.1/§12.2 "live turn"). Mirrors the narrow-adapter
 * convention `features/sessions/daemon-sessions-client.ts` established
 * for T27B2: this module only depends on the slice of
 * `@picompanion/client`'s `DaemonClient` it actually calls
 * (`sendAgentMessage`, `cancelAgent`, `on("agent_stream", ...)`), so it
 * never has to import `@picompanion/client` to stay structurally
 * compatible with it — a real `DaemonClient` satisfies `DaemonTurnClient`
 * as-is. `daemon-agent-turn-client.fixture.test.ts` proves that against
 * the real class and recorded/synthesized protocol frames.
 *
 * `onQueueUpdate` reads the daemon's real `pi_queue_update` `agent_stream`
 * push event (`packages/protocol/src/messages.ts`, sourced from the
 * ported Pi provider's own `queue_update` — this already works against
 * today's dev daemon; `agent-turn-client.ts`'s header comment explains why
 * this file has no client-settable queue-mode counterpart.
 *
 * `listCommands` (T28B4) is the same narrow-adapter treatment applied to
 * `DaemonClient.listCommands(agentId)` / `list_commands_request` +
 * `list_commands_response`: it round-trips the daemon's own, currently
 * available slash commands rather than a hard-coded set, and rejects
 * with the daemon's raw `error` string when the response reports one.
 *
 * Model/thinking selection (T28B5) reuses `DaemonClient.fetchAgent`
 * (`fetch_agent_request`/`_response`) for the one-shot snapshot,
 * `on("agent_update", ...)` (`agent_update` push) for live reflection of
 * a change made by *another* connected client, `listProviderModels`
 * (`list_provider_models_request`/`_response`) for the model list, and
 * `setAgentModel`/`setAgentThinkingOption`
 * (`set_agent_model_request`/`set_agent_thinking_request`) for the
 * change itself.
 *
 * Composer attachments (T28B6) reuse `DaemonClient.uploadFile`
 * (`file.upload.request`/`file.upload.response` plus binary
 * file-transfer frames) as-is: its resolved `file` is already shaped
 * exactly like `AgentUploadedAttachment`, so this adapter only needs to
 * unwrap the `{ file, error }` envelope.
 *
 * The steer/follow-up mode trio (T38B1a) reaches a real
 * `DaemonClient.getQueueModes`/`setSteeringMode`/`setFollowUpMode`,
 * added by T110 (`5806cff`) earlier in this same wave, sending
 * `set_steering_mode_request`/`set_follow_up_mode_request`/
 * `get_queue_modes_request`. They stay optional here so a turn client
 * that omits them still satisfies `DaemonTurnClient` structurally.
 * (CORRECTED (P6-W6 merge gate): this paragraph previously said the
 * three methods "do not exist on any shipped `DaemonClient` yet"; T110
 * landed before T38B1a, not after.) `onQueueModesChange` only needs
 * `daemon.on("agent_update", ...)`, which already exists, so it reads the
 * Pi provider's `runtimeInfo.extra.steeringMode`/`.followUpMode` (T38B0c)
 * off the same push `onAgentModelSnapshotChange` uses.
 *
 * Per-message routing (T38B1b): `sendAgentMessage` below forwards
 * `options` to `daemon.sendAgentMessage(agentId, text, options)` as-is, so
 * `options.streamingBehavior` reaches the real `DaemonClient` and, since
 * the P6-W7 merge gate, is spread onto the `send_agent_message_request`
 * it builds. `packages/protocol`'s `SendAgentMessageRequestSchema` and the
 * daemon side (T97/T38B0c; `session.ts`'s `handleSendAgentMessageRequest`
 * lifts it into `runOptions`) already handled it. CLOSED (P6-W7 merge gate): a `GAP` block here used
 * to record that `SendMessageOptions` had no `streamingBehavior` field, so
 * the choice died one call past this adapter with no banner and no error.
 * `daemon-agent-turn-client.fixture.test.ts` now proves the value reaches
 * the wire frame; deleting the client's spread fails it.
 */

import type {
  AgentAvailableModels,
  AgentModelOption,
  AgentModelSnapshot,
  AgentProviderNotice,
  AgentQueueModes,
  AgentQueueUpdate,
  AgentSlashCommand,
  AgentTurnClient,
  AgentUploadedAttachment,
  QueueMode,
  SendAgentMessageOptions,
} from "./agent-turn-client.js";

/** The `pi_queue_update` `agent_stream` event shape this adapter reads. */
export interface DaemonQueueUpdateEvent {
  type: "pi_queue_update";
  steering: readonly string[];
  followUp: readonly string[];
}

/** Any other `agent_stream` event shape; ignored by this adapter. */
export interface DaemonOtherStreamEvent {
  type: string;
}

/** Raw `agent_stream` wire message shape (`packages/protocol/src/messages.ts`). */
export interface DaemonAgentStreamMessage {
  type: "agent_stream";
  payload: {
    agentId: string;
    event: DaemonQueueUpdateEvent | DaemonOtherStreamEvent;
  };
}

/**
 * The slice of `AgentSnapshotPayload` (`packages/protocol/src/messages.ts`)
 * this adapter reads for model/thinking state (T28B5). A real
 * `AgentSnapshotPayload` has every one of these fields (plus many more
 * this adapter ignores), so it satisfies this type as-is.
 */
export interface DaemonAgentModelFields {
  id: string;
  provider: string;
  model: string | null;
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
  /**
   * The slice of `AgentSnapshotPayload.runtimeInfo` this adapter reads for
   * the steer/follow-up mode (T38B1a). The Pi provider carries
   * `steeringMode`/`followUpMode` inside `runtimeInfo.extra` rather than
   * as dedicated top-level snapshot fields (T38B0c,
   * `packages/server/src/server/agent/providers/pi/agent.ts`'s
   * `getRuntimeInfo()`) — untyped on the wire (`AgentRuntimeInfoSchema.extra`
   * is `z.record(string, unknown)`), so `extractQueueModes` below validates
   * each value before trusting it.
   */
  runtimeInfo?: { extra?: Record<string, unknown> };
}

/** Raw `fetch_agent_response` payload shape this adapter reads (T28B5). */
export interface DaemonFetchAgentModelResult {
  agent: DaemonAgentModelFields;
}

/** Raw `agent_update` wire message shape (T28B5, `AgentUpdateMessageSchema`). */
export interface DaemonAgentUpdateMessage {
  type: "agent_update";
  payload: { kind: "upsert"; agent: DaemonAgentModelFields } | { kind: "remove"; agentId: string };
}

/** Selects which raw wire message shape `DaemonTurnClient.on` resolves to, mirroring `DaemonClient`'s own `Extract<SessionOutboundMessage, { type: TType }>`. */
type DaemonAgentEventMessage<TType extends "agent_stream" | "agent_update"> =
  TType extends "agent_stream" ? DaemonAgentStreamMessage : DaemonAgentUpdateMessage;

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter needs. A real `DaemonClient` satisfies this as-is.
 */
export interface DaemonTurnClient {
  sendAgentMessage(agentId: string, text: string, options?: SendAgentMessageOptions): Promise<void>;
  cancelAgent(agentId: string): Promise<void>;
  /**
   * `type` is generic (rather than a plain `"agent_stream"` literal
   * parameter) so a real `DaemonClient`'s own overloaded, generic `on`
   * (`packages/client/src/daemon-client.ts`) stays structurally
   * assignable here: TypeScript does not substitute a generic source
   * overload's type parameter against a non-generic target parameter
   * type, so a plain literal parameter here would make every real
   * `DaemonClient` fail this interface even though it satisfies it at
   * runtime.
   */
  on<TType extends "agent_stream" | "agent_update">(
    type: TType,
    handler: (message: DaemonAgentEventMessage<TType>) => void,
  ): () => void;

  /**
   * Matches `@picompanion/client`'s `DaemonClient.listCommands(agentId)`
   * overload (T28B4): resolves with the `list_commands_response`
   * payload, whose `commands` entries are already shaped exactly like
   * `AgentSlashCommand`.
   */
  listCommands?(
    agentId: string,
  ): Promise<{ commands: readonly AgentSlashCommand[]; error: string | null }>;

  /**
   * Matches `@picompanion/client`'s `DaemonClient.fetchAgent(agentId)`
   * overload (T28B5): resolves with `fetch_agent_response`'s payload, or
   * `null` when the daemon reports no such agent.
   */
  fetchAgent?(agentId: string): Promise<DaemonFetchAgentModelResult | null>;

  /**
   * Matches `@picompanion/client`'s `DaemonClient.listProviderModels(provider, options?)`
   * (T28B5): resolves with `list_provider_models_response`'s payload,
   * whose `models` entries are already shaped exactly like
   * `AgentModelOption`.
   */
  listProviderModels?(
    provider: string,
    options?: { cwd?: string },
  ): Promise<{ models?: readonly AgentModelOption[]; error?: string | null }>;

  /** Matches `@picompanion/client`'s `DaemonClient.setAgentModel(agentId, modelId)` (T28B5). */
  setAgentModel?(agentId: string, modelId: string | null): Promise<void>;

  /** Matches `@picompanion/client`'s `DaemonClient.setAgentThinkingOption(agentId, thinkingOptionId)` (T28B5). */
  setAgentThinkingOption?(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null>;

  /**
   * Matches `@picompanion/client`'s `DaemonClient.uploadFile(input)`
   * (T28B6): resolves with `file.upload.response`'s payload, whose `file`
   * is already shaped exactly like `AgentUploadedAttachment` when present.
   */
  uploadFile?(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    modifiedAt?: string;
  }): Promise<{ file: AgentUploadedAttachment | null; error: string | null }>;

  /**
   * The steer/follow-up mode trio (T38B1a), implemented on the real
   * `@picompanion/client` `DaemonClient` by T110 (`5806cff`).
   *
   * CORRECTED (P6-W6 merge gate): this said the trio was "not
   * implemented by any shipped `DaemonClient` as of P6-W6", and declared
   * both setters as `Promise<void>`. The real class returns
   * `Promise<AgentProviderNotice | null>` for both — the same shape
   * `setAgentThinkingOption` above already uses — so the `Promise<void>`
   * declaration made `DaemonClient` structurally incompatible with
   * `DaemonTurnClient`: 13 `TS2345` errors under a BUILT
   * `@picompanion/client`, twelve in the fixture test and one at the
   * production call site `routes/screens/host-session-screen.tsx(304,49)`.
   * `apps/web` resolves this package through its `dist/`, so a stale
   * build hid it locally and in `web-unit-tests-windows` while breaking
   * CI's `typecheck` job.
   *
   * RESOLVED (T122): `web-tests` and `web-unit-tests-windows` now build
   * the `protocol -> relay -> client` chain themselves before running
   * apps/web's typecheck/build/tests, the same chain `typecheck` already
   * built — so both jobs run against the commit under test, not whatever
   * `dist/` (stale, or simply absent on a clean checkout) happened to be
   * sitting on the runner beforehand. They stay optional so a turn
   * client that omits the group satisfies this interface as-is, exactly
   * like every other optional method group above.
   */
  getQueueModes?(
    agentId: string,
  ): Promise<{ steeringMode: QueueMode | null; followUpMode: QueueMode | null }>;
  setSteeringMode?(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null>;
  setFollowUpMode?(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null>;
}

/** Validates an `unknown` value pulled out of `runtimeInfo.extra` as a real `QueueMode` before trusting it. */
function isQueueMode(value: unknown): value is QueueMode {
  return value === "all" || value === "one-at-a-time";
}

/**
 * `DaemonAgentModelFields.runtimeInfo.extra` -> `AgentQueueModes` (T38B1a).
 * `null` for either field when it is missing, not a `QueueMode` literal,
 * or `runtimeInfo` itself is absent — all three mean "this provider does
 * not report a mode", the same meaning `AgentQueueModes`'s own doc comment
 * gives `null`.
 */
function extractQueueModes(agent: DaemonAgentModelFields): AgentQueueModes {
  const extra = agent.runtimeInfo?.extra;
  return {
    steeringMode: isQueueMode(extra?.steeringMode) ? extra.steeringMode : null,
    followUpMode: isQueueMode(extra?.followUpMode) ? extra.followUpMode : null,
  };
}

function isQueueUpdateEvent(
  event: DaemonQueueUpdateEvent | DaemonOtherStreamEvent,
): event is DaemonQueueUpdateEvent {
  return event.type === "pi_queue_update";
}

/** Builds an `AgentTurnClient` backed by a real (or fixture-driven fake) `DaemonClient`. */
export function createDaemonAgentTurnClient(daemon: DaemonTurnClient): AgentTurnClient {
  return {
    async sendAgentMessage(
      agentId: string,
      text: string,
      options?: SendAgentMessageOptions,
    ): Promise<void> {
      await daemon.sendAgentMessage(agentId, text, options);
    },

    async cancelAgent(agentId: string): Promise<void> {
      await daemon.cancelAgent(agentId);
    },

    onQueueUpdate(agentId: string, handler: (update: AgentQueueUpdate) => void): () => void {
      return daemon.on("agent_stream", (message) => {
        if (message.payload.agentId !== agentId) return;
        const { event } = message.payload;
        if (!isQueueUpdateEvent(event)) return;
        handler({ steering: event.steering, followUp: event.followUp });
      });
    },

    listCommands: daemon.listCommands
      ? async (agentId: string): Promise<readonly AgentSlashCommand[]> => {
          const payload = await daemon.listCommands!(agentId);
          if (payload.error) throw new Error(payload.error);
          return payload.commands;
        }
      : undefined,

    getAgentModelSnapshot:
      daemon.fetchAgent &&
      (async (agentId: string): Promise<AgentModelSnapshot | null> => {
        const result = await daemon.fetchAgent!(agentId);
        if (!result) return null;
        return toAgentModelSnapshot(result.agent);
      }),

    onAgentModelSnapshotChange: (
      agentId: string,
      handler: (snapshot: AgentModelSnapshot) => void,
    ): (() => void) =>
      daemon.on("agent_update", (message) => {
        if (message.payload.kind !== "upsert") return;
        if (message.payload.agent.id !== agentId) return;
        handler(toAgentModelSnapshot(message.payload.agent));
      }),

    listAvailableModels:
      daemon.listProviderModels &&
      (async (provider: string): Promise<AgentAvailableModels> => {
        const payload = await daemon.listProviderModels!(provider);
        return { models: payload.models ?? [], error: payload.error ?? null };
      }),

    setAgentModel:
      daemon.setAgentModel &&
      (async (agentId: string, modelId: string): Promise<void> => {
        await daemon.setAgentModel!(agentId, modelId);
      }),

    setAgentThinkingOption:
      daemon.setAgentThinkingOption &&
      (async (
        agentId: string,
        thinkingOptionId: string | null,
      ): Promise<AgentProviderNotice | null> =>
        daemon.setAgentThinkingOption!(agentId, thinkingOptionId)),

    uploadFile:
      daemon.uploadFile &&
      (async (input: {
        fileName: string;
        mimeType: string;
        bytes: Uint8Array;
        modifiedAt?: string;
      }): Promise<AgentUploadedAttachment> => {
        const result = await daemon.uploadFile!(input);
        if (result.error || !result.file) {
          throw new Error(result.error ?? "Upload rejected");
        }
        return result.file;
      }),

    // Steer/follow-up mode (T38B1a). All three resolve against a real
    // `DaemonClient` since T110 (`5806cff`); they stay `undefined` only
    // for a client that omits the group.
    //
    // CORRECTED (T127): the two setters used to `await` and discard the
    // daemon's `AgentProviderNotice` here, because `AgentTurnClient`'s own
    // `setSteeringMode`/`setFollowUpMode` still returned `Promise<void>` —
    // the user changed a queue mode and was told nothing about when it
    // took effect. Both now resolve with the notice, same shape and same
    // "resolves with the notice, or `null` when there is none" contract
    // `setAgentThinkingOption` above already uses; `use-queue-modes.ts`'s
    // `steeringNotice`/`followUpNotice` and `QueueModePicker.tsx` are what
    // actually carry it to the DOM.
    getQueueModes:
      daemon.getQueueModes &&
      (async (agentId: string): Promise<AgentQueueModes> => daemon.getQueueModes!(agentId)),

    setSteeringMode:
      daemon.setSteeringMode &&
      (async (agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> =>
        daemon.setSteeringMode!(agentId, mode)),

    setFollowUpMode:
      daemon.setFollowUpMode &&
      (async (agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> =>
        daemon.setFollowUpMode!(agentId, mode)),

    // Unlike the three methods above, this needs only `daemon.on`
    // (required, not optional, on `DaemonTurnClient`), so it works against
    // a real `DaemonClient` *today* — independent of T110 — by reading the
    // same `agent_update` push `onAgentModelSnapshotChange` already
    // subscribes to. `use-queue-modes.ts` still gates the whole control's
    // availability on the three methods above, not on this alone; see its
    // own doc comment for why.
    onQueueModesChange: (
      agentId: string,
      handler: (modes: AgentQueueModes) => void,
    ): (() => void) =>
      daemon.on("agent_update", (message) => {
        if (message.payload.kind !== "upsert") return;
        if (message.payload.agent.id !== agentId) return;
        handler(extractQueueModes(message.payload.agent));
      }),
  };
}

/** `DaemonAgentModelFields` -> `AgentModelSnapshot` (T28B5): the composer's own generic shape, filled from live daemon data. */
function toAgentModelSnapshot(agent: DaemonAgentModelFields): AgentModelSnapshot {
  return {
    provider: agent.provider,
    modelId: agent.model,
    thinkingOptionId: agent.thinkingOptionId ?? null,
    effectiveThinkingOptionId: agent.effectiveThinkingOptionId ?? null,
  };
}
