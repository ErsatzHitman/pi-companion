import { useCallback, useMemo } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import {
  EXPRESSIVE_PRESS_SCALE,
  EXPRESSIVE_PRESS_SPRING_DURATION_MS,
  EXPRESSIVE_PRESS_SPRING_EASING,
} from "./expressive-motion";
import { useTheme } from "./theme-context";

/** Which press feedback a caller wants — see this file's own doc comment for why this is a parameter, not a second hook. */
export type PressScaleVariant = "default" | "icon";

/**
 * Beautiful UI's `active:scale-[0.96]` press feedback (plan.md §10.2,
 * docs/beautiful-ui-reference.md "Buttons `active:scale-[0.96]`"), driven
 * by the shared `motion.pressScale` token and the signature easing so it
 * stays in lock-step with every other themed animation. Collapses to a
 * no-op under `reduceMotion` (plan.md §10.5 "reduced-motion behavior") —
 * the scale change is a transient press affordance, not state that needs
 * to survive, so reduced motion removes it entirely rather than snapping
 * it instantly.
 *
 * **A-MOTION: `variant` selects the Android design artifact's deeper,
 * spring-driven icon press over the shared Beautiful UI default.** The
 * artifact presses every surface with the same `transition:transform
 * .42s cubic-bezier(.34,1.7,.5,1)` spring (`../theme/expressive-motion.ts`'s
 * `EXPRESSIVE_PRESS_SPRING_*`; the `1.7` control point is a real
 * overshoot, not an ease-out), at a depth that varies by surface —
 * `.ic`/`.cmp-box .ic` go to `.88`, well past the shared `pressScale`
 * of `.96`. `variant: "icon"` selects exactly that one target
 * (`EXPRESSIVE_PRESS_SCALE.icon`), because it is the only one this
 * package has an owned caller for today (`../primitives/IconButton.tsx`,
 * `../recipes/ScreenBar.tsx`'s `.ic`-shaped bar actions); the other six
 * targets the artifact defines (`.scr-btn`, `.pbtn`, `.row`, `.chip`,
 * `.blk`/`.bash`/`.ov`, `.fp`) belong to files outside this package.
 *
 * **Why a parameter, and not a second hook or an unconditional change to
 * this one.** `usePressScale` is already called from six files, three of
 * them (`../primitives/Button.tsx`, `../primitives/Chip.tsx`, and two
 * feature files) outside this package's exclusive file list — retuning
 * the hook's own default would have silently changed their press feel
 * with no way to verify or test the result here. A second, parallel hook
 * would duplicate this one's shared-value/callback/reduced-motion
 * plumbing for a difference that is only ever "which target number and
 * which curve," which is exactly what a parameter is for — the same
 * shape `getNativeMotion(reduceMotion)` already uses one boolean to pick
 * between two token tables rather than being two functions.
 */
export function usePressScale(variant: PressScaleVariant = "default") {
  const { motion, reduceMotion } = useTheme();
  const scale = useSharedValue(1);

  const pressConfig = useMemo(() => {
    if (variant === "icon") {
      return {
        target: EXPRESSIVE_PRESS_SCALE.icon,
        duration: EXPRESSIVE_PRESS_SPRING_DURATION_MS,
        easing: Easing.bezier(...EXPRESSIVE_PRESS_SPRING_EASING),
      };
    }
    return {
      target: motion.pressScale,
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easing.standard),
    };
  }, [variant, motion]);

  const onPressIn = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(pressConfig.target, {
      duration: pressConfig.duration,
      easing: pressConfig.easing,
    });
  }, [pressConfig, reduceMotion, scale]);

  const onPressOut = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(1, {
      duration: pressConfig.duration,
      easing: pressConfig.easing,
    });
  }, [pressConfig, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return { style, onPressIn, onPressOut };
}
