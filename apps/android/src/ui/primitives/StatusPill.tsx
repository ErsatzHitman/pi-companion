/**
 * The S7 status pill (T350) — an app bar's state readout.
 *
 * The design artifact's `.pill`: 26dp tall, fully rounded, no border, a
 * tone-tinted background with the SAME tone as its text, and a 6dp dot in
 * `currentColor` for every state except the neutral one. `Chip`
 * (`./Chip.tsx`) is deliberately not reused: it is 24dp, carries a 1dp
 * border, always paints its label `ink` rather than the tone, and has no
 * dot — four differences from the artifact, on the single most visible
 * element of the session screen.
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
 * **No pulse.** The artifact animates its dot only on the `run` state,
 * which means "a turn is in flight". This pill reports the CONNECTION
 * state, where "connected" is a resting state, not activity — a pulsing
 * dot there would animate forever and claim work that is not happening.
 * The turn-running indicator is a separate element and can carry the
 * pulse when it lands.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

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
  testId?: string;
}

/** The artifact's `.pill` height, in dp (its CSS px map 1:1 at the 412dp reference width). */
const PILL_HEIGHT = 26;
/** The artifact's `.pill .dot`. */
const DOT_SIZE = 6;

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
  info: "accent",
  neutral: "ink-2",
} as const satisfies Record<StatusTone, string>;

export function StatusPill({ label, tone = "neutral", showDot = false, testId }: StatusPillProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fillColor = theme.colors[TONE_FILL[tone]];
  const textColor = theme.colors[TONE_TEXT[tone]];

  return (
    <View style={[styles.pill, { backgroundColor: fillColor }]} testID={testId}>
      {showDot ? (
        // `currentColor` in the artifact; React Native has no such
        // cascade, so the dot takes the tone's own colour explicitly.
        <View style={[styles.dot, { backgroundColor: textColor }]} />
      ) : null}
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: theme.spacing[1] + 2,
      height: PILL_HEIGHT,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.radii.full,
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
