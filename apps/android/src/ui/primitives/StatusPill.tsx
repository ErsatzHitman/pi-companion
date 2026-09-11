/**
 * The S7 status pill (T350) — an app bar's state readout.
 *
 * The design artifact's `.pill`: 22dp tall, fully rounded, a
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
 * **Still no pulse, now for a different reason (T351).** The artifact
 * animates its dot only on the `run` state, which means "a turn is in
 * flight". T350 shipped this pill against the CONNECTION state, where
 * "connected" is a resting state and a pulsing dot would have animated
 * forever claiming work that was not happening. T351's session app bar
 * changed that: `features/transcript/header-model.ts` gives the pill the
 * SESSION's own state, so its `Working` pill really does mean a turn is
 * running, and a pulse there would be honest. It is still not drawn,
 * deliberately — the dot plus the word already carry the state without
 * colour or motion (plan.md §10.5), an indefinite animation over a
 * multi-minute turn is a real battery and attention cost, and a reduced-
 * motion path would have to switch it off anyway, at which point the
 * static rendering has to be the correct one regardless. A later task
 * may add the pulse; nothing here depends on its absence.
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
  /**
   * The announced name, when the drawn text is not the whole claim
   * (T385: the Live bar's pill DRAWS an elapsed reading while a turn runs
   * and announces `Working, 4m 12s`). Defaults to `label`, which is what
   * every other pill in the app wants — its visible word is its name.
   */
  accessibilityLabel?: string;
  testId?: string;
}

/** The artifact's `.pill` height, in dp (its CSS px map 1:1 at the 412dp reference width). */
const PILL_HEIGHT = 22;
/** The artifact's `.pill { padding: 0 9px }`. */
const PILL_PADDING_HORIZONTAL = 9;
/** The artifact's `.pill { gap: 5px }`. */
const PILL_GAP = 5;
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
  accessibilityLabel,
  testId,
}: StatusPillProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fillColor = theme.colors[TONE_FILL[tone]];
  const textColor = theme.colors[TONE_TEXT[tone]];

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
