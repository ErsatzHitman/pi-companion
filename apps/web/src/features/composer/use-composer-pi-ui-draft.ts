/**
 * React binding for `pi-ui-composer-draft.ts`: subscribes the composer to
 * the Pi UI Bridge `composer` kind's settled accept/undo actions and writes
 * their outcome into the live draft through the same `setDraftText` the
 * textarea already uses.
 *
 * `draftText` is mirrored into a ref rather than captured, so a settlement
 * arriving between renders reads the CURRENT draft — the identical
 * "read the draft fresh when a request actually arrives" rule
 * `Composer.tsx`'s T293 `wireEditorTextResponder` wiring follows for
 * `getEditorText`. The ref is advanced synchronously inside the handler as
 * well, so two settlements delivered in one tick compose (an accept then an
 * undo cannot read a draft that is one write stale).
 *
 * Omitting `source` is the honest "no Pi UI rail wired" state: the hook
 * installs nothing and the composer behaves exactly as it did before.
 */
import { useEffect, useRef } from "react";

import {
  resolvePiUiComposerSettlement,
  type PiUiComposerDraftSource,
} from "./pi-ui-composer-draft.js";

export interface UseComposerPiUiDraftOptions {
  /** The settled Pi UI actions this composer reacts to; omit for an inert composer. */
  source?: PiUiComposerDraftSource;
  /** The live draft, read fresh whenever a settlement arrives. */
  draftText: string;
  /** The composer input's own draft setter — the one place a draft write happens. */
  setDraftText: (text: string) => void;
}

/**
 * Installs the composer-kind proposal subscription for the lifetime of a
 * mounted composer. No return value: the draft it writes is already the
 * composer's own `draftText`, so there is no second piece of state to
 * render.
 */
export function useComposerPiUiDraft({
  source,
  draftText,
  setDraftText,
}: UseComposerPiUiDraftOptions): void {
  const draftRef = useRef(draftText);
  draftRef.current = draftText;
  const previousByElementRef = useRef<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!source) return;
    return source.subscribe((target, state) => {
      const settlement = resolvePiUiComposerSettlement(
        draftRef.current,
        previousByElementRef.current,
        target,
        state,
        source.resolveProposal(target),
      );
      if (!settlement) return;
      draftRef.current = settlement.draft;
      previousByElementRef.current = settlement.previousByElement;
      setDraftText(settlement.draft);
    });
  }, [source, setDraftText]);
}
