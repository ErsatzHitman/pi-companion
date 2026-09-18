import { useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Text as SvgText } from "react-native-svg";

import type { NativeMotion } from "@picompanion/design-tokens";

/** The artifact's `.pct` baseline: `y=17` on a 28 box whose centre is 14. */
const CENTER_LABEL_BASELINE_OFFSET = 3;

/**
 * The arc alone animates its offset (`.ring .p{transition:stroke-
 * dashoffset .4s cubic-bezier(.23,1,.32,1)}`, `android-spec.html`); the
 * track circle underneath it never changes, so only this one needs a
 * Reanimated-backed `animatedProps`.
 */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
  /** The drawing's box, in dp. The circle is centred in it. */
  size: number;
  radius: number;
  strokeWidth: number;
  /** The full arc length, from the caller's own model — never `2πr` computed here. */
  circumference: number;
  /** How much of `circumference` to leave unpainted. */
  dashOffset: number;
  /** A resolved token colour for the unfilled ring. */
  trackColor: string;
  /** A resolved token colour for the filled arc. */
  arcColor: string;
  /**
   * Optional text drawn at the ring's centre (the artifact's `.pct`, a
   * percentage inside the prompt bar's context ring). Absent draws
   * nothing — the todo widget's ring has no centre readout.
   */
  centerLabel?: string;
  /** A resolved token colour for `centerLabel`. Required when it is given. */
  centerLabelColor?: string;
  centerLabelFontFamily?: string;
  centerLabelFontSize?: number;
  /**
   * Already-resolved motion tokens — the same "caller already resolved
   * it" shape `trackColor`/`arcColor` use, rather than a `useTheme()`
   * call inside this file (which would break the "resolves no colours
   * of its own" contract `recipe-accessibility.test.ts` pins for this
   * recipe by name). `.ring .p`'s own `.4s cubic-bezier(.23,1,.32,1)`
   * transition (`android-spec.html`) is exactly `motion.duration.slower`
   * and `motion.easing.standard`.
   */
  motion: NativeMotion;
  /**
   * Also already-resolved from the caller's own `useTheme()`.
   * `motion.duration.slower` alone already collapses to near-zero under
   * reduced motion (`getNativeMotion`), but every other animated
   * primitive in this tree gates explicitly on top of that so the ring
   * snaps to its new offset rather than playing a near-instant tween —
   * `FooterPills.tsx`'s `.fbar i` fill follows the same precedent.
   */
  reduceMotion: boolean;
  testId?: string;
}

/**
 * ProgressRing recipe (T360) — a track circle with a progress arc over
 * it, which is how this design draws every fractional readout.
 *
 * **Pulled out of a caller, and it outlived that caller.** T353 drew
 * it inside `features/composer/ContextRing.tsx`, which was right while
 * the prompt bar's context meter was the only ring; T360's todo widget
 * became the second, and a second copy of an SVG arc — including the
 * twelve-o'clock rotation, which is easy to get wrong and invisible
 * when you do — is the duplication T356, T358 and T359 each removed for
 * a shape. (CORRECTED at the P10-W2 merge gate: this said "One drawing,
 * two callers". A-COMPOSER deleted `ContextRing.tsx` — the confirmed
 * Android design draws a row of footer pills above the prompt bar and
 * no ring at all — so `features/transcript/todo-row.tsx` is now the one
 * production caller, measured with a tree-wide grep rather than
 * assumed. The extraction is still the right shape: a recipe with one
 * caller and a source-level contract beats an arc inlined into a
 * feature, and the next fractional readout has somewhere to go.) Each
 * caller keeps what is ITS own: the tap target, the label, the
 * band-to-colour mapping, and the model that produces the numbers.
 *
 * **The arc starts at twelve o'clock**, not at three, where an
 * unrotated SVG circle begins. A meter that fills from the right edge
 * reads as a different quantity at a glance than the same meter filling
 * from the top. Written as an SVG `transform` string rather than the
 * `rotation`/`originX`/`originY` props, which `react-native-svg` marks
 * deprecated.
 *
 * **It computes nothing.** `circumference` and `dashOffset` arrive from
 * the caller's own RN-free model, where they are proven by execution;
 * a `Math.PI` in here would be a second, untested source for a number
 * two models already own. It still ANIMATES the arc's offset over time —
 * `.ring .p`'s own `.4s cubic-bezier(.23,1,.32,1)` transition
 * (`android-spec.html`) — but that is interpolation between values the
 * caller supplies, not derivation of a new one: the shared value is set
 * to `dashOffset` either way, tweened under `withTiming` or snapped
 * directly under reduced motion, and neither branch computes a number
 * `dashOffset` did not already carry. The optional `centerLabel` is
 * drawn as an SVG `<Text>` at the ring's centre, at the artifact's own
 * `.pct` weight (700) and the baseline its `y=17` gives — the caller
 * still supplies the string, its colour and its size.
 *
 * **Decorative.** The ring carries no accessible name. Every caller
 * states the same quantity in text beside it and announces it on the
 * element that hosts it, because a fill level has to survive being
 * unseen (plan.md §10.5). `AnimatedCircle` is `react-native-reanimated`'s
 * own `createAnimatedComponent(Circle)` wrapper around the same SVG
 * primitive — it introduces no accessibility node of its own, so this
 * stays true of the arc once it animates.
 */
export function ProgressRing({
  size,
  radius,
  strokeWidth,
  circumference,
  dashOffset,
  trackColor,
  arcColor,
  centerLabel,
  centerLabelColor,
  centerLabelFontFamily,
  centerLabelFontSize,
  motion,
  reduceMotion,
  testId,
}: ProgressRingProps) {
  const centre = size / 2;
  const animatedDashOffset = useSharedValue(dashOffset);

  useEffect(() => {
    if (reduceMotion) {
      animatedDashOffset.value = dashOffset;
    } else {
      animatedDashOffset.value = withTiming(dashOffset, {
        duration: motion.duration.slower,
        easing: Easing.bezier(...motion.easing.standard),
      });
    }
  }, [dashOffset, reduceMotion, motion, animatedDashOffset]);

  const animatedArcProps = useAnimatedProps(() => ({
    strokeDashoffset: animatedDashOffset.value,
  }));

  return (
    <Svg width={size} height={size} fill="none" testID={testId}>
      <Circle cx={centre} cy={centre} r={radius} stroke={trackColor} strokeWidth={strokeWidth} />
      <AnimatedCircle
        cx={centre}
        cy={centre}
        r={radius}
        stroke={arcColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        animatedProps={animatedArcProps}
        transform={`rotate(-90, ${centre}, ${centre})`}
      />
      {centerLabel !== undefined ? (
        <SvgText
          x={centre}
          y={centre + CENTER_LABEL_BASELINE_OFFSET}
          fill={centerLabelColor}
          fontSize={centerLabelFontSize}
          fontFamily={centerLabelFontFamily}
          fontWeight="700"
          textAnchor="middle"
        >
          {centerLabel}
        </SvgText>
      ) : null}
    </Svg>
  );
}

export default ProgressRing;
