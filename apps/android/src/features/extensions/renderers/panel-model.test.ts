import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extensions } from "@picompanion/frontend-core";
import {
  PiUiElementSchema,
  type PiUiElement,
  type PiUiPanelSection,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiRendererRegistry } from "../registry";
import { buildPanelRenderModel, resolvePanelChildDecision } from "./panel-model";

/**
 * T34B4 — the Android `panel` kind renderer's model, the last link in the
 * T34 chain. Acceptance criteria exercised here:
 *
 * - "A panel renders nested kinds from fixtures": both the recorded
 *   `packages/protocol/src/fixtures/pi-ui-bridge/panel.json` envelope
 *   (enriched with a real canonical payload — that recorded frame
 *   predates `piUiPayloadV2`, same as `diff-model.test.ts`'s/
 *   `form-model.test.ts`'s/`roster-model.test.ts`'s fixtures) and a
 *   synthetic multi-kind panel (status/widget/roster/progress/log,
 *   mirroring plan.md §11.7's documented `loop` example and the web
 *   renderer's own `loopPanelElement` fixture, T29B4) are run through the
 *   real wire schema and normalizer and resolved to `"ok"` decisions
 *   naming the exact registered component for each section's kind — not
 *   merely that `piUiRendererRegistry.has("panel")` is true (this
 *   directory's standing "registration is not receipt" lesson).
 * - "Nesting depth is bounded with a diagnostic": tested exactly at the
 *   boundary — a genuine leaf-kind section (depth 0) resolves `"ok"`; a
 *   section that is itself `kind: "panel"` (depth 1, not constructible
 *   through the normal wire path since `PiUiLeafKindSchema` excludes
 *   `"panel"`, built by hand here to exercise the defense-in-depth guard)
 *   resolves `"nesting-limit"` — and a section whose `payload.sections`
 *   array is a genuine circular JS object reference back to its own
 *   parent panel payload never causes `buildPanelRenderModel` to
 *   recurse, hang, or throw, because a `"panel"`-kind section's `payload`
 *   is never read at all (see `panel-model.ts`'s doc comment).
 * - "A failing child does not take down the panel": `resolvePanelChildDecision`/
 *   `buildPanelRenderModel` never throw for a malformed section — proven
 *   here against sections with an unregistered kind, a missing payload,
 *   an oversized payload, and the cyclic case above — with every sibling
 *   section's own decision unaffected. The complementary half (a
 *   section's own kind *component* throwing while rendering) is
 *   `panel.tsx`'s `ExtensionElementBoundary` wrapping, unverifiable under
 *   this workspace's `vitest` (`RolldownError` on
 *   `node_modules/react-native/index.js:1:0`, as every sibling
 *   `*-model.test.ts` in this directory notes); that half belongs to the
 *   T37 Maestro flows.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(
  here,
  "../../../../../../packages/protocol/src/fixtures/pi-ui-bridge",
);

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadPanelFixture(): PiUiBridgeFixture {
  const path = join(PI_UI_BRIDGE_FIXTURES_DIR, "panel.json");
  return JSON.parse(readFileSync(path, "utf8")) as PiUiBridgeFixture;
}

/** The recorded `panel.json` fixture's one `upsert` element (`loop`'s `run-4`). */
function recordedPanelElement(): Record<string, unknown> {
  const fixture = loadPanelFixture();
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: { delta?: { op?: string; element?: unknown } } } };
    };
    const delta = message.message?.payload?.event?.delta;
    if (delta?.op === "upsert" && delta.element) {
      return delta.element as Record<string, unknown>;
    }
  }
  throw new Error("panel.json fixture has no recorded upsert element");
}

/**
 * The recorded `panel` element, enriched with a real canonical `payload`.
 * Run through the real wire schema and the real client-side normalizer —
 * exactly the element `registry-view.tsx` would hand `PanelRenderer`.
 */
function panelElement(payloadFields: Record<string, unknown>): PiUiElement {
  const recorded = recordedPanelElement();
  const envelope = PiUiElementSchema.parse({
    ...recorded,
    payload: { kind: "panel", ...payloadFields },
  });
  return extensions.normalizePiUiElementTyped(envelope);
}

function panelPayloadOf(element: PiUiElement) {
  expect(element.payload).toBeDefined();
  expect(element.payload?.kind).toBe("panel");
  return element.payload as Extract<PiUiElement["payload"], { kind: "panel" }>;
}

/** Fresh registry with a fake, unrendered component registered for each of the nine leaf kinds. */
function leafRegistry(): PiUiRendererRegistry {
  const registry = new PiUiRendererRegistry();
  for (const kind of [
    "status",
    "widget",
    "progress",
    "roster",
    "log",
    "markdown",
    "diff",
    "form",
    "composer",
  ] as const) {
    function FakeRenderer() {
      return null;
    }
    Object.defineProperty(FakeRenderer, "name", { value: `Fake_${kind}` });
    registry.register(kind, FakeRenderer as never);
  }
  return registry;
}

describe("buildPanelRenderModel: renders nested kinds from fixtures", () => {
  it("resolves the recorded panel.json fixture's element, enriched with a multi-kind payload, to ok decisions per section", () => {
    const element = panelElement({
      text: "Deploy workflow, step 3 of 5.",
      sections: [
        {
          id: "head",
          kind: "status",
          title: "Status",
          payload: { kind: "status", text: "Running step 3 of 5", tone: "accent" },
        },
        {
          id: "notes",
          kind: "markdown",
          payload: { kind: "markdown", text: "**Deploying** to staging." },
        },
        {
          id: "fleet",
          kind: "roster",
          title: "Fleet",
          actions: [{ id: "stop-fleet", label: "Stop fleet", variant: "danger" }],
          payload: {
            kind: "roster",
            rows: [{ id: "sub_1", label: "reviewer", state: "running", detail: "reading diff" }],
          },
        },
        {
          id: "progress",
          kind: "progress",
          payload: { kind: "progress", label: "Deploy", value: 3, max: 5 },
        },
        {
          id: "tail",
          kind: "log",
          title: "Log",
          actions: [{ id: "clear", label: "Clear" }],
          payload: { kind: "log", lines: ["step 1", "step 2", "step 3"], tail: 200 },
        },
      ],
    });
    const payload = panelPayloadOf(element);
    const registry = leafRegistry();

    const model = buildPanelRenderModel(element, payload, registry);

    expect(model.title).toBe("Loop run #4");
    expect(model.text).toBe("Deploy workflow, step 3 of 5.");
    expect(model.emptyText).toBeUndefined();
    expect(model.children).toHaveLength(5);
    expect(model.children.map((child) => child.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    // Each section resolves to the exact registered component for its own
    // kind (never one copy of a "panel-only" component) and the composite
    // `${element.id}#${section.id}` action-routing id.
    const byId = Object.fromEntries(model.children.map((child) => [child.sectionId, child]));
    expect(byId.head!.elementId).toBe("run-4#head");
    expect(byId.head!.status).toBe("ok");
    if (byId.head!.status === "ok") {
      expect(byId.head!.Renderer).toBe(registry.get("status"));
      expect(byId.head!.payload).toEqual({
        kind: "status",
        text: "Running step 3 of 5",
        tone: "accent",
      });
    }
    expect(byId.fleet!.status).toBe("ok");
    if (byId.fleet!.status === "ok") {
      expect(byId.fleet!.Renderer).toBe(registry.get("roster"));
      expect(byId.fleet!.element.actions).toEqual([
        { id: "stop-fleet", label: "Stop fleet", variant: "danger" },
      ]);
    }
    expect(byId.tail!.elementId).toBe("run-4#tail");
  });

  it("a section's ns falls back to the parent panel's ns when the section carries none of its own", () => {
    const registry = leafRegistry();
    const decision = resolvePanelChildDecision(
      { id: "run-9", ns: "loop" },
      { id: "s1", kind: "status", payload: { kind: "status", text: "hi" } } as PiUiPanelSection,
      registry,
    );
    expect(decision.status).toBe("ok");
    if (decision.status === "ok") {
      expect(decision.element.ns).toBe("loop");
    }
  });
});

describe("buildPanelRenderModel: nesting depth is bounded with a diagnostic", () => {
  it("resolves a genuine leaf-kind section at depth 0 as ok — the boundary's allowed side", () => {
    const registry = leafRegistry();
    const decision = resolvePanelChildDecision(
      { id: "p1", ns: "loop" },
      {
        id: "s1",
        kind: "status",
        payload: { kind: "status", text: "Still running" },
      } as PiUiPanelSection,
      registry,
    );
    expect(decision.status).toBe("ok");
  });

  it("resolves a section that is itself a panel (depth 1) as nesting-limit — the boundary's refused side", () => {
    const registry = leafRegistry();
    // Not constructible through the normal wire path (`PiUiLeafKindSchema`
    // excludes `"panel"`); built by hand to exercise the runtime guard.
    const nestedSection = {
      id: "inner",
      kind: "panel",
      payload: { kind: "panel", sections: [] },
    } as unknown as PiUiPanelSection;

    const decision = resolvePanelChildDecision({ id: "p1", ns: "loop" }, nestedSection, registry);

    expect(decision.status).toBe("nesting-limit");
    if (decision.status !== "ok") {
      expect(decision.diagnostic.title).toBe("Nested panels are not supported");
      expect(decision.diagnostic.message).toContain("inner");
      expect(decision.diagnostic.message).toContain("may not contain another panel");
    }
  });

  it("never traverses a cyclic payload.sections reference back to its own ancestor — no recursion, no hang, no throw", () => {
    const registry = leafRegistry();

    // A section whose own `payload.sections` array contains a circular
    // reference to the panel payload that contains it — the concrete shape
    // "an unbounded recursion actually arrives from a wire payload" takes,
    // since a real wire payload could never encode a JS object cycle but a
    // daemon-adjacent bug or hand-built fixture object graph could. If
    // `resolvePanelChildDecision` ever read this section's `payload` when
    // its `kind` is `"panel"`, this would recurse without termination.
    const cyclicSections: unknown[] = [];
    const cyclicPanelPayload: Record<string, unknown> = { kind: "panel", sections: cyclicSections };
    const cyclicSection = { id: "inner", kind: "panel", payload: cyclicPanelPayload };
    cyclicSections.push(cyclicSection); // the cycle: section -> payload -> sections -> itself

    const siblingSection = {
      id: "sibling",
      kind: "status",
      payload: { kind: "status", text: "Still running" },
    } as PiUiPanelSection;

    const start = Date.now();
    const decisions = [siblingSection, cyclicSection as unknown as PiUiPanelSection].map(
      (section) => resolvePanelChildDecision({ id: "p1", ns: "loop" }, section, registry),
    );
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(decisions[0]!.status).toBe("ok");
    expect(decisions[1]!.status).toBe("nesting-limit");
  });
});

describe("buildPanelRenderModel: a failing child does not take down the panel", () => {
  it("degrades a section of a kind outside the frozen vocabulary to an unknown-kind diagnostic without affecting siblings", () => {
    // `kind: "bogus-kind"` is not constructible through the real wire
    // schema at all (`PiUiLeafKindSchema` rejects it outright, and
    // `PiUiElementSchema.parse` would throw for the whole element), so —
    // like the nesting-limit tests above — this is built by hand and fed
    // straight to `buildPanelRenderModel`, never through `panelElement()`.
    const registry = leafRegistry();
    const garbageSections = [
      { id: "mystery", kind: "bogus-kind", payload: undefined },
      { id: "sibling", kind: "status", payload: { kind: "status", text: "ok" } },
    ] as unknown as PiUiPanelSection[];

    const model = buildPanelRenderModel(
      { id: "p1", ns: "loop", title: "Panel" },
      { kind: "panel", sections: garbageSections },
      registry,
    );

    expect(model.children).toHaveLength(2);
    expect(model.children[0]!.status).toBe("unknown-kind");
    if (model.children[0]!.status !== "ok") {
      expect(model.children[0]!.diagnostic.message).toContain("bogus-kind");
    }
    expect(model.children[1]!.status).toBe("ok");
  });

  it("degrades a section of a known leaf kind with no registered renderer yet, without affecting siblings", () => {
    // A registry that has every leaf kind *except* `composer` registered —
    // the real-world shape this hits: a kind the wire vocabulary defines
    // but this platform hasn't shipped a renderer for yet.
    const registry = leafRegistry();
    const decisions = [
      resolvePanelChildDecision(
        { id: "p1", ns: "loop" },
        {
          id: "draft",
          kind: "composer",
          payload: { kind: "composer", text: "draft reply" },
        } as PiUiPanelSection,
        new PiUiRendererRegistry(), // nothing registered at all
      ),
      resolvePanelChildDecision(
        { id: "p1", ns: "loop" },
        {
          id: "sibling",
          kind: "status",
          payload: { kind: "status", text: "ok" },
        } as PiUiPanelSection,
        registry,
      ),
    ];

    expect(decisions[0]!.status).toBe("no-renderer");
    if (decisions[0]!.status !== "ok") {
      expect(decisions[0]!.diagnostic.message).toContain("composer");
    }
    expect(decisions[1]!.status).toBe("ok");
  });

  it("degrades a section with no payload at all to an invalid-payload diagnostic without affecting siblings", () => {
    const registry = leafRegistry();
    const element = panelElement({
      sections: [
        { id: "empty-log", kind: "log" },
        { id: "sibling", kind: "status", payload: { kind: "status", text: "ok" } },
      ],
    });
    const payload = panelPayloadOf(element);

    const model = buildPanelRenderModel(element, payload, registry);

    expect(model.children[0]!.status).toBe("invalid-payload");
    expect(model.children[1]!.status).toBe("ok");
  });

  it("degrades an oversized section payload to a diagnostic naming the byte counts, without affecting siblings", () => {
    const registry = leafRegistry();
    const decisions = [
      resolvePanelChildDecision(
        { id: "p1", ns: "loop" },
        {
          id: "huge",
          kind: "markdown",
          payload: { kind: "markdown", text: "x".repeat(1000) },
        } as PiUiPanelSection,
        registry,
        50,
      ),
      resolvePanelChildDecision(
        { id: "p1", ns: "loop" },
        {
          id: "sibling",
          kind: "status",
          payload: { kind: "status", text: "ok" },
        } as PiUiPanelSection,
        registry,
        50,
      ),
    ];

    expect(decisions[0]!.status).toBe("oversized");
    if (decisions[0]!.status !== "ok") {
      expect(decisions[0]!.diagnostic.message).toContain("50-byte limit");
    }
    expect(decisions[1]!.status).toBe("ok");
  });

  it("resolvePanelChildDecision and buildPanelRenderModel never throw for a malformed section", () => {
    const registry = leafRegistry();
    const garbageSections = [
      {} as unknown as PiUiPanelSection,
      { id: "no-kind" } as unknown as PiUiPanelSection,
      { id: "wrong-types", kind: 42, payload: "not-an-object" } as unknown as PiUiPanelSection,
    ];
    for (const section of garbageSections) {
      expect(() =>
        resolvePanelChildDecision({ id: "p1", ns: "loop" }, section, registry),
      ).not.toThrow();
    }
    expect(() =>
      buildPanelRenderModel(
        { id: "p1", ns: "loop", title: "Panel" },
        { kind: "panel", sections: garbageSections },
        registry,
      ),
    ).not.toThrow();
  });
});

describe("buildPanelRenderModel: empty panel", () => {
  it("shows an empty-state message when the panel carries no sections", () => {
    const registry = leafRegistry();
    const model = buildPanelRenderModel(
      { id: "empty-panel", ns: "loop", title: "Empty" },
      { kind: "panel", sections: [] },
      registry,
    );
    expect(model.children).toEqual([]);
    expect(model.emptyText).toBe("No sections to show.");
  });

  it("falls back to the humanized namespace when the element carries no title", () => {
    const registry = leafRegistry();
    const model = buildPanelRenderModel(
      { id: "p1", ns: "loop-run", title: undefined },
      { kind: "panel", sections: [] },
      registry,
    );
    expect(model.title).toBe("Loop Run");
    expect(model.actionsAccessibilityLabel).toBe("Loop Run actions");
  });
});

/**
 * T361 source-level contract for `panel.tsx`'s sheet presentation. That
 * file imports `react-native`, so it cannot render under this
 * workspace's plain `vitest` setup — the constraint this file's own doc
 * comment already records for `panel-model.ts`'s sibling. Comments are
 * stripped first, so a claim made only in a doc comment can never
 * satisfy an assertion.
 */
function readPanelCode(): string {
  return readFileSync(fileURLToPath(new URL("./panel.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("panel.tsx: a sheet-placement panel is the redesign's .pop (T361)", () => {
  it("opens the floating variant, not the edge-anchored one", () => {
    expect(readPanelCode()).toMatch(/variant="floating"/);
  });

  it("draws the namespace tag from the element, never a hardcoded string", () => {
    const code = readPanelCode();
    expect(code).toMatch(/\{askUserTagLabel\(element\.ns\)\}/);
    expect(code).not.toMatch(/"\[ask-user\]"/);
  });

  it("tints the tag purple from the theme", () => {
    expect(readPanelCode()).toMatch(/color: theme\.colors\.purple/);
  });

  it("passes the touch-worded footer hint, and none of the artifact's keyboard text", () => {
    const code = readPanelCode();
    expect(code).toMatch(/footerHint=\{askUserFooterHint\(true\)\}/);
    expect(code).not.toMatch(/esc to let the model choose/);
    expect(code).not.toMatch(/1-2 to answer/);
  });

  it("leaves every other placement on the plain inline card", () => {
    // Only the `sheet` branch changed; `inline`/`pinned`/`status`/
    // `screen` still render the same `Card`.
    const code = readPanelCode();
    expect(code).toMatch(/element\.placement === "sheet"/);
    expect(code).toMatch(/<Card style=\{styles\.card\} testID=\{testId\}>/);
  });
});
