import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { IconButton } from "../../ui/primitives/index.js";
import type { IconName } from "../../ui/primitives/icons.js";
import "./files.css";

export interface FilePopoverButtonProps {
  icon: IconName;
  /** Required: passed straight through to `IconButton`'s mandatory accessible name. */
  accessibleName: string;
  /** Rendered only while open; receives a `close` callback a submit handler may call to dismiss the popover. */
  children: (close: () => void) => ReactNode;
  testId?: string;
}

/**
 * A small anchored popover triggered by an icon button (UI-W7, plan.md
 * §10.3/§12.4). `ui/primitives/Popover` only accepts a text
 * `triggerLabel` and renders its own trigger `<button>`, which cannot
 * host an icon-only affordance with a mandatory accessible name the way
 * `IconButton` does — this local variant reuses the same
 * `.pc-popover`/`.pc-popover__content` visual language (`primitives.css`)
 * and the same outside-click/Escape-to-close behaviour as that shared
 * primitive, with an `IconButton` trigger instead. Used by the files
 * toolbar (upload/new folder/new file) and per-row actions (rename) —
 * every place this feature needs an icon-triggered popover rather than a
 * full modal `Dialog`.
 */
export function FilePopoverButton({
  icon,
  accessibleName,
  children,
  testId,
}: FilePopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

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
        rootRef.current?.querySelector("button")?.focus();
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
    <div className="pc-popover pc-file-popover" ref={rootRef}>
      <IconButton
        icon={icon}
        accessibleName={accessibleName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div
          id={contentId}
          role="dialog"
          aria-label={accessibleName}
          className="pc-popover__content pc-file-popover__content"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
