import type {
  AppLifecycle,
  Clock,
  FilePicker,
  KeyValueStorage,
  NetworkReachability,
  NotificationsPlatform,
  SecureStorage,
  Sharing,
  TimerHandle,
  connection,
} from "@picompanion/frontend-core";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import { createDaemonConnectAttempt } from "../features/connect/daemon-connect-attempt.js";
import {
  buildDaemonHttpOrigin,
  createDaemonConnectionStore,
  type DaemonConnectionStore,
} from "../features/connect/daemon-connection-store.js";
import {
  createReconnectHostProfile,
  type ReconnectHostProfile,
} from "../features/connect/host-profile-reconnect.js";
import {
  createPiUiSession,
  ingestPiUiAgentStreamMessage,
  type PiUiSession,
} from "../features/extensions/registry-index";
import {
  FILE_BROWSER_NOT_CONNECTED,
  FILE_READ_NOT_CONNECTED,
  FILE_WRITE_NOT_CONNECTED,
  type FileBrowserClient,
} from "../features/files";
import {
  attachTokenRefresh,
  createPushRegistrationController,
  createUnavailablePushRegistrationPort,
  registerForPush,
  type PushRegistrationController,
} from "../features/notifications/index.js";
// T115: imported through `../features/share/index.js` (the feature
// barrel) rather than as two separate deep imports. That barrel's doc
// comment still warns other, unrelated callers off it — a caller with no
// other reason to reach `expo-modules-core` should keep importing
// `share-intent-native-port.js` directly rather than pull the whole
// barrel in for one export — but this file is not such a caller: it is
// the one production composition root that already mocks
// `expo-modules-core` in its own test (see `core.test.ts`, T69) because
// `createNativeShareIntentPort()` reaches it regardless of which path
// imports it. Routing through the barrel here adds no new mock
// requirement and gives `features/share/index.ts` (T115) a real
// production call site instead of the zero it had.
import { createNativeShareIntentPort, type ShareIntentPort } from "../features/share/index.js";
import type { SessionService } from "../features/sessions/sessions-model.js";
import {
  createDaemonTurnService,
  startDaemonTurn,
  type DaemonTurnTransport,
  type TurnStartResult,
} from "../features/sessions/turn-service.js";
import {
  createSettingsController,
  type SettingsController,
} from "../features/settings/settings-model.js";
import type { TurnService } from "../features/composer/index.js";
import {
  createUnavailableTerminalWebViewPort,
  type TerminalBinaryTransport,
  type TerminalWebViewPort,
} from "../features/terminal/index.js";
import {
  createDaemonSessionService,
  type DaemonSessionServiceClient,
} from "../platform/daemon-session-service";
// T78: this app's real, honestly-degraded `FilePicker`/`Sharing`
// production adapters — see `AppCore["filePicker"]`/`AppCore["sharing"]`'s
// own doc comments below for exactly what each does and does not do yet.
import { createUnavailableFilePicker } from "../platform/file-picker.js";
import { createRNVibrationPlatform, type VibrationPlatform } from "../platform/haptics";
import { createExpoKeyValueStorage } from "../platform/key-value-storage";
import { createAppStateLifecycle } from "../platform/lifecycle";
import { createRNShareModule } from "../platform/native-share-module.js";
import { createUnavailableAndroidNotificationsPlatform } from "../platform/notifications-platform.js";
import {
  createOfflineCacheOwner,
  createTurnOutboxOwner,
  createUnavailableSqliteDriverFactory,
  type OfflineCacheOwner,
  type SqliteDriverFactory,
  type TurnOutboxOwner,
} from "../platform/offline/index.js";
import { createExpoSecureStorage } from "../platform/secure-storage";
import { createFileSharingUnavailableSharing } from "../platform/sharing.js";
import {
  createDefaultAndroidProbe,
  createPollingNetworkReachability,
  type NetworkReachabilityProbe,
  type PollingNetworkReachability,
} from "../platform/network-reachability";
import {
  attachResumeSignals,
  type AttachResumeSignalsOptions,
  type ResumeSignalTarget,
} from "./resume-signals";
import {
  createDaemonTerminalBinaryTransport,
  type TerminalSessionCapableClient,
} from "./terminal-transport-adapter.js";

/** This app's fixed daemon hello `clientId` for any `AppCore`-constructed connection — mirrors `features/connect/connection-shell.tsx`'s own `ANDROID_DAEMON_CLIENT_ID`. Since T32A4 both feed the *same* store (`connection` below): this copy builds the direct-connect attempt, that file's copy builds the QR/relay offer attempt it hands to `connection.adoptLifecycle`. */
export const ANDROID_DAEMON_CLIENT_ID = "picompanion-android";

/**
 * This app's fixed daemon hello `appVersion` for every `AppCore`-constructed
 * connection. Exported for the same reason `ANDROID_DAEMON_CLIENT_ID` above
 * is: `app/h/[serverId]/diagnostics.tsx` shows the identity this app really
 * declares on `hello`, and a diagnostics screen that reads a second,
 * separately-typed copy of these strings would drift silently from the ones
 * actually sent. Was a bare `"0.1.0"` literal repeated at both construction
 * sites below until this constant replaced them.
 */
export const ANDROID_DAEMON_APP_VERSION = "0.1.0";

/**
 * The one scope every `AppCore`-owned `OfflineCacheOwner` uses unless a
 * test overrides it (P5-W20 merge gate).
 *
 * This used to be a per-`createAppCore()` counter
 * (`android-app-core-${n}`), which made `OfflineCacheOwner`'s
 * one-undisposed-owner-per-scope guard (T68's fourth acceptance
 * criterion) structurally unreachable from production: `createAppCore()`
 * always took the counter branch, so no two owners could ever share a
 * scope and the guard could never fire. `scope` is only a key into
 * `offline-cache-owner.ts`'s module-level `activeScopes` set — it is
 * never forwarded to `SqliteDriverFactory.open()`, to
 * `SqliteStructuredStorage`, or to `OfflineCache`'s collection — so a
 * distinct scope does *not* give an owner a distinct database. Two
 * owners with different scopes therefore open the *same* store and race
 * each other's writes, which is precisely what the guard exists to
 * prevent. Harmless only while `createUnavailableSqliteDriverFactory()`
 * keeps both degraded; it would become a live corruption path the moment
 * a real `expo-sqlite` factory is swapped in — the one change
 * `sqlite-driver-factory.ts` promises is safe in isolation.
 *
 * A fixed scope restores the guard. `releaseAppCoreOfflineCacheOwner`
 * below is what keeps repeated `createAppCore()` calls (`core.test.ts`,
 * `resume-wiring.test.ts`) working under it.
 */
export const APP_CORE_OFFLINE_SCOPE = "android-app-core";

/**
 * The still-undisposed `OfflineCacheOwner` this module handed to the most
 * recent `createAppCore()`, if any. Production constructs exactly one
 * `AppCore` per process lifetime, so this is `null` -> one owner -> never
 * touched again; a test (or a dev-time provider remount) that builds a
 * second `AppCore` releases the first owner's scope instead of quietly
 * opening a second cache over the same store. `dispose()` frees the scope
 * synchronously before it awaits anything, so the construction below can
 * follow immediately without a race.
 */
let activeAppCoreOfflineCacheOwner: OfflineCacheOwner | null = null;

/**
 * T76: fixed scope for `AppCore.turnOutbox`'s `TurnOutboxOwner` —
 * mirrors `APP_CORE_OFFLINE_SCOPE` exactly, including the reason a
 * fixed scope matters: `TurnOutboxOwner`'s own module-level
 * `activeScopes` guard (`../platform/offline/turn-outbox-owner.ts`)
 * only prevents two owners racing the *same* scope, and a distinct
 * scope is never forwarded into the underlying store's collection
 * name — see that constant's own doc comment for the full argument,
 * which applies here unchanged.
 */
export const APP_CORE_TURN_OUTBOX_SCOPE = "android-app-core-turn-outbox";

/**
 * The still-undisposed `TurnOutboxOwner` this module handed to the most
 * recent `createAppCore()`, if any — identical bookkeeping shape to
 * `activeAppCoreOfflineCacheOwner` above, for the identical reason
 * (repeated `createAppCore()` calls in `core.test.ts`/
 * `resume-wiring.test.ts` release the prior owner's scope instead of
 * racing a second owner against it).
 */
let activeAppCoreTurnOutboxOwner: TurnOutboxOwner | null = null;

/**
 * Real-time `Clock` for `AppCore.offlineCache`'s `OfflineCacheOwner`
 * (T68/T32S14). No shared `platform/clock.ts` exists on Android yet
 * (only `platform/frame-clock.ts`, a different interface for animation
 * frames) — this is the same small local implementation over the
 * global `setTimeout`/`clearTimeout`/`Date.now` React Native's JS
 * runtime already provides that `features/approvals/
 * ApprovalsContainer.tsx`'s own `SystemClock` already uses (duplicated
 * rather than shared, matching that file's own doc comment on why no
 * shared one exists yet).
 */
class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    return setTimeout(callback, delayMs) as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return setInterval(callback, intervalMs) as unknown as TimerHandle;
  }
  clearInterval(handle: TimerHandle): void {
    clearInterval(handle as unknown as ReturnType<typeof setInterval>);
  }
}

/**
 * The slice of `frontend-core`'s platform surface this Phase 1 shell
 * consumes. `frontend-core.platform.CorePlatform` bundles every
 * interface (storage, secure storage, notifications, sharing, and so
 * on); this app only wires the ones its current screens use, and grows
 * this type as later tasks add features that need more of them.
 */
export interface AppCore {
  network: NetworkReachability;
  /**
   * The real `AppState`-backed lifecycle adapter (T32S1B). Exposed on
   * `AppCore` rather than imported per-screen so background/foreground
   * state has exactly one source in this process.
   */
  lifecycle: AppLifecycle;
  /**
   * App-wide `DaemonConnectionStore` (T32S3, plan.md §7.1) — the join
   * `h/[serverId]/session/[agentId]/index.tsx` reads through
   * `../session-route-model.ts`'s `deriveSessionRouteStatus` so the
   * session route's status strip stops being a hardcoded literal.
   *
   * **Closed in P5-W9 by T32A4.** This comment described the gap as still
   * open when T32S4 wrote it; the sibling task closed it in the same
   * wave. `features/connect/connection-shell.tsx` used to build its *own*
   * separate `DaemonConnectionStore` in a local `useMemo`, so a connect
   * attempt a user submitted through `ConnectForm` never reached this
   * store. It now reads `useAppCore().connection` directly, and no longer
   * disposes the store on unmount, so a successful `ConnectForm`
   * submission — and a completed QR pairing, applied through
   * `adoptLifecycle()` — updates *this* store, the one every other screen
   * already reads. `AppCore` owns its lifetime for the process.
   */
  connection: DaemonConnectionStore;
  /**
   * Real, on-device-persistent plain storage (T32S3) — `../platform/
   * key-value-storage.ts`'s Expo-SecureStore-backed `KeyValueStorage`.
   * `SessionsScreen`'s cold-start restore (`readLastOpenedSessionId`)
   * and open-persistence (`writeLastOpenedSessionId`) both need a real
   * instance of this to run at all; before this it was never
   * constructed anywhere, so both no-opped.
   */
  keyValueStorage: KeyValueStorage;
  /**
   * Real (not fake) `SessionService` (T32S3, item (4)'s missing half —
   * `../platform/key-value-storage.ts` above closed the
   * `keyValueStorage` half) — `../platform/daemon-session-service.ts`'s
   * `createDaemonSessionService`, wrapping whichever daemon client
   * `connection.getActiveLifecycle()?.getDaemonClient()` is live *at
   * call time* (read fresh on every method call, not captured once), so
   * `SessionsScreen`'s `if (!sessionService) return null` guard
   * (`sessions-screen.tsx`) no longer fires — this is always a real,
   * non-null `SessionService`, never `undefined`.
   *
   * **Live as of P5-W9**: `features/connect/connection-shell.tsx` now
   * sources its store from this file's `connection` (T32A4), so a
   * connected session makes every method here real with no further
   * change to this file. Before a user connects, each method still
   * rejects with "Not connected to a daemon" — the correct behaviour for
   * "no active connection", not an outstanding gap.
   *
   * `getDaemonClient()` (`@picompanion/frontend-core`'s
   * `connection.DaemonClientLifecycle`) returns the narrower
   * `DaemonClientLike`, which does not declare `createAgent`/
   * `fetchAgent`/`fetchAgentTimeline`/`archiveAgent`/`deleteAgent` —
   * the one cast in this file exists because the object it returns at
   * runtime is always the real `@picompanion/client` `DaemonClient`
   * (`daemon-client-lifecycle.ts`'s own `defaultDaemonClientFactory`),
   * which does have every one of those methods; only a lifecycle built
   * with a *custom* `createDaemonClient` factory (test-only; production
   * never supplies one — see `createDaemonConnectAttempt` above) could
   * violate that. `daemon-session-service.test.ts` proves the adapter
   * itself against a hand-rolled fake satisfying the same narrow
   * `DaemonSessionServiceClient` shape.
   */
  sessionService: SessionService;
  /**
   * Real Expo-SecureStore-backed secrets storage (T32S3) — `../platform/
   * secure-storage.ts`'s `createExpoSecureStorage`. Paired with
   * `keyValueStorage` above, this is what lets `AppCoreProvider`
   * (`./core-context.tsx`) call `features/connect/credential-store.ts`'s
   * `listHostProfiles` for the cold-start gate (item 3) — that function's
   * `CredentialStoreDeps` needs both.
   */
  secureStorage: SecureStorage;
  /**
   * The app-wide Pi UI element store and action controller (T32S4,
   * T34A5's `createPiUiSession` — `../features/extensions/registry-
   * index.ts`), one instance for the process lifetime (see that
   * function's doc comment for why one is enough — every agent this
   * client has state for shares it). `session/[agentId]/index.tsx`
   * reads `piUiSession.store` through `usePiUiElements` for the
   * `liveExtension` slot's `PinnedLiveExtensionArea`.
   *
   * **Disclosed gap, in both directions**: (1) nothing anywhere in
   * `@picompanion/client`'s `DaemonClient` yet sends a
   * `pi.ui.action.request` wire message — confirmed by reading
   * `packages/client/src/daemon-client.ts` — so `piUiSession`'s
   * `sendRequest` (below) has no live transport to forward to yet; a
   * dispatched action will resolve only via
   * `ExtensionActionController`'s own timeout, never a real response.
   * That is `packages/client` work, outside this task's `apps/android`
   * Owns grant. (2) nothing in *production* feeds a live `agent_stream`
   * event into this store either — the same standing "no live per-agent
   * event subscription exists on Android yet" gap `SessionTranscript`'s
   * own doc comment (`app/h/[serverId]/session/[agentId]/index.tsx`)
   * discloses for the transcript batcher.
   *
   * **T32S8 closed the second gap** (the first — no live outbound
   * `pi.ui.action.request` transport in `@picompanion/client` — is still
   * open, see (1) above): `ensureAgentStreamSubscription` below now calls
   * `client.on("agent_stream", ...)` on whatever `DaemonClient`
   * `connection.getActiveLifecycle()?.getDaemonClient()` returns,
   * re-subscribing every time `connection` publishes a snapshot (a
   * reconnect swaps in a new client instance, so the old subscription is
   * torn down and a fresh one attached rather than silently going stale).
   * Every message reaches `ingestPiUiAgentStreamMessage(piUiSession,
   * message.payload)` unconditionally, and is also fanned out to whatever
   * listeners `subscribeAgentStream` (below) has registered — the session
   * route's transcript batcher is the one production consumer of that
   * fan-out today (`app/h/[serverId]/session/[agentId]/index.tsx`'s
   * `SessionTranscript`). Proven in `core.test.ts` against a fake
   * `DaemonClientLike` adopted onto `connection` (never a real socket):
   * one scripted `agent_stream` message reaches both `piUiSession.store`
   * and a `subscribeAgentStream` listener from the one `on()` call.
   *
   * The `liveExtension` slot now has a real, live-feedable store; it
   * still renders nothing in production until a real daemon actually
   * sends an `agent_stream` message, which remains for T37/T59 to prove
   * on a device.
   */
  piUiSession: PiUiSession;
  /**
   * Real (not fake) `FileBrowserClient` (T32S4) — every method reads
   * `connection.getActiveLifecycle()?.getDaemonClient()` fresh at call
   * time, same "always a real, stable object" shape as `sessionService`
   * above, and the same behaviour: a call rejects with
   * `FILE_BROWSER_NOT_CONNECTED` whenever no connection is active. Since
   * T32A4 (P5-W9) a real `ConnectForm` submission does feed `connection`,
   * so this client reaches a live daemon once a user connects.
   * `DaemonClient.listDirectory` (`packages/client/src/
   * daemon-client.ts`) is not declared on `connection.DaemonClientLike`
   * — same narrowing `sessionService`'s doc comment explains — so the
   * one cast here relies on the same fact: the object
   * `getDaemonClient()` returns in production is always the real
   * `DaemonClient`, which does have it.
   *
   * T32S7: `readFile` (T35A2's read half) is now forwarded the same way
   * — until this task it was left off the object literal entirely, so
   * every file open rejected with `FILE_READ_NOT_CONNECTED` regardless
   * of connection state and T35A2's daemon-RPC read path (real Lezer
   * highlighting, binary/oversize/vanished refusals) was unreachable
   * from `FilesScreen`.
   *
   * The P5-W12 merge gate forwards `writeFile` (T35A3's write half) for
   * the same reason: T35A3 committed after T32S8 in that wave, so the
   * member did not exist when this file was last edited, and leaving it
   * off would have made every save resolve `FILE_WRITE_NOT_CONNECTED`
   * against a live daemon — T32S7's `readFile` failure repeated one wave
   * later.
   */
  fileBrowserClient: FileBrowserClient;
  /**
   * T78: this build's real `FilePicker` — `../platform/file-picker.js`'s
   * `createUnavailableFilePicker()`, constructed once here the same
   * "one process-lifetime singleton, threaded down" way `vibrationPlatform`/
   * `notifications`/`shareIntentPort` already are. Not
   * `createAndroidFilePicker` (that factory needs a real
   * `DocumentPickerModule`/`ImageLibraryPickerModule`/`FileUriBytesReader`
   * this workspace cannot construct): `expo-document-picker` and
   * `expo-image-picker` are not installed, and this task may not run an
   * install (see `../platform/file-picker.ts`'s own doc comment for the
   * exact commands: `npm install --workspace=@picompanion/android
   * expo-document-picker@~14.0.8 expo-image-picker@~17.0.11
   * expo-file-system@~19.0.24`). Every `pickFiles()` call therefore
   * rejects with the real, honest `FILE_PICKER_UNAVAILABLE` sentinel —
   * never a stub that hangs or silently resolves an empty pick — which
   * `../features/files/file-upload-model.ts`'s `selectFile()` now (T78)
   * turns into a named, visible `"refused"` state via
   * `explainFilePickerRefusal` instead of the silent no-op it used to be
   * (see that function's own doc comment for why swallowing this
   * rejection stopped being safe once this field was actually mounted
   * below and in `app/h/[serverId]/session/[agentId]/files/[...path].tsx`).
   *
   * `../features/files/files-screen.tsx`'s `FilesScreen` is this field's
   * one production consumer, via that route's `filePicker={core.filePicker}`.
   */
  filePicker: FilePicker;
  /**
   * T78: this build's real `Sharing` — `../platform/sharing.js`'s
   * `createFileSharingUnavailableSharing`, over a real
   * `../platform/native-share-module.js`'s `createRNShareModule()`
   * (React Native's own `Share.share`, already installed — no package
   * install needed for that half). Not `createAndroidSharing` (that
   * factory's file-sharing half needs a real `NativeFileShareModule`/
   * `ShareableFileWriter` this workspace cannot construct):
   * `expo-sharing` and `expo-file-system` are not installed, and this
   * task may not run an install (see `../platform/sharing.ts`'s own doc
   * comment for the exact commands: `npm install
   * --workspace=@picompanion/android expo-sharing@~14.0.8
   * expo-file-system@~19.0.24`).
   *
   * So `sharing.shareText()` is genuinely real — it reaches the actual
   * OS share sheet through RN's `Share.share` — while `sharing.
   * shareFiles()` always rejects `SHARING_FILES_UNAVAILABLE`, the real,
   * honest answer for a file-sharing target that cannot be constructed
   * yet, never a stub that silently "succeeds" without sharing anything.
   *
   * `../features/files/files-screen.tsx`'s `FilesScreen` is this field's
   * one production consumer, via that route's `sharing={core.sharing}`:
   * a completed download's bytes are handed to `sharing.shareFiles(...)`
   * exactly once (`FilesScreen`'s own doc comment), which today always
   * settles that named refusal — a real value reaches this adapter, the
   * adapter just cannot complete a file share without the installs
   * above.
   */
  sharing: Sharing;
  /**
   * Registers `listener` to receive every live `agent_stream` message
   * this process's active `DaemonClient` delivers, from the exact same
   * `client.on("agent_stream", ...)` subscription `piUiSession`'s doc
   * comment above describes — this is the fan-out side of that one wire
   * subscription, not a second one. Returns an unsubscribe function.
   *
   * `SessionTranscript` (`app/h/[serverId]/session/[agentId]/index.tsx`,
   * T32S8) is the one production caller: it forwards every message to
   * `createTranscriptMessageBatcher`'s `push()`, closing the identical
   * "no live feed" gap that module's own doc comment used to disclose
   * for the transcript batcher.
   */
  subscribeAgentStream: (listener: (message: AgentStreamMessage) => void) => () => void;
  /**
   * Feeds this app's foreground and connectivity changes into a T46A2
   * `connection.ResumeController` (plan.md §7.4 "Liveness": "the host
   * must feed foreground and connectivity changes into the resume
   * controller ... On Android, where backgrounding is constant, this is
   * not optional").
   *
   * Returns a dispose function. `useResumeSignals()` in
   * `./core-context.tsx` is the React-side wrapper; call this directly
   * from non-React code.
   *
   * Called in production by `features/sessions/sessions-screen.tsx` (via
   * `useResumeSignals(resumeController)`), which constructs the real
   * `ResumeController` T32B3 built. Every churn rule and the wiring
   * itself are proven against a real `ResumeController`, never a stand-in
   * — see `./resume-signals.test.ts` and `./resume-wiring.test.ts`.
   */
  attachResumeSignals: (
    target: ResumeSignalTarget,
    options?: Omit<AttachResumeSignalsOptions, "lifecycle" | "network" | "target">,
  ) => () => void;
  /**
   * Real, RN-`Vibration`-backed `VibrationPlatform` (T33B6,
   * `../platform/haptics/`), constructed once here (T32S9) — the same
   * "one process-lifetime singleton, threaded down" shape every other
   * `AppCore` platform adapter follows. `expo-haptics` is not installed
   * (see `../platform/haptics/vibration-platform.ts`'s doc comment), so
   * this wraps React Native's own already-installed `Vibration` API
   * instead; that is a deliberate, documented choice, not a stand-in
   * blocked on an install.
   *
   * `features/approvals/ApprovalsContainer` (mounted by `SessionApprovals`
   * in `app/h/[serverId]/session/[agentId]/index.tsx`) is this field's
   * one production consumer so far, firing the "approval" and "blocked"
   * §9.3 triggers. The other two triggers ("finished", "error") belong to
   * `features/transcript/` — see this task's report for the seam filed
   * against it; that feature would read this same field to fire them,
   * not construct a second `VibrationPlatform`.
   */
  vibrationPlatform: VibrationPlatform;
  /**
   * T32S11 (P5-W16): the real `SettingsController` T32C1 built
   * (`../features/settings/settings-model.js`), constructed once here —
   * the same "one process-lifetime singleton, threaded down" shape
   * `vibrationPlatform` above already follows — so every reader of a
   * setting shares one loaded snapshot rather than each screen re-reading
   * storage on its own.
   *
   * `SessionTranscript` (`app/h/[serverId]/session/[agentId]/index.tsx`)
   * is this field's one production consumer so far: it reads
   * `hapticsEnabled` off this controller's snapshot instead of the
   * hardcoded `true` literal T33A6/T32S9 left in place pending a real
   * settings surface. `features/approvals/use-approvals-queue.ts:102`
   * still hardcodes the identical literal and is **not** in this task's
   * `Owns` grant — see this task's report for the exact one-line seam to
   * thread `core.settings` there too, so both call sites read the same
   * loaded snapshot rather than each constructing a second controller.
   */
  settings: SettingsController;
  /**
   * T32S12 (P5-W18): the real `NotificationsPlatform` T32P3 built
   * (`../platform/notifications-platform.js`), constructed once here —
   * the same "one process-lifetime singleton, threaded down" shape
   * `vibrationPlatform`/`settings` above already follow.
   *
   * Nothing installs `expo-notifications`/`expo-device` this wave (T60C
   * still holds that grant), so this is always
   * `createUnavailableAndroidNotificationsPlatform()` today — every
   * method resolves a real, honest value (`getPermissionState()` ->
   * `"unsupported"`, `show()` a silent no-op), never a stub that throws.
   * See that factory's module doc for the fold decision, the exact
   * install command, and `getNativePermissionState` — the finer
   * `PermissionState` read a settings screen would call alongside this
   * field to decide "re-prompt" vs. "open system Settings" via
   * `describePermissionRecovery("notifications", state)`
   * (`../features/composer/permission-recovery.ts`, T60D).
   */
  notifications: NotificationsPlatform;
  /**
   * T32S12 (P5-W18): builds one terminal's `TerminalBinaryTransport`
   * over T62's `DaemonClient.openTerminalSession(terminalId)` — see
   * `./terminal-transport-adapter.ts`'s module doc for the encode/decode
   * bridge and the reconnect/resubscribe policy this task decided.
   *
   * A factory, not a singleton field like `sessionService`/
   * `fileBrowserClient`: a terminal transport is scoped to one
   * `terminalId` (and this screen's fixed multiplexing `slot`), so each
   * `SessionTerminalRoute` mount calls this once per terminal rather
   * than sharing one process-wide instance the way a connection-wide
   * adapter does.
   */
  createTerminalTransport: (terminalId: string, slot: number) => TerminalBinaryTransport;
  /**
   * T80 (P5-W23): this build's real `TerminalWebViewPort` —
   * `../features/terminal/terminal-webview-port.js`'s
   * `createUnavailableTerminalWebViewPort()`, constructed once here the
   * same "one process-lifetime singleton, threaded down" way `filePicker`/
   * `sharing` above already are.
   *
   * The terminal route used to report "unavailable" for two independent,
   * conflated reasons: `react-native-webview` is not installed (still
   * true — `apps/android/package.json` carries no such dependency, and
   * this task may not run an install; see
   * `../features/terminal/terminal-webview-port.ts`'s own doc comment for
   * the exact command: `npm install --workspace=@picompanion/android
   * react-native-webview@13.16.1`), **and** no route ever passed a
   * `webview` prop to `TerminalScreen` at all, so even a hypothetical
   * build with the package installed would still have rendered the
   * unavailable state — nothing wired a real implementation through.
   * This field closes the second gap: `../app/h/[serverId]/session/
   * [agentId]/terminal/[terminalId].tsx` is this field's one production
   * consumer, via that route's `webview={core.terminalWebview}`, the same
   * "read this field off `AppCore`, pass it straight through" shape that
   * route's own `transport={core.createTerminalTransport(...)}` line
   * already uses. Once `react-native-webview` is installed, swapping this
   * single construction for a real `xterm.js`-backed implementation (see
   * `terminal-webview-port.ts`'s module doc for the exact shape) is the
   * *only* change a real mount needs — the route and `TerminalScreen`
   * need not change at all, which is the point of this seam existing at
   * the `AppCore` boundary rather than inline in the route.
   *
   * `terminal-screen.tsx`'s own `isAvailable` check still renders its
   * named, accessible `EmptyState` ("Terminal unavailable") for this
   * field today — a real value now reaches the screen, it is just
   * honestly unavailable, never a stub that pretends otherwise.
   */
  terminalWebview: TerminalWebViewPort;
  /**
   * T32S12 (P5-W18): a real `TurnService` for one agent, over T63's
   * `createDaemonTurnService` (`../features/sessions/turn-service.js`).
   * Replaces `app/h/[serverId]/session/[agentId]/index.tsx`'s
   * `NO_OP_TURN_SERVICE` fixed stand-in, which the same route's own
   * `index.test.ts:79` used to pin shut with a negative-shaped assertion
   * (`turnService={NO_OP_TURN_SERVICE}`) — removed by this task, per
   * "never write a negative assertion that pins an unfinished thing
   * shut" once the thing stopped being unfinished.
   *
   * Same "read the live client fresh on every call, never captured
   * once" shape every other `AppCore` daemon-backed field in this file
   * already uses (see `sessionService`'s doc comment): the
   * `DaemonTurnTransport` handed to `createDaemonTurnService` below
   * re-reads `connection.getActiveLifecycle()?.getDaemonClient()` on
   * every `sendMessage`/`cancelAgent` call, so a turn started after a
   * reconnect reaches the *new* client rather than a captured stale
   * reference, and a call made with no active connection rejects with a
   * named "Not connected to a daemon" error rather than throwing past
   * the caller or silently no-opping — `Composer.tsx`'s existing
   * optimistic-revert-on-rejection handling already covers that path.
   *
   * `TurnService.setMode` always rejects with T63's
   * `UnsupportedDispatchModeChangeError` — a real, disclosed gap. As of
   * P6-W3 the DAEMON half is wired (T38B0b/T38B0c: `packages/server`'s
   * `Session` handles `set_steering_mode_request`/
   * `set_follow_up_mode_request`/`get_queue_modes_request` and forwards
   * `send_agent_message`'s `streamingBehavior`); what is still missing is
   * a `@picompanion/client` `DaemonClient` method that sends any of them
   * (T38B1a) — see `turn-service.ts`. Not a defect this field
   * introduces.
   */
  createTurnService: (agentId: string) => TurnService;
  /**
   * T32S13 (P5-W19): attempts to start a brand-new turn — the first
   * message to an idle agent — over T63's `startDaemonTurn`
   * (`../features/sessions/turn-service.js`). Never throws: settles to
   * a named `TurnStartResult`, exactly like `startDaemonTurn` itself.
   *
   * This is deliberately separate from `createTurnService` above, not a
   * duplicate: `createTurnService`'s `TurnService.steer`/`followUp`/
   * `abort` are for a turn already in flight; `startTurn` is what
   * `app/h/[serverId]/session/[agentId]/index.tsx`'s `Composer.onSubmit`
   * calls, matching `turn-service.ts`'s own doc comment that starting a
   * new turn goes through `onSubmit`, never `TurnService`. Both share
   * the identical fresh-read-the-live-client `DaemonTurnTransport`
   * shape (see `getTurnTransport` below), so a reconnect mid-session
   * reaches the *new* client for either call, never a captured stale
   * one.
   */
  startTurn: (agentId: string, text: string) => Promise<TurnStartResult>;
  /**
   * T32S13 (P5-W19): the real T61B `PushRegistrationController`
   * (`../features/notifications/push-registration-model.js`),
   * constructed once here — the same "one process-lifetime singleton,
   * threaded down" shape `settings`/`vibrationPlatform` above already
   * follow. `registrar` reads the live daemon client fresh on every
   * `submitToken` call (same "never a captured stale reference" shape
   * `createTurnService`'s transport already uses), and rejects with
   * "Not connected to a daemon" when none is active — a `submitToken`
   * call made with no connection never silently no-ops.
   *
   * `features/notifications/index.ts`'s own doc comment named this
   * field ("Seam filed against T32S11", never picked up before this
   * task) — this is the barrel's first live importer.
   */
  pushRegistration: PushRegistrationController;
  /**
   * T32S13 (P5-W19): runs one `registerForPush` attempt against
   * `createUnavailablePushRegistrationPort()` (T36A's only production
   * `PushRegistrationPort` — no `expo-notifications`/`expo-device`
   * install this wave, T60C's grant, same disclosed gap
   * `AppCore["notifications"]`'s doc comment already names), then wires
   * `attachTokenRefresh` to that same port. Both calls are real: the
   * port's `getPermissionStatus()` genuinely resolves `"unavailable"`
   * (never `"granted"`), so `registerForPush` genuinely, honestly
   * returns `"permission-not-granted"` without ever touching
   * `pushRegistration`'s registrar — the identical "real logic, real
   * adapter, real answer, currently unable to do anything with a live
   * device" shape `AppCore.notifications` already established, not a
   * stub that throws or silently no-ops. `attachTokenRefresh`'s
   * subscription is equally real; the unavailable port's
   * `onTokenRefresh` never fires, so `pushRegistration.submitToken` is
   * never called in production today — that remains for whichever task
   * lands the `expo-notifications` install this doc comment's sibling
   * fields already point at.
   *
   * Returns the token-refresh unsubscribe function. `app/core-context.tsx`'s
   * `AppCoreProvider` calls this once on mount and cleans it up on
   * unmount — the process-lifetime bootstrap location every other
   * `AppCore`-constructed listener in this app uses.
   */
  startPushRegistration: () => Promise<() => void>;
  /**
   * T32S14: the real T66 `ReconnectHostProfile`
   * (`../features/connect/host-profile-reconnect.js`'s
   * `createReconnectHostProfile`), bound once to this app's fixed daemon
   * identity — the same `ANDROID_DAEMON_CLIENT_ID`/`clientType`/
   * `appVersion` `connection` above is built with — so a caller only
   * ever supplies the restored `(HostProfileRecord, HostProfileSecrets)`
   * pair. Before this task nothing in `apps/android/src/app/` or
   * `app-shell/` called `createReconnectHostProfile` at all — see that
   * module's own "Where this plugs in" doc section, which named this
   * exact field and this exact file.
   *
   * `features/connect/connection-shell.tsx`'s `handleReconnect` is this
   * field's one production caller: selecting a saved profile from
   * `ConnectForm`'s "existing" mode now runs a real reconnect attempt
   * through here, then — on success — hands the resulting live
   * `connection.DaemonClientLifecycle` to `AppCore.connection.
   * adoptLifecycle()`, exactly like a completed QR/relay pairing already
   * does (`handlePaired`). A failed attempt (including T66's pin-
   * mismatch/pin-missing refusals) never reaches `adoptLifecycle` — see
   * `connection-shell-model.ts`'s `deriveReconnectOutcome`.
   *
   * **Closed at the P5-W20 merge gate**: `adoptLifecycle()` used to
   * publish a hardcoded `path: "relay"`, so a reconnected `kind: "direct"`
   * profile showed "Connected via relay" in the status strip even though
   * `ReconnectSuccess.path` reported `"direct"` right here. It now takes
   * the caller's own path (defaulting to `"relay"`, so the QR/pasted-offer
   * pairing path is unchanged) and `connection-shell.tsx` passes
   * `outcome.path` through.
   *
   * **Closed by T73** (this comment previously filed the remaining half
   * as an open gap): `adoptLifecycle()` now also takes the reconnected
   * `HostProfileRecord` itself and reconstructs `daemonAddress` from its
   * `endpoint` on the `path: "direct"` branch, so a reconnected direct
   * profile offers a real download origin/probe URL (via `getProbeUrl`
   * below) instead of `null` — see `daemon-connection-store.ts`'s
   * `parseHostProfileEndpoint`.
   */
  reconnectHostProfile: ReconnectHostProfile;
  /**
   * T68/T32S14: the real `OfflineCacheOwner`
   * (`../platform/offline/offline-cache-owner.js`'s
   * `createOfflineCacheOwner`), constructed once here per that module's
   * own filed "mount seam" doc section, which names this exact field
   * and this exact file. `open()` is called once, fire-and-forget,
   * immediately after construction below — every consumer reads
   * `getCache()`/`getStatus()` rather than awaiting a promise this
   * field does not expose.
   *
   * Always settles to `{ kind: "degraded", reason }` in production
   * today: this app installs no real `SqliteDriverFactory` yet (no
   * `expo-sqlite` this wave — see `../platform/offline/
   * sqlite-driver-factory.ts`'s doc comment for the exact install
   * command), so `createUnavailableSqliteDriverFactory()` is what this
   * is built with. `getCache()` therefore returns `null` for every
   * caller today — a real, honest miss, not a stub that throws or
   * silently no-ops, the same "real logic, real adapter, currently
   * unable to do anything with a live device/install" shape
   * `AppCore.notifications` already established.
   *
   * **Closed by T74**: this comment used to disclose that nothing called
   * `offlineCache.dispose()` anywhere in production, because
   * `createAppCore()`/`AppCoreProvider` had no "app is shutting down"
   * teardown hook for *any* of its constructed singletons. `shutdown()`
   * below is that hook, and `core-context.tsx`'s `AppCoreProvider` calls
   * it from its own unmount cleanup — see `shutdown`'s own doc comment.
   */
  offlineCache: OfflineCacheOwner;
  /**
   * T76: the real `TurnOutboxOwner`
   * (`../platform/offline/turn-outbox-owner.js`'s
   * `createTurnOutboxOwner`), constructed once here per that module's
   * own filed "mount seam" doc section, which names this exact field
   * and this exact file. `open()` is called once, fire-and-forget,
   * immediately after construction below — it also runs the one
   * cold-start `recoverInFlightTurns` pass before settling, so a
   * caller never observes a not-yet-recovered outbox.
   *
   * `resumePendingTurnOutboxEntries` (below, not a field on this
   * interface — an internal detail of this file) is what actually acts
   * on a `"resumed"` row once `open()` settles: it re-sends that row's
   * `payload.text` through the same `startDaemonTurn`/`getTurnTransport`
   * pair `AppCore.startTurn` itself uses, and runs once per fresh
   * `agent_stream` subscription (cold start once connected, and again
   * on every reconnect — see `ensureAgentStreamSubscription`'s call
   * site). An `"awaiting-confirmation"` row is deliberately never
   * auto-resent — see `resumePendingTurnOutboxEntries`'s own doc
   * comment. **T95** gave `turnOutbox.getRecoveredTurns()` its first
   * reader: `SessionTranscript`
   * (`../app/h/[serverId]/session/[agentId]/index.tsx`) reads it once
   * `open()` settles and renders each row through
   * `features/transcript/recovered-turn-banner.tsx`'s `RecoveredTurnBanner`.
   * **T106** gave `RecoveredTurnBanner` an optional `outbox` prop that
   * wires real Resend/Discard actions to `confirmResend`/`remove`
   * (`features/transcript/recovered-turn-model.ts`'s
   * `confirmRecoveredTurn`/`discardRecoveredTurn`); at the time, that
   * mount site did not pass this field's `getOutbox()` to it, because
   * `Composer`'s own `OutboxController` was a *separate instance* over
   * separate storage from this one, so doing so alone would not yet
   * have made a real, composer-sent turn confirmable/discardable
   * end-to-end.
   *
   * **T121 closed that split.** `SessionTranscript`'s `RecoveredTurnBanner`
   * mount and `SessionRoute`'s `Composer` mount (both
   * `../app/h/[serverId]/session/[agentId]/index.tsx`) now pass the
   * identical `core.turnOutbox.getOutbox() ?? undefined` expression as
   * their respective `outbox` props, so a real `OutboxController` from
   * THIS field — not a second, privately-constructed one — serves both.
   * `Composer.tsx` needed no edit: `ComposerProps.outbox` already
   * accepted an injected instance since T33B7, unused only because no
   * caller passed one. See T121's report for the counting-fake proof
   * that one instance now serves both a composer-style
   * `enqueue`/`markFailed` and a banner-style `confirmResend`.
   *
   * Always settles to `{ kind: "degraded", reason }` in production
   * today, for the identical reason `offlineCache` above does:
   * `createUnavailableSqliteDriverFactory()` is what this is built
   * with until `expo-sqlite` is installed (`npm install
   * expo-sqlite@~16.0.10 --workspace=@picompanion/android` — see
   * `../platform/offline/sqlite-driver-factory.ts`'s own doc comment for
   * the exact command). So `getOutbox()` still returns `null` on every
   * real device today, and `RecoveredTurnBanner`'s Resend/Discard
   * actions and `Composer`'s shared outbox still cannot appear there —
   * T121 wires the prop through anyway rather than leaving that gap
   * invisible, per this task's own brief.
   */
  turnOutbox: TurnOutboxOwner;
  /**
   * T69 (P5-W21): `createNativeShareIntentPort()`'s first live production
   * call site (`../features/share/share-intent-native-port.js`, T36F) —
   * constructed once here, the same "one process-lifetime singleton,
   * threaded down" shape `vibrationPlatform`/`settings`/`notifications`
   * above already follow. Falls back to
   * `createUnavailableShareIntentPort()` internally whenever
   * `requireOptionalNativeModule("ShareIntentModule")` returns `null` —
   * true in this sandbox, since no native Kotlin module is linked here;
   * that fallback is a real, honest "unavailable" answer (empty
   * `getInitialShareIntent()`, a `subscribe()` that never fires), not a
   * stub that throws — the identical shape `AppCore.notifications`
   * already established for the same "no native install this wave"
   * reason.
   *
   * `../../app/share.tsx` is this field's one production consumer: it
   * wraps this port in `../features/share/share-chooser-runtime.js`'s
   * `createShareChooserRuntime` and renders `ShareChooserScreen.tsx` —
   * see that route's own doc comment for the disclosed gap this task
   * files against T32S15 (nothing yet *navigates to* `/share`
   * automatically from elsewhere in the app; the route is reachable by
   * direct navigation and by its own cold-start `getInitialShareIntent()`
   * read once mounted).
   */
  shareIntentPort: ShareIntentPort;
  /**
   * T74: the one teardown entry point for this `AppCore`'s process
   * lifetime. Disposes every singleton this file constructs that has a
   * real lifetime to end — today that is `connection` (tears down its
   * active `DaemonClientLifecycle`, if any, and resets to idle),
   * `offlineCache` (see that field's doc comment; `OfflineCacheOwner.
   * dispose()` itself already settles a still-in-flight `open()` to
   * `"disposed"` rather than leaking a driver — T68's own "dispose()
   * called before open() ever resolves" test proves that half), and
   * `turnOutbox` (T76; `TurnOutboxOwner.dispose()` follows the
   * identical settle-in-flight-`open()` shape) — plus
   * detaching this file's own internal `connection.subscribe(...)`
   * listener (`stopWatchingConnectionForAgentStream` below) and the live
   * daemon client's `agent_stream` subscription
   * (`agentStreamClientUnsubscribe`), so neither keeps firing into a
   * shut-down core.
   *
   * Every other field on this interface (`keyValueStorage`,
   * `secureStorage`, `settings`, `vibrationPlatform`, `notifications`,
   * `piUiSession`, `pushRegistration`, `reconnectHostProfile`,
   * `sessionService`, `fileBrowserClient`, `filePicker`, `sharing`,
   * `shareIntentPort`, and the `create*`/`start*` factories) is either a
   * stateless adapter with
   * nothing to release, or
   * — like `network` — a resource whose only subscription is one a
   * *caller* took out and already owns disposing (`attachResumeSignals`'s
   * return value, `subscribeAgentStream`'s return value): this file never
   * subscribes to those itself, so there is nothing of theirs for
   * `shutdown()` to release. A future singleton that *does* open a real
   * resource (e.g. a native listener, a timer this file itself schedules)
   * must be added here, not left for a second, separate teardown path.
   *
   * Idempotent, like `OfflineCacheOwner.dispose()` and
   * `DaemonConnectionStore.dispose()` themselves: the first call starts
   * teardown and every later call — concurrent or sequential — returns
   * that exact same promise rather than tearing down twice or throwing.
   * `core-context.tsx`'s `AppCoreProvider` calls this once, from its own
   * unmount effect; see `core.test.ts`'s "AppCore.shutdown() (T74)" suite
   * for the proof, including the "still in flight" `offlineCache.open()`
   * case this doc comment describes above.
   */
  shutdown: () => Promise<void>;
}

/**
 * Test/DI seam for `createAppCore()` — every field defaults to the real
 * production adapter; a test overrides only what it needs deterministic
 * (e.g. `network`'s scheduler/probe) while still exercising the same
 * classes production uses, never a parallel fake type. See
 * `resume-wiring.test.ts`'s "a connectivity change reaches the same
 * controller" case.
 */
export interface CreateAppCoreOverrides {
  network?: {
    probe?: NetworkReachabilityProbe;
    intervalMs?: number;
    setInterval?: (callback: () => void, delayMs: number) => number;
    clearInterval?: (handle: number) => void;
  };
  /**
   * Test/DI seam for `AppCore.reconnectHostProfile` (T32S14) — mirrors
   * `network.probe`'s "every field defaults to the real production
   * adapter" shape. Reaches the exact same `connection.
   * DaemonClientLifecycle` construction a fresh direct/relay connect
   * already uses (`createReconnectHostProfile`'s own
   * `ReconnectHostProfileOptions.createDaemonClient`), so a test can
   * prove a reconnect actually reaches a connected lifecycle without a
   * real socket.
   */
  reconnect?: {
    createDaemonClient?: connection.DaemonClientFactory;
  };
  /**
   * Test/DI seam for `AppCore.offlineCache` (T68/T32S14; corrected at the
   * P5-W20 merge gate). Only `scope` exists here, and passing it opts the
   * resulting owner *out* of `APP_CORE_OFFLINE_SCOPE` — use it for a test
   * that needs its own `OfflineCacheOwner` to outlive a later
   * `createAppCore()` call, since a default-scoped owner is released the
   * moment the next default-scoped `AppCore` is built (see
   * `APP_CORE_OFFLINE_SCOPE`'s doc comment). Everything else — including
   * `core.test.ts`'s and `resume-wiring.test.ts`'s dozens of plain
   * `createAppCore()` calls — needs nothing here. Production never passes
   * it: it constructs exactly one `AppCore` for the process lifetime, on
   * the one fixed scope that keeps `OfflineCacheOwner`'s guard real.
   *
   * `driverFactory` (T74): overrides the driver factory
   * `AppCore.offlineCache` is built with — production always passes
   * `createUnavailableSqliteDriverFactory()` (see that field's doc
   * comment), which settles `open()` in one microtask, too fast for a
   * test to reliably observe `shutdown()` racing a still-open `open()`
   * call. A test that needs to hold `open()` pending — to prove
   * `shutdown()` correctly disposes an in-flight open rather than one
   * already settled — passes its own controllable `SqliteDriverFactory`
   * here instead.
   */
  offline?: {
    scope?: string;
    driverFactory?: SqliteDriverFactory;
  };
  /**
   * Test/DI seam for `AppCore.turnOutbox` (T76) — identical shape and
   * rationale to `offline` above, over `TurnOutboxOwner` instead of
   * `OfflineCacheOwner`: `scope` opts a test's owner out of
   * `APP_CORE_TURN_OUTBOX_SCOPE` (needed only when a test wants its own
   * owner to outlive a later `createAppCore()` call), and
   * `driverFactory` overrides production's
   * `createUnavailableSqliteDriverFactory()` default so a test can hold
   * `open()` pending, or seed rows into a `SqliteStructuredStorage`
   * built over a shared `InMemorySqliteDriver` backing array before
   * `createAppCore()` ever runs `recoverInFlightTurns` — exactly what a
   * "recovered turn arrives at the transcript after a simulated process
   * death" proof needs. Production never passes either field.
   */
  turnOutbox?: {
    scope?: string;
    driverFactory?: SqliteDriverFactory;
  };
}

/**
 * Builds the app's core adapter bundle. Phase 1 (T16) wired only the
 * fake network adapter behind `AppCore["network"]`; T32S1B added the real
 * `AppState` lifecycle adapter and the resume-signal wiring over both;
 * T32S3 replaced the fake network adapter with a real, probe-based one,
 * added the app-wide `connection` store and a real `keyValueStorage`.
 * Later phases replace remaining pieces of this bundle with real
 * adapters (Expo SQLite, Expo Notifications, and so on) without changing
 * how screens consume `AppCore`.
 */
export function createAppCore(overrides: CreateAppCoreOverrides = {}): AppCore {
  const lifecycle = createAppStateLifecycle();
  const connection = createDaemonConnectionStore(
    createDaemonConnectAttempt({
      clientId: ANDROID_DAEMON_CLIENT_ID,
      clientType: "mobile",
      appVersion: ANDROID_DAEMON_APP_VERSION,
    }),
  );
  const keyValueStorage = createExpoKeyValueStorage();
  const secureStorage = createExpoSecureStorage();
  const vibrationPlatform = createRNVibrationPlatform();
  // T32S11: one process-lifetime controller, same shape as
  // `vibrationPlatform` above — see `AppCore["settings"]`'s doc comment.
  const settings = createSettingsController({ storage: keyValueStorage });

  // T32S13 (P5-W19): twelve gates named this `null` stub. T32A7 (P5-W18)
  // carried a real `daemonAddress` on `DaemonConnectionSnapshot` — only
  // non-`null` on the "direct" connect path (never on relay, see
  // `daemon-connection-store.ts`'s module docstring), so this reads the
  // live snapshot fresh on every call (matching every other
  // `connection.getSnapshot()`/`getActiveLifecycle()` read in this file
  // — never a value captured once at construction) and turns it into an
  // `http(s)://host:port` origin via `buildDaemonHttpOrigin`, the exact
  // conversion `features/files/files-screen.tsx`'s `downloadOrigin`
  // below now shares. Still `null` before any direct connection, or on
  // the relay path — `createDefaultAndroidProbe` treats "no target yet"
  // as "nothing to disprove reachability with", not as offline (see its
  // doc comment), so this is a real answer, not a placeholder.
  // T32P1's `../platform/native-network-reachability.ts` supersedes
  // this probe entirely once `@react-native-community/netinfo` is
  // installed and this construction site switches to it; see that
  // module's doc comment — unrelated to this fix.
  const getProbeUrl = (): string | null => {
    const address = connection.getSnapshot().daemonAddress;
    return address ? buildDaemonHttpOrigin(address) : null;
  };
  const networkOverrides = overrides.network ?? {};
  const network: PollingNetworkReachability = createPollingNetworkReachability({
    probe: networkOverrides.probe ?? createDefaultAndroidProbe(getProbeUrl),
    ...(networkOverrides.intervalMs !== undefined
      ? { intervalMs: networkOverrides.intervalMs }
      : {}),
    ...(networkOverrides.setInterval !== undefined
      ? { setInterval: networkOverrides.setInterval }
      : {}),
    ...(networkOverrides.clearInterval !== undefined
      ? { clearInterval: networkOverrides.clearInterval }
      : {}),
  });

  // Read fresh on every `sessionService` method call (see that field's
  // doc comment) rather than captured once, so a later `connect()` (once
  // `connection-shell.tsx` sources its store from this one — the
  // disclosed gap) makes every method real without rebuilding
  // `sessionService` itself. The cast is this file's one: `DaemonClient`
  // (the real object `getDaemonClient()` returns in production) has
  // every method `DaemonSessionServiceClient` declares — see the
  // `sessionService` field's doc comment for why.
  const getSessionServiceClient = (): DaemonSessionServiceClient | null =>
    (connection.getActiveLifecycle()?.getDaemonClient() as DaemonSessionServiceClient | null) ??
    null;
  const sessionService = createDaemonSessionService(getSessionServiceClient);

  // See `AppCore["piUiSession"]`'s doc comment for the one gap this
  // constructor still leaves open (no live outbound transport yet — the
  // inbound `agent_stream` feed is wired below). This is still
  // `createPiUiSession` itself, not a hand-rolled stand-in — the store,
  // the action controller, and (via that module's `import "./renderers"`
  // side effect) every registered kind renderer are all real.
  const piUiSession = createPiUiSession({
    sendRequest: () => {
      // No-op: intentionally does nothing yet — see the disclosed gap
      // on `AppCore["piUiSession"]` above.
    },
  });

  // T32S13: shared by `createTurnService`/`startTurn` (below, in the
  // returned object) and — new this task (T76) —
  // `resumePendingTurnOutboxEntries` immediately below, which is why
  // this now lives here rather than next to `createTurnService`: it
  // must exist before `ensureAgentStreamSubscription` below can close
  // over it, since that function's *eager* call (right after its own
  // definition, "in case a test already adopted a live lifecycle") runs
  // synchronously during this same `createAppCore()` call, well before
  // this file would otherwise get around to defining it. Exact same
  // fresh-read-the-live-client `DaemonTurnTransport` shape either way —
  // see `AppCore["startTurn"]`'s doc comment for why `createTurnService`
  // and `startTurn` are two separate `AppCore` members rather than one.
  const getTurnTransport = (): DaemonTurnTransport => ({
    sendMessage: (targetAgentId, text, sendOptions) => {
      const client = connection
        .getActiveLifecycle()
        ?.getDaemonClient() as unknown as DaemonTurnTransport | null;
      if (!client) return Promise.reject(new Error("Not connected to a daemon"));
      return client.sendMessage(targetAgentId, text, sendOptions);
    },
    cancelAgent: (targetAgentId) => {
      const client = connection
        .getActiveLifecycle()
        ?.getDaemonClient() as unknown as DaemonTurnTransport | null;
      if (!client) return Promise.reject(new Error("Not connected to a daemon"));
      return client.cancelAgent(targetAgentId);
    },
  });

  // T76: `AppCore.turnOutbox`'s own doc comment above names this exact
  // construction site. Same "release a stale prior owner, then
  // fire-and-forget open()" shape `offlineCacheOwner` below uses, over
  // `../platform/offline/turn-outbox-owner.ts`'s `createTurnOutboxOwner`
  // instead of `createOfflineCacheOwner` — see
  // `APP_CORE_TURN_OUTBOX_SCOPE`'s doc comment for why a fixed scope
  // matters here too. Constructed before `ensureAgentStreamSubscription`
  // below (rather than alongside `offlineCacheOwner`, further down) so
  // that function's own eager call can safely reach it — see
  // `getTurnTransport` immediately above for the identical reason.
  if (activeAppCoreTurnOutboxOwner) {
    void activeAppCoreTurnOutboxOwner.dispose();
    activeAppCoreTurnOutboxOwner = null;
  }
  const turnOutboxOwner = createTurnOutboxOwner({
    driverFactory: overrides.turnOutbox?.driverFactory ?? createUnavailableSqliteDriverFactory(),
    clock: new SystemClock(),
    scope: overrides.turnOutbox?.scope ?? APP_CORE_TURN_OUTBOX_SCOPE,
  });
  if (overrides.turnOutbox?.scope === undefined) {
    activeAppCoreTurnOutboxOwner = turnOutboxOwner;
  }
  void turnOutboxOwner.open();

  /**
   * T76: drains `turnOutboxOwner.getOutbox()?.getAutoResendCandidates()`
   * — every `"prompt"` entry the one cold-start `recoverInFlightTurns`
   * pass (run inside `turnOutboxOwner.open()`) left `"pending"`, i.e.
   * every row `../platform/offline/turn-recovery.ts` calls outcome
   * `"resumed"` — by resending each one's `payload.text` through the
   * exact same `startDaemonTurn`/`getTurnTransport` pair
   * `AppCore.startTurn` itself uses below, so a recovered turn re-enters
   * the wire as a real `send_agent_message_request`, not a value sitting
   * unread in storage. This is the "hand `resumed` rows to the
   * composer's normal resend path" half `turn-recovery.ts`'s own doc
   * comment named as the still-missing piece.
   *
   * Deliberately does **not** touch an `"awaiting-confirmation"` entry:
   * silently resending one would be exactly the "duplicate submission on
   * restore" plan.md §7.2 forbids, and it is also not this function's
   * call to make — `getAutoResendCandidates()` already excludes every
   * status but `"pending"` (`outbox.ts`'s own contract), so this
   * function never even observes one. `SessionTranscript` (T95,
   * `../app/h/[serverId]/session/[agentId]/index.tsx`) now surfaces
   * `"awaiting-confirmation"` rows read-only, from `turnOutboxOwner.
   * getRecoveredTurns()` — never a silent drop. A control that actually
   * calls `confirmResend` for explicit user confirmation is still a
   * disclosed gap (see T95's own report).
   *
   * Called once from `ensureAgentStreamSubscription` below, on every
   * transition into having a live daemon client — cold start once
   * connected, and again on every reconnect. Safe to repeat: an entry a
   * prior pass already resolved (`markSent` deletes it; a resend still
   * `"sending"`/newly `"pending"` from this same process) is simply
   * absent from, or excluded from, the next `getAutoResendCandidates()`
   * read. Never throws past its own boundary — `startDaemonTurn` itself
   * already never throws (`turn-service.ts`'s own contract), and a
   * `markSending`/`markSent`/`markFailed` rejection here would only ever
   * come from the same in-memory `OutboxController` `recoverInFlightTurns`
   * already read from without incident moments earlier.
   */
  const resumePendingTurnOutboxEntries = async (): Promise<void> => {
    const outbox = turnOutboxOwner.getOutbox();
    if (!outbox) return;
    const candidates = await outbox.getAutoResendCandidates();
    for (const entry of candidates) {
      if (entry.kind !== "prompt") continue;
      const payload = entry.payload as { text?: unknown } | null;
      const text = typeof payload?.text === "string" ? payload.text : null;
      if (text === null) continue;
      await outbox.markSending(entry.id);
      const result = await startDaemonTurn(entry.sessionId, text, getTurnTransport());
      if (result.status === "started") {
        await outbox.markSent(entry.id);
      } else {
        await outbox.markFailed(entry.id, result.message);
      }
    }
  };

  // T32S8: the live `agent_stream` subscription `AppCore["piUiSession"]`'s
  // and `AppCore["subscribeAgentStream"]`'s doc comments describe. Narrow
  // shape for the one member `connection.DaemonClientLike`
  // (`packages/frontend-core/src/connection/daemon-client-lifecycle.ts`)
  // does not declare — same "the real production `DaemonClient` has it,
  // this file's cast documents the gap" pattern every other cast in this
  // file already uses (see `sessionService`'s doc comment).
  type AgentStreamCapableClient = {
    on(type: "agent_stream", handler: (message: AgentStreamMessage) => void): () => void;
  };
  const agentStreamListeners = new Set<(message: AgentStreamMessage) => void>();
  let agentStreamClientUnsubscribe: (() => void) | null = null;
  // Compared by reference against whatever `getDaemonClient()` returns
  // right now — `undefined`/`null` both normalize to `null` so "no active
  // client" is one stable value, not two.
  let subscribedAgentStreamClient: unknown = null;
  const ensureAgentStreamSubscription = (): void => {
    const client = connection.getActiveLifecycle()?.getDaemonClient() ?? null;
    if (client === subscribedAgentStreamClient) return;
    agentStreamClientUnsubscribe?.();
    agentStreamClientUnsubscribe = null;
    subscribedAgentStreamClient = client;
    if (!client) return;
    agentStreamClientUnsubscribe = (client as unknown as AgentStreamCapableClient).on(
      "agent_stream",
      (message) => {
        ingestPiUiAgentStreamMessage(piUiSession, message.payload);
        for (const listener of agentStreamListeners) listener(message);
      },
    );
    // T76: a fresh live daemon client — cold start once connected, or a
    // reconnect — is exactly the trigger `resumePendingTurnOutboxEntries`'s
    // own doc comment names. Fire-and-forget, matching every other
    // async side effect in this constructor (`offlineCacheOwner.open()`
    // below, etc.) — no caller here awaits `createAppCore()` itself, so
    // there is nothing to return this promise to.
    void resumePendingTurnOutboxEntries();
  };
  // Re-checked on every `connection` snapshot publish (every status
  // change, including a reconnect that swaps in a new `DaemonClient`
  // instance) so a torn-down lifecycle's subscription is always replaced,
  // never left dangling on a disposed client.
  // Captured (T74) rather than discarded, so `shutdown()` below can
  // detach this internal listener from `connection` — previously this
  // subscription outlived every `AppCore`, since nothing ever called the
  // function `connection.subscribe` returns.
  const stopWatchingConnectionForAgentStream = connection.subscribe(() =>
    ensureAgentStreamSubscription(),
  );
  // Also run once now, in case `overrides`/a test already adopted a live
  // lifecycle onto `connection` before this line runs.
  ensureAgentStreamSubscription();

  // Same fresh-read shape as `getSessionServiceClient` above, wrapped as
  // a stable `FileBrowserClient` object (`listDirectory` reads
  // `connection` fresh on every call) rather than a function a caller
  // would have to re-invoke — `FilesScreen`'s `client` prop is a value,
  // not a getter.
  const getFileBrowserDaemonClient = (): FileBrowserClient | null =>
    (connection.getActiveLifecycle()?.getDaemonClient() as unknown as FileBrowserClient | null) ??
    null;
  const fileBrowserClient: FileBrowserClient = {
    listDirectory: (cwd, path) => {
      const client = getFileBrowserDaemonClient();
      if (!client) {
        return Promise.reject(new Error(FILE_BROWSER_NOT_CONNECTED));
      }
      return client.listDirectory(cwd, path);
    },
    // T32S7: forwards T35A2's read half of the same client, closing the
    // defect this task's brief named — until now this object literal
    // forwarded `listDirectory` only, so `readFile` was `undefined` and
    // every file open rendered "Not connected" (`FILE_READ_NOT_CONNECTED`,
    // `file-view-model.ts`'s documented behaviour for a client with no
    // `readFile`) even once listing worked. Same fresh-read/no-client
    // shape as `listDirectory` above; the real production `DaemonClient`
    // `getFileBrowserDaemonClient()` casts to has `readFile` (same cast
    // this field's own doc comment already covers), so this reaches
    // T35A2's real daemon RPC + Lezer highlighting path once connected.
    readFile: (cwd, path) => {
      const client = getFileBrowserDaemonClient();
      if (!client?.readFile) {
        return Promise.reject(new Error(FILE_READ_NOT_CONNECTED));
      }
      return client.readFile(cwd, path);
    },
    // P5-W12 merge gate: forwards T35A3's write half, exactly as T32S7
    // forwarded `readFile` above and for the identical reason. T35A3
    // (`file-edit-model.ts`, `files-screen.tsx`) landed after T32S8 in
    // this wave, so T32S8 could not pick up a member that did not exist
    // when it ran; without this forward `writeFile` stays `undefined` on
    // the object `SessionFilesRoute` passes as `client`, and every save
    // resolves `FILE_WRITE_NOT_CONNECTED` no matter how healthy the
    // connection is -- the whole native editor inert in production, the
    // exact failure T32S7's missing `readFile` forward caused last wave.
    // Same fresh-read/no-client shape; the real `DaemonClient` this
    // getter casts to has `writeFile` (`packages/client/src/daemon-
    // client.ts`), matching `FileWriteInput`/`FileWriteResult`
    // structurally, so this reaches T35A3's real daemon RPC once
    // connected.
    writeFile: (input) => {
      const client = getFileBrowserDaemonClient();
      if (!client?.writeFile) {
        return Promise.reject(new Error(FILE_WRITE_NOT_CONNECTED));
      }
      return client.writeFile(input);
    },
  };

  // T32S12: no `expo-notifications`/`expo-device` installed this wave
  // (T60C's grant) — see `AppCore["notifications"]`'s doc comment.
  const notifications = createUnavailableAndroidNotificationsPlatform();

  // T32S13: the narrowest slice of the real `DaemonClient` T61B's
  // `PushTokenRegistrar` needs (`registerPushToken`/`unregisterPushToken`
  // — `packages/client/src/daemon-client.ts`), read fresh on every call,
  // same "Not connected to a daemon" shape `getTurnTransport` above
  // uses. A synchronous throw (never a rejected promise — see
  // `PushRegistrationController`'s own doc comment on why its methods
  // must never let one escape) is what `createPushRegistrationController`
  // requires and already handles as a named `PushTokenRefreshOutcome`.
  type DaemonPushRegistrarClient = {
    registerPushToken(token: string): void;
    unregisterPushToken(token: string): void;
  };
  const pushRegistrar = {
    registerPushToken: (token: string) => {
      const client = connection
        .getActiveLifecycle()
        ?.getDaemonClient() as unknown as DaemonPushRegistrarClient | null;
      if (!client) throw new Error("Not connected to a daemon");
      client.registerPushToken(token);
    },
    unregisterPushToken: (token: string) => {
      const client = connection
        .getActiveLifecycle()
        ?.getDaemonClient() as unknown as DaemonPushRegistrarClient | null;
      if (!client) throw new Error("Not connected to a daemon");
      client.unregisterPushToken(token);
    },
  };
  const pushRegistration = createPushRegistrationController({
    registrar: pushRegistrar,
    secureStorage,
  });

  // T32S14: bound once, like `pushRegistration` above — see
  // `AppCore["reconnectHostProfile"]`'s doc comment.
  const reconnectHostProfile = createReconnectHostProfile({
    clientId: ANDROID_DAEMON_CLIENT_ID,
    clientType: "mobile",
    appVersion: ANDROID_DAEMON_APP_VERSION,
    ...(overrides.reconnect?.createDaemonClient !== undefined
      ? { createDaemonClient: overrides.reconnect.createDaemonClient }
      : {}),
  });

  // T68/T32S14: see `AppCore["offlineCache"]`'s doc comment, and
  // `offline-cache-owner.ts`'s own filed "mount seam" doc section for
  // why this is exactly the shape (`driverFactory`/`clock`) that module
  // asked for. Fire-and-forget: production has no caller that awaits
  // this promise, only ones that read `getCache()`/`getStatus()` later.
  // `scope` defaults to the single fixed `APP_CORE_OFFLINE_SCOPE` (see
  // that constant's doc comment for why a per-call unique scope silently
  // disarmed T68's guard). Building a second `AppCore` in one process
  // releases the first one's owner rather than opening a second cache
  // over the same store.
  if (activeAppCoreOfflineCacheOwner) {
    void activeAppCoreOfflineCacheOwner.dispose();
    activeAppCoreOfflineCacheOwner = null;
  }
  const offlineCacheOwner = createOfflineCacheOwner({
    driverFactory: overrides.offline?.driverFactory ?? createUnavailableSqliteDriverFactory(),
    clock: new SystemClock(),
    scope: overrides.offline?.scope ?? APP_CORE_OFFLINE_SCOPE,
  });
  if (overrides.offline?.scope === undefined) {
    activeAppCoreOfflineCacheOwner = offlineCacheOwner;
  }
  void offlineCacheOwner.open();

  // T69: see `AppCore["shareIntentPort"]`'s doc comment.
  const shareIntentPort = createNativeShareIntentPort();

  // T78: see `AppCore["filePicker"]`'s doc comment.
  const filePicker = createUnavailableFilePicker();
  // T78: see `AppCore["sharing"]`'s doc comment.
  const sharing = createFileSharingUnavailableSharing(createRNShareModule());

  // T80: see `AppCore["terminalWebview"]`'s doc comment.
  const terminalWebview = createUnavailableTerminalWebViewPort();

  // T74: see `AppCore["shutdown"]`'s doc comment. `shutdownPromise` is
  // the idempotency latch — the same "cache the promise, never redo the
  // work" shape `OfflineCacheOwner.open()` already uses for the same
  // reason (see that method's own doc comment).
  let shutdownPromise: Promise<void> | null = null;
  async function performShutdown(): Promise<void> {
    stopWatchingConnectionForAgentStream();
    agentStreamClientUnsubscribe?.();
    agentStreamClientUnsubscribe = null;
    subscribedAgentStreamClient = null;
    // This `AppCore`'s own offline owner is being disposed right here;
    // clear the module-level "most recent owner" bookkeeping so a later
    // `createAppCore()` in the same process (a test, or a dev-time
    // provider remount) does not redundantly re-dispose an owner it no
    // longer needs to release — see `activeAppCoreOfflineCacheOwner`'s own
    // doc comment. Harmless either way (`OfflineCacheOwner.dispose()` is
    // idempotent), but this keeps the bookkeeping honest.
    if (activeAppCoreOfflineCacheOwner === offlineCacheOwner) {
      activeAppCoreOfflineCacheOwner = null;
    }
    // T76: identical bookkeeping, for the identical reason, over
    // `turnOutboxOwner` — see `activeAppCoreTurnOutboxOwner`'s own doc
    // comment.
    if (activeAppCoreTurnOutboxOwner === turnOutboxOwner) {
      activeAppCoreTurnOutboxOwner = null;
    }
    await Promise.all([
      connection.dispose(),
      offlineCacheOwner.dispose(),
      turnOutboxOwner.dispose(),
    ]);
  }

  return {
    network,
    lifecycle,
    connection,
    keyValueStorage,
    sessionService,
    secureStorage,
    piUiSession,
    fileBrowserClient,
    // T78: see `AppCore["filePicker"]`'s doc comment.
    filePicker,
    // T78: see `AppCore["sharing"]`'s doc comment.
    sharing,
    settings,
    notifications,
    subscribeAgentStream: (listener) => {
      agentStreamListeners.add(listener);
      return () => {
        agentStreamListeners.delete(listener);
      };
    },
    attachResumeSignals: (target, options) =>
      attachResumeSignals({ ...options, lifecycle, network, target }),
    vibrationPlatform,
    // T32S12: see `AppCore["createTerminalTransport"]`'s doc comment and
    // `./terminal-transport-adapter.ts`'s module doc for the encode/
    // decode bridge and reconnect policy. Same "type-only cast against a
    // locally-declared structural interface, never a value import of
    // `@picompanion/client`" pattern `AgentStreamCapableClient` above
    // already uses — `@picompanion/client` is not a declared dependency
    // of `apps/android` (confirmed: absent from `package.json`), so a
    // value import here would trip `run-guard-declared-workspace-deps`
    // exactly as an undeclared `@picompanion/highlight` import already
    // does; this cast needs no such import.
    createTerminalTransport: (terminalId, slot) =>
      createDaemonTerminalBinaryTransport({
        terminalId,
        slot,
        getClient: () =>
          (connection
            .getActiveLifecycle()
            ?.getDaemonClient() as unknown as TerminalSessionCapableClient | null) ?? null,
        subscribeConnectionChanges: (listener) => connection.subscribe(listener),
      }),
    // T80: see `AppCore["terminalWebview"]`'s doc comment.
    terminalWebview,
    // T32S12: see `AppCore["createTurnService"]`'s doc comment. Same
    // type-only-cast-against-a-locally-declared-structural-interface
    // pattern as `createTerminalTransport`/`AgentStreamCapableClient`
    // above — `DaemonTurnTransport` (`../features/sessions/
    // turn-service.js`, T63) needs only `sendMessage`/`cancelAgent`,
    // both already public on the real `DaemonClient`.
    createTurnService: (agentId) => createDaemonTurnService(agentId, getTurnTransport()),
    // T32S13: see `AppCore["startTurn"]`'s doc comment.
    startTurn: (agentId, text) => startDaemonTurn(agentId, text, getTurnTransport()),
    // T32S13: see `AppCore["pushRegistration"]`'s doc comment.
    pushRegistration,
    // T32S13: see `AppCore["startPushRegistration"]`'s doc comment.
    startPushRegistration: async () => {
      const port = createUnavailablePushRegistrationPort();
      await registerForPush(port, pushRegistration);
      return attachTokenRefresh(port, pushRegistration);
    },
    // T32S14: see `AppCore["reconnectHostProfile"]`'s doc comment.
    reconnectHostProfile,
    // T68/T32S14: see `AppCore["offlineCache"]`'s doc comment.
    offlineCache: offlineCacheOwner,
    // T76: see `AppCore["turnOutbox"]`'s doc comment.
    turnOutbox: turnOutboxOwner,
    // T69: see `AppCore["shareIntentPort"]`'s doc comment.
    shareIntentPort,
    // T74: see `AppCore["shutdown"]`'s doc comment.
    shutdown: () => {
      if (!shutdownPromise) {
        shutdownPromise = performShutdown();
      }
      return shutdownPromise;
    },
  };
}
