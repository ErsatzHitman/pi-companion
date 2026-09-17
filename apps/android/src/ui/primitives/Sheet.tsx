import { useId, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import {
  EXPRESSIVE_FADE_UP_DURATION_MS,
  EXPRESSIVE_FADE_UP_EASING,
  EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y,
} from "../theme/expressive-motion";
import { EXPRESSIVE_RADIUS_LG } from "../theme/expressive-shape";
import { useTheme } from "../theme/theme-context";
import { usePortalOutlet } from "./Portal";
import { useModalBehavior } from "./use-modal-behavior";

/**
 * Where the panel sits (T361; W14-PMENU added `"menu"`).
 *
 * `"edge"` is the original: anchored to the bottom edge, square at
 * the bottom, rounded at the top — a settings or picker sheet.
 *
 * `"floating"` is the redesign's `.pop` (`HANDOFF.md` §7.2): inset
 * from both sides, lifted clear of the prompt bar, and fully
 * rounded. The artifact uses it for a question the model is waiting
 * on an answer to, and the difference in shape is the whole point —
 * a panel that floats over the conversation reads as part of it,
 * where a panel welded to the bottom edge reads as app chrome.
 *
 * `"menu"` is the redesign's `.pmenu` — what `PromptControlsMenu.tsx`
 * opens. `android-spec.html` states its own reason for a THIRD shape
 * rather than reusing `"floating"`'s own clearance: "anchored above
 * the pill row, which now sits above the prompt bar — so the menu
 * clears both, and neither the row being changed nor the input is
 * covered. **Not a bottom sheet.**" `"floating"`'s clearance covers
 * only the prompt bar; `"menu"`'s covers the pill row sitting above
 * it too, which is a genuinely different number (see `MENU_BOTTOM`),
 * not a rounding of `"floating"`'s own.
 *
 * The scrim, the portal, the TalkBack focus move and the back
 * gesture are identical across all three, which is why this is a
 * variant rather than a second (or third) component — only the two
 * numbers a shape needs (clearance off the edge, padding) differ.
 * `.pmenu` is also the only one of the three the artifact animates in
 * (`fade-up`); see `Sheet`'s own doc comment for where that lives.
 */
export type SheetVariant = "edge" | "floating" | "menu";

export interface SheetProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  /** Defaults to `"edge"`; see `SheetVariant`. */
  variant?: SheetVariant;
  /**
   * A dim line under the panel's content saying how to answer or
   * dismiss it. The artifact writes a keyboard hint here; a caller
   * on this platform passes touch wording or nothing at all.
   */
  footerHint?: string;
  children?: ReactNode;
  testId?: string;
}

/**
 * `.pop`'s inset from each side and its own padding.
 *
 * (CORRECTED, W14-PMENU: T387's own doc comment said these were
 * "quoted from the reference's CSS: `.pop { left: 12px; right: 12px;
 * border-radius: 16px; padding: 13px 14px }`" — the STALE reference
 * checkout, not the confirmed spec. `android-spec.html` reads
 * `.pop{position:absolute;left:10px;right:10px;bottom:78px;z-index:5;
 * padding:12px 14px;border-radius:var(--r-lg);...}`: the inset is
 * `10`, not `12`; the vertical padding is `12`, not `13`; and the
 * radius is the shared `--r-lg` token — `EXPRESSIVE_RADIUS_LG`,
 * `../theme/expressive-shape.ts`, whose own doc comment names this
 * exact primitive's panel as "the overlay / popover corner" — not a
 * private `16`. `POP_BOTTOM` and the horizontal padding were already
 * right and are unchanged below.)
 */
const POP_INSET = 10;
const POP_PADDING_VERTICAL = 12;
const POP_PADDING_HORIZONTAL = 14;
/**
 * `.pop`'s clearance above the bottom edge. The artifact's 78px
 * clears its own prompt bar; on Android the `<PortalHost>` already
 * applies the keyboard inset (`Portal.tsx`), so this is clearance
 * over the composer only.
 */
const POP_BOTTOM = 78;

/**
 * `.pmenu`'s own two numbers, confirmed against `android-spec.html`'s
 * `.pmenu{position:absolute;left:10px;right:10px;bottom:98px;
 * z-index:8;padding:8px;border-radius:var(--r-lg);
 * box-shadow:var(--shadow-overlay);animation:fade-up 240ms
 * cubic-bezier(.23,1,.32,1) both}`. The side inset and the radius are
 * shared with `"floating"` (`POP_INSET`, `EXPRESSIVE_RADIUS_LG`)
 * rather than repeated here — `.pmenu` and `.pop` agree on both — so
 * only the clearance and the (uniform, not split) padding are new.
 */
const MENU_BOTTOM = 98;
const MENU_PADDING = 8;

/**
 * `.pmenu`'s own `animation:fade-up 240ms cubic-bezier(.23,1,.32,1)
 * both`, as a Reanimated `entering` animation — the idiom
 * `../../features/transcript/transcript-window.tsx` established at
 * W12-ENTRANCE, minus that file's per-row stagger delay (`.pmenu`
 * opens as one panel, not a list of rows entering one after another).
 * Every number comes from `EXPRESSIVE_FADE_UP_*`
 * (`../theme/expressive-motion.ts`); none is retyped here.
 *
 * `.pop` carries no `animation` property of its own (checked directly
 * against `android-spec.html`, not assumed), so this builder is only
 * ever handed to the `"menu"` variant's panel, and `Sheet` had no open
 * animation of any kind before this — every existing style here was
 * static.
 */
function menuPanelEntering(): EntryExitAnimationFunction {
  return () => {
    "worklet";
    const config = {
      duration: EXPRESSIVE_FADE_UP_DURATION_MS.menu,
      easing: Easing.bezier(...EXPRESSIVE_FADE_UP_EASING),
    };
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y }],
      },
      animations: {
        opacity: withTiming(1, config),
        transform: [{ translateY: withTiming(0, config) }],
      },
    };
  };
}

/**
 * Sheet primitive (plan.md §10.3): a modal panel anchored to the bottom
 * edge.
 *
 * It does **not** render inside React Native's `<Modal>`. `<Modal>`
 * opens a second native Android `Window`, which is exactly the thing
 * plan.md §9.3 says a sheet must not do — that second window competes
 * with the composer's `TextInput` for IME focus, which is the concrete
 * bug T33B4's `composer-focus-model.ts` doc comment names as a gap only
 * this file can close. Instead, `Sheet` renders its panel through
 * `usePortalOutlet` (`./Portal.tsx`) into the nearest `<PortalHost>` —
 * ordinary React Native views in the same window — and falls back to
 * rendering the same panel inline when no host is mounted yet, so it
 * keeps working either way. See `Portal.tsx`'s doc comment for exactly
 * what "Portal" means here given no portal library is installed, and
 * `Sheet.test.ts` for the proof this introduces no `<Modal>` and leaves
 * `resolveFocusOwner` unmoved.
 *
 * TalkBack focus moves into the panel on open and the Android back
 * gesture closes it (`useModalBehavior`), matching the web `Sheet`'s
 * focus-trap + Escape contract (plan.md §10.5).
 *
 * **T361 added the `floating` variant** — the redesign's `.pop`, for
 * a question the model is waiting on. **W14-PMENU added `menu`** — the
 * redesign's `.pmenu`, the prompt controls menu — and with it this
 * component's first open animation (`.pmenu`'s own `fade-up`, gated on
 * `reduceMotion` the same way every other animated primitive in this
 * tree is; `.pop` and `.edge` get none, matching the spec, which gives
 * `.pop` no `animation` property). Both new variants differ from the
 * original only in geometry (and, for `menu`, entrance); see
 * `SheetVariant` for what that difference is for, and why each is a
 * variant rather than a second component.
 */
export function Sheet({
  open,
  title,
  description,
  onClose,
  variant = "edge",
  footerHint,
  children,
  testId,
}: SheetProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const panelRef = useModalBehavior(open, onClose);
  const sheetId = useId();

  const panel = useMemo(() => {
    if (!open) return null;
    const panelStyle =
      variant === "floating" ? styles.panelFloating : variant === "menu" ? styles.panelMenu : null;
    const scrimStyle =
      variant === "floating" ? styles.scrimFloating : variant === "menu" ? styles.scrimMenu : null;
    const panelView = (
      <View
        ref={panelRef}
        accessible
        accessibilityViewIsModal
        accessibilityRole="none"
        accessibilityLabel={`${title}. ${description}`}
        style={[styles.panel, panelStyle]}
        onStartShouldSetResponder={() => true}
        testID={testId}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {children}
        {footerHint === undefined || footerHint.length === 0 ? null : (
          <Text style={styles.footerHint} testID={testId ? `${testId}-footer-hint` : undefined}>
            {footerHint}
          </Text>
        )}
      </View>
    );
    return (
      <Pressable
        style={[styles.scrim, scrimStyle]}
        onPress={onClose}
        accessibilityLabel={`Close ${title}`}
      >
        {variant === "menu" && !reduceMotion ? (
          <Animated.View entering={menuPanelEntering()}>{panelView}</Animated.View>
        ) : (
          panelView
        )}
      </Pressable>
    );
  }, [
    open,
    styles,
    onClose,
    title,
    description,
    panelRef,
    testId,
    children,
    variant,
    footerHint,
    reduceMotion,
  ]);

  const portaled = usePortalOutlet(`sheet-${sheetId}`, panel, open);

  if (!open) return null;
  // A host above this tree already renders `panel`; rendering it again
  // here too would show it twice.
  if (portaled) return null;
  return panel;
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.colors.overlayScrim, justifyContent: "flex-end" },
    scrimFloating: { paddingHorizontal: POP_INSET, paddingBottom: POP_BOTTOM },
    // `.pmenu`'s own clearance — the same side inset as `.pop`, lifted
    // further to clear the pill row above the prompt bar too. See
    // `MENU_BOTTOM`'s own doc comment.
    scrimMenu: { paddingHorizontal: POP_INSET, paddingBottom: MENU_BOTTOM },
    panel: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.window,
      borderTopRightRadius: theme.radii.window,
      padding: theme.spacing[5],
      gap: theme.spacing[3],
      ...ringShadow(theme, "overlay"),
    },
    // `.pop`: the same panel lifted off the edge and closed on all four
    // corners, at the confirmed spec's own radius and padding — see
    // `POP_INSET`'s doc comment above for the T387 → W14-PMENU
    // correction; `radii.window` (14) is the nearest shared token and is
    // what the edge variant still uses.
    //
    // The two corner longhands below are restated deliberately, not by
    // oversight. `panel` sets `borderTopLeftRadius`/`borderTopRightRadius`
    // to give the edge variant its square-bottomed shape, and React
    // Native resolves a per-corner longhand ahead of the `borderRadius`
    // shorthand regardless of which object in the style array declared
    // it. A lifted panel setting only `borderRadius` therefore draws its
    // bottom corners at that radius and keeps `panel`'s much smaller
    // top ones - visibly lopsided, and silently so, since nothing about
    // the shorthand is ill-typed. Naming all four corners is what makes
    // the radius uniform.
    panelFloating: {
      borderRadius: EXPRESSIVE_RADIUS_LG,
      borderTopLeftRadius: EXPRESSIVE_RADIUS_LG,
      borderTopRightRadius: EXPRESSIVE_RADIUS_LG,
      paddingVertical: POP_PADDING_VERTICAL,
      paddingHorizontal: POP_PADDING_HORIZONTAL,
    },
    // `.pmenu`: `"floating"`'s panel lifted further still, with a
    // uniform padding rather than a vertical/horizontal split. See
    // `MENU_PADDING`'s doc comment, and `panelFloating`'s note above on
    // why all four corners are named.
    panelMenu: {
      borderRadius: EXPRESSIVE_RADIUS_LG,
      borderTopLeftRadius: EXPRESSIVE_RADIUS_LG,
      borderTopRightRadius: EXPRESSIVE_RADIUS_LG,
      padding: MENU_PADDING,
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.title.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.title.fontWeight),
    },
    description: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
    },
    footerHint: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
