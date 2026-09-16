import { useEffect, useMemo, useRef, useState } from "react";

import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { Clock, StructuredStorage } from "@picompanion/frontend-core";
import type { DaemonClient } from "@picompanion/client";

import { createBrowserFrameClock } from "../../platform/frame-clock.js";
import {
  cacheTimelineTail,
  confirmTimelineCatchUp,
  createTimelineCache,
  loadTimelineCacheEnvelope,
} from "../../platform/offline/index.js";

/**
 * Live-streamed transcript state for one session (T53A2, extended by T393),
 * sourced from the same `DaemonClient` `daemon-client-context.tsx` (T53A1)
 * provides and backed by this app's real IndexedDB display-only cache
 * (plan.md §2.2 "offline-readable cache", §7.4/§12.5).
 *
 * Two independent reads of the same session's timeline exist by design:
 * `SessionResumeScreen` keeps its own `useResumeSession` call for the
 * route's identity/status/queue-count summary (T27B3's already-built,
 * already-tested surface, untouched here), and this hook keeps a second,
 * purpose-built `TimelineState` — fed forward live — for the transcript
 * itself. Folding the two into one shared fetch would mean reaching into
 * `SessionResumeScreen`'s internals.
 *
 * ## Catch-up
 *
 * The initial page is a real `fetch_agent_timeline_request` (`direction:
 * "tail", limit: 200`; the same bounded cold-open window
 * `SessionResumeScreen` uses), folded through `timeline.ingestTimelineWindow`
 * against whatever the coalescer already holds — not against a pre-built
 * empty state — so an authoritative window reconciles with a restored
 * cached tail by (epoch, seq) instead of discarding it. That fold is also
 * this hook's catch-up signal: `ingestTimelineWindow` is the only thing
 * that clears `TimelineState.stale`, and the hook then marks the
 * cache-level entry caught up (`confirmTimelineCatchUp`).
 *
 * ## Cache
 *
 * On mount the session's cached tail is restored first, so the transcript
 * can render from disk before (or without) a daemon connection; a restored
 * state is always `stale: true` until the authoritative window above
 * lands. Every subsequent `agent_stream` push is queued onto a
 * `timeline.TimelineCoalescer` (T45A2) — batched onto this app's real
 * `createBrowserFrameClock()` (T45A3) so a burst of streaming deltas
 * applies as one state transition per frame tick — and never dropped,
 * replaced, or reordered (plan.md §7.4's delta-based-end-to-end contract;
 * see `coalescer.ts`'s own module doc for the verified,
 * concatenation-free wire behaviour this must not contradict). The
 * coalescer's confirmed rows are written back to the cache as they stream
 * (at most one write in flight, always the latest state), so a later
 * offline open has something to show. `cachedAt` is returned so the route
 * renders an honest last-seen time rather than a fabricated one.
 *
 * T31B3: those `agent_stream` pushes only ever arrive at all once this
 * hook also calls `client.setAgentTimelineSubscription([sessionId])` --
 * see the effect body's own comment for the empirically-confirmed daemon
 * behaviour (`session.ts`'s `usesSelectiveTimelineDelivery`) that made
 * this necessary; before this task, this hook subscribed to
 * `"agent_stream"` but never registered the session as viewed, so no
 * push for it was ever forwarded.
 *
 * Resolves to `{ entries: [], cachedAt: null }` (not an error) whenever
 * there is neither a live `client` nor a cached tail — `Transcript`'s own
 * empty state already covers that case, matching this app's "absence of a
 * connection is a normal state" convention (T53A1).
 */
export interface SessionTranscriptOptions {
  /** The live `DaemonClient` for this connection generation, or `null`. */
  client: DaemonClient | null;
  /** The open session's id. */
  sessionId: string;
  /**
   * `daemon-client-context.tsx`'s `client` becomes non-null (a real,
   * constructed `DaemonClient`) as soon as `HostController` starts
   * connecting -- well before its own hello handshake finishes and its
   * `getLastServerInfoMessage()` (`@picompanion/client`) is populated.
   * Every read this hook makes below (`fetchAgentTimeline`, `on("agent_stream")`)
   * already tolerates that (`skipQueue: true` lets them race ahead of
   * "connected"), but `client.setAgentTimelineSubscription` silently
   * no-ops without a `lastServerInfoMessage` yet (its own COMPAT guard)
   * -- proven empirically driving this exact hook against the real
   * isolated E2E daemon: subscribing while still `"connecting"` sends
   * nothing at all, and the daemon then withholds every live
   * `agent_stream` push for this agent forever, since nothing ever
   * re-subscribes once the handshake actually completes. Re-running this
   * effect once `connectionStatus` reaches `"connected"` (cheap: one
   * extra `fetchAgentTimeline` call and an idempotent re-subscribe) is
   * what closes that gap.
   */
  connectionStatus: string;
  /** This app's real `platform.structuredStorage` (IndexedDB). */
  storage: StructuredStorage;
  /** This app's real `platform.clock`, used for cache-envelope timestamps. */
  clock: Clock;
  /**
   * T395: bumped after a successful rewind so the whole effect re-runs and the
   * transcript re-resumes from the daemon — a rewind mutates history
   * server-side, and while the live timeline subscription usually pushes the
   * change, a files-only rewind legitimately changes no timeline row, so the
   * screen forces one authoritative re-read rather than assuming.
   */
  refreshNonce: number;
}

/** The transcript entries plus the cache-level freshness of the tail behind them. */
export interface SessionTranscriptResult {
  entries: readonly coreTimeline.TranscriptEntry[];
  /** `CacheEnvelope.cachedAt` for the tail on screen, or `null` when nothing has been cached. */
  cachedAt: number | null;
}

/**
 * The bounded cold-open timeline window this hook requests, matching
 * `daemon-session-resume-client.ts`'s own `INITIAL_TIMELINE_OPTIONS`
 * (`direction: "tail", limit: 200`) so the transcript and the resume
 * summary read the same tail.
 */
const TRANSCRIPT_INITIAL_TIMELINE = { direction: "tail", limit: 200 } as const;

export function useSessionTranscriptEntries(
  options: SessionTranscriptOptions,
): SessionTranscriptResult {
  const { client, sessionId, connectionStatus, storage, clock, refreshNonce } = options;
  const [entries, setEntries] = useState<readonly coreTimeline.TranscriptEntry[]>([]);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  // Guards a response that resolves after this effect's own cleanup already
  // ran (session switched, or the client changed out from under it) from
  // ever reaching a disposed coalescer.
  const generationRef = useRef(0);
  const cache = useMemo(() => createTimelineCache(storage, clock), [storage, clock]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setEntries([]);
    setCachedAt(null);

    const frameClock = createBrowserFrameClock();
    const coalescer = new coreTimeline.TimelineCoalescer(
      frameClock,
      coreTimeline.createEmptyTimelineState(),
    );
    const disposers: Array<() => void> = [];
    let disposed = false;
    const isCurrent = () => !disposed && generationRef.current === generation;

    // T388: project incrementally. A streaming append re-derives only the
    // appended row (and any row the same ingest mutated) instead of every
    // entry in the session; the settled entries keep their exact object
    // identity, which is what lets each memoized row component skip its own
    // re-render. Output is identical to `buildTranscriptView(state).entries`.
    const projector = new coreTimeline.TranscriptEntryProjector();

    // Cache write path: at most one write in flight, always the latest
    // state. A restore or catch-up fold is excluded from this path (it is
    // already on disk / about to be written by `confirmTimelineCatchUp`),
    // so a just-restored tail is never re-stamped with a fresh `cachedAt`
    // the data does not have.
    let writeInFlight = false;
    let pendingWrite: coreTimeline.TimelineState | null = null;
    let suppressNextWrite = false;

    const flushWrite = () => {
      if (writeInFlight || pendingWrite === null) return;
      const state = pendingWrite;
      pendingWrite = null;
      if (state.epoch === null || state.rows.length === 0) return;
      writeInFlight = true;
      cacheTimelineTail(cache, sessionId, state)
        .then((envelope) => {
          if (isCurrent() && envelope !== null) setCachedAt(envelope.cachedAt);
        })
        .catch(() => {})
        .finally(() => {
          writeInFlight = false;
          if (pendingWrite !== null) flushWrite();
        });
    };

    const scheduleWrite = (state: coreTimeline.TimelineState) => {
      if (suppressNextWrite) {
        suppressNextWrite = false;
        return;
      }
      if (state.epoch === null || state.rows.length === 0) return;
      pendingWrite = state;
      flushWrite();
    };

    const unsubscribeState = coalescer.subscribe((state) => {
      if (!isCurrent()) return;
      setEntries(projector.project(state));
      scheduleWrite(state);
    });
    disposers.push(unsubscribeState);

    void (async () => {
      // Restore first (so a cold offline open shows the cached tail), then
      // attach the live subscriptions and catch up. Reading the cache is a
      // bounded local operation; anything the daemon streams while it is in
      // flight is re-covered by the authoritative window below.
      const envelope = await loadTimelineCacheEnvelope(cache, sessionId).catch(() => null);
      if (!isCurrent()) return;
      if (envelope) {
        setCachedAt(envelope.cachedAt);
        suppressNextWrite = true;
        coalescer.applyImmediate(() => coreTimeline.restoreCachedTimeline(envelope.data));
      }

      if (!client) return;

      const unsubscribeStream = client.on("agent_stream", (message) => {
        if (message.payload.agentId !== sessionId) return;
        coalescer.push(message);
      });
      disposers.push(unsubscribeStream);

      // T31B1/T31B3 (both tasks diagnosed this independently): the ported
      // daemon (`packages/server/src/server/session.ts`,
      // `usesSelectiveTimelineDelivery` / `CLIENT_CAPS.selectiveAgentTimeline`)
      // forwards `agent_stream` pushes only for agent ids this connection has
      // explicitly marked as viewed via `agent.timeline.set_subscription.request`
      // once that capability is negotiated -- and the real `DaemonClient`
      // declares it in every `hello` unconditionally (`daemon-client.ts`),
      // never this app's choice. Without the call below, a real
      // `send_agent_message_request` still resolves `accepted: true` and the
      // provider really runs, but not one `agent_stream` push (not even the
      // daemon's own synthesized `user_message` echo) reaches the subscription
      // above, so the transcript stays empty forever -- proved end to end by
      // both `deep-link-restore.spec.ts` and `session-steer-and-follow-up.spec.ts`.
      //
      // `HostController.getDaemonClient()` hands back a `DaemonClient` the
      // moment it is *constructed*, not once its hello handshake resolves, so
      // `client` here is routinely non-null before `lastServerInfoMessage`
      // exists. `setAgentTimelineSubscription` reads that field synchronously
      // and silently no-ops (resolves, sends nothing, never retries) while it
      // is still `null`, so the call must be gated on the first `server_info`
      // `status` push -- mirroring `DaemonClient`'s own `HELLO_SERVER_INFO`
      // gate, which is also exactly when it flips to `connected`.
      //
      // The `status` listener stays attached for this effect's lifetime rather
      // than detaching after the first hit: `DaemonClient` re-emits
      // `server_info` after every reconnect and re-establishes only its
      // checkout-diff/terminal-directory/file subscriptions itself (see the
      // `resubscribe*` calls in `daemon-client.ts`) -- never agent-timeline
      // ones -- so a dropped-and-restored socket would otherwise silently stop
      // delivering `agent_stream` for this session
      // (`reconnect-and-catch-up.spec.ts`).
      const unsubscribeServerInfo = client.on("status", (message) => {
        if (message.payload.status !== "server_info") return;
        client.setAgentTimelineSubscription([sessionId]).catch(() => {});
      });
      disposers.push(unsubscribeServerInfo);
      if (client.getLastServerInfoMessage()) {
        client.setAgentTimelineSubscription([sessionId]).catch(() => {});
      }
      disposers.push(() => {
        // Best-effort: dropping this session's live-view registration on
        // navigation away is a courtesy, not a correctness requirement --
        // the next screen this client visits (if any) replaces the set
        // itself.
        client.setAgentTimelineSubscription([]).catch(() => {});
      });

      try {
        const payload = await client.fetchAgentTimeline(sessionId, TRANSCRIPT_INITIAL_TIMELINE);
        if (!isCurrent()) return;
        suppressNextWrite = true;
        const caughtUp = coalescer.applyImmediate((current) =>
          coreTimeline.ingestTimelineWindow(current, {
            type: "fetch_agent_timeline_response",
            payload,
          }),
        );
        await confirmTimelineCatchUp(cache, sessionId, caughtUp)
          .then((confirmed) => {
            if (isCurrent() && confirmed !== null) setCachedAt(confirmed.cachedAt);
          })
          .catch(() => {});
      } catch {
        // `SessionResumeScreen`'s own controller already surfaces a resume
        // failure (retryable error state); this hook only feeds the
        // transcript view and has nothing further to show beyond leaving
        // whatever was restored in place.
      }
    })();

    return () => {
      disposed = true;
      for (const dispose of disposers) dispose();
      coalescer.dispose();
    };
  }, [cache, client, sessionId, connectionStatus, refreshNonce]);

  return { entries, cachedAt };
}
