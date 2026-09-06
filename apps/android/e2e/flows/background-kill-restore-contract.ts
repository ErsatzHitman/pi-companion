/**
 * T37E6 — single source of the testIds and literal copy
 * `background-kill-restore.yaml` asserts on (plan.md §14.4
 * "backgrounding and killing the app during an active turn, then
 * restoring").
 *
 * RN-free by construction (a plain object of strings), same rationale
 * as `pairing-contract.ts` (T37E1) and `composer-inputs-contract.ts`
 * (T37E3): Maestro's `.yaml` flows cannot `import` this file (Maestro
 * has no module system), so `background-kill-restore.yaml` restates
 * each value inline, commented with the exact source line it mirrors —
 * `background-kill-restore.contract.test.ts` is what actually keeps
 * that restatement honest, not this file by itself.
 *
 * This flow reuses the exact same "reach the composer without pairing"
 * deep link `composer-inputs.yaml` (T37E3) already proved
 * (`sessionDeepLink` below is byte-identical), and the exact same
 * unpaired-send-reconciles-to-Failed mechanism T32S13 (P5-W19) wired —
 * see `background-kill-restore.yaml`'s header comment for the three
 * premises this flow names explicitly and the task that owns each one.
 */
export const BACKGROUND_KILL_RESTORE_FLOW = {
  /**
   * Same deep link `composer-inputs-contract.ts` (T37E3) uses, for the
   * identical reason: no in-app, button-driven path from a fresh
   * install to a specific `/h/:serverId/session/:agentId` route exists
   * without first creating a session (`cold-start-restore.yaml`'s own
   * still-open finding on that point), so this flow opens the route
   * directly via the app's registered `picompanion://` scheme
   * (`app.config.ts`) and the `"session"` match
   * (`deep-link-routing.ts`). Used twice by this flow: once to reach
   * the composer the first time, and again after the kill, since a
   * real process kill loses Expo Router's in-memory navigation state
   * and this flow never pairs a real host for `app/index.tsx`'s
   * cold-start redirect to read.
   */
  sessionDeepLink: "picompanion://h/e2e-host/session/e2e-session",

  /** `Composer.tsx`'s default root testId (`testId ?? "composer"`) when no `testId` prop is passed — `session/[agentId]/index.tsx` passes none. */
  composerRoot: "composer",
  composerInputField: "composer-input",
  composerSendButton: "composer-send",
  composerEntriesContainer: "composer-entries",

  /** The message text this flow types before sending, and checks is gone after restore (PREMISE 2 — composer state is not persisted). */
  turnAttemptText: "Testing background-kill-restore during a turn",

  /** A second, distinct message typed after restore, proving the composer is genuinely live again, not merely rendered inert. */
  postRestoreText: "Composer still works after restore",

  /**
   * `composer-model.ts`'s `entryStatusLabel("failed")` — what the
   * turn-attempt entry reconciles to, since T32S13 (P5-W19) wired
   * `onSubmit` to `AppCore.startTurn` -> `startDaemonTurn`: unpaired,
   * `core.ts`'s `getTurnTransport().sendMessage` rejects synchronously
   * ("Not connected to a daemon"), so the entry never reaches "Sent".
   * PREMISE 1 in `background-kill-restore.yaml`'s header comment; same
   * mechanism `composer-inputs.yaml` (T37E3) already names and asserts,
   * re-verified independently here rather than imported (see
   * `background-kill-restore.contract.test.ts`'s own doc comment).
   */
  entryFailedLabel: "Failed",
} as const;
