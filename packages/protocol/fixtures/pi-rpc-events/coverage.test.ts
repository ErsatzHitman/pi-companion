import { describe, expect, it } from "vitest";
import {
  PI_RPC_EVENT_TYPES,
  loadAllPiRpcFixtureEvents,
  loadPiRpcFixtureScenarios,
} from "./index.js";

const REAL_LOOKING_PATH_PATTERN = /\/(?:Users|home)\/(?!synthetic\b)[^/"]+\//i;
const SUSPICIOUS_WINDOWS_PATH_PATTERN = /[A-Z]:\\Users\\(?!synthetic\b)/i;

describe("Pi RPC event fixtures", () => {
  it("declares exactly 21 Pi RPC event types", () => {
    expect(PI_RPC_EVENT_TYPES.length).toBe(21);
    expect(new Set(PI_RPC_EVENT_TYPES).size).toBe(21);
  });

  it("has at least one scenario file", () => {
    const scenarios = loadPiRpcFixtureScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it("covers every one of the 21 Pi RPC event types across the fixture set", () => {
    const events = loadAllPiRpcFixtureEvents();
    const seenTypes = new Set(events.map((event) => event.type));

    const missing = PI_RPC_EVENT_TYPES.filter((type) => !seenTypes.has(type));
    expect(missing).toEqual([]);
  });

  it("every scenario has required fields and a non-empty event list", () => {
    for (const scenario of loadPiRpcFixtureScenarios()) {
      expect(scenario.scenario, scenario.fileName).toBeTruthy();
      expect(scenario.description, scenario.fileName).toBeTruthy();
      expect(Array.isArray(scenario.planBullets), scenario.fileName).toBe(true);
      expect(scenario.events.length, scenario.fileName).toBeGreaterThan(0);
      for (const event of scenario.events) {
        expect(typeof event.type, `${scenario.fileName} event.type`).toBe("string");
        expect(event.type.length, `${scenario.fileName} event.type`).toBeGreaterThan(0);
      }
    }
  });

  it("every plan §14.2 Pi-RPC-level bullet this task owns has a covering scenario", () => {
    const scenarios = loadPiRpcFixtureScenarios();
    const coveredBullets = new Set(scenarios.flatMap((scenario) => scenario.planBullets));

    const requiredBullets = [
      "streaming text and thinking",
      "single and multi-edit tool calls",
      "partial tool output and failure",
      "steer and follow-up queue",
      "compaction and retries",
      "hidden custom message",
      "corrected message_end",
      "unknown tool",
    ];

    for (const bullet of requiredBullets) {
      expect(coveredBullets.has(bullet), bullet).toBe(true);
    }
  });

  it("scenario JSON as a whole never contains a real-looking user home path", () => {
    const scenarios = loadPiRpcFixtureScenarios();
    for (const scenario of scenarios) {
      const serialized = JSON.stringify(scenario);
      expect(
        REAL_LOOKING_PATH_PATTERN.test(serialized),
        `${scenario.fileName} looks like it contains a real *nix home path`,
      ).toBe(false);
      expect(
        SUSPICIOUS_WINDOWS_PATH_PATTERN.test(serialized),
        `${scenario.fileName} looks like it contains a real Windows user path`,
      ).toBe(false);
    }
  });

  it("hidden-custom-message scenario models a display:false message and a synthetic secret", () => {
    const scenarios = loadPiRpcFixtureScenarios();
    const hidden = scenarios.find((scenario) => scenario.fileName === "hidden-custom-message");
    expect(hidden).toBeDefined();

    const serialized = JSON.stringify(hidden);
    expect(serialized).toContain('"display":false');
    expect(serialized).toContain("sk-synthetic-");
  });

  it("corrected-message-end scenario replays message_end twice for the same responseId", () => {
    const scenarios = loadPiRpcFixtureScenarios();
    const corrected = scenarios.find((scenario) => scenario.fileName === "corrected-message-end");
    expect(corrected).toBeDefined();

    const messageEnds = (corrected?.events ?? []).filter((event) => event.type === "message_end");
    expect(messageEnds.length).toBeGreaterThanOrEqual(2);

    const responseIds = messageEnds.map(
      (event) => (event.message as { responseId?: string } | undefined)?.responseId,
    );
    expect(new Set(responseIds).size).toBe(1);

    const finalText = JSON.stringify(messageEnds.at(-1));
    const draftText = JSON.stringify(messageEnds.at(0));
    expect(finalText).not.toEqual(draftText);
  });
});
