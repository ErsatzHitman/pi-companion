import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { extensions, testing, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiElementView } from "./registry-view.js";
import { piUiRendererRegistry } from "./registry.js";
import "./renderers/index.js";

/**
 * T40A3 — "Every §11.7 extension has a working web renderer."
 *
 * Uses T40A2's real `@picompanion/frontend-core` fixtures
 * (`testing.extensions`, exported via T98) — not a thirteenth set of
 * hand-rolled payloads — and mounts each fixture's element(s) through the
 * *real* production pipeline: `renderers/index.js`'s actual registrations
 * (imported for its side effect above, exactly as `rail-element-card.tsx`
 * does in the running app) feeding `PiUiElementView`, the same component
 * `root-route.tsx` reaches on every route.
 *
 * "A count is not a mapping": `EXTENSION_TO_PLAN_ROW` below is an explicit,
 * per-extension citation of plan.md §11.7's own required-UI text for that
 * row, and every top-level kind (plus, for a `panel`, every one of its
 * sections' kinds — panel composes other kinds through this exact registry,
 * `renderers/panel.tsx`) is asserted to have actually mounted, by its own
 * kind-and-identity-specific `data-testid` (`pi-<kind>-<ns>-<id>`, the
 * convention every one of the ten registered renderers uses) — not merely
 * "some text appeared somewhere" and not merely "the registry `.has()` this
 * kind", which would not prove a live element with this exact identity
 * rendered without falling through to the unknown-kind/no-renderer/invalid-
 * payload diagnostic fallback (`registry-view.tsx`).
 *
 * T104: `EXTENSION_TO_PLAN_ROW`'s citations used to feed only the `it(...)`
 * title below — a wrong or stale value renamed a test instead of failing
 * one. `PLAN_SECTION_117_ROWS`, parsed live from plan.md's own content via
 * `testing.parseSection117BridgeElementsTable` (`@picompanion/frontend-core`,
 * T104; this file reads plan.md off disk itself — see that module's doc
 * comment for why it must stay `node:fs`-free), drives both (a) the
 * coverage list itself (`EXPECTED_EXTENSIONS`, so a 13th plan.md row with
 * no fixture now fails a named test instead of nothing) and (b) a
 * dedicated "matches plan.md §11.7 verbatim" assertion that fails, by
 * name, the moment `EXTENSION_TO_PLAN_ROW` drifts from the real table in
 * either direction (wrong text, missing row, or an extra stale key) — not
 * merely a renamed `it(...)`.
 */

afterEach(cleanup);

/** Deterministic no-op `Clock` — no timer ever needs to fire in these tests. */
class NullClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

function makeController(): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new NullClock(),
    sendRequest: () => {},
  });
}

/**
 * T104: parsed live out of plan.md's own content (read below) via
 * `testing.parseSection117BridgeElementsTable` (`@picompanion/frontend-core`)
 * — the single source of truth for which extensions are covered and what
 * their cited text must read. `EXTENSION_TO_PLAN_ROW` below stays
 * hand-written (kept for a readable, static `it(...)` title per
 * extension), but is now checked against these rows verbatim, below.
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
const PLAN_SECTION_117_ROWS = testing.parseSection117BridgeElementsTable(planMarkdown);
const EXPECTED_EXTENSIONS = PLAN_SECTION_117_ROWS.map((row) => row.extension).sort();

/** Every §11.7 "First-class UI through bridge elements" row, cited verbatim. */
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

/** `pi-<kind>-<ns>-<id>` is the test id every one of the ten registered kind renderers emits (verified directly in each renderer's own module). */
function testIdFor(el: { kind: string; ns: string; id: string }): string {
  return `pi-${el.kind}-${el.ns}-${el.id}`;
}

/**
 * The top-level element's own test id, plus one level of `panel` section
 * test ids (`renderers/panel.tsx` builds each section a full `PiUiElement`
 * with the section's own `ns`/`id`/`kind` and renders it through this same
 * registry — bounded to one level because the wire schema's `PiUiLeafKind`
 * already excludes nested panels).
 */
function expectedTestIdsFor(el: PiUiElement): string[] {
  const ids = [testIdFor(el)];
  const payload = el.payload as
    | { sections?: Array<{ id: string; ns?: string; kind: string }> }
    | undefined;
  if (el.kind === "panel" && payload && Array.isArray(payload.sections)) {
    for (const section of payload.sections) {
      ids.push(testIdFor({ kind: section.kind, ns: section.ns ?? el.ns, id: section.id }));
    }
  }
  return ids;
}

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

describe.each(EXPECTED_EXTENSIONS)("§11.7 web renderer — %s", (extension) => {
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

  it(`renders every fixture element for "${requiredUi}" through the real registry, with no diagnostic fallback`, () => {
    const elements = upsertElements(extension);
    expect(elements.length, `${extension} fixture has no upsert elements`).toBeGreaterThan(0);

    for (const element of elements) {
      const { container, unmount } = render(
        <PiUiElementView
          element={element}
          agentId="agt_t40a3_render"
          actionController={makeController()}
        />,
      );

      for (const expectedTestId of expectedTestIdsFor(element)) {
        expect(
          screen.queryByTestId(expectedTestId),
          `expected "${expectedTestId}" (extension "${extension}", element ${element.ns}:${element.id}) to render`,
        ).not.toBeNull();
      }

      // The unknown-kind / no-renderer / invalid-payload fallback
      // (`registry-view.tsx`'s `ExtensionDiagnostic`) must never have fired
      // for a real §11.7 fixture — the whole point of "a working renderer".
      expect(container.querySelector(".pc-extension-diagnostic")).toBeNull();
      expect(container.querySelector(".pc-pi-panel__section--diagnostic")).toBeNull();

      unmount();
    }
  });
});

describe("§11.7 web renderer coverage — mutation sentinel", () => {
  // "A check that only matches shape is hollow": prove the assertions above
  // actually discriminate a genuinely broken renderer, not merely that a
  // `data-testid` string happened to match. Clearing (then restoring) the
  // registry is the one legitimate way to induce the "no renderer
  // registered yet" fallback from the *outside* of a renderer's own module.
  it("fails to find the panel test id once the registry is cleared, and recovers once re-registered", () => {
    const elements = upsertElements("loop");
    const panelElement = elements.find((el) => el.kind === "panel");
    if (!panelElement) throw new Error("expected loop's fixture to include a panel element");

    const savedRenderers = new Map(
      piUiRendererRegistry.kinds().map((kind) => [kind, piUiRendererRegistry.get(kind)!]),
    );
    try {
      piUiRendererRegistry.clear();
      const { container, unmount } = render(
        <PiUiElementView
          element={panelElement}
          agentId="agt_t40a3_sentinel"
          actionController={makeController()}
        />,
      );
      expect(screen.queryByTestId(testIdFor(panelElement))).toBeNull();
      expect(container.querySelector(".pc-extension-diagnostic")).not.toBeNull();
      unmount();
    } finally {
      for (const [kind, renderer] of savedRenderers) piUiRendererRegistry.register(kind, renderer);
    }

    // Recovery: the same element renders normally again once the real
    // registrations are back, proving the failure above came from the
    // cleared registry and nothing else about the fixture or test setup.
    render(
      <PiUiElementView
        element={panelElement}
        agentId="agt_t40a3_sentinel"
        actionController={makeController()}
      />,
    );
    expect(screen.queryByTestId(testIdFor(panelElement))).not.toBeNull();
  });
});
