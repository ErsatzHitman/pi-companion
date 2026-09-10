/**
 * Navigation domain — plan.md §6/§7.1/§8.2, T24 ("Add navigation intents,
 * fixtures, recorded-session test").
 *
 * Owns platform-neutral navigation intents and a pure history-stack
 * reducer over them. Web maps them onto TanStack Router routes and
 * Android maps them onto Expo Router routes/screens; this module knows
 * about neither router. See `types.ts` for the intent vocabulary and
 * `intents.ts` for the path-rendering and stack-reducer implementation.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
export type {
  BackIntent,
  ConnectIntent,
  HostIntent,
  NavigationDestinationIntent,
  NavigationIntent,
  NavigationIntentType,
  SessionFilesIntent,
  SessionIntent,
  SessionListIntent,
  SessionLiveIntent,
  SessionTerminalIntent,
  SettingsIntent,
} from "./types.js";

export {
  applyNavigationIntent,
  createInitialNavigationState,
  currentNavigationIntent,
  navigationIntentKey,
  navigationIntentToPath,
  resetNavigationState,
  type NavigationState,
} from "./intents.js";
