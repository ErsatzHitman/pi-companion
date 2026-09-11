import Svg, { Circle } from "react-native-svg";

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
  testId?: string;
}

/**
 * ProgressRing recipe (T360) — a track circle with a progress arc over
 * it, which is how this design draws every fractional readout.
 *
 * **One drawing, two callers.** T353 drew it inside
 * `features/composer/ContextRing.tsx`, which was right while the prompt
 * bar's context meter was the only ring. T360's todo widget is the
 * second, and a second copy of an SVG arc — including the
 * twelve-o'clock rotation, which is easy to get wrong and invisible
 * when you do — is the duplication T356, T358 and T359 each removed for
 * a shape. Each caller keeps what is ITS own: the tap target, the
 * label, the band-to-colour mapping, and the model that produces the
 * numbers.
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
 * two models already own.
 *
 * **Decorative.** The ring carries no accessible name. Every caller
 * states the same quantity in text beside it and announces it on the
 * element that hosts it, because a fill level has to survive being
 * unseen (plan.md §10.5).
 */
export function ProgressRing({
  size,
  radius,
  strokeWidth,
  circumference,
  dashOffset,
  trackColor,
  arcColor,
  testId,
}: ProgressRingProps) {
  const centre = size / 2;
  return (
    <Svg width={size} height={size} fill="none" testID={testId}>
      <Circle cx={centre} cy={centre} r={radius} stroke={trackColor} strokeWidth={strokeWidth} />
      <Circle
        cx={centre}
        cy={centre}
        r={radius}
        stroke={arcColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90, ${centre}, ${centre})`}
      />
    </Svg>
  );
}

export default ProgressRing;
