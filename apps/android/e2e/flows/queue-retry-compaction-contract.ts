/**
 * T39C — single source of the testIds and literal copy
 * `queue-retry-compaction.yaml` asserts on (plan.md §11.1's "queues and
 * automation" / "compaction and summarization retry" RPC groups).
 *
 * RN-free by construction (a plain object of strings), same rationale as
 * `composer-inputs-contract.ts` (T37E3): Maestro's `.yaml` flows cannot
 * `import` this file (Maestro has no module system), so
 * `queue-retry-compaction.yaml` restates each value inline, and
 * `queue-retry-compaction.contract.test.ts` is what actually keeps that
 * restatement honest, not this file by itself.
 *
 * ## What this flow can actually prove today
 *
 * **T132** (P6-W10) wired `queueModeClient`/`turnStatusClient` into
 * `session/[agentId]/index.tsx`'s `<Composer>` mount, resolved off the
 * real `AppCore.connection`'s active lifecycle
 * (`../src/app/h/[serverId]/session/[agentId]/session-route-daemon-
 * clients.ts`) — confirmed by reading that file: its `<Composer ... />`
 * element now lists `queueModeClient={queueModeClient}` and
 * `turnStatusClient={turnStatusClient}` alongside `sessionId`,
 * `onSubmit`, `onMicPress`, `onAttachPress`, `turnRunning`,
 * `turnService`, `outbox`. This harness still has no live daemon
 * connection (no emulator, no device — see the sibling `.test.ts`'s own
 * doc comment), so both resolve to `undefined` here, same as before —
 * only the REASON changed, from "no route passes the prop at all" to
 * "the prop resolves to undefined with no active connection". So at the
 * one production route this harness can reach:
 *
 *  - `QueueModePicker` renders its "no-client" unavailable state
 *    (`describeQueueModesUnavailable("no-client")`'s own text) — a
 *    truthful unavailable render, never an enabled control that
 *    silently does nothing. **Since T353 it renders inside the
 *    context-ring menu rather than in the composer's own scroll area**,
 *    so the flow taps `contextRing` first; the picker's own testId is
 *    unchanged, which is the point of this redesign's
 *    testID-continuity rule.
 *  - `TurnStatusBanner` renders nothing at all (its default
 *    `alwaysShowUnavailable={false}`, and `Composer.tsx` passes no such
 *    prop) — there is no banner text, no testId, nothing this flow can
 *    assert about it at this route. That is disclosed, not hidden: see
 *    `queue-retry-compaction.yaml`'s header for the same gap (proving a
 *    real round trip needs a live daemon connection, which needs the
 *    emulator/device this wave has never had).
 */
export const QUEUE_RETRY_COMPACTION_FLOW = {
  /** Same deep link `composer-inputs-contract.ts` uses to reach `Composer` without pairing. */
  sessionDeepLink: "picompanion://h/e2e-host/session/e2e-session",

  /** `Composer.tsx`'s default root testId — `session/[agentId]/index.tsx` passes none. */
  composerRoot: "composer",

  /**
   * T353: the prompt bar's context ring, which is what now opens the
   * menu holding the queue-mode picker. `Composer.tsx` mounts it as
   * `${composerTestId}-context-ring`.
   */
  contextRing: "composer-context-ring",

  /**
   * T353: the menu the ring opens (`PromptControlsMenu`'s default
   * testId at its `Composer.tsx` mount,
   * `${composerTestId}-controls-menu`). It is a `Sheet`, which renders
   * into the same native Window rather than a second one, so its
   * contents are ordinary nodes in the hierarchy Maestro reads once it
   * is open.
   */
  controlsMenu: "composer-controls-menu",

  /**
   * T354: `SessionControlsPicker`'s testId at its `Composer.tsx` mount
   * (`${composerTestId}-session-controls`) — the menu's MODE group,
   * holding the Build/Plan segments and the auto-compaction switch.
   */
  sessionControlsRoot: "composer-session-controls",
  sessionControlsUnavailable: "composer-session-controls-unavailable",

  /**
   * `describeSessionControlsUnavailable("no-client")` — the exact
   * sentence `SessionControlsPicker` renders when the controller has no
   * client at all, which is today's real shape at this route
   * (`supportsSessionControls(undefined) === false`, so no `load()` is
   * even attempted).
   */
  sessionControlsUnavailableText: "Connect to a daemon to change the mode or auto-compaction.",

  /** `QueueModePicker`'s default testId, applied at its `Composer.tsx` mount (`${composerTestId}-queue-mode`). */
  queueModePickerRoot: "composer-queue-mode",
  queueModePickerUnavailable: "composer-queue-mode-unavailable",

  /**
   * `describeQueueModesUnavailable("no-client")` — the exact sentence
   * `QueueModePicker` renders when `state.availability === "no-client"`,
   * which is what a `client: undefined` controller (today's real shape
   * at this route) reaches immediately, with no `load()` even
   * attempted (`supportsQueueModes(undefined) === false`).
   */
  queueModeUnavailableText: "Connect to a daemon to change the steer/follow-up mode.",

  /** `TurnStatusBanner`'s default testId — never reached at this route today (renders `null`); named here only so a future flow that DOES wire a client has one fixed point to assert against. */
  turnStatusBannerRoot: "composer-turn-status",
} as const;
