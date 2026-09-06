// T07C (Phase 0, `docs/issues-from-plan.md`). Proves plan.md §4.2 step 7 ("add
// fixtures for old helper -> old client, old helper -> new client, new helper
// -> old client, and new helper -> new client") end to end against the real
// daemon-boundary code, and step 8 ("regenerate ahead-of-time validators and
// add wire-compatibility tests") by validating the resulting wire envelope
// with the regenerated AOT `validateWSOutboundMessage`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWSOutboundMessage } from "@picompanion/protocol/validation/ws-outbound";
import { PiUiElementSchema } from "@picompanion/protocol/pi-ui-bridge/schema";
import { PiUiDecoder, type PiUiDecodedOp } from "./decoder.js";
import { PIUI_MARKER } from "./schema.js";
import { projectPiUiElementForClient } from "./payload-compat.js";
import {
  listPayloadCompatScenarios,
  loadAllPayloadCompatFixtures,
  loadPayloadCompatFixture,
} from "./fixtures/index.js";

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec => value as Rec;

const REQUIRED_SCENARIOS = [
  "old-helper-old-client",
  "old-helper-new-client",
  "new-helper-old-client",
  "new-helper-new-client",
];

/** Ingests a single v1 PIUI `set` line through the real decoder and returns the decoded element. */
function decodeSet(el: Rec): unknown {
  const ops: PiUiDecodedOp[] = [];
  const notices: string[] = [];
  const decoder = new PiUiDecoder({
    onOp: (op) => ops.push(op),
    onNotice: (level, message) => notices.push(`${level}: ${message}`),
  });
  decoder.ingest(PIUI_MARKER + JSON.stringify({ v: 1, op: "set", el }));
  decoder.destroy();
  expect(notices, "decoder should accept every fixture helper input cleanly").toEqual([]);
  expect(ops).toHaveLength(1);
  const op = ops[0];
  expect(op?.kind).toBe("set");
  return op && "el" in op ? op.el : undefined;
}

/** The outbound wire envelope shape a `pi_ui_delta` upsert travels in (matches session.ts's forwardAgentStream). */
function deltaMessage(element: unknown): unknown {
  return {
    type: "session",
    message: {
      type: "agent_stream",
      payload: {
        agentId: "agt_1",
        timestamp: "2026-08-31T10:00:00.000Z",
        event: {
          type: "pi_ui_delta",
          provider: "pi",
          agentId: "agt_1",
          revision: 1,
          delta: { op: "upsert", element },
        },
      },
    },
  };
}

describe("payload-compat fixtures (plan.md §4.2 step 7)", () => {
  it("has every required old/new helper x old/new client scenario recorded", () => {
    const available = new Set(listPayloadCompatScenarios());
    for (const scenario of REQUIRED_SCENARIOS) {
      expect(available.has(scenario), `missing payload-compat fixture: ${scenario}`).toBe(true);
    }
    expect(available.size).toBe(REQUIRED_SCENARIOS.length);
  });

  it.each(REQUIRED_SCENARIOS)(
    "%s: helper input decodes to the recorded normalized element",
    (scenario) => {
      const fixture = loadPayloadCompatFixture(scenario);
      expect(fixture.scenario).toBe(scenario);
      expect(fixture.elements.length).toBeGreaterThan(0);
      for (const { helperInput, expectedNormalizedElement } of fixture.elements) {
        const decoded = decodeSet(helperInput);
        expect(decoded).toEqual(expectedNormalizedElement);
        // The decoder validates through the shared wire schema (PiUiElementSchema)
        // as part of `set` handling; re-asserting here documents that no field
        // was stripped by that Zod parse (plan.md §4.2, the blocking bug this
        // task's parent, T07, exists to fix).
        expect(PiUiElementSchema.safeParse(decoded).success).toBe(true);
      }
    },
  );

  it.each(REQUIRED_SCENARIOS)(
    "%s: projects the decoded element to the recorded client-facing element",
    (scenario) => {
      const fixture = loadPayloadCompatFixture(scenario);
      const supportsPayloadV2 = fixture.clientCapability === "new";
      for (const { helperInput, expectedClientElement } of fixture.elements) {
        const decoded = decodeSet(helperInput);
        const projected = projectPiUiElementForClient(decoded, supportsPayloadV2);
        expect(projected).toEqual(expectedClientElement);
      }
    },
  );

  it.each(REQUIRED_SCENARIOS)(
    "%s: the client-facing element round-trips through the wire schema and the regenerated AOT validator",
    (scenario) => {
      const fixture = loadPayloadCompatFixture(scenario);
      for (const { expectedClientElement } of fixture.elements) {
        expect(PiUiElementSchema.safeParse(expectedClientElement).success).toBe(true);

        const result = validateWSOutboundMessage(deltaMessage(expectedClientElement));
        expect(result.success, scenario).toBe(true);
        if (!result.success) continue;
        const message = result.data as {
          message: { payload: { event: { delta: { element: unknown } } } };
        };
        expect(message.message.payload.event.delta.element).toEqual(expectedClientElement);
      }
    },
  );

  it("old-helper-old-client and new-helper-new-client are each idempotent (matching helper and client versions round-trip losslessly)", () => {
    for (const scenario of ["old-helper-old-client", "new-helper-new-client"]) {
      const fixture = loadPayloadCompatFixture(scenario);
      const supportsPayloadV2 = fixture.clientCapability === "new";
      for (const { helperInput, expectedClientElement } of fixture.elements) {
        const decoded = decodeSet(helperInput);
        const projected = asRec(projectPiUiElementForClient(decoded, supportsPayloadV2));
        // Same-version round trips never lose the fields the helper actually sent.
        for (const [key, value] of Object.entries(helperInput)) {
          expect(projected[key], key).toEqual(value);
        }
        expect(projected).toEqual(expectedClientElement);
      }
    }
  });

  it("cross-version scenarios never carry both a canonical payload and duplicated legacy fields for a single kind's payload keys", () => {
    // old-helper-new-client and new-helper-old-client each convert shape once;
    // the client should see either the payload or the legacy fields for a kind's
    // payload-bearing keys, not a mix that would double-render on the client.
    for (const scenario of ["old-helper-new-client", "new-helper-old-client"]) {
      const fixture = loadPayloadCompatFixture(scenario);
      for (const { kind, expectedClientElement } of fixture.elements) {
        if (kind === "log") {
          const hasPayload = expectedClientElement.payload !== undefined;
          const hasLegacyLines = expectedClientElement.lines !== undefined;
          expect(hasPayload).toBe(fixture.clientCapability === "new");
          expect(hasLegacyLines).toBe(fixture.clientCapability === "old");
        }
      }
    }
  });

  it("loads all four fixtures via loadAllPayloadCompatFixtures", () => {
    const all = loadAllPayloadCompatFixtures();
    expect(all.map((fixture) => fixture.scenario).sort()).toEqual([...REQUIRED_SCENARIOS].sort());
  });
});

describe("COMPAT(piUiPayloadV2) tags (plan.md §4.2 step 9)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const TAG = "// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.";

  // A representative file per package that carries transition code, so a
  // future edit that silently drops the tag (instead of updating it or
  // removing the compatibility branch entirely) fails this test rather than
  // going unnoticed before the stated removal date.
  const TAGGED_FILES = [
    join(here, "payload-compat.ts"),
    join(here, "decoder.ts"),
    join(here, "..", "..", "..", "..", "session.ts"),
    join(here, "..", "..", "..", "..", "websocket-server.ts"),
  ];

  it.each(TAGGED_FILES)("%s carries the exact COMPAT(piUiPayloadV2) tag", (path) => {
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain(TAG);
  });
});
