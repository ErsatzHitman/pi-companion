/**
 * Turn-control client contract (T28B2, plan.md §12.2 "live turn").
 *
 * `apps/web` never talks to the daemon directly from a browser socket
 * call site scattered across features; every turn-control action goes
 * through this narrow `AgentTurnClient` interface, shaped to match
 * `@picompanion/client`'s `DaemonClient.sendAgentMessage` and
 * `DaemonClient.cancelAgent` (see `packages/client/src/daemon-client.ts`)
 * and the `send_agent_message_request`/`cancel_agent_request` wire
 * messages (`packages/protocol/src/messages.ts`). A real `DaemonClient`
 * already satisfies this interface structurally; nothing here needs to
 * import `@picompanion/client` to stay in sync with it — same seam used
 * by `features/files/file-browser-client.ts` and
 * `features/terminal/terminal-route.tsx`'s injectable `client?` prop.
 *
 * Steer vs. follow-up is decided by the daemon *by default*: sending a
 * message while a turn is already producing output steers it, while
 * sending one before the turn has started queues a follow-up (see the
 * Pi provider's `startTurn`, `packages/server/src/server/agent/providers/pi/agent.ts`).
 * `sendAgentMessage` is therefore the single entry point for a plain
 * prompt, a steer, and a follow-up alike.
 *
 * CORRECTED (T38B1b): this paragraph used to end "the composer does
 * not, and cannot, choose between them." That is no longer true.
 * `SendAgentMessageOptions.streamingBehavior` below (T38B1b, per-message
 * routing, `PromptStreamingBehaviorSchema` in
 * `packages/protocol/src/messages.ts`) lets a caller override the
 * daemon's turn-state-derived default for one specific message —
 * `use-composer.ts`'s `promptRouting`/`setPromptRouting` and
 * `PromptRoutingPicker.tsx` are what actually drive it. Omitting it (the
 * default both there and here) changes nothing: the daemon still decides
 * from turn state exactly as this paragraph originally described.
 *
 * Model and thinking-level selection (T28B5, plan.md §11.1's "model and
 * reasoning" RPC group) is the same narrow-adapter treatment applied to
 * `fetch_agent_request`, `list_provider_models_request`,
 * `set_agent_model_request`, and `set_agent_thinking_request` — see the
 * four optional methods near the end of `AgentTurnClient` below and
 * `use-model-thinking.ts`, which is the hook that actually drives them.
 *
 * Composer attachments (T28B6, plan.md §12.4 "files ... use existing
 * daemon RPC and binary frames; the frontend must not directly access
 * laptop paths") reuse the same `file.upload.request`/`file.upload.response`
 * RPC plus binary file-transfer frames `packages/client`'s
 * `DaemonClient.uploadFile` already implements for the file browser's
 * upload path (`packages/client/src/daemon-client.ts`) — see the
 * `uploadFile` optional method below and `use-attachments.ts`, which
 * drives it. A successfully uploaded file becomes an
 * `AgentUploadedAttachment`, shaped to match `UploadedFileAttachmentSchema`
 * (`packages/protocol/src/messages.ts`) exactly so it can be passed
 * straight through as one of `SendAgentMessageOptions.attachments`
 * without a translation step.
 *
 * The steer/follow-up **mode** (T38B1a, plan.md §11.1's "queues and
 * automation" RPC group) is a fourth, separately optional method group
 * (`getQueueModes`/`setSteeringMode`/`setFollowUpMode`/
 * `onQueueModesChange` near the end of `AgentTurnClient` below) — see
 * `QueueMode`'s own doc comment for exactly how it differs from the
 * steer-vs-follow-up choice two paragraphs up. `use-queue-modes.ts` is
 * the hook that drives it, mirroring `use-model-thinking.ts`'s shape.
 */

export interface SendAgentMessageOptions {
  /** Client-provided id for daemon-side deduplication of resends. */
  messageId?: string;
  /**
   * Already-uploaded file attachments (T28B6) to send alongside `text`.
   * Produced by `AgentTurnClient.uploadFile` — never raw `File`/bytes,
   * so a message is only ever submitted once every staged attachment has
   * finished its own upload round trip. A plain (not `readonly`) array,
   * matching `@picompanion/client`'s own `SendMessageOptions.attachments`
   * element type, so a real `DaemonClient` stays structurally assignable
   * to `AgentTurnClient`.
   */
  attachments?: AgentUploadedAttachment[];
  /**
   * Per-message queue routing (T38B1b, `PromptStreamingBehavior` below).
   * `undefined` (the default) preserves today's daemon-decided behaviour
   * exactly — see this file's header comment. An explicit value routes
   * *this one message* as a steer or a follow-up regardless of that
   * default, independent of the session-wide `QueueMode` below.
   */
  streamingBehavior?: PromptStreamingBehavior;
}

/**
 * Per-message routing choice (T38B1b, `PromptStreamingBehaviorSchema` in
 * `packages/protocol/src/messages.ts`, mirrored from Pi's own `prompt` RPC
 * command field). `"steer"` interrupts the running turn; `"followUp"` waits
 * for it to go idle first. This is the choice `QueueMode`'s own doc comment
 * below refers to as "T38B1b's per-message routing" — read that doc comment
 * for exactly how the two compose rather than overlap.
 */
export type PromptStreamingBehavior = "steer" | "followUp";

/**
 * A successfully uploaded file attachment (T28B6), shaped to match
 * `UploadedFileAttachmentSchema` (`packages/protocol/src/messages.ts`)
 * field-for-field — including the literal `type: "uploaded_file"` — so it
 * is directly assignable as one entry of a real `send_agent_message_request`'s
 * `attachments` array without a translation step, the same "matches the
 * wire shape exactly" convention `AgentSlashCommand`/`AgentModelOption`
 * above use.
 */
export interface AgentUploadedAttachment {
  readonly type: "uploaded_file";
  /** Daemon-assigned id for the uploaded file. */
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  /** Daemon-side storage path for this upload; opaque to the client. */
  readonly path: string;
}

/**
 * The Pi provider's two live queues (T28B3, `pi_queue_update` in
 * `packages/protocol/src/messages.ts` / `agent-types.ts`, sourced from
 * `PiAgentSessionEvent`'s `queue_update` in
 * `packages/server/src/server/agent/providers/pi/rpc-types.ts`): entries
 * already accepted by the daemon and waiting either to steer the active
 * turn or to run as a follow-up once it ends. Each entry is the queued
 * message's own text, in queue order — matching the wire shape exactly
 * rather than inventing a count-only projection, so a future renderer
 * can list the queued text if it wants to.
 */
export interface AgentQueueUpdate {
  readonly steering: readonly string[];
  readonly followUp: readonly string[];
}

/**
 * The session-wide steering/follow-up **mode** (T38B1a, `QueueModeSchema` in
 * `packages/protocol/src/messages.ts`, mirroring Pi's `set_steering_mode`/
 * `set_follow_up_mode` RPC commands, plan.md §11.1's "queues and
 * automation" group). `"all"` delivers every message already waiting in a
 * queue together, the next time that queue is drained; `"one-at-a-time"`
 * (the default for both) delivers one per cycle.
 *
 * This is deliberately **not** the same choice as "does this one message
 * steer the running turn or wait behind it" (T38B1b's per-message
 * routing, `PromptStreamingBehaviorSchema`): that choice decides which of
 * the two queues a single message enters; `QueueMode` decides what happens
 * once more than one message is waiting in whichever queue it entered. A
 * session with `steeringMode: "one-at-a-time"` and three steer messages
 * queued still delivers them one at a time even though every one of them
 * was individually routed as "steer" by T38B1b — the two settings compose,
 * they do not overlap.
 */
export type QueueMode = "all" | "one-at-a-time";

/**
 * Both queue modes for one agent (T38B1a, `get_queue_modes_response`'s
 * payload minus its envelope fields). Either field is `null` when the
 * connected provider does not report a mode at all (Pi always does; a
 * future provider without `set_steering_mode`/`set_follow_up_mode` support
 * would not) — distinct from the mode simply being at its default value.
 */
export interface AgentQueueModes {
  readonly steeringMode: QueueMode | null;
  readonly followUpMode: QueueMode | null;
}

/**
 * A single daemon-reported slash command (T28B4, `list_commands_response`'s
 * `commands` entries — `AgentSlashCommandSchema` in
 * `packages/protocol/src/messages.ts`). Matches the wire shape exactly
 * rather than inventing a client-side projection, so the completion list
 * always reflects whatever the connected agent's provider actually
 * supports today (never a hard-coded set baked into this app).
 */
export interface AgentSlashCommand {
  readonly name: string;
  readonly description: string;
  readonly argumentHint: string;
  readonly kind?: "command" | "skill";
}

/**
 * A single reasoning-effort option for a model (T28B5, `AgentSelectOption`
 * in `packages/protocol/src/agent-types.ts`, embedded in
 * `AgentModelDefinition.thinkingOptions`). Matches the wire shape exactly,
 * same convention as `AgentSlashCommand` above.
 */
export interface AgentThinkingOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

/**
 * A single selectable model (T28B5, `AgentModelDefinition` in
 * `packages/protocol/src/agent-types.ts`, sourced from
 * `list_provider_models_response`). `thinkingOptions` is this model's own
 * set — different models under the same provider can support different
 * reasoning levels (or none at all), so the thinking picker is always
 * read relative to whichever model is currently selected.
 */
export interface AgentModelOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
  readonly thinkingOptions?: readonly AgentThinkingOption[];
  readonly defaultThinkingOptionId?: string;
}

/**
 * This agent's live model/thinking state (T28B5, the relevant slice of
 * `AgentSnapshotPayload`: `provider`, `model`, `thinkingOptionId`,
 * `effectiveThinkingOptionId`). `thinkingOptionId` is the caller's own
 * explicit choice (`null` means "use the provider/model default");
 * `effectiveThinkingOptionId` is what the provider is actually applying —
 * they differ whenever no explicit choice has been made, or a model
 * change invalidated the previous explicit choice.
 */
export interface AgentModelSnapshot {
  readonly provider: string;
  readonly modelId: string | null;
  readonly thinkingOptionId: string | null;
  readonly effectiveThinkingOptionId: string | null;
}

/** A provider-sourced notice attached to a model/thinking change response (T28B5, `AgentProviderNotice`). */
export interface AgentProviderNotice {
  readonly type: "info" | "warning" | "error";
  readonly message: string;
}

/**
 * The daemon's own currently-available models for this agent's provider
 * (T28B5, `list_provider_models_response`). `error` explains — rather
 * than silently empties — the picker whenever the provider's model list
 * itself failed to load (plan.md §11.4's "unavailable options are
 * explained" is a picker-level concern this shape feeds directly).
 */
export interface AgentAvailableModels {
  readonly models: readonly AgentModelOption[];
  readonly error: string | null;
}

export interface AgentTurnClient {
  /**
   * Sends text to an agent. Resolves once the daemon accepts the
   * submission (which may be as a new prompt, a mid-turn steer, or a
   * queued follow-up — or, with `options.streamingBehavior` set (T38B1b),
   * whichever of steer/follow-up the caller explicitly chose for this one
   * message); rejects with an `Error` carrying the daemon's raw
   * explanation otherwise.
   */
  sendAgentMessage(agentId: string, text: string, options?: SendAgentMessageOptions): Promise<void>;

  /**
   * Aborts the agent's active turn, if any. Resolves once the daemon
   * acknowledges the cancellation; rejects with an `Error` carrying the
   * daemon's raw explanation otherwise (for example, no turn was
   * running).
   */
  cancelAgent(agentId: string): Promise<void>;

  /**
   * Subscribes to this agent's live queue-depth updates (T28B3).
   * Optional: omitted (or `undefined`) on a client that does not yet
   * support it, in which case the composer's queue display stays at
   * its empty default rather than throwing — the same "no client yet"
   * seam `sendAgentMessage`/`cancelAgent` already use when `client` is
   * altogether unset. Returns an unsubscribe function, matching
   * `terminal.TerminalRpcClient.onTerminalStreamEvent`'s shape
   * (`packages/frontend-core/src/terminal/terminal-controller.ts`) —
   * the existing convention for a live daemon-pushed stream in this
   * codebase.
   */
  onQueueUpdate?(agentId: string, handler: (update: AgentQueueUpdate) => void): () => void;

  /**
   * Lists the slash commands available to this agent right now (T28B4,
   * `list_commands_request`/`list_commands_response` in
   * `packages/protocol/src/messages.ts`). Optional, matching
   * `onQueueUpdate`'s "no client yet" seam: a client that does not
   * implement it simply leaves the composer's completion list empty
   * rather than throwing, and an unrecognized or not-yet-loaded slash
   * command is never rejected client-side — it submits as plain text
   * like any other prompt (`agent-turn-client.ts`'s `sendAgentMessage`
   * does no slash-command validation of its own).
   */
  listCommands?(agentId: string): Promise<readonly AgentSlashCommand[]>;

  /**
   * Reads this agent's current model/thinking state (T28B5,
   * `fetch_agent_request`/`fetch_agent_response`). Optional, matching the
   * rest of this interface's "no client yet" seam: a client that omits it
   * (or the whole four-method model/thinking group below) leaves the
   * picker at its explained "unsupported" state rather than throwing —
   * see `use-model-thinking.ts`. Resolves `null` if the daemon reports no
   * such agent.
   */
  getAgentModelSnapshot?(agentId: string): Promise<AgentModelSnapshot | null>;

  /**
   * Subscribes to this agent's live model/thinking pushes (T28B5, the
   * daemon's `agent_update` event) so a change made by *another* connected
   * client — plan.md §12.3's "web and Android can be live on the same
   * session at once" — is reflected here too, not only this client's own
   * changes. Optional and independent of the other four methods: a client
   * that omits it still gets a correct one-shot snapshot plus its own
   * round-tripped changes, just not a live view of someone else's.
   * Returns an unsubscribe function, matching `onQueueUpdate`'s shape.
   */
  onAgentModelSnapshotChange?(
    agentId: string,
    handler: (snapshot: AgentModelSnapshot) => void,
  ): () => void;

  /**
   * Lists the models currently available for `provider` (T28B5,
   * `list_provider_models_request`/`_response`). Never a hard-coded set —
   * same convention as `listCommands`.
   */
  listAvailableModels?(provider: string): Promise<AgentAvailableModels>;

  /**
   * Changes this agent's model (T28B5, `set_agent_model_request`).
   * Resolves once the daemon accepts the change; rejects with an `Error`
   * carrying its raw explanation otherwise (for example, an unknown model
   * id).
   */
  setAgentModel?(agentId: string, modelId: string): Promise<void>;

  /**
   * Changes this agent's thinking/reasoning level (T28B5,
   * `set_agent_thinking_request`). `thinkingOptionId: null` clears an
   * explicit choice, returning to the provider/model default. Resolves
   * with any provider notice attached to the change (for example, "this
   * model doesn't support that level; falling back to medium"), or
   * `null` when there is none; rejects with an `Error` carrying the
   * daemon's raw explanation when the daemon itself refuses the change.
   */
  setAgentThinkingOption?(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null>;

  /**
   * Uploads one file to the daemon (T28B6, `file.upload.request`/
   * `file.upload.response` plus binary file-transfer frames —
   * `packages/client/src/daemon-client.ts`'s `DaemonClient.uploadFile`).
   * Optional, matching this interface's "no client yet" seam: a client
   * that omits it leaves every attachment attempt in `use-attachments.ts`
   * in its own explained "unsupported" error state rather than throwing.
   * Resolves with the uploaded file's daemon-assigned reference; rejects
   * with an `Error` carrying the daemon's raw explanation for a rejected
   * or oversized upload, or an explicit timeout error if the round trip
   * never completes (`DaemonClient`'s own 60s default RPC timeout) —
   * this is what lets a stalled upload "fail explicitly" per plan.md
   * §12.4/§14.5 instead of hanging forever, while a reconnect that
   * completes before that timeout resolves normally.
   */
  uploadFile?(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    modifiedAt?: string;
  }): Promise<AgentUploadedAttachment>;

  /**
   * Reads both current queue modes (T38B1a, `get_queue_modes_request`/
   * `_response`). Optional, matching this interface's established "no
   * client yet" seam: a client that omits it (or the whole three-method
   * group below) leaves the mode control in its own explained
   * "unsupported" state rather than throwing — see `use-queue-modes.ts`.
   *
   * CORRECTED (P6-W6 merge gate): this said "as of P6-W6 no shipped
   * `DaemonClient` implements this". T110 landed first in that same wave
   * (`5806cff`), so `packages/client/src` now sends all three of
   * `set_steering_mode_request`, `set_follow_up_mode_request` and
   * `get_queue_modes_request`, against wire types (T38B0a) and
   * daemon-side handlers (T38B0c) that have existed since P6-W3.
   * `daemon-agent-turn-client.ts`'s `DaemonTurnClient` adapter wires them
   * through, so this method resolves against a real client. The optional
   * seam remains meaningful for turn clients that omit the trio —
   * `useQueueModes` still renders that absence rather than a control that
   * looks live and silently does nothing.
   */
  getQueueModes?(agentId: string): Promise<AgentQueueModes>;

  /**
   * Changes the session-wide steering mode (T38B1a, `set_steering_mode_request`).
   * Resolves with any provider notice attached to the change (T127, e.g.
   * "this applies from the next turn") — same shape and same "resolves
   * with the notice, or `null` when there is none" contract as
   * `setAgentThinkingOption` above; rejects with an `Error` carrying the
   * daemon's raw explanation when the daemon itself refuses the change.
   *
   * CORRECTED (T127): this returned `Promise<void>` and silently discarded
   * the notice a real `DaemonClient.setSteeringMode` already resolves with
   * (T110). `use-queue-modes.ts`'s `steeringNotice` is what actually
   * renders it now.
   */
  setSteeringMode?(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null>;

  /**
   * Changes the session-wide follow-up mode (T38B1a, `set_follow_up_mode_request`).
   * Same contract as `setSteeringMode` above, including the T127 notice
   * correction; `use-queue-modes.ts`'s `followUpNotice` renders this one.
   */
  setFollowUpMode?(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null>;

  /**
   * Subscribes to a change in either queue mode made by *another*
   * connected client (T38B1a's "reflected here without a manual refresh"
   * acceptance criterion; plan.md §12.3's "agent-global settings have no
   * change event" — the daemon re-reads and re-broadcasts on every
   * change instead, T38B0c). Optional and independent of the three
   * methods above, matching `onAgentModelSnapshotChange`'s own
   * independence from its four-method group: a client can implement this
   * push without also implementing the get/set trio, though in practice
   * `daemon-agent-turn-client.ts`'s adapter provides this one **today**,
   * ahead of T110, because it only needs the daemon's existing
   * `agent_update` push (already real; see that file's doc comment) —
   * `useQueueModes` still gates the whole control's availability on the
   * get/set trio, not on this alone, precisely so a working push can
   * never make an otherwise-inert control look changeable. Returns an
   * unsubscribe function, matching `onQueueUpdate`'s shape.
   */
  onQueueModesChange?(agentId: string, handler: (modes: AgentQueueModes) => void): () => void;
}
