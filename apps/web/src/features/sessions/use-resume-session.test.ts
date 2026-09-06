import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { composer as coreComposer, timeline as coreTimeline } from "@picompanion/frontend-core";

import type { SessionResumeClient, SessionResumeResult } from "./session-resume-client.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";
import type { SessionSummary } from "./types.js";
import { useResumeSession } from "./use-resume-session.js";

const SESSION: SessionSummary = {
  id: "agt-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/existing",
  status: "idle",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function timelineWithOneMessage(): coreTimeline.TimelineState {
  return coreTimeline.ingestTimelineWindow(coreTimeline.createEmptyTimelineState(), {
    type: "fetch_agent_timeline_response",
    payload: {
      requestId: "req-1",
      agentId: "agt-1",
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
      startCursor: { epoch: "epoch-1", seq: 0 },
      endCursor: { epoch: "epoch-1", seq: 0 },
      hasOlder: false,
      hasNewer: false,
      entries: [
        {
          provider: "pi",
          item: { type: "user_message", text: "hello" },
          timestamp: "2026-01-02T00:00:00.000Z",
          seqStart: 0,
          seqEnd: 0,
          sourceSeqRanges: [{ startSeq: 0, endSeq: 0 }],
          collapsed: [],
        },
      ],
      error: null,
    },
  });
}

function fakeClient(
  impl: (sessionId: string) => Promise<SessionResumeResult>,
): SessionResumeClient {
  return { resumeSession: impl };
}

describe("useResumeSession (T27B3)", () => {
  it("resumes a session: loading -> ready with its timeline and queue restored", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock(1_000);
    const outbox = new coreComposer.OutboxController(storage, clock);
    await outbox.enqueue({
      sessionId: "agt-1",
      kind: "prompt",
      payload: { text: "queued message" },
    });
    // A different session's queue entry must never leak into this session's count.
    await outbox.enqueue({
      sessionId: "agt-other",
      kind: "prompt",
      payload: { text: "not this one" },
    });

    const client = fakeClient(async () => ({
      session: SESSION,
      timeline: timelineWithOneMessage(),
    }));
    const { result } = renderHook(() =>
      useResumeSession({ client, sessionId: "agt-1", clock, structuredStorage: storage }),
    );

    expect(result.current.state.status).toBe("loading");

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.session).toEqual(SESSION);
    expect(result.current.state.timeline?.rows).toHaveLength(1);
    expect(result.current.state.queue).toHaveLength(1);
    expect(result.current.state.queue[0]?.payload).toEqual({ text: "queued message" });
  });

  it("surfaces a clear message when resuming a missing session", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock();
    const client = fakeClient(async () => {
      throw new Error("Agent not found: agt-missing");
    });
    const { result } = renderHook(() =>
      useResumeSession({ client, sessionId: "agt-missing", clock, structuredStorage: storage }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/doesn't exist/i);
    expect(result.current.state.error?.raw).toBe("Agent not found: agt-missing");
    expect(result.current.state.session).toBeNull();
    expect(result.current.state.timeline).toBeNull();
  });

  it("retry() re-issues the resume request", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock();
    const resumeSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ session: SESSION, timeline: timelineWithOneMessage() });
    const client: SessionResumeClient = { resumeSession };

    const { result } = renderHook(() =>
      useResumeSession({ client, sessionId: "agt-1", clock, structuredStorage: storage }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    result.current.retry();

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(resumeSession).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response after sessionId changes before it resolves", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock();
    let resolveFirst: ((result: SessionResumeResult) => void) | undefined;
    const resumeSession = vi.fn((sessionId: string) => {
      if (sessionId === "agt-slow") {
        return new Promise<SessionResumeResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        session: { ...SESSION, id: sessionId },
        timeline: coreTimeline.createEmptyTimelineState(),
      });
    });
    const client: SessionResumeClient = { resumeSession };

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useResumeSession({ client, sessionId, clock, structuredStorage: storage }),
      { initialProps: { sessionId: "agt-slow" } },
    );

    rerender({ sessionId: "agt-1" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.session?.id).toBe("agt-1");

    // The slow first request finally resolves after the newer one already
    // landed; it must not clobber the current session's state.
    resolveFirst?.({ session: { ...SESSION, id: "agt-slow" }, timeline: timelineWithOneMessage() });
    await Promise.resolve();
    expect(result.current.state.session?.id).toBe("agt-1");
  });
});
