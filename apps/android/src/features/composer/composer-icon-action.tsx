import { useMemo } from "react";
import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, type GestureResponderEvent } from "react-native";

import { useTheme } from "../../ui/theme/theme-context";
import { usePressScale } from "../../ui/theme/use-press-scale";

export interface ComposerIconActionProps {
  /** A single decorative glyph. Never read by TalkBack on its own — see `accessibleName`. */
  glyph: string;
  /** Required: the glyph is hidden from assistive tech, so this is the control's only accessible name. */
  accessibleName: string;
  onPress: (event: GestureResponderEvent) => void;
  testId?: string;
}

/**
 * `ComposerIconAction` — the composer's microphone and attachment
 * controls (plan.md §9.2 "prominent microphone and attachment
 * actions").
 *
 * The shared `IconButton` primitive (`ui/primitives/IconButton.tsx`)
 * only carries the web `IconName` union's glyphs (close/refresh/
 * settings/copy), none of which is a microphone or a paperclip, so this
 * is a small local sibling scoped to `features/composer/` rather than
 * an edit to that shared, already-tested primitive. It mirrors
 * `IconButton`'s exact accessibility and touch-target contract: a
 * `Pressable` whose full 48dp area is the hit target (Beautiful UI's
 * icon-button footprint is a tight ~28dp square, well under the 48dp
 * minimum — plan.md §9.3), press-scale feedback from the same
 * `usePressScale` hook, and a mandatory `accessibleName` since the
 * glyph itself is `accessibilityElementsHidden`.
 *
 * This is a **control that fires a callback**, not a recorder or a file
 * picker — voice capture and attachment upload are later tasks (per this
 * task's brief). `onPress` is the entire contract here.
 */
export function ComposerIconAction({
  glyph,
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
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.glyph}
        >
          {glyph}
        </Text>
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
      width: 28,
      height: 28,
      borderRadius: theme.radii.control,
      alignItems: "center",
      justifyContent: "center",
    },
    glyph: {
      fontSize: 16,
      color: theme.colors.ink,
    },
  });
}
