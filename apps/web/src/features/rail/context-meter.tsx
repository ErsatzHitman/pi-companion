/**
 * Context-window and cache-hit meter (plan.md §8.3, §10.1 "the
 * context-window meter", §10.5, §11.5; T29C2).
 *
 * Renders `@picompanion/frontend-core`'s `telemetry.ContextWindowTelemetry`
 * — T29C1's pure derivation of `contextWindowUsedTokens`/
 * `contextWindowMaxTokens` and `cachedInputTokens`/`inputTokens` off the
 * daemon's `AgentUsage` — as two live meters in the right rail. This
 * component is presentation-only: it takes an already-derived snapshot as a
 * prop and re-renders whenever a caller passes a new one (e.g. once per
 * turn), the same "just render the domain-shaped prop" contract
 * `PiExtensionRail` itself established for `PiUiElement[]` (T29R1). Wiring
 * a live per-agent `AgentUsage` stream into that prop is a later task's
 * concern, not this one's.
 *
 * **Unknown is not zero.** A provider that has not reported the underlying
 * fields yields `{ status: "unknown" }` from T29C1's derivation, and this
 * component renders that as an explicit, visible "not reported" notice —
 * never a `0%`/`0 / 0` reading, which would misrepresent silence as
 * measurement. The `Progress` primitive's own `value={null}` means
 * *indeterminate* ("this is running, duration unknown"), a different and
 * equally misleading claim for data that is simply absent, so the unknown
 * branch below renders a `StatusIndicator` instead of a zero- or
 * indeterminate-`Progress`.
 *
 * Every numeral is Geist Mono with tabular figures (`.context-meter__value`,
 * matching the `Progress` primitive's own percentage readout and the
 * `pc-pi-progress__fraction-value` precedent in `features/extensions/
 * renderers/`) and sits in a `role="status"` `aria-live="polite"` region,
 * so a per-turn update is announced to a screen reader without requiring
 * re-navigation to this part of the rail.
 */
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

import { Progress, Section, StatusIndicator } from "../../ui/primitives/index.js";
import "./context-meter.css";

export interface ContextMeterProps {
  /** One agent's latest derived context-window/cache-hit snapshot (T29C1). */
  telemetry: coreTelemetry.ContextWindowTelemetry;
  testId?: string;
}

const UNKNOWN_TEXT = "Not reported by this provider";

// Locale pinned (not the environment default) so the tabular-figure
// grouping is identical in CI and on every contributor's machine.
const tokenFormatter = new Intl.NumberFormat("en-US");

function formatTokens(value: number): string {
  return tokenFormatter.format(value);
}

/**
 * The right rail's context-window and cache-hit meter (plan.md §8.3,
 * §10.1, §11.5). Mounted by `PiExtensionRail` behind its optional
 * `telemetry` prop; renders independently of the pinned Pi UI element list
 * — context/cache usage is live agent state, not an extension element, and
 * stays visible whether or not any extension is currently pinned.
 */
export function ContextMeter({ telemetry, testId = "context-meter" }: ContextMeterProps) {
  const { contextWindow, cacheShare } = telemetry;

  return (
    <Section title="Context" id={testId} data-testid={testId}>
      <div className="context-meter__group" data-testid={`${testId}-context-window`}>
        <h3 className="context-meter__group-title">Context window</h3>
        {contextWindow.status === "known" ? (
          <>
            <Progress
              label="Context window used"
              value={contextWindow.usedFraction}
              testId={`${testId}-context-window-bar`}
            />
            <p
              className="context-meter__readout"
              role="status"
              aria-live="polite"
              data-testid={`${testId}-context-window-readout`}
            >
              <span className="context-meter__value">{formatTokens(contextWindow.usedTokens)}</span>
              {" / "}
              <span className="context-meter__value">{formatTokens(contextWindow.maxTokens)}</span>
              {" tokens used"}
            </p>
          </>
        ) : (
          <StatusIndicator
            label="Context window"
            tone="neutral"
            statusText={UNKNOWN_TEXT}
            testId={`${testId}-context-window-unknown`}
          />
        )}
      </div>
      <div className="context-meter__group" data-testid={`${testId}-cache-share`}>
        <h3 className="context-meter__group-title">Cache hit share</h3>
        {cacheShare.status === "known" ? (
          <>
            <Progress
              label="Cache hit share"
              value={cacheShare.cacheHitFraction}
              testId={`${testId}-cache-share-bar`}
            />
            <p
              className="context-meter__readout"
              role="status"
              aria-live="polite"
              data-testid={`${testId}-cache-share-readout`}
            >
              <span className="context-meter__value">{cacheShare.cacheHitPercent}%</span>
              {" cache hit — "}
              <span className="context-meter__value">{formatTokens(cacheShare.cachedTokens)}</span>
              {" cached / "}
              <span className="context-meter__value">{formatTokens(cacheShare.freshTokens)}</span>
              {" fresh"}
            </p>
          </>
        ) : (
          <StatusIndicator
            label="Cache hit share"
            tone="neutral"
            statusText={UNKNOWN_TEXT}
            testId={`${testId}-cache-share-unknown`}
          />
        )}
      </div>
    </Section>
  );
}
