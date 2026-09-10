import { describe, expect, it } from "vitest";
import {
  applyNavigationIntent,
  createInitialNavigationState,
  currentNavigationIntent,
  navigationIntentKey,
  navigationIntentToPath,
  resetNavigationState,
} from "./intents.js";
import type { NavigationDestinationIntent } from "./types.js";

describe("navigationIntentToPath", () => {
  it("renders every destination as the plan.md §8.2 route path", () => {
    expect(navigationIntentToPath({ type: "connect" })).toBe("/connect");
    expect(navigationIntentToPath({ type: "host", serverId: "srv_1" })).toBe("/h/srv_1");
    expect(navigationIntentToPath({ type: "sessionList", serverId: "srv_1" })).toBe(
      "/h/srv_1/sessions",
    );
    expect(navigationIntentToPath({ type: "session", serverId: "srv_1", agentId: "agt_1" })).toBe(
      "/h/srv_1/session/agt_1",
    );
    expect(
      navigationIntentToPath({
        type: "sessionFiles",
        serverId: "srv_1",
        agentId: "agt_1",
        path: ["src", "index.ts"],
      }),
    ).toBe("/h/srv_1/session/agt_1/files/src/index.ts");
    expect(
      navigationIntentToPath({ type: "sessionFiles", serverId: "srv_1", agentId: "agt_1" }),
    ).toBe("/h/srv_1/session/agt_1/files/");
    expect(
      navigationIntentToPath({ type: "sessionLive", serverId: "srv_1", agentId: "agt_1" }),
    ).toBe("/h/srv_1/session/agt_1/live");
    expect(
      navigationIntentToPath({
        type: "sessionTerminal",
        serverId: "srv_1",
        agentId: "agt_1",
        terminalId: "term_1",
      }),
    ).toBe("/h/srv_1/session/agt_1/terminal/term_1");
    expect(navigationIntentToPath({ type: "settings", serverId: "srv_1" })).toBe(
      "/h/srv_1/settings",
    );
  });

  it("percent-encodes identifiers so private material never becomes a raw path/query separator (plan.md §12.1)", () => {
    expect(navigationIntentToPath({ type: "host", serverId: "srv with space/slash" })).toBe(
      "/h/srv%20with%20space%2Fslash",
    );
  });
});

describe("navigation stack reducer", () => {
  it("starts at /connect", () => {
    const state = createInitialNavigationState();
    expect(currentNavigationIntent(state)).toEqual({ type: "connect" });
  });

  it("pushes a new destination and pops it back with a back intent", () => {
    let state = createInitialNavigationState();
    const host: NavigationDestinationIntent = { type: "host", serverId: "srv_1" };
    state = applyNavigationIntent(state, host);
    expect(currentNavigationIntent(state)).toEqual(host);
    expect(state.entries).toHaveLength(2);

    state = applyNavigationIntent(state, { type: "back" });
    expect(currentNavigationIntent(state)).toEqual({ type: "connect" });
    expect(state.entries).toHaveLength(1);
  });

  it("back at the root is a no-op, matching a platform back gesture exiting rather than navigating", () => {
    const state = createInitialNavigationState();
    const next = applyNavigationIntent(state, { type: "back" });
    expect(next).toBe(state);
  });

  it("re-navigating to the current screen (same navigationIntentKey) replaces in place instead of growing the stack", () => {
    let state = createInitialNavigationState();
    state = applyNavigationIntent(state, {
      type: "sessionFiles",
      serverId: "srv_1",
      agentId: "agt_1",
      path: ["a.ts"],
    });
    expect(state.entries).toHaveLength(2);

    state = applyNavigationIntent(state, {
      type: "sessionFiles",
      serverId: "srv_1",
      agentId: "agt_1",
      path: ["b.ts"],
    });
    // Same intent *type+target* (files browser for the same session) collapses in place.
    expect(state.entries).toHaveLength(2);
    expect(currentNavigationIntent(state)).toEqual({
      type: "sessionFiles",
      serverId: "srv_1",
      agentId: "agt_1",
      path: ["b.ts"],
    });
  });

  it("navigating to a genuinely different destination pushes a new entry", () => {
    let state = createInitialNavigationState();
    state = applyNavigationIntent(state, { type: "host", serverId: "srv_1" });
    state = applyNavigationIntent(state, { type: "sessionList", serverId: "srv_1" });
    state = applyNavigationIntent(state, {
      type: "session",
      serverId: "srv_1",
      agentId: "agt_1",
    });
    expect(state.entries.map(navigationIntentKey)).toEqual([
      "connect",
      "host:srv_1",
      "sessionList:srv_1",
      "session:srv_1:agt_1",
    ]);
  });

  it("resetNavigationState replaces the whole stack, e.g. after selecting a new host", () => {
    let state = createInitialNavigationState();
    state = applyNavigationIntent(state, { type: "host", serverId: "srv_1" });
    state = resetNavigationState({ type: "host", serverId: "srv_2" });
    expect(state.entries).toEqual([{ type: "host", serverId: "srv_2" }]);
  });
});
