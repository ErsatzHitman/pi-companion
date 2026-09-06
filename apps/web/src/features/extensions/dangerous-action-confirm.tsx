/**
 * Dangerous-action confirmation dialog (plan.md §11.4 "confirmation for
 * dangerous actions", §12.3 "user action -> platform confirmation if
 * required -> frontend-core ExtensionActionController"; T29B5).
 *
 * A `PiUiAction` with a `confirm` message (plan.md §11.3's per-action
 * `confirm` string) must never reach `ExtensionActionController.dispatch`
 * without `confirmed: true` — `dispatch` throws
 * `ExtensionActionConfirmationRequiredError` synchronously otherwise (see
 * that method's doc comment in `@picompanion/frontend-core`). This
 * component is the "platform confirmation" step frontend-core's own
 * `getActionConfirmation`/`requiresConfirmation` hooks describe but cannot
 * render themselves (no DOM access in `frontend-core`, plan.md §7.3) —
 * `registry-view.tsx`'s `PiUiElementView` is the one place every kind's
 * `dispatchAction` funnels through (including a `roster` row's or a
 * `panel` section's, both of which forward to the same top-level bound
 * callback — see those renderers' own doc comments), so gating lives there
 * once rather than once per kind renderer.
 *
 * Composes the existing `Dialog` primitive in its `dangerous` mode
 * (`role="alertdialog"`, danger-styled confirm button, focus-trapped,
 * Escape/backdrop-dismissible — plan.md §10.3/§10.5), the same pattern
 * `DeleteSessionDialog` (T27B4) already established for a different
 * dangerous action, rather than a one-off dialog implementation.
 */
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Dialog } from "../../ui/primitives/index.js";
import "./dangerous-action-confirm.css";

export interface DangerousActionConfirmDialogProps {
  /** The pending confirm-bearing action, or `undefined` when nothing is pending (dialog stays closed). */
  action: PiUiAction | undefined;
  /**
   * The element (or row) this action belongs to, e.g. `element.title ??
   * element.id`, shown as extra disambiguating context — useful when a
   * `roster`'s several rows share an identically-labelled dangerous action
   * (plan.md §12.3 action identity is per-row, but the label alone reads
   * the same for every row).
   */
  elementLabel: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Names the action and states its consequence (T29B5 acceptance: "The
 * confirmation names the action and its consequence") — the dialog title
 * names the action (the action's own label), the description states its
 * consequence (the `confirm` message the owning Pi extension supplied
 * verbatim), and `elementLabel` (when given) appears as separate,
 * clearly-labelled context.
 *
 * The confirm button is deliberately labelled the generic "Confirm" rather
 * than reusing `action.label`: a `PiUiAction`'s label is arbitrary,
 * extension-controlled text and nothing stops it from being the word
 * "Cancel" itself (a roster's own cancel-this-row action is a realistic
 * example) — reusing it here would collide with this dialog's own,
 * unrelated "Cancel" (decline-the-confirmation) button and leave two
 * same-named buttons with different effects, which no accessible name can
 * disambiguate. The title/description already carry the action-specific
 * wording; the two buttons only need to stay a scannable, invariant
 * "Confirm" / "Cancel" pair, one approved treatment (plan.md §10.1) rather
 * than per-action bespoke wording.
 */
export function DangerousActionConfirmDialog({
  action,
  elementLabel,
  onConfirm,
  onCancel,
  testId = "dangerous-action-confirm-dialog",
}: DangerousActionConfirmDialogProps) {
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
      {elementLabel ? (
        <p className="pc-dangerous-action-confirm__target">For: {elementLabel}</p>
      ) : null}
    </Dialog>
  );
}
