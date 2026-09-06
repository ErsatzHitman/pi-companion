/**
 * Pure "should this element's render decision produce a logged diagnostic,
 * and what should it say" mapping (T40B1).
 *
 * plan.md §11.7's last line — "Unknown channels produce one diagnostic and
 * are not rendered as transcript text" — is a daemon-side concept
 * (`packages/server/.../pi/ui-bridge/decoder.ts`; T109 owns the daemon's
 * own de-duplicated warning there). No "channel" concept ever reaches an
 * Android client: every published channel is synthesized by the daemon
 * into an ordinary `pi_ui_delta` upsert before the client ever sees it
 * (verified directly against `subagents`/`workflow`/`pi-goal`'s fixtures in
 * `extension-fixture-renderers.test.ts` — none of the three carries
 * anything but a normal element). The client-side analogue of "an
 * unrecognized surface produces exactly one diagnostic, never one per
 * malformed field, and a normal surface produces none" is therefore a bad
 * `PiUiElementRenderDecision` (unknown kind / oversized / no renderer /
 * invalid payload) versus an `"ok"` one.
 *
 * `registry-view.tsx` used to compute this ternary inline, which put the
 * mapping out of reach of a unit test in this workspace (that component
 * also imports `react-native`; see `registry.test.ts`'s doc comment for why
 * nothing importing it can be exercised directly here). Pulling it out
 * here — exactly as `resolvePiUiElementRenderDecision` was already pulled
 * out of the same component for the same reason — lets
 * `registry-diagnostic-log.test.ts` drive it with a real counting-fake
 * `Logger` and prove "exactly one call for a bad decision, zero for `ok`"
 * directly, rather than only inferring it from the decision's own shape.
 * `registry-view.tsx` calls this function and warns with exactly its
 * result — never a second, parallel construction of the same message.
 */
import type { LogFields } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiElementRenderDecision } from "./registry-plan";

/** One `Logger.warn` call's arguments, or nothing at all for an `"ok"` decision. */
export interface PiUiRenderDiagnosticLog {
  message: string;
  fields: LogFields;
}

/**
 * Returns the single diagnostic log entry a non-`"ok"` decision should
 * produce, or `undefined` for `"ok"` — the true negative: a known kind,
 * in-budget, validated element never logs anything here.
 */
export function describePiUiRenderDiagnosticLog(
  decision: PiUiElementRenderDecision,
  element: Pick<PiUiElement, "kind">,
): PiUiRenderDiagnosticLog | undefined {
  if (decision.status === "ok") return undefined;
  return {
    message:
      decision.status === "unknown-kind"
        ? "Pi UI element has an unrecognized kind"
        : decision.status === "oversized"
          ? "Pi UI element payload exceeds the size cap"
          : decision.status === "no-renderer"
            ? "No renderer registered for this kind yet"
            : "Element payload failed canonical validation",
    fields:
      decision.status === "oversized"
        ? { bytes: decision.bytes, maxPayloadBytes: decision.maxBytes }
        : { kind: element.kind },
  };
}
