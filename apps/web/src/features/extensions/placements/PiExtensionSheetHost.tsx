import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { useEffect, useMemo, useRef, useState } from "react";

import { Sheet } from "../../../ui/primitives/index.js";
import { PiUiElementView } from "../registry-index.js";
// Side-effect import: registers every known kind's real component into the
// shared `piUiRendererRegistry` singleton `PiUiElementView` reads from — the
// same import `rail-element-card.tsx` makes for the same reason.
import "../renderers/index.js";
import { selectSheetElements } from "./select-placement-elements.js";
import "./placements.css";

const { piUiElementKeyOf } = extensions;

export interface PiExtensionSheetHostProps {
  /** One agent's live Pi UI elements, in any placement; the host filters. */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode badge. */
  revision?: number;
}

/**
 * The web `sheet`-placement destination (plan.md §11.5: "`sheet` opens a
 * focused panel").
 *
 * A sheet-placement element is a modal, so this host owns exactly one
 * piece of renderer-only state (plan.md §7.1's "open sheets"): which
 * element is currently open. The rule is "open on a new element":
 *
 * - the newest `sheet`-placement element that has not been seen before
 *   becomes the open one — including the first one restored on a cold
 *   open, so a pending sheet is never silently swallowed;
 * - dismissing it (Escape, the scrim, or any close affordance inside the
 *   element) closes the `Sheet` primitive and resolves nothing: no
 *   `pi.ui.action.request` is sent, exactly the "dismiss resolves nothing"
 *   contract a modal that the extension itself did not ask to be closed
 *   should have;
 * - the element stays in the store and stays "seen", so a subsequent
 *   revision bump for the *same* element never re-opens it; only a
 *   genuinely new element (a new `ns:id`) does.
 *
 * The open element renders through `PiUiElementView`, so the sheet is the
 * same per-element pipeline every other placement uses — the registered
 * kind's real component for a `panel`/`form`/`roster`, or the visible
 * unknown-kind/oversized/invalid-payload diagnostic. The `Sheet` primitive
 * itself (`ui/primitives/Sheet.tsx`) supplies the focus trap, Escape
 * handling, `aria-modal`, and scrim. It renders nothing when no element is
 * `sheet`-placed.
 */
export function PiExtensionSheetHost({
  elements,
  agentId,
  actionController,
  revision,
}: PiExtensionSheetHostProps) {
  const sheets = useMemo(() => selectSheetElements(elements), [elements]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const present = new Set<string>();
    let newestUnseen: string | null = null;
    for (const element of sheets) {
      const key = piUiElementKeyOf(element);
      present.add(key);
      if (!seenKeysRef.current.has(key)) {
        newestUnseen = key;
      }
    }
    // A removed element stops being "seen" so a later re-add of the same
    // `ns:id` counts as new again, the same way a fresh delta would.
    for (const key of seenKeysRef.current) {
      if (!present.has(key)) seenKeysRef.current.delete(key);
    }
    for (const key of present) {
      seenKeysRef.current.add(key);
    }
    if (newestUnseen !== null) {
      setOpenKey(newestUnseen);
    }
  }, [sheets]);

  const openElement = openKey
    ? sheets.find((element) => piUiElementKeyOf(element) === openKey)
    : undefined;

  if (!openElement) {
    return null;
  }

  const title = openElement.title ?? `${openElement.ns}:${openElement.id}`;

  return (
    <Sheet
      open
      title={title}
      description={`Focused extension panel from ${openElement.ns}.`}
      onClose={() => setOpenKey(null)}
      testId="pi-extension-sheet-host"
    >
      <div
        className="pi-extension-sheet-host__body"
        data-testid={`pi-sheet-${openElement.ns}-${openElement.id}`}
      >
        <PiUiElementView
          element={openElement}
          agentId={agentId}
          actionController={actionController}
          revision={revision}
          testId={`pi-sheet-view-${openElement.ns}-${openElement.id}`}
        />
      </div>
    </Sheet>
  );
}
