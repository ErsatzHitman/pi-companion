import { useCallback } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "./theme-context";

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
 * Usage: spread `onPressIn`/`onPressOut` onto the `Pressable` that owns
 * the gesture, and put `style` on the inner `Animated.View` that carries
 * the *visual* chrome — which is how every primitive using this hook also
 * gets its 48dp touch target (plan.md T26C): the outer `Pressable` is the
 * full hit area, the inner `Animated.View` is the tighter Beautiful UI
 * visual size.
 */
export function usePressScale() {
  const { motion, reduceMotion } = useTheme();
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(motion.pressScale, {
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [motion, reduceMotion, scale]);

  const onPressOut = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(1, {
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [motion, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return { style, onPressIn, onPressOut };
}
