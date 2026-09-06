import { useId } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button.js";
import "./primitives.css";
import { useModalBehavior } from "./use-modal-behavior.js";

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
 * `role="alertdialog"` when `dangerous` (destructive confirmations) and
 * `role="dialog"` otherwise; `aria-modal`, labelled/described by its own
 * title/description, focus-trapped and Escape-to-close via
 * `useModalBehavior` (plan.md §10.5).
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
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  return (
    <div className="pc-overlay-scrim pc-overlay-scrim--dialog" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="pc-dialog"
        role={dangerous ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid={testId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="pc-dialog__title" id={titleId}>
          {title}
        </h2>
        <p className="pc-dialog__description" id={descriptionId}>
          {description}
        </p>
        {children}
        <div className="pc-dialog__actions">
          <Button kind="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button kind={dangerous ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
