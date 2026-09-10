/**
 * Build/Plan mode and auto-compaction for one session (T354).
 *
 * Two per-agent daemon settings, one controller, because they load
 * together and are drawn together: the context-ring menu's top row is
 * the mode toggle and its bottom row is the compaction switch next to
 * the context readout, and giving each its own controller would mean
 * two `fetchAgent` round trips and two independent availability states
 * for one panel that is either usable or not.
 *
 * Same shape as `./model-thinking-model.ts` (T39B) deliberately — a
 * plain closure over mutable state returned as a controller object,
 * RN-free so every behaviour below is proven by execution rather than
 * by a source-regex pin, with a narrow structural port a real
 * `DaemonClient` satisfies as-is and no adapter class. Read that
 * module's doc comment for why this repository's Android `-model.ts`
 * convention is a controller and not a React hook.
 *
 * ## The port, named after the real `DaemonClient` methods
 *
 * All five exist on `packages/client/src/daemon-client.ts` under
 * exactly these names, checked against that file rather than assumed:
 * `fetchAgent`, `listProviderModes`, `setAgentMode`,
 * `getAutoCompaction`, `setAutoCompaction`. Every method is optional,
 * so an object implementing none — a lab mount, a test harness, a
 * route with no live connection — still satisfies the interface and
 * lands in the truthful `"no-client"` state rather than an enabled
 * control whose only real outcome is a failure banner.
 *
 * ## Where the mode list comes from
 *
 * `AgentSnapshotPayloadSchema` already carries `availableModes`
 * alongside `currentModeId`, so `load()` prefers the snapshot it has
 * just fetched and only falls back to `listProviderModes(provider)`
 * when the snapshot carries none. One round trip in the common case,
 * and the fallback is there because a provider that reports modes at
 * the provider level but not on the agent snapshot is a shape the
 * schema permits — `availableModes` is optional.
 *
 * ## Why auto-compaction is `boolean | null`
 *
 * `null` means nobody has a truthful answer yet: no client, a load
 * still in flight, or a daemon that refused. It is NOT `false`. The
 * two differ by whether a long session survives its context window,
 * which makes a guessed default the exact kind of confident-and-wrong
 * a switch must never be. Every consumer renders `null` as "unknown",
 * and `../telemetry`'s `buildContextCardViewModel` already omits its
 * auto-compaction clause entirely when handed `undefined`.
 */

/** A single selectable mode — matches `AgentMode` (`packages/protocol/src/agent-types.ts`) field-for-field. */
export interface SessionModeOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/** A provider-sourced notice attached to a change response — matches `AgentProviderNotice` field-for-field. */
export interface SessionControlsNotice {
  readonly type: "info" | "warning" | "error";
  readonly message: string;
}

/** The slice of `AgentSnapshotPayload` this feature reads; a real snapshot carries far more. */
export interface SessionControlsAgentSnapshot {
  readonly provider: string;
  readonly currentModeId?: string | null;
  readonly availableModes?: readonly SessionModeOption[];
}

/** The narrowest slice of `@picompanion/client`'s `DaemonClient` this feature needs — see this module's doc comment. */
export interface DaemonSessionControlsSource {
  /** Matches `DaemonClient.fetchAgent(agentId, requestId?)`. Resolves `null` if the daemon reports no such agent. */
  fetchAgent?(agentId: string): Promise<{ agent: SessionControlsAgentSnapshot } | null>;
  /** Matches `DaemonClient.listProviderModes(provider, options?)`. */
  listProviderModes?(
    provider: string,
  ): Promise<{ modes?: readonly SessionModeOption[]; error?: string | null }>;
  /** Matches `DaemonClient.setAgentMode(agentId, modeId)`. */
  setAgentMode?(agentId: string, modeId: string): Promise<SessionControlsNotice | null>;
  /** Matches `DaemonClient.getAutoCompaction(agentId)`. */
  getAutoCompaction?(agentId: string): Promise<boolean>;
  /** Matches `DaemonClient.setAutoCompaction(agentId, enabled)`. */
  setAutoCompaction?(agentId: string, enabled: boolean): Promise<SessionControlsNotice | null>;
}

const REQUIRED_METHODS = [
  "fetchAgent",
  "listProviderModes",
  "setAgentMode",
  "getAutoCompaction",
  "setAutoCompaction",
] as const;

/** `true` only when every one of the five methods above is present. */
export function supportsSessionControls(client: DaemonSessionControlsSource | undefined): boolean {
  if (!client) return false;
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export type SessionControlsAvailability =
  | "no-client"
  | "unsupported"
  | "loading"
  | "ready"
  | "error";

/**
 * The truthful, user-facing sentence for a non-`"ready"` availability —
 * never "Something went wrong", always naming why. `"error"`'s `reason`
 * is the daemon's own raw explanation, so it is passed through rather
 * than replaced.
 */
export function describeSessionControlsUnavailable(
  availability: Exclude<SessionControlsAvailability, "loading" | "ready">,
  reason?: string | null,
): string {
  if (availability === "no-client") {
    return "Connect to a daemon to change the mode or auto-compaction.";
  }
  if (availability === "unsupported") {
    return "This connection can't change the mode or auto-compaction.";
  }
  return reason ?? "Couldn't load the mode and auto-compaction settings.";
}

export interface SessionControlsState {
  readonly availability: SessionControlsAvailability;
  /** Human explanation for a non-`"ready"` availability, or `null` once ready. */
  readonly unavailableReason: string | null;
  /** This agent's provider, or `null` before the first snapshot loads. */
  readonly provider: string | null;
  /** Every mode this agent can be switched to. */
  readonly modes: readonly SessionModeOption[];
  /** The mode the agent is in, or `null` if the provider reports none. */
  readonly currentModeId: string | null;
  /** Explains — rather than silently empties — the mode list when the fallback lookup failed. */
  readonly modesError: string | null;
  /** `true` while a `setMode` call is in flight. */
  readonly isChangingMode: boolean;
  /** `true`/`false` once known; `null` means nobody has a truthful answer — see this module's doc comment. */
  readonly autoCompaction: boolean | null;
  /** `true` while a `setAutoCompaction` call is in flight. */
  readonly isChangingAutoCompaction: boolean;
  /** The most recent change failure, or `null`. Cleared at the start of the next call. */
  readonly changeError: string | null;
  /** A provider notice attached to the most recent successful change, or `null`. */
  readonly notice: SessionControlsNotice | null;
}

export const INITIAL_SESSION_CONTROLS_STATE: SessionControlsState = {
  availability: "no-client",
  unavailableReason: describeSessionControlsUnavailable("no-client"),
  provider: null,
  modes: [],
  currentModeId: null,
  modesError: null,
  isChangingMode: false,
  autoCompaction: null,
  isChangingAutoCompaction: false,
  changeError: null,
  notice: null,
};

/**
 * Display text for the current mode — derivable from `state` alone, so
 * "the current selection is visible without opening anything" is
 * provable without a render.
 */
export function currentModeLabel(state: SessionControlsState): string {
  if (!state.currentModeId) return "Default";
  return state.modes.find((mode) => mode.id === state.currentModeId)?.label ?? state.currentModeId;
}

/** The switch's own visible words. `null` is a third state, never rendered as "Off". */
export function describeAutoCompaction(autoCompaction: boolean | null): string {
  if (autoCompaction === null) return "Auto-compaction: unknown";
  return autoCompaction ? "Auto-compaction on" : "Auto-compaction off";
}

export interface SessionControlsControllerDeps {
  /** Conversation target this controller reads/changes (session or agent id). */
  agentId: string;
  /** Live client; every method on it is itself optional — see this module's doc comment. */
  client?: DaemonSessionControlsSource;
}

export interface SessionControlsController {
  getState(): SessionControlsState;
  /**
   * Loads this agent's live snapshot (provider, current mode, modes),
   * then its auto-compaction setting. Safe to call again — always
   * re-fetches rather than trusting a stale cached value.
   */
  load(): Promise<void>;
  /** Switches this agent's mode. No-op while not ready or another mode change is in flight. */
  setMode(modeId: string): Promise<void>;
  /** Turns auto-compaction on or off. No-op while not ready or another compaction change is in flight. */
  setAutoCompaction(enabled: boolean): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSessionControlsController(
  deps: SessionControlsControllerDeps,
): SessionControlsController {
  const { agentId, client } = deps;

  let state: SessionControlsState = INITIAL_SESSION_CONTROLS_STATE;

  async function resolveModes(
    provider: string,
    fromSnapshot: readonly SessionModeOption[] | undefined,
  ): Promise<{ modes: readonly SessionModeOption[]; modesError: string | null }> {
    // The snapshot's own list wins: it is this agent's real mode
    // vocabulary and it has already been fetched. `listProviderModes`
    // is the fallback for a provider that reports modes only at the
    // provider level, which the schema permits.
    if (fromSnapshot && fromSnapshot.length > 0) {
      return { modes: fromSnapshot, modesError: null };
    }
    if (!client?.listProviderModes) {
      return { modes: [], modesError: null };
    }
    try {
      const result = await client.listProviderModes(provider);
      return { modes: result.modes ?? [], modesError: result.error ?? null };
    } catch (error) {
      return { modes: [], modesError: toMessage(error) };
    }
  }

  async function loadAutoCompaction(): Promise<boolean | null> {
    if (!client?.getAutoCompaction) return null;
    try {
      return await client.getAutoCompaction(agentId);
    } catch {
      // A refused read leaves the switch at "unknown" — never at a
      // guessed "off", which would invite a user to turn on something
      // that may already be on.
      return null;
    }
  }

  async function load(): Promise<void> {
    if (!client) {
      state = { ...INITIAL_SESSION_CONTROLS_STATE };
      return;
    }
    if (!supportsSessionControls(client)) {
      state = {
        ...INITIAL_SESSION_CONTROLS_STATE,
        availability: "unsupported",
        unavailableReason: describeSessionControlsUnavailable("unsupported"),
      };
      return;
    }

    state = { ...state, availability: "loading", unavailableReason: null };
    let snapshot: SessionControlsAgentSnapshot;
    try {
      const result = await client.fetchAgent!(agentId);
      if (!result) {
        state = {
          ...state,
          availability: "error",
          unavailableReason: describeSessionControlsUnavailable(
            "error",
            `Agent not found: ${agentId}`,
          ),
        };
        return;
      }
      snapshot = result.agent;
    } catch (error) {
      state = {
        ...state,
        availability: "error",
        unavailableReason: describeSessionControlsUnavailable("error", toMessage(error)),
      };
      return;
    }

    const { modes, modesError } = await resolveModes(snapshot.provider, snapshot.availableModes);
    const autoCompaction = await loadAutoCompaction();

    state = {
      ...state,
      availability: "ready",
      unavailableReason: null,
      provider: snapshot.provider,
      modes,
      currentModeId: snapshot.currentModeId ?? null,
      modesError,
      autoCompaction,
    };
  }

  async function setMode(modeId: string): Promise<void> {
    if (state.availability !== "ready" || state.isChangingMode) return;
    if (!client?.setAgentMode) return;

    state = { ...state, isChangingMode: true, changeError: null, notice: null };
    try {
      const notice = await client.setAgentMode(agentId, modeId);
      // Reflect the daemon's answer, not the request: a provider is
      // free to refuse or to land somewhere else, and a control that
      // shows what was asked for rather than what happened is a control
      // that lies exactly when it matters.
      state = { ...state, isChangingMode: false, notice: notice ?? null };
      await load();
    } catch (error) {
      state = { ...state, isChangingMode: false, changeError: toMessage(error) };
    }
  }

  async function setAutoCompaction(enabled: boolean): Promise<void> {
    if (state.availability !== "ready" || state.isChangingAutoCompaction) return;
    if (!client?.setAutoCompaction) return;

    state = { ...state, isChangingAutoCompaction: true, changeError: null, notice: null };
    try {
      const notice = await client.setAutoCompaction(agentId, enabled);
      const confirmed = await loadAutoCompaction();
      state = {
        ...state,
        isChangingAutoCompaction: false,
        notice: notice ?? null,
        // Read back rather than assume: `confirmed` is what the daemon
        // now reports, and `null` (a refused read) is shown as unknown
        // rather than as the value that was requested.
        autoCompaction: confirmed,
      };
    } catch (error) {
      state = { ...state, isChangingAutoCompaction: false, changeError: toMessage(error) };
    }
  }

  return {
    getState: () => state,
    load,
    setMode,
    setAutoCompaction,
  };
}
