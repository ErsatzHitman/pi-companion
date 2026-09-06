import { navigation } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { TAB_ROUTE_NAME } from "./host-tabs";
import { destinationHref, TOP_LEVEL_DESTINATIONS } from "./top-level-destinations";

/**
 * Proves switching between the `sessionList` and `settings` tabs is real,
 * working navigation — T32S1C closing T32S1's second, deliberately-left-
 * open acceptance criterion ("Navigation between top-level destinations
 * works").
 *
 * `apps/android`'s plain `vitest` setup can't render `expo-router`'s
 * actual `<Tabs>` (see `../app/dev/component-lab.test.ts`'s doc comment for
 * why), so this drives the real `frontend-core` navigation reducer
 * (`applyNavigationIntent`/`currentNavigationIntent`) — the exact state
 * machine every route in this tree, and `(tabs)/_layout.tsx`'s
 * `<Tabs.Screen>` entries, resolve against — through the precise
 * sequence a user tapping between the two tabs produces, using this
 * task's own `TOP_LEVEL_DESTINATIONS`/`destinationHref`/`TAB_ROUTE_NAME`
 * exports, the same ones the production layout file consumes. This is a
 * real state transition proof, not an assertion about source text.
 */
describe("switching between the sessionList and settings tabs", () => {
  const serverId = "srv_1";

  it("gives every top-level destination a distinct (tabs)/ route name, in tab order", () => {
    const names = TOP_LEVEL_DESTINATIONS.map((destination) => TAB_ROUTE_NAME[destination.type]);
    expect(names).toEqual(["sessions", "settings"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("actually moves the current destination from sessions to settings and back", () => {
    let state = navigation.createInitialNavigationState({ type: "sessionList", serverId });
    expect(navigation.currentNavigationIntent(state)).toEqual({ type: "sessionList", serverId });
    expect(destinationHref(navigation.currentNavigationIntent(state)!)).toBe(
      `/h/${serverId}/${TAB_ROUTE_NAME.sessionList}`,
    );

    // user taps the Settings tab
    state = navigation.applyNavigationIntent(state, { type: "settings", serverId });
    expect(navigation.currentNavigationIntent(state)).toEqual({ type: "settings", serverId });
    expect(destinationHref(navigation.currentNavigationIntent(state)!)).toBe(
      `/h/${serverId}/${TAB_ROUTE_NAME.settings}`,
    );

    // user taps back to the Sessions tab
    state = navigation.applyNavigationIntent(state, { type: "sessionList", serverId });
    expect(navigation.currentNavigationIntent(state)).toEqual({ type: "sessionList", serverId });
    expect(destinationHref(navigation.currentNavigationIntent(state)!)).toBe(
      `/h/${serverId}/${TAB_ROUTE_NAME.sessionList}`,
    );
  });

  it("re-selecting the tab already showing does not grow the navigation stack", () => {
    let state = navigation.createInitialNavigationState({ type: "sessionList", serverId });
    state = navigation.applyNavigationIntent(state, { type: "sessionList", serverId });
    expect(state.entries).toHaveLength(1);
  });
});
