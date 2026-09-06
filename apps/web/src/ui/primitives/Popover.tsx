import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import "./primitives.css";

export interface PopoverProps {
  triggerLabel: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Popover primitive (plan.md §10.3): a non-modal disclosure. The trigger
 * carries `aria-haspopup="dialog"`/`aria-expanded`; content closes on
 * Escape or an outside click/focus, restoring focus to the trigger
 * (plan.md §10.5 keyboard operation + visible focus).
 */
export function Popover({ triggerLabel, children, testId }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="pc-popover" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="pc-popover__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div id={contentId} role="dialog" aria-label={triggerLabel} className="pc-popover__content">
          {children}
        </div>
      ) : null}
    </div>
  );
}
