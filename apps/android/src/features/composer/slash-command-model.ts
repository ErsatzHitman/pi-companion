/**
 * Slash-command completion for the Android compact composer (T292,
 * plan.md §11.1's "commands and slash-command completion" RPC group,
 * the owner's own request — see this task's section in
 * `docs/issues-from-plan.md`). Mirrors the shape of web's T28B4
 * counterpart (`apps/web/src/features/composer/use-slash-commands.ts`
 * and its `CommandSearch` recipe mount in `Composer.tsx`) — same "list
 * comes from the daemon, never hard-coded" rule, same bare-`/`-prefix
 * auto-open rule, same "never blocks a send" rule — but nothing here is
 * copied from that file: web is a `useState`/`useEffect` React hook;
 * this repository's established Android convention for a `-model.ts` is
 * a plain closure over mutable state returned as a controller object
 * (`createModelThinkingController`, `./model-thinking-model.ts`;
 * `createQueueModesController`, `./queue-mode-model.ts`), not a React
 * hook. RN-free, like every other `-model.ts` in this workspace:
 * `vitest` cannot render anything that reaches `react-native` (the
 * RolldownError on `node_modules/react-native/index.js:1:0`, proven
 * 27+ times across this codebase), so every behavioural claim below is
 * plain data and pure/async functions, independent of `useState`/React.
 * `SlashCommandPicker.tsx` is the thin view that mirrors this
 * controller's `getState()` into `useState` after each call, and
 * `Composer.tsx` is what calls `notifyDraftChanged` on every keystroke
 * and `load()` once per (client, agentId) identity.
 *
 * ## The port: `DaemonSlashCommandSource` — named after the REAL
 * `DaemonClient` method (`packages/client/src/daemon-client.ts`)
 *
 * `listCommands(agentId, requestId?): Promise<ListCommandsPayload>`
 * (`packages/client/src/daemon-client.ts`) resolves
 * `{ agentId, commands, error, requestId }` — `commands` is an array of
 * `AgentSlashCommandSchema` (`packages/protocol/src/messages.ts`)
 * entries, sourced from Pi's own `get_commands` RPC
 * (`packages/server/src/server/agent/providers/pi/agent.ts`'s
 * `commandsRpcName`/`runtimeSession.getCommands()`) — never a
 * hard-coded set: the owner has 39 Pi extensions installed today and
 * adds more, so a frozen list would go stale the moment a new one
 * lands. `DaemonSlashCommandSource` below names its one method
 * identically to `DaemonClient`'s real one, narrowed to only the
 * fields this feature reads (extra fields on the real payload —
 * `agentId`, `requestId` — are ignored), so a real `DaemonClient`
 * satisfies it AS-IS — no adapter class needed, same convention
 * `model-thinking-model.ts`'s `DaemonModelThinkingSource` and
 * `queue-mode-model.ts`'s `DaemonQueueModeSource` both use. The method
 * is OPTIONAL, so an object implementing neither it (no live
 * connection yet — the shape every test harness and a disconnected
 * build produce) still structurally satisfies this interface, and
 * `commands` simply stays at its empty default rather than throwing —
 * the same "no client yet" seam `onQueueUpdate`/`getQueueModes` already
 * use on their own ports.
 *
 * ## Deliberately NOT the same shape as `model-thinking-model.ts`/
 * `queue-mode-model.ts`'s five-state `"no-client"`/`"unsupported"`/
 * `"loading"`/`"ready"`/`"error"` availability machine
 *
 * Those two features are settings surfaces the user deliberately opens
 * (a Select), so an explained unavailable state is the right,
 * non-misleading thing to show while nothing is wired. A slash-command
 * palette is a live-typing completion aid: web's own `useSlashCommands`
 * carries no such availability enum at all, just `commands` (empty
 * until resolved, and staying empty forever for a client that omits
 * `listCommands`), `isOpen`, and `error` — reusing the same shape here
 * is the direct instruction in this task's brief ("follow web's model
 * rather than inventing one"), not an oversight relative to the other
 * two Android pickers in this directory.
 *
 * ## The trigger rule (identical to web's `isBareSlashPrefix`)
 *
 * The palette opens automatically the instant the whole draft is `/`
 * followed by a space-free token — i.e. before the user has started
 * typing a command's arguments — and can also be opened manually via
 * `open()` for discoverability, matching plan.md §10.5's "keyboard/tap
 * operable without relying on typing a magic character" spirit. Once a
 * user explicitly `dismiss()`es an auto-triggered palette, it stays
 * dismissed for as long as the draft keeps looking like the SAME bare
 * slash prefix (so one Escape/close tap does not get immediately
 * fought by the next keystroke); leaving that shape entirely (clearing
 * the draft, or typing a space to start an argument) and re-entering it
 * is a fresh trigger. See `use-slash-commands.test.ts`'s own test of the
 * identical rule for the scenarios this mirrors.
 *
 * ## It never blocks a send
 *
 * There is no `select`/`validate` step here that a send goes through —
 * `Composer.tsx`'s `handleSend`/`submitDraft` never reads this
 * controller's state at all. An unrecognized (or not-yet-loaded) slash
 * command is simply text that gets sent like any other prompt, exactly
 * like web's own `sendAgentMessage` does no client-side command
 * validation. Selecting a command from the palette only ever *replaces
 * the draft text*, via `Composer.tsx`'s own `handleSelectSlashCommand`
 * — it never calls `onSubmit` itself, so dismissing or ignoring the
 * palette can never swallow or block a submission the user makes some
 * other way.
 */

/** A single daemon-reported slash command — matches `AgentSlashCommandSchema` (`packages/protocol/src/messages.ts`) field-for-field, same convention as `ModelThinkingModelOption` in `model-thinking-model.ts`. */
export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly argumentHint: string;
  readonly kind?: "command" | "skill";
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * feature needs — see this module's doc comment. A real `DaemonClient`
 * satisfies this as-is; the method is optional so an object
 * implementing none of it (today's shape for every test harness and a
 * build with no active connection) still does too.
 */
export interface DaemonSlashCommandSource {
  /** Matches `DaemonClient.listCommands(agentId, requestId?)`, narrowed to the two fields this feature reads off the payload. */
  listCommands?(
    agentId: string,
  ): Promise<{ commands: readonly SlashCommand[]; error?: string | null }>;
}

export interface SlashCommandsState {
  /** Every command the daemon reported for this agent; empty until resolved (or unsupported/no client). */
  readonly commands: readonly SlashCommand[];
  /** `true` while the palette should be shown. */
  readonly isOpen: boolean;
  /** The most recent `listCommands` failure (either a rejected call, or the payload's own `error` field), or `null`. */
  readonly error: string | null;
}

export const INITIAL_SLASH_COMMANDS_STATE: SlashCommandsState = {
  commands: [],
  isOpen: false,
  error: null,
};

/** True exactly while the whole draft is `/` followed by a space-free token — identical rule to web's own (private, unexported) `isBareSlashPrefix` in `use-slash-commands.ts`. */
export function isBareSlashPrefix(draftText: string): boolean {
  return /^\/\S*$/.test(draftText);
}

/** The text a selected command replaces the draft with — `/name ` (trailing space so the user can start typing an argument immediately), matching web's `selectSlashCommand`'s `` `${item.label} ` ``. */
export function slashCommandDraftText(command: SlashCommand): string {
  return `/${command.name} `;
}

/** One-line description for a command row — argument hint appended when present, "· skill" suffix when this command came from a Pi skill rather than a plain command, mirroring web's `toCommandSearchItem`'s identical derivation. */
export function describeSlashCommand(command: SlashCommand): string {
  const description = command.argumentHint
    ? `${command.description} ${command.argumentHint}`
    : command.description;
  return command.kind === "skill" ? `${description} · skill` : description;
}

export interface SlashCommandsControllerDeps {
  /** Conversation target this controller lists commands for (session or agent id). */
  agentId: string;
  /** Live turn-control client; its one method is itself optional — see this module's doc comment. */
  client?: DaemonSlashCommandSource;
}

export interface SlashCommandsController {
  getState(): SlashCommandsState;
  /**
   * Loads this agent's live command list. Safe to call again (e.g. when
   * `agentId`/`client` changes) — always re-fetches rather than
   * trusting a stale cached value, matching every sibling controller in
   * this directory. A client that omits `listCommands` (or a call that
   * rejects) leaves `commands` at `[]` rather than throwing.
   */
  load(): Promise<void>;
  /**
   * Tells the controller the composer's draft text just changed —
   * `Composer.tsx` calls this from the same `handleValueChange` that
   * updates `state.draft`. Recomputes the auto-open trigger and clears
   * a stale dismissal once the draft leaves the bare-slash-prefix shape
   * (see this module's doc comment for the exact rule); never itself
   * mutates the draft.
   */
  notifyDraftChanged(draftText: string): void;
  /** Opens the palette manually, independent of what is currently typed. */
  open(): void;
  /** Closes the palette without changing the draft or touching `onSubmit` in any way. */
  dismiss(): void;
}

/**
 * Builds a `SlashCommandsController`. One instance per composer/agent
 * surface — mirrors `createQueueModesController`'s shape exactly: a
 * plain closure over mutable state, no React, driven entirely by its
 * returned methods.
 */
export function createSlashCommandsController(
  deps: SlashCommandsControllerDeps,
): SlashCommandsController {
  const { agentId, client } = deps;

  let commands: readonly SlashCommand[] = [];
  let error: string | null = null;
  let manuallyOpen = false;
  let dismissed = false;
  let autoTrigger = false;

  function toString(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  function computeIsOpen(): boolean {
    return commands.length > 0 && ((autoTrigger && !dismissed) || manuallyOpen);
  }

  function getState(): SlashCommandsState {
    return { commands, isOpen: computeIsOpen(), error };
  }

  async function load(): Promise<void> {
    commands = [];
    error = null;
    if (!client?.listCommands) return;
    try {
      const result = await client.listCommands(agentId);
      commands = result.commands;
      error = result.error ?? null;
    } catch (cause) {
      commands = [];
      error = toString(cause);
    }
  }

  function notifyDraftChanged(draftText: string): void {
    const nextAutoTrigger = isBareSlashPrefix(draftText);
    // Once the draft no longer looks like a bare "/command" prefix,
    // forget any earlier dismissal so typing "/" again re-opens the
    // palette — identical rule to web's own effect on `autoTrigger`.
    if (!nextAutoTrigger) dismissed = false;
    autoTrigger = nextAutoTrigger;
  }

  function open(): void {
    manuallyOpen = true;
    dismissed = false;
  }

  function dismiss(): void {
    manuallyOpen = false;
    dismissed = true;
  }

  return { getState, load, notifyDraftChanged, open, dismiss };
}
