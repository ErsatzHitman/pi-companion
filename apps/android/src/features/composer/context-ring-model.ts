/**
 * The prompt bar's context ring — geometry and strings (T353).
 *
 * The design artifact draws context usage twice: as a bar on the Live
 * screen's Context card, and as a small filling circle sitting in the
 * prompt bar immediately right of the attachment button. Both read the
 * same number, so both go through `../telemetry`'s
 * `buildContextCardViewModel` and `contextUsageBand` rather than
 * deriving their own — this module adds only what a RING needs and a
 * bar does not: a circumference, a stroke dash offset, and a label
 * short enough to sit inside 26dp.
 *
 * RN-free, so every number below is proven by execution. `ContextRing.tsx`
 * is the thin `react-native-svg` drawing of it.
 *
 * **Why a dash offset rather than an arc path.** `react-native-svg`'s
 * `Circle` takes `strokeDasharray`/`strokeDashoffset` directly, and the
 * artifact's own todo ring uses exactly that (`dasharray 50.27, offset
 * 50.27×(1−done/total)`). Computing an arc `d` string instead would
 * mean trigonometry in a component, a second rounding policy, and a
 * seam at 100% where the arc's start and end coincide.
 */
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import { buildContextCardViewModel, type ContextUsageBand } from "../telemetry";

/** The artifact's ring: 18dp across with a 2dp stroke. */
export const CONTEXT_RING_SIZE = 18;
export const CONTEXT_RING_STROKE = 2;

/** The radius the stroke's own centre line follows — half the stroke sits either side of it. */
export const CONTEXT_RING_RADIUS = (CONTEXT_RING_SIZE - CONTEXT_RING_STROKE) / 2;

/** `2πr` for the radius above. The artifact's own `50.27` for an r=8 ring. */
export const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

export interface ContextRingViewModel {
  /** `null` when the provider has reported no window — the ring then draws its track only. */
  fraction: number | null;
  band: ContextUsageBand;
  /** The full circumference, for `strokeDasharray`. */
  circumference: number;
  /** `circumference × (1 − fraction)`, for `strokeDashoffset`. Equals the circumference when unknown. */
  dashOffset: number;
  /** The whole-percent label, e.g. `"41%"`, or `"–"` when unknown. Sized for a 18dp ring's neighbour. */
  shortLabel: string;
  /** What the button announces, which is the full sentence — never just a number. */
  accessibilityLabel: string;
  /** What the button's action announces, so the ring never reads as a static image. */
  accessibilityHint: string;
}

const RING_HINT = "Opens mode, model, thinking effort and context controls";

/**
 * Everything the ring draws, from one `AgentUsage`.
 *
 * An unknown window yields `dashOffset === circumference`, which draws
 * NO progress stroke at all — deliberately the same rendering as 0%,
 * because a ring cannot express "unknown" geometrically and inventing a
 * distinct arc for it would be a shape the user has to be taught. The
 * distinction is carried in words instead: `shortLabel` is `"–"` and
 * the announced sentence says the window is unreported.
 */
export function buildContextRingViewModel(
  usage: AgentUsage | null | undefined,
): ContextRingViewModel {
  const card = buildContextCardViewModel({ usage });
  const fraction = card.fraction;

  if (fraction === null) {
    return {
      fraction: null,
      band: card.band,
      circumference: CONTEXT_RING_CIRCUMFERENCE,
      dashOffset: CONTEXT_RING_CIRCUMFERENCE,
      shortLabel: "–",
      accessibilityLabel: `Context usage unknown. ${card.summary}`,
      accessibilityHint: RING_HINT,
    };
  }

  return {
    fraction,
    band: card.band,
    circumference: CONTEXT_RING_CIRCUMFERENCE,
    dashOffset: CONTEXT_RING_CIRCUMFERENCE * (1 - fraction),
    shortLabel: `${Math.round(fraction * 100)}%`,
    accessibilityLabel: card.accessibilityLabel,
    accessibilityHint: RING_HINT,
  };
}
