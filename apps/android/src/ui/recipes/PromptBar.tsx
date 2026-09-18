import { useMemo, useState, type ReactNode } from "react";
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
   * here (unowned this wave — see this file's doc comment). AND-PROMPTBAR
   * additionally wires this event to the box's own `:focus-within`
   * treatment below — see "Focus state" in the component doc comment.
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
 * **One row, exactly as the confirmed spec draws it.** Quoting the
 * confirmed spec's own CSS (`android-spec.html`), which is the authority
 * for every figure below. That file declares `.cmp-box` twice, and the
 * LATER declaration wins for every property the two share — this is
 * already the resolved, winning text, not the raw source order:
 *
 * ```css
 * .cmp-box{display:flex;align-items:center;gap:4px;padding:5px 6px 5px 8px;
 *          border-radius:var(--r-full);background:var(--canvas);
 *          box-shadow:0 0 0 1.5px var(--line-strong);
 *          transition:box-shadow .18s,background .18s}
 * .cmp-box:focus-within{background:var(--inset);
 *          box-shadow:0 0 0 1.5px color-mix(in oklab,var(--ink-3) 80%,var(--line-strong))}
 * .cmp-box .inp{flex:1;min-width:0;min-height:22px;padding:6px 4px;
 *          border-radius:0;background:none;box-shadow:none;
 *          font:13.5px/1.45 Inter,system-ui,sans-serif;color:var(--ink);outline:none}
 * .cmp-box .ic{width:34px;height:34px;flex:none;border:0;border-radius:var(--r-full);
 *          background:transparent;box-shadow:none;color:var(--ink-2);
 *          transition:transform .42s cubic-bezier(.34,1.7,.5,1),background .18s,color .18s}
 * .cmp-box .ic svg{width:19px;height:19px}
 * .cmp-box .ic:active{transform:scale(.88)}
 * .cmp-box .ic.send{width:36px;height:36px;background:var(--accent);
 *          color:#08131f;box-shadow:0 1px 2px rgba(0,0,0,.28)}
 * .cmp-box .ic.send svg{width:18px;height:18px}
 * ```
 *
 * (CORRECTED for FIX-PROMPTBAR: `.cmp-box .ic svg{width:19px;height:19px}`
 * is the generic `.ic svg` rule, but the Send icon is drawn by the MORE
 * SPECIFIC `.cmp-box .ic.send svg{width:18px;height:18px}` — three classes
 * against two — and Send is the only icon this recipe draws inside
 * `.cmp-box`. The same specificity reasoning already correctly won `.ic.send`
 * 36px over the shared `.ic` 34px one selector up; this file previously
 * missed the identical override for the nested `svg`, so `SEND_ICON_SIZE`
 * below was 19, not the 18 the cascade actually resolves to.)
 *
 * (CORRECTED for AND-PROMPTBAR: this doc comment used to quote
 * `docs/ui-reference/pi-companion-app.html` — the STALE reconstruction,
 * never authority for a product decision — as "the reference's own CSS,
 * which is the authority for every figure below." `grep -c` over the two
 * files finds `--sh-raised` and `var(--mono)` nowhere in the confirmed
 * `android-spec.html`, but 4 and 21 times respectively in the stale file,
 * so every figure quoted below was drawn from the wrong document. The
 * block it used to quote read:
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
 * :root[data-theme="dark"] .cmp .ic.send { color: #0d1b2a }
 * ```
 * )
 *
 * So the bar is the attach mark, the context ring, the input, the
 * microphone and Send — one flex row, `align-items: center`, 4 apart, on
 * `canvas` with a `line-strong` 1.5dp hairline ring, radius fully round
 * (not the 18px corner the stale quotation gave). The transcript, by
 * contrast, stays on the mono family (`theme.typography.variant.code`) —
 * this recipe alone moves to sans; see "Input typography" below for why
 * the two are meant to differ here.
 *
 * **UI-A2: the send icon reads `accentContrast`, not `theme.colors.page`
 * (what this recipe used to read).** The confirmed spec's own literal for
 * `.ic.send`'s icon colour is the single, non-theme-conditional
 * `#08131f`. Checked directly rather than assumed: neither `accentContrast`
 * nor the `onSolidFill` alias it is built from reproduces that literal —
 * `onSolidFillFor` resolves to `beautifulDark.page` (`#17181a`) in dark and
 * a flat `#f7f8f9` in light, and the light value in particular is a
 * near-white, the opposite end of the lightness scale from the spec's
 * near-black literal. No token in `design-tokens/src/tokens.ts` carries
 * `#08131f` (that file is read-only for this task, so none was added);
 * `accentContrast` stays as the closest existing on-accent semantic role —
 * the same alias `Button.tsx`'s own primary variant already paints on the
 * identical `accent` background — rather than hardcoding the literal here.
 *
 * **The queued counter stays, one line above the box.** The reference
 * has no queue state to draw; the counter is this app's, and keeping it
 * inside the row would fight the input for the same slack. It keeps its
 * `accessibilityLiveRegion="polite"`.
 *
 * **Every mark keeps its 48dp touch floor (plan.md §9.3).** The artifact
 * draws 34dp boxes (36dp for Send); the press targets here are 48dp and
 * the smaller boxes are drawn inside them, exactly as `features/composer/
 * composer-icon-action.tsx` and `ui/primitives/IconButton.tsx` do. The
 * input itself is a touch target too, so its `minHeight` is 48 while its
 * drawn box stays close to the reference's own `min-height: 22px`.
 *
 * **Icon radius now agrees with `composer-icon-action.tsx`.** That file
 * already draws its 34dp icon boxes at `theme.radii.full` (a full pill,
 * matching the spec's `border-radius:var(--r-full)` on `.cmp-box .ic`).
 * This recipe's own Send box is the same selector's `.ic.send` variant —
 * a 36dp override of the same full-round `.ic` — so it now reads
 * `theme.radii.full` too, instead of a fixed corner radius. The two no
 * longer disagree.
 *
 * **Input typography.** `.cmp-box .inp` sets `font:13.5px/1.45
 * Inter,system-ui,sans-serif` — a font-FAMILY change, not only a size
 * change, from what this recipe used to draw (the theme's mono code
 * variant at 12px/1.6, still what the transcript uses). `theme.typography.
 * variant.body` is this theme's sans role (native Android resolves it to
 * the registered `Inter_400Regular` face, the same way `variant.code`
 * resolves to the registered mono face), so the input's `fontFamily` now
 * reads that variant's `fontFamily` instead of `code`'s.
 *
 * **Focus state.** `onFocus`/`onBlur` used to be forwarded straight to the
 * bare `TextInput` and never reached the box's own style — the spec's
 * `.cmp-box:focus-within` rule (background moves to `inset`, the hairline
 * ring shifts toward `ink-3`) had no live path to fire. Both handlers now
 * also flip a local `isFocused` flag that the box style reads, so the ring
 * and background genuinely change on focus/blur — a state change, not an
 * animation, so nothing here is gated on reduced motion. The ring's exact
 * focused colour, `color-mix(in oklab, var(--ink-3) 80%, var(--line-strong))`,
 * has no React Native equivalent and no existing token computes that mix;
 * `ink-3` alone — the 80% component of the mix, and already this theme's
 * own token — is used as the nearest available approximation rather than
 * hardcoding a blended literal, since `design-tokens/src/tokens.ts` is
 * read-only for this task.
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
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (event: FocusEvent) => {
    setIsFocused(true);
    onFocus?.(event);
  };
  const handleBlur = (event: BlurEvent) => {
    setIsFocused(false);
    onBlur?.(event);
  };

  return (
    <View style={styles.wrapper} testID={testId}>
      <Text style={styles.queued} accessibilityLiveRegion="polite">
        {queuedCount > 0 ? `${queuedCount} queued` : ""}
      </Text>
      <View style={[styles.box, isFocused ? styles.boxFocused : null]}>
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
          onFocus={handleFocus}
          onBlur={handleBlur}
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
            <VectorIcon name="send" size={SEND_ICON_SIZE} color={theme.colors.accentContrast} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/** `.cmp-box { padding: 5px 6px 5px 8px }`. */
const BOX_PADDING_TOP = 5;
const BOX_PADDING_BOTTOM = 5;
const BOX_PADDING_RIGHT = 6;
const BOX_PADDING_LEFT = 8;
/** `.cmp-box { gap: 4px }`. */
const BOX_GAP = 4;
/** `.cmp-box { box-shadow: 0 0 0 1.5px var(--line-strong) }`, rendered as a flat ring border. */
const BOX_RING_WIDTH = 1.5;
/** `.cmp-box .ic.send { width: 36px; height: 36px }`. */
const SEND_BOX_SIZE = 36;
/**
 * `.cmp-box .ic.send svg { width: 18px; height: 18px }` — the send icon's
 * own, more specific override of the shared `.cmp-box .ic svg { width:
 * 19px; height: 19px }` rule (three classes beat two; see the component
 * doc comment's FIX-PROMPTBAR correction).
 */
const SEND_ICON_SIZE = 18;
/** `.cmp-box .inp { font: 13.5px/1.45 Inter,system-ui,sans-serif }`. */
const INPUT_FONT_SIZE = 13.5;
const INPUT_LINE_HEIGHT = INPUT_FONT_SIZE * 1.45;
/** `.cmp-box .inp { padding: 6px 4px }`. */
const INPUT_PADDING_VERTICAL = 6;
const INPUT_PADDING_HORIZONTAL = 4;
/**
 * The earlier, non-overridden `.cmp-box .inp { max-height: 110px }`
 * declaration — the winning `.cmp-box .inp` block quoted above does not
 * redeclare `max-height`, so this property is not one the two `.cmp-box`
 * declarations share and the earlier value still applies.
 */
const INPUT_MAX_HEIGHT = 110;

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[1],
    },
    box: {
      flexDirection: "row",
      alignItems: "center",
      gap: BOX_GAP,
      backgroundColor: theme.colors.canvas,
      borderRadius: theme.radii.full,
      borderWidth: BOX_RING_WIDTH,
      borderColor: theme.colors["line-strong"],
      paddingTop: BOX_PADDING_TOP,
      paddingBottom: BOX_PADDING_BOTTOM,
      paddingRight: BOX_PADDING_RIGHT,
      paddingLeft: BOX_PADDING_LEFT,
    },
    // `.cmp-box:focus-within`. The ring colour is an approximation — see
    // "Focus state" in the component doc comment.
    boxFocused: {
      backgroundColor: theme.colors.inset,
      borderColor: theme.colors["ink-3"],
    },
    input: {
      // The 48dp touch floor the artifact's ~22dp input box does not
      // meet; the drawn box below stays close to the reference's own size.
      // (`min-width: 0` from the reference is deliberately not written:
      // the 48dp audit reads a declared `minWidth` of 0 as a violation,
      // and `flex: 1` already lets the field shrink.)
      flex: 1,
      minHeight: 48,
      maxHeight: INPUT_MAX_HEIGHT,
      paddingVertical: INPUT_PADDING_VERTICAL,
      paddingHorizontal: INPUT_PADDING_HORIZONTAL,
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.body.fontFamily,
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
      width: SEND_BOX_SIZE,
      height: SEND_BOX_SIZE,
      borderRadius: theme.radii.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
      // `.cmp-box .ic.send { box-shadow: 0 1px 2px rgba(0,0,0,.28) }`.
      // The colour itself is resolved from the theme's native elevation
      // shadow shape (`NativeShadow.shadowColor`), not a literal in this
      // file — the same pattern `native-style-helpers.ts`'s `ringShadow`
      // and `Toast.tsx` already use for their own shadows.
      shadowColor: theme.elevation[1].shadowColor,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.28,
      shadowRadius: 2,
      elevation: 2,
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
