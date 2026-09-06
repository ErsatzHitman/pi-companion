import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { PiUiRendererRegistry } from "./registry";
import { resolvePiUiElementRenderDecision } from "./registry-plan";

/**
 * `resolvePiUiElementRenderDecision` unit coverage (plan.md §11.4; T34A1).
 * This is the pure decision `registry-view.tsx` renders straight from, so
 * proving its output here proves what `PiUiElementView` shows without
 * needing to render the (react-native-backed) component itself — see
 * `registry.test.ts`'s doc comment for why that can't happen in this
 * workspace.
 *
 * Directly exercises two of T34A1's three acceptance criteria:
 *
 * - "An unknown kind produces one diagnostic" (not many)
 * - "Oversized payloads are capped with an explanation"
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

describe("resolvePiUiElementRenderDecision: unknown-kind fallback", () => {
  it("produces exactly one diagnostic for a kind outside the frozen vocabulary", () => {
    const registry = new PiUiRendererRegistry();
    const element = statusElement({ kind: "not-a-real-kind" as never, payload: undefined });

    const decision = resolvePiUiElementRenderDecision(element, registry);

    expect(decision.status).toBe("unknown-kind");
    // One diagnostic object, not an array/list — nothing here can produce a
    // second one for the same element.
    if (decision.status === "unknown-kind") {
      expect(decision.diagnostic.title).toBe("Unrecognized element kind");
      expect(decision.diagnostic.message).toContain("not-a-real-kind");
      expect(decision.diagnostic.message).toContain("not one of the known Pi UI Bridge kinds");
    }
  });

  it("is unaffected by an oversized payload on an unknown kind — unknown-kind wins, still one diagnostic", () => {
    const registry = new PiUiRendererRegistry();
    const element = statusElement({
      kind: "not-a-real-kind" as never,
      payload: { kind: "status", text: "x".repeat(1000) } as never,
    });

    const decision = resolvePiUiElementRenderDecision(element, registry, 10);

    expect(decision.status).toBe("unknown-kind");
  });

  it("reports a diagnostic when a known kind has no renderer registered yet", () => {
    const registry = new PiUiRendererRegistry();
    const decision = resolvePiUiElementRenderDecision(statusElement(), registry);
    expect(decision.status).toBe("no-renderer");
    if (decision.status === "no-renderer") {
      expect(decision.diagnostic.message).toMatch(/no registered Android renderer/);
    }
  });

  it("reports a diagnostic when the canonical payload could not be validated", () => {
    const registry = new PiUiRendererRegistry();
    registry.register("status", (() => null) as never);
    const decision = resolvePiUiElementRenderDecision(
      statusElement({ payload: undefined }),
      registry,
    );
    expect(decision.status).toBe("invalid-payload");
    if (decision.status === "invalid-payload") {
      expect(decision.diagnostic.message).toMatch(/does not match its kind's shape/);
    }
  });
});

describe("resolvePiUiElementRenderDecision: oversized payload cap", () => {
  it("caps an oversized payload and explains the limit, without ever handing back a renderer", () => {
    const registry = new PiUiRendererRegistry();
    registry.register("status", (() => null) as never);

    const hugeText = "x".repeat(200);
    const element = statusElement({ payload: { kind: "status", text: hugeText } as never });

    const decision = resolvePiUiElementRenderDecision(element, registry, 50);

    expect(decision.status).toBe("oversized");
    if (decision.status === "oversized") {
      expect(decision.bytes).toBeGreaterThan(50);
      expect(decision.maxBytes).toBe(50);
      expect(decision.diagnostic.title).toBe("Element payload too large to render");
      expect(decision.diagnostic.message).toContain(String(decision.bytes));
      expect(decision.diagnostic.message).toContain("exceeds the 50-byte limit");
    }
    // The huge payload never appears on a successful decision — there is no
    // `Renderer`/`payload` pair to hand to a component.
    expect("Renderer" in decision).toBe(false);
    expect("payload" in decision).toBe(false);
  });

  it("stays under the cap for a normal-sized payload", () => {
    const registry = new PiUiRendererRegistry();
    registry.register("status", (() => null) as never);
    const decision = resolvePiUiElementRenderDecision(statusElement(), registry);
    expect(decision.status).toBe("ok");
  });
});

describe("resolvePiUiElementRenderDecision: registered renderer", () => {
  it("resolves the registered component and validated payload for a known, in-budget element", () => {
    const registry = new PiUiRendererRegistry();
    function StatusRenderer() {
      return null;
    }
    registry.register("status", StatusRenderer as never);

    const decision = resolvePiUiElementRenderDecision(statusElement(), registry);

    expect(decision.status).toBe("ok");
    if (decision.status === "ok") {
      expect(decision.Renderer).toBe(StatusRenderer);
      expect(decision.payload).toEqual({ kind: "status", text: "Reviewing changes" });
    }
  });
});
