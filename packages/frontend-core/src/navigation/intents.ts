/**
 * Navigation intent helpers and history stack — plan.md §6/§7.1/§8.2, T24.
 *
 * See `types.ts` for why this module exists instead of a shared router.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
import type { NavigationDestinationIntent, NavigationIntent } from "./types.js";

/**
 * A stable, deduplication-friendly key for one destination intent. Two
 * intents that would resolve to the same route produce the same key,
 * regardless of object identity — used by `NavigationStack` to collapse a
 * repeated "navigate to the screen I'm already on" call into a no-op
 * instead of growing the stack.
 */
export function navigationIntentKey(intent: NavigationDestinationIntent): string {
  switch (intent.type) {
    case "connect":
      return "connect";
    case "host":
      return `host:${intent.serverId}`;
    case "sessionList":
      return `sessionList:${intent.serverId}`;
    case "session":
      return `session:${intent.serverId}:${intent.agentId}`;
    case "sessionFiles":
      // Deliberately excludes `path`: moving between file paths within the
      // same session's file browser replaces the current stack entry in
      // place (see `applyNavigationIntent`) rather than growing the stack
      // one entry per file visited.
      return `sessionFiles:${intent.serverId}:${intent.agentId}`;
    case "sessionLive":
      return `sessionLive:${intent.serverId}:${intent.agentId}`;
    case "sessionTerminal":
      return `sessionTerminal:${intent.serverId}:${intent.agentId}:${intent.terminalId}`;
    case "settings":
      return `settings:${intent.serverId}`;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Renders a destination intent as the plan.md §8.2 web route path (also
 * reusable as Android's Expo Router segment path — see `types.ts`).
 * Never includes a query string: plan.md §12.1 requires private material
 * (bearer tokens, passwords) to never appear in a URL query, and nothing
 * in `NavigationDestinationIntent` carries any.
 */
export function navigationIntentToPath(intent: NavigationDestinationIntent): string {
  switch (intent.type) {
    case "connect":
      return "/connect";
    case "host":
      return `/h/${encodeSegment(intent.serverId)}`;
    case "sessionList":
      return `/h/${encodeSegment(intent.serverId)}/sessions`;
    case "session":
      return `/h/${encodeSegment(intent.serverId)}/session/${encodeSegment(intent.agentId)}`;
    case "sessionFiles": {
      const base = `/h/${encodeSegment(intent.serverId)}/session/${encodeSegment(intent.agentId)}/files`;
      const path = intent.path ?? [];
      return path.length === 0 ? `${base}/` : `${base}/${path.map(encodeSegment).join("/")}`;
    }
    case "sessionLive":
      return `/h/${encodeSegment(intent.serverId)}/session/${encodeSegment(intent.agentId)}/live`;
    case "sessionTerminal":
      return `/h/${encodeSegment(intent.serverId)}/session/${encodeSegment(intent.agentId)}/terminal/${encodeSegment(intent.terminalId)}`;
    case "settings":
      return `/h/${encodeSegment(intent.serverId)}/settings`;
  }
}

export interface NavigationState {
  /** Oldest first; `entries[entries.length - 1]` is the current screen. Never empty once initialized. */
  entries: NavigationDestinationIntent[];
}

/** The stack's single entry point on cold start, matching plan.md §8.2's `/connect`. */
export function createInitialNavigationState(
  initial: NavigationDestinationIntent = { type: "connect" },
): NavigationState {
  return { entries: [initial] };
}

export function currentNavigationIntent(
  state: NavigationState,
): NavigationDestinationIntent | undefined {
  return state.entries[state.entries.length - 1];
}

/**
 * Pure reducer over `NavigationState`. `"back"` pops the current entry
 * (a no-op at the root, matching how a platform back gesture at the root
 * screen exits the app rather than navigating anywhere) — every other
 * intent type pushes, unless it re-targets the current top-of-stack entry
 * (by `navigationIntentKey`), in which case it replaces that entry in
 * place instead of growing the stack, e.g. moving between two file paths
 * under the same session's file browser.
 */
export function applyNavigationIntent(
  state: NavigationState,
  intent: NavigationIntent,
): NavigationState {
  if (intent.type === "back") {
    if (state.entries.length <= 1) {
      return state;
    }
    return { entries: state.entries.slice(0, -1) };
  }

  const current = currentNavigationIntent(state);
  if (current && navigationIntentKey(current) === navigationIntentKey(intent)) {
    return { entries: [...state.entries.slice(0, -1), intent] };
  }
  return { entries: [...state.entries, intent] };
}

/** Replaces the entire stack with a single entry, e.g. after choosing a new host. */
export function resetNavigationState(intent: NavigationDestinationIntent): NavigationState {
  return { entries: [intent] };
}
