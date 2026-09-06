/**
 * Session-wide steer/follow-up queue-mode control for the Android
 * compact composer (T39C, plan.md §11.1's "queues and automation" RPC
 * group). Mirrors the shape of web's T38B1a counterpart
 * (`apps/web/src/features/composer/use-queue-modes.ts` and
 * `QueueModePicker.tsx`) — same five-state availability, same "reflect
 * the daemon's post-change snapshot rather than guess" rule, same
 * carried-through provider notice (T127) — but nothing here is copied
 * from that file: same RN-free `-model.ts` convention `./model-thinking-model.ts`
 * (T39B) established for this workspace (`vitest` cannot render anything
 * that reaches `react-native`, the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times), so every
 * behavioural claim below is plain data plus pure/async functions,
 * independent of `useState`/React. `QueueModePicker.tsx` is the thin
 * view that mirrors this controller's `getState()` into `useState` after
 * each call.
 *
 * ## Not the same thing as `composer-model.ts`'s `QueueDispatchMode`
 *
 * `composer-model.ts` (T33B3) already has a "queue mode" concept —
 * `QueueDispatchMode = "steer" | "follow-up"` and its `QUEUE_MODE_LABEL`
 * chip — but that is the PER-MESSAGE routing choice (mirrors web's
 * T38B1b `PromptStreamingBehavior`): which of the two queues *this one
 * message* enters. The `QueueMode` this file defines is the
 * SESSION-WIDE setting (mirrors web's T38B1a `QueueMode`): once more
 * than one message is waiting in whichever queue it entered, does the
 * provider deliver them `"all"` together or `"one-at-a-time"`? The two
 * compose, they do not overlap — see `AgentQueueModes`'s own doc comment
 * below for the same distinction web's `agent-turn-client.ts` states.
 *
 * ## The port: `DaemonQueueModeSource` — named after the REAL
 * `DaemonClient` methods (`packages/client/src/daemon-client.ts`)
 *
 *  - `getQueueModes(agentId): Promise<{ steeringMode: QueueMode | null;
 *    followUpMode: QueueMode | null }>` (`:3416`) — reads both modes
 *    fresh off the live provider session; no `accepted` envelope field,
 *    only `error`.
 *  - `setSteeringMode(agentId, mode): Promise<AgentProviderNotice |
 *    null>` (`:3352`) and `setFollowUpMode(agentId, mode): Promise<AgentProviderNotice |
 *    null>` (`:3381`) — both T110, both landed with `AgentActionResponsePayloadSchema`'s
 *    `accepted`/`error`/`notice` envelope, so the real client's return
 *    type carries a provider notice, never bare `Promise<void>`. (Web's
 *    own `AgentTurnClient` typed these `Promise<void>` at T38B1a and had
 *    to correct it at T127 once a built `dist` surfaced the mismatch as
 *    13 `TS2345` errors — see `CLAUDE.md`'s "A package boundary hides a
 *    type mismatch". `DaemonQueueModeSource` below is typed against the
 *    real signature from the start, so there is no adapter step to get
 *    wrong.)
 *
 * All three exist and are real, wire-connected methods as of T110
 * (`5806cff`). `DaemonQueueModeSource` names its three methods
 * identically to `DaemonClient`'s real ones, narrowed to only the
 * arguments this feature passes, so a real `DaemonClient` satisfies it
 * AS-IS — same convention `model-thinking-model.ts`'s
 * `DaemonModelThinkingSource` uses. Every method is OPTIONAL, so an
 * object implementing none of them (still a real, reachable shape for
 * any host that omits `client` — a test harness, or a build with no
 * connection at all) still structurally satisfies this interface.
 * **T132** wires the real thing: `../app-shell/session-route-daemon-clients.ts`'s
 * `resolveQueueModeClient` reads
 * `AppCore.connection.getActiveLifecycle()?.getDaemonClient()` (live
 * since T32A1B) and passes it as `Composer`'s `queueModeClient` prop, so
 * the production route now reaches `"ready"` once a real daemon
 * connection is active — `"no-client"` is no longer the only shape a
 * real build can produce, only the honest one before a connection
 * exists.
 *
 * This file deliberately carries no `onQueueModesChange`-equivalent live
 * push subscription. Web's T38B1a added one because plan.md §12.3
 * requires a session-wide setting to stay live across two browser tabs
 * on the same daemon; T39C's own acceptance criteria ask only for a
 * round trip through an injected port, not a live-reflection guarantee,
 * and `model-thinking-model.ts` (T39B) set the Android precedent of
 * omitting that layer too. If a future task wires a live client and
 * wants cross-client reflection, extending this controller with a
 * fourth optional method mirroring web's `onQueueModesChange` (sourced,
 * there, from the daemon's `agent_update` push reading
 * `runtimeInfo.extra.steeringMode`/`.followUpMode`) is the seam to use.
 */

/** The session-wide steering/follow-up **mode** — see this module's doc comment for how it differs from `composer-model.ts`'s per-message `QueueDispatchMode`. `"all"` delivers every message already waiting in a queue together, the next time that queue drains; `"one-at-a-time"` (the default for both) delivers one per cycle. */
export type QueueMode = "all" | "one-at-a-time";

/** A provider-sourced notice attached to a change response — matches `AgentProviderNotice` field-for-field. */
export interface QueueModeProviderNotice {
  readonly type: "info" | "warning" | "error";
  readonly message: string;
}

/**
 * Both queue modes for one agent — matches `get_queue_modes_response`'s
 * payload minus its envelope fields, field-for-field. Either field is
 * `null` when the connected provider reports no mode at all (Pi always
 * does), distinct from the mode simply being at its default value.
 */
export interface AgentQueueModes {
  readonly steeringMode: QueueMode | null;
  readonly followUpMode: QueueMode | null;
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * feature needs — see this module's doc comment. A real `DaemonClient`
 * satisfies this as-is (wired at the production route since T132); every
 * method is optional so an object implementing none of them (no
 * connection yet, or a test harness) still does too.
 */
export interface DaemonQueueModeSource {
  /** Matches `DaemonClient.getQueueModes(agentId)`. */
  getQueueModes?(agentId: string): Promise<AgentQueueModes>;
  /** Matches `DaemonClient.setSteeringMode(agentId, mode)` — resolves with any provider notice, never bare `void`. */
  setSteeringMode?(agentId: string, mode: QueueMode): Promise<QueueModeProviderNotice | null>;
  /** Matches `DaemonClient.setFollowUpMode(agentId, mode)`. Same contract as `setSteeringMode`. */
  setFollowUpMode?(agentId: string, mode: QueueMode): Promise<QueueModeProviderNotice | null>;
}

const REQUIRED_METHODS = ["getQueueModes", "setSteeringMode", "setFollowUpMode"] as const;

/** `true` only when every one of the three methods above is present. */
export function supportsQueueModes(client: DaemonQueueModeSource | undefined): boolean {
  if (!client) return false;
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export type QueueModesAvailability = "no-client" | "unsupported" | "loading" | "ready" | "error";

/**
 * The truthful, user-facing sentence for a non-`"ready"` availability —
 * never "Something went wrong", always naming why. `"error"`'s `reason`
 * is the daemon's own raw explanation, passed through rather than
 * replaced.
 */
export function describeQueueModesUnavailable(
  availability: Exclude<QueueModesAvailability, "loading" | "ready">,
  reason?: string | null,
): string {
  if (availability === "no-client") {
    return "Connect to a daemon to change the steer/follow-up mode.";
  }
  if (availability === "unsupported") {
    return "This connection can't change the steer/follow-up mode.";
  }
  return reason ?? "Couldn't load the steer/follow-up mode.";
}

export interface QueueModesState {
  readonly availability: QueueModesAvailability;
  /** Human explanation for a non-`"ready"` availability, or `null` once ready. */
  readonly unavailableReason: string | null;
  /** The session-wide steering-queue mode, or `null` if the provider reports none. */
  readonly steeringMode: QueueMode | null;
  /** The session-wide follow-up-queue mode, or `null` if the provider reports none. */
  readonly followUpMode: QueueMode | null;
  /** `true` while a `setSteeringMode` call is in flight. */
  readonly isChangingSteeringMode: boolean;
  /** `true` while a `setFollowUpMode` call is in flight. */
  readonly isChangingFollowUpMode: boolean;
  /** The most recent change failure, or `null`. Cleared at the start of the next call. */
  readonly changeError: string | null;
  /** A provider notice attached to the most recent successful `setSteeringMode` call, or `null`. */
  readonly steeringNotice: QueueModeProviderNotice | null;
  /** Same as `steeringNotice`, for the most recent successful `setFollowUpMode` call. */
  readonly followUpNotice: QueueModeProviderNotice | null;
}

export const INITIAL_QUEUE_MODES_STATE: QueueModesState = {
  availability: "no-client",
  unavailableReason: describeQueueModesUnavailable("no-client"),
  steeringMode: null,
  followUpMode: null,
  isChangingSteeringMode: false,
  isChangingFollowUpMode: false,
  changeError: null,
  steeringNotice: null,
  followUpNotice: null,
};

/**
 * Display text for one queue mode — proves "the current value is
 * visible without opening a menu" without needing a render: derivable
 * from `state` alone.
 */
export function queueModeLabel(mode: QueueMode | null): string {
  if (mode === "all") return "All together";
  if (mode === "one-at-a-time") return "One at a time";
  return "Not reported";
}

export interface QueueModesControllerDeps {
  /** Conversation target this controller reads/changes (session or agent id). */
  agentId: string;
  /** Live turn-control client; every method on it is itself optional — see this module's doc comment. */
  client?: DaemonQueueModeSource;
}

export interface QueueModesController {
  getState(): QueueModesState;
  /** Loads both current modes. Safe to call again — always re-fetches rather than trusting a stale cached value. */
  load(): Promise<void>;
  /** Changes the steering mode. No-op while unsupported or another change is already in flight. */
  setSteeringMode(mode: QueueMode): Promise<void>;
  /** Changes the follow-up mode. Same guards as `setSteeringMode`. */
  setFollowUpMode(mode: QueueMode): Promise<void>;
}

/**
 * Builds a `QueueModesController`. One instance per composer/agent
 * surface — mirrors `createModelThinkingController`'s shape exactly: a
 * plain closure over mutable state, no React, driven entirely by its
 * returned methods.
 */
export function createQueueModesController(deps: QueueModesControllerDeps): QueueModesController {
  const { agentId, client } = deps;

  let state: QueueModesState = INITIAL_QUEUE_MODES_STATE;

  function toString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function load(): Promise<void> {
    if (!client) {
      state = {
        ...INITIAL_QUEUE_MODES_STATE,
        availability: "no-client",
        unavailableReason: describeQueueModesUnavailable("no-client"),
      };
      return;
    }
    if (!supportsQueueModes(client)) {
      state = {
        ...INITIAL_QUEUE_MODES_STATE,
        availability: "unsupported",
        unavailableReason: describeQueueModesUnavailable("unsupported"),
      };
      return;
    }

    state = { ...state, availability: "loading", unavailableReason: null };
    try {
      const modes = await client.getQueueModes!(agentId);
      state = {
        ...state,
        availability: "ready",
        unavailableReason: null,
        steeringMode: modes.steeringMode,
        followUpMode: modes.followUpMode,
      };
    } catch (error) {
      state = {
        ...state,
        availability: "error",
        unavailableReason: describeQueueModesUnavailable("error", toString(error)),
      };
    }
  }

  // Re-fetches the authoritative snapshot rather than guessing the
  // result locally, same rationale as `model-thinking-model.ts`'s
  // `refreshSnapshot`.
  async function refreshModes(): Promise<void> {
    if (!client?.getQueueModes) return;
    const modes = await client.getQueueModes(agentId);
    state = { ...state, steeringMode: modes.steeringMode, followUpMode: modes.followUpMode };
  }

  async function setSteeringMode(mode: QueueMode): Promise<void> {
    if (!client?.setSteeringMode || state.isChangingSteeringMode || state.isChangingFollowUpMode) {
      return;
    }
    state = { ...state, isChangingSteeringMode: true, changeError: null, steeringNotice: null };
    try {
      const notice = await client.setSteeringMode(agentId, mode);
      state = { ...state, steeringNotice: notice };
      await refreshModes();
    } catch (error) {
      state = { ...state, changeError: toString(error) };
    } finally {
      state = { ...state, isChangingSteeringMode: false };
    }
  }

  async function setFollowUpMode(mode: QueueMode): Promise<void> {
    if (!client?.setFollowUpMode || state.isChangingSteeringMode || state.isChangingFollowUpMode) {
      return;
    }
    state = { ...state, isChangingFollowUpMode: true, changeError: null, followUpNotice: null };
    try {
      const notice = await client.setFollowUpMode(agentId, mode);
      state = { ...state, followUpNotice: notice };
      await refreshModes();
    } catch (error) {
      state = { ...state, changeError: toString(error) };
    } finally {
      state = { ...state, isChangingFollowUpMode: false };
    }
  }

  return {
    getState: () => state,
    load,
    setSteeringMode,
    setFollowUpMode,
  };
}
