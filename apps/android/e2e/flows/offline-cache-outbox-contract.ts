/**
 * T37E8 — single source of the testIds and literal copy
 * `offline-cache-outbox.yaml` asserts on (plan.md §14.4 "read offline
 * cache and flush a safe outbox item").
 *
 * RN-free by construction (a plain object of strings), same rationale
 * as `pairing-contract.ts`/`composer-inputs-contract.ts`: Maestro's
 * `.yaml` flows cannot `import` this file (Maestro has no module
 * system), so `offline-cache-outbox.yaml` restates each value inline,
 * commented with the exact source line it mirrors —
 * `offline-cache-outbox.contract.test.ts` is what actually keeps that
 * restatement honest, not this file by itself.
 *
 * Reuses `composer-inputs-contract.ts`'s `sessionDeepLink` technique
 * (its own doc comment explains why) with a distinct
 * host/session pair, so this flow can never be confused with that
 * one's in a sharded run's log output.
 */
export const OFFLINE_CACHE_OUTBOX_FLOW = {
  /**
   * Deep link straight to `/h/:serverId/session/:agentId`
   * (`apps/android/src/app-shell/deep-link-routing.ts`'s `"session"`
   * match), using the `picompanion://` scheme
   * (`apps/android/app.config.ts`'s `scheme: "picompanion"`). Distinct
   * `serverId`/`agentId` from `composer-inputs-contract.ts`'s own
   * `sessionDeepLink` — both are free-form path segments `SessionRoute`
   * never validates against a real paired host.
   */
  sessionDeepLink: "picompanion://h/e2e-offline-host/session/e2e-offline-session",

  /** `Composer.tsx`'s default root testId (`testId ?? "composer"`) when no `testId` prop is passed — `session/[agentId]/index.tsx` passes none. */
  composerRoot: "composer",
  composerInputField: "composer-input",
  composerSendButton: "composer-send",
  composerEntriesContainer: "composer-entries",
  /** `${composerTestId}-entry-${entry.id}-retry` — `ComposerEntryRow`'s `Button`, rendered only while `entry.status === "failed"`. The `entry.id` segment is a runtime-generated id, hence the flow's own `.*` wildcard rather than this literal string alone. */
  composerEntryRetryButtonSuffix: "-retry",

  /** `composer-model.ts`'s `entryStatusLabel("failed")` — what an unpaired keyboard send reconciles to, since T32S13 wired `onSubmit` to `AppCore.startTurn`: with no daemon connected, `startDaemonTurn` settles `{ status: "failed" }`, `handleSubmit` re-throws, and `Composer`'s own `markEntryFailed` path renders this label with the entry's text still recoverable via Retry. */
  entryFailedLabel: "Failed",

  /**
   * `session/[agentId]/index.tsx`'s `SessionTranscript` — the fixed
   * `testId` its staleness `Banner` renders under, real and wired but
   * (per that file's own doc comment, restated in the flow's header)
   * never observably `true` today: nothing in this repository calls the
   * timeline reducer's `restoreCachedTimeline`, so `state.stale` starts
   * and stays `false` for the life of every batcher this route
   * constructs. The flow asserts this banner absent, not present — the
   * real current behaviour, not a stand-in for the intended one.
   */
  timelineStalenessBannerTestId: "session-transcript-staleness",
  /** `stale-announcement.ts`'s `describeTimelineStaleness({ stale: true, gap: null, cachedAt: undefined })` text — the sentence the banner above WOULD show, once T68 (this wave) constructs a real `OfflineCache`/`SqliteStructuredStorage` and something threads a restored cached tail into this route's batcher before first render. Not asserted by the flow today — recorded here only so the eventual assertion is typed against the same single source as everything else in this file, not invented fresh. */
  timelineStalenessAwaitingCatchUpText: "Showing cached messages — confirming with the server.",
} as const;
