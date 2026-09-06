import { useId } from "react";
import type { ReactNode } from "react";

import "./primitives.css";
import { useModalBehavior } from "./use-modal-behavior.js";

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
 * edge (mobile-style action sheet on web too, matching the Android sheet
 * primitive's semantics per plan.md §10.3's "Primitive semantics match
 * the web set"). Same modal contract as `Dialog`: focus trap, Escape,
 * `aria-modal`.
 */
export function Sheet({ open, title, description, onClose, children, testId }: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  return (
    <div className="pc-overlay-scrim pc-overlay-scrim--sheet" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="pc-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid={testId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="pc-sheet__title" id={titleId}>
          {title}
        </h2>
        <p className="pc-sheet__description" id={descriptionId}>
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}
