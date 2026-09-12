import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { FetchAgentTimelineResponseMessage } from "@picompanion/protocol/messages";

import { cacheTimelineTail, createTimelineCache } from "../../platform/offline/timeline-cache.js";
import { InMemoryStructuredStorage, ManualClock } from "../../platform/offline/test-doubles.js";
import { useSessionTranscriptEntries } from "./host-session-screen.js";

const SESSION_ID = "agent-offline-1";

/**
 * A small, structurally valid authoritative window folded through the real
 * reducer — enough to prove the cache round trip and the offline render
 * path. The reducer's own dedupe/gap/replace invariants are covered against
 * the shared recorded-session fixtures in
 * `frontend-core/src/timeline/*.test.ts` and in
 * `apps/web/src/platform/offline/timeline-cache.test.ts`, so this file does
 * not need to restage them.
 */
function authoritativeTimelineWindow(): FetchAgentTimelineResponseMessage {
  return {
    type: "fetch_agent_timeline_response",
    payload: {
      requestId: "req-offline-1",
      agentId: SESSION_ID,
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: "epoch-offline-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 2, nextSeq: 3 },
      startCursor: null,
      endCursor: null,
      hasOlder: false,
      hasNewer: false,
      entries: [
        {
          seqStart: 1,
          seqEnd: 1,
          timestamp: "2024-01-01T00:00:00.000Z",
          provider: "pi",
          item: { type: "user_message", text: "hello from before", clientMessageId: "m1" },
        },
        {
          seqStart: 2,
          seqEnd: 2,
          timestamp: "2024-01-01T00:00:01.000Z",
          provider: "pi",
          item: { type: "assistant_message", text: "still here", messageId: "a1" },
        },
      ],
      error: null,
    },
  } as unknown as FetchAgentTimelineResponseMessage;
}

function fixtureTimelineState(): coreTimeline.TimelineState {
  return coreTimeline.ingestTimelineWindow(
    coreTimeline.createEmptyTimelineState(),
    authoritativeTimelineWindow(),
  );
}

describe("useSessionTranscriptEntries offline cache path (T393)", () => {
  it("renders the cached tail when the daemon is unreachable, and reports the original last-seen time", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new ManualClock(5_000);
    const state = fixtureTimelineState();
    const expectedEntries = coreTimeline.buildTranscriptView(state).entries.length;
    expect(expectedEntries).toBeGreaterThan(0);

    await cacheTimelineTail(createTimelineCache(storage, clock), SESSION_ID, state);
    // Advance "now" far past the cache write: if the restore re-stamped the
    // cache, `cachedAt` would read 65_000 and the offline banner would claim
    // fabricated freshness. It must stay 5_000.
    clock.advance(60_000);

    const { result } = renderHook(() =>
      useSessionTranscriptEntries({
        client: null,
        sessionId: SESSION_ID,
        connectionStatus: "offline",
        storage,
        clock,
        // T395: no rewind happened in this case, so the effect never re-runs.
        refreshNonce: 0,
      }),
    );

    await waitFor(() => expect(result.current.entries.length).toBe(expectedEntries));
    expect(result.current.cachedAt).toBe(5_000);
  });

  it("stays empty (and never invents a last-seen time) with no cache and no client", async () => {
    // Hoisted so the option object stays referentially stable across renders:
    // `storage`/`clock` are the hook's `useMemo`/`useEffect` dependencies, and
    // constructing them inline would rebuild `cache` every render (the real
    // app passes its one `platform.structuredStorage`/`platform.clock`).
    const storage = new InMemoryStructuredStorage();
    const clock = new ManualClock(1_000);
    const { result } = renderHook(() =>
      useSessionTranscriptEntries({
        client: null,
        sessionId: "never-cached",
        connectionStatus: "offline",
        storage,
        clock,
        refreshNonce: 0,
      }),
    );

    await waitFor(() => expect(result.current.entries).toEqual([]));
    expect(result.current.cachedAt).toBeNull();
  });
});
