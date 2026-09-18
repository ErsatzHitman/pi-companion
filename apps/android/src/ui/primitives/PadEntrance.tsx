import { useMemo, type ReactNode } from "react";
import Animated, {
  Easing,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import {
  EXPRESSIVE_FADE_UP_DURATION_MS,
  EXPRESSIVE_FADE_UP_EASING,
  EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y,
} from "../theme/expressive-motion";
import { useTheme } from "../theme/theme-context";
import {
  isPadEntranceChildAnimated,
  padEntranceDelayForChild,
  type PadEntranceChildKind,
} from "./pad-entrance-model";

export interface PadEntranceProps {
  /** Whether this child is a `.pad>.row`/`.pad>.card` kind at all — see `pad-entrance-model.ts`'s own `PadEntranceChildKind` doc comment. */
  kind: PadEntranceChildKind;
  /**
   * This child's zero-based position among ALL of its `.pad` siblings —
   * animated or not. The caller owns this count; see
   * `pad-entrance-model.ts`'s doc comment, section 1, for why a
   * `.lbl`/`.sbar`/chip-row sibling must still increment it.
   */
  position: number;
  children: ReactNode;
  testId?: string;
}

/**
 * PAD-FADEUP: the android spec's `.pad>.row,.pad>.card{animation:fade-up
 * .3s cubic-bezier(.23,1,.32,1) both}` stagger (`android-spec.html`), as a
 * small wrapper primitive — one call per `.pad` child, in render order,
 * threading a running `position` through (see each caller's own doc
 * comment for how it derives that count).
 *
 * The actual delay schedule and the row/card-vs-everything-else split are
 * `./pad-entrance-model.ts`'s job, proven there by real execution; this
 * file only turns that answer into a Reanimated `entering` builder, the
 * same split `Sheet.tsx`'s `menuPanelEntering` and
 * `../../features/transcript/transcript-window.tsx`'s
 * `createTranscriptEntranceEntering` already use for their own
 * `fade-up`-family entrances. Every number comes from `EXPRESSIVE_FADE_UP_*`
 * (`../theme/expressive-motion.ts`, whose own `EXPRESSIVE_FADE_UP_DURATION_MS.listRow`
 * IS this rule's `.3s` — `.pad>.row,.pad>.card` is that token's own cited
 * selector); none is retyped here.
 *
 * Renders children bare — no `Animated.View` wrapper at all — in two
 * cases: `kind` is not an animated one (`isPadEntranceChildAnimated`
 * answers `false`, e.g. a `.lbl`/`.sbar`/chip-row stand-in, which the
 * spec never animates), or `reduceMotion` is on (`useTheme()`, gated the
 * same way every other animated primitive in this tree is — `Sheet.tsx`'s
 * `menuPanelEntering` call site is the direct precedent). A non-animated
 * child renders bare specifically so it is never wrapped in an extra
 * `Animated.View` it has no use for, but its `position` is still passed
 * through every sibling call — the wrapping decision here never changes
 * the count a later sibling's own `position` prop must carry.
 */
export function PadEntrance({ kind, position, children, testId }: PadEntranceProps) {
  const { reduceMotion } = useTheme();

  const delayMs = useMemo(() => padEntranceDelayForChild(kind, position), [kind, position]);

  if (!isPadEntranceChildAnimated(kind) || delayMs === null || reduceMotion) {
    return <>{children}</>;
  }

  return (
    <Animated.View entering={padEntranceEntering(delayMs)} testID={testId}>
      {children}
    </Animated.View>
  );
}

function padEntranceEntering(delayMs: number): EntryExitAnimationFunction {
  return () => {
    "worklet";
    const config = {
      duration: EXPRESSIVE_FADE_UP_DURATION_MS.listRow,
      easing: Easing.bezier(...EXPRESSIVE_FADE_UP_EASING),
    };
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y }],
      },
      animations: {
        opacity: withDelay(delayMs, withTiming(1, config)),
        transform: [{ translateY: withDelay(delayMs, withTiming(0, config)) }],
      },
    };
  };
}
