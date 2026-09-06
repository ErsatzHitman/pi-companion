import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  PiUiActionResultSchema,
  PiUiElementSchema,
  piUiPayloadMatchesKind,
  piUiPayloadSchemaForKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import { PiUiElementStore } from "../../../extensions/state.js";
import { parseSection117BridgeElementsTable } from "../../plan-table.js";
import {
  agentStreamEventFromFrame,
  frameById,
  sessionInboundMessageFromFrame,
  sessionOutboundMessageFromFrame,
} from "./wire.js";
import { listExtensionFixtures, loadAllExtensionFixtures, loadExtensionFixture } from "./index.js";
import type { ExtensionFixtureScenario, FixtureFrame } from "./types.js";

/**
 * Proves every §11.7 extension fixture (T40A1's eight plus T40A2's four)
 * round-trips through the *real* production path — the wire schema, the
 * real `PiUiElementStore`, and the real per-kind payload schema — not
 * merely that the raw literal happens to satisfy some schema in isolation.
 * See ./README.md "Round-trip proof".
 */

/**
 * T104: parsed straight out of plan.md's §11.7 "First-class UI through
 * bridge elements" table (`../../plan-table.js`'s pure parser, fed the
 * real file's content read below), not a hand-copied list — a thirteenth
 * plan.md row now fails this file's coverage assertion below instead of
 * failing nothing.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let hops = 0; hops < 12; hops += 1) {
    if (existsSync(join(dir, "plan.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`findRepoRoot: could not locate plan.md by walking up from ${startDir}`);
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const planMarkdown = readFileSync(join(repoRoot, "plan.md"), "utf8");
const PLAN_SECTION_117_ROWS = parseSection117BridgeElementsTable(planMarkdown);
const EXPECTED_EXTENSIONS = PLAN_SECTION_117_ROWS.map((row) => row.extension).sort();

describe("§11.7 extension fixtures — coverage (plan.md-driven, T104)", () => {
  it("covers exactly the §11.7 bridge-elements table entries parsed live from plan.md", () => {
    expect(listExtensionFixtures()).toEqual(EXPECTED_EXTENSIONS);
  });

  it("every fixture cites a plan.md §11.7 reference", () => {
    for (const fixture of loadAllExtensionFixtures()) {
      expect(fixture.planRef).toContain("§11.7");
      expect(fixture.planRef).toContain(fixture.extension);
    }
  });
});

/** Every `pi_ui_delta` upsert frame in a scenario. */
function upsertFrames(scenario: ExtensionFixtureScenario): FixtureFrame[] {
  return scenario.frames.filter((frame) => frame.wireType.includes("agent_stream:pi_ui_delta"));
}

describe.each(EXPECTED_EXTENSIONS)("§11.7 extension fixture — %s", (extension) => {
  const scenario = loadExtensionFixture(extension);

  it("has at least one element upsert frame", () => {
    expect(upsertFrames(scenario).length).toBeGreaterThan(0);
  });

  it("every upsert element's raw literal validates against PiUiElementSchema directly", () => {
    for (const frame of upsertFrames(scenario)) {
      const event = agentStreamEventFromFrame(frame);
      if (event.type !== "pi_ui_delta" || event.delta.op !== "upsert") {
        throw new Error(`expected a pi_ui_delta upsert, got ${event.type}`);
      }
      // The literal object exported by the scenario file, parsed directly —
      // proves the fixture author's raw shape (not a normalized derivative)
      // already satisfies the wire schema.
      const parsed = PiUiElementSchema.safeParse(event.delta.element);
      expect(parsed.success, JSON.stringify(parsed.success ? undefined : parsed.error.issues)).toBe(
        true,
      );
    }
  });

  it("every upsert round-trips through the real PiUiElementStore and keeps its canonical payload", () => {
    const store = new PiUiElementStore();
    for (const frame of upsertFrames(scenario)) {
      const event = agentStreamEventFromFrame(frame);
      const outcome = store.ingestEvent(event);
      expect(
        outcome?.action,
        `ingest of frame "${frame.id}" was not applied: ${JSON.stringify(outcome)}`,
      ).toBe("applied");

      if (event.type !== "pi_ui_delta" || event.delta.op !== "upsert") continue;
      const expected = event.delta.element;

      const stored = store
        .getElements(event.agentId)
        .find((el) => el.id === expected.id && el.ns === expected.ns);
      expect(stored, `store did not retain element ${expected.ns}:${expected.id}`).toBeDefined();
      if (!stored) continue;

      // "Round-trips through the schema, not that it merely parses": the
      // element the store actually holds must (a) still satisfy the wire
      // envelope schema, (b) carry a payload whose discriminator agrees
      // with the element's own kind, and (c) have that payload re-parse
      // cleanly through its typed per-kind schema with the fixture's own
      // field values intact — proving normalization did not silently drop
      // or reshape anything the fixture declared.
      expect(PiUiElementSchema.safeParse(stored).success).toBe(true);
      expect(piUiPayloadMatchesKind(stored.kind, stored.payload)).toBe(true);

      const payloadSchema = piUiPayloadSchemaForKind(stored.kind);
      const reparsed = payloadSchema.safeParse(stored.payload);
      expect(
        reparsed.success,
        JSON.stringify(reparsed.success ? undefined : reparsed.error.issues),
      ).toBe(true);

      if (expected.payload) {
        // The fixture declared an explicit canonical payload — every field
        // it set must have survived byte-for-byte, not just "parsed to
        // something".
        expect(stored.payload).toMatchObject(expected.payload);
      }
    }
  });

  it("every client_to_daemon action request parses through the real inbound wire schema", () => {
    for (const frame of scenario.frames) {
      if (frame.direction !== "client_to_daemon") continue;
      const message = sessionInboundMessageFromFrame(frame);
      expect(message.type).toBe("pi.ui.action.request");
    }
  });

  it("every daemon_to_client action settlement parses through the real outbound wire schema", () => {
    for (const frame of scenario.frames) {
      if (frame.direction !== "daemon_to_client") continue;
      if (frame.wireType === "session(pi.ui.action.response)") {
        const message = sessionOutboundMessageFromFrame(frame);
        expect(message.type).toBe("pi.ui.action.response");
      }
      if (frame.wireType === "session(agent_stream:pi_ui_action_result)") {
        const event = agentStreamEventFromFrame(frame);
        expect(event.type).toBe("pi_ui_action_result");
        if (event.type === "pi_ui_action_result") {
          expect(PiUiActionResultSchema.safeParse(event.result).success).toBe(true);
        }
      }
    }
  });
});

describe("§11.7 extension fixtures — mutation sentinel", () => {
  // "A fix that no test can fail is not a fix": prove the round-trip
  // assertion above actually fails when a payload field is dropped, by
  // replaying it against a hand-corrupted clone rather than the fixture.
  it("fails piUiPayloadMatchesKind when an element's payload.kind disagrees with its own kind", () => {
    const loop = loadExtensionFixture("loop");
    const frame = upsertFrames(loop)[0]!;
    const event = agentStreamEventFromFrame(frame);
    if (event.type !== "pi_ui_delta" || event.delta.op !== "upsert") {
      throw new Error("expected a pi_ui_delta upsert");
    }
    const corrupted = { ...event.delta.element.payload, kind: "status" };
    expect(piUiPayloadMatchesKind(event.delta.element.kind, corrupted)).toBe(false);
  });

  it("fails the real wire schema when a pi_ui_delta upsert's element is missing a required field", () => {
    const loop = loadExtensionFixture("loop");
    const frame = upsertFrames(loop)[0]!;
    const corrupted = structuredClone(frame.message) as {
      message: { payload: { event: { delta: { element: Record<string, unknown> } } } };
    };
    delete corrupted.message.payload.event.delta.element.ns;
    expect(() => agentStreamEventFromFrame({ message: corrupted })).toThrow();
  });
});

describe("§11.7 extension fixtures — frame id lookup helper", () => {
  it("frameById finds a known frame and throws for an unknown one", () => {
    const loop = loadExtensionFixture("loop");
    expect(frameById(loop.frames, "loop-panel-upsert-1").id).toBe("loop-panel-upsert-1");
    expect(() => frameById(loop.frames, "does-not-exist")).toThrow();
  });
});
