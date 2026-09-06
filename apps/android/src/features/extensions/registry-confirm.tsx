/**
 * Dangerous-action confirmation dialog (plan.md §11.4 "confirmation for
 * dangerous actions", §12.3 "user action -> platform confirmation if
 * required -> frontend-core ExtensionActionController"; T34A1).
 *
 * A `PiUiAction` with a `confirm` message (plan.md §11.3's per-action
 * `confirm` string) must never reach `ExtensionActionController.dispatch`
 * without `confirmed: true` — `dispatch` throws
 * `ExtensionActionConfirmationRequiredError` synchronously otherwise (see
 * that method's doc comment in `@picompanion/frontend-core`). This
 * component is the "platform confirmation" step frontend-core's own
 * `getActionConfirmation`/`requiresConfirmation` hooks describe but cannot
 * render themselves (no React Native access in `frontend-core`, plan.md
 * §7.3) — `registry-view.tsx`'s `PiUiElementView` is the one place every
 * kind's `dispatchAction` funnels through, so gating lives there once
 * rather than once per kind renderer.
 *
 * Composes the existing `Dialog` primitive in its `dangerous` mode
 * (modal, focus-trapped, Android-back-dismissible, danger-styled confirm
 * button — plan.md §10.3/§10.5), matching the web counterpart's
 * `dangerous-action-confirm.tsx`.
 */
import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";

import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Dialog } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";

export interface DangerousActionConfirmDialogProps {
  /** The pending confirm-bearing action, or `undefined` when nothing is pending (dialog stays closed). */
  action: PiUiAction | undefined;
  /**
   * The element (or row) this action belongs to, e.g. `element.title ??
   * element.id`, shown as extra disambiguating context — useful when a
   * `roster`'s several rows share an identically-labelled dangerous
   * action (plan.md §12.3 action identity is per-row, but the label alone
   * reads the same for every row).
   */
  elementLabel: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Names the action and states its consequence — the dialog title names the
 * action (the action's own label), the description states its consequence
 * (the `confirm` message the owning Pi extension supplied verbatim), and
 * `elementLabel` (when given) appears as separate, clearly-labelled
 * context via `Dialog`'s `children`.
 *
 * The confirm button is deliberately labelled the generic "Confirm" rather
 * than reusing `action.label`: a `PiUiAction`'s label is arbitrary,
 * extension-controlled text and nothing stops it from being the word
 * "Cancel" itself (a roster's own cancel-this-row action is a realistic
 * example) — reusing it here would collide with this dialog's own,
 * unrelated "Cancel" (decline-the-confirmation) button. The title/
 * description already carry the action-specific wording; the two buttons
 * only need to stay a scannable, invariant "Confirm" / "Cancel" pair, the
 * same treatment the web counterpart uses.
 */
export function DangerousActionConfirmDialog({
  action,
  elementLabel,
  onConfirm,
  onCancel,
  testId = "dangerous-action-confirm-dialog",
}: DangerousActionConfirmDialogProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Dialog
      open={action !== undefined}
      title={action ? `Confirm "${action.label}"` : ""}
      description={action?.confirm ?? ""}
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      dangerous
      onConfirm={onConfirm}
      onClose={onCancel}
      testId={testId}
    >
      {elementLabel ? <Text style={styles.target}>For: {elementLabel}</Text> : null}
    </Dialog>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    target: { color: theme.colors["ink-2"], fontSize: theme.typography.variant.caption.fontSize },
  });
}
