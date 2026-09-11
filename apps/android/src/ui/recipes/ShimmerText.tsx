import { useEffect } from "react";
import type { StyleProp, TextStyle } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../theme/theme-context";

/**
 * Beautiful UI's shimmer cycle. The reference's "1.4s linear" has no
 * corresponding token in `@picompanion/design-tokens`, whose
 * `motion.duration` table tops out at `entrance` = 600ms, so it is a
 * named constant here — the same treatment and the same reason
 * `./StreamingMessage.tsx` gives for its own.
 */
export const SHIMMER_DURATION_MS = 1400;

export interface ShimmerTextProps {
  children: string;
  /**
   * `true` to run the shimmer. Named for the treatment, not for a
   * state: the CALLER owns the decision, including the reduced-motion
   * half of it, because the rule that gates it lives in a feature model
   * (`features/transcript/thinking-row-model.ts`'s
   * `shouldAnimateShimmer`) and a recipe in `ui/` may not import one to
   * re-derive it. With the shimmer off the text renders in `settled`.
   */
  active: boolean;
  /**
   * The colour the text holds at rest and shimmers FROM. Defaults to
   * `ink-3`, which is what the artifact dims an in-flight label to.
   */
  settled?: string;
  /** The colour the shimmer travels TO. Defaults to `ink`. */
  peak?: string;
  style?: StyleProp<TextStyle>;
  testId?: string;
}

/**
 * ShimmerText recipe (T359) — the artifact's `.shim`: a label whose own
 * words pulse while the thing they name is still happening.
 *
 * The artifact draws it as a moving `linear-gradient` clipped to the
 * glyphs. React Native has no `background-clip: text`, so this
 * interpolates the text colour between two theme roles instead, which
 * is the same signal (the words brighten and dim on a 1.4s cycle) by
 * the one mechanism the platform actually has. `StreamingMessage.tsx`
 * resolved the identical gap the same way.
 *
 * **One owner, two callers.** T357 put this animation inside
 * `./ThinkingSection.tsx` because that was the only place it ran. T359
 * needs it again for the bash block's "Running…", and a second copy of
 * a loop that has to be reset rather than left running is exactly the
 * duplication T356 and T358 each removed for a shape. Both callers now
 * pass `active` and nothing else.
 *
 * **Reduced motion never removes information.** Every caller's label
 * already says the state in words — "Thinking", "Running…" — so with
 * `active` false the words are still there in `settled`, dimmer than
 * the surrounding text but perfectly legible (plan.md §10.5).
 */
export function ShimmerText({ children, active, settled, peak, style, testId }: ShimmerTextProps) {
  const { theme } = useTheme();
  const from = settled ?? theme.colors["ink-3"];
  const to = peak ?? theme.colors.ink;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      true,
    );
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [from, to]),
  }));

  return (
    <Animated.Text style={[style, { color: from }, active ? animatedStyle : null]} testID={testId}>
      {children}
    </Animated.Text>
  );
}

export default ShimmerText;
