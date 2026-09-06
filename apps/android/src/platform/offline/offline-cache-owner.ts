/**
 * Constructs and owns `@picompanion/frontend-core`'s `offline.OfflineCache`
 * lifecycle — T68, plan.md §7.1/§7.3/§12.5.
 *
 * `platform/offline/index.ts`'s own header said, across twelve
 * consecutive merge gates, that nothing in this repository had ever
 * constructed an `OfflineCache` — only tests did. This module is the
 * first thing that does, genuinely, for production: `AppCore` (see the
 * mount seam below) constructs exactly one `OfflineCacheOwner`, which
 * opens its backing storage lazily, hands out the live `OfflineCache`
 * once ready, and disposes it when the app's process lifetime ends.
 *
 * ## Why an owner class, not a bare `OfflineCache` field
 *
 * `OfflineCache` itself (`@picompanion/frontend-core`) is a thin
 * stateless-except-for-storage facade — it has no `open`/`dispose` of
 * its own, because it does not know whether its `StructuredStorage` is
 * backed by something with a real lifetime (a SQLite file handle) or an
 * in-memory fake that needs none. Something above it has to own that
 * question. That is this class: it owns *opening* the driver
 * (`SqliteDriverFactory.open()`, `./sqlite-driver-factory.ts`),
 * *constructing* the `SqliteStructuredStorage` and `OfflineCache` over
 * it exactly once, and *disposing* the driver when the owner's own
 * lifetime ends.
 *
 * ## Degraded state (T68's second acceptance criterion)
 *
 * `open()` never throws and never rejects. A `driverFactory.open()`
 * failure — including production's honest, permanent "expo-sqlite is
 * not installed" failure (`createUnavailableSqliteDriverFactory`) —
 * lands the owner in `{ kind: "degraded", reason }`, and `getCache()`
 * keeps returning `null` from then on. The app keeps running: every
 * caller reading `getCache()` sees the same "nothing to read yet, but
 * nothing crashed either" shape `AppCore`'s other daemon-backed fields
 * already use for "no active connection" (see `app-shell/core.ts`'s
 * `sessionService` doc comment) — a cache miss the caller renders
 * around, never an unhandled rejection. This only holds while the owner
 * itself is still live: if `dispose()` has already run by the time a
 * rejection arrives, `doOpen`'s `catch` leaves the terminal `"disposed"`
 * status alone rather than overwriting it with `"degraded"` (T82) — the
 * same rule its two resolve-path `isDisposed()` guards already apply to
 * a late-arriving open.
 *
 * ## One construction per scope (T68's fourth acceptance criterion)
 *
 * The constructor throws synchronously if another, still-undisposed
 * `OfflineCacheOwner` already exists for the same `scope` (default
 * `"default"`) — see the class doc comment below for why this has to be
 * a hard prevention (two `SqliteStructuredStorage` instances racing
 * writes against the same underlying file) rather than a comment asking
 * callers to be careful.
 *
 * ## Secrets (T68's third acceptance criterion)
 *
 * This module adds no new place secret material could reach plain
 * storage, a log, or a URL: every write still funnels through
 * `SqliteStructuredStorage.put`'s existing `assertNotSecretShaped` guard
 * (`./sqlite-structured-storage.ts`), and the only new persistent
 * surface this file introduces — `OfflineCacheOwnerStatus`'s `reason`
 * string — never touches storage or a URL; a caller that wants to show
 * it does so in-memory, in the UI, the same way `AppCore.notifications`'
 * `getPermissionState()` result already is.
 *
 * ## The mount seam this task files against `app-shell/core.ts`
 *
 * `app-shell/core.ts` is this wave's router-root owner's file (T32S14,
 * P5-W20) — not this task's grant — so this task does not edit it.
 * `AppCore` should add:
 *
 * ```ts
 * import {
 *   createOfflineCacheOwner,
 *   createUnavailableSqliteDriverFactory,
 * } from "../platform/offline/index.js";
 *
 * const offlineCacheOwner = createOfflineCacheOwner({
 *   driverFactory: createUnavailableSqliteDriverFactory(), // swap for a real
 *     // factory once expo-sqlite is installed — see
 *     // ./sqlite-driver-factory.ts's doc comment for the exact command
 *     // and what a real factory looks like.
 *   clock: someRealClock, // e.g. a small local `SystemClock`, the same
 *     // shape `features/approvals/ApprovalsContainer.tsx`'s already does
 *     // for `PermissionsController` — no shared `platform/clock.ts`
 *     // exists on Android yet (see that file's own doc comment).
 * });
 * void offlineCacheOwner.open(); // fire-and-forget; AppCore.offlineCache
 *   // below exposes getCache()/getStatus() for callers to poll/read.
 * ```
 *
 * and expose `offlineCacheOwner` (or just its `getCache`/`getStatus`/
 * `dispose`) on the `AppCore` interface, and call
 * `offlineCacheOwner.dispose()` wherever `AppCore`'s own process
 * lifetime ends (there is no such teardown path in this app today — see
 * this task's report for that disclosed gap: `createAppCore()` has no
 * "app is shutting down" hook to call it from yet, so in production this
 * owner's `dispose()` is reachable but never actually called before
 * process exit; the tests below still prove `dispose()` itself works
 * correctly when a caller does invoke it).
 *
 * Once a real `SqliteDriverFactory` exists (post-`expo-sqlite`-install),
 * only the `driverFactory` argument above changes — nothing else in this
 * file, `AppCore`, or `@picompanion/frontend-core`.
 */
import { offline as coreOffline, type Clock } from "@picompanion/frontend-core";

import type { SqliteDriver } from "./sqlite-driver.js";
import type { SqliteDriverFactory } from "./sqlite-driver-factory.js";
import {
  SqliteStructuredStorage,
  type SqliteStructuredStorageOptions,
} from "./sqlite-structured-storage.js";

/**
 * Named, honest state a mount site or diagnostics screen can render.
 * `"opening"` is the state from construction until `open()`'s first
 * call settles; `"disposed"` is terminal (a disposed owner never
 * returns to any other state, and a second `dispose()` call is a no-op
 * — see `OfflineCacheOwner.dispose`).
 */
export type OfflineCacheOwnerStatus =
  | { readonly kind: "opening" }
  | { readonly kind: "ready" }
  | { readonly kind: "degraded"; readonly reason: string }
  | { readonly kind: "disposed" };

export interface OfflineCacheOwnerOptions {
  /** Opens (or fails to open) this owner's backing `SqliteDriver`. Production passes `createUnavailableSqliteDriverFactory()` until `expo-sqlite` lands — see this module's doc comment. */
  driverFactory: SqliteDriverFactory;
  /** Forwarded to `OfflineCache`'s constructor. */
  clock: Clock;
  /**
   * Distinguishes independently-lifecycled caches. At most one
   * undisposed `OfflineCacheOwner` may exist per scope at a time — see
   * the class doc comment's "One construction per scope" section.
   * Defaults to `"default"`.
   */
  scope?: string;
  /** Forwarded to `OfflineCache`'s constructor as its `collection` argument; omit to use `OfflineCache`'s own default. */
  collection?: string;
  /** Forwarded to `SqliteStructuredStorage`, minus `driver` (supplied internally once `driverFactory.open()` resolves). */
  storage?: Omit<SqliteStructuredStorageOptions, "driver">;
}

const DEFAULT_SCOPE = "default";
/**
 * Scopes with a currently undisposed `OfflineCacheOwner`, module-level
 * so the guard holds across every call site in this process — not just
 * within one caller's closure — exactly like `plan.md`'s "singleton per
 * process lifetime" shape every other `AppCore`-owned adapter already
 * follows. Cleared by `dispose()`.
 */
const activeScopes = new Set<string>();

/**
 * Owns one `OfflineCache`'s full lifetime. See this module's doc
 * comment for the degraded-state and one-construction-per-scope
 * guarantees this class provides.
 */
export class OfflineCacheOwner {
  private readonly options: OfflineCacheOwnerOptions;
  private readonly scope: string;
  private status: OfflineCacheOwnerStatus = { kind: "opening" };
  private cache: coreOffline.OfflineCache | null = null;
  private driver: SqliteDriver | null = null;
  private openPromise: Promise<OfflineCacheOwnerStatus> | null = null;

  constructor(options: OfflineCacheOwnerOptions) {
    this.scope = options.scope ?? DEFAULT_SCOPE;
    if (activeScopes.has(this.scope)) {
      throw new Error(
        `OfflineCacheOwner: scope "${this.scope}" already has an undisposed owner. ` +
          "Construct at most one OfflineCacheOwner per scope at a time; call dispose() " +
          "on the existing one first if you really mean to replace it.",
      );
    }
    activeScopes.add(this.scope);
    this.options = options;
  }

  /**
   * Idempotent: the first call opens the driver and constructs the
   * cache; every call made while that is in flight, or after it has
   * settled, returns the exact same resolved (or still-pending) promise
   * rather than re-opening — this is what prevents *this* owner from
   * ever building two `SqliteStructuredStorage` instances, the
   * complement to the constructor's scope guard above (which prevents
   * two *owners* for the same scope). Never rejects — see this module's
   * "Degraded state" doc comment.
   */
  open(): Promise<OfflineCacheOwnerStatus> {
    if (!this.openPromise) {
      this.openPromise = this.doOpen();
    }
    return this.openPromise;
  }

  /**
   * Read through a method rather than the bare `this.status` field so
   * TypeScript's control-flow narrowing never "remembers" a stale
   * `!== "disposed"` conclusion across an `await` in `doOpen` below —
   * `dispose()` can genuinely flip `status` to `"disposed"` while a
   * `driverFactory.open()` call is still in flight.
   */
  private isDisposed(): boolean {
    return this.status.kind === "disposed";
  }

  private async doOpen(): Promise<OfflineCacheOwnerStatus> {
    // A dispose() that raced ahead of this call (see dispose()'s own
    // await on openPromise) already decided the final state; do not
    // clobber "disposed" with "ready"/"degraded" arriving late.
    if (this.isDisposed()) {
      return this.status;
    }
    try {
      const driver = await this.options.driverFactory.open();
      if (this.isDisposed()) {
        // Disposed while driverFactory.open() was in flight: close what
        // we just opened rather than leaving it dangling, and do not
        // construct a cache nobody can ever reach.
        await driver.closeAsync?.();
        return this.status;
      }
      this.driver = driver;
      const storage = new SqliteStructuredStorage({ driver, ...this.options.storage });
      this.cache = new coreOffline.OfflineCache(
        storage,
        this.options.clock,
        this.options.collection,
      );
      this.status = { kind: "ready" };
    } catch (error) {
      if (this.isDisposed()) {
        // dispose() raced ahead of the rejection (or a throw during
        // storage/cache construction) and already decided the final
        // state — same reasoning as the resolve-path guards above. Do
        // not clobber "disposed" with "degraded" arriving late; any
        // driver already stashed in this.driver is still closed by
        // dispose() itself once it awaits this openPromise.
        return this.status;
      }
      this.status = {
        kind: "degraded",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return this.status;
  }

  getStatus(): OfflineCacheOwnerStatus {
    return this.status;
  }

  /**
   * The live `OfflineCache`, once `open()` has resolved `"ready"`;
   * `null` in every other status (`"opening"`, `"degraded"`,
   * `"disposed"`). Never a partially-constructed object — `doOpen`
   * above only assigns `this.cache` in the same synchronous step it
   * sets `status` to `"ready"`.
   */
  getCache(): coreOffline.OfflineCache | null {
    return this.status.kind === "ready" ? this.cache : null;
  }

  /**
   * Ends this owner's lifetime. Waits out any in-flight `open()` first
   * (so a `dispose()` racing an `open()` never leaks a driver this call
   * never saw — see `doOpen`'s own disposed-check above), closes the
   * underlying driver via its optional `closeAsync` if it exposes one
   * (real `expo-sqlite` databases do; `in-memory-sqlite-driver.ts`'s
   * test double proves this call actually arrives, not just that an
   * internal flag flipped), frees this owner's `scope` for reuse, and
   * makes `getCache()` return `null` forever after.
   *
   * Idempotent: a second `dispose()` call is a no-op, never a double
   * `closeAsync()` call.
   */
  async dispose(): Promise<void> {
    if (this.status.kind === "disposed") {
      return;
    }
    // Mark disposed before awaiting anything else, so a concurrent
    // in-flight doOpen() sees it (its own disposed-check above) and a
    // concurrent second dispose() call's early-return above fires too.
    const openPromise = this.openPromise;
    this.status = { kind: "disposed" };
    activeScopes.delete(this.scope);
    if (openPromise) {
      await openPromise.catch(() => {});
    }
    const driver = this.driver;
    this.cache = null;
    this.driver = null;
    if (driver?.closeAsync) {
      await driver.closeAsync();
    }
  }
}

/**
 * The one production-facing construction entry point. Prefer this over
 * `new OfflineCacheOwner(...)` directly — identical behavior, but the
 * name matches this app's existing `createX` factory convention
 * (`createDaemonConnectionStore`, `createSettingsController`, ...) for
 * everything else `app-shell/core.ts` constructs.
 */
export function createOfflineCacheOwner(options: OfflineCacheOwnerOptions): OfflineCacheOwner {
  return new OfflineCacheOwner(options);
}
