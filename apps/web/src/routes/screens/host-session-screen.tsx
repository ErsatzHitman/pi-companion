import { useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import { composer as coreComposer } from "@picompanion/frontend-core";

import { useCore } from "../../app/core-context.js";
import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { ApprovalsContainer } from "../../features/approvals/index.js";
import { ComposerContainer } from "../../features/composer/index.js";
import { createDaemonAgentTurnClient } from "../../features/composer/index.js";
import { createPiUiComposerDraftSource } from "../../features/composer/index.js";
import { createReferenceFileSource } from "../../features/composer/index.js";
import { resolveTranscribeClient } from "../../features/composer/index.js";
import { useSessionContextTelemetry } from "../../features/composer/index.js";
// FIX-W8: not re-exported through `../../features/composer/index.js` —
// imported directly from its own module, the same "new file, direct
// import" choice this task's other composer-owned imports above make.
import { usePendingOutboxResume } from "../../features/composer/use-pending-outbox-resume.js";
import { usePiUiSession } from "../../features/extensions/pi-ui-session-context.js";
import {
  PiExtensionInlineStack,
  PiExtensionScreenHost,
  PiExtensionSheetHost,
} from "../../features/extensions/placements/index.js";
import { createDaemonSessionResumeClient } from "../../features/sessions/index.js";
import { recordForkRelationship } from "../../features/sessions/session-fork-registry.js";
import { SessionResumeScreen } from "../../features/sessions/SessionResumeScreen.js";
import {
  resolveDirectHttpOrigin,
  useAttachmentImageResolver,
} from "../../features/transcript/attachment-image-resolver.js";
import {
  adaptEditFromHereForkClient,
  EditFromHereSurface,
  RecoveredTurnBanner,
  useRecoveredTurns,
  useSessionTranscriptEntries,
} from "../../features/transcript/index.js";
import { RewindDialog, useRewindToHere } from "../../features/transcript/rewind/index.js";
import { selectLatestTodoEntry, TodoDock } from "../../features/transcript/index.js";
import type { EditFromHereOutcome } from "../../features/transcript/index.js";
import { OfflineTranscriptBanner } from "../../features/transcript/OfflineTranscriptBanner.js";

const routeApi = getRouteApi("/h/$serverId/session/$agentId");

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
 * The three non-rail Pi UI placement destinations also mount here, fed by
 * the one live store `root-route.tsx`'s `PiUiSessionProvider` owns: the
 * `screen` region (`PiExtensionScreenHost`, §11.5's "`screen` owns a
 * route" — web renders it in this session route's screen area, below the
 * header), the `sheet` host (`PiExtensionSheetHost`, a modal `Sheet`),
 * and the transcript-adjacent `inline` stack (`PiExtensionInlineStack`,
 * above the composer, the same slot the todo dock occupies). The right
 * rail's pinned/status strips read the same store through that provider.
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

  // The one live Pi UI store/controller for this session, owned by
  // `root-route.tsx`'s `PiUiSessionProvider`. The right rail (pinned/status)
  // and the three placement hosts below (screen/sheet/inline) all read this
  // same value, so there is one subscription and one action controller for
  // the session rather than one per destination.
  const piUiSession = usePiUiSession();

  // The composer-kind accept path: the live session's own
  // actionController/store narrowed to the draft source the composer
  // subscribes to, so accepting a proposal fills the live draft (and
  // undo restores it). Bound methods — both read `this` — memoized on
  // the session value, which is stable per agent.
  const piUiComposerDrafts = useMemo(
    () =>
      piUiSession
        ? createPiUiComposerDraftSource({
            agentId: piUiSession.agentId,
            subscribe: piUiSession.actionController.subscribe.bind(piUiSession.actionController),
            getElement: piUiSession.store.getElement.bind(piUiSession.store),
          })
        : undefined,
    [piUiSession],
  );

  const sessionResumeClient = useMemo(
    () => (client ? createDaemonSessionResumeClient(client) : undefined),
    [client],
  );
  const agentTurnClient = useMemo(
    () => (client ? createDaemonAgentTurnClient(client) : undefined),
    [client],
  );
  // T389: `@file` completion reads the daemon's existing `listDirectory`
  // (`FileBrowserClient`), walked lazily and bounded by
  // `createReferenceFileSource`. `undefined` with no connection, so the `@`
  // list offers only skills rather than inventing paths.
  const fileReferenceSource = useMemo(
    () => (client ? createReferenceFileSource(client) : undefined),
    [client],
  );
  const editFromHereClient = useMemo(() => adaptEditFromHereForkClient(client), [client]);
  // FIX-W6: the same `platform.structuredStorage`/`platform.clock`
  // singleton `ComposerContainer` feeds `useComposer`'s own outbox (both
  // come from this one `useCore()` value) — so a submission
  // `use-composer.ts` parks in `awaiting-confirmation` is visible through
  // this instance too; see `use-recovered-turns.ts`'s own doc comment for
  // why a second `OutboxController` object over the same storage is not a
  // second data source.
  const recoveredTurnOutbox = useMemo(
    () => new coreComposer.OutboxController(platform.structuredStorage, platform.clock),
    [platform.structuredStorage, platform.clock],
  );
  const { turns: recoveredTurns, refresh: refreshRecoveredTurns } = useRecoveredTurns(
    recoveredTurnOutbox,
    agentId,
    platform.clock,
  );
  // FIX-W8: `confirmResend` (driven by `RecoveredTurnBanner`'s Resend
  // action, via `confirmRecoveredTurn`) only flips a parked entry's status
  // back to `pending` — nothing pushed it over the wire until this hook.
  // Fed the same `agentTurnClient`/`recoveredTurnOutbox` this route already
  // builds, so a resend reuses the exact wire path (and the exact
  // `clientMessageId`) a fresh send would. `info.status` also triggers a
  // resend pass on every reconnect, mirroring Android's
  // `resumePendingTurnOutboxEntries` (`apps/android/src/app-shell/core.ts`).
  const pendingOutboxResume = usePendingOutboxResume({
    client: agentTurnClient,
    sessionId: agentId,
    outbox: recoveredTurnOutbox,
    connectionStatus: info.status,
  });
  // T277 web close: thread the live `DaemonClient`'s own
  // `transcribeVoiceClip` as the composer's `transcribeClient` (the web
  // equivalent of Android's T282 `resolveTranscribeClient` off
  // `AppCore.connection` — here the equivalent live client is
  // `useDaemonClientContext()`'s `client`). `undefined` with no
  // connection, so a future clip reports transcription-unavailable
  // truthfully instead of a fake transcript.
  const transcribeClient = useMemo(() => resolveTranscribeClient(client), [client]);

  // T395: bumping this re-runs the transcript effect above, which re-resumes
  // from the daemon — a files-only rewind changes no timeline row, so the
  // screen asks for one authoritative re-read rather than assuming.
  const [rewindRefreshNonce, setRewindRefreshNonce] = useState(0);

  const { entries: transcriptEntries, cachedAt: transcriptCachedAt } = useSessionTranscriptEntries({
    client,
    sessionId: agentId,
    connectionStatus: info.status,
    storage: platform.structuredStorage,
    clock: platform.clock,
    refreshNonce: rewindRefreshNonce,
  });

  // T395: the rewind surface's own state and local undone-turns record. The
  // transcript above is re-resumed after a success through `refreshNonce`,
  // because a rewind changes history server-side.
  const rewindController = useRewindToHere({
    sessionId: agentId,
    entries: transcriptEntries,
    client,
    // The transcript's only "a turn is in flight" signal available here: an
    // optimistic user row not yet reconciled. The dialog explains the gate
    // rather than sending a request the daemon refuses.
    turnRunning: transcriptEntries.some((entry) => entry.pending),
    onRewound: () => setRewindRefreshNonce((current) => current + 1),
  });

  // T393: honest offline banner. `OfflineTranscriptBanner` returns nothing
  // while connected (or with nothing to show), so the transcript only ever
  // carries it — never a fabricated last-seen time — when it is really
  // rendering off cached rows, per plan.md §12.5.

  // T386: the todo dock above the composer reads the same live entry list
  // the transcript does (plan.md §8.3's centre column) — the latest `todo`
  // entry the session has emitted, or nothing at all when it never has.
  // `transcript.tsx` deliberately keeps `todo` out of the scrolling
  // transcript so the list is rendered once, here, where the mockup pins
  // it (`.dock-todo` above `.prompt`).
  const latestTodoEntry = useMemo(
    () => selectLatestTodoEntry(transcriptEntries),
    [transcriptEntries],
  );

  // T386: the composer's context ring reads the same derivation the right
  // rail's `ContextMeter` does (`root-route.tsx`), from this route's own
  // `DaemonClient` subscription — the composer's narrower turn client has
  // no usage stream of its own.
  const contextTelemetry = useSessionContextTelemetry(client, agentId);

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

  // Fork-lands-as-root: record the transcript fork in the shared registry
  // (`features/sessions/session-fork-registry.ts`) so `SessionsScreen`'s
  // own `handleForked`/`buildSessionTree` re-resolves the same fork under
  // its real parent on its next mount, instead of rendering it as a root.
  function openForkedSession(outcome: EditFromHereOutcome): void {
    recordForkRelationship(outcome.newSessionId, {
      kind: "fork",
      parentId: outcome.sourceSessionId,
      forkPoint: outcome.forkPoint,
    });
    void navigate({
      to: "/h/$serverId/session/$agentId",
      params: { serverId, agentId: outcome.newSessionId },
    });
  }

  return (
    <>
      <SessionResumeScreen serverId={serverId} agentId={agentId} client={sessionResumeClient} />
      {piUiSession ? (
        <>
          {/* plan.md §11.5: `screen` owns a route; web mounts it in this
              session route's own screen area, below the session header. */}
          <PiExtensionScreenHost
            elements={piUiSession.elements}
            agentId={piUiSession.agentId}
            actionController={piUiSession.actionController}
            revision={piUiSession.revision}
          />
          {/* plan.md §11.5: `sheet` opens a focused panel. A modal host;
              it renders nothing until a sheet-placement element arrives. */}
          <PiExtensionSheetHost
            elements={piUiSession.elements}
            agentId={piUiSession.agentId}
            actionController={piUiSession.actionController}
            revision={piUiSession.revision}
          />
        </>
      ) : null}
      <OfflineTranscriptBanner
        connected={info.status === "connected"}
        hasEntries={transcriptEntries.length > 0}
        cachedAt={transcriptCachedAt}
        now={platform.clock.now()}
        testId="session-offline-banner"
      />
      <RecoveredTurnBanner
        turns={recoveredTurns}
        outbox={recoveredTurnOutbox}
        onResendConfirmed={() => void pendingOutboxResume.resumePending()}
        onChange={refreshRecoveredTurns}
        testId="host-session-recovered-turn"
      />
      <EditFromHereSurface
        sessionId={agentId}
        entries={transcriptEntries}
        clock={platform.clock}
        client={editFromHereClient}
        resolveImageSrc={resolveImageSrc}
        onRewindToHere={rewindController.requestRewind}
        rewindToHereDisabled={!rewindController.enabled}
        onOpenSession={openForkedSession}
        testId="host-session-transcript"
      />
      <RewindDialog
        {...rewindController.dialog}
        onSelectMode={rewindController.selectMode}
        onClose={rewindController.close}
        onSubmit={rewindController.submit}
        onRestoreAnyway={rewindController.restoreAnyway}
        onReturnToTurn={rewindController.returnToTurn}
        testId="session-rewind-dialog"
      />
      <ApprovalsContainer sessionId={agentId} client={client ?? undefined} />
      {latestTodoEntry ? <TodoDock entry={latestTodoEntry} testId="session-todo-dock" /> : null}
      {/* plan.md §11.5: `inline` becomes a transcript-adjacent card. Mounted
          here, beside the transcript, rather than inside it —
          `transcript.tsx` deliberately excludes extension entries from its
          own scroll, so this footer stack above the composer is the
          session column's transcript-adjacent slot. */}
      {piUiSession ? (
        <PiExtensionInlineStack
          elements={piUiSession.elements}
          agentId={piUiSession.agentId}
          actionController={piUiSession.actionController}
          revision={piUiSession.revision}
        />
      ) : null}
      <ComposerContainer
        sessionId={agentId}
        serverId={serverId}
        client={agentTurnClient}
        // T293: a real `DaemonClient` satisfies `DaemonEditorTextSource`
        // structurally (`daemon-editor-text-client.ts`) — passed directly,
        // same as `ApprovalsContainer`'s `client` above.
        editorTextClient={client ?? undefined}
        // T386: the ring's derived context-window telemetry.
        contextTelemetry={contextTelemetry}
        // UI-W11: a real `DaemonClient` satisfies `DaemonSessionCostClient`
        // structurally (`daemon-session-cost-client.ts`'s own doc) —
        // passed directly, same as `editorTextClient` above, so the
        // context ring's sheet can mount `SessionCostMeterContainer`
        // alongside `ContextMeter`.
        sessionCostClient={client ?? undefined}
        // T389: `@file` candidates from the connected daemon.
        fileReferenceSource={fileReferenceSource}
        // Pi UI `composer`-kind accept/undo fills and restores the live
        // draft through the session's own action controller and store.
        piUiComposerDrafts={piUiComposerDrafts}
        transcribeClient={transcribeClient}
      />
    </>
  );
}
