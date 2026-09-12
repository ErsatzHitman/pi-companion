/**
 * Default, in-memory `StructuredStorage`/`Clock` for `Composer`'s own
 * `OutboxController` (T33B7, plan.md §7.1/§12.5's "Attachments flow
 * through the core outbox").
 *
 * `apps/android` has a real `StructuredStorage` backend wired in
 * production since T390 — `app-shell/core.ts` threads
 * `AppCore.turnOutbox.getOutbox()` into `Composer`'s `outbox` prop at
 * the session route — but a caller that supplies no `outbox` still gets
 * this in-memory adapter (and so does production whenever the native
 * `ExpoSQLite` module is genuinely unavailable, since `getOutbox()` then
 * returns `null`). `Composer`'s
 * `outbox`/`structuredStorage`/`clock` props are therefore all
 * optional, and default to the adapters this file provides when the
 * caller supplies none — exactly the "unavailable"-style default every
 * other injected port in this feature falls back to
 * (`attachment-source-port.ts`, `../voice/voice-capture-port.ts`,
 * `../connect/qr-scanner-port.ts`), except here the honest default is
 * "durable only for this component's lifetime", not "does nothing":
 * `OutboxController`'s pending/sending/awaiting-confirmation/sent
 * lifecycle and retry rules are real and exercised, they just are not
 * yet backed by a store that survives an app restart.
 *
 * **This is not a second outbox.** It is the storage/clock plumbing
 * `composer/outbox.ts`'s real `OutboxController` needs to run at all —
 * the same two contracts (`StructuredStorage`, `Clock`) `apps/web`
 * already satisfies with IndexedDB (`apps/web/src/platform/`, out of
 * this task's scope to read further). Once T37C's real
 * `SqliteStructuredStorage` is mounted somewhere Android can construct
 * it, pass it as `Composer`'s `structuredStorage` prop and this
 * fallback stops being used — no change needed here or in
 * `composer/outbox.ts` itself.
 */
import type {
  Clock,
  StructuredStorage,
  StructuredStorageListOptions,
  TimerHandle,
} from "@picompanion/frontend-core";

/** A `StructuredStorage` backed by a plain in-process `Map` — cleared on remount, never persisted. */
export function createInMemoryStructuredStorage(): StructuredStorage {
  const collections = new Map<string, Map<string, unknown>>();

  function collection(name: string): Map<string, unknown> {
    let existing = collections.get(name);
    if (!existing) {
      existing = new Map();
      collections.set(name, existing);
    }
    return existing;
  }

  return {
    async get<T>(collectionName: string, id: string): Promise<T | null> {
      const value = collection(collectionName).get(id);
      return (value as T | undefined) ?? null;
    },
    async put<T>(collectionName: string, id: string, value: T): Promise<void> {
      collection(collectionName).set(id, value);
    },
    async delete(collectionName: string, id: string): Promise<void> {
      collection(collectionName).delete(id);
    },
    async list<T>(collectionName: string, options?: StructuredStorageListOptions): Promise<T[]> {
      let values = Array.from(collection(collectionName).values()) as T[];
      if (options?.idPrefix) {
        const prefix = options.idPrefix;
        values = Array.from(collection(collectionName).entries())
          .filter(([id]) => id.startsWith(prefix))
          .map(([, value]) => value as T);
      }
      if (options?.limit !== undefined) {
        values = values.slice(0, options.limit);
      }
      return values;
    },
    async clear(collectionName: string): Promise<void> {
      collection(collectionName).clear();
    },
  };
}

/** A `Clock` backed by the real wall clock and `setTimeout`/`setInterval` — fine for Android production use, unlike a test's `FakeClock`. */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle,
    clearTimeout: (handle) => clearTimeout(handle as unknown as number),
    setInterval: (callback, intervalMs) =>
      setInterval(callback, intervalMs) as unknown as TimerHandle,
    clearInterval: (handle) => clearInterval(handle as unknown as number),
  };
}
