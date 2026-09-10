/**
 * Platform-neutral navigation intents — plan.md §6/§7.1/§8.2/§9, T24.
 *
 * `frontend-core` never owns a router: `apps/web` maps these intents onto
 * TanStack Router routes (plan.md §8.2's `/connect`, `/h/:serverId`, ...
 * route set) and `apps/android` maps them onto Expo Router routes/screens
 * (plan.md §9.1). What lives here is only the shared vocabulary of "where
 * the product can navigate to" plus a pure, platform-neutral history stack
 * reducer, so both apps agree on what a deep link, a back button, and a
 * "open this session" action mean without either one importing the other's
 * router.
 *
 * Every intent is derived from the identifiers plan.md §8.2 already uses
 * for web's route params (`serverId`, `agentId`, `terminalId`, a files
 * `path`), so `navigationIntentToPath` below produces exactly that route
 * shape. Android's Expo Router uses the same segment-based convention
 * (plan.md §9.1), so the same path segments are reusable there too; nothing
 * about this module assumes either concrete router package.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

/** Reaches `/connect` (plan.md §8.2): no host is selected yet. */
export interface ConnectIntent {
  type: "connect";
}

/** Reaches `/h/:serverId`: a host's landing/overview screen. */
export interface HostIntent {
  type: "host";
  serverId: string;
}

/** Reaches `/h/:serverId/sessions`: the session list for one host. */
export interface SessionListIntent {
  type: "sessionList";
  serverId: string;
}

/** Reaches `/h/:serverId/session/:agentId`: one session's transcript/composer view. */
export interface SessionIntent {
  type: "session";
  serverId: string;
  agentId: string;
}

/**
 * Reaches `/h/:serverId/session/:agentId/files/*`: the file browser/editor
 * for one session, optionally scoped to a path within the workspace.
 */
export interface SessionFilesIntent {
  type: "sessionFiles";
  serverId: string;
  agentId: string;
  /** Workspace-relative path segments, e.g. `["src", "index.ts"]`. Empty/absent means the file root. */
  path?: string[];
}

/**
 * Reaches `/h/:serverId/session/:agentId/live`: one session's live
 * activity view — its running subagents, its workflow progress and its
 * context-window usage, plus the way in to that session's files and
 * terminal. A sibling detail route of `sessionFiles`/`sessionTerminal`,
 * not a top-level destination: it is always reached from the session it
 * describes, never as an alternative to the session list.
 */
export interface SessionLiveIntent {
  type: "sessionLive";
  serverId: string;
  agentId: string;
}

/** Reaches `/h/:serverId/session/:agentId/terminal/:terminalId`: one terminal session. */
export interface SessionTerminalIntent {
  type: "sessionTerminal";
  serverId: string;
  agentId: string;
  terminalId: string;
}

/** Reaches `/h/:serverId/settings`. */
export interface SettingsIntent {
  type: "settings";
  serverId: string;
}

/**
 * Pops the current entry off the platform-neutral navigation stack
 * (`NavigationStack.pop`), mirroring a hardware/gesture back action. Not a
 * destination in its own right: `applyNavigationIntent` never pushes a
 * `"back"` entry onto `NavigationState.entries`.
 */
export interface BackIntent {
  type: "back";
}

export type NavigationDestinationIntent =
  | ConnectIntent
  | HostIntent
  | SessionListIntent
  | SessionIntent
  | SessionFilesIntent
  | SessionLiveIntent
  | SessionTerminalIntent
  | SettingsIntent;

export type NavigationIntent = NavigationDestinationIntent | BackIntent;

export type NavigationIntentType = NavigationIntent["type"];
