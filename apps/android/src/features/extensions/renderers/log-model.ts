/**
 * `log` kind render model (plan.md §11.3; T34A3) — "Streaming lines".
 *
 * "Bounded" here means capping how many of the payload's `lines` are ever
 * mounted, to the payload's own `tail` hint or a default when the payload
 * carries none — not full list virtualization, which is the transcript's
 * own concern (a different, much larger list). The default is **200**,
 * the same value and the same mechanism as the web renderer's
 * `DEFAULT_LOG_TAIL`
 * (`apps/web/src/features/extensions/renderers/log.tsx`) since T226
 * resolved that pre-T226 mismatch (web capped at 500): the bridge
 * contract itself already caps a log at tail-200 in practice (the `loop`
 * extension's own log section), so 200 is the number plan.md §14.5 both
 * states and records as "already met on the wire", and a bounded native list view
 * is the scarcer resource on a phone screen than in a browser tab — so the
 * tighter number costs web nothing while protecting Android. See plan.md
 * §14.5 for the recorded decision.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";

/** Cap applied when the payload does not specify its own `tail` hint. */
export const DEFAULT_LOG_TAIL = 200;

export interface PiUiLogRenderModel {
  title: string;
  /** `true` unless the payload explicitly opts out with `mono: false`. */
  mono: boolean;
  /** Already sliced to the effective tail — every line here is mounted. */
  visibleLines: readonly string[];
  totalLines: number;
  /** How many earlier lines were dropped by the tail cap; `0` when none were. */
  hiddenCount: number;
  /** e.g. "Showing last 3 of 5 lines (2 earlier lines hidden)." Absent when nothing was hidden. */
  truncatedNotice: string | undefined;
  /** Shown instead of the line list when there is nothing to show. */
  emptyText: string | undefined;
  scrollAccessibilityLabel: string;
  actionsAccessibilityLabel: string;
}

export function buildLogRenderModel(
  element: Pick<PiUiElement, "title">,
  payload: PiUiPayloadForKind<"log">,
): PiUiLogRenderModel {
  const title = element.title ?? "Log";
  const tail = payload.tail && payload.tail > 0 ? payload.tail : DEFAULT_LOG_TAIL;
  const totalLines = payload.lines.length;
  const visibleLines = totalLines > tail ? payload.lines.slice(totalLines - tail) : payload.lines;
  const hiddenCount = totalLines - visibleLines.length;

  return {
    title,
    mono: payload.mono !== false,
    visibleLines,
    totalLines,
    hiddenCount,
    truncatedNotice:
      hiddenCount > 0
        ? `Showing last ${visibleLines.length} of ${totalLines} lines (${hiddenCount} earlier ${
            hiddenCount === 1 ? "line" : "lines"
          } hidden).`
        : undefined,
    emptyText: visibleLines.length === 0 ? "No output yet." : undefined,
    scrollAccessibilityLabel: `${title} output`,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
