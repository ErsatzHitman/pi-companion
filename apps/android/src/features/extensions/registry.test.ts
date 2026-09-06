import { describe, expect, it } from "vitest";

import {
  PI_UI_MAX_PAYLOAD_BYTES,
  PiUiRendererRegistry,
  estimatePiUiPayloadBytes,
  isPiUiPayloadOversized,
  piUiActionTarget,
} from "./registry";

/**
 * Android T34A1 renderer registry (plan.md §11.4). This file, along with
 * `registry-plan.test.ts` and `registry-boundary-reset.test.ts`, covers
 * every piece of `registry.ts`/`registry-plan.ts`/
 * `registry-boundary-reset.ts` that contains no `react-native` import —
 * i.e. everything that can actually be imported and executed under this
 * workspace's plain `vitest` setup.
 *
 * `registry-view.tsx`, `registry-boundary.tsx`, `registry-diagnostic.tsx`,
 * and `registry-confirm.tsx` are deliberately NOT imported from any test
 * file in this workspace: each pulls in `react-native` (directly or via
 * `../../ui/primitives`), whose source is Flow-annotated. Importing it
 * under this workspace's `vitest` config fails at parse time —
 *
 * ```
 * RolldownError: Parse failure: Parse failed with 1 error:
 * Flow is not supported
 *   at file: node_modules/react-native/index.js:1:0
 * ```
 *
 * — reproduced directly against `import("react-native")` while building
 * this task. This is a pre-existing limitation of this workspace, not
 * something introduced here: every other Android test file already avoids
 * importing a `react-native`-backed module for the same reason (see
 * `../../ui/primitives/touch-targets.test.ts` and
 * `../../ui/recipes/recipe-accessibility.test.ts`, which read component
 * source text with `fs.readFileSync` rather than importing the modules).
 * `registry.ts`/`registry-plan.ts`/`registry-boundary-reset.ts` exist as
 * separate, `react-native`-free modules specifically so the decision logic
 * behind all three T34A1 acceptance criteria stays unit-testable here; see
 * those two test files for "an unknown kind produces one diagnostic" and
 * "oversized payloads are capped with an explanation", and
 * `registry-boundary-reset.test.ts` for the boundary's reset contract.
 */

describe("PiUiRendererRegistry", () => {
  it("registers, looks up, and lists renderers by kind", () => {
    const registry = new PiUiRendererRegistry();
    expect(registry.has("status")).toBe(false);
    expect(registry.kinds()).toEqual([]);

    function StatusRenderer() {
      return null;
    }
    registry.register("status", StatusRenderer as never);

    expect(registry.has("status")).toBe(true);
    expect(registry.get("status")).toBe(StatusRenderer);
    expect(registry.kinds()).toEqual(["status"]);
  });

  it("register overwrites a prior registration for the same kind", () => {
    const registry = new PiUiRendererRegistry();
    function First() {
      return null;
    }
    function Second() {
      return null;
    }
    registry.register("widget", First as never);
    registry.register("widget", Second as never);
    expect(registry.get("widget")).toBe(Second);
    expect(registry.kinds()).toEqual(["widget"]);
  });

  it("clear removes every registration", () => {
    const registry = new PiUiRendererRegistry();
    registry.register("status", (() => null) as never);
    registry.register("widget", (() => null) as never);
    registry.clear();
    expect(registry.kinds()).toEqual([]);
    expect(registry.has("status")).toBe(false);
  });
});

describe("payload size helpers", () => {
  it("estimates UTF-8 byte size, not UTF-16 code units", () => {
    expect(estimatePiUiPayloadBytes(undefined)).toBe(0);
    expect(estimatePiUiPayloadBytes({ kind: "status", text: "abc" })).toBeGreaterThan(0);
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes once JSON-quoted.
    const ascii = estimatePiUiPayloadBytes({ kind: "status", text: "a" });
    const accented = estimatePiUiPayloadBytes({ kind: "status", text: "é" });
    expect(accented).toBeGreaterThan(ascii);
  });

  it("counts a 4-byte UTF-8 sequence (surrogate pair) as 4 bytes, not 3 or 6", () => {
    // U+1F600 GRINNING FACE — one UTF-16 surrogate pair, one UTF-8 4-byte
    // sequence once JSON-quoted (plus the two quote bytes JSON.stringify adds).
    const bytes = estimatePiUiPayloadBytes("😀");
    expect(bytes).toBe(4 + 2);
  });

  it("flags a payload over the cap and stays under the default cap for a normal payload", () => {
    expect(isPiUiPayloadOversized({ kind: "status", text: "hi" })).toBe(false);
    expect(isPiUiPayloadOversized({ kind: "log", lines: [] }, 100 /* generous custom cap */)).toBe(
      false,
    );
    expect(isPiUiPayloadOversized({ kind: "markdown", text: "x".repeat(100) }, 10)).toBe(true);
  });

  it("treats an unstringifiable payload as oversized rather than throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimatePiUiPayloadBytes(circular)).toBe(Number.POSITIVE_INFINITY);
    expect(isPiUiPayloadOversized(circular, PI_UI_MAX_PAYLOAD_BYTES)).toBe(true);
  });

  it("PI_UI_MAX_PAYLOAD_BYTES matches the web registry's default (64 KiB)", () => {
    expect(PI_UI_MAX_PAYLOAD_BYTES).toBe(64 * 1024);
  });
});

describe("piUiActionTarget", () => {
  it("composes the composite action identity", () => {
    expect(piUiActionTarget("agt_1", { ns: "loop", id: "controls" }, "stop")).toEqual({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "controls",
      actionId: "stop",
    });
  });
});
