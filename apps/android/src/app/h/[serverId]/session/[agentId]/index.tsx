import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useWindowDimensions } from "react-native";

import { timeline as coreTimeline } from "@picompanion/frontend-core";

import { CompactSessionShell } from "../../../../../app-shell/compact-shell";
import {
  ApprovalsContainer,
  type DaemonPermissionsSource,
} from "../../../../../features/approvals";
import {
  Composer,
  createExpoAttachmentSourcePort,
  createExpoCameraCapturePort,
} from "../../../../../features/composer";
import { useConnectionStatus } from "../../../../../features/connect";
import {
  PiUiElementView,
  PinnedLiveExtensionArea,
  resolvePinnedAreaVisibility,
  usePiUiElements,
} from "../../../../../features/extensions/registry-index";
import { resolveComposerSlotMaxHeightDp } from "../../../../../app-shell/composer-slot-cap-model";
import { selectSheetPlacementElements } from "../../../../../app-shell/sheet-extension-model";
import {
  RecoveredTurnBanner,
  TranscriptHeader,
  TranscriptMessageRow,
  TranscriptStatusStrip,
  TranscriptThinkingRow,
  TranscriptToolCallRow,
  TranscriptWindowList,
  createTranscriptMessageBatcher,
  fireTranscriptStatusHaptic,
  selectRecoveredTurnsForSession,
  useAgentCwd,
  useAttachmentImageResolver,
  type AwaitingConfirmationTurn,
  type TranscriptStatus,
} from "../../../../../features/transcript";
import { buildDaemonHttpOrigin } from "../../../../../features/connect/daemon-connection-store.js";
import { deriveSessionRouteStatus } from "../../../../../app-shell/session-route-model";
import { createContextUsageSignal } from "../../../../../features/telemetry";
import type { AgentUsage } from "@picompanion/protocol/agent-types";
import {
  pressSessionList,
  pressSessionLive,
} from "../../../../../app-shell/session-nav-actions-model";
import {
  buildSessionTranscriptEntries,
  type SessionTranscriptEntry,
} from "../../../../../app-shell/session-transcript-model";
import {
  createTurnRunningSignal,
  type ConnectionStatusSource,
  type DaemonTurnStreamSource,
} from "../../../../../features/sessions/turn-running-signal.js";
import {
  describeTimelineStaleness,
  type StalenessAnnouncement,
} from "../../../../../platform/offline";
import { Banner } from "../../../../../ui/primitives";
import { useAppCore } from "../../../../core-context";
import {
  resolveAgentSnapshotClient,
  resolveAgentUsageClient,
  resolveAttachmentDownloadClient,
  resolveEditorTextClient,
  resolveModelThinkingClient,
  resolveQueueModeClient,
  resolveSessionControlsClient,
  resolveSlashCommandsClient,
  resolveTranscribeClient,
  resolveTurnStatusClient,
} from "../../../../../app-shell/session-route-daemon-clients";

function handleMicPress() {}
function handleAttachPress() {}

/**
 * The `transcript` slot's content (T32S3, item (1); interleaving added
 * by T32S4, item (1)) — the verbatim defect T32S3 closed for message
 * rows: T33A2 built `TranscriptMessageRow`/`createTranscriptMessageBatcher`
 * and nothing rendered it. T32S3 then left `TranscriptThinkingRow`
 * (T33A3) unreachable on top of that, disclosed as this file's own next
 * gap — closed here.
 *
 * Constructs one batcher per mount, over the real `AppFrameClock`
 * (`../../../../../platform/frame-clock.ts`, via `AppCore["lifecycle"]`
 * so pacing matches this process's own foreground/background state —
 * see that module's doc comment). Rather than
 * `TranscriptMessageBatcher.getMessageEntries()`/`subscribe()` (which
 * both narrow to just `user-message`/`assistant-message` rows, per that
 * module's own doc comment), this reads `batcher.getState()` and
 * projects it through `coreTimeline.buildTranscriptEntries` +
 * `../../../../../app-shell/session-transcript-model.ts`'s
 * `buildSessionTranscriptEntries` — the pure, unit-tested
 * (`session-transcript-model.test.ts`) decision of
 * which entry kinds this route renders and in what order — then maps
 * each kept entry to `TranscriptThinkingRow`, `TranscriptToolCallRow`
 * (T32S6: an unknown tool reaches the latter's own safe generic card,
 * same as `tool-call-row.test.ts` proves in isolation, now through this
 * live path), or `TranscriptMessageRow` by its own `kind`, preserving
 * `buildTranscriptEntries`'s single chronological ordering rather than
 * rendering each kind as its own separate list.
 *
 * T32S8 closes the "no live `DaemonClient` push feeding this batcher's
 * `push()`" gap this comment used to disclose: every mount now also
 * subscribes to `AppCore.subscribeAgentStream` (`../../../../../app-shell/
 * core.ts`) and forwards each message straight to `batcher.push(...)` —
 * the exact same wire subscription that already feeds `piUiSession.store`
 * (see that field's doc comment), not a second one. Until a real daemon
 * actually sends an `agent_stream` message this still renders empty in
 * production; what changed is that the batcher is reachable at all, not
 * that a transcript has been proven on a device (T37/T59 still own that).
 *

 * T32S7 adds one more real-but-empty read off the same `batcher.getState()`:
 * `platform/offline/stale-announcement.ts`'s `describeTimelineStaleness`
 * (T37B), fed `state.stale`/`state.gap` on every batch the same way
 * `entries` already is, rendered as a `Banner` (never a colour-only cue,
 * matching that module's own "a full sentence" requirement) above the
 * list. `createEmptyTimelineState()` (this batcher's initial state,
 * `packages/frontend-core/src/timeline/types.ts`) always has `stale:
 * false`, and nothing in this wave ever calls the reducer's
 * `restoreCachedTimeline` to flip it — so this banner is real wiring
 * over a real (always-empty-today) state, exactly like `entries` itself,
 * not a live announcement anyone can observe yet. Full `OfflineCache`/
 * `SqliteStructuredStorage` construction (the piece that WOULD populate
 * `stale: true` from a real cache restore) stays blocked on the
 * unavailable `expo-sqlite` install named in `platform/offline/
 * index.ts`'s own doc comment; this route changes nothing about that.
 *
 * **T32S10 mount**: the plain, unwindowed `ScrollView` over
 * `entries.map` is gone. T33A6's `TranscriptWindowList`
 * (`features/transcript/transcript-window.tsx`) now bounds how many
 * rows are actually mounted — see that module's own doc comment for the
 * O(window) guarantee and the "Show N earlier"/"Jump to latest" reachability
 * controls — while `renderRow` below is the *exact same* per-kind switch
 * this route already had, receiving the *exact same*
 * `session-transcript-row-${entry.id}` testId (`TranscriptWindowList`
 * builds it as `${testId}-row-${entry.id}` off this component's own
 * `testId="session-transcript"`), so every attachment/diff/accessible
 * name a child row derives from that testId is unchanged.
 *
 * **T95 mount**: `AppCore.turnOutbox.getRecoveredTurns()` (T76,
 * `../../../../../app-shell/core.ts`) used to have no reader anywhere in
 * this repository — a turn recovered `"awaiting-confirmation"` after a
 * simulated process death was a real value nothing displayed. This
 * component now reads it once `turnOutbox.open()` settles (idempotent —
 * the same promise `createAppCore()` already kicked off, see
 * `TurnOutboxOwner.open()`'s own doc comment), narrows it to this
 * route's own `agentId` via `selectRecoveredTurnsForSession`
 * (`../../../../../features/transcript/recovered-turn-model.ts`), and
 * renders each row through `RecoveredTurnBanner`.
 *
 * **T121**: this mount now passes `core.turnOutbox.getOutbox() ?? undefined`
 * as `RecoveredTurnBanner`'s `outbox` prop, so a recovered
 * `"awaiting-confirmation"` row gets real Resend/Discard actions (T106
 * gave the component that capability — see its own doc comment).
 * `SessionRoute` below passes the exact same `core.turnOutbox.getOutbox()`
 * value to `Composer`'s own `outbox` prop, so both mount points now read
 * off the ONE `TurnOutboxOwner`-owned `OutboxController` instance rather
 * than `Composer` falling back to a private one of its own (see
 * `ComposerProps.outbox`'s own doc comment in
 * `../../../../../features/composer/Composer.tsx`, and this task's
 * report for the counting-fake proof that one instance now serves both
 * a composer-style `enqueue`/`markFailed` and a banner-style
 * `confirmResend` call).
 *
 * Still renders no actions on a real device today, and still renders
 * nothing when there is nothing recovered, which is every production
 * run today: `createUnavailableSqliteDriverFactory()` lands `turnOutbox`
 * in `"degraded"` before any real SQLite file is ever opened (no
 * `expo-sqlite` install this wave — run
 * `npm install expo-sqlite@~16.0.10 --workspace=@picompanion/android`
 * to close that, per `../../../../../platform/offline/sqlite-driver-
 * factory.ts`'s own doc comment), so `getOutbox()`/`getRecoveredTurns()`
 * return `null` in production, not a real instance or an empty array
 * reached by a real recovery pass — see that field's own doc comment.
 * Wiring the prop through anyway (rather than leaving it disconnected
 * until `expo-sqlite` lands) is deliberate: T106's report and this
 * task's brief both say to close the wiring gap now and state the
 * `expo-sqlite` blocker plainly, not to make the gap invisible by
 * leaving the prop unpassed.
 *
 * **T284 mount.** `TranscriptMessageRow` used to get no `resolveImageUri`
 * prop at all, so a message attachment (a phone photo sent from
 * `apps/web`, or vice versa) always rendered `MessageAttachments`' honest
 * reference-card fallback, never the image itself —
 * `message-attachments-model.ts`'s own module doc named this as the one
 * thing still missing once T283 shipped the daemon capability. This
 * component now resolves one via `useAttachmentImageResolver`
 * (`../../../../../features/transcript`), fed
 * `resolveAttachmentDownloadClient(core.connection)` (the fourth
 * `resolve*Client` narrowing of the same live `DaemonClient`
 * `queueModeClient`/`turnStatusClient`/`transcribeClient` already read,
 * `../../../../../app-shell/session-route-daemon-clients.ts`), this
 * component's own `entries`, and a `downloadOrigin` derived the identical
 * way the files route (`../[agentId]/files/[...path].tsx`) already
 * derives its own: `useConnectionStatus(core.connection).daemonAddress`
 * through `buildDaemonHttpOrigin`. `downloadOrigin` is `null` — so every
 * image still falls back to the reference card, truthfully — on a
 * relay-paired connection (no direct HTTP endpoint to fetch a token URL
 * from, the identical limitation that route's own doc comment names) or
 * with no connection yet.
 */
function SessionTranscript({ status, agentId }: { status: TranscriptStatus; agentId: string }) {
  const core = useAppCore();
  const batcher = useMemo(
    () =>
      createTranscriptMessageBatcher({
        lifecycle: core.lifecycle,
        requestAnimationFrame: (callback) => requestAnimationFrame(callback),
        cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
        clearTimeout: (handle) => clearTimeout(handle),
        now: () => Date.now(),
      }),
    [core.lifecycle],
  );
  const readEntries = () =>
    buildSessionTranscriptEntries(coreTimeline.buildTranscriptEntries(batcher.getState()));
  const readStaleness = (): StalenessAnnouncement | null => {
    const state = batcher.getState();
    return describeTimelineStaleness({ stale: state.stale, gap: state.gap });
  };
  const [entries, setEntries] = useState<SessionTranscriptEntry[]>(() => readEntries());
  const [staleness, setStaleness] = useState<StalenessAnnouncement | null>(() => readStaleness());

  useEffect(() => {
    setEntries(readEntries());
    setStaleness(readStaleness());
    // `batcher.subscribe`'s own argument is filtered to just
    // `CoreMessageEntry[]` (see this component's doc comment), so this
    // listener ignores it and re-derives the full interleaved list (and
    // the staleness announcement) from `batcher.getState()` fresh on
    // every applied batch instead.
    const unsubscribeBatcher = batcher.subscribe(() => {
      setEntries(readEntries());
      setStaleness(readStaleness());
    });
    // T32S8: forwards every live `agent_stream` message to this mount's
    // batcher — see this component's doc comment for why this is the
    // same wire subscription `piUiSession.store` is fed from, not a
    // second one.
    const unsubscribeAgentStream = core.subscribeAgentStream((message) => {
      batcher.push(message);
    });
    return () => {
      unsubscribeBatcher();
      unsubscribeAgentStream();
      batcher.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batcher]);

  // T95: `turnOutbox.getRecoveredTurns()` only reports real values once
  // `open()`'s one cold-start `recoverInFlightTurns` pass has settled —
  // see this component's doc comment. `open()` is idempotent (returns
  // the same promise `createAppCore()` already kicked off), so calling
  // it again here just observes that settle rather than starting a
  // second one.
  const readRecoveredTurns = (): AwaitingConfirmationTurn[] =>
    selectRecoveredTurnsForSession(core.turnOutbox.getRecoveredTurns(), agentId);
  const [recoveredTurns, setRecoveredTurns] = useState<AwaitingConfirmationTurn[]>(() =>
    readRecoveredTurns(),
  );
  useEffect(() => {
    let cancelled = false;
    void core.turnOutbox.open().then(() => {
      if (!cancelled) {
        setRecoveredTurns(readRecoveredTurns());
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core.turnOutbox, agentId]);

  // P5-W13 merge gate: fires the "finished"/"error" §9.3 haptic triggers
  // (plan.md §9.3) off this route's own `TranscriptStatus` transitions.
  // T33A6 built and mutation-tested `fireTranscriptStatusHaptic`
  // (`features/transcript/transcript-status-haptics-model.ts`) and filed
  // the mount as a seam back to this file, but its commit landed *after*
  // T32S9's, so T32S9 could not take it and the module shipped with no
  // live importer at all - the same "registration is not receipt" defect
  // this wave's own checklist names. Nothing here was blocked on an
  // install: `AppCore.vibrationPlatform` (T32S9, `app-shell/core.ts`)
  // already wraps React Native's own `Vibration`, and the visible signal
  // this haptic accompanies (`TranscriptStatusStrip`, rendered by
  // `SessionRoute`'s `statusStrip` slot off this same `status`) is
  // already on screen - which is what `fireHaptic`'s `visibleSignal`
  // contract requires.
  //
  // T32S11 (P5-W16): `hapticsEnabled` used to be hardcoded `true`,
  // matching the identical convention `features/approvals/
  // use-approvals-queue.ts` still has at its own call site (that file is
  // outside this task's `Owns` grant — see this task's report for the
  // exact one-line seam filed against it). This route now reads the real
  // toggle from `AppCore.settings` (T32C1's `SettingsController`,
  // `../../../../../app-shell/core.ts`), the one process-lifetime
  // instance every settings reader shares — never a private read of
  // `keyValueStorage` here. A storage read failure resolves the
  // controller's snapshot to `hapticsEnabled: true` (see
  // `settings-model.ts`'s "default-value rule"), so this still never
  // silently suppresses on a storage hiccup.
  const [hapticsEnabled, setHapticsEnabled] = useState(
    () => core.settings.getSnapshot().hapticsEnabled,
  );
  useEffect(() => {
    const unsubscribe = core.settings.subscribe((snapshot) => {
      setHapticsEnabled(snapshot.hapticsEnabled);
    });
    void core.settings.load();
    return unsubscribe;
  }, [core.settings]);

  const previousStatusRef = useRef<TranscriptStatus | null>(null);
  useEffect(() => {
    fireTranscriptStatusHaptic(
      core.vibrationPlatform,
      hapticsEnabled,
      previousStatusRef.current,
      status,
    );
    previousStatusRef.current = status;
  }, [status, core.vibrationPlatform, hapticsEnabled]);

  // T284: real attachment-image resolution — a fresh read of the same
  // live `DaemonClient` every other `resolve*Client` call on this route
  // narrows (`resolveAttachmentDownloadClient`, `../../../../../app-shell/
  // session-route-daemon-clients.ts`), plus `daemonAddress` off the same
  // `AppCore.connection` snapshot `../[agentId]/files/[...path].tsx`
  // already derives a `downloadOrigin` from for its own `DownloadPanel`.
  // `null` on a relay connection or with no connection yet — every image
  // then renders the honest reference-card fallback
  // (`message-attachments.tsx`), never a broken `<Image>`.
  const attachmentDownloadClient = resolveAttachmentDownloadClient(core.connection);
  const { daemonAddress } = useConnectionStatus(core.connection);
  const downloadOrigin = daemonAddress ? buildDaemonHttpOrigin(daemonAddress) : null;
  const resolveImageUri = useAttachmentImageResolver({
    client: attachmentDownloadClient,
    agentId,
    downloadOrigin,
    entries,
  });

  return (
    <>
      {staleness ? (
        <Banner tone="info" message={staleness.text} testId="session-transcript-staleness" />
      ) : null}
      <RecoveredTurnBanner
        turns={recoveredTurns}
        outbox={core.turnOutbox.getOutbox() ?? undefined}
      />
      <TranscriptWindowList
        entries={entries}
        testId="session-transcript"
        renderRow={(entry, testId) => {
          if (entry.kind === "thinking") {
            return (
              <TranscriptThinkingRow key={entry.id} entry={entry} live={false} testId={testId} />
            );
          }
          if (entry.kind === "tool-call") {
            return <TranscriptToolCallRow key={entry.id} entry={entry} testId={testId} />;
          }
          return (
            <TranscriptMessageRow
              key={entry.id}
              entry={entry}
              streaming={false}
              resolveImageUri={resolveImageUri}
              testId={testId}
            />
          );
        }}
      />
    </>
  );
}

/**
 * The `liveExtension` slot's content (T32S4, item (2)) — T34A4's
 * `PinnedLiveExtensionArea` mounted against T34A5's real
 * `AppCore.piUiSession.store` and `.actionController`
 * (`../../../../../app-shell/core.ts`), never a fake constructed here.
 * `usePiUiElements` (`features/extensions/use-pi-ui-elements.ts`)
 * live-subscribes this one agent's elements/revision out of that store.
 *
 * Still empty in production today — see `AppCore["piUiSession"]`'s doc
 * comment for the two disclosed gaps (no live outbound
 * `pi.ui.action.request` transport in `@picompanion/client` yet, and no
 * live `agent_stream` feed into the store yet) — but the mount itself,
 * and every element that store already holds, are real.
 */
function SessionLiveExtension({ agentId }: { agentId: string }) {
  const core = useAppCore();
  const { elements, revision } = usePiUiElements(core.piUiSession.store, agentId);
  return (
    <PinnedLiveExtensionArea
      elements={elements}
      agentId={agentId}
      actionController={core.piUiSession.actionController}
      revision={revision}
    />
  );
}

/**
 * The second live Pi UI mount point (T32S12, P5-W18 — T37E5's finding at
 * the P5-W17 merge gate): `SessionLiveExtension` above only ever selects
 * `placement === "pinned"` elements (`pinned-model.ts`'s
 * `selectPinnedElements`), so a `panel`-kind element with
 * `placement === "sheet"` — whose own renderer already knows how to open
 * it inside the shared `Sheet` primitive, see `renderers/panel.tsx`'s
 * doc comment — had no selector anywhere in production ever choosing it,
 * making its Sheet mode unreachable on any device.
 *
 * `../../../../../app-shell/sheet-extension-model.ts`'s
 * `selectSheetPlacementElements` is this task's sibling selector,
 * deliberately not folded into `pinned-model.ts` (unowned this wave —
 * see that module's doc comment). Rendered as a sibling of
 * `CompactSessionShell`/`SessionApprovals` below, not inside any named
 * slot: a sheet-placement `panel` renders its own trigger `View` plus a
 * `Sheet` (Portal-based when a `<PortalHost>` is mounted, degrading to
 * inline otherwise — `Sheet.tsx`'s own doc comment), so it needs no slot
 * of its own, the same reasoning `SessionApprovals`'s own doc comment
 * gives for the identical placement choice.
 *
 * Each element still renders through the same per-element
 * `PiUiElementView` pipeline (`registry-index.ts`) every other placement
 * uses — canonical validation, the unknown-kind/no-renderer/invalid-
 * payload/ok decision, a per-element error boundary — this component
 * adds nothing beyond selecting which elements reach it.
 */
function SessionSheetExtensions({ agentId }: { agentId: string }) {
  const core = useAppCore();
  const { elements, revision } = usePiUiElements(core.piUiSession.store, agentId);
  const sheetElements = useMemo(() => selectSheetPlacementElements(elements), [elements]);
  return (
    <>
      {sheetElements.map((element) => (
        <PiUiElementView
          key={element.id}
          element={element}
          agentId={agentId}
          actionController={core.piUiSession.actionController}
          revision={revision}
        />
      ))}
    </>
  );
}

/**
 * Mounts T33B5's `ApprovalsContainer` (T32S7, wave P5-W11 — `features/
 * approvals/` shipped last wave with no live importer; `npx knip` listed
 * `ApprovalsContainer`/`ApprovalsHost`/`use-approvals-queue`/the barrel
 * as unused before this). `sessionId` is this route's own `agentId`, per
 * `ApprovalsContainer.tsx`'s own mount recipe item 2 ("Supply `sessionId`
 * from whatever already identifies the open session (e.g. the session
 * route's `agentId`)"). `<PortalHost>` already wraps `<Stack>` in
 * `app-shell/navigation-shell.tsx` (T32S6), so `Sheet`'s Portal path has
 * a target with no new host needed here — recipe item 4.
 *
 * `client` is the cast that same doc comment's item 3 names and asks
 * the mount point to write: `connection.DaemonClientLike`
 * (`packages/frontend-core/src/connection/daemon-client-lifecycle.ts`)
 * declares six members and neither `respondToPermission` nor `on(...)`,
 * although the real `DaemonClient` returned by `getDaemonClient()` in
 * production has both (both declared on `DaemonClient` in
 * `packages/client/src/daemon-client.ts`).
 * Widening `DaemonClientLike` itself belongs to `frontend-core`, outside
 * this task's `Owns` grant — this cast documents the gap rather than
 * silently working around it; the widening still needs to be filed
 * against `packages/frontend-core`.
 */
function SessionApprovals({ sessionId }: { sessionId: string }) {
  const core = useAppCore();
  const client = core.connection.getActiveLifecycle()?.getDaemonClient() as unknown as
    | DaemonPermissionsSource
    | undefined;
  // T32S9: threads the process-lifetime `AppCore.vibrationPlatform`
  // (`../../../../../app-shell/core.ts`) down so `ApprovalsContainer`
  // fires the "approval"/"blocked" §9.3 haptic triggers for real, rather
  // than leaving `vibrationPlatform` unset (which silently disables
  // both).
  //
  // T32S11 (P5-W16): `ApprovalsContainer`'s own `hapticsEnabled` prop
  // (`ApprovalsContainer.tsx`) was never supplied here, so it fell back
  // to its own `= true` default, which `use-approvals-queue.ts`'s
  // identical `= true` default then repeated a second time -- neither
  // file is in this task's `Owns` grant (see this task's report), but
  // both are only ever reached because *this* call site passed nothing.
  // Supplying the real value here, the same `AppCore.settings` snapshot
  // `SessionTranscript` above reads, closes the gap at its actual root
  // without editing either unowned file.
  const [hapticsEnabled, setHapticsEnabled] = useState(
    () => core.settings.getSnapshot().hapticsEnabled,
  );
  useEffect(() => {
    const unsubscribe = core.settings.subscribe((snapshot) => {
      setHapticsEnabled(snapshot.hapticsEnabled);
    });
    void core.settings.load();
    return unsubscribe;
  }, [core.settings]);
  return (
    <ApprovalsContainer
      sessionId={sessionId}
      client={client}
      vibrationPlatform={core.vibrationPlatform}
      hapticsEnabled={hapticsEnabled}
    />
  );
}

/**
 * `/h/:serverId/session/:agentId` — the "session detail" (transcript)
 * Phase 5 feature family's route stub — T32S1C, wired to its
 * `header`/`statusStrip`/`composer` slot consumers by T32S2, to its
 * `transcript` slot and live connection status by T32S3, and to its
 * interleaved thinking rows and `liveExtension` slot by T32S4.
 *
 * Matches `navigationIntentToPath({ type: "session", serverId, agentId })`
 * exactly. Renders `CompactSessionShell`
 * (`../../../../../app-shell/compact-shell.tsx`, T32S1) with `header`
 * (T33A1's `TranscriptHeader`), `statusStrip` (T33A1's
 * `TranscriptStatusStrip`), `transcript` (`SessionTranscript` above),
 * `liveExtension` (`SessionLiveExtension` above), and `composer` (T33B1's
 * `Composer`) filled.
 *
 * `status`, passed to both `TranscriptHeader` and `TranscriptStatusStrip`,
 * comes from `AppCore.connection` (`../../../../../app-shell/core.ts`)
 * — a live `DaemonConnectionStore` — through `useConnectionStatus` and
 * `deriveSessionRouteStatus` (`../../../../../app-shell/session-route-
 * model.ts`), not a fixed literal. See `core.ts`'s `connection` doc
 * comment for the one disclosed gap still standing between this and a
 * status that reflects a connection a user actually made through
 * `ConnectForm`.
 *
 * `TranscriptHeader`, `TranscriptStatusStrip`, and `Composer` are all
 * pure prop-driven views (see their own doc comments) — none of them
 * reads `useLocalSearchParams` itself. **This** route reads
 * `serverId`/`agentId` and is the one place that derives their props:
 * `serverId` becomes `TranscriptHeader`'s `hostLabel`, `agentId` becomes
 * its `sessionTitle`, `SessionLiveExtension`'s `agentId`, and (T95)
 * `SessionTranscript`'s own `agentId` prop, used to scope which recovered
 * outbox rows it reads.
 *
 * **T32S12 mount (P5-W18)**: `Composer` used to get a fixed
 * `NO_OP_TURN_SERVICE` module-level stand-in ("there is no live daemon
 * this wave to run a real turn against"). T63 built a real `TurnService`
 * (`../../../../../features/sessions/turn-service.js`,
 * `createDaemonTurnService`); this route now gets one from
 * `useAppCore().createTurnService(agentId)` (`app-shell/core.ts`),
 * memoized on `[core, agentId]`.
 *
 * **T32S13 mount (P5-W19)**: `onSubmit` used to be a fixed, module-level
 * `function handleSubmit(_text: string) {}` no-op — "the single most
 * visible gap in the app", per this task's brief: a user typing a
 * message into the composer sent nothing. `handleSubmit` below now
 * calls `core.startTurn(agentId ?? "", text)` (`app-shell/core.ts`,
 * T32S13), which delegates to T63's `startDaemonTurn` over the exact
 * same fresh-read `DaemonTurnTransport` `createTurnService` already
 * uses. A `{ status: "failed" }` result re-throws, so `Composer`'s own
 * existing `handleSend().catch(() => markEntryFailed(...))` path (see
 * `Composer.tsx`'s doc comment) is what surfaces it — this route adds no
 * second error-handling path.
 *
 * **T121 mount**: `Composer` used to get no `outbox` prop at all, so it
 * fell back to constructing its own private `OutboxController`
 * (`ComposerProps.outbox`'s own doc comment in `Composer.tsx`) — a
 * *second* instance from `AppCore.turnOutbox`'s, over separate storage,
 * which is exactly why a composer-sent turn recovered by `turnOutbox`
 * could never be resolved by `RecoveredTurnBanner`'s Resend/Discard
 * actions above. `Composer` below now gets
 * `outbox={core.turnOutbox.getOutbox() ?? undefined}` — the identical
 * expression `SessionTranscript`'s `RecoveredTurnBanner` mount passes,
 * so both read off the one `TurnOutboxOwner`-owned instance. See this
 * task's report for the counting-fake proof and the still-standing
 * `expo-sqlite` blocker (T87) that keeps this `undefined` on every real
 * device today.
 *
 * `Composer.tsx` itself is unowned by this task and untouched: unifying
 * the instance only required the composition root (this file) to pass
 * the prop `Composer` already accepted since T33B7.
 *
 * **T132 mount**: `Composer` used to get no `queueModeClient`/
 * `turnStatusClient` props at all, so `QueueModePicker` rendered its
 * truthful "Connect to a daemon…" unavailable state (no `Select`
 * rendered at all) and `TurnStatusBanner` rendered nothing, on every
 * build — T39C built both surfaces against injected ports and disclosed
 * that no route passed them. `T32A1B` (P5-W6) landed a live
 * `DaemonClientLifecycle` on `AppCore.connection` in the meantime, so
 * this route now resolves both from it via `./session-route-daemon-
 * clients.ts`'s `resolveQueueModeClient`/`resolveTurnStatusClient` — the
 * exact same "fresh-read `connection.getActiveLifecycle()?.
 * getDaemonClient()`, cast to the narrow port the feature needs" pattern
 * `SessionApprovals`'s own `client` prop above already established for
 * `DaemonPermissionsSource`, pulled into its own small, `react-native`-
 * free module so the resolve step itself has a real behavioural proof
 * with a counting fake (`../../../../../app-shell/
 * session-route-daemon-clients.test.ts`) rather
 * than only a source-text one. See that module's own doc comment for
 * why a real `DaemonClient` satisfies both ports as-is, and this task's
 * report for the exact command run to confirm `T32A1B` had actually
 * landed before this task started (`grep -rn "@picompanion/client|
 * DaemonClient" apps/android/src`, historically comments-only — no
 * longer true as of `T32A1B`).
 *
 * **T282 mount**: `Composer` used to get no `transcribeClient` prop
 * either, so a real recording made on a real device (T276's real
 * `expo-audio`-backed `voiceCapture` default, live since that task) hit
 * a dead end: permission was genuinely requested and genuinely granted,
 * and the finished clip then always resolved
 * `"transcription-unavailable"` and was discarded — a user pays a real
 * OS permission for nothing back. This route now resolves
 * `transcribeClient` the identical way as `queueModeClient`/
 * `turnStatusClient` two paragraphs up, via this same
 * `session-route-daemon-clients.ts`'s `resolveTranscribeClient` (its own
 * doc comment argues why the one live `DaemonClient` this route already
 * narrows twice also satisfies `VoiceTranscriptionClient` as-is), so a
 * recording made against a connected daemon now reaches
 * `DaemonClient.transcribeVoiceClip` for real and comes back as
 * editable composer draft text (see `Composer.tsx`'s `transcribeClient`
 * prop doc comment and `../../../../../features/voice/voice-model.ts`'s
 * header for the full path). With no active daemon connection,
 * `transcribeClient` is `undefined` exactly as `queueModeClient`/
 * `turnStatusClient` are, and the mic still shows the honest
 * `"transcription-unavailable"` outcome rather than a silent no-op.
 *
 * **T290 mount.** `attachmentSource`/`cameraCapture` used to remain
 * unset at this mount — the owner had not yet installed
 * `expo-image-picker`/`expo-document-picker`, so `Composer.tsx`'s own
 * `?? createUnavailableAttachmentSourcePort()`/`?? createUnavailable
 * CameraCapturePort()` fallbacks were the only production behaviour,
 * and the attach/camera actions always resolved the honest
 * `"unavailable"` state. The owner ran the install at `488c4dc`
 * (`expo-image-picker@~17.0.11`, `expo-document-picker@~14.0.8`, both
 * the pins this app's own `expo`'s `bundledNativeModules.json` gives),
 * and this task closed the gap: `attachmentSource` and `cameraCapture`
 * are now real ports, memoized once per mount with `useMemo` (unlike
 * `queueModeClient`/`turnStatusClient`/`transcribeClient` above, they
 * do not depend on `core.connection` at all — an OS document/camera
 * picker works with no daemon paired). `createExpoAttachmentSourcePort`
 * (`../../../../../features/composer/expo-attachment-source-port.ts`)
 * is backed by `expo-document-picker` alone, not `expo-image-picker` —
 * see that module's header (and `attachment-source-port.ts`'s own
 * header) for why: measured directly against both packages' Android
 * source, `expo-document-picker` needs no Android permission at all
 * (Storage Access Framework), and `expo-image-picker`'s own media-
 * library permission requests **zero** permissions on API 33+ anyway
 * (`READ_MEDIA_IMAGES` is never referenced in that package's Android
 * source), so routing through the always-permission-free document
 * picker — whose own UI already includes images — is strictly better.
 * `createExpoCameraCapturePort`
 * (`../../../../../features/composer/expo-camera-capture-port.ts`) is
 * backed by `expo-image-picker`'s `launchCameraAsync`, gated on the
 * real Android `CAMERA` permission via that same package's
 * `getCameraPermissionsAsync`/`requestCameraPermissionsAsync` — see
 * `attachment-source-port.ts`'s `CameraCapturePort` doc comment for one
 * disclosed native-layer quirk (`launchCameraAsync` itself re-checks
 * `CAMERA` permission internally, beneath this port's own control; no
 * double OS PROMPT results, since Android no-ops an already-granted
 * permission request, but it is a real second native-layer check this
 * port's own TypeScript code neither makes nor can prevent). Nothing in
 * `Composer.tsx`, `attachment-model.ts`, or `attachment-capture-
 * model.ts` needed to change for this — the whole point of the seam
 * those files already described.
 *
 * `turnRunning` is no longer the fixed `false` literal this comment used
 * to disclose as a gap. T64 landed mid-wave with a real per-agent signal
 * (`createTurnRunningSignal`, `../../../../../features/sessions/
 * turn-running-signal.js`) built exactly for this mount — that module's
 * own doc comment names this file's line number and filed the seam
 * "app/ and app-shell/ are T32S13's grant, not this module's". This
 * route is the seam's first live importer, imported directly (not
 * through the `features/sessions` barrel, which T64 deliberately did
 * not extend — see that module's own file-list, `app-shell/core.ts`'s
 * `turn-service.js`/`daemon-connection-store.js` imports are the same
 * "import the module directly, not the barrel" convention already
 * established for this kind of unowned-feature seam).
 *
 * `turnRunning` rendered to `Composer` is `submitting || signalRunning`
 * — two real, distinct signals OR'd together, not one replacing the
 * other: `submitting` (local `useState`, `true` from the moment
 * `handleSubmit` calls `core.startTurn` until that promise settles)
 * covers the gap between a Send tap and the daemon's first
 * `pi_queue_update`/`turn_started` push — T64's signal cannot yet be
 * `true` in that window, since nothing has reached the wire; the wave's
 * own brief named exactly this overlap risk ("once onSubmit is wired, a
 * user can fire overlapping turns"). `signalRunning` is T64's own
 * `TurnRunningSignal.getRunning()`, mirrored into `useState` via its
 * `onChange` callback, and is what keeps the Send control disabled for
 * the turn's real remaining duration once the daemon starts reporting
 * it — the gap `submitting` alone cannot close. `daemonSource`/
 * `connectionStatusSource` below adapt `AppCore.subscribeAgentStream`
 * (already the one live `agent_stream` fan-out this route's own
 * `SessionTranscript` above reads from — never a second subscription)
 * and `AppCore.connection.subscribe` to `DaemonTurnStreamSource`/
 * `ConnectionStatusSource`'s structural shapes, the same type-only-cast
 * convention `app-shell/core.ts`'s own `AgentStreamCapableClient` cast
 * already uses.
 *
 * T32S7 (P5-W11) additionally mounts `SessionApprovals` (above) as a
 * sibling of `CompactSessionShell` rather than inside one of its named
 * slots — `ApprovalsHost` renders through `Sheet`'s Portal path, not
 * in-flow, so it needs no slot of its own, same reasoning `Sheet.tsx`'s
 * doc comment gives for why `<PortalHost>` wrapping `<Stack>` in
 * `app-shell/navigation-shell.tsx` is enough. `SessionSheetExtensions`
 * (T32S12, above) joins it there for the identical reason.
 *
 * **T353 mount.** Two more props for `Composer`, both off the same
 * live `DaemonClient` the rest of this route reads: `usage`, driven by
 * `features/telemetry`'s `createContextUsageSignal` through
 * `resolveAgentUsageClient`, which is what fills the prompt bar's
 * context ring; and `modelThinkingClient`, through
 * `resolveModelThinkingClient`. The second closes a gap rather than
 * adding a feature — `ComposerProps.modelThinkingClient` and the
 * controller behind it have existed since T39B, no route had ever
 * passed one, and `ModelThinkingPicker` could therefore only ever
 * render its truthful "Connect to a daemon…" state on a real build.
 *
 * **T354 mount.** One more prop for `Composer`, off the same live
 * `DaemonClient`: `sessionControlsClient`, through
 * `resolveSessionControlsClient` — the tenth `resolve*Client`
 * narrowing on this route. It fills the context-ring menu's MODE group
 * with real Build/Plan segments and its CONTEXT group with a real
 * auto-compaction switch, both of which reach the daemon
 * (`setAgentMode`, `setAutoCompaction`). With no connection the
 * resolver hands back `undefined` and the picker renders its truthful
 * "Connect to a daemon…" state instead.
 *
 * **T351 mount.** The `header` slot is still `TranscriptHeader` alone,
 * but that component is now the redesign's S7 app bar (see its own doc
 * comment). Three things this route supplies that it could not supply
 * itself: `onOpenSessions`/`onOpenLive`, because only a route has a
 * router — both go through `../../../../../app-shell/
 * session-nav-actions-model.ts`'s `pressSessionList`/`pressSessionLive`,
 * the same `destinationHref` conversion every other push in this app
 * uses; and `cwd`, read by `useAgentCwd` off
 * `resolveAgentSnapshotClient(core.connection)` — the seventh
 * `resolve*Client` narrowing of the same live `DaemonClient` the six
 * below already read. With no connection the resolver hands back
 * `undefined`, the hook never issues a request, and the bar draws no
 * subtitle rather than a placeholder path.
 *
 * **T350 (the redesign) moved Files and Terminal off this screen.**
 * The paragraph below records what T79 did and why, because the gap it
 * closed is still real and the fix is still live — only its LOCATION
 * changed. `SessionNavActions` now mounts on the Live route
 * (`./live.tsx`), keeping `session-nav-actions-files`/
 * `session-nav-actions-terminal` on the same two controls; this
 * header slot is `TranscriptHeader` alone again. Nothing about the
 * "no in-app control reaches either route" defect has come back — read
 * `./live.tsx`'s doc comment for where the control lives now.
 *
 * **T79 mount**: `header` used to be `TranscriptHeader` alone. Both the
 * files route (`/h/:serverId/session/:agentId/files/*`) and the terminal
 * route (`/h/:serverId/session/:agentId/terminal/:terminalId`) were
 * real, already-shipped, already-tested screens with no in-app control
 * anywhere that navigated to either — `../maestro/files-and-terminal.
 * yaml`'s own header named this exact gap and asked "whichever task next
 * edits `session/[agentId]/index.tsx` for in-app navigation" to close
 * it. `../../../../../app-shell/session-nav-actions.tsx`'s
 * `SessionNavActions`, a sibling of `TranscriptHeader` inside this same
 * `header` slot (§9.2 keeps files/terminal out of `CompactSessionShell`'s
 * own slot vocabulary — see that module's doc comment — so this is
 * ordinary header content, not a new shell slot), is that control: two
 * 48dp `Button`s ("Files"/"Terminal") that push this session's own
 * `serverId`/`agentId` through `session-nav-actions-model.ts`'s
 * `pressSessionFiles`/`pressSessionTerminal` — the exact
 * `destinationHref`/`navigationIntentToPath` conversion every other
 * route push in this app already goes through, never a hand-built
 * string. Reaching either route with no live connection is unchanged:
 * `FilesScreen`'s "Not connected" and `TerminalScreen`'s "Terminal
 * unavailable" states are that screen's own, already-shipped honest
 * fallbacks (the terminal one unconditional today — T80's, not this
 * task's, to fix per that task's own section in `docs/issues-from-
 * plan.md`) — this mount adds a way to arrive, not a second connection
 * check of its own.
 *
 * **T339 mount.** Every `agent_stream` consumer this route mounts —
 * `SessionTranscript`'s batcher through `core.subscribeAgentStream`, the
 * turn-running signal below, `PinnedLiveExtensionArea`/
 * `SessionSheetExtensions` through `piUiSession.store` — only ever
 * receives a push once this connection has marked the agent as viewed:
 * the daemon's selective timeline delivery
 * (`packages/server/src/server/session.ts`, `forwardAgentStream`)
 * withholds every `agent_stream` for an agent nobody has registered, and
 * `packages/frontend-core/src/connection/client-capabilities.ts` opts
 * every hello into that mode. Until T339 nothing on Android issued that
 * registration (`apps/web`'s `host-session-screen.tsx` had, since T31B3),
 * which is why Maestro run 34477213142's `extension-sheets` sent its
 * prompt, watched the daemon accept it, and never saw
 * `pi-roster-subagents-fleet`. This route now calls
 * `core.setViewedAgentTimeline([agentId])` from an effect keyed on the
 * connection `phase`, only while it is `"connected"` (the lifecycle maps
 * that from `DaemonClient`'s own `HELLO_SERVER_INFO` transition, and the
 * client's method silently no-ops before `server_info` has arrived), and
 * `[]` on cleanup — so leaving the route stops the feed, and a reconnect
 * (phase leaves and re-enters `"connected"`) re-registers against the
 * fresh socket, whose membership the daemon starts empty.
 */
export default function SessionRoute() {
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId: string }>();
  const core = useAppCore();
  const { phase } = useConnectionStatus(core.connection);
  const status = deriveSessionRouteStatus(phase);
  const turnService = useMemo(() => core.createTurnService(agentId ?? ""), [core, agentId]);
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = useCallback(
    async (text: string) => {
      setSubmitting(true);
      try {
        const result = await core.startTurn(agentId ?? "", text);
        if (result.status === "failed") {
          throw new Error(result.message);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [core, agentId],
  );

  // T64's real turnRunning signal — see this component's doc comment.
  const [signalRunning, setSignalRunning] = useState(false);
  useEffect(() => {
    if (!agentId) return;
    const daemonSource: DaemonTurnStreamSource = {
      on: (_type, handler) =>
        core.subscribeAgentStream(
          handler as unknown as Parameters<typeof core.subscribeAgentStream>[0],
        ),
    };
    const connectionStatusSource: ConnectionStatusSource = {
      subscribeConnectionStatus: (listener) =>
        core.connection.subscribe((snapshot) => listener({ status: snapshot.phase })),
    };
    const signal = createTurnRunningSignal(
      daemonSource,
      agentId,
      setSignalRunning,
      connectionStatusSource,
    );
    setSignalRunning(signal.getRunning());
    return () => signal.dispose();
  }, [core, agentId]);
  const turnRunning = submitting || signalRunning;

  // T339: mark this agent's timeline as viewed for as long as this route
  // is mounted and connected — see this component's "T339 mount" doc
  // comment for why nothing above receives a single push without it.
  useEffect(() => {
    if (!agentId || phase !== "connected") return;
    void core.setViewedAgentTimeline([agentId]);
    return () => {
      void core.setViewedAgentTimeline([]);
    };
  }, [core, agentId, phase]);

  // T132: fresh reads off the real AppCore.connection's active lifecycle
  // — see this component's own doc comment ("T132 mount") for why this
  // is its own small module rather than inlined like SessionApprovals'
  // client cast above.
  const queueModeClient = resolveQueueModeClient(core.connection);
  const turnStatusClient = resolveTurnStatusClient(core.connection);
  // T282: identical fresh-read cast, off the same live DaemonClient, for
  // Composer's transcribeClient prop — see resolveTranscribeClient's own
  // doc comment and this component's "T282 mount" doc comment above.
  const transcribeClient = resolveTranscribeClient(core.connection);
  // T292: identical fresh-read cast, off the same live DaemonClient, for
  // Composer's slashCommandsClient prop — see resolveSlashCommandsClient's
  // own doc comment.
  const slashCommandsClient = resolveSlashCommandsClient(core.connection);
  // T293: identical fresh-read cast, off the same live DaemonClient, for
  // Composer's editorTextClient prop — see resolveEditorTextClient's own
  // doc comment.
  const editorTextClient = resolveEditorTextClient(core.connection);
  // T290: real OS-permission ports for attachment picking/camera
  // capture — see this component's own "T290 mount" doc comment above.
  // Unlike queueModeClient/turnStatusClient/transcribeClient above,
  // these do not depend on core.connection at all (an OS picker works
  // with no daemon paired), so they are memoized once per mount instead
  // of re-derived every render.
  const attachmentSource = useMemo(() => createExpoAttachmentSourcePort(), []);
  const cameraCapture = useMemo(() => createExpoCameraCapturePort(), []);

  // T346: the composer slot's two height bounds. The cap needs to know
  // whether the pinned area is really drawing, which only the elements
  // can answer (`SessionLiveExtension` below reads the same store; the
  // shell's own `liveExtension` prop is an element either way), and the
  // floor is the composer's own runtime measurement reported upward.
  // `app-shell/composer-slot-cap-model.ts` holds the measured geometry
  // and the reason both are needed together.
  const { height: windowHeightDp } = useWindowDimensions();
  const { elements: liveExtensionElements } = usePiUiElements(
    core.piUiSession.store,
    agentId ?? "",
  );
  const composerMaxHeight = resolveComposerSlotMaxHeightDp({
    windowHeightDp,
    liveExtensionOccupied: resolvePinnedAreaVisibility(liveExtensionElements) === "visible",
  });
  const [composerContentMinHeight, setComposerContentMinHeight] = useState(0);

  // T351: the app bar's two marks and its mono subtitle. The router is
  // read here rather than inside `TranscriptHeader` so that component
  // stays router-free and its contract can be pinned without
  // `expo-router` in its import graph, the same split `./live.tsx`
  // already uses for `LiveScreen`. Both pushes go through
  // `session-nav-actions-model.ts`'s `destinationHref` conversion, never
  // a hand-built path.
  const router = useRouter();
  const openSessions = useCallback(
    () => pressSessionList(router, serverId ?? ""),
    [router, serverId],
  );
  const openLive = useCallback(
    () => pressSessionLive(router, serverId ?? "", agentId ?? ""),
    [router, serverId, agentId],
  );
  const cwd = useAgentCwd(resolveAgentSnapshotClient(core.connection), agentId ?? "");

  // T353: the two things the composer's context ring and its menu need.
  // `modelThinkingClient` closes a gap rather than adding a feature —
  // `Composer` has accepted this prop since T39B and no route had ever
  // passed one, so `ModelThinkingPicker` could only ever render its
  // "Connect to a daemon…" state on a real build.
  const modelThinkingClient = resolveModelThinkingClient(core.connection);
  // T354: identical fresh-read cast, off the same live DaemonClient, for
  // the context-ring menu's Build/Plan segments and its auto-compaction
  // switch — see resolveSessionControlsClient's own doc comment.
  const sessionControlsClient = resolveSessionControlsClient(core.connection);
  const usageClient = resolveAgentUsageClient(core.connection);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  useEffect(() => {
    if (!agentId || !usageClient) return;
    const signal = createContextUsageSignal(usageClient, agentId, setUsage);
    setUsage(signal.getUsage());
    return () => signal.dispose();
  }, [usageClient, agentId]);

  return (
    <>
      <CompactSessionShell
        composerContentMinHeight={composerContentMinHeight}
        composerMaxHeight={composerMaxHeight}
        header={
          <TranscriptHeader
            hostLabel={serverId ?? ""}
            sessionTitle={agentId ?? ""}
            cwd={cwd}
            status={status}
            onOpenSessions={openSessions}
            onOpenLive={openLive}
          />
        }
        statusStrip={<TranscriptStatusStrip status={status} />}
        transcript={<SessionTranscript status={status} agentId={agentId ?? ""} />}
        liveExtension={<SessionLiveExtension agentId={agentId ?? ""} />}
        composer={
          <Composer
            sessionId={agentId ?? ""}
            onSubmit={handleSubmit}
            onMicPress={handleMicPress}
            onAttachPress={handleAttachPress}
            turnRunning={turnRunning}
            turnService={turnService}
            queueModeClient={queueModeClient}
            turnStatusClient={turnStatusClient}
            transcribeClient={transcribeClient}
            slashCommandsClient={slashCommandsClient}
            editorTextClient={editorTextClient}
            modelThinkingClient={modelThinkingClient}
            sessionControlsClient={sessionControlsClient}
            usage={usage}
            attachmentSource={attachmentSource}
            cameraCapture={cameraCapture}
            onMinHeightChange={setComposerContentMinHeight}
            outbox={core.turnOutbox.getOutbox() ?? undefined}
          />
        }
      />
      <SessionApprovals sessionId={agentId ?? ""} />
      <SessionSheetExtensions agentId={agentId ?? ""} />
    </>
  );
}
