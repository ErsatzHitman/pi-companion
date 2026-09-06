/**
 * Shared element-level action row for the simple Pi UI Bridge kinds
 * (`status`, `widget`, `progress`, `log`, `markdown`, `diff`, `panel`;
 * T29A2, T29B3, T29B4). An element's `actions` array (plan.md §11.3/§11.4)
 * is common to every kind's envelope, not specific to one payload shape, so
 * this one small component is reused by each of these renderers rather
 * than N copies of the same button row.
 *
 * Dangerous (`confirm`-bearing) actions are always clickable here (T29B5):
 * clicking one calls `dispatchAction` exactly like a non-dangerous action.
 * `dispatchAction` itself (bound in `registry-view.tsx`'s `PiUiElementView`,
 * the one place every kind's dispatch funnels through) is what actually
 * gates a `confirm`-bearing action behind a platform confirmation dialog
 * before ever sending anything — never dispatching one unconfirmed and
 * never throwing `ExtensionActionConfirmationRequiredError` out of a click
 * handler (plan.md §12.3's "platform confirmation if required" step).
 */
import type { extensions } from "@picompanion/frontend-core";
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Button, type ButtonKind } from "../../../ui/primitives/index.js";
import type { PiUiDispatchAction } from "../registry.js";
import "./renderers.css";

export interface ElementActionsRowProps {
  actions: readonly PiUiAction[] | undefined;
  dispatchAction: PiUiDispatchAction;
  getActionState: (actionId: string) => extensions.ExtensionActionState;
  /** Accessible name for the enclosing `role="group"` (e.g. `"Deploy workflow actions"`). */
  ariaLabel: string;
}

const BUTTON_KIND: Record<NonNullable<PiUiAction["variant"]>, ButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

/**
 * A short, human-readable name for who the daemon says answered this
 * settled action (T128, mirroring how `agent_permission_resolved`'s
 * `answeredBy` is rendered in the approvals surface).
 *
 * Prefers the daemon's `label` (e.g. "Android") when it supplied one.
 * Every real production emitter today — `session.ts`'s
 * `dispatchPiUiMessage` — sets only `{ clientId: this.clientId }` and
 * never a `label` (T134), so the interesting case is what happens without
 * one:
 *
 * - A `source: "response"` settlement is always self-attributed — the RPC
 *   ack is private to the connection that sent the request (`session.ts`'s
 *   `emit` writes only to `this.onMessage`, never a broadcast), so
 *   `answeredBy.clientId` here can only ever name *this* connection. There
 *   is nothing informative to attribute (of course you answered your own
 *   click), so this renders nothing at all — the same as when the daemon
 *   supplies no `answeredBy` — rather than exposing the raw connection id
 *   as if it named someone else.
 * - A `source: "result"` settlement (`pi_ui_action_result`, an
 *   `agent_stream` broadcast every connected client receives) may
 *   legitimately name a *different* connection. No production emitter
 *   populates `answeredBy` on this path yet (`arbitration.ts`'s module
 *   doc), but when one eventually does without a `label`, this renders an
 *   honest, non-identifying phrase — never the bare connection id.
 */
function attributionText(state: extensions.ExtensionActionState): string | undefined {
  if (!("answeredBy" in state) || !state.answeredBy) return undefined;
  if (state.answeredBy.label) return state.answeredBy.label;
  if (state.source === "response") return undefined;
  return "another client";
}

function feedbackText(state: extensions.ExtensionActionState): string | undefined {
  const who = attributionText(state);
  switch (state.status) {
    case "success":
      return who ? `Done — ${who}` : "Done";
    case "rejected":
      return `${state.error ?? "Failed"}${who ? ` — ${who}` : ""}`;
    case "timeout":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return undefined;
  }
}

/** Renders one element's top-level `actions`, wired to this element's bound dispatch pair. */
export function ElementActionsRow({
  actions,
  dispatchAction,
  getActionState,
  ariaLabel,
}: ElementActionsRowProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="pc-pi-element-actions" role="group" aria-label={ariaLabel}>
      {actions.map((action) => {
        const state = getActionState(action.id);
        const pending = state.status === "pending";
        const feedback = feedbackText(state);
        return (
          <span className="pc-pi-element-action" key={action.id}>
            <Button
              kind={BUTTON_KIND[action.variant ?? "secondary"]}
              disabled={pending}
              title={action.confirm}
              onClick={() => {
                void dispatchAction(action.id, { action });
              }}
            >
              {action.label}
            </Button>
            <span className="pc-pi-element-action__state" aria-live="polite">
              {pending ? "Working…" : (feedback ?? "")}
            </span>
          </span>
        );
      })}
    </div>
  );
}
