import { navigation } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import {
  destinationHref,
  isTopLevelDestination,
  TOP_LEVEL_DESTINATIONS,
} from "./top-level-destinations";

/**
 * T32S1 top-level destination registry coverage. Unlike this task's other
 * two new modules, this one imports neither `react-native` nor
 * `expo-router` (see its own doc comment), so — unlike
 * `./compact-shell.test.ts`/`./navigation-shell.test.ts` — this is a real
 * behavioural unit test, run directly against the module.
 */
describe("TOP_LEVEL_DESTINATIONS", () => {
  it("lists sessions before settings, matching plan.md §9's session-first shape", () => {
    expect(TOP_LEVEL_DESTINATIONS.map((d) => d.type)).toEqual(["sessionList", "settings"]);
  });
});

describe("isTopLevelDestination", () => {
  it("accepts sessionList and settings", () => {
    expect(isTopLevelDestination({ type: "sessionList", serverId: "srv_1" })).toBe(true);
    expect(isTopLevelDestination({ type: "settings", serverId: "srv_1" })).toBe(true);
  });

  it("rejects every non-tab destination in the frontend-core navigation vocabulary", () => {
    expect(isTopLevelDestination({ type: "connect" })).toBe(false);
    expect(isTopLevelDestination({ type: "host", serverId: "srv_1" })).toBe(false);
    expect(isTopLevelDestination({ type: "session", serverId: "srv_1", agentId: "agt_1" })).toBe(
      false,
    );
    expect(
      isTopLevelDestination({ type: "sessionFiles", serverId: "srv_1", agentId: "agt_1" }),
    ).toBe(false);
    expect(
      isTopLevelDestination({
        type: "sessionTerminal",
        serverId: "srv_1",
        agentId: "agt_1",
        terminalId: "term_1",
      }),
    ).toBe(false);
  });
});

describe("destinationHref", () => {
  it("matches frontend-core's own navigationIntentToPath exactly, for every destination type", () => {
    const samples: Parameters<typeof navigation.navigationIntentToPath>[0][] = [
      { type: "connect" },
      { type: "host", serverId: "srv_1" },
      { type: "sessionList", serverId: "srv_1" },
      { type: "session", serverId: "srv_1", agentId: "agt_1" },
      { type: "sessionFiles", serverId: "srv_1", agentId: "agt_1", path: ["a.ts"] },
      { type: "sessionTerminal", serverId: "srv_1", agentId: "agt_1", terminalId: "term_1" },
      { type: "settings", serverId: "srv_1" },
    ];
    for (const intent of samples) {
      expect(destinationHref(intent)).toBe(navigation.navigationIntentToPath(intent));
    }
  });

  it("produces the exact top-level tab paths this shell will route to", () => {
    expect(destinationHref({ type: "sessionList", serverId: "srv_1" })).toBe("/h/srv_1/sessions");
    expect(destinationHref({ type: "settings", serverId: "srv_1" })).toBe("/h/srv_1/settings");
  });
});
