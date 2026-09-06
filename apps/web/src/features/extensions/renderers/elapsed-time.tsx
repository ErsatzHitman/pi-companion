/**
 * Live elapsed-time label for a Pi UI Bridge payload's `startedAt` (epoch
 * ms) field (plan.md §11.3; T114). `pi-goal:status` puts `startedAt` on
 * both of the elements it synthesizes server-side
 * (`packages/server/.../ui-bridge/state.ts`, T40A4), and any extension's
 * own `status`/`widget` payload can carry the same field too — every
 * payload schema is `.passthrough()` (`packages/protocol/src/pi-ui-bridge/
 * payload.ts`), so an unmodelled numeric `startedAt` still survives to the
 * typed `payload` object a renderer is handed, just typed `unknown` rather
 * than `number`.
 *
 * Until this file, `startedAt` had no reader anywhere in `apps/web`
 * (verified: `grep -rn startedAt apps/web/src/features/extensions/
 * renderers/` returned nothing) — the value was visible only through
 * `RailElementCard`'s raw-payload disclosure.
 */
import { useEffect, useState } from "react";
import type { Clock } from "@picompanion/frontend-core";

/**
 * Tick cadence for the live label. Coarser than a second would look stale
 * for a goal that runs only a few seconds; finer would re-render far more
 * often than the label's own whole-second resolution could ever show.
 */
const TICK_MS = 1000;

/** Formats a millisecond duration as `"Ns"`, `"Nm Ss"`, or `"Nh Nm"`. */
export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Narrows a passthrough payload's `startedAt` extra to a `number`, the same
 * guard the daemon side already applies (`state.ts`'s
 * `typeof payload.startedAt === "number"`) — an absent or non-numeric value
 * (a future extension sending something else under the same name) yields
 * `undefined` rather than a bogus label.
 */
export function readStartedAt(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).startedAt;
  return typeof value === "number" ? value : undefined;
}

/**
 * Live `"Ns"`/`"Nm Ss"`/`"Nh Nm"` elapsed-time label ticking once per
 * second from `startedAt`, through an injected `Clock` (plan.md §7.3)
 * rather than `Date.now()`/`setInterval` read directly — so a test can
 * advance time deterministically instead of asserting against the wall
 * clock (T71 exists because exactly that mistake shipped elsewhere).
 *
 * Re-arms itself with `clock.setTimeout` rather than `clock.setInterval`,
 * so this ticks correctly against any `Clock`, including a test double
 * that only implements one-shot timers.
 *
 * Returns `undefined` when `startedAt` is absent, so a caller can omit the
 * label entirely rather than show a meaningless "0s" for an element that
 * never carried a start time.
 */
export function useElapsedSince(startedAt: number | undefined, clock: Clock): string | undefined {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (startedAt === undefined) {
      return undefined;
    }
    let cancelled = false;
    let handle = clock.setTimeout(tick, TICK_MS);
    function tick(): void {
      if (cancelled) {
        return;
      }
      forceRender((count) => count + 1);
      handle = clock.setTimeout(tick, TICK_MS);
    }
    return () => {
      cancelled = true;
      clock.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, clock]);

  if (startedAt === undefined) {
    return undefined;
  }
  return formatElapsedDuration(clock.now() - startedAt);
}
