import { useMemo, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type BlurEvent,
  type FocusEvent,
} from "react-native";

import { VectorIcon } from "../primitives/vector-icons";
import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface PromptBarProps {
  label: string;
  placeholder: string;
  value: string;
  canSend: boolean;
  queuedCount: number;
  onValueChange: (value: string) => void;
  onSend: () => void;
  /**
   * Fires when the input gains focus. T33B4's `composer-focus-model.ts`
   * names this exact gap (no consumer path from a real focus event to
   * `focusComposer`) as the reason `resolveFocusOwner` has no live
   * input yet; `Composer.tsx` is expected to call `focusComposer` from
   * here (unowned this wave — see this file's doc comment).
   */
  onFocus?: (event: FocusEvent) => void;
  /** Fires when the input loses focus; the `blurComposer` counterpart to `onFocus` above. */
  onBlur?: (event: BlurEvent) => void;
  /**
   * The node(s) drawn at the bar's LEFT, before the input — the
   * reference's attach `+` and the context ring, in that order (T351,
   * T353). A slot rather than named props so this recipe keeps no
   * opinion on what a given app puts in its bar; it is optional, so
   * nothing that mounted this recipe before has to change.
   */
  leading?: ReactNode;
  /**
   * The node drawn between the input and Send — the reference's
   * microphone. Same slot rationale as `leading` above; the mic is its
   * own control in `features/composer/`, not this recipe's business, so
   * it arrives already built and already named.
   */
  trailing?: ReactNode;
  testId?: string;
}

/**
 * PromptBar recipe (plan.md §10.4): the message composer, with a queued
 * message counter for messages sent while Pi is still working. Clean-
 * specification recipe (plan.md §10.1), matching the web recipe's
 * semantics.
 *
 * **One row, exactly as the artifact draws it.** Quoting the reference's
 * own CSS, which is the authority for every figure below:
 *
 * ```css
 * .cmp-box { display:flex; align-items:flex-end; gap:4px;
 *            background: var(--surface); border-radius: 18px;
 *            box-shadow: var(--sh-raised); padding: 6px 6px 6px 4px }
 * .cmp-box .inp { flex:1; min-width:0; font-family: var(--mono);
 *                 font-size: 12px; line-height: 1.6; padding: 7px 2px;
 *                 max-height: 110px }
 * .ic { width: 34px; height: 34px; border-radius: 9px }
 * .cmp .ic.send { background: var(--accent); color: var(--surface) }
 * ```
 *
 * So the bar is the attach mark, the context ring, the input, the
 * microphone and Send — one flex row, `align-items: flex-end`, 4 apart,
 * on `surface`, radius 18. It used to be a column (input above, then a
 * row of ring/queued/Send), which put the microphone and attachment
 * outside the bar entirely and made Send a labelled text button.
 *
 * **The queued counter stays, one line above the box.** The reference
 * has no queue state to draw; the counter is this app's, and keeping it
 * inside the row would fight the input for the same slack. It keeps its
 * `accessibilityLiveRegion="polite"`.
 *
 * **Every mark keeps its 48dp touch floor (plan.md §9.3).** The artifact
 * draws 34dp boxes; the press targets here are 48dp and the 34dp boxes
 * are drawn inside them, exactly as `features/composer/
 * composer-icon-action.tsx` and `ui/primitives/IconButton.tsx` do. The
 * input itself is a touch target too, so its `minHeight` is 48 while its
 * drawn box stays the reference's `max-height: 110`.
 *
 * Accessibility (plan.md §10.5): a labelled `TextInput` (`accessibilityLabel`,
 * not a placeholder alone), a submit editing shortcut mirroring web's
 * Enter-to-send, and the queued-message count is both visible text and an
 * `accessibilityLiveRegion="polite"` region so TalkBack announces it
 * updating. Send is a real `Pressable` with an `accessibilityLabel` — its
 * drawing is a stroked SVG hidden from assistive tech, so the label is
 * the only name it has.
 */
export function PromptBar({
  label,
  placeholder,
  value,
  canSend,
  queuedCount,
  onValueChange,
  onSend,
  onFocus,
  onBlur,
  leading,
  trailing,
  testId,
}: PromptBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrapper} testID={testId}>
      <Text style={styles.queued} accessibilityLiveRegion="polite">
        {queuedCount > 0 ? `${queuedCount} queued` : ""}
      </Text>
      <View style={styles.box}>
        {leading}
        <TextInput
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={theme.colors["ink-3"]}
          value={value}
          onChangeText={onValueChange}
          onSubmitEditing={() => {
            if (canSend) onSend();
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          multiline
          style={styles.input}
          testID={testId ? `${testId}-input` : undefined}
        />
        {trailing}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send prompt"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={onSend}
          style={styles.sendTouch}
          testID={testId ? `${testId}-send` : undefined}
        >
          <View style={[styles.sendBox, canSend ? null : styles.sendBoxDisabled]}>
            <VectorIcon name="send" size={SEND_ICON_SIZE} color={theme.colors.page} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/** `.cmp-box { border-radius: 18px }` — no token at 18, so the reference's own figure. */
const BOX_RADIUS = 18;
/** `.cmp-box { padding: 6px 6px 6px 4px }`. */
const BOX_PADDING_TOP = 6;
const BOX_PADDING_BOTTOM = 6;
const BOX_PADDING_RIGHT = 6;
const BOX_PADDING_LEFT = 4;
/** `.cmp-box { gap: 4px }`. */
const BOX_GAP = 4;
/** `.ic { width: 34px; height: 34px; border-radius: 9px }`. */
const ICON_BOX_SIZE = 34;
const ICON_BOX_RADIUS = 9;
/** The stroked arrow inside the 34dp Send box. */
const SEND_ICON_SIZE = 17;
/** The transcript line's own mono metrics: `.inp { font-size: 12px; line-height: 1.6 }`. */
const INPUT_FONT_SIZE = 12;
const INPUT_LINE_HEIGHT = INPUT_FONT_SIZE * 1.6;
/** `.cmp-box .inp { max-height: 110px }`. */
const INPUT_MAX_HEIGHT = 110;
/** `.cmp-box .inp { padding: 7px 2px }`. */
const INPUT_PADDING_VERTICAL = 7;
const INPUT_PADDING_HORIZONTAL = 2;

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[1],
    },
    box: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: BOX_GAP,
      backgroundColor: theme.colors.surface,
      borderRadius: BOX_RADIUS,
      // `--sh-raised`. `ringShadow` exposes only the `card`/`overlay`
      // tiers, and `raised` sits between them; the card tier is the one
      // this bar already used, so it keeps it rather than inventing a
      // third.
      ...ringShadow(theme, "card"),
      paddingTop: BOX_PADDING_TOP,
      paddingBottom: BOX_PADDING_BOTTOM,
      paddingRight: BOX_PADDING_RIGHT,
      paddingLeft: BOX_PADDING_LEFT,
    },
    input: {
      // The 48dp touch floor the artifact's ~34dp input box does not
      // meet; the drawn box below stays the reference's own size.
      // (`min-width: 0` from the reference is deliberately not written:
      // the 48dp audit reads a declared `minWidth` of 0 as a violation,
      // and `flex: 1` already lets the field shrink.)
      flex: 1,
      minHeight: 48,
      maxHeight: INPUT_MAX_HEIGHT,
      paddingVertical: INPUT_PADDING_VERTICAL,
      paddingHorizontal: INPUT_PADDING_HORIZONTAL,
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: INPUT_FONT_SIZE,
      lineHeight: INPUT_LINE_HEIGHT,
      textAlignVertical: "top",
    },
    // `.ic.send`'s accent box, drawn inside a 48dp press target.
    sendTouch: {
      minWidth: 48,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBox: {
      width: ICON_BOX_SIZE,
      height: ICON_BOX_SIZE,
      borderRadius: ICON_BOX_RADIUS,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    sendBoxDisabled: { opacity: 0.4 },
    // The mono family with tabular figures for the queued-message counter
    // (docs/beautiful-ui-reference.md "tabular-nums on counters and
    // timers"). One line above the box, right-aligned so it reads as
    // meta about the input rather than part of it.
    queued: {
      alignSelf: "flex-end",
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default PromptBar;
