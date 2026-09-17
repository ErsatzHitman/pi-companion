/**
 * The S7 status pill (T350) — an app bar's state readout.
 *
 * The design artifact's `.pill`: 26dp tall, fully rounded, a
 * tone-tinted background with the SAME tone as its text, a 6dp dot in
 * `currentColor` for every state except the neutral one, and a hairline
 * ring on the neutral one alone. `Chip` (`./Chip.tsx`) is deliberately
 * not reused: it is 24dp, carries a 1dp border on every tone, always
 * paints its label `ink` rather than the tone, and has no dot — four
 * differences from the artifact, on the single most visible element of
 * the session screen.
 *
 * **Deliberately not in `testing.primitiveLabManifest`.** That manifest is
 * shared by BOTH apps' component labs (`apps/web/src/dev/component-lab.tsx`
 * and `apps/android/src/dev/component-lab.tsx`, each asserted against it by
 * its own `component-lab.test.ts`), so adding a name to it obliges a web
 * twin to exist. This pill is Android-only until the web app grows the
 * same S7 language; the manifest's own promise ("a Section per manifest
 * entry") stays true either way, because nothing asserts the reverse
 * direction. When web gains it, add the name there and both labs pick it
 * up together.
 *
 * **The pulse is drawn now (A-MOTION-2), behind an explicit opt-in
 * (T351's own deferral, answered).** The artifact animates its dot only
 * on the `run` state, which means "a turn is in flight". T350 shipped
 * this pill against the CONNECTION state, where "connected" is a resting
 * state and a pulsing dot would have animated forever claiming work that
 * was not happening — the SAME shape `settings-host-model.ts`'s "Online"
 * pill still is today (`tone: "success"`, drawn with `showDot`, and
 * genuinely a resting state — see `../../features/settings/
 * SettingsScreen.tsx`). Because more than one caller can share a tone
 * that means "resting" in one place and "a turn is running" in another,
 * the pulse cannot be inferred from `tone` the way T351 first
 * considered — it has to be a caller decision, exactly like `showDot`
 * above: "is this state worth a dot" was already a product question
 * about the state, not the tone, and "is this state worth ANIMATING the
 * dot" is the same question one level further. `pulseDot` (below) is
 * that opt-in. T351's battery/attention worry is real and is answered,
 * not dismissed, by making it exactly that: a caller-level choice for
 * the one state that is genuinely "a turn is in flight" — most likely
 * `features/transcript/header-model.ts`'s `Working` pill — rather than
 * a blanket animation this primitive would force on every tone-`success`
 * caller including a resting "Online" host status. Reduced motion still
 * switches it off regardless of what the caller asks for (see `pulseDot`'s
 * own doc comment), so the static rendering stays correct either way,
 * exactly as this paragraph used to argue for withholding the mechanism
 * altogether. No shipped caller passes `pulseDot` yet — see
 * `../theme/expressive-motion.ts`'s own doc comment for what wiring one
 * would need and why that is outside this task's file list. A later task
 * wires a caller to it; nothing here depends on that wiring happening.
 */
import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  EXPRESSIVE_RECORDS_PULSE_DURATION_MS,
  EXPRESSIVE_RECORDS_PULSE_EASING,
  EXPRESSIVE_RECORDS_PULSE_PEAK,
  EXPRESSIVE_RECORDS_PULSE_REST,
} from "../theme/expressive-motion";
import { useTheme } from "../theme/theme-context";
import { asFontWeight } from "../theme/native-style-helpers";
import type { StatusTone } from "./StatusIndicator";

export interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  /**
   * Whether to draw the leading dot. The caller decides, because "is
   * this state worth a dot" is a product question about the state, not
   * about the tone: the artifact gives its `run`/`wait`/`info` states a
   * dot and its neutral `idle` state none, and a caller reporting a
   * different vocabulary may split that line elsewhere.
   */
  showDot?: boolean;
  /**
   * Runs the artifact's `records-pulse` (`.pill.run .dot{animation:
   * records-pulse 1.1s ease-in-out infinite}`) on the dot. Defaults to
   * `false`. The caller decides for the same reason `showDot` does — see
   * this file's own module doc comment — plus a sharper one: `tone`
   * alone cannot tell the artifact's resting `.pill.run`-shaped tone
   * apart from a genuinely resting use of the same tone (e.g. an "Online"
   * host status), so inferring the pulse from `tone` would pulse a
   * connection indicator that is never going to stop. Has no effect
   * unless `showDot` is also true, and never animates under reduced
   * motion regardless of what the caller asks for — the dot then simply
   * sits at the pulse's own rest frame.
   */
  pulseDot?: boolean;
  /**
   * The announced name, when the drawn text is not the whole claim
   * (T385: the Live bar's pill DRAWS an elapsed reading while a turn runs
   * and announces `Working, 4m 12s`). Defaults to `label`, which is what
   * every other pill in the app wants — its visible word is its name.
   */
  accessibilityLabel?: string;
  testId?: string;
}

/** The artifact's `.pill { height: 26px }`, in dp (its CSS px map 1:1 at the 412dp reference width). */
const PILL_HEIGHT = 26;
/** The artifact's `.pill { padding: 0 11px }`. */
const PILL_PADDING_HORIZONTAL = 11;
/** The artifact's `.pill { gap: 6px }`. */
const PILL_GAP = 6;
/** The artifact's `.pill .dot { width: 6px; height: 6px }`. */
const DOT_SIZE = 6;
/**
 * Half of `records-pulse`'s own 1.1s cycle — the keyframe is a true
 * two-value ping-pong (`0%,100%` rest, `50%` peak), so a single
 * `withRepeat(withTiming(peak, {duration: PULSE_HALF_MS}), -1, true)`
 * reproduces it exactly, the same shape `records-pulse`'s own symmetry
 * allows and `pixel-on`'s asymmetric keyframe (`../theme/
 * expressive-motion.ts`) does not.
 */
const PULSE_HALF_MS = EXPRESSIVE_RECORDS_PULSE_DURATION_MS / 2;

/**
 * The pill's fill and its text share a tone. Both are keyed by
 * `StatusTone` here rather than looked up as `styles[\`tone_${tone}\`]`,
 * which TypeScript cannot narrow against a `StyleSheet.create` result
 * and which would silently resolve to `undefined` for a tone the sheet
 * forgot.
 */
const TONE_FILL = {
  success: "green-tint",
  warning: "orange-tint",
  danger: "red-tint",
  info: "accent-tint",
  neutral: "inset",
} as const satisfies Record<StatusTone, string>;

const TONE_TEXT = {
  success: "green",
  warning: "orange",
  danger: "red",
  // The artifact's `.pill.run { color: var(--accent-ink) }` — the darker
  // of the two accent roles, so the tint's own text clears contrast.
  info: "accent-ink",
  neutral: "ink-3",
} as const satisfies Record<StatusTone, string>;

/** The artifact rings only its neutral `.pill.idle`, in `--line`. */
const RINGED_TONE: StatusTone = "neutral";

export function StatusPill({
  label,
  tone = "neutral",
  showDot = false,
  pulseDot = false,
  accessibilityLabel,
  testId,
}: StatusPillProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fillColor = theme.colors[TONE_FILL[tone]];
  const textColor = theme.colors[TONE_TEXT[tone]];
  const pulsing = pulseDot && showDot && !reduceMotion;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.pill,
        { backgroundColor: fillColor },
        tone === RINGED_TONE ? styles.pillRing : null,
      ]}
      testID={testId}
    >
      {showDot ? (
        // `currentColor` in the artifact; React Native has no such
        // cascade, so the dot takes the tone's own colour explicitly.
        pulsing ? (
          <PulseDot color={textColor} />
        ) : (
          <View style={[styles.dot, { backgroundColor: textColor }]} />
        )
      ) : null}
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The artifact's `records-pulse` on `.pill.run .dot`. Rendered only when `pulseDot`, `showDot` and `!reduceMotion` all hold — see `StatusPillProps.pulseDot`'s own doc comment. */
function PulseDot({ color }: { color: string }) {
  const { theme } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: PULSE_HALF_MS,
        easing: Easing.bezier(...EXPRESSIVE_RECORDS_PULSE_EASING),
      }),
      -1,
      true,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity:
      EXPRESSIVE_RECORDS_PULSE_REST.opacity +
      (EXPRESSIVE_RECORDS_PULSE_PEAK.opacity - EXPRESSIVE_RECORDS_PULSE_REST.opacity) *
        progress.value,
    transform: [
      {
        scale:
          EXPRESSIVE_RECORDS_PULSE_REST.scale +
          (EXPRESSIVE_RECORDS_PULSE_PEAK.scale - EXPRESSIVE_RECORDS_PULSE_REST.scale) *
            progress.value,
      },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: theme.radii.full,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: PILL_GAP,
      height: PILL_HEIGHT,
      paddingHorizontal: PILL_PADDING_HORIZONTAL,
      borderRadius: theme.radii.full,
    },
    pillRing: {
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: theme.radii.full,
    },
    label: {
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}
