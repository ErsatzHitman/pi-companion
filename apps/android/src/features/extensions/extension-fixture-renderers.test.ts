import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { testing } from "@picompanion/frontend-core";
import type {
  PiUiElement,
  PiUiKind,
  PiUiPanelSection,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import { piUiRendererRegistry, PiUiRendererRegistry, type PiUiKindRenderer } from "./registry";
import { resolvePiUiElementRenderDecision } from "./registry-plan";

/**
 * T40B1 — "Every §11.7 extension is covered on android: the renderer
 * receives the element and produces the right output" plus "the action
 * path is proven ... by the action arriving at a recording fake" (that
 * half lives in `extension-fixture-actions.test.ts`).
 *
 * Uses T40A2's real `@picompanion/frontend-core` fixtures
 * (`testing.extensions`, T98) — the same twelve fixtures
 * `apps/web/src/features/extensions/extension-fixture-renderers.test.tsx`
 * (T40A3) drives — never a thirteenth hand-rolled set, so a real
 * production-shape defect (daemon or client) shows up identically on both
 * platforms' matrices.
 *
 * Android cannot mount a component under this workspace's `vitest`
 * (`registry.test.ts`'s doc comment: `react-native`'s Flow-annotated source
 * fails to parse unless `vi.mock`-intercepted first) — and even with
 * `react-native` mocked (below), the mock's `View`/`Text` stubs return
 * `null`, since nothing in this workspace can run RN's actual native
 * host-component renderer; a `react-test-renderer` tree built from those
 * stubs would have nothing real to inspect either. This is not a
 * `react`/`react-test-renderer` *version* conflict — confirmed directly: a
 * plain `react-test-renderer` render of an RN-free element under this exact
 * `vitest` config produces no parse or version error, only an empty tree,
 * once `react-native` itself is off the import path; this workspace
 * resolves a single, shared `react@19.2.8` everywhere via npm's hoisting
 * (`apps/android/package.json`'s own looser `19.1.0` declaration
 * notwithstanding), matching `react-test-renderer`'s `^19.2.8` peer
 * requirement exactly. So "the renderer receives the element and produces
 * the right output" is proven here in the two halves this workspace's
 * `vitest` CAN exercise, matching this directory's now-standing pattern
 * (`renderers-model.test.ts`, `panel-model.test.ts`):
 *
 * 1. **Wiring**: `react-native`/`react-native-reanimated` are mocked
 *    (`registry-index.test.ts`'s established, enumerated-stand-in
 *    technique) so `./renderers/index.ts` — the real module every kind
 *    renderer registers itself from, at the real app's one real import
 *    site (`registry-index.ts`) — can be imported for its real side
 *    effect. Every fixture element (and, for a `panel`, every one of its
 *    sections, through the real `buildPanelRenderModel`/
 *    `resolvePiUiElementRenderDecision` pipeline) is proven to resolve to
 *    `"ok"` against the REAL populated registry, with the REAL registered
 *    component's identity (not merely `registry.has(kind)`, which cannot
 *    tell an `"ok"` decision from an oversized/invalid one that still
 *    named a kind the registry recognizes) — the same "no diagnostic
 *    fallback" bar the web test enforces via the DOM.
 * 2. **Content**: each resolved element's REAL, validated payload is fed to
 *    the REAL, RN-free per-kind model builder (`buildStatusRenderModel`,
 *    `buildRosterRenderModel`, ...) that kind's `.tsx` view renders
 *    straight from (verified directly: every renderer file in this
 *    directory is a thin wrapper calling exactly one `build*RenderModel`
 *    and mapping its fields onto RN primitives), and the model's own
 *    computed text is asserted to contain the fixture's real content —
 *    never a value this test invented.
 *
 * T118: `EXTENSION_TO_PLAN_ROW` below used to be a hand-copied map whose
 * values fed only the `it(...)` title at the bottom of this file — a wrong
 * or stale value renamed a test instead of failing one (the exact defect
 * T104 closed on web/core in `0bcbad3`, then T40B1 reopened here in the
 * very next commit of the same wave by starting from the pre-T104 file).
 * `PLAN_SECTION_117_ROWS`, parsed live from plan.md's own content via
 * `testing.parseSection117BridgeElementsTable` (`@picompanion/frontend-core`,
 * T104 — this file reads plan.md off disk itself, matching
 * `extension-fixture-renderers.test.tsx`'s web-side shape exactly; see
 * that module's doc comment for why the parser itself must stay
 * `node:fs`-free), now drives both (a) `EXPECTED_EXTENSIONS` (so a 13th
 * plan.md row with no fixture fails a named test instead of nothing) and
 * (b) a dedicated "cites plan.md §11.7 verbatim" assertion that fails, by
 * name, the moment `EXTENSION_TO_PLAN_ROW` drifts from the real table in
 * either direction. `node:fs`/`node:path`/`node:url` are fine here — this
 * is a `*.test.ts` file, excluded from `tsconfig.json`'s ambient-type-free
 * build (see `plan-table.ts`'s own doc comment).
 */

vi.mock("react-native", () => {
  function Stub(): null {
    return null;
  }
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Stub,
    View: Stub,
    Pressable: Stub,
    ScrollView: Stub,
    Modal: Stub,
    TextInput: Stub,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    findNodeHandle: () => null,
    useColorScheme: () => "light",
    Linking: { openURL: async () => true },
  };
});

vi.mock("react-native-reanimated", () => {
  function Stub(): null {
    return null;
  }
  const Animated = { View: Stub, Text: Stub, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    Easing: { ease: (v: number) => v, out: (fn: unknown) => fn, linear: (v: number) => v },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});

// T349: `ui/primitives/index.ts` now also exports `VectorIcon`
// (`vector-icons.tsx`), whose `react-native-svg` import carries the same
// unparseable-by-plain-vitest source every `react-native` package in this
// file's chain does. Stood in for exactly like the two mocks above, and
// for the same reason: nothing here renders, so an inert stand-in is
// enough for an import-only test. Enumerated, not generic -- the members
// are the ones `vector-icons.tsx` actually imports today, so adding a new
// SVG element there is a deliberate two-file change, not a silent one.
vi.mock("react-native-svg", () => {
  function Stub(): null {
    return null;
  }
  return { default: Stub, Circle: Stub, Path: Stub, Rect: Stub };
});

const renderers = await import("./renderers/index.js");

/** Every kind this test needs a real component identity for — the nine leaf kinds plus `panel`, spanning all twelve §11.7 fixtures. */
const RENDERER_BY_KIND: Record<string, PiUiKindRenderer> = {
  status: renderers.StatusRenderer as PiUiKindRenderer,
  widget: renderers.WidgetRenderer as PiUiKindRenderer,
  progress: renderers.ProgressRenderer as PiUiKindRenderer,
  log: renderers.LogRenderer as PiUiKindRenderer,
  markdown: renderers.MarkdownRenderer as PiUiKindRenderer,
  composer: renderers.ComposerRenderer as PiUiKindRenderer,
  roster: renderers.RosterRenderer as PiUiKindRenderer,
  form: renderers.FormRenderer as PiUiKindRenderer,
  panel: renderers.PanelRenderer as PiUiKindRenderer,
};

/**
 * T118: walks up from this file's own directory to find plan.md, exactly
 * as `extension-fixture-renderers.test.tsx` (web, T104) does — this file
 * is the reader; `parseSection117BridgeElementsTable` itself stays
 * `node:fs`-free (see that module's doc comment).
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

/**
 * T118: parsed live out of plan.md's own content via
 * `testing.parseSection117BridgeElementsTable` — the single source of
 * truth for which extensions are covered and what their cited text must
 * read. This is what makes a 13th plan.md row, or a changed "Required UI"
 * cell, fail a named test here instead of silently renaming one.
 */
const PLAN_SECTION_117_ROWS = testing.parseSection117BridgeElementsTable(planMarkdown);
const EXPECTED_EXTENSIONS = PLAN_SECTION_117_ROWS.map((row) => row.extension).sort();

/**
 * Every §11.7 "First-class UI through bridge elements" row, cited
 * verbatim (plan.md §11.7). Kept hand-written for a readable, static
 * `it(...)` title per extension (below) — but checked against
 * `PLAN_SECTION_117_ROWS` verbatim by the test right after this map, so a
 * wrong or stale value fails there by name, rather than merely renaming
 * the per-extension renderer test's title (T118 — the defect T104 closed
 * on web/core and T40B1 reopened here).
 */
const EXTENSION_TO_PLAN_ROW: Record<string, string> = {
  loop: "panel containing status, markdown, roster, progress, and log; stop/details actions",
  btw: "secondary conversation screen with markdown and composer",
  subagents: "prominent roster with running, blocked, done, usage, and cancel/open actions",
  todo: "pinned task widget with collapse and item state",
  advisor: "widget/panel with status, markdown, tool activity, and logs",
  switchboard: "key-health roster, cooldown state, and management form",
  workflows: "approval form, progress, roster, and logs",
  "minimal-status": "native status information, not a copied terminal footer",
  "plan-mode": "mode status with toggle action",
  "pi-goal": "goal status, rounds, budget, blocked/waiting state",
  "prompt-arbitrage": "status plus composer replacement with undo",
  "ask-user": "rich form with search, descriptions, multi-select, and optional comment",
};

it("§11.7's bridge-elements table (parsed live from plan.md) has a fixture for every row, and no extra fixtures", () => {
  expect(testing.extensions.listExtensionFixtures()).toEqual(EXPECTED_EXTENSIONS);
});

it("EXTENSION_TO_PLAN_ROW cites plan.md §11.7's Required UI text verbatim, for exactly its rows — a wrong or stale value fails HERE, not by silently renaming a renderer test's title", () => {
  const fromPlanTable = Object.fromEntries(
    PLAN_SECTION_117_ROWS.map((row) => [row.extension, row.requiredUi]),
  );
  expect(EXTENSION_TO_PLAN_ROW).toEqual(fromPlanTable);
});

/** Real, fixture-derived text fragments every extension's real model output must contain somewhere. Every fragment is copied verbatim from that extension's own scenario file. */
const EXPECTED_TEXT_FRAGMENTS: Record<string, string[]> = {
  loop: [
    "Loop · review · round 2 of 5", // panel title
    "consulting — review", // status section
    "Review changes to", // markdown section
    "reviewer", // roster section
    "implementer",
    "round 2 of 5", // progress section label
    "reply received", // log section
  ],
  btw: [
    "btw · opencode/deepseek-v4-flash · high", // panel title
    "busy · 4s", // status
    "synthetic question about", // markdown thread
    "Ask btw", // composer-standin form title/field label
  ],
  subagents: [
    "Subagent fleet (1 running)",
    "research: synthetic query",
    "lint: synthetic sweep",
    "docs: synthetic summary",
  ],
  todo: ["Todos (1/3)", "synthetic task 1", "synthetic task 2", "synthetic task 3"],
  advisor: [
    "Advisor · synthetic-model · 6s",
    "consulting",
    "Synthetic advisor answer",
    "read /tmp/synthetic.ts",
    "reply: 512 chars streamed",
  ],
  switchboard: [
    "switchboard · opencode-go · ON · 3 keys",
    "sk-synthetic-***1234",
    "healthy · cooldown 0m",
    "active sk-synthetic-***1234",
    "Add key",
  ],
  workflows: [
    "Workflow · issue-graph · implement (step 2 of 5)",
    "Approve step 2 of 5",
    "plan",
    "implement",
    "applying synthetic patch",
  ],
  "minimal-status": ["Build · /tmp/synthetic-dir · main · opencode/deepseek · high"],
  "plan-mode": ["Plan · read-only · synthetic reasoning"],
  "pi-goal": ["Synthetic objective — /tmp/synthetic.ts (round 2, budget 1.2k/100k)"],
  "prompt-arbitrage": ["Rewriting with opencode-go/minimax-m3", "Synthetic rewritten prompt"],
  "ask-user": [
    "Deploy target?",
    "Pick a target",
    "Synthetic question",
    "Space selects · Enter confirms · Esc cancels",
  ],
};

/** Every top-level upserted element across a scenario's frames, in order. */
function upsertElements(extension: string): PiUiElement[] {
  const scenario = testing.extensions.loadExtensionFixture(extension);
  const elements: PiUiElement[] = [];
  for (const frame of scenario.frames) {
    if (!frame.wireType.includes("agent_stream:pi_ui_delta")) continue;
    const event = testing.extensions.agentStreamEventFromFrame(frame);
    if (event.type !== "pi_ui_delta" || event.delta.op !== "upsert") continue;
    elements.push(event.delta.element);
  }
  return elements;
}

/** The real, RN-free per-kind model builder's own computed primary text — never re-derived from the raw payload. */
function primaryTextFor(
  kind: PiUiKind,
  element: Pick<PiUiElement, "ns" | "title">,
  payload: unknown,
): string {
  switch (kind) {
    case "status":
      return renderers.buildStatusRenderModel(element, payload as never).statusText;
    case "widget": {
      const m = renderers.buildWidgetRenderModel(element, payload as never);
      // Each row's own `accessibilityLabel` (not just `label`/`value`) so a
      // row's `detail` — e.g. todo's per-item path — is covered by the same
      // real, RN-free model output a screen reader would actually speak.
      const body =
        m.body.type === "rows"
          ? m.body.rows.map((r) => r.accessibilityLabel).join(" ")
          : m.body.type === "lines"
            ? m.body.lines.join(" ")
            : m.body.text;
      return `${m.title} ${body}`;
    }
    case "progress": {
      const m = renderers.buildProgressRenderModel(element, payload as never);
      return `${m.label} ${m.fraction?.text ?? ""}`;
    }
    case "roster": {
      const m = renderers.buildRosterRenderModel(element, payload as never);
      // Each row's own `accessibilityLabel` (label + state + detail + model
      // + elapsed) rather than bare `label`, so switchboard's per-key
      // cooldown detail and subagents' usage detail are both covered by
      // real model output, not a second hand-picked field list.
      return `${m.title} ${m.rows.map((r) => r.accessibilityLabel).join(" ")}`;
    }
    case "log": {
      const m = renderers.buildLogRenderModel(element, payload as never);
      return `${m.title} ${m.visibleLines.join(" ")}`;
    }
    case "markdown": {
      const m = renderers.buildMarkdownRenderModel(element, payload as never);
      expect(m.blocks.length).toBeGreaterThan(0);
      // The model's block AST is asserted non-empty above (proof the real
      // parser ran); the raw payload text is what a fragment check reads,
      // since flattening the AST back to prose is the parser's own concern,
      // already covered by `renderers-model.test.ts`'s markdown suite.
      return `${m.title ?? ""} ${(payload as { text: string }).text}`;
    }
    case "composer": {
      const m = renderers.buildComposerRenderModel(element, payload as never);
      return `${m.title} ${m.modeLabel} ${m.proposedText} ${m.previousText ?? ""}`;
    }
    case "form": {
      const p = payload as { fields: unknown[]; description?: string };
      const values = renderers.buildInitialFormValues(p.fields as never);
      const m = renderers.buildFormRenderModel(element, payload as never, values, {});
      return `${m.title} ${m.description ?? ""} ${m.fields.map((f) => f.field.label).join(" ")}`;
    }
    default:
      throw new Error(`unexpected §11.7 kind "${kind}" — not one of the nine leaf kinds`);
  }
}

/**
 * Resolves one element (and, for `panel`, every section one level deep —
 * the wire schema's `PiUiLeafKind` already excludes nested panels) through
 * the REAL populated registry, asserting `"ok"` and the real registered
 * component's identity, and collects every resolved kind's real model
 * output text.
 */
function collectRenderedTexts(element: PiUiElement, texts: string[]): void {
  const decision = resolvePiUiElementRenderDecision(element, piUiRendererRegistry);
  expect(
    decision.status,
    `expected "${element.ns}:${element.id}" (kind "${element.kind}") to resolve "ok", got "${decision.status}"`,
  ).toBe("ok");
  if (decision.status !== "ok") return;
  expect(decision.Renderer, `wrong renderer identity for kind "${element.kind}"`).toBe(
    RENDERER_BY_KIND[element.kind],
  );

  if (element.kind === "panel") {
    // A panel introduces no leaf content of its own (panel-model.ts's own
    // doc comment: "a panel introduces no visual language of its own") —
    // its title is the one piece of the element itself worth checking,
    // every other real fragment comes from its sections below.
    if (element.title) texts.push(element.title);
    const payload = decision.payload as { sections: PiUiPanelSection[] };
    const model = renderers.buildPanelRenderModel(element, payload as never, piUiRendererRegistry);
    expect(model.children.length, `panel "${element.ns}:${element.id}" has no sections`).toBe(
      payload.sections.length,
    );
    for (const child of model.children) {
      expect(
        child.status,
        `panel "${element.ns}:${element.id}" section "${child.sectionId}" (kind "${child.kind}") resolved "${child.status}", not "ok"`,
      ).toBe("ok");
      if (child.status !== "ok") continue;
      expect(child.Renderer, `wrong renderer identity for section kind "${child.kind}"`).toBe(
        RENDERER_BY_KIND[child.kind],
      );
      texts.push(primaryTextFor(child.kind as PiUiKind, child.element, child.payload));
    }
    return;
  }

  texts.push(primaryTextFor(element.kind, element, decision.payload));
}

describe.each(EXPECTED_EXTENSIONS)("§11.7 android renderer — %s", (extension) => {
  const requiredUi = EXTENSION_TO_PLAN_ROW[extension];
  if (requiredUi === undefined) {
    // A new plan.md §11.7 row with no matching EXTENSION_TO_PLAN_ROW entry
    // — fail loudly here too (belt-and-suspenders alongside the "cites
    // plan.md §11.7's Required UI text verbatim" test above) rather than
    // silently rendering an "undefined" title.
    throw new Error(
      `no EXTENSION_TO_PLAN_ROW citation for plan.md §11.7 row "${extension}" — add one`,
    );
  }

  it(`renders every fixture element for "${requiredUi}" through the real registry, with real content`, () => {
    const elements = upsertElements(extension);
    expect(elements.length, `${extension} fixture has no upsert elements`).toBeGreaterThan(0);

    const texts: string[] = [];
    for (const element of elements) collectRenderedTexts(element, texts);

    const fragments = EXPECTED_TEXT_FRAGMENTS[extension]!;
    for (const fragment of fragments) {
      expect(
        texts.some((text) => text.includes(fragment)),
        `expected some real rendered text for "${extension}" to include "${fragment}"; got: ${JSON.stringify(texts)}`,
      ).toBe(true);
    }
  });
});

describe("§11.7 android renderer coverage — mutation sentinel", () => {
  // "A check that only matches shape is hollow": prove the assertions above
  // actually discriminate a genuinely broken registry, not merely that a
  // kind string happened to match. Clearing (then restoring) the registry
  // is the one legitimate way to induce the "no renderer registered yet"
  // decision from the *outside* of a renderer's own module — mirrors the
  // web test's identical sentinel.
  it("flips the loop panel's decision to no-renderer once the registry is cleared, and recovers once re-registered", () => {
    const [loopPanel] = upsertElements("loop");
    if (!loopPanel) throw new Error("expected loop's fixture to include a panel element");

    const saved = new Map(
      piUiRendererRegistry.kinds().map((kind) => [kind, piUiRendererRegistry.get(kind)!]),
    );
    try {
      piUiRendererRegistry.clear();
      const cleared = resolvePiUiElementRenderDecision(loopPanel, piUiRendererRegistry);
      expect(cleared.status).toBe("no-renderer");
    } finally {
      for (const [kind, renderer] of saved) piUiRendererRegistry.register(kind, renderer);
    }

    const restored = resolvePiUiElementRenderDecision(loopPanel, piUiRendererRegistry);
    expect(restored.status).toBe("ok");
  });

  it("an empty, unregistered registry (not the real singleton) never resolves ok — proves the assertions read the real registry, not a vacuously-true fallback", () => {
    const [loopPanel] = upsertElements("loop");
    if (!loopPanel) throw new Error("expected loop's fixture to include a panel element");
    const emptyRegistry = new PiUiRendererRegistry();
    const decision = resolvePiUiElementRenderDecision(loopPanel, emptyRegistry);
    expect(decision.status).toBe("no-renderer");
  });
});
