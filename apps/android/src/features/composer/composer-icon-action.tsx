import { useMemo } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, type GestureResponderEvent } from "react-native";

import { VectorIcon, type VectorIconName } from "../../ui/primitives/vector-icons";
import { useTheme } from "../../ui/theme/theme-context";
import { usePressScale } from "../../ui/theme/use-press-scale";

/** The artifact's `.ic { width: 34px; height: 34px; border-radius: 9px }` box. */
const ICON_BOX_SIZE = 34;
const ICON_BOX_RADIUS = 9;
/** `.ic svg { width: 17px; height: 17px }`. */
const ICON_SIZE = 17;

export interface ComposerIconActionProps {
  /**
   * A single decorative glyph, for a control the S7 icon set has no
   * drawing for (the slash-command mark is the literal `/`). Exactly one
   * of `glyph`/`icon` must be given.
   */
  glyph?: string;
  /**
   * One of `ui/primitives/vector-icons.tsx`'s stroked SVG paths — what
   * the composer's mic, attach and camera marks use. A font glyph is a
   * different drawing at a different weight on every OEM fallback, which
   * is why the redesign's marks are real paths.
   */
  icon?: VectorIconName;
  /** Required: the mark is hidden from assistive tech, so this is the control's only accessible name. */
  accessibleName: string;
  onPress: (event: GestureResponderEvent) => void;
  testId?: string;
}

/**
 * `ComposerIconAction` — the composer's microphone, attachment and
 * camera controls (plan.md §9.2 "prominent microphone and attachment
 * actions").
 *
 * The shared `IconButton` primitive (`ui/primitives/IconButton.tsx`)
 * only carries the web `IconName` union's glyphs (close/refresh/
 * settings/copy), none of which is a microphone, a plus or a camera, so
 * this is a small local sibling scoped to `features/composer/` rather
 * than an edit to that shared, already-tested primitive. It mirrors
 * `IconButton`'s exact accessibility and touch-target contract: a
 * `Pressable` whose full 48dp area is the hit target (the artifact's own
 * icon footprint is a 34dp square, under the 48dp minimum — plan.md
 * §9.3), press-scale feedback from the same `usePressScale` hook, and a
 * mandatory `accessibleName` since the mark itself is
 * `accessibilityElementsHidden`.
 *
 * **`icon` is how the S7 language arrives.** The prompt bar's attach and
 * mic marks are the artifact's own stroked SVG paths (`plus`, `mic`,
 * `send`), so this component now accepts an icon name as well as a text
 * glyph; the glyph form stays for the slash-command control, which the
 * reference draws as a literal `/` and which a vector path would not
 * improve.
 *
 * This is a **control that fires a callback**, not a recorder or a file
 * picker — voice capture and attachment upload are later tasks (per this
 * task's brief). `onPress` is the entire contract here.
 */
export function ComposerIconAction({
  glyph,
  icon,
  accessibleName,
  onPress,
  testId,
}: ComposerIconActionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testId}
      style={({ pressed }) => [styles.touchArea, pressed ? styles.touchAreaPressed : null]}
    >
      <Animated.View style={[styles.glyphWrap, pressStyle]}>
        {icon !== undefined ? (
          <VectorIcon name={icon} size={ICON_SIZE} color={theme.colors["ink-2"]} />
        ) : (
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.glyph}
          >
            {glyph}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    touchArea: {
      minWidth: 48,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radii.full,
    },
    touchAreaPressed: { backgroundColor: theme.colors.hover },
    glyphWrap: {
      width: ICON_BOX_SIZE,
      height: ICON_BOX_SIZE,
      borderRadius: ICON_BOX_RADIUS,
      alignItems: "center",
      justifyContent: "center",
    },
    glyph: {
      fontSize: 16,
      color: theme.colors.ink,
    },
  });
}
