/**
 * Permission notifications with safe Approve/Deny actions (T36B,
 * plan.md §9.3 "Permission notifications provide Approve and Deny
 * actions when safe").
 *
 * RN-free by this repo's standing convention: no `.tsx` render is
 * exercised here (vitest cannot import anything that reaches
 * `react-native` — see this wave's VITEST LIMITATION note), so every
 * decision — which pending request gets an actionable notification,
 * what its two-tier content looks like, and how an incoming action
 * resolves — is a plain function/class over
 * `@picompanion/frontend-core`'s `permissions.PermissionsController`
 * and this feature's own `push-registration-port.ts` port. There is no
 * screen here; `app-shell/core.ts` wires this to a real
 * `PermissionsController` and `PushRegistrationPort` — see this task's
 * report, "Seam filed against T32S11", for the exact code.
 *
 * ## This resolves into the *same* queue, not a parallel one
 *
 * `../approvals/` already owns the one live decision path: a pending
 * request lives in a `permissions.PermissionsController` instance, is
 * answered via `PermissionsController.answer(requestId, response)`, and
 * — when a live daemon is attached — sent with
 * `../approvals/daemon-permissions-client.ts`'s `sendPermissionAnswer`.
 * This module does not reimplement any of that. `createPermissionNotificationController`
 * below takes the *same* `PermissionsController` instance a route also
 * hands to `useApprovalsQueue`, and an incoming notification action
 * resolves through the very same `answer`/`sendPermissionAnswer` calls
 * `use-approvals-queue.ts`'s `respond` uses — so "approved from a
 * notification" and "approved from the in-app sheet" are two front
 * doors onto one lock, never two locks.
 *
 * ## "Safe" scope: which requests get action buttons
 *
 * plan.md §9.3 qualifies this feature with "when safe". This module's
 * deliberate reading of "safe": a notification action is unambiguous —
 * exactly two choices, each independently reversible/answerable — only
 * for `../approvals/approvals-queue-model.ts`'s `"binary"` panel kind
 * *and* only when the request is not flagged `dangerous` (`variant:
 * "danger"` on one of its actions). A `"binary"` `dangerous` request
 * (e.g. an irreversible delete) and an `"actions-row"`/`"unsupported"`
 * request (more than two choices, or a presentation Android has no
 * approve/deny recipe for at all — see `approvals-queue-model.ts`'s own
 * doc comment) still get a notification, so the user is never left
 * unaware something is blocked, but with **no action buttons** — only a
 * tap-through into the app, where the full detail and, for dangerous
 * requests, the in-app confirmation UI are available. This is a
 * deliberate, written-down safety call, not an oversight: one-tap
 * approval of something the model itself flagged as dangerous, from a
 * possibly-locked device, is not "safe" by this module's definition
 * even though it is unambiguous.
 *
 * ## Lock-screen visibility
 *
 * A permission request's content is sensitive (this task's brief) — it
 * can name a file path, a shell command, or a tool's raw input. This
 * module always requests `visibility: "private"`
 * (`PermissionNotificationContent`) and always fills `publicTitle` with
 * a fixed, generic string that names neither the tool nor the request
 * ("Pi needs your permission") — never `toolLabel`/`detail`. The real
 * content (`privateTitle`/`privateBody`) is only shown once the device
 * is unlocked (Android's own lock-screen redaction for
 * `VISIBILITY_PRIVATE`, applied by the real port once one exists — see
 * `push-registration-port.ts`'s doc comment). "Public" (always visible)
 * and "secret" (invisible even as an icon) were both rejected: public
 * would put the sensitive detail on the lock screen by default; secret
 * would hide even the *existence* of a blocked request, which would
 * make "a permission request can be approved from a notification"
 * undiscoverable when the phone is locked.
 *
 * Nothing in this module ever calls `console.*` or writes through any
 * storage interface — it accepts no logging or storage dependency at
 * all, so there is no code path through which a request's content
 * could reach a log or plain storage. `permission-notification-model.test.ts`'s
 * "never logs" case spies on every `console` method across a full
 * post → action → resolve cycle and asserts zero calls, as a guard
 * against a future edit accidentally introducing one.
 */
import type { permissions } from "@picompanion/frontend-core";

import { resolveApprovalPanel, type ApprovalPanel } from "../approvals/approvals-queue-model.js";
import {
  sendPermissionAnswer,
  type DaemonPermissionsSource,
} from "../approvals/daemon-permissions-client.js";

import type {
  PermissionNotificationActionEvent,
  PermissionNotificationContent,
  PushRegistrationPort,
} from "./push-registration-port.js";

const PUBLIC_TITLE = "Pi needs your permission";

/**
 * Builds the notification content for one pending request. Every
 * pending request gets at least a tap-only notification — see this
 * module's doc comment for the "safe" scope that decides whether it
 * also gets action buttons.
 *
 * Reuses `../approvals/approvals-queue-model.ts`'s own `resolveApprovalPanel`
 * and its `approveResponse`/`denyResponse` builders — the exact
 * responses `use-approvals-queue.ts`'s in-app `respond` would send for
 * the same panel — so a notification's Approve/Deny sends byte-for-byte
 * the same `AgentPermissionResponse` the in-app sheet would.
 */
export function buildPermissionNotificationContent(
  view: permissions.PermissionDialogViewModel,
): PermissionNotificationContent {
  return contentForPanel(view, resolveApprovalPanel(view));
}

function contentForPanel(
  view: permissions.PermissionDialogViewModel,
  panel: ApprovalPanel,
): PermissionNotificationContent {
  const toolLabel = panel.toolLabel;

  if (panel.kind === "binary" && !panel.dangerous) {
    return {
      requestId: view.requestId,
      agentId: view.agentId,
      visibility: "private",
      publicTitle: PUBLIC_TITLE,
      privateTitle: `${toolLabel} needs permission`,
      privateBody: panel.detail,
      actions: [
        { id: "approve", label: "Approve" },
        { id: "deny", label: "Deny" },
      ],
    };
  }

  const privateBody =
    panel.kind === "unsupported"
      ? "Open the app to respond."
      : `${panel.detail} Open the app to respond.`;

  return {
    requestId: view.requestId,
    agentId: view.agentId,
    visibility: "private",
    publicTitle: PUBLIC_TITLE,
    privateTitle: `${toolLabel} needs permission`,
    privateBody,
    actions: [],
  };
}

/** Extracts the exact `AgentPermissionResponse` a given action id would send, from an already-resolved panel. `undefined` when this panel does not offer that action (e.g. a tap-only panel) — the caller must treat that as "not offered", never fall back to a default response. */
function responseForAction(
  panel: ApprovalPanel,
  actionId: "approve" | "deny",
): permissions.AgentPermissionResponse | undefined {
  // Must mirror `contentForPanel`'s exact "safe" condition — a
  // dangerous binary panel gets a tap-only notification (no actions),
  // so it must never yield a response here either, even though
  // `panel.approveResponse`/`panel.denyResponse` exist on it. Diverging
  // from that condition is exactly the bug this function's own
  // `action-not-offered` guard exists to catch.
  if (panel.kind !== "binary" || panel.dangerous) return undefined;
  return actionId === "approve" ? panel.approveResponse : panel.denyResponse;
}

interface LiveNotificationRecord {
  readonly agentId: string;
  readonly approveResponse: permissions.AgentPermissionResponse | undefined;
  readonly denyResponse: permissions.AgentPermissionResponse | undefined;
}

/**
 * Every outcome this module can produce for one notification action or
 * one queue-sync step, each named so a caller (and this module's own
 * tests) can assert *which* path ran rather than only a final state —
 * this wave's standing "assert a named outcome, not just that a test
 * finishes" rule.
 */
export type PermissionNotificationOutcome =
  | { readonly kind: "posted"; readonly requestId: string }
  | { readonly kind: "cancelled"; readonly requestId: string }
  | { readonly kind: "approved"; readonly requestId: string; readonly agentId: string }
  | { readonly kind: "denied"; readonly requestId: string; readonly agentId: string }
  /** The request this action names is not (or no longer) pending in `controller` — a resolution (local or daemon-confirmed) won the race. A no-op: nothing is sent. */
  | { readonly kind: "already-resolved"; readonly requestId: string }
  /** No live notification is tracked for this `requestId` at all — never posted, or already cancelled. A no-op. */
  | { readonly kind: "unknown-request"; readonly requestId: string }
  /** The event's `agentId` does not match the `agentId` this notification was posted for. A no-op — never acted on using the event's own claim. */
  | { readonly kind: "agent-mismatch"; readonly requestId: string }
  /** `approve`/`deny` arrived for a notification that was posted tap-only (no such action was ever offered for it). A no-op. */
  | { readonly kind: "action-not-offered"; readonly requestId: string }
  /** A body tap on a still-pending request: route into that request's approval surface. */
  | { readonly kind: "route-to-approval"; readonly requestId: string; readonly agentId: string }
  /** A body tap on a request that is no longer pending: route to the agent's session instead of a stale/now-invalid approval screen. */
  | { readonly kind: "route-to-session"; readonly agentId: string };

export interface PermissionNotificationControllerDeps {
  /** The single live `PermissionsController` instance also handed to `useApprovalsQueue` — see this module's doc comment for why this must not be a second/parallel instance. */
  controller: permissions.PermissionsController;
  port: Pick<
    PushRegistrationPort,
    "postPermissionNotification" | "cancelPermissionNotification" | "onNotificationAction"
  >;
  /** Live daemon adapter. Omit to answer locally only — mirrors `UseApprovalsQueueOptions.client`'s own "undefined until a route wires a real `DaemonClient`" contract. */
  daemon?: DaemonPermissionsSource;
  /** Called once per outcome — tests assert on this; a real mount can use it for diagnostics (never for logging request content — see this module's doc comment). */
  onOutcome?: (outcome: PermissionNotificationOutcome) => void;
}

export interface PermissionNotificationController {
  /**
   * Scans `controller`'s full request list, posts a notification for
   * every newly-pending request this controller has not already posted
   * one for, and cancels every previously-posted notification whose
   * request is no longer pending. Safe to call repeatedly (idempotent);
   * a real mount calls it once up front and again on every
   * `controller.subscribe` notification.
   */
  refresh(): Promise<PermissionNotificationOutcome[]>;
  /**
   * Handles one `PermissionNotificationActionEvent` from the port. This
   * is the security-critical entry point — see this module's doc
   * comment and this task's brief: every check below is required, in
   * order, before anything is sent.
   */
  handleAction(event: PermissionNotificationActionEvent): Promise<PermissionNotificationOutcome>;
  /** `requestId`s this controller currently believes have a live, posted notification. Exposed for tests; not required for wiring. */
  getLiveRequestIds(): string[];
  /** Subscribes `refresh`/`handleAction` to `controller`'s queue changes and `port`'s action stream. Returns one combined unsubscribe/dispose function. Does not itself call `refresh()` once — a caller does that explicitly so the first `refresh()`'s outcomes are observable. */
  start(): () => void;
}

export function createPermissionNotificationController(
  deps: PermissionNotificationControllerDeps,
): PermissionNotificationController {
  const { controller, port, daemon, onOutcome } = deps;
  const live = new Map<string, LiveNotificationRecord>();

  function emit(outcome: PermissionNotificationOutcome): PermissionNotificationOutcome {
    onOutcome?.(outcome);
    return outcome;
  }

  async function refresh(): Promise<PermissionNotificationOutcome[]> {
    const outcomes: PermissionNotificationOutcome[] = [];
    const entries = controller.list();
    const pendingIds = new Set<string>();

    for (const entry of entries) {
      if (entry.status !== "pending") continue;
      pendingIds.add(entry.view.requestId);
      if (live.has(entry.view.requestId)) continue;

      const panel = resolveApprovalPanel(entry.view);
      const content = contentForPanel(entry.view, panel);
      await port.postPermissionNotification(content);
      live.set(entry.view.requestId, {
        agentId: entry.view.agentId,
        approveResponse: responseForAction(panel, "approve"),
        denyResponse: responseForAction(panel, "deny"),
      });
      outcomes.push(emit({ kind: "posted", requestId: entry.view.requestId }));
    }

    for (const requestId of Array.from(live.keys())) {
      if (pendingIds.has(requestId)) continue;
      await port.cancelPermissionNotification(requestId);
      live.delete(requestId);
      outcomes.push(emit({ kind: "cancelled", requestId }));
    }

    return outcomes;
  }

  async function handleAction(
    event: PermissionNotificationActionEvent,
  ): Promise<PermissionNotificationOutcome> {
    // Check 1: this notification must be one we actually posted and
    // have not already cancelled. This is the guard against an action
    // for a request that no longer exists (never posted, or already
    // resolved and cancelled by a prior `refresh()`).
    const record = live.get(event.requestId);
    if (!record) {
      return emit({ kind: "unknown-request", requestId: event.requestId });
    }

    // Check 2: the event's claimed `agentId` must match what this
    // notification was actually posted for. Never trust the event's
    // own claim over the locally-recorded truth.
    if (record.agentId !== event.agentId) {
      return emit({ kind: "agent-mismatch", requestId: event.requestId });
    }

    if (event.actionId === "tap") {
      const entry = controller.get(event.requestId);
      if (entry && entry.status === "pending") {
        return emit({
          kind: "route-to-approval",
          requestId: event.requestId,
          agentId: record.agentId,
        });
      }
      // Stale tap: the request resolved before the user opened the
      // notification. Route to the agent's session, never to an
      // approval screen for a request that can no longer be answered.
      return emit({ kind: "route-to-session", agentId: record.agentId });
    }

    // Check 3: this exact action must have actually been offered for
    // this notification. A tap-only notification (unsafe/unsupported
    // panel) never had an `approve`/`deny` response computed for it —
    // `responseForAction` left it `undefined` — so an approve/deny
    // event arriving for one anyway (a malformed or replayed OS event)
    // is rejected rather than falling back to any default response.
    const response = event.actionId === "approve" ? record.approveResponse : record.denyResponse;
    if (response === undefined) {
      return emit({ kind: "action-not-offered", requestId: event.requestId });
    }

    // Check 4: the live queue, not this notification's own record,
    // decides whether the request is still answerable. This is what
    // makes a stale notification unable to approve an already-resolved
    // request — `PermissionsController.answer`/`sendPermissionAnswer`
    // themselves would already refuse a non-pending request (`answer`
    // returns `null`), but checking here first, before dispatching,
    // means the outcome this module reports is the honest one
    // ("already-resolved") rather than a silently-dropped send.
    const entry = controller.get(event.requestId);
    if (!entry || entry.status !== "pending") {
      // The notification is now known-stale; make sure it cannot be
      // acted on again even if the OS re-delivers the same event.
      live.delete(event.requestId);
      await port.cancelPermissionNotification(event.requestId);
      return emit({ kind: "already-resolved", requestId: event.requestId });
    }

    if (daemon) {
      await sendPermissionAnswer(controller, daemon, event.requestId, response);
    } else {
      controller.answer(event.requestId, response);
    }
    live.delete(event.requestId);
    await port.cancelPermissionNotification(event.requestId);
    return emit({
      kind: event.actionId === "approve" ? "approved" : "denied",
      requestId: event.requestId,
      agentId: record.agentId,
    });
  }

  function start(): () => void {
    const offQueue = controller.subscribe(() => {
      void refresh();
    });
    const offAction = port.onNotificationAction((event) => {
      void handleAction(event);
    });
    return () => {
      offQueue();
      offAction();
    };
  }

  return {
    refresh,
    handleAction,
    getLiveRequestIds(): string[] {
      return Array.from(live.keys());
    },
    start,
  };
}
