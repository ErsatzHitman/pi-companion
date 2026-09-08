import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../ui/theme/theme-context";
import {
  EQ_BAR_DELAYS_MS,
  EQ_BOUNCE_HALF_CYCLE_MS,
  EQ_EASE_IN_OUT_BEZIER,
  EQ_MAX_SCALE,
  EQ_MIN_SCALE,
  PROCESSING_SPIN_DURATION_MS,
} from "./voice-capture-indicator-constants";
import type { VoiceRecordingStatus } from "./voice-model";

export interface VoiceCaptureIndicatorProps {
  /**
   * `Composer.tsx` only ever mounts this while `VoiceState.status` is
   * `"recording"` or `"processing"` — never `"idle"`, which renders
   * nothing at all (see that file's own `voiceStatusDisplay`).
   */
  status: Extract<VoiceRecordingStatus, "recording" | "processing">;
  testId?: string;
}

/**
 * The mic control's waveform (T276, plan.md §9.2).
 *
 * Replaces the plain `"Recording…"`/`"Processing…"` text row
 * `Composer.tsx` used to render for these two states. No visible label
 * of either kind is introduced here — see this task's brief, confirmed
 * against real source before writing anything (`grep -rn "Listening"
 * apps/android/src` found no such string anywhere in this tree).
 *
 * Two intentionally DIFFERENT glyphs for `"recording"` vs
 * `"processing"`, because they are two different facts about the
 * microphone: `"recording"` means audio is actually being captured
 * right now; `"processing"` means capture has already stopped
 * (`requestStop()` already called `port.stop()`) and the app is doing
 * something with what it caught — today that is only encoding to
 * base64 (`expo-audio-voice-capture-port.ts`'s `stop()`), T277 adds a
 * network round trip on top of that. A waveform that kept bouncing
 * after the user pressed stop would be lying about what the microphone
 * is doing, so `"processing"` gets a small rotating ring instead — the
 * same "something is working, not listening" vocabulary the reference
 * artifact's own `.spin` class uses for an in-flight bash command, not
 * a re-skin of the waveform.
 *
 * `"recording"` matches that artifact's `.eq`/`@keyframes eq-bounce`
 * treatment exactly, not approximated: five bars
 * (`EQ_BAR_DELAYS_MS.length`), an 800ms CSS `ease-in-out` bounce
 * between `scaleY(.35)` and `scaleY(1)`
 * (`EQ_MIN_SCALE`/`EQ_MAX_SCALE`/`EQ_BOUNCE_HALF_CYCLE_MS`), each bar's
 * own delay taken verbatim from the artifact's `.eq i:nth-child(n)`
 * rules (`EQ_BAR_DELAYS_MS` — 0/120/240/60/180ms; NOT a uniform ramp,
 * see that constant's own comment) — all of it in
 * `voice-capture-indicator-constants.ts`, imported rather than
 * redeclared here so that module's own behavioural test is what proves
 * these numbers, not a source-text match against this file.
 *
 * Removing the SIGHTED label is not the same thing as removing the
 * state for a screen-reader user — plan.md §10.5 requires state never
 * be carried by animation/colour alone. Both glyphs below carry
 * `accessible`/`accessibilityLiveRegion="polite"`/`accessibilityLabel`,
 * the exact shape `../../ui/primitives/StatusIndicator.tsx` already
 * uses for every other composer status row, so TalkBack still announces
 * "Recording"/"Processing" once even though sighted users see only the
 * glyph.
 *
 * Respects `reduceMotion` (plan.md §10.5) the same way `Progress`/
 * `usePressScale` do (`../../ui/primitives/Progress.tsx`,
 * `../../ui/theme/use-press-scale.ts`): the animation collapses to a
 * single static frame — bars frozen at their peak scale, the ring
 * frozen at 0deg — rather than either continuing to animate or
 * disappearing. The glyph, and the accessible announcement, still say
 * what is happening; only the motion is removed.
 */
export function VoiceCaptureIndicator({ status, testId }: VoiceCaptureIndicatorProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (status === "processing") {
    return (
      <View
        style={styles.processingWrap}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel="Processing"
        testID={testId}
      >
        <ProcessingRing reduceMotion={reduceMotion} style={styles.ring} />
      </View>
    );
  }

  return (
    <View
      style={styles.eq}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel="Recording"
      testID={testId}
    >
      {EQ_BAR_DELAYS_MS.map((delayMs, index) => (
        <EqBar key={index} delayMs={delayMs} reduceMotion={reduceMotion} style={styles.bar} />
      ))}
    </View>
  );
}

function EqBar({
  delayMs,
  reduceMotion,
  style,
}: {
  delayMs: number;
  reduceMotion: boolean;
  style: object;
}) {
  const scale = useSharedValue(reduceMotion ? EQ_MAX_SCALE : EQ_MIN_SCALE);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = EQ_MAX_SCALE;
      return;
    }
    const easeInOut = Easing.bezier(...EQ_EASE_IN_OUT_BEZIER);
    scale.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(EQ_MAX_SCALE, { duration: EQ_BOUNCE_HALF_CYCLE_MS, easing: easeInOut }),
          withTiming(EQ_MIN_SCALE, { duration: EQ_BOUNCE_HALF_CYCLE_MS, easing: easeInOut }),
        ),
        -1,
        false,
      ),
    );
  }, [reduceMotion, delayMs, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));

  return <Animated.View style={[style, animatedStyle]} />;
}

function ProcessingRing({ reduceMotion, style }: { reduceMotion: boolean; style: object }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      rotation.value = 0;
      return;
    }
    rotation.value = withRepeat(
      withTiming(360, { duration: PROCESSING_SPIN_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  return <Animated.View style={[style, animatedStyle]} />;
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    eq: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 2,
      height: 20,
      minHeight: 48,
      justifyContent: "center",
    },
    bar: {
      width: 3,
      height: 14,
      borderRadius: 2,
      backgroundColor: theme.colors.accent,
    },
    processingWrap: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      height: 20,
      minHeight: 48,
    },
    ring: {
      width: 16,
      height: 16,
      borderRadius: theme.radii.full,
      borderWidth: 2,
      borderColor: theme.colors["accent-tint"],
      borderTopColor: theme.colors.accent,
    },
  });
}

export default VoiceCaptureIndicator;
