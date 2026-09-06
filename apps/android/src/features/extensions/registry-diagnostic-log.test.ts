import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiRendererRegistry } from "./registry";
import { describePiUiRenderDiagnosticLog } from "./registry-diagnostic-log";
import { resolvePiUiElementRenderDecision } from "./registry-plan";

/**
 * T40B1 — "Unknown channels produce exactly ONE diagnostic on the android
 * side, proven with a counting fake, and a known channel produces none."
 *
 * No "channel" concept ever reaches an Android client (see
 * `registry-diagnostic-log.ts`'s doc comment: every published channel is
 * synthesized into an ordinary element daemon-side, verified directly
 * against the `subagents`/`workflow`/`pi-goal` fixtures in
 * `extension-fixture-renderers.test.ts`). The client-side analogue this
 * file proves is the one `registry-view.tsx` actually implements: an
 * unrecognized/oversized/unrendered/invalid element decision produces
 * exactly one logged diagnostic, and a genuinely `"ok"` element produces
 * none — the true negative.
 *
 * A real counting-fake `Logger`-shaped object drives
 * `describePiUiRenderDiagnosticLog` directly (below) — that function *is*
 * the whole decision `registry-view.tsx` calls `elementLogger.warn` from
 * (its own doc comment). Whether `registry-view.tsx`'s component body
 * really calls it, with no second construction of the same message
 * anywhere else in that file, is proven the way every other decision in
 * this RN-blocked directory is proven not to be a decorative parallel
 * implementation: an anchored, comment-stripped source-text assertion,
 * mutation-checked (see this file's last `describe` block) — actually
 * rendering `PiUiElementView` and counting a real `Logger.warn` call is
 * unavailable in this workspace: `registry-index.test.ts`'s doc comment
 * already discloses the real blocker — `react-native`'s own Flow-annotated
 * source fails to parse under this workspace's plain `vitest` unless the
 * package is intercepted with `vi.mock` first, and a `vi.mock`-stubbed
 * `View`/`Text` (returning `null`, since nothing here can run RN's actual
 * host-component renderer) gives `react-test-renderer` nothing real to
 * inspect even where it is otherwise usable — confirmed directly: a plain
 * `react-test-renderer` render of an RN-free element under this exact
 * `vitest` config produces no parse or version error at all, only an empty
 * tree, once `react-native` itself is not on the import path. So the
 * blocker is the RN import, not a `react`/`react-test-renderer` version
 * mismatch (this workspace resolves a single, shared `react@19.2.8`
 * everywhere via npm's hoisting, matching `react-test-renderer`'s own
 * `^19.2.8` peer requirement, `apps/android/package.json`'s own looser
 * `19.1.0` declaration notwithstanding).
 */

function statusElement(overrides: Partial<PiUiElement> = {}): PiUiElement {
  return {
    id: "mode",
    ns: "plan-mode",
    kind: "status",
    placement: "status",
    title: "Plan mode",
    payload: { kind: "status", text: "Reviewing changes" },
    ...overrides,
  } as PiUiElement;
}

/** A real counting-fake — every call recorded, nothing read back from a log. */
function countingLogger() {
  const calls: { message: string; fields: Record<string, unknown> }[] = [];
  return {
    calls,
    warnIfDiagnostic(
      decision: ReturnType<typeof resolvePiUiElementRenderDecision>,
      element: PiUiElement,
    ) {
      // Exactly `registry-view.tsx`'s own real body: compute the log via
      // this module's real function, then warn only if one comes back.
      const log = describePiUiRenderDiagnosticLog(decision, element);
      if (log) calls.push(log);
    },
  };
}

describe("describePiUiRenderDiagnosticLog: counting-fake proof (T40B1)", () => {
  it("produces exactly one diagnostic call for an unknown-kind element", () => {
    const registry = new PiUiRendererRegistry();
    const element = statusElement({ kind: "not-a-real-kind" as never, payload: undefined });
    const decision = resolvePiUiElementRenderDecision(element, registry);

    const logger = countingLogger();
    logger.warnIfDiagnostic(decision, element);

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]!.message).toBe("Pi UI element has an unrecognized kind");
    expect(logger.calls[0]!.fields).toEqual({ kind: "not-a-real-kind" });
  });

  it("produces exactly one diagnostic call for each of the other three bad decisions, never more than one", () => {
    const emptyRegistry = new PiUiRendererRegistry();
    const registeredRegistry = new PiUiRendererRegistry();
    registeredRegistry.register("status", (() => null) as never);

    const cases: { name: string; decision: ReturnType<typeof resolvePiUiElementRenderDecision> }[] =
      [
        {
          name: "oversized",
          decision: resolvePiUiElementRenderDecision(
            statusElement({ payload: { kind: "status", text: "x".repeat(200) } as never }),
            registeredRegistry,
            10,
          ),
        },
        {
          name: "no-renderer",
          decision: resolvePiUiElementRenderDecision(statusElement(), emptyRegistry),
        },
        {
          name: "invalid-payload",
          decision: resolvePiUiElementRenderDecision(
            statusElement({ payload: undefined }),
            registeredRegistry,
          ),
        },
      ];

    for (const { name, decision } of cases) {
      expect(decision.status, name).not.toBe("ok");
      const logger = countingLogger();
      logger.warnIfDiagnostic(decision, statusElement());
      expect(logger.calls, `${name}: expected exactly one diagnostic call`).toHaveLength(1);
    }
  });

  it("produces ZERO diagnostic calls for a real, in-budget, validated element — the true negative", () => {
    const registry = new PiUiRendererRegistry();
    registry.register("status", (() => null) as never);
    const element = statusElement();
    const decision = resolvePiUiElementRenderDecision(element, registry);
    expect(decision.status).toBe("ok");

    const logger = countingLogger();
    logger.warnIfDiagnostic(decision, element);

    expect(logger.calls).toHaveLength(0);
  });
});

/**
 * Ties `registry-view.tsx`'s real (RN-backed, unrenderable-here) body to
 * the counting-fake-proven function above, the way every other decision in
 * this directory is anchored to its consuming `.tsx` file: comment-stripped
 * source text, brace-balance-free because this is a single expression
 * statement rather than a whole function, mutation-checked by editing the
 * real file, re-running, and reverting.
 */
function readRegistryViewSource(): string {
  return readFileSync(fileURLToPath(new URL("./registry-view.tsx", import.meta.url)), "utf8");
}

function readRegistryViewCode(): string {
  return readRegistryViewSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("registry-view.tsx source anchor (T40B1)", () => {
  it("imports describePiUiRenderDiagnosticLog and calls it exactly once, passing its result straight to elementLogger.warn", () => {
    const code = readRegistryViewCode();

    expect(code).toMatch(
      /import \{ describePiUiRenderDiagnosticLog \} from "\.\/registry-diagnostic-log";/,
    );

    const callSites = code.match(/describePiUiRenderDiagnosticLog\(/g) ?? [];
    expect(callSites).toHaveLength(1);

    // The one call site's result feeds `elementLogger.warn` directly —
    // never a second, independently-constructed message — and that warn
    // call is the file's only one (so a decision that resolves "ok" can
    // never reach it: the call sits inside the `decision.status !== "ok"`
    // branch this file returns from unconditionally).
    expect(code).toMatch(
      /const diagnosticLog = describePiUiRenderDiagnosticLog\(decision, element\);\s*\n\s*if \(diagnosticLog\) elementLogger\.warn\(diagnosticLog\.message, diagnosticLog\.fields\);/,
    );
    const warnCallSites = code.match(/elementLogger\.warn\(/g) ?? [];
    expect(warnCallSites).toHaveLength(1);
  });
});
