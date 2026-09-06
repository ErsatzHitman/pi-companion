import { useId, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { usePortalOutlet } from "./Portal";
import { useModalBehavior } from "./use-modal-behavior";

export interface SheetProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children?: ReactNode;
  testId?: string;
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
 */
export function Sheet({ open, title, description, onClose, children, testId }: SheetProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const panelRef = useModalBehavior(open, onClose);
  const sheetId = useId();

  const panel = useMemo(
    () =>
      open ? (
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={`Close ${title}`}>
          <View
            ref={panelRef}
            accessible
            accessibilityViewIsModal
            accessibilityRole="none"
            accessibilityLabel={`${title}. ${description}`}
            style={styles.panel}
            onStartShouldSetResponder={() => true}
            testID={testId}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>
            {children}
          </View>
        </Pressable>
      ) : null,
    [open, styles, onClose, title, description, panelRef, testId, children],
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
    panel: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.window,
      borderTopRightRadius: theme.radii.window,
      padding: theme.spacing[5],
      gap: theme.spacing[3],
      ...ringShadow(theme, "overlay"),
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
  });
}
