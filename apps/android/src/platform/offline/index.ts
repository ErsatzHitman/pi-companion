/**
 * Android offline-cache platform adapter (T37A/T37B/T37C, plan.md
 * §7.1/§7.2/§7.3/§7.4/§12.5).
 *
 * Backs `@picompanion/frontend-core`'s `offline.OfflineCache` with a
 * real `StructuredStorage` — `SqliteStructuredStorage` — over an
 * injected `SqliteDriver` port. See `./sqlite-driver.ts` for why the
 * driver is a port rather than a direct `expo-sqlite` import (the real
 * adapter lives in `./expo-sqlite-driver-factory.ts`, and the port keeps
 * every rule provable without loading the native module), and
 * `./sqlite-structured-storage.ts` for the bound and secret-exclusion
 * policies.
 *
 * T37B extended T37A with the "mark cached data stale until catch-up"
 * pieces: `./timeline-cache.ts` bridges `OfflineCache` with
 * `frontend-core`'s `timeline` domain (caching/restoring a session's
 * tail, and confirming catch-up without ever reimplementing the real
 * reducer's dedupe/gap logic), and `./stale-announcement.ts` turns
 * staleness into a structured reason + timestamp + human sentence a
 * screen can render.
 *
 * T37C (this wave) adds `./turn-recovery.ts`: recovering an in-flight
 * turn after the process is killed mid-turn, over
 * `frontend-core`'s existing `composer.OutboxController` (T22) rather
 * than a second queue — see that module's own doc comment for the
 * three windows a kill can land in and why no duplicate submission can
 * result.
 *
 * None of these render anything — see each module's own doc comment
 * for exactly which unowned-this-wave feature task is expected to
 * mount it.
 *
 * This module is separate from `../index.ts` (the rest of `platform/`,
 * T32P1's grant this wave): T37A/T37B/T37C own only `platform/offline/`.
 *
 * ## Construction now has an owner (T68, P5-W20)
 *
 * The paragraph this doc comment used to have here said, across twelve
 * consecutive merge gates, that nothing in this repository constructed
 * an `OfflineCache` — only tests did. `./offline-cache-owner.ts`'s
 * `OfflineCacheOwner`/`createOfflineCacheOwner` is that owner: it opens
 * a `SqliteDriver` via an injected `SqliteDriverFactory`
 * (`./sqlite-driver-factory.ts`), constructs `SqliteStructuredStorage`
 * and `OfflineCache` over it exactly once, lands in a named
 * `"degraded"` state if opening fails (the honest answer whenever the
 * native `ExpoSQLite` module is genuinely unavailable), and disposes
 * both when its own `dispose()` is called.
 * `./offline-cache-owner.ts`'s own doc comment has the full contract
 * and the exact `AppCore`/`app-shell/core.ts` mount seam this task filed
 * (that file is this wave's router-root owner's — T32S14, not this
 * task's grant).
 *
 * ## `createTurnOutbox`/`recoverInFlightTurns` now have an owner too (T76)
 *
 * `./turn-outbox-owner.ts`'s `TurnOutboxOwner`/`createTurnOutboxOwner`
 * mirrors `OfflineCacheOwner`'s shape exactly (own `SqliteDriverFactory`,
 * own degraded state, own `dispose()`) but over `createTurnOutbox`'s
 * `OutboxController` instead of `OfflineCache` — `open()` also runs the
 * one cold-start `recoverInFlightTurns` pass before settling `"ready"`,
 * so a caller never observes a not-yet-recovered outbox. `app-shell/
 * core.ts`'s `AppCore.turnOutbox` is this task's own mount site — see
 * that file's `resumePendingTurnOutboxEntries` for how a `"resumed"`
 * row is actually resent (never a silent auto-resend of an
 * `"awaiting-confirmation"` one).
 *
 * `expo-sqlite` is installed (T390; see `./sqlite-driver.ts`'s doc
 * comment). `./expo-sqlite-driver-factory.ts`'s
 * `createExpoSqliteDriverFactory` is what `AppCore` passes to both
 * `createOfflineCacheOwner`/`createTurnOutboxOwner` in production — see
 * `app-shell/core.ts`. `createUnavailableSqliteDriverFactory` remains
 * the honest factory for a build where the native module is genuinely
 * missing, and for tests/fakes.
 */
export type { SqliteDriver, SqliteRunResult } from "./sqlite-driver.js";
export {
  DEFAULT_MAX_ROWS_PER_COLLECTION,
  OFFLINE_CACHE_SQL,
  SqliteStructuredStorage,
  type SqliteStructuredStorageOptions,
} from "./sqlite-structured-storage.js";
export { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
export {
  createOfflineCacheOwner,
  OfflineCacheOwner,
  type OfflineCacheOwnerOptions,
  type OfflineCacheOwnerStatus,
} from "./offline-cache-owner.js";
export {
  createTurnOutboxOwner,
  TurnOutboxOwner,
  type TurnOutboxOwnerOptions,
  type TurnOutboxOwnerStatus,
} from "./turn-outbox-owner.js";
export {
  createUnavailableSqliteDriverFactory,
  type SqliteDriverFactory,
} from "./sqlite-driver-factory.js";
export {
  createExpoSqliteDriverFactory,
  type ExpoSqliteBindings,
  type ExpoSqliteDatabase,
} from "./expo-sqlite-driver-factory.js";
export {
  TIMELINE_SNAPSHOT_COLLECTION,
  cacheTimelineTail,
  confirmTimelineCatchUp,
  createTimelineCache,
  loadTimelineCacheEnvelope,
  restoreTimelineTail,
} from "./timeline-cache.js";
export { describeSessionListStaleness, describeTimelineStaleness } from "./stale-announcement.js";
export type {
  SessionListStalenessInput,
  StalenessAnnouncement,
  StalenessReason,
  TimelineStalenessInput,
} from "./stale-announcement.js";
export {
  RECOVERED_TURN_OUTCOMES,
  TURN_RECOVERY_REASON,
  createTurnOutbox,
  recoverInFlightTurns,
} from "./turn-recovery.js";
export type {
  RecoverInFlightTurnsOptions,
  RecoveredTurn,
  RecoveredTurnOutcome,
} from "./turn-recovery.js";
