import { useMemo, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { Button } from "./Button";
import { useModalBehavior } from "./use-modal-behavior";

export interface DialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
  testId?: string;
}

/**
 * Dialog primitive (plan.md §10.3): a modal, centred confirmation dialog.
 * Same modal contract as `Sheet` (`useModalBehavior`): TalkBack focus on
 * open, Android back closes it. `dangerous` swaps the confirm button to
 * the danger `Button` kind, never colour alone (plan.md §10.5).
 */
export function Dialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  dangerous,
  onConfirm,
  onClose,
  children,
  testId,
}: DialogProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const panelRef = useModalBehavior(open, onClose);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
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
          <View style={styles.actions}>
            <Button kind="secondary" label={cancelLabel} onPress={onClose} />
            <Button
              kind={dangerous ? "danger" : "primary"}
              label={confirmLabel}
              onPress={onConfirm}
            />
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: theme.colors.overlayScrim,
      justifyContent: "center",
      padding: theme.spacing[5],
    },
    panel: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
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
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  });
}
