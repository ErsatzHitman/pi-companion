import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { IconButton } from "../../ui/primitives/index.js";

export interface SessionRowActionsButtonProps {
  /** The row's accessible name (e.g. `Actions for <title>`), set as both `aria-label` and `title`. */
  accessibleName: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Icon-only row-actions trigger for a session row (UI-W13). Replaces a
 * visible-text `Popover` trigger ("Actions for `<title>`") with a
 * `more` `IconButton` that keeps the exact same accessible name via
 * `aria-label`/`title` rather than rendering it as on-screen text.
 *
 * `ui/primitives/Popover` only accepts a text `triggerLabel` and
 * renders its own trigger `<button>`, which cannot host an icon-only
 * affordance with a mandatory accessible name the way `IconButton`
 * does — the same gap `features/files`' `FilePopoverButton`
 * (`file-popover-button.tsx`) already solved for its own row actions.
 * This is that same local pattern, applied here instead of changing
 * the shared primitive: the same `.pc-popover`/`.pc-popover__content`
 * visual language (`ui/primitives/primitives.css`) and outside-click/
 * Escape-to-close behaviour, with a `more`-glyph `IconButton` trigger
 * in place of visible text.
 */
export function SessionRowActionsButton({
  accessibleName,
  children,
  testId,
}: SessionRowActionsButtonProps) {
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
    <div className="pc-popover pc-session-row-actions" ref={rootRef}>
      <IconButton
        icon="more"
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
          className="pc-popover__content pc-session-row-actions__content"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
