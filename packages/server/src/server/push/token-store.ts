import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

/**
 * Sentinel `clientId` bucket for push tokens that were persisted before
 * T299 gave this store `clientId` attribution at all. See "Migration
 * decision (T299)" below — this is not a real device and is never the
 * target of a `trusted_device.revoke` request, so `removeTokensForClient`
 * refuses to touch it even if a caller passed this exact string.
 */
export const UNATTRIBUTED_CLIENT_ID = "__unattributed__";

interface PersistedTokenEntry {
  clientId: string;
  token: string;
}

/**
 * Store for Expo push tokens, attributed to the trusted device
 * (`clientId`) that registered them.
 *
 * Tokens are persisted to disk so pushes still work after daemon
 * restarts.
 *
 * ## `clientId` attribution (T299)
 *
 * Every token is stored under the `clientId` of the connection that
 * registered it (`addToken`'s second parameter), so a revoked device's
 * tokens can be removed as a group — see `removeTokensForClient`, called
 * from `websocket-server.ts`'s `handleTrustedDeviceRevokeRequest`
 * alongside the existing socket-close/session-cleanup it already did.
 * Before T299, this store held a flat `Set<string>` with no `clientId`
 * at all, so a revoke could close a device's sockets but never stop its
 * push notifications — see `docs/issues-from-plan.md`'s T299 section for
 * the measured gap this closes.
 *
 * `getAllTokens()` is unchanged: it still returns every token across
 * every `clientId`, because that is exactly the flattened list
 * `push/notifications.ts`'s `createPushNotificationSender().send()`
 * fans a push out to (`push-service.ts`'s `sendPush`). That is the
 * actual send-time consumption point a revoke must affect — not merely
 * a call to `removeTokensForClient` — and `token-store.test.ts`'s
 * revoke-consequence tests assert against `getAllTokens()` for exactly
 * that reason.
 *
 * `removeToken(token, clientId?)` keeps its pre-T299, unscoped shape
 * when `clientId` is omitted (used by `push-service.ts`'s automatic
 * dead-token cleanup, which never knows which device a token belonged
 * to), but scopes the removal to a single `clientId`'s own tokens when
 * one is supplied (used by `session.ts`'s `handleUnregisterPushToken`,
 * so a client can only ever deregister a token it registered itself,
 * never one belonging to some other device it happens to have learned
 * the value of).
 *
 * ## Migration decision (T299)
 *
 * Tokens persisted by a pre-T299 daemon used a bare `{ tokens: string[]
 * }` file shape with no `clientId` recorded at all — there is no way to
 * recover, after the fact, which device registered one of those tokens.
 * Two options were considered:
 *
 *  - **Drop them.** Simple, and it never lets an unattributed token
 *    silently survive a revoke it should have been subject to. But it
 *    would also silently break push notifications, on the very daemon
 *    upgrade that ships this fix, for every device that was **never**
 *    revoked — the exact "worse than the bug" failure this task's brief
 *    warns against.
 *  - **Grandfather them.** Load every legacy bare-string token into a
 *    reserved `UNATTRIBUTED_CLIENT_ID` bucket instead of a real
 *    `clientId`. `getAllTokens()` still returns them (notifications keep
 *    working), but `removeTokensForClient` can never target that bucket
 *    (there is no real device to revoke), so a legacy token is a
 *    disclosed, bounded residual, not a silently reintroduced version of
 *    the original gap: it affects only tokens registered before this
 *    daemon version, and it clears itself the moment that device's OS
 *    next issues it a fresh push token and the app registers it again
 *    (`apps/android/src/features/notifications/push-registration-model.ts`'s
 *    refresh path calls `register_push_token` with the new token, which
 *    is now persisted under that connection's real `clientId`).
 *
 * **Decision: grandfather.** `loadFromDisk` files every legacy entry
 * under `UNATTRIBUTED_CLIENT_ID` and immediately rewrites the file in
 * the new `{clientId, token}` shape, so the on-disk schema converges to
 * the new format on the very next daemon start even if no token event
 * ever fires. `token-store.test.ts`'s "migration" tests pin the load
 * behaviour, the rewrite, and that `removeTokensForClient` cannot touch
 * the grandfathered bucket under any `clientId` including the sentinel
 * itself.
 */
export class PushTokenStore {
  private readonly logger: pino.Logger;
  private tokensByClient: Map<string, Set<string>> = new Map();
  private readonly filePath: string;

  constructor(logger: pino.Logger, filePath: string) {
    this.logger = logger.child({ component: "token-store" });
    this.filePath = filePath;
    this.loadFromDisk();
  }

  /** Registers `token` under `clientId`. Additive — see the class doc comment; never supersedes another token this or any other `clientId` already registered. */
  addToken(token: string, clientId: string): void {
    const normalizedToken = token.trim();
    if (!normalizedToken) return;
    const bucketId = clientId.trim() || UNATTRIBUTED_CLIENT_ID;
    const bucket = this.tokensByClient.get(bucketId);
    if (bucket?.has(normalizedToken)) return;
    const nextBucket = bucket ?? new Set<string>();
    nextBucket.add(normalizedToken);
    this.tokensByClient.set(bucketId, nextBucket);
    this.persist();
    this.logger.debug({ total: this.totalTokenCount() }, "Added token");
  }

  /**
   * Removes `token`. With no `clientId`, removes it from whichever
   * bucket holds it (the pre-T299 shape, kept for `push-service.ts`'s
   * automatic dead-token cleanup, which has no `clientId` to scope to).
   * With a `clientId`, removes it only from that bucket — a token some
   * other client owns is left untouched and this is a silent no-op,
   * exactly like removing a token that was never registered at all, so
   * neither case can be told apart from the outside.
   */
  removeToken(token: string, clientId?: string): void {
    const normalized = token.trim();
    if (!normalized) return;
    let deleted = false;
    if (clientId === undefined) {
      for (const [bucketId, tokens] of this.tokensByClient) {
        if (tokens.delete(normalized)) {
          deleted = true;
          if (tokens.size === 0) this.tokensByClient.delete(bucketId);
        }
      }
    } else {
      const bucketId = clientId.trim() || UNATTRIBUTED_CLIENT_ID;
      const bucket = this.tokensByClient.get(bucketId);
      if (bucket?.delete(normalized)) {
        deleted = true;
        if (bucket.size === 0) this.tokensByClient.delete(bucketId);
      }
    }
    if (deleted) {
      this.persist();
      this.logger.debug({ total: this.totalTokenCount() }, "Removed token");
    }
  }

  /**
   * Removes every token registered by `clientId` — the T299 seam that
   * makes a `trusted_device.revoke` actually stop that device's
   * notifications. A no-op for the grandfathered `UNATTRIBUTED_CLIENT_ID`
   * bucket (including if `clientId` itself is blank and would otherwise
   * normalize to it) and for a `clientId` with no tokens registered.
   */
  removeTokensForClient(clientId: string): void {
    const bucketId = clientId.trim();
    if (!bucketId || bucketId === UNATTRIBUTED_CLIENT_ID) return;
    const deleted = this.tokensByClient.delete(bucketId);
    if (deleted) {
      this.persist();
      this.logger.debug(
        { clientId: bucketId, total: this.totalTokenCount() },
        "Removed tokens for revoked client",
      );
    }
  }

  /**
   * Every token across every `clientId`, flattened and deduped. This is
   * the exact list `push/notifications.ts`'s `send()` fans a push out
   * to — see the class doc comment.
   */
  getAllTokens(): string[] {
    const all = new Set<string>();
    for (const tokens of this.tokensByClient.values()) {
      for (const token of tokens) all.add(token);
    }
    return Array.from(all);
  }

  private totalTokenCount(): number {
    let total = 0;
    for (const tokens of this.tokensByClient.values()) total += tokens.size;
    return total;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) {
        return;
      }
      ensurePrivateFile(this.filePath);
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as { tokens?: unknown };
      const map = new Map<string, Set<string>>();
      let sawLegacyEntry = false;
      if (Array.isArray(parsed.tokens)) {
        for (const entry of parsed.tokens) {
          if (typeof entry === "string") {
            // Legacy (pre-T299) shape: a bare token string with no
            // clientId. Grandfathered — see "Migration decision (T299)".
            sawLegacyEntry = true;
            const token = entry.trim();
            if (!token) continue;
            const bucket = map.get(UNATTRIBUTED_CLIENT_ID) ?? new Set<string>();
            bucket.add(token);
            map.set(UNATTRIBUTED_CLIENT_ID, bucket);
          } else if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as Partial<PersistedTokenEntry>).token === "string" &&
            typeof (entry as Partial<PersistedTokenEntry>).clientId === "string"
          ) {
            const token = (entry as PersistedTokenEntry).token.trim();
            if (!token) continue;
            const bucketId =
              (entry as PersistedTokenEntry).clientId.trim() || UNATTRIBUTED_CLIENT_ID;
            const bucket = map.get(bucketId) ?? new Set<string>();
            bucket.add(token);
            map.set(bucketId, bucket);
          }
        }
      }
      this.tokensByClient = map;
      this.logger.info({ total: this.totalTokenCount() }, "Loaded push tokens");
      if (sawLegacyEntry) {
        // Converge the on-disk schema to the new {clientId, token} shape
        // immediately, so a later daemon start (or a human reading the
        // file) never sees the pre-T299 shape again even if no token
        // event fires first.
        this.persist();
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to load push tokens");
    }
  }

  private persist(): void {
    try {
      const entries: PersistedTokenEntry[] = [];
      for (const [clientId, tokens] of this.tokensByClient) {
        for (const token of tokens) entries.push({ clientId, token });
      }
      const payload = JSON.stringify({ tokens: entries }, null, 2) + "\n";
      writePrivateFileAtomicSync(this.filePath, payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to persist push tokens");
    }
  }
}
