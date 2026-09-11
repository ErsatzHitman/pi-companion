import { useId, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { usePortalOutlet } from "./Portal";
import { useModalBehavior } from "./use-modal-behavior";

/**
 * Where the panel sits (T361).
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
 * The scrim, the portal, the TalkBack focus move and the back
 * gesture are identical in both, which is why this is a variant
 * rather than a second component.
 */
export type SheetVariant = "edge" | "floating";

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
 * `.pop`'s inset from each side and its own padding — quoted from the
 * reference's CSS: `.pop { left: 12px; right: 12px; border-radius: 16px;
 * padding: 13px 14px }`.
 */
const POP_INSET = 12;
const POP_RADIUS = 16;
const POP_PADDING_VERTICAL = 13;
const POP_PADDING_HORIZONTAL = 14;
/**
 * `.pop`'s clearance above the bottom edge. The artifact's 78px
 * clears its own prompt bar; on Android the `<PortalHost>` already
 * applies the keyboard inset (`Portal.tsx`), so this is clearance
 * over the composer only.
 */
const POP_BOTTOM = 78;

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
 * a question the model is waiting on. It differs from the original
 * only in geometry; see `SheetVariant` for what that difference is
 * for, and why it is a variant rather than a second component.
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
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const panelRef = useModalBehavior(open, onClose);
  const sheetId = useId();

  const panel = useMemo(
    () =>
      open ? (
        <Pressable
          style={[styles.scrim, variant === "floating" ? styles.scrimFloating : null]}
          onPress={onClose}
          accessibilityLabel={`Close ${title}`}
        >
          <View
            ref={panelRef}
            accessible
            accessibilityViewIsModal
            accessibilityRole="none"
            accessibilityLabel={`${title}. ${description}`}
            style={[styles.panel, variant === "floating" ? styles.panelFloating : null]}
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
        </Pressable>
      ) : null,
    [open, styles, onClose, title, description, panelRef, testId, children, variant, footerHint],
  );

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
    panel: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.window,
      borderTopRightRadius: theme.radii.window,
      padding: theme.spacing[5],
      gap: theme.spacing[3],
      ...ringShadow(theme, "overlay"),
    },
    // `.pop`: the same panel lifted off the edge and closed on all
    // four corners. T387 took the reference's own figures — radius 16,
    // `13px 14px` padding — because a floating panel's corner is one of
    // the few places a two-pixel difference is visible against a
    // screenshot; `radii.window` (14) is the nearest token and is what
    // the edge variant still uses.
    panelFloating: {
      borderRadius: POP_RADIUS,
      paddingVertical: POP_PADDING_VERTICAL,
      paddingHorizontal: POP_PADDING_HORIZONTAL,
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
