/**
 * Constructs and owns `./turn-recovery.ts`'s `OutboxController` +
 * cold-start `recoverInFlightTurns` pass — T76, plan.md
 * §7.1/§7.2/§12.5 ("restore correctly when the process is killed
 * mid-turn... no duplicate submission occurs on restore... the
 * recovered turn continues or fails explicitly").
 *
 * `turn-recovery.ts`'s own doc comment named the exact gap this file
 * closes: `createTurnOutbox`/`recoverInFlightTurns` were built (T37C,
 * P5-W13) and unit-tested, but nothing in this repository ever
 * constructed an `OutboxController` over a real `StructuredStorage` and
 * called `recoverInFlightTurns` with it — the P5-W20 merge gate's own
 * `background-kill-restore.contract.test.ts` PREMISE 3 pinned that
 * absence directly (`core.ts` "constructs no OutboxController and
 * calls recoverInFlightTurns nowhere"), and named `createTurnOutbox`/
 * `recoverInFlightTurns` as still ownerless even after T68 gave
 * `OfflineCache` a lifecycle owner in the same wave.
 *
 * ## Why a separate owner, not a shared `OfflineCacheOwner` storage
 *
 * `OfflineCacheOwner` (`./offline-cache-owner.ts`, T68) does not expose
 * the `SqliteStructuredStorage` instance it builds — only
 * `getCache()`/`getStatus()` — so this module opens its own
 * `SqliteDriver` via its own injected `SqliteDriverFactory`, following
 * the identical open/degraded/dispose shape `OfflineCacheOwner` already
 * established (see that file's doc comment for the rationale each rule
 * below repeats). Both this owner and `OfflineCacheOwner` are
 * constructed with `createUnavailableSqliteDriverFactory()` in
 * production today (`expo-sqlite` is still not installed — T60C's
 * grant), so there is no real SQLite file for the two to actually race
 * over yet; the day a real factory lands, `app-shell/core.ts`'s mount
 * site can pass each owner its own `SqliteDriverFactory` bound to a
 * distinct database name (`SqliteDriverFactory.open()`'s own contract
 * says nothing about a fixed file), which is a construction-site change
 * only, not a change to either owner class.
 *
 * ## Degraded state (T76, mirroring T68's second acceptance criterion)
 *
 * `open()` never throws and never rejects. A `driverFactory.open()`
 * failure — including production's honest, permanent "expo-sqlite is
 * not installed" failure — lands the owner in `{ kind: "degraded",
 * reason }`, and `getOutbox()`/`getRecoveredTurns()` keep returning
 * `null` from then on. The app keeps running: a caller reading
 * `getOutbox()` sees the same "nothing to read yet, but nothing
 * crashed either" shape `OfflineCacheOwner.getCache()` already
 * establishes.
 *
 * ## Recovery runs exactly once per open()
 *
 * `doOpen` calls `recoverInFlightTurns` synchronously within the same
 * `open()` promise that constructs the outbox — by the time `open()`
 * resolves `"ready"`, every pre-existing outbox row has already been
 * reconciled into one of `recoverInFlightTurns`'s two named outcomes
 * (`turn-recovery.ts`'s own doc comment). A caller never sees a
 * not-yet-recovered `OutboxController`.
 *
 * ## One construction per scope
 *
 * Identical guard to `OfflineCacheOwner`'s: the constructor throws
 * synchronously if another, still-undisposed `TurnOutboxOwner` already
 * exists for the same `scope` (default `"default"`) — two
 * `SqliteStructuredStorage` instances racing writes against the same
 * underlying file is exactly what this prevents.
 *
 * ## The mount seam this task fills in `app-shell/core.ts`
 *
 * Unlike `OfflineCacheOwner` (which T68 built but explicitly left
 * unmounted for T32S14 to wire), this task owns the mount site itself
 * — see `core.ts`'s `turnOutbox` field and `resumePendingTurnOutboxEntries`
 * for the construction, the "resend on every fresh connection" trigger,
 * and why recovered `"awaiting-confirmation"` rows are deliberately left
 * for a later, disclosed UI gap rather than silently auto-resent (this
 * module's own `getRecoveredTurns()` still reports them, so a future
 * screen has a real source of truth to render from).
 */
import { composer as coreComposer, type Clock } from "@picompanion/frontend-core";

import type { SqliteDriver } from "./sqlite-driver.js";
import type { SqliteDriverFactory } from "./sqlite-driver-factory.js";
import {
  SqliteStructuredStorage,
  type SqliteStructuredStorageOptions,
} from "./sqlite-structured-storage.js";
import {
  createTurnOutbox,
  recoverInFlightTurns,
  type RecoverInFlightTurnsOptions,
  type RecoveredTurn,
} from "./turn-recovery.js";

/**
 * Named, honest state a mount site or diagnostics screen can render —
 * identical shape to `OfflineCacheOwnerStatus` (`./offline-cache-
 * owner.ts`) for the same reason: `"opening"` until `open()`'s first
 * call settles, `"disposed"` is terminal.
 */
export type TurnOutboxOwnerStatus =
  | { readonly kind: "opening" }
  | { readonly kind: "ready" }
  | { readonly kind: "degraded"; readonly reason: string }
  | { readonly kind: "disposed" };

export interface TurnOutboxOwnerOptions {
  /** Opens (or fails to open) this owner's backing `SqliteDriver`. Production passes `createUnavailableSqliteDriverFactory()` until `expo-sqlite` lands — see this module's doc comment. */
  driverFactory: SqliteDriverFactory;
  /** Forwarded to `createTurnOutbox`'s `OutboxController`. */
  clock: Clock;
  /**
   * Distinguishes independently-lifecycled owners. At most one
   * undisposed `TurnOutboxOwner` may exist per scope at a time. Defaults
   * to `"default"`.
   */
  scope?: string;
  /** Forwarded to `SqliteStructuredStorage`, minus `driver` (supplied internally once `driverFactory.open()` resolves). */
  storage?: Omit<SqliteStructuredStorageOptions, "driver">;
  /** Forwarded to the one `recoverInFlightTurns` pass `open()` runs. */
  recovery?: RecoverInFlightTurnsOptions;
}

const DEFAULT_SCOPE = "default";
/** Scopes with a currently undisposed `TurnOutboxOwner` — module-level so the guard holds process-wide, cleared by `dispose()`. */
const activeScopes = new Set<string>();

/**
 * Owns one turn outbox's full lifetime: opening its storage, running
 * the one cold-start `recoverInFlightTurns` pass, and disposing the
 * driver. See this module's doc comment for the degraded-state and
 * one-construction-per-scope guarantees.
 */
export class TurnOutboxOwner {
  private readonly options: TurnOutboxOwnerOptions;
  private readonly scope: string;
  private status: TurnOutboxOwnerStatus = { kind: "opening" };
  private outbox: coreComposer.OutboxController | null = null;
  private recoveredTurns: RecoveredTurn[] | null = null;
  private driver: SqliteDriver | null = null;
  private openPromise: Promise<TurnOutboxOwnerStatus> | null = null;

  constructor(options: TurnOutboxOwnerOptions) {
    this.scope = options.scope ?? DEFAULT_SCOPE;
    if (activeScopes.has(this.scope)) {
      throw new Error(
        `TurnOutboxOwner: scope "${this.scope}" already has an undisposed owner. ` +
          "Construct at most one TurnOutboxOwner per scope at a time; call dispose() " +
          "on the existing one first if you really mean to replace it.",
      );
    }
    activeScopes.add(this.scope);
    this.options = options;
  }

  /**
   * Idempotent: the first call opens the driver, constructs the outbox,
   * and runs the one cold-start recovery pass; every call made while
   * that is in flight, or after it has settled, returns the exact same
   * resolved (or still-pending) promise. Never rejects — see this
   * module's "Degraded state" doc comment.
   */
  open(): Promise<TurnOutboxOwnerStatus> {
    if (!this.openPromise) {
      this.openPromise = this.doOpen();
    }
    return this.openPromise;
  }

  private isDisposed(): boolean {
    return this.status.kind === "disposed";
  }

  private async doOpen(): Promise<TurnOutboxOwnerStatus> {
    if (this.isDisposed()) {
      return this.status;
    }
    try {
      const driver = await this.options.driverFactory.open();
      if (this.isDisposed()) {
        await driver.closeAsync?.();
        return this.status;
      }
      this.driver = driver;
      const storage = new SqliteStructuredStorage({ driver, ...this.options.storage });
      const outbox = createTurnOutbox(storage, this.options.clock);
      const recovered = await recoverInFlightTurns(outbox, this.options.recovery);
      if (this.isDisposed()) {
        return this.status;
      }
      this.outbox = outbox;
      this.recoveredTurns = recovered;
      this.status = { kind: "ready" };
    } catch (error) {
      if (this.isDisposed()) {
        return this.status;
      }
      this.status = {
        kind: "degraded",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return this.status;
  }

  getStatus(): TurnOutboxOwnerStatus {
    return this.status;
  }

  /** The live `OutboxController`, once `open()` has resolved `"ready"`; `null` in every other status. */
  getOutbox(): coreComposer.OutboxController | null {
    return this.status.kind === "ready" ? this.outbox : null;
  }

  /**
   * Every row's outcome from this owner's one cold-start
   * `recoverInFlightTurns` pass, once `open()` has resolved `"ready"`;
   * `null` in every other status. A mount site drains the `"resumed"`
   * ones automatically (see `core.ts`'s `resumePendingTurnOutboxEntries`)
   * and surfaces the `"awaiting-confirmation"` ones for explicit user
   * confirmation — this getter is the source of truth for the latter.
   */
  getRecoveredTurns(): RecoveredTurn[] | null {
    return this.status.kind === "ready" ? this.recoveredTurns : null;
  }

  /**
   * Ends this owner's lifetime — identical shape to
   * `OfflineCacheOwner.dispose()`: waits out any in-flight `open()`
   * first, closes the underlying driver via its optional `closeAsync`,
   * frees this owner's `scope` for reuse, and makes
   * `getOutbox()`/`getRecoveredTurns()` return `null` forever after.
   * Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.status.kind === "disposed") {
      return;
    }
    const openPromise = this.openPromise;
    this.status = { kind: "disposed" };
    activeScopes.delete(this.scope);
    if (openPromise) {
      await openPromise.catch(() => {});
    }
    const driver = this.driver;
    this.outbox = null;
    this.recoveredTurns = null;
    this.driver = null;
    if (driver?.closeAsync) {
      await driver.closeAsync();
    }
  }
}

/**
 * The one production-facing construction entry point — matches
 * `OfflineCacheOwner`'s `createOfflineCacheOwner` naming convention.
 */
export function createTurnOutboxOwner(options: TurnOutboxOwnerOptions): TurnOutboxOwner {
  return new TurnOutboxOwner(options);
}
