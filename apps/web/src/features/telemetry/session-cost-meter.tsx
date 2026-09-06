/**
 * Session-cost meter (plan.md §8.3, §10.1, §10.5, §11.5; T48A2).
 *
 * Renders `@picompanion/frontend-core`'s `telemetry.SessionCost`
 * (T48A1's `deriveTurnCost`/`accumulateSessionCost`, accumulated live by
 * `SessionCostStore` in this feature) next to `ContextMeter`
 * (`features/rail/context-meter.tsx`, T29C2) — same "presentation-only,
 * takes an already-derived snapshot as a prop" contract `ContextMeter`
 * itself established, so this component re-renders only when its own
 * `SessionCostStore` subscription produces a new snapshot (`use-session-
 * cost.ts`), never because a sibling like the transcript re-rendered.
 *
 * **Unknown is not zero.** `SessionCost.status === "unknown"` (no turn
 * has been priced yet — either no usage has been reported, or the active
 * model has no rate-table entry, see `cost.ts`'s `TurnCost`) renders an
 * explicit, visible "not priced yet" notice via `StatusIndicator` —
 * never a `$0.00`, which would misrepresent "we don't know the rate" as
 * "this session is free". `"partial"` (at least one turn priced, at
 * least one not) still shows the dollar total, since it is real money
 * already spent, but names it a lower bound in the same live region so a
 * screen-reader user is never told an incomplete number without also
 * being told it is incomplete.
 *
 * Every numeral is Geist Mono with tabular figures
 * (`.session-cost-meter__value`, matching `ContextMeter`'s own
 * `.context-meter__value` and the `Progress` primitive's percentage
 * readout) and sits in a `role="status"` `aria-live="polite"` region, so
 * a per-turn update is announced without requiring re-navigation to this
 * part of the rail.
 */
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

import { Section, StatusIndicator } from "../../ui/primitives/index.js";
import "./session-cost-meter.css";

export interface SessionCostMeterProps {
  /** The session's latest accumulated cost (T48A1/T48A2). */
  sessionCost: coreTelemetry.SessionCost;
  testId?: string;
}

const UNKNOWN_TEXT = "Not priced yet — no turn with a known model rate has completed";

// Locale pinned (not the environment default) so the tabular-figure
// grouping is identical in CI and on every contributor's machine,
// matching `ContextMeter`'s own `tokenFormatter` precedent.
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

function partialSuffix(unknownTurns: number): string {
  const turnWord = unknownTurns === 1 ? "turn" : "turns";
  return ` so far — ${unknownTurns} ${turnWord} unpriced, total is a lower bound`;
}

/**
 * The session-cost readout (plan.md §8.3, §11.5). Intended to mount as a
 * sibling of `ContextMeter` — see `SessionCostMeterContainer`'s doc for
 * exactly where.
 */
export function SessionCostMeter({
  sessionCost,
  testId = "session-cost-meter",
}: SessionCostMeterProps) {
  return (
    <Section title="Cost" id={testId} data-testid={testId}>
      {sessionCost.status === "unknown" ? (
        <StatusIndicator
          label="Session cost"
          tone="neutral"
          statusText={UNKNOWN_TEXT}
          testId={`${testId}-unknown`}
        />
      ) : (
        <p
          className="session-cost-meter__readout"
          role="status"
          aria-live="polite"
          data-testid={`${testId}-readout`}
        >
          <span className="session-cost-meter__value">{formatUsd(sessionCost.totalUsd)}</span>
          {sessionCost.status === "partial"
            ? partialSuffix(sessionCost.unknownTurns)
            : " this session"}
        </p>
      )}
    </Section>
  );
}
