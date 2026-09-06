/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * Android top-level destination registry — plan.md §6/§8.2/§9, T32S1
 * ("Build the Android navigation shell").
 *
 * `frontend-core`'s `navigation` module (T24) defines the platform-neutral
 * vocabulary of where the product can navigate — `connect`, `host`,
 * `sessionList`, `session`, `sessionFiles`, `sessionTerminal`, `settings`
 * — and a pure history-stack reducer over it, but deliberately owns no
 * router and no opinion on which destinations a given platform treats as
 * top-level (tab-bar-worthy, sibling) screens versus screens reached by
 * drilling in.
 *
 * For Android, only `sessionList` and `settings` are top-level in that
 * sense: they are the two screens a connected user switches between as
 * siblings. `connect` and `host` are transitional (pre-connection /
 * host-resolution) screens, not tabs, and `session`/`sessionFiles`/
 * `sessionTerminal` are pushed *from* a row in the session list rather
 * than being alternatives to it — matching §9.2's "Files and terminal are
 * dedicated routes rather than squeezed beside chat" and §9's overall
 * shape of one primary session screen with drill-down detail routes.
 *
 * This module owns that platform-specific classification plus the one
 * genuinely Android-flavoured piece of "the Expo Router structure":
 * `destinationHref`, the single place every later Expo Router route file
 * (T32S1C's stub routes, and whatever screens fill them) should go
 * through to compute a navigable path from a `NavigationDestinationIntent`,
 * instead of each route file reaching into `frontend-core`'s
 * web-flavoured `navigationIntentToPath` name directly.
 *
 * Repository invariant: this module must never import React, React
 * Native, or Expo (`compact-shell.tsx`/`navigation-shell.tsx` are the
 * platform layer that consumes it) — it stays exactly as testable in
 * plain Node as `frontend-core`'s own navigation module.
 */
import { navigation } from "@picompanion/frontend-core";

type NavigationDestinationIntent = navigation.NavigationDestinationIntent;

/** The subset of destination types Android renders as sibling, top-level screens. */
export type TopLevelDestinationType = "sessionList" | "settings";

export interface TopLevelDestination {
  type: TopLevelDestinationType;
  /** Tab label. Plain product copy, not yet localized (no localization layer exists in this repo). */
  label: string;
}

/**
 * The Android shell's top-level destinations, in tab order. `T32S1C`'s
 * stub routes (and whatever real screens later replace them) are the
 * ones that turn this list into an actual `<Tabs>`; this module only
 * fixes the order and labels so every consumer agrees on both.
 */
export const TOP_LEVEL_DESTINATIONS: readonly TopLevelDestination[] = [
  { type: "sessionList", label: "Sessions" },
  { type: "settings", label: "Settings" },
];

function isTopLevelDestinationType(
  type: NavigationDestinationIntent["type"],
): type is TopLevelDestinationType {
  return type === "sessionList" || type === "settings";
}

/** Whether `intent` is one of Android's top-level (tab) destinations. */
export function isTopLevelDestination(
  intent: NavigationDestinationIntent,
): intent is Extract<NavigationDestinationIntent, { type: TopLevelDestinationType }> {
  return isTopLevelDestinationType(intent.type);
}

/**
 * The Expo Router-navigable path for `intent`. Delegates to
 * `frontend-core`'s `navigationIntentToPath` — whose own doc comment
 * already establishes this exact string as "also reusable as Android's
 * Expo Router segment path" — kept as its own named export so this app's
 * route files import a stable, Android-owned name rather than reaching
 * into a sibling package's web-flavoured export directly.
 */
export function destinationHref(intent: NavigationDestinationIntent): string {
  return navigation.navigationIntentToPath(intent);
}
