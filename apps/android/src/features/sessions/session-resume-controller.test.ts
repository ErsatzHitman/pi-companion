/**
 * Tests for `session-resume-controller.ts` (T32B3, plan.md §7.4
 * "Liveness"): a real `connection.ResumeController`'s `reconcile()`
 * wired to `SessionService.openSession`, proven against fakes — never a
 * socket, never `react-native` (this module doesn't import it, so
 * unlike `sessions-screen.tsx` it renders/executes fine here).
 */
import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { timeline as coreTimeline } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import { createSessionResumeController } from "./session-resume-controller";
import type { SessionOpenResult, SessionService } from "./sessions-model";

/** Never fires on its own: every reconcile here is driven by `notifyResumeSignal()` directly, not by the bounded periodic check. */
class NoopClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function session(id: string): SessionOpenResult["session"] {
  return {
    id,
    title: "Resumed",
    provider: "pi",
    cwd: "/home/pi/project",
    status: "idle",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

/** Fills in `SessionService.archiveSession`/`deleteSession`/`refreshSessions` for tests that only exercise `openSession`; T32B4 added the first two, T32B6 the third — all unrelated to what this file proves. */
function unusedActions(): Pick<
  SessionService,
  "archiveSession" | "deleteSession" | "refreshSessions"
> {
  return {
    archiveSession: async (id: string) => session(id),
    deleteSession: async () => {},
    refreshSessions: async () => ({ sessions: [], complete: true }),
  };
}

describe("createSessionResumeController reconciles the currently-open session on a resume signal (T32B3)", () => {
  it("calls SessionService.openSession for whatever getSessionId() currently reports, and applies the result via onReconciled", async () => {
    const result: SessionOpenResult = {
      session: session("s1"),
      timeline: coreTimeline.createEmptyTimelineState(),
    };
    const openSession = vi.fn(async (id: string) => {
      expect(id).toBe("s1");
      return result;
    });
    const sessionService: SessionService = {
      createSession: async () => session("unused"),
      ...unusedActions(),
      openSession,
    };
    const onReconciled = vi.fn();

    const controller = createSessionResumeController({
      sessionService,
      getSessionId: () => "s1",
      onReconciled,
      clock: new NoopClock(),
    });

    controller.notifyResumeSignal();
    await settle();

    expect(openSession).toHaveBeenCalledTimes(1);
    expect(onReconciled).toHaveBeenCalledWith("s1", result);
  });

  it("does nothing — no service call, no callback — when no session is open", async () => {
    const openSession = vi.fn(async (id: string) => ({
      session: session(id),
      timeline: coreTimeline.createEmptyTimelineState(),
    }));
    const onReconciled = vi.fn();

    const controller = createSessionResumeController({
      sessionService: { createSession: async () => session("x"), openSession, ...unusedActions() },
      getSessionId: () => null,
      onReconciled,
      clock: new NoopClock(),
    });

    controller.notifyResumeSignal();
    await settle();

    expect(openSession).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it("a rejected reconcile calls onReconcileError with a distinct 'missing' explanation for a session the daemon no longer has", async () => {
    const sessionService: SessionService = {
      createSession: async () => session("x"),
      ...unusedActions(),
      openSession: async () => {
        throw new Error("Agent not found: s1");
      },
    };
    const onReconciled = vi.fn();
    const onReconcileError = vi.fn();

    const controller = createSessionResumeController({
      sessionService,
      getSessionId: () => "s1",
      onReconciled,
      onReconcileError,
      clock: new NoopClock(),
    });

    controller.notifyResumeSignal();
    await settle();

    expect(onReconciled).not.toHaveBeenCalled();
    expect(onReconcileError).toHaveBeenCalledTimes(1);
    const [sessionId, message, explanation] = onReconcileError.mock.calls[0] as [
      string,
      string,
      { missing: boolean },
    ];
    expect(sessionId).toBe("s1");
    expect(message).toBe("Agent not found: s1");
    expect(explanation.missing).toBe(true);
  });

  it("distinguishes a non-missing reconcile failure (network) from a missing session", async () => {
    const sessionService: SessionService = {
      createSession: async () => session("x"),
      ...unusedActions(),
      openSession: async () => {
        throw new Error("Network request failed");
      },
    };
    const onReconcileError = vi.fn();

    const controller = createSessionResumeController({
      sessionService,
      getSessionId: () => "s1",
      onReconciled: vi.fn(),
      onReconcileError,
      clock: new NoopClock(),
    });

    controller.notifyResumeSignal();
    await settle();

    const [, , explanation] = onReconcileError.mock.calls[0] as [
      string,
      string,
      { missing: boolean },
    ];
    expect(explanation.missing).toBe(false);
  });

  it("re-reads getSessionId() on every attempt: a session switched in between two resume signals is what the second reconcile targets", async () => {
    let current = "s1";
    const openSession = vi.fn(async (id: string) => ({
      session: session(id),
      timeline: coreTimeline.createEmptyTimelineState(),
    }));

    const controller = createSessionResumeController({
      sessionService: { createSession: async () => session("x"), openSession, ...unusedActions() },
      getSessionId: () => current,
      onReconciled: vi.fn(),
      clock: new NoopClock(),
    });

    controller.notifyResumeSignal();
    await settle();
    current = "s2";
    controller.notifyResumeSignal();
    await settle();

    expect(openSession).toHaveBeenNthCalledWith(1, "s1");
    expect(openSession).toHaveBeenNthCalledWith(2, "s2");
  });

  it("fences a slow reconcile against a run-generation bump: onReconciled is never called once the generation has moved on", async () => {
    const runGeneration = new coreTimeline.RunGenerationTracker();
    let resolveOpen: ((value: SessionOpenResult) => void) | undefined;
    const openSession = vi.fn(
      () =>
        new Promise<SessionOpenResult>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const onReconciled = vi.fn();

    const controller = createSessionResumeController({
      sessionService: { createSession: async () => session("x"), openSession, ...unusedActions() },
      getSessionId: () => "s1",
      onReconciled,
      clock: new NoopClock(),
      runGeneration,
    });

    controller.notifyResumeSignal();
    await settle();
    expect(openSession).toHaveBeenCalledTimes(1);

    // The generation moves on (e.g. a new turn began) before the daemon replies.
    runGeneration.beginRun();
    resolveOpen?.({ session: session("s1"), timeline: coreTimeline.createEmptyTimelineState() });
    await settle();

    expect(onReconciled).not.toHaveBeenCalled();
  });
});
