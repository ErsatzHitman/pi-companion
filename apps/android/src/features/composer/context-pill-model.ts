/**
 * The footer's context readout — the artifact's `.fp.f-ctx` pill
 * (A-COMPOSER, replacing T353's context ring).
 *
 * plan.md's Android composer section now draws the four metadata pills
 * (mode, model, thinking effort, context) in a row ABOVE the prompt bar
 * rather than as a ring beside the attach button — see `Composer.tsx`'s
 * own module doc for the full layout change and its reasoning. This
 * module is the CONTEXT pill's half of that: `FooterPills.tsx` draws the
 * mode/model/effort pills from state it already holds
 * (`SessionControlsState`/`ModelThinkingState`, read via
 * `currentModeLabel`/`currentModelLabel`/`currentThinkingLabel`); context
 * is the one pill with real numeric work behind it — a percent, a
 * parenthetical token count, and a fill fraction that must never
 * disagree with each other — so it gets its own small view-model, the
 * same split `../telemetry/context-usage-model.ts`'s own doc comment
 * describes for the Live screen's Context card.
 *
 * Both read the same `telemetry.deriveContextWindowUsage` and the same
 * `contextUsageBand` thresholds `../telemetry/context-usage-model.ts`
 * already exports (orange above 70%, red above 90%) so the pill and the
 * card can never disagree about what "nearly full" means. RN-free, so
 * every number below is proven by execution; `FooterPills.tsx` only
 * draws it.
 *
 * **What used to live here.** `context-ring-model.ts` (deleted by this
 * change) computed a circumference and a stroke-dash offset for an SVG
 * arc — geometry that has no equivalent in a pill with a linear fill bar,
 * so it is not ported. What DOES survive from that file is the
 * band/percent/token-count/unknown-state behaviour, which
 * `context-pill-model.test.ts` carries forward (see that file's own
 * note on which of the old ring's cases moved and which did not).
 */
import { telemetry } from "@picompanion/frontend-core";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import { contextUsageBand, formatTokenCount, type ContextUsageBand } from "../telemetry";

export interface ContextPillViewModel {
  /** `null` when the provider has reported no window — the bar then draws no fill at all. */
  fraction: number | null;
  band: ContextUsageBand;
  /**
   * The artifact's `<b>` — `Math.round(pct)+'%'`, e.g. `"41%"`. Unlike
   * the ring's old `shortLabel` (bare digits, no sign, meant to sit
   * inside a small circle) the pill has room for the sign, and the
   * artifact's own `paintFoot` writes one. `"–"` when unknown.
   */
  percentLabel: string;
  /**
   * The artifact's `<i>` — the used-token count in parentheses, e.g.
   * `"(82.4k)"`. Read directly from `telemetry.deriveContextWindowUsage`'s
   * own `usedTokens` rather than recomputed as `total × pct ÷ 100` the
   * way the artifact's own `fmtTok(kTok(d.total)*pct/100)` does it — the
   * artifact derives `pct` from a string it also holds the true token
   * count for, so recomputing through the rounded percent would only
   * reintroduce the rounding error the real number already avoids. Empty
   * string when unknown, so the pill draws no parenthetical at all.
   */
  tokensLabel: string;
  /**
   * The bar's fill fraction, clamped to `[0, 1]` — `Math.min(100,pct)`'s
   * intent, expressed as a fraction rather than a css percent string so
   * `FooterPills.tsx` can turn it into either a `width` percentage or an
   * Animated value. `0` when unknown, which draws an empty track exactly
   * the way `PromptControlsMenu.tsx`'s own context bar already treats an
   * unknown fraction.
   */
  barFraction: number;
  /** The full sentence a screen reader announces for this pill — never just the number. */
  accessibilityLabel: string;
}

const UNKNOWN_PERCENT_LABEL = "–";

/**
 * Everything the context pill draws, from one `AgentUsage`.
 *
 * Mirrors `../telemetry/context-usage-model.ts`'s `buildContextCardViewModel`
 * in spirit (same source, same thresholds) but returns the pill's own
 * three-part shape (percent / tokens / bar) instead of one summary
 * sentence, because the artifact draws those as three separate DOM nodes
 * that must never disagree — see that module's own doc comment for why
 * `.f-ctx`'s three views of one number "cannot disagree" is the point.
 */
export function buildContextPillViewModel(
  usage: AgentUsage | null | undefined,
): ContextPillViewModel {
  const window = telemetry.deriveContextWindowUsage(usage);

  if (window.status !== "known") {
    return {
      fraction: null,
      band: "normal",
      percentLabel: UNKNOWN_PERCENT_LABEL,
      tokensLabel: "",
      barFraction: 0,
      accessibilityLabel:
        "Context usage unknown. The provider has not reported this session's context window yet.",
    };
  }

  const { usedFraction, usedTokens, maxTokens } = window;
  const percent = Math.round(usedFraction * 100);

  return {
    fraction: usedFraction,
    band: contextUsageBand(usedFraction),
    percentLabel: `${percent}%`,
    tokensLabel: `(${formatTokenCount(usedTokens)})`,
    barFraction: Math.min(1, Math.max(0, usedFraction)),
    accessibilityLabel: `Context. ${percent}% of ${formatTokenCount(maxTokens)} tokens used.`,
  };
}
