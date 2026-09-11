import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

/**
 * The composer's context ring (the mockup's `.ctxbtn`/`.ctx-ring`).
 *
 * The mockup draws a 26px `<svg viewBox="0 0 26 26">` containing a track
 * circle and a progress arc, both at `r=11` with `stroke-width: 2.5`, an
 * arc rotated `-90deg` with `stroke-linecap: round`, and the percentage as
 * SVG `<text class="pct" x="13" y="16">` at `font-size: 7.5px;
 * font-weight: 700; text-anchor: middle; font-variant-numeric:
 * tabular-nums`. It sits immediately right of the attach button and opens
 * the session's controls.
 *
 * The fraction is the SAME derived telemetry the right rail's
 * `ContextMeter` renders: `@picompanion/frontend-core`'s
 * `telemetry.ContextWindowTelemetry` (T29C1's pure derivation off
 * `AgentUsage`), so this ring can never disagree with the rail about how
 * much of the window is used.
 *
 * **Unknown is not zero.** When the provider has not reported both token
 * fields, the ring draws its bare track and no percentage at all — the
 * same honesty rule `ContextMeter` follows (never a fabricated 0%). The
 * accessible name says so in words, so the empty ring is not a colourless
 * mystery to a screen-reader user.
 */
const RING_SIZE = 26;
const RING_RADIUS = 11;
const RING_STROKE_WIDTH = 2.5;
/** `2πr` — computed rather than the mockup's hard-coded `69.12`, so it cannot drift with the radius. */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ContextRingProps {
  /** The rail's own derived telemetry. Omit (or pass an `unknown` status) when no usage has been reported. */
  telemetry?: coreTelemetry.ContextWindowTelemetry;
  /** `true` while the controls this button opens are showing — drives `aria-expanded` styling. */
  expanded: boolean;
  onToggle: () => void;
  testId?: string;
}

export function ContextRing({ telemetry, expanded, onToggle, testId }: ContextRingProps) {
  const contextWindow = telemetry?.contextWindow;
  const known = contextWindow?.status === "known" ? contextWindow : null;
  const percent = known ? Math.round(known.usedFraction * 100) : null;
  const dashOffset = known
    ? RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, known.usedFraction)))
    : RING_CIRCUMFERENCE;
  const label =
    percent === null
      ? "Session controls — context usage not reported"
      : `Session controls — ${percent}% of context used`;

  return (
    <button
      type="button"
      className="pc-context-ring"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-testid={testId}
    >
      <svg
        className="pc-context-ring__svg"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="pc-context-ring__track"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeWidth={RING_STROKE_WIDTH}
        />
        <circle
          className="pc-context-ring__arc"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeWidth={RING_STROKE_WIDTH}
          strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
          strokeDashoffset={dashOffset.toFixed(2)}
        />
        {percent === null ? null : (
          <text className="pc-context-ring__pct" x={RING_SIZE / 2} y="16">
            {percent}
          </text>
        )}
      </svg>
    </button>
  );
}

export default ContextRing;
