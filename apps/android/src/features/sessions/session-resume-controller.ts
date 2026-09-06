/**
 * Wires this feature's currently-open session into a real
 * `connection.ResumeController` (T46A2, plan.md §7.4 "Liveness": a
 * socket that stays open but goes silent — the daemon moved on while
 * nothing told the client to look).
 *
 * T32B3 is the first Android task that owns both a live connection
 * (`SessionService`) and a timeline replica (`SessionOpenState`) to
 * reconcile into — see `../../app/core.ts`'s `AppCore.attachResumeSignals`
 * doc comment, which names this task as its first production caller.
 * `sessions-screen.tsx` constructs the controller this module builds,
 * then calls `useResumeSignals()` (`../../app/core-context.tsx`) with it
 * so this app's foreground/connectivity churn (`../../app/
 * resume-signals.ts`, T32S1B) drives it; this module itself never
 * touches `AppLifecycle`/`NetworkReachability` or React.
 *
 * `reconcile()` re-opens the session through the exact same
 * `SessionService.openSession` path a fresh tap-open already uses
 * (`sessions-model.ts`'s `openAndLoadSession`) — this deliberately never
 * grows a second recovery route, matching `resume-controller.ts`'s own
 * module doc ("this module deliberately owns no `DaemonClient`, no
 * `TimelineState`, and no wire types, so it cannot grow a second
 * recovery route by accident"). Every reconcile attempt is fenced by the
 * `RunGenerationTracker` `ResumeController` already threads through
 * `fenceAsyncResponse` — a slow reconcile that resolves after the caller
 * has moved on to a different session (a new `runGeneration.beginRun()`)
 * is discarded, never applied. This module accepts `runGeneration` as an
 * injected dependency (defaulting to a fresh tracker) rather than
 * constructing one no caller can see, specifically so a test can drive
 * fencing directly (`session-resume-controller.test.ts`); production
 * wiring has no shared tracker to hand it yet, since Android's composer
 * feature (`TurnService`) doesn't expose one this wave — see this
 * module's test file and this task's report for that known gap.
 *
 * Pure orchestration, no React, no `react-native`: only
 * `@picompanion/frontend-core` and this feature's own RN-free
 * `sessions-model.ts`. Testable directly in this workspace's plain
 * `vitest`, unlike `sessions-screen.tsx`.
 */
import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { connection as coreConnection, timeline as coreTimeline } from "@picompanion/frontend-core";

import {
  explainSessionOpenError,
  type SessionOpenErrorExplanation,
  type SessionOpenResult,
  type SessionService,
} from "./sessions-model";

/**
 * Minimal `Clock` backed by the ambient timer globals. This app has no
 * shared platform `Clock` adapter yet — only
 * `apps/web/src/platform/clock.ts`'s `createBrowserClock` exists, and
 * adding one under `apps/android/src/platform/` is outside this task's
 * `Owns: apps/android/src/features/sessions/` grant — so this is a
 * private, minimal stand-in scoped to this feature; a later task can
 * promote it to a shared adapter (mirroring `createBrowserClock`
 * exactly) without changing this module's public surface.
 */
export function createSessionResumeClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle,
    clearTimeout: (handle) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback, intervalMs) =>
      setInterval(callback, intervalMs) as unknown as TimerHandle,
    clearInterval: (handle) => {
      clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  };
}

export interface SessionResumeControllerDeps {
  sessionService: SessionService;
  /**
   * The currently open session's id, or `null` if none is open. Read
   * fresh on every reconcile attempt (never captured once at
   * construction) so a session opened, closed, or switched after this
   * controller was built is still covered without rebuilding it.
   */
  getSessionId: () => string | null;
  /**
   * Applied only once `ResumeController`'s own run-generation fence
   * confirms the attempt is still current when it settles — never
   * called for a reconcile whose session has since changed.
   */
  onReconciled: (sessionId: string, result: SessionOpenResult) => void;
  /**
   * A reconcile attempt failed. Not fatal to `ResumeController` itself —
   * per its own doc, it "simply waits for the next trigger" — but a
   * session the daemon reports missing is worth surfacing distinctly
   * (`explanation.missing`), matching this task's "a missing session
   * fails with a clear message" criterion for the resume path too, not
   * only the initial cold-start open.
   */
  onReconcileError?: (
    sessionId: string,
    message: string,
    explanation: SessionOpenErrorExplanation,
  ) => void;
  /** Defaults to a fresh `Clock` (see `createSessionResumeClock`). */
  clock?: Clock;
  /** Defaults to a fresh tracker. See module doc for why this isn't shared with a turn/prompt tracker yet. */
  runGeneration?: coreTimeline.RunGenerationTracker;
}

/**
 * Builds a `ResumeController` whose `reconcile()` re-opens whatever
 * `deps.getSessionId()` currently reports through
 * `SessionService.openSession`. Returns the controller itself — the
 * caller (`sessions-screen.tsx`) owns handing it to `useResumeSignals()`
 * and disposing it (`ResumeController.dispose()` stops its own internal
 * periodic timer; unsubscribing the lifecycle/network sources that
 * trigger it is `useResumeSignals()`'s job, not this controller's).
 */
export function createSessionResumeController(
  deps: SessionResumeControllerDeps,
): coreConnection.ResumeController {
  const reconcile: coreConnection.ResumeReconcile = async () => {
    const sessionId = deps.getSessionId();
    if (!sessionId) return undefined;
    try {
      const result = await deps.sessionService.openSession(sessionId);
      return () => {
        deps.onReconciled(sessionId, result);
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.onReconcileError?.(sessionId, message, explainSessionOpenError(message));
      return undefined;
    }
  };

  return new coreConnection.ResumeController({
    runGeneration: deps.runGeneration ?? new coreTimeline.RunGenerationTracker(),
    clock: deps.clock ?? createSessionResumeClock(),
    reconcile,
  });
}
