import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extensions } from "@picompanion/frontend-core";
import { PiUiElementSchema, type PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import {
  DEFAULT_DIFF_CHANGE_LINE_CAP,
  buildDiffRenderModel,
  countDiffLines,
  parseUnifiedDiffLines,
} from "./diff-model";

/**
 * T34B3 — the Android `diff` kind renderer's model. Acceptance criteria
 * exercised here:
 *
 * - "Diffs render from shared fixtures with correct counts": both the
 *   recorded `packages/protocol/src/fixtures/pi-ui-bridge/diff.json`
 *   envelope (enriched with a real canonical payload, run through the
 *   real wire schema and normalizer, exactly as `registry-view.tsx` would
 *   hand it to `DiffRenderer`) and the canonical synthetic fixture from
 *   `docs/pi-extension-compatibility.md` §4 are exercised, plus a
 *   realistic multi-hunk diff with git metadata, to prove `added`/
 *   `removed` count only real `+`/`-` change lines — never hunk headers,
 *   `diff --git`/`index`/`---`/`+++` metadata, or context lines.
 * - "Large diffs are bounded": the boundary is tested exactly at the cap
 *   (both a caller-supplied cap, and the real exported default,
 *   `DEFAULT_DIFF_CHANGE_LINE_CAP`) in both directions — one line under
 *   never truncates, one line over truncates by exactly one, with a
 *   named notice carrying the true total.
 *
 * `diff.tsx` cannot be rendered under this workspace's `vitest`
 * (`RolldownError` on `node_modules/react-native/index.js:1:0`, as
 * `roster-model.test.ts`/`form-model.test.ts` note); render proof belongs
 * to the T37 Maestro flows. This file exercises only the RN-free model.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(
  here,
  "../../../../../../packages/protocol/src/fixtures/pi-ui-bridge",
);

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadDiffFixture(): PiUiBridgeFixture {
  const path = join(PI_UI_BRIDGE_FIXTURES_DIR, "diff.json");
  return JSON.parse(readFileSync(path, "utf8")) as PiUiBridgeFixture;
}

/** The recorded `diff.json` fixture's one `upsert` element (`review`'s `hotfix-patch`). */
function recordedDiffElement(): Record<string, unknown> {
  const fixture = loadDiffFixture();
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
  throw new Error("diff.json fixture has no recorded upsert element");
}

/**
 * The recorded `diff` element, enriched with a real canonical `payload`
 * (the fixture's own recorded frame predates `piUiPayloadV2` for this
 * element, same as `form-model.test.ts`'s and `roster-model.test.ts`'s
 * fixtures). Run through the real wire schema and the real client-side
 * normalizer — exactly the element `registry-view.tsx` hands
 * `DiffRenderer`.
 */
function diffElement(payloadFields: Record<string, unknown>): PiUiElement {
  const recorded = recordedDiffElement();
  const envelope = PiUiElementSchema.parse({
    ...recorded,
    payload: { kind: "diff", ...payloadFields },
  });
  return extensions.normalizePiUiElementTyped(envelope);
}

function diffPayloadOf(element: PiUiElement): PiUiPayloadForKind<"diff"> {
  expect(element.payload).toBeDefined();
  expect(element.payload?.kind).toBe("diff");
  return element.payload as PiUiPayloadForKind<"diff">;
}

/** A realistic multi-hunk unified diff, with git metadata this renderer must never miscount. */
const REALISTIC_UNIFIED_DIFF = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,4 +1,5 @@",
  " export function foo() {",
  "-  return 1;",
  "+  const value = 2;",
  "+  return value;",
  " }",
].join("\n");

/** Builds a synthetic unified diff with exactly `count` added lines, one hunk. */
function unifiedDiffWithAddedLines(count: number): string {
  const lines = [
    "--- a/synthetic.ts",
    "+++ b/synthetic.ts",
    `@@ -0,0 +1,${count} @@`,
    ...Array.from({ length: count }, (_, index) => `+line ${index}`),
  ];
  return lines.join("\n");
}

describe("parseUnifiedDiffLines / countDiffLines", () => {
  it("classifies every documented unified-diff line kind", () => {
    const lines = parseUnifiedDiffLines(REALISTIC_UNIFIED_DIFF);
    expect(lines.map((line) => line.kind)).toEqual([
      "meta", // diff --git
      "meta", // index
      "meta", // --- a/
      "meta", // +++ b/
      "hunk", // @@ ... @@
      "context",
      "remove",
      "add",
      "add",
      "context",
    ]);
  });

  it("counts only real +/- change lines, never metadata/hunk/context lines", () => {
    const lines = parseUnifiedDiffLines(REALISTIC_UNIFIED_DIFF);
    expect(countDiffLines(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("returns no lines for an empty diff", () => {
    expect(parseUnifiedDiffLines("")).toEqual([]);
    expect(countDiffLines(parseUnifiedDiffLines(""))).toEqual({ added: 0, removed: 0 });
  });
});

describe("buildDiffRenderModel: correct counts from shared fixtures", () => {
  it("renders the recorded diff.json fixture's element with correct counts", () => {
    const element = diffElement({
      unifiedDiff: REALISTIC_UNIFIED_DIFF,
      filePath: "src/foo.ts",
      language: "ts",
    });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.title).toBe("Proposed patch: apply hotfix to src/index.ts");
    expect(model.path).toBe("src/foo.ts");
    expect(model.added).toBe(2);
    expect(model.removed).toBe(1);
    expect(model.modified).toBe(0);
    expect(model.emptyText).toBeUndefined();
    expect(model.visibleChangeLines).toEqual([
      { key: 0, kind: "remove", marker: "-", content: "  return 1;" },
      { key: 1, kind: "add", marker: "+", content: "  const value = 2;" },
      { key: 2, kind: "add", marker: "+", content: "  return value;" },
    ]);
  });

  it("renders docs/pi-extension-compatibility.md §4's canonical synthetic diff fixture", () => {
    // {"kind":"diff","id":"synthetic:synthetic-diff","ns":"synthetic",
    //  "unifiedDiff":"--- a/synthetic.ts\n+++ b/synthetic.ts\n@@\n-synthetic-old\n+synthetic-new\n"}
    const element: PiUiElement = {
      id: "synthetic-diff",
      ns: "synthetic",
      kind: "diff",
      placement: "inline",
      payload: {
        kind: "diff",
        unifiedDiff: "--- a/synthetic.ts\n+++ b/synthetic.ts\n@@\n-synthetic-old\n+synthetic-new\n",
      },
    } as PiUiElement;
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.added).toBe(1);
    expect(model.removed).toBe(1);
    expect(model.visibleChangeLines.map((line) => line.content)).toEqual([
      "synthetic-old",
      "synthetic-new",
    ]);
    // No explicit `title` on this fixture: falls back to the humanized ns.
    expect(model.title).toBe("Synthetic");
    // No explicit `filePath` either: path falls back to the (fallback) title.
    expect(model.path).toBe("Synthetic");
  });

  it("shows an empty-changes notice for a diff with no + or - lines", () => {
    const element = diffElement({ unifiedDiff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n context only\n" });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.added).toBe(0);
    expect(model.removed).toBe(0);
    expect(model.visibleChangeLines).toEqual([]);
    expect(model.emptyText).toBe("No changes to show.");
  });

  it("shows an empty-changes notice for a completely empty diff", () => {
    const element = diffElement({ unifiedDiff: "" });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.emptyText).toBe("No changes to show.");
    expect(model.visibleChangeLines).toEqual([]);
  });
});

describe("buildDiffRenderModel: large diffs are bounded exactly at the cap", () => {
  it("does not truncate at exactly a caller-supplied cap", () => {
    const element = diffElement({ unifiedDiff: unifiedDiffWithAddedLines(5) });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload, 5);

    expect(model.totalChangeLines).toBe(5);
    expect(model.visibleChangeLines).toHaveLength(5);
    expect(model.hiddenCount).toBe(0);
    expect(model.truncatedNotice).toBeUndefined();
  });

  it("truncates by exactly one line one over a caller-supplied cap, with a named notice", () => {
    const element = diffElement({ unifiedDiff: unifiedDiffWithAddedLines(6) });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload, 5);

    expect(model.added).toBe(6); // the full count is never truncated
    expect(model.totalChangeLines).toBe(6);
    expect(model.visibleChangeLines).toHaveLength(5);
    expect(model.hiddenCount).toBe(1);
    expect(model.truncatedNotice).toBe("Showing first 5 of 6 changed lines (1 more line hidden).");
  });

  it("pluralizes the notice for more than one hidden line", () => {
    const element = diffElement({ unifiedDiff: unifiedDiffWithAddedLines(8) });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload, 5);

    expect(model.hiddenCount).toBe(3);
    expect(model.truncatedNotice).toBe("Showing first 5 of 8 changed lines (3 more lines hidden).");
  });

  it("does not truncate at exactly the real default cap (200)", () => {
    expect(DEFAULT_DIFF_CHANGE_LINE_CAP).toBe(200);
    const element = diffElement({ unifiedDiff: unifiedDiffWithAddedLines(200) });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.totalChangeLines).toBe(200);
    expect(model.visibleChangeLines).toHaveLength(200);
    expect(model.hiddenCount).toBe(0);
    expect(model.truncatedNotice).toBeUndefined();
  });

  it("truncates by exactly one line one over the real default cap", () => {
    const element = diffElement({ unifiedDiff: unifiedDiffWithAddedLines(201) });
    const payload = diffPayloadOf(element);
    const model = buildDiffRenderModel(element, payload);

    expect(model.totalChangeLines).toBe(201);
    expect(model.visibleChangeLines).toHaveLength(200);
    expect(model.hiddenCount).toBe(1);
    expect(model.truncatedNotice).toBe(
      "Showing first 200 of 201 changed lines (1 more line hidden).",
    );
  });
});
