import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PiUiKindSchema,
  piUiPayloadSchemaForKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import { normalizePiUiElement } from "./normalize.js";

/**
 * Canonical-payload normalization (plan.md §4.2 steps 1-6; T21B acceptance
 * criteria "Canonical payload parsed for all ten kinds; v1 projection still
 * accepted"). Driven entirely by recorded fixtures already in the repo:
 *
 * - the per-kind Pi UI Bridge wire fixtures in
 *   `packages/protocol/src/fixtures/pi-ui-bridge/` (T06B/T07A) supply real
 *   envelopes for all ten frozen v1 kinds (plan.md §11.3);
 * - the daemon-boundary payload-compatibility matrix fixtures in
 *   `packages/server/.../pi/ui-bridge/fixtures/payload-compat/` (T07C) supply
 *   exact "what a client actually receives on the wire" examples for the v1
 *   top-level projection and the canonical payload, across every
 *   helper-version/client-capability combination.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(here, "../../../protocol/src/fixtures/pi-ui-bridge");
const PAYLOAD_COMPAT_FIXTURES_DIR = join(
  here,
  "../../../server/src/server/agent/providers/pi/ui-bridge/fixtures/payload-compat",
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadPiUiBridgeFixture(kind: string): PiUiBridgeFixture {
  return readJson(join(PI_UI_BRIDGE_FIXTURES_DIR, `${kind}.json`)) as PiUiBridgeFixture;
}

/** Extracts every `upsert` element from a recorded per-kind fixture's frames. */
function upsertElementsOf(fixture: PiUiBridgeFixture): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: { delta?: { op?: string; element?: unknown } } } };
    };
    const delta = message.message?.payload?.event?.delta;
    if (delta?.op === "upsert" && delta.element) {
      elements.push(delta.element as Record<string, unknown>);
    }
  }
  return elements;
}

type PayloadCompatFixture = {
  clientCapability: "old" | "new";
  elements: Array<{
    kind: string;
    expectedClientElement: Record<string, unknown>;
  }>;
};

function loadAllPayloadCompatFixtures(): PayloadCompatFixture[] {
  return readdirSync(PAYLOAD_COMPAT_FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(PAYLOAD_COMPAT_FIXTURES_DIR, name)) as PayloadCompatFixture);
}

describe("normalizePiUiElement — recorded per-kind fixtures", () => {
  it.each(PiUiKindSchema.options)("has a recorded %s fixture", (kind) => {
    expect(() => loadPiUiBridgeFixture(kind)).not.toThrow();
  });

  // None of the recorded fixtures carry v1 payload-content fields (they
  // exercise the envelope/action round trip, not payload content). A kind
  // whose canonical payload schema requires a field beyond `kind`
  // (roster/log/markdown/diff/form/composer/panel) therefore cannot derive a
  // payload from an envelope-only element, and normalization must return it
  // unchanged rather than drop or coerce it.
  const KINDS_WITH_REQUIRED_PAYLOAD_FIELDS = new Set([
    "roster",
    "log",
    "markdown",
    "diff",
    "form",
    "composer",
    "panel",
  ]);

  it.each(PiUiKindSchema.options.filter((kind) => KINDS_WITH_REQUIRED_PAYLOAD_FIELDS.has(kind)))(
    "passes an envelope-only recorded %s element through unchanged (no payload content to derive)",
    (kind) => {
      const [element] = upsertElementsOf(loadPiUiBridgeFixture(kind));
      expect(element).toBeDefined();
      expect(normalizePiUiElement(element)).toEqual(element);
    },
  );

  it.each(PiUiKindSchema.options.filter((kind) => !KINDS_WITH_REQUIRED_PAYLOAD_FIELDS.has(kind)))(
    "attaches a minimal but valid canonical %s payload to an envelope-only recorded element (every payload field is optional)",
    (kind) => {
      const [element] = upsertElementsOf(loadPiUiBridgeFixture(kind));
      expect(element).toBeDefined();
      const normalized = normalizePiUiElement(element) as { payload?: unknown };
      expect(normalized.payload).toEqual({ kind });
      expect(piUiPayloadSchemaForKind(kind).safeParse(normalized.payload).success).toBe(true);
      // Every other envelope field is preserved untouched.
      const { payload: _droppedPayload, ...rest } = normalized as Record<string, unknown>;
      expect(rest).toEqual(element);
    },
  );

  it("lifts v1 top-level fields into a canonical payload for a real recorded element", () => {
    // `roster.json`'s recorded element has only envelope fields; enrich it
    // with the v1 top-level `rows` field a v1 helper/old daemon would have
    // sent, exactly like the `roster` row shape used elsewhere in this
    // fixture (the `pi.ui.action.request` frame targets a `subagentId`).
    const [element] = upsertElementsOf(loadPiUiBridgeFixture("roster"));
    const v1Element = {
      ...element,
      rows: [{ id: "sub_1", label: "reviewer", state: "running" }],
    };
    const normalized = normalizePiUiElement(v1Element) as { payload?: unknown };
    expect(normalized.payload).toEqual({
      kind: "roster",
      rows: [{ id: "sub_1", label: "reviewer", state: "running" }],
    });
    // v1 top-level fields are not deleted: an old-projection-only consumer
    // reading the same object still finds what it expects.
    expect((normalized as Record<string, unknown>).rows).toEqual(v1Element.rows);
    expect(piUiPayloadSchemaForKind("roster").safeParse(normalized.payload).success).toBe(true);
  });

  it("prefers an existing canonical payload over v1 top-level fields", () => {
    const [element] = upsertElementsOf(loadPiUiBridgeFixture("status"));
    const dual = {
      ...element,
      text: "stale top-level text",
      payload: { kind: "status", text: "canonical text", tone: "accent" },
    };
    const normalized = normalizePiUiElement(dual) as { payload?: { text?: string } };
    expect(normalized.payload?.text).toBe("canonical text");
  });

  it("normalizes a panel's leaf sections from their v1 top-level fields", () => {
    const [element] = upsertElementsOf(loadPiUiBridgeFixture("panel"));
    const withSections = {
      ...element,
      payload: undefined,
      sections: [
        { id: "head", ns: "loop", kind: "status", text: "running" },
        { id: "tail", ns: "loop", kind: "log", lines: ["step 1", "step 2"] },
      ],
    };
    const normalized = normalizePiUiElement(withSections) as {
      payload?: { sections?: Array<{ payload?: unknown }> };
    };
    expect(normalized.payload?.sections?.[0]?.payload).toEqual({ kind: "status", text: "running" });
    expect(normalized.payload?.sections?.[1]?.payload).toEqual({
      kind: "log",
      lines: ["step 1", "step 2"],
    });
  });

  it("returns an element with an unrecognized kind unchanged", () => {
    const element = { id: "x", ns: "n", kind: "teapot", placement: "inline" };
    expect(normalizePiUiElement(element)).toEqual(element);
  });

  it("returns non-object input unchanged", () => {
    expect(normalizePiUiElement(null)).toBeNull();
    expect(normalizePiUiElement("x")).toBe("x");
    expect(normalizePiUiElement(undefined)).toBeUndefined();
  });
});

describe("normalizePiUiElement — daemon payload-compatibility matrix fixtures", () => {
  it("covers old and new client capability scenarios", () => {
    const scenarios = loadAllPayloadCompatFixtures()
      .map((f) => f.clientCapability)
      .sort();
    expect(scenarios).toContain("old");
    expect(scenarios).toContain("new");
  });

  for (const fixture of loadAllPayloadCompatFixtures()) {
    it(`derives the same canonical payload from every "${fixture.clientCapability}"-client wire element (log/diff)`, () => {
      for (const { kind, expectedClientElement } of fixture.elements) {
        const normalized = normalizePiUiElement(expectedClientElement) as {
          payload?: Record<string, unknown>;
        };
        expect(normalized.payload).toBeDefined();
        expect(normalized.payload?.kind).toBe(kind);
        expect(piUiPayloadSchemaForKind(kind as never).safeParse(normalized.payload).success).toBe(
          true,
        );
        if (kind === "log") {
          expect(normalized.payload).toMatchObject({ lines: ["one", "two"], tail: 50 });
        }
        if (kind === "diff") {
          // Both the canonical `unifiedDiff` wire field and the v1 `diff`
          // alias must resolve to the same canonical payload.
          expect(normalized.payload).toMatchObject({ unifiedDiff: "--- a\n+++ b\n" });
        }
      }
    });
  }
});
