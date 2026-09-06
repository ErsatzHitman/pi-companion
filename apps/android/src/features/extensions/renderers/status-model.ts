/**
 * `status` kind render model (plan.md §11.3; T34A2) — "Glanceable state".
 *
 * Everything the Android `status` renderer decides from an element and its
 * canonical payload — which text is the status line, which tone the
 * indicator takes, whether a detail line exists, and the accessible names
 * TalkBack announces — lives here rather than inside `status.tsx`, because
 * `apps/android`'s vitest setup cannot import any module that transitively
 * reaches the `react-native` package (its Flow-annotated entry fails to
 * parse; see `../registry.test.ts`). Kept RN-free, these decisions are
 * directly unit tested (`renderers-model.test.ts`) against the shared
 * canonical fixtures, and `status.tsx` is left as a thin mapping onto §10.3
 * primitives.
 *
 * Semantics are the web renderer's, field for field
 * (`apps/web/src/features/extensions/renderers/status.tsx`): the
 * humanized namespace is the indicator's label, `payload.text` falls back
 * to the element title and then to `"Status"`, and the payload tone maps
 * through the shared tone table.
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import { humanizeNamespace, piUiToneToPrimitiveTone, type PiPrimitiveTone } from "./tone";

/**
 * A secondary line of text with the accessible name and live-region
 * behaviour TalkBack should use for it. Announced politely so a changed
 * detail reaches the user without stealing focus, matching the
 * `StatusIndicator` primitive's own `accessibilityLiveRegion="polite"`
 * (the web counterpart's `role="status"`).
 */
export interface PiUiAnnouncedText {
  text: string;
  accessibilityLabel: string;
  accessibilityLiveRegion: "polite";
}

export interface PiUiStatusRenderModel {
  /** `StatusIndicator`'s label — the humanized extension namespace. */
  label: string;
  /** `StatusIndicator`'s visible status text; never colour alone (plan.md §10.5). */
  statusText: string;
  tone: PiPrimitiveTone;
  detail: PiUiAnnouncedText | undefined;
  /** Accessible name for the element's action group. */
  actionsAccessibilityLabel: string;
}

export function buildStatusRenderModel(
  element: Pick<PiUiElement, "ns" | "title">,
  payload: PiUiPayloadForKind<"status">,
): PiUiStatusRenderModel {
  const label = humanizeNamespace(element.ns);
  const statusText = payload.text ?? element.title ?? "Status";
  return {
    label,
    statusText,
    tone: piUiToneToPrimitiveTone(payload.tone),
    detail: payload.detail
      ? {
          text: payload.detail,
          accessibilityLabel: `${label} detail: ${payload.detail}`,
          accessibilityLiveRegion: "polite",
        }
      : undefined,
    actionsAccessibilityLabel: `${label} actions`,
  };
}
