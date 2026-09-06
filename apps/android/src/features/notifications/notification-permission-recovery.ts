/**
 * Notification-permission port re-exports (T36A, plan.md §9.3;
 * restatement deleted by T60F, P5-W17).
 *
 * Reuses `../composer/permission-recovery.js`'s `PermissionState` /
 * `PermissionPort` / `resolvePermission` directly rather than declaring
 * another permission vocabulary: every state check, every string is
 * composer's own `PermissionState`, imported, not redeclared.
 *
 * **T60F deleted the restatement this file used to carry.** T36A
 * (P5-W14) could not extend composer's `PermissionKind` — that file was
 * unowned that wave — so this module restated composer's `(state) ->
 * copy` shape for a single hard-coded `"notifications"` kind instead of
 * calling into it. T60D (P5-W15) added `"notifications"` to
 * `PermissionKind`, with matching `KIND_LABEL` ("Notification") and
 * `KIND_PURPOSE` ("show updates about your agents") entries, which made
 * the restatement redundant; T60F (P5-W17), once this directory was its
 * own live grant, deleted `describeNotificationPermissionRecovery` and
 * `NotificationPermissionRecoveryCopy`. **Every call site now calls
 * `describePermissionRecovery("notifications", state)` from
 * `../composer/permission-recovery.ts` directly** — this module no
 * longer re-exports a copy lookup at all, on purpose (see T32P3's
 * instruction below): it only re-exports the port plumbing.
 *
 * Copy-wording decision (T60F, then T60G): composer's generic
 * `"{Kind} access {state}"` phrasing applies to notifications for
 * `"granted"`/`"denied"`/`"denied-permanently"`/`"unavailable"`,
 * replacing this module's bespoke titles for those states. T60F traded
 * the bespoke `"undetermined"` title away too ("Turn on notifications?",
 * which read better than composer's "Notification access needed" but
 * broke consistency with every other kind's dialog) and filed a seam
 * against `../composer/permission-recovery.ts`, unowned at the time, to
 * revisit it.
 *
 * **That seam is closed: T60G (P5-W18) took ownership of that file and
 * applied the override, so `"undetermined"` notifications copy is
 * "Turn on notifications?" again** — see `UNDETERMINED_TITLE_OVERRIDE`
 * there, a title-only, notifications-only `Partial<Record<PermissionKind,
 * string>>` consulted solely in the `"undetermined"` branch. The
 * reasoning recorded there: notifications are asked for proactively, so
 * a question fits where a status statement does not; every other kind
 * blocks an in-progress action and keeps the generic title. The
 * `message`, `actionLabel`, and `action` for notifications stay generic
 * in every state, so this is a one-string exception, not a re-forked
 * private copy table. (Noted by the P5-W18 merge gate: T60G could not
 * edit this file — outside its grant — and disclosed the staleness.)
 *
 * What remains here, and why: `PermissionPort`/`PermissionState` are
 * re-exported so this feature's call sites never need to import from
 * `../composer/`; `resolvePermission` is re-exported for the same
 * reason. `NotificationPermissionPort` is a re-typed alias so ports in
 * this feature don't need to name `PermissionPort` from composer
 * either. None of that is a second vocabulary — it is all composer's
 * own types, passed through.
 *
 * **T32P3**: import `describePermissionRecovery` and `PermissionKind`
 * from `../composer/permission-recovery.ts` directly — this module does
 * not re-export them.
 *
 * Separately — not this task's concern, but worth recording here since
 * nowhere else names it — `packages/frontend-core/src/platform/
 * notifications.ts` also defines a `NotificationPermissionState`
 * (`"granted" | "denied" | "prompt" | "unsupported"`), a third
 * permission-flavoured vocabulary, for the unrelated concern of
 * locally-shown notification permission
 * (`NotificationsPlatform.requestPermission`/`getPermissionState`).
 * This module does not use it, on purpose: composer's
 * `permission-recovery.ts` is the shape this feature reuses, not
 * frontend-core's. Whoever eventually wires `NotificationsPlatform` for
 * `apps/android` (no adapter exists yet — nothing under
 * `../../platform/` implements it) should decide then whether that
 * vocabulary folds into the same unification or stays separate because
 * it is asking the OS a materially different question ("may I show a
 * local notification" vs. "may I hold a remote push token").
 */
import type { PermissionPort } from "../composer/permission-recovery.js";

export type { PermissionPort, PermissionState } from "../composer/permission-recovery.js";
export { resolvePermission } from "../composer/permission-recovery.js";

/** Convenience re-typed alias so call sites in this feature never need to import `PermissionPort` from `../composer/`. */
export type NotificationPermissionPort = PermissionPort;
