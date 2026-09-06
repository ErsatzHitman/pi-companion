/**
 * `composer` kind render model (plan.md §11.3; T34A3) — "Replace or
 * prefill draft". Example: the `prompt-arbitrage` extension rewriting the
 * composer draft (plan.md §11.7).
 *
 * Same fields, same fallback, and the same mode vocabulary as the web
 * renderer (`apps/web/src/features/extensions/renderers/composer.tsx`).
 * This renders the proposal — mode, proposed text, and (when supplied)
 * what it would replace — plus the element's own accept/undo actions
 * through the shared action row. Actually applying the accepted text to
 * the live message-composer input is not this renderer's concern (out of
 * this task's `renderers/` scope, same as the web renderer's note): the
 * element's `accept`/`undo` actions still dispatch normally through
 * `dispatchAction`, and a later task can subscribe to their settlement.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type { PiUiComposerPayload, PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";

const MODE_LABEL: Record<NonNullable<PiUiComposerPayload["mode"]>, string> = {
  replace: "Replace draft",
  prefill: "Prefill draft",
  append: "Append to draft",
};

export interface PiUiComposerRenderModel {
  title: string;
  modeLabel: string;
  proposedText: string;
  /** Present only when the payload names what the draft would be undone back to. */
  previousText: string | undefined;
  actionsAccessibilityLabel: string;
}

export function buildComposerRenderModel(
  element: Pick<PiUiElement, "title">,
  payload: PiUiPayloadForKind<"composer">,
): PiUiComposerRenderModel {
  const title = element.title ?? "Composer suggestion";
  return {
    title,
    modeLabel: MODE_LABEL[payload.mode ?? "replace"],
    proposedText: payload.text,
    previousText: payload.previousText,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
