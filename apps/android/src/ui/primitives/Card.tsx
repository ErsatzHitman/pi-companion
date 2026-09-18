import { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { EXPRESSIVE_RADII } from "../theme/expressive-shape";

/**
 * Card primitive (plan.md §10.3): a raised `surface` container outlined
 * with Beautiful UI's 1px ring rather than a blurred drop shadow
 * (`ringShadow`, docs/beautiful-ui-reference.md "Shadows are rings, not
 * blurs").
 *
 * Shape and padding follow the confirmed Android design's own `.card` rule
 * — `.card{background:var(--surface);box-shadow:var(--shadow-card);
 * border-radius:var(--r-md);padding:12px 14px}`, measured directly against
 * `C:/Users/aksha/Downloads/pi-ui-goal/android-spec.html` — the same move
 * `sessions-screen.tsx`'s `row` style and `live-screen.tsx`'s `card` style
 * already made: `--r-md` is `EXPRESSIVE_RADII.md` (22), not
 * `theme.radii.card` (10, the shared scale's own value — unchanged here,
 * `packages/design-tokens/src/tokens.test.ts` still asserts
 * `radii.card` is 10 and that fact is untouched by this file). The 12/14
 * padding is asymmetric and 14 has no `spacing` scale entry (the scale
 * steps `spacing[3]=12` -> `spacing[4]=16`), so the horizontal half stays a
 * named literal rather than rounding to a token, the same pattern
 * `work-group-row.tsx`'s `RUNHEAD_GAP`/`RUNHEAD_PADDING_HORIZONTAL` already
 * use for the identical reason.
 */
const CARD_PADDING_HORIZONTAL = 14;

export function Card({ style, ...rest }: ViewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={[styles.card, style]} {...rest} />;
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: EXPRESSIVE_RADII.md,
      paddingVertical: theme.spacing[3],
      paddingHorizontal: CARD_PADDING_HORIZONTAL,
      ...ringShadow(theme, "card"),
    },
  });
}
