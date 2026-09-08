import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { DaemonClient } from "@picompanion/client";

import { useCore } from "../../app/core-context.js";
import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { ApprovalsContainer } from "../../features/approvals/index.js";
import { ComposerContainer } from "../../features/composer/index.js";
import { createDaemonAgentTurnClient } from "../../features/composer/index.js";
import { createDaemonSessionResumeClient } from "../../features/sessions/index.js";
import { SessionResumeScreen } from "../../features/sessions/SessionResumeScreen.js";
import {
  resolveDirectHttpOrigin,
  useAttachmentImageResolver,
} from "../../features/transcript/attachment-image-resolver.js";
import { EditFromHereSurface } from "../../features/transcript/index.js";
import type {
  EditFromHereForkClient,
  EditFromHereOutcome,
} from "../../features/transcript/index.js";
import { createBrowserFrameClock } from "../../platform/frame-clock.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId");

/**
 * T105 (plan.md §11.1): adapts a real `DaemonClient` to
 * `features/transcript/use-edit-from-here.ts`'s narrow
 * `EditFromHereForkClient`. Mirrors `features/sessions/daemon-sessions-
 * client.ts`'s own `DaemonAgentClient.forkAgent` disclosed-gap pattern —
 * see that file's module doc — rather than importing it directly, since
 * `features/sessions/` is a different task's owned directory this task
 * does not edit. Declared as a duck-typed structural interface, tested
 * with a plain fake object cast, so this adapter is provably correct
 * today and needs no change the day a real `DaemonClient` grows a
 * compatible `forkAgent` (the disclosed gap `use-edit-from-here.ts`'s
 * own module doc names).
 *
 * WHAT THIS MEANS IN PRODUCTION TODAY (recorded at the P6-W4 merge gate,
 * where T105's commit message read as if this ran): `packages/client/src`
 * contains zero `forkAgent`/`cloneAgent` occurrences, so `hasForkAgent`
 * is false for every real `DaemonClient` and this function returns
 * `undefined` on every production render. Consequences, all verified:
 *
 * - GATING DECISION SETTLED (T114, correcting the P6-W6 premise that this
 *   was waiting on T110 — T110 landed at `5806cff` and never could have
 *   unblocked this: `grep -ciE "fork_agent|clone_agent|rename_agent"` over
 *   `packages/protocol/src/messages.ts` and
 *   `packages/server/src/server/session.ts` both return `0`, no task owns
 *   adding the six schemas T110 itself named, and none is filed). Rather
 *   than ship an ENABLED "Edit from here" button whose only possible
 *   outcome is `use-edit-from-here.ts`'s "Not connected — can't branch
 *   this conversation yet." banner, `EditFromHereSurface` now disables
 *   (never hides) the button on every message whenever its `client` prop
 *   here is `undefined` — see that component's own "Gating decision
 *   (T114)" doc for the full rationale and its test proving the ungated
 *   path (a real `client`) stays fully reachable for the day this
 *   adapter starts returning one.
 * - `openForkedSession`/`useNavigate` below is unreachable until the wire
 *   gap closes: nothing can resolve a fork, so no banner action can fire.
 * - Neither wiring is covered end to end. Re-run at the P6-W4 review
 *   against the committed tree, over the WHOLE apps/web suite rather than
 *   a scoped subset: baseline 134 files / 1201 tests passed; deleting
 *   `client={editFromHereClient}` from the mount below -> 134 / 1201
 *   passed (identical); restoring it and deleting
 *   `onOpenSession={openForkedSession}` -> 134 / 1201 passed (identical
 *   again). The unit tests below prove the adapter's SHAPE, not that the
 *   route ever supplies it a usable client.
 */
interface DaemonClientWithForkAgent {
  forkAgent(
    agentId: string,
    options: { entryId: string; entryIndex?: number; name?: string | null },
  ): Promise<{ agent: { id: string } }>;
}

function hasForkAgent(client: unknown): client is DaemonClientWithForkAgent {
  return !!client && typeof (client as { forkAgent?: unknown }).forkAgent === "function";
}

export function adaptEditFromHereForkClient(
  client: DaemonClient | null,
): EditFromHereForkClient | undefined {
  if (!hasForkAgent(client)) {
    return undefined;
  }
  const forkCapableClient = client;
  return {
    async forkAgent(sessionId, options) {
      const { agent } = await forkCapableClient.forkAgent(sessionId, options);
      return { agentId: agent.id };
    },
  };
}

/**
 * Live-streamed `TranscriptEntry[]` for one session (T53A2), sourced from
 * the same `DaemonClient` `daemon-client-context.tsx` (T53A1) provides.
 *
 * Two independent reads of the same session's timeline exist by design:
 * `SessionResumeScreen` below keeps its own `useResumeSession` call for
 * the route's identity/status/queue-count summary (T27B3's already-built,
 * already-tested surface — untouched here, per this task's "resume ...
 * behaviour is unchanged" acceptance criterion), and this hook keeps a
 * second, purpose-built `TimelineState` — fed forward live — for the
 * transcript itself. Folding the two into one shared fetch would mean
 * reaching into `SessionResumeScreen`'s internals, which is outside the
 * one file (`host-session-screen.tsx`) this task owns.
 *
 * The initial page comes from `createDaemonSessionResumeClient`'s own
 * `resumeSession` (the same bounded `direction: "tail", limit: 200`
 * cold-open window `SessionResumeScreen` already uses), applied
 * immediately (not batched) since it is a one-shot snapshot, not a live
 * push. Every subsequent `agent_stream` push for this session is queued
 * onto a `timeline.TimelineCoalescer` (T45A2) — batched onto this app's
 * real `createBrowserFrameClock()` (T45A3) so a burst of streaming
 * deltas applies as one state transition per frame tick — and never
 * dropped, replaced, or reordered (plan.md §7.4's delta-based-end-to-end
 * contract; see `coalescer.ts`'s own module doc for the verified,
 * concatenation-free wire behaviour this must not contradict).
 *
 * T31B3: those `agent_stream` pushes only ever arrive at all once this
 * hook also calls `client.setAgentTimelineSubscription([sessionId])` --
 * see the effect body's own comment for the empirically-confirmed daemon
 * behaviour (`session.ts`'s `usesSelectiveTimelineDelivery`) that made
 * this necessary; before this task, this hook subscribed to
 * `"agent_stream"` but never registered the session as viewed, so no
 * push for it was ever forwarded.
 *
 * Resolves to an empty entry list (not an error) whenever there is no
 * live `client` yet — `Transcript`'s own empty state already covers that
 * case, matching this app's "absence of a connection is a normal state"
 * convention (T53A1).
 */
function useSessionTranscriptEntries(
  client: DaemonClient | null,
  sessionId: string,
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
   * extra `resumeSession` call and an idempotent re-subscribe) is what
   * closes that gap.
   */
  connectionStatus: string,
): readonly coreTimeline.TranscriptEntry[] {
  const [entries, setEntries] = useState<readonly coreTimeline.TranscriptEntry[]>([]);
  // Guards a resume response that resolves after this effect's own
  // cleanup already ran (session switched, or the client changed out
  // from under it) from ever reaching a disposed coalescer.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setEntries([]);

    if (!client) {
      return;
    }

    const frameClock = createBrowserFrameClock();
    const coalescer = new coreTimeline.TimelineCoalescer(
      frameClock,
      coreTimeline.createEmptyTimelineState(),
    );

    const unsubscribeState = coalescer.subscribe((state) => {
      if (generationRef.current !== generation) return;
      setEntries(coreTimeline.buildTranscriptView(state).entries);
    });

    const unsubscribeStream = client.on("agent_stream", (message) => {
      if (message.payload.agentId !== sessionId) return;
      coalescer.push(message);
    });

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
    if (client.getLastServerInfoMessage()) {
      client.setAgentTimelineSubscription([sessionId]).catch(() => {});
    }
    // T31B4 additionally re-runs this whole effect when the connection
    // status changes (see the `connectionStatus` parameter's own doc
    // comment): the listener above covers the handshake completing while
    // this screen stays mounted, and the extra run covers a fresh
    // `resumeSession` snapshot for the newly live connection.

    const resumeClient = createDaemonSessionResumeClient(client);
    resumeClient
      .resumeSession(sessionId)
      .then((result) => {
        if (generationRef.current !== generation) return;
        coalescer.applyImmediate(() => result.timeline);
      })
      .catch(() => {
        // `SessionResumeScreen`'s own controller already surfaces a
        // resume failure (retryable error state); this hook only feeds
        // the transcript view and has nothing further to show beyond
        // leaving it empty.
      });

    return () => {
      unsubscribeServerInfo();
      unsubscribeStream();
      unsubscribeState();
      coalescer.dispose();
      client.setAgentTimelineSubscription([]).catch(() => {
        // Best-effort: dropping this session's live-view registration on
        // navigation away is a courtesy, not a correctness requirement --
        // the next screen this client visits (if any) replaces the set
        // itself.
      });
    };
  }, [client, sessionId, connectionStatus]);

  return entries;
}

/**
 * `/h/:serverId/session/:agentId` screen body (T27S2 placeholder,
 * T27B3 real resume route, T28B3 mounts the real composer, T28B7 mounts
 * the real approvals surface, T53A2 mounts the real transcript and wires
 * every surface here to the live `DaemonClient`).
 *
 * T27B3 owns the resume half: `SessionResumeScreen` cold-opens the
 * session, restores its timeline and queued submissions, and renders
 * the route's `Section title="Session"` identity header plus the
 * loading/error/ready states. T28B3 owns the composer half:
 * `ComposerContainer` mounts the real composer (send, steer,
 * follow-up, abort, queue controls) wired to this app's real
 * `platform.clock`/`platform.structuredStorage`. T28B7 owns the
 * approvals half: `ApprovalsContainer` mounts the permission/approval
 * dialog surface (blocking Pi tool/plan/mode requests and Tier-1
 * extension dialogs, plan.md §11.2/§12.3) over the same session, and
 * renders nothing at all while no request is pending — see its own doc
 * comment.
 *
 * The transcript region (plan.md §8.3) is `features/transcript/`'s
 * separately owned, separately tested surface (T28A-family, T52A3); it was
 * fully built and tested but mounted by no screen until this task. It
 * renders here, above the composer, fed by `useSessionTranscriptEntries`
 * above — this is now the full three-region-column layout plan.md §8.3
 * describes for the centre column (transcript, then composer).
 *
 * Every surface below is given the live `client` `useDaemonClient()`
 * (T53A1) resolves once a `DaemonClient` connection exists: the resume
 * half (`SessionResumeScreen`'s `client` prop, via
 * `createDaemonSessionResumeClient`), the approvals half
 * (`ApprovalsContainer`'s `client` prop — a real `DaemonClient` already
 * structurally satisfies `DaemonPermissionsSource` as-is, see that
 * module's doc comment), and the composer half (`ComposerContainer`'s
 * `client` prop, via `createDaemonAgentTurnClient`). Absent a
 * connection, every prop below resolves to `undefined`/a fixture
 * fallback exactly as before this task — each adapter's own fixture
 *
 * **T284 mount**: `EditFromHereSurface`'s `resolveImageSrc` prop used to
 * be omitted entirely, so every message attachment (a phone photo sent
 * from `apps/android`, or vice versa) always rendered
 * `MessageAttachments`' honest reference-card fallback, never the image
 * itself — `message-attachments.tsx`'s own module doc names this as the
 * one thing still missing once T283 shipped the daemon capability. This
 * route now supplies a real one via `useAttachmentImageResolver`
 * (`../../features/transcript/attachment-image-resolver.js`), fed the
 * live `client`, this route's own `agentId`, `transcriptEntries` (the
 * exact same live list `EditFromHereSurface` already renders — no second
 * subscription), and `downloadOrigin` — this route's own new derivation,
 * off `hostController.getCurrentProfile()`/`info.kind`, of the connected
 * daemon's direct HTTP origin. `downloadOrigin` is `null` (so every image
 * still falls back to the reference card, truthfully) whenever there is
 * no connection yet or the active connection is a relay pairing, which
 * has no direct HTTP endpoint to derive one from at all — see
 * `attachment-image-resolver.ts`'s module doc for why that is this
 * capability's real, by-design boundary rather than a gap this task left
 * open.
 * test already proves its real wire round trip independent of when this
 * wiring lands.
 */
export function HostSessionScreen() {
  const { serverId, agentId } = routeApi.useParams();
  const { client, info, hostController } = useDaemonClientContext();
  const { platform } = useCore();
  const navigate = useNavigate();

  const sessionResumeClient = useMemo(
    () => (client ? createDaemonSessionResumeClient(client) : undefined),
    [client],
  );
  const agentTurnClient = useMemo(
    () => (client ? createDaemonAgentTurnClient(client) : undefined),
    [client],
  );
  const editFromHereClient = useMemo(() => adaptEditFromHereForkClient(client), [client]);

  const transcriptEntries = useSessionTranscriptEntries(client, agentId, info.status);

  // T284: `hostController.getCurrentProfile()` is a synchronous getter,
  // not itself part of the `info` snapshot `useDaemonClientContext()`
  // hands back — but it changes exactly when `info.profileId`/`info.kind`
  // do (both are read off the same `HostController` generation), so those
  // are this memo's real dependencies. `null` (no direct HTTP origin) on
  // a relay connection or with no connection yet — see
  // `attachment-image-resolver.ts`'s module doc for why that is a real,
  // by-design limitation rather than a gap this task left open.
  const downloadOrigin = useMemo(
    () => resolveDirectHttpOrigin(hostController?.getCurrentProfile() ?? null, info.kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hostController.getCurrentProfile()` is read fresh; `info.profileId`/`info.kind` are what actually change.
    [hostController, info.profileId, info.kind],
  );
  const resolveImageSrc = useAttachmentImageResolver({
    client,
    agentId,
    downloadOrigin,
    entries: transcriptEntries,
  });

  function openForkedSession(outcome: EditFromHereOutcome): void {
    void navigate({
      to: "/h/$serverId/session/$agentId",
      params: { serverId, agentId: outcome.newSessionId },
    });
  }

  return (
    <>
      <SessionResumeScreen serverId={serverId} agentId={agentId} client={sessionResumeClient} />
      <EditFromHereSurface
        sessionId={agentId}
        entries={transcriptEntries}
        clock={platform.clock}
        client={editFromHereClient}
        resolveImageSrc={resolveImageSrc}
        onOpenSession={openForkedSession}
        testId="host-session-transcript"
      />
      <ApprovalsContainer sessionId={agentId} client={client ?? undefined} />
      <ComposerContainer sessionId={agentId} client={agentTurnClient} />
    </>
  );
}
