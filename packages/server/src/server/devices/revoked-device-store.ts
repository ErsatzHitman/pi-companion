import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

interface PersistedRevocationEntry {
  clientId: string;
  revokedAt: string;
}

export interface RevokedDeviceEntry {
  clientId: string;
  revokedAt: string;
}

/**
 * Persisted denylist of revoked `clientId`s (T300).
 *
 * ## Why this exists
 *
 * Trust in this daemon is one shared bearer password (see `auth.ts`). A
 * `trusted_device.revoke` (T42A2/T299) closes the target's live sockets and
 * stops its push notifications, but until T300 nothing stopped the same
 * `clientId` from reconnecting with a fresh `hello` the moment it presented
 * that password again — `handleHello` (`websocket-server.ts`) would happily
 * re-admit it to `externalSessionsByKey`. See `docs/issues-from-plan.md`'s
 * T300 section for the measured gap this closes.
 *
 * This store is consulted by `handleHello` before a connection is created
 * *or resumed*, so both paths — a brand-new hello and a resumed one for a
 * `clientId` this daemon process has already seen — are covered by one
 * check at one call site.
 *
 * ## Persistence
 *
 * Written to `revoked-devices.json` under `$PASEO_HOME` with the same
 * atomic-write-plus-0600-permissions discipline as `push/token-store.ts`,
 * so the denylist survives a daemon restart — a revoked device that is
 * still offline when the daemon restarts must come back denied, not
 * silently readmitted because the in-memory `Set` reset to empty.
 *
 * ## Un-revoking (T300 decision, recorded rather than omitted)
 *
 * `unrevoke()` exists and is tested directly against this store, so the
 * schema is never a dead end — CLAUDE.md's own T300 brief warns that
 * "adding one later is a schema change," and this store's on-disk shape
 * (`{ revoked: [{ clientId, revokedAt }] }`) already supports removing an
 * entry without changing shape. **What this task does NOT ship: a way for
 * the owner to trigger `unrevoke()` from the app.** That needs two things
 * outside this task's `Owns` grant: a new `trusted_device.unrevoke`
 * wire-message pair (a protocol addition beyond the hello-rejection one
 * this task's brief explicitly grants), and a place in the Android UI to
 * list *revoked* devices and act on one — `DevicesScreen.tsx` today lists
 * only currently-trusted devices, so there is nowhere to put an "undo"
 * control yet. Building either half without the other would be exactly
 * the "exported but not called" shape this repository's own review notes
 * warn about, so neither is built here. Filed as a follow-up for whoever
 * next touches `trusted_device` messages or `DevicesScreen.tsx`.
 */
export class RevokedDeviceStore {
  private readonly logger: pino.Logger;
  private readonly filePath: string;
  private revoked: Map<string, string> = new Map();

  constructor(logger: pino.Logger, filePath: string) {
    this.logger = logger.child({ component: "revoked-device-store" });
    this.filePath = filePath;
    this.loadFromDisk();
  }

  /** Whether `clientId` currently sits on the denylist. */
  isRevoked(clientId: string): boolean {
    const trimmed = clientId.trim();
    if (!trimmed) return false;
    return this.revoked.has(trimmed);
  }

  /**
   * Adds `clientId` to the denylist, recording when. Idempotent — revoking
   * an already-revoked `clientId` refreshes nothing and does not re-persist
   * if it was already the only thing on disk (persist() is still called for
   * simplicity; the on-disk content is identical either way for the
   * already-revoked-at-the-same-timestamp case, and differs only in
   * `revokedAt` otherwise, which is expected: revoking again means "still
   * revoked, most recently confirmed now").
   */
  revoke(clientId: string): void {
    const trimmed = clientId.trim();
    if (!trimmed) return;
    this.revoked.set(trimmed, new Date().toISOString());
    this.persist();
    this.logger.info({ clientId: trimmed, total: this.revoked.size }, "Revoked clientId");
  }

  /** Removes `clientId` from the denylist. A no-op, not an error, if it was not on it. */
  unrevoke(clientId: string): void {
    const trimmed = clientId.trim();
    if (!trimmed) return;
    const deleted = this.revoked.delete(trimmed);
    if (deleted) {
      this.persist();
      this.logger.info({ clientId: trimmed, total: this.revoked.size }, "Un-revoked clientId");
    }
  }

  /** Every revoked entry, for a future admin surface. Unused by any caller today — see the class doc comment's "Un-revoking" section. */
  list(): RevokedDeviceEntry[] {
    return Array.from(this.revoked.entries()).map(([clientId, revokedAt]) => ({
      clientId,
      revokedAt,
    }));
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) {
        return;
      }
      ensurePrivateFile(this.filePath);
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as { revoked?: unknown };
      const map = new Map<string, string>();
      if (Array.isArray(parsed.revoked)) {
        for (const entry of parsed.revoked) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as Partial<PersistedRevocationEntry>).clientId === "string" &&
            typeof (entry as Partial<PersistedRevocationEntry>).revokedAt === "string"
          ) {
            const clientId = (entry as PersistedRevocationEntry).clientId.trim();
            if (!clientId) continue;
            map.set(clientId, (entry as PersistedRevocationEntry).revokedAt);
          }
        }
      }
      this.revoked = map;
      this.logger.info({ total: this.revoked.size }, "Loaded revoked devices");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to load revoked devices");
    }
  }

  private persist(): void {
    try {
      const entries: PersistedRevocationEntry[] = Array.from(this.revoked.entries()).map(
        ([clientId, revokedAt]) => ({ clientId, revokedAt }),
      );
      const payload = JSON.stringify({ revoked: entries }, null, 2) + "\n";
      writePrivateFileAtomicSync(this.filePath, payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to persist revoked devices");
    }
  }
}
