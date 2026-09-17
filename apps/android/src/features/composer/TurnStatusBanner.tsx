/**
 * Android retry/compaction status banner for the compact composer
 * (T39C, plan.md §11.1's "compaction and summarization retry" group).
 * Thin native view over `./turn-status-model.ts` — every behavioural
 * claim (the three availability states, the retry/compaction copy, the
 * reducer, the live-update wiring) already has render-free behavioural
 * proof in `turn-status-model.test.ts`; this file only wires that into
 * the render tree. Same split as `./ModelThinkingPicker.tsx`/
 * `model-thinking-model.ts` (`react-native` cannot render under this
 * workspace's plain `vitest`, proven 27+ times).
 *
 * ## Composed only from the already-audited Banner primitive
 *
 * This file declares no `Pressable`/`Touchable*` of its own — it
 * renders through `../../ui/primitives`' `Banner`, the same primitive
 * web's `compaction-row.tsx` uses for the identical "a system event is
 * a live status strip, not a chat bubble" treatment (plan.md §10.5
 * "non-colour status text": the message explains itself in text, the
 * `tone` is a secondary cue). `Banner` takes no leading node of its own
 * (checked: its props are `tone`/`message`/`actionLabel`/`onAction`/
 * `testId` only), so the retry countdown's `PixelLoader` is composed
 * beside it in a plain `View` row here, in this file, rather than
 * changing that shared primitive.
 *
 * ## The countdown ticks in place (W7-COUNTDOWN)
 *
 * While `state.retry` carries a live `delayMs`, this file owns a
 * 1-second interval whose only job is to force a re-render — the
 * displayed number always comes from re-calling
 * `retryCountdownSecondsRemaining`/`describeRetryStatus` with the
 * current time, never from a counter this file decrements itself, so
 * the model stays the single source of truth for what the countdown
 * actually says. The interval starts only once there is something to
 * count down, and stops the instant there is not: on unmount, once the
 * countdown reaches zero, or once `state.retry` clears or loses its
 * `delayMs`.
 *
 * ## Renders nothing when there is nothing to say
 *
 * Unlike `ModelThinkingPicker`/`QueueModePicker`, this is not a control
 * — there is nothing to change here, only status to show. So the
 * unavailable/no-client states render nothing at all (no confusing
 * "unavailable" banner for a feature the user never tried to use),
 * except in `alwaysShowUnavailable` mode (used by this file's own test
 * and by a future diagnostics surface) which is off by default.
 * Whenever `state.retry`/`state.compaction` are both `null` while ready,
 * this also renders nothing — a quiet composer is the common case, not
 * an error.
 */
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { Banner } from "../../ui/primitives";
import { PixelLoader } from "../../ui/recipes";
import {
  describeCompactionStatus,
  describeRetryStatus,
  retryCountdownSecondsRemaining,
  type TurnStatusState,
} from "./turn-status-model";

export interface TurnStatusBannerProps {
  state: TurnStatusState;
  /** Renders `state.unavailableReason` even when there is nothing else to show. Off by default — see this file's doc comment. */
  alwaysShowUnavailable?: boolean;
  testId?: string;
}

/**
 * Ticks a re-render once a second for as long as `retry` carries a live
 * (not-yet-expired) `delayMs`, and returns the current whole-seconds
 * count from `retryCountdownSecondsRemaining` — never a value this hook
 * stores or decrements itself. Returns `null` whenever there is nothing
 * to count down (no retry, or a retry with no `delayMs`), which is also
 * when no interval is running at all.
 */
function useRetryCountdownSeconds(retry: TurnStatusState["retry"]): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const receivedAtMs = retry?.receivedAtMs ?? null;
  const remaining = retryCountdownSecondsRemaining(retry, nowMs);
  const counting = remaining !== null && remaining > 0;

  // Re-seed the clock the moment a new retry arrives, BEFORE any tick.
  // Found at the W7 merge gate: without this, `nowMs` is whatever
  // `useState` captured at mount and is only ever advanced by the
  // interval below — which does not run while there is nothing to count
  // down. A banner mounted long before the first `pi_retry` therefore
  // measured that retry against a clock frozen at mount time and
  // rendered a countdown inflated by the whole idle gap. Keying this on
  // `receivedAtMs` re-seeds once per retry, including a second retry
  // arriving while the first is still counting.
  useEffect(() => {
    if (receivedAtMs === null) return;
    setNowMs(Date.now());
  }, [receivedAtMs]);

  useEffect(() => {
    if (!counting) return undefined;
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [counting]);

  return remaining;
}

export function TurnStatusBanner({
  state,
  alwaysShowUnavailable = false,
  testId = "turn-status-banner",
}: TurnStatusBannerProps) {
  const remainingSeconds = useRetryCountdownSeconds(state.retry);
  const retryText = useMemo(
    () => describeRetryStatus(state.retry, remainingSeconds),
    [state.retry, remainingSeconds],
  );
  const compactionText = useMemo(
    () => describeCompactionStatus(state.compaction),
    [state.compaction],
  );

  if (state.availability !== "ready") {
    if (!alwaysShowUnavailable) return null;
    return (
      <View testID={testId}>
        <Banner
          tone="neutral"
          message={state.unavailableReason ?? "Unavailable"}
          testId={`${testId}-unavailable`}
        />
      </View>
    );
  }

  if (!retryText && !compactionText) {
    return null;
  }

  return (
    <View testID={testId}>
      {retryText ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {remainingSeconds !== null ? <PixelLoader testId={`${testId}-retry-loader`} /> : null}
          <View style={{ flex: 1 }}>
            <Banner
              tone={state.retry?.error ? "warning" : "info"}
              message={retryText}
              testId={`${testId}-retry`}
            />
          </View>
        </View>
      ) : null}
      {compactionText ? (
        <Banner
          tone={state.compaction?.status === "loading" ? "info" : "neutral"}
          message={compactionText}
          testId={`${testId}-compaction`}
        />
      ) : null}
    </View>
  );
}

export default TurnStatusBanner;
