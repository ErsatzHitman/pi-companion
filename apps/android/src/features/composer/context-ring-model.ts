/**
 * The prompt bar's context ring — geometry and strings (T353).
 *
 * The design artifact draws context usage twice: as a bar on the Live
 * screen's Context card, and as a small filling circle sitting in the
 * prompt bar immediately right of the attachment button. Both read the
 * same number, so both go through `../telemetry`'s
 * `buildContextCardViewModel` and `contextUsageBand` rather than
 * deriving their own — this module adds only what a RING needs and a
 * bar does not: a circumference, a stroke dash offset, and the short
 * integer the artifact draws INSIDE the ring.
 *
 * RN-free, so every number below is proven by execution. `ContextRing.tsx`
 * is the thin `react-native-svg` drawing of it.
 *
 * **The artifact's own geometry.** Quoting the reference:
 * `.ctxbtn { width: 34px; height: 34px }` holding a 28×28 SVG,
 * `<circle class="p" cx="14" cy="14" r="12" stroke-dasharray="75.40">`,
 * `.ctx-ring .p { stroke-width: 2.5 }` and
 * `.ctx-ring .pct { font-size: 8px; font-weight: 700; fill: var(--ink-2) }`
 * with the integer drawn at `x=14 y=17`. The radius is written as the
 * reference's own 12 rather than derived from the box and stroke, which
 * would give 12.75.
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

/** The artifact's ring: 28dp across, `r=12`, with a 2.5dp stroke. */
export const CONTEXT_RING_SIZE = 28;
export const CONTEXT_RING_STROKE = 2.5;

/** `.ctx-ring circle.p { r: 12 }` — stated as the reference states it, not derived. */
export const CONTEXT_RING_RADIUS = 12;

/** `2πr` for the radius above. The reference's own `75.40` dasharray on an r=12 ring. */
export const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

export interface ContextRingViewModel {
  /** `null` when the provider has reported no window — the ring then draws its track only. */
  fraction: number | null;
  band: ContextUsageBand;
  /** The full circumference, for `strokeDasharray`. */
  circumference: number;
  /** `circumference × (1 − fraction)`, for `strokeDashoffset`. Equals the circumference when unknown. */
  dashOffset: number;
  /** The whole-percent integer the artifact draws inside the ring, e.g. `"41"`, or `"–"` when unknown. No `%`: the reference's `.pct` is the number alone. */
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
    shortLabel: `${Math.round(fraction * 100)}`,
    accessibilityLabel: card.accessibilityLabel,
    accessibilityHint: RING_HINT,
  };
}
