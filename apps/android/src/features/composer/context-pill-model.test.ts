import { describe, expect, it } from "vitest";

import { buildContextPillViewModel } from "./context-pill-model";

/**
 * A-COMPOSER: `context-ring-model.test.ts` pinned a component the spec
 * deletes (the ring's SVG geometry — box size, radius, stroke,
 * circumference, dash offset). Per this task's brief, every case is
 * accounted for here rather than silently dropped:
 *
 * REMOVED, genuinely gone (2 cases — no ring, no arc, nothing to pin):
 *  - "keeps the stroke inside the ring's own box" (`CONTEXT_RING_RADIUS`/
 *    `CONTEXT_RING_STROKE`/`CONTEXT_RING_SIZE` containment)
 *  - "derives the circumference from that radius" (`2πr`)
 *  Also genuinely gone: the old `accessibilityHint` case's HINT half —
 *  the pill is a non-interactive readout (the artifact's own `.f-ctx`
 *  carries no hover, no press and no cursor change), so it announces no
 *  hint. `FooterPills.test.ts` pins that it renders no
 *  `accessibilityRole="button"` for this pill, which is the inverse of
 *  the old ring's "names and hints itself as a button" case.
 *
 * MOVED here, behaviour unchanged or adapted to the pill's own shape
 * (8 cases below): the 0%/100% and proportional fill cases (now
 * `barFraction`, not a dash offset), the colour-band thresholds, the
 * unknown-window and absent-usage cases, the "never leaves its own
 * bounds" clamp invariant (now `[0, 1]`, not `[0, circumference]`), and
 * the accessibility LABEL half of the old ring's "announces a sentence"
 * case. One case changed FORMAT along the way: the artifact draws the
 * pill's percent with a trailing `%` (`Math.round(pct)+'%'`), where the
 * ring drew bare digits inside its own circle — pinned below as the new
 * format, not the old one.
 */

const window = (used: number, max: number) => ({
  contextWindowUsedTokens: used,
  contextWindowMaxTokens: max,
});

describe("buildContextPillViewModel", () => {
  it("draws no fill at 0% and a full fill at 100%", () => {
    expect(buildContextPillViewModel(window(0, 200_000)).barFraction).toBe(0);
    expect(buildContextPillViewModel(window(200_000, 200_000)).barFraction).toBe(1);
  });

  it("fills the bar in proportion to the fraction used", () => {
    const model = buildContextPillViewModel(window(50_000, 200_000));
    expect(model.fraction).toBeCloseTo(0.25, 6);
    expect(model.barFraction).toBeCloseTo(0.25, 6);
  });

  it("labels the pill with a whole percent AND its sign, unlike the ring's bare digits", () => {
    // The artifact's own `paintFoot`: `Math.round(pct)+'%'`.
    expect(buildContextPillViewModel(window(82_400, 200_000)).percentLabel).toBe("41%");
    expect(buildContextPillViewModel(window(200_000, 200_000)).percentLabel).toBe("100%");
  });

  it("shows the used-token count in parentheses beside the percent", () => {
    expect(buildContextPillViewModel(window(82_400, 200_000)).tokensLabel).toBe("(82.4k)");
    expect(buildContextPillViewModel(window(0, 200_000)).tokensLabel).toBe("(0)");
  });

  it("carries the same colour band the Live screen's card and the old ring both used", () => {
    expect(buildContextPillViewModel(window(10, 100)).band).toBe("normal");
    expect(buildContextPillViewModel(window(75, 100)).band).toBe("warning");
    expect(buildContextPillViewModel(window(95, 100)).band).toBe("critical");
  });

  it("draws no fill and says so in words when the provider has reported no window", () => {
    const model = buildContextPillViewModel({ inputTokens: 12 });
    expect(model.fraction).toBeNull();
    expect(model.barFraction).toBe(0);
    expect(model.percentLabel).toBe("–");
    expect(model.tokensLabel).toBe("");
    expect(model.accessibilityLabel.toLowerCase()).toContain("unknown");
  });

  it("treats an absent usage as unknown, never as an empty window", () => {
    for (const usage of [null, undefined]) {
      const model = buildContextPillViewModel(usage);
      expect(model.fraction).toBeNull();
      expect(model.percentLabel).toBe("–");
    }
  });

  it("announces the same sentence the old ring did — a percent and a ceiling, never just a number", () => {
    const model = buildContextPillViewModel(window(82_400, 200_000));
    expect(model.accessibilityLabel).toContain("41%");
    expect(model.accessibilityLabel).toContain("200.0k");
  });

  it("never produces a bar fraction outside [0, 1], whatever a provider reports", () => {
    for (const usage of [window(-10, 100), window(500, 100), window(0, 100)]) {
      const model = buildContextPillViewModel(usage);
      expect(model.barFraction).toBeGreaterThanOrEqual(0);
      expect(model.barFraction).toBeLessThanOrEqual(1);
    }
  });
});
