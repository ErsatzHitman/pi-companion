/**
 * Reusable OS-permission recovery affordance (T33B7, plan.md §9.2;
 * unified as the SOLE such module by T60D, P5-W15).
 *
 * `features/composer/` is the sole owner of Android attachment picking
 * this wave (T33B7's brief). Voice *entry* is T36D's job, but T36D
 * reuses this exact module for the microphone permission instead of
 * building a second copy.
 *
 * This is now the ONLY permission-recovery vocabulary under
 * `apps/android/src` — T60D folded `features/connect/`'s independent
 * `OnboardingPermissionStatus`/`describeCameraPermissionRecovery` (built
 * in the same P5-W13 wave as this file, before either task could see
 * the other) onto this module by adding `"camera"` to `PermissionKind`
 * below; `features/connect/onboarding-permissions.ts` now calls
 * `describePermissionRecovery("camera", state)` directly instead of
 * declaring its own copy table. `features/notifications/notification-
 * permission-recovery.ts` (T36A/T36B) likewise imports this module's
 * `PermissionState`/`PermissionPort` rather than redeclaring them, and
 * `"notifications"` is in `PermissionKind` below for it; T60F (P5-W17)
 * deleted that module's remaining single-kind copy table
 * (`describeNotificationPermissionRecovery`/
 * `NotificationPermissionRecoveryCopy`) — the one follow-up T60D had
 * left open — so every notifications call site now calls
 * `describePermissionRecovery("notifications", state)` from here.
 * `../connect/qr-scanner-port.ts`'s four-state `CameraPermissionStatus`
 * was the last structural duplicate; T60E (P5-W17) deleted it too, and
 * that port now reads/returns this module's `PermissionState` directly.
 * `scripts/ci/guard-no-duplicate-permission-state.mjs` fails CI if a
 * private permission-state union reappears under `apps/android/src` —
 * since T60E it catches both a union naming `"denied-permanently"` and
 * one whose members are merely all drawn from the five literals below.
 *
 * Kept completely free of React Native, like every other `-model.ts`/
 * `*-port.ts` in this feature (`composer-model.ts`,
 * `../connect/qr-scanner-port.ts`), so it is unit-testable without a
 * device/emulator.
 *
 * `PermissionState` is built from the four ideas any native permission
 * API — including Expo's — already uses (`"granted"`/`"denied"`/
 * `"undetermined"`/`"unavailable"`) plus one addition this feature
 * actually needs: `"denied-permanently"`, Android's own
 * "don't ask again" state. That state is why this module exists as
 * something more than a boolean: a plain `"denied"` is recoverable by
 * asking again (`action: "request"`), but re-prompting a
 * `"denied-permanently"` user is a dead end on Android — the OS itself
 * suppresses the dialog — so that state's only real exit is
 * `"open-settings"`. `describePermissionRecovery` below never returns
 * `action: "request"` for `"denied-permanently"`, and
 * `permission-recovery.test.ts` asserts that directly, over every
 * `PermissionKind`.
 *
 * **Owned by T60G (P5-W18).** No task owned this file between T60D
 * (P5-W15) and T60G — three separate siblings (T60E, T60F, T32P3) had
 * to falsify pieces of this header in the same wave (P5-W17) because
 * none of them could edit it to keep it true, and the P5-W17 merge gate
 * repaired all three by hand. T60G is this file's first real owner and
 * applied T60F's filed, previously-unapplied `"undetermined"`-title
 * decision for `"notifications"` — see `UNDETERMINED_TITLE_OVERRIDE`
 * near `describePermissionRecovery` below, and the "WHAT T60D UNIFIED"
 * section at the bottom of this file for the reasoning.
 */

/**
 * `"undetermined"`: never yet asked. `"granted"`/`"denied"` mirror
 * every native permission API's own vocabulary. `"denied-permanently"`:
 * Android's "don't ask again" — the OS will not show its own prompt
 * again; the only way back is the system Settings app.
 * `"unavailable"`: this workspace's own addition (see
 * `../connect/qr-scanner-port.ts`) — no native module exists to ask at
 * all, which is not the same fact as a user declining one that was
 * offered.
 */
export type PermissionState =
  | "undetermined"
  | "granted"
  | "denied"
  | "denied-permanently"
  | "unavailable";

/**
 * What this permission is being asked for. Extend as later features
 * need more kinds — do not fork a parallel copy-table instead (that is
 * exactly what T60D unified away; see this file's header note and
 * `scripts/ci/guard-no-duplicate-permission-state.mjs`).
 *
 * `"camera"` (T60D, folded in from `features/connect/`'s onboarding QR
 * pairing step) and `"notifications"` (T60D, folded in for
 * `features/notifications/` per that module's own note — its call site
 * still uses a local single-kind copy table this wave since that
 * directory is unowned; see this module's header) were added without
 * changing `PermissionState` or `describePermissionRecovery`'s shape at
 * all — kind-parameterisation was already there.
 */
export type PermissionKind = "photos" | "microphone" | "camera" | "notifications";

/**
 * Minimal permission surface shared by every OS-permission port in this
 * feature (`attachment-source-port.ts`'s `AttachmentSourcePort`,
 * `../voice/voice-capture-port.ts`'s `VoiceCapturePort`). Mirrors
 * `../connect/qr-scanner-port.ts`'s `CameraScannerPort` shape.
 */
export interface PermissionPort {
  /** Reads the current permission without prompting the user or the OS. */
  getPermissionStatus(): Promise<PermissionState>;
  /** Prompts for permission. Only ever call this from a user-initiated moment — never speculatively or at app launch. */
  requestPermission(): Promise<PermissionState>;
}

/** What a `PermissionRecoveryCopy`'s action button actually does. */
export type PermissionRecoveryActionKind = "request" | "open-settings" | "dismiss";

/**
 * Visible copy plus the one action available for a given
 * `(kind, state)` pair. Every state — `"granted"` included — has a
 * non-empty `actionLabel`: `permission-recovery.test.ts`'s "every state
 * has a named, non-empty exit" case asserts this for the full
 * `PermissionKind` x `PermissionState` matrix, so no state (including
 * the ones nobody has hit yet in manual testing) can silently render as
 * a dead end.
 */
export interface PermissionRecoveryCopy {
  title: string;
  message: string;
  actionLabel: string;
  action: PermissionRecoveryActionKind;
}

const KIND_LABEL: Record<PermissionKind, string> = {
  photos: "Photo and file",
  microphone: "Microphone",
  camera: "Camera",
  notifications: "Notification",
};

const KIND_PURPOSE: Record<PermissionKind, string> = {
  photos: "attach files to a message",
  microphone: "record a voice message",
  camera: "scan a pairing QR code",
  notifications: "show updates about your agents",
};

/**
 * T60F's filed, now-applied copy decision (T60G, P5-W18): for the
 * `"undetermined"` state only, `"notifications"` gets a bespoke title
 * instead of the generic `"{Kind} access needed"` pattern every other
 * kind uses. Reasoning (T60F, kept here since this is the one place the
 * decision takes effect): notifications are asked for proactively —
 * there is no in-progress user action it is blocking, unlike attaching
 * a photo, recording voice, or scanning a QR code — so a question
 * inviting an opt-in ("Turn on notifications?") reads better than a
 * status statement describing a gate ("Notification access needed").
 * Deliberately narrow: only the title changes here, and only for one
 * kind's one state. `message`/`actionLabel`/`action` for
 * `"undetermined"` stay exactly as generic as every other kind's, and
 * `"photos"`/`"microphone"`/`"camera"` are absent from this table on
 * purpose — none of their `"undetermined"` moments are a proactive ask,
 * so T60F's original consistency argument still wins for them. A kind
 * with no entry here falls back to the generic title; add an entry only
 * when the same "this specific kind's default wording reads worse than
 * the generic pattern" case applies, not as a general escape hatch.
 */
const UNDETERMINED_TITLE_OVERRIDE: Partial<Record<PermissionKind, string>> = {
  notifications: "Turn on notifications?",
};

/**
 * Pure copy lookup — no I/O, no port. `PermissionRecoveryNotice.tsx` is
 * the thin view that renders this; `resolvePermission` below is what
 * actually drives a `PermissionPort` to get a fresh `PermissionState`.
 */
export function describePermissionRecovery(
  kind: PermissionKind,
  state: PermissionState,
): PermissionRecoveryCopy {
  const label = KIND_LABEL[kind];
  const purpose = KIND_PURPOSE[kind];
  switch (state) {
    case "granted":
      return {
        title: `${label} access granted`,
        message: `You can now ${purpose}.`,
        actionLabel: "OK",
        action: "dismiss",
      };
    case "undetermined":
      return {
        title: UNDETERMINED_TITLE_OVERRIDE[kind] ?? `${label} access needed`,
        message: `Allow ${label.toLowerCase()} access to ${purpose}.`,
        actionLabel: "Allow",
        action: "request",
      };
    case "denied":
      return {
        title: `${label} access denied`,
        message: `${label} access was denied. You can try again.`,
        actionLabel: "Try again",
        action: "request",
      };
    case "denied-permanently":
      // Never "request" here — see this module's doc comment.
      return {
        title: `${label} access blocked`,
        message: `${label} access is blocked. Enable it in system settings to ${purpose}.`,
        actionLabel: "Open settings",
        action: "open-settings",
      };
    case "unavailable":
      return {
        title: `${label} access unavailable`,
        message: `${label} access isn't available in this build.`,
        actionLabel: "Dismiss",
        action: "dismiss",
      };
  }
}

/**
 * Resolves a fresh `PermissionState` from `port`, prompting at most
 * once and only when genuinely never-asked. Mirrors
 * `../connect/qr-scan-model.ts`'s `enterScanSurface()` rule exactly:
 * read first (`getPermissionStatus`, never prompts); only call the
 * prompting `requestPermission()` when that read comes back
 * `"undetermined"`. A `"denied"`, `"denied-permanently"`, or
 * `"unavailable"` read is returned as-is, so a user who already
 * declined is shown recovery copy immediately rather than being
 * re-prompted in a loop — the native OS remains the single place a
 * prior denial is remembered, exactly as the QR scanner's own comment
 * explains.
 */
export async function resolvePermission(port: PermissionPort): Promise<PermissionState> {
  const status = await port.getPermissionStatus();
  if (status !== "undetermined") {
    return status;
  }
  return port.requestPermission();
}

// --- WHAT T60D UNIFIED, AND WHAT P5-W17 CLOSED ------------------------------
//
// Folded onto this module (T60D, P5-W15): `features/connect/`'s
// `OnboardingPermissionStatus`/`OnboardingPermissionsPort`/
// `describeCameraPermissionRecovery` (T32A6, built the same P5-W13 wave
// as this file, independently — neither task could see the other's
// grant). `onboarding-permissions.ts` now types its port as this
// module's `PermissionPort` and calls `describePermissionRecovery
// ("camera", state)` directly; no camera-specific copy table remains in
// `features/connect/`.
//
// Closed since (P5-W17), both by tasks that owned the other directory:
//   - T60F deleted `features/notifications/notification-permission-
//     recovery.ts`'s single-kind `describeNotificationPermissionRecovery`
//     /`NotificationPermissionRecoveryCopy` copy table, which had only
//     survived because that task could not reach into this file to add a
//     `"notifications"` `PermissionKind` (the P5-W14 constraint). That
//     kind exists here now, and every notifications call site calls
//     `describePermissionRecovery("notifications", state)` from this
//     module. T60F kept THIS module's generic wording over the deleted
//     table's, except for one filed exception: the deleted table's
//     `"undetermined"` title ("Turn on notifications?") read better than
//     this module's generic form, and T60F filed applying it here as a
//     follow-up (see that file's header for the full reasoning). T60G
//     (P5-W18) applied it — see `UNDETERMINED_TITLE_OVERRIDE` below.
//   - T60E deleted `../connect/qr-scanner-port.ts`'s
//     `CameraPermissionStatus`, the last union that mirrored this
//     vocabulary without naming `"denied-permanently"`, and widened the
//     CI guard so that shape can no longer reappear unnoticed.
//
// `packages/frontend-core/src/platform/notifications.ts`'s
// `NotificationPermissionState` (`"granted" | "denied" | "prompt" |
// "unsupported"`) is a separate, materially different question (local
// notification permission, not this module's OS-permission-with-
// recovery-copy concern) in a package this feature may not edit. T32P3
// — the task that wired `NotificationsPlatform` for `apps/android` —
// decided it does NOT fold: that union cannot express
// `"denied-permanently"`, and web's `Notification.permission` has no
// such state to produce, so `platform/notifications-platform.ts` narrows
// at the boundary (`mapPermissionState`) and exposes
// `getNativePermissionState` for callers that need the real five-state
// read. See that module's header for the full reasoning and for what
// would falsify it.
