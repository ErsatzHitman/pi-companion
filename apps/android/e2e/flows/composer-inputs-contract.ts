/**
 * T37E3 — single source of the testIds and literal copy
 * `composer-inputs.yaml` asserts on (plan.md §14.4 "composing with
 * keyboard, voice, attachment, and share intent").
 *
 * RN-free by construction (a plain object of strings), same rationale
 * as `pairing-contract.ts` (T37E1): Maestro's `.yaml` flows cannot
 * `import` this file (Maestro has no module system), so
 * `composer-inputs.yaml` restates each value inline, commented with the
 * exact source line it mirrors — `composer-inputs.contract.test.ts` is
 * what actually keeps that restatement honest, not this file by itself.
 *
 * Every value below is the **keyboard** path — the only one of the four
 * §14.4 input modes actually mounted this wave. See
 * `composer-inputs.yaml`'s header comment for why voice, attachment
 * picking, and the share intent are written as named, blocked sections
 * instead.
 */
export const COMPOSER_INPUTS_FLOW = {
  /**
   * Deep link straight to `/h/:serverId/session/:agentId`
   * (`apps/android/src/app-shell/deep-link-routing.ts`'s `"session"`
   * match), using the `picompanion://` scheme
   * (`apps/android/app.config.ts`'s `scheme: "picompanion"`). Bypasses
   * the still-open "no navigation away from /connect" gap
   * `cold-start-restore.yaml` (T37E2) disclosed — Expo Router resolves
   * this URL against the registered route file directly, independent of
   * any in-app button. `serverId`/`agentId` are free-form path segments
   * this route never validates against a real host (see
   * `SessionRoute`'s own doc comment) — any non-empty string works.
   */
  sessionDeepLink: "picompanion://h/e2e-host/session/e2e-session",

  /** `Composer.tsx`'s default root testId (`testId ?? "composer"`) when no `testId` prop is passed — `session/[agentId]/index.tsx` passes none. */
  composerRoot: "composer",
  composerInputField: "composer-input",
  composerSendButton: "composer-send",
  composerEntriesContainer: "composer-entries",
  composerMicButton: "composer-mic",
  composerAttachButton: "composer-attach",
  composerAttachmentPermissionNotice: "composer-attachment-permission-notice",
  composerMicPermissionNotice: "composer-mic-permission-notice",

  /**
   * `composer-model.ts`'s `entryStatusLabel("sent")` — the status chip
   * text once `handleSubmit` resolves. Since T32S13 (P5-W19) that only
   * happens against a connected daemon: `handleSubmit` now calls
   * `AppCore.startTurn`, so an unpaired run reconciles to
   * `entryFailedLabel` below instead. Kept because it is still the copy
   * a successful send shows, and what the flow should assert once a
   * paired run exists (T59).
   */
  entrySentLabel: "Sent",

  /**
   * `composer-model.ts`'s `entryStatusLabel("failed")` — what an
   * unpaired keyboard send actually reconciles to since T32S13 wired
   * `onSubmit` to `AppCore.startTurn`: with no daemon connected,
   * `startDaemonTurn` settles `{ status: "failed" }`, `handleSubmit`
   * re-throws, and `Composer`'s own `markEntryFailed` path renders this
   * label with the entry's text still recoverable via Retry. This is
   * the honest, shipped behaviour `composer-inputs.yaml` asserts — never
   * a stand-in for a delivered turn.
   */
  entryFailedLabel: "Failed",

  /** `permission-recovery.ts`'s `describePermissionRecovery("photos", "unavailable")`, as `PermissionRecoveryNotice` renders it (`${copy.title}. ${copy.message}`). */
  attachmentUnavailableBannerText:
    "Photo and file access unavailable. Photo and file access isn't available in this build.",
  /** Same, for `describePermissionRecovery("microphone", "unavailable")`. */
  micUnavailableBannerText:
    "Microphone access unavailable. Microphone access isn't available in this build.",
} as const;
