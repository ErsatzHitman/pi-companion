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
 * `tone` is a secondary cue).
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
import { useMemo } from "react";
import { View } from "react-native";

import { Banner } from "../../ui/primitives";
import {
  describeCompactionStatus,
  describeRetryStatus,
  type TurnStatusState,
} from "./turn-status-model";

export interface TurnStatusBannerProps {
  state: TurnStatusState;
  /** Renders `state.unavailableReason` even when there is nothing else to show. Off by default — see this file's doc comment. */
  alwaysShowUnavailable?: boolean;
  testId?: string;
}

export function TurnStatusBanner({
  state,
  alwaysShowUnavailable = false,
  testId = "turn-status-banner",
}: TurnStatusBannerProps) {
  const retryText = useMemo(() => describeRetryStatus(state.retry), [state.retry]);
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
        <Banner
          tone={state.retry?.error ? "warning" : "info"}
          message={retryText}
          testId={`${testId}-retry`}
        />
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
