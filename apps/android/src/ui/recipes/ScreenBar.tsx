import { useMemo, type ReactNode } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { usePressScale } from "../theme/use-press-scale";

/**
 * ScreenBar recipe (T350) — the redesign's shared top bar.
 *
 * All four redesigned screens open with the same strip: an optional
 * round icon button on the left, a title that takes the remaining width
 * and ellipsises, an optional trailing slot (a status pill, most often),
 * and an optional round icon button on the right. The session screen
 * adds a mono subtitle beside its title. Rather than four
 * near-identical headers drifting apart one screen at a time, they all
 * mount this.
 *
 * **The marks are Unicode, on purpose.** The artifact draws this bar's
 * affordances as text characters (`☰`, `⧉`, `‹`, `✕`, `⌕`), not as
 * paths — unlike its prompt bar, which specifies stroked SVG and gets
 * `ui/primitives/vector-icons.tsx` instead. Passing the mark in as a
 * string keeps this recipe from owning a glyph vocabulary of its own;
 * the caller says what its bar means.
 *
 * **Touch target.** The visible mark box is the confirmed spec's 36dp
 * rounded square (`.ic{width:36px;height:36px;...}`, android-spec.html),
 * and the `Pressable` around it is the full 48dp minimum (plan.md §9.3,
 * T26C) — the same split `ui/primitives/IconButton.tsx` already uses,
 * and audited by the same shared loop in
 * `ui/primitives/touch-targets.test.ts`. (CORRECTED: this used to size
 * the mark box at 34dp and justify the bar's 48dp height against "the
 * artifact's 46dp `.bar`" — the confirmed spec's own `.bar` rule
 * declares no height at all (`display:flex;align-items:center;gap:8px;
 * padding:8px 10px;flex:none`), so there was never a 46dp bar height to
 * reconcile a two-pixel difference against. `BAR_MIN_HEIGHT` stands on
 * plan.md §9.3's own 48dp touch floor alone.) The mark itself is
 * hidden from assistive tech; `accessibleName` is the only name the
 * button has, and it is required, so a bar action can never ship
 * announced as its glyph (plan.md §10.5).
 *
 * **Deliberately not in `testing.recipeLabManifest`.** That manifest is
 * asserted by BOTH apps' recipe labs, so a name added there obliges a
 * web twin to exist. This bar is Android-only until the web app adopts
 * the same shape; nothing asserts the reverse direction, so the
 * omission is a decision rather than an oversight. It is in
 * `recipe-accessibility.test.ts`'s own list, which is this app's, and
 * which is where its theming and accessibility contracts are pinned.
 */
export interface ScreenBarAction {
  /** The artifact's own mark for this action, e.g. `"‹"`. Hidden from assistive tech. */
  mark: string;
  /** Required: the mark is decorative, so this is the button's only accessible name. */
  accessibleName: string;
  onPress: () => void;
  testId?: string;
}

export interface ScreenBarProps {
  title: string;
  /**
   * A mono line rendered beside the title, at the artifact's smaller
   * size — the session screen's working directory. Absent on every
   * other screen.
   */
  subtitle?: string;
  leading?: ScreenBarAction;
  trailing?: ScreenBarAction;
  /**
   * Rendered between the title and `trailing`. The status pill, on the
   * screens that carry one; a node rather than a pill-shaped prop so
   * this recipe takes no opinion on what a given screen reports.
   */
  status?: ReactNode;
  testId?: string;
}

/** The confirmed Android design's `.ic`, a full pill. The touch target around it is 48dp; see this file's doc comment. */
const MARK_BUTTON_SIZE = 36;
/** The artifact's `.ic` font size. */
const MARK_FONT_SIZE = 15;
/** The artifact's `.bar-t`. */
const TITLE_FONT_SIZE = 13.5;
/** The artifact's `.bar-s`. */
const SUBTITLE_FONT_SIZE = 10.5;
/** The artifact's `.bar` own height, before the 48dp touch minimum is applied. */
const BAR_MIN_HEIGHT = 48;
/** The artifact's `.bar-t { letter-spacing: -0.1px }`, in dp at this size. */
const TITLE_LETTER_SPACING = -0.1;

function BarAction({ action }: { action: ScreenBarAction }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // A-MOTION: this bar's mark button is the artifact's `.ic` (see the
  // radius comment on `markButton` below), so it presses like one —
  // `usePressScale`'s `"icon"` variant, not the shared Beautiful UI default.
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale("icon");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibleName}
      onPress={action.onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={action.testId}
      style={({ pressed }) => [styles.touchArea, pressed ? styles.touchAreaPressed : null]}
    >
      <Animated.View style={[styles.markButton, pressStyle]}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.mark}
        >
          {action.mark}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function ScreenBar({ title, subtitle, leading, trailing, status, testId }: ScreenBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View accessibilityRole="header" style={styles.bar} testID={testId}>
      {leading ? <BarAction action={leading} /> : null}
      <View style={styles.titleGroup}>
        <Text
          style={styles.title}
          numberOfLines={1}
          testID={testId ? `${testId}-title` : undefined}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={styles.subtitle}
            numberOfLines={1}
            testID={testId ? `${testId}-subtitle` : undefined}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {status}
      {trailing ? <BarAction action={trailing} /> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: BAR_MIN_HEIGHT,
      paddingHorizontal: theme.spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.page,
    },
    touchArea: {
      minWidth: 48,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radii.full,
    },
    touchAreaPressed: { backgroundColor: theme.colors.hover },
    markButton: {
      width: MARK_BUTTON_SIZE,
      height: MARK_BUTTON_SIZE,
      // A-SHAPE: the confirmed Android design draws `.ic` at
      // `border-radius: var(--r-full)`, a full pill, and `.scr-btn` the
      // same way — so does `IconButton`, the primitive this recipe's
      // mark button mirrors. This said "the artifact's `.ic` radius is
      // 9px; `radii.control` (8) is the nearest named step", which was
      // read off the older reconstruction under `docs/ui-reference/` and
      // is no longer what the design specifies. See
      // `ui/theme/expressive-shape.ts` and its `EXPRESSIVE_RADIUS_FULL`
      // for the Android-only scale and why the shared `radii` keeps its
      // own 8px control step for the web.
      borderRadius: theme.radii.full,
      alignItems: "center",
      justifyContent: "center",
    },
    mark: {
      color: theme.colors["ink-2"],
      fontSize: MARK_FONT_SIZE,
    },
    titleGroup: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "baseline",
      gap: theme.spacing[2],
    },
    title: {
      flexShrink: 1,
      color: theme.colors.ink,
      fontSize: TITLE_FONT_SIZE,
      letterSpacing: TITLE_LETTER_SPACING,
      // CORRECTED: this read `fontWeight.semibold` (600). The confirmed
      // spec's `.bar-t{font:500 13.5px/1.3 Inter,sans-serif;...}` is 500,
      // one step lighter — `fontWeight.medium`.
      fontWeight: asFontWeight(theme.typography.fontWeight.medium),
    },
    // The mono family, so a working directory reads as a path rather
    // than as prose.
    subtitle: {
      flexShrink: 1,
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: SUBTITLE_FONT_SIZE,
    },
  });
}

export default ScreenBar;
