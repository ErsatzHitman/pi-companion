/**
 * Host profile persistence — plan.md §7.2/§7.3, T19B.
 *
 * `HostProfileStore` is the only place `frontend-core` reads or writes
 * `HostProfile` records. It splits each profile across two platform
 * interfaces on purpose:
 *
 * - non-secret fields (label, direct/relay endpoints, preferences, last
 *   connection bookkeeping) go through `StructuredStorage`, the plan.md
 *   §7.2 "local durable state" store;
 * - the daemon password (when present) goes through `SecureStorage`,
 *   addressed by the profile's `id`, and is never embedded in the
 *   `HostProfile` object `list()`/`get()` return — matching plan.md
 *   §12.1's "private material never enters a URL query" and §15's
 *   password-handling posture. Whether a given platform's `SecureStorage`
 *   actually persists that secret (Android SecureStore) or only holds it
 *   in memory for the session (web's default) is that platform's policy,
 *   not this store's.
 *
 * All timestamps come from the injected `Clock`, never `Date.now()`
 * directly, so persistence logic stays deterministic under test.
 */
import type { Clock } from "../platform/clock.js";
import type { SecureStorage } from "../platform/secure-storage.js";
import type { StructuredStorage } from "../platform/storage.js";
import type { HostProfile, HostProfileDraft, HostConnectionKind } from "./types.js";

const HOST_PROFILES_COLLECTION = "hosts.profiles";

function secretKeyForHostPassword(id: string): string {
  return `hosts.profile.${id}.password`;
}

export interface HostProfileStoreConfig {
  storage: StructuredStorage;
  secrets: SecureStorage;
  clock: Clock;
  /**
   * Generates a new profile id when `HostProfileStore.save` is called
   * without one. Defaults to a counter seeded from `clock.now()`, kept
   * deterministic under a fake `Clock` for tests rather than relying on
   * a platform-specific random UUID source.
   */
  createId?: () => string;
}

function defaultCreateIdFactory(clock: Clock): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `host_${clock.now()}_${counter}`;
  };
}

export class HostProfileStore {
  private readonly storage: StructuredStorage;
  private readonly secrets: SecureStorage;
  private readonly clock: Clock;
  private readonly createId: () => string;

  constructor(config: HostProfileStoreConfig) {
    this.storage = config.storage;
    this.secrets = config.secrets;
    this.clock = config.clock;
    this.createId = config.createId ?? defaultCreateIdFactory(config.clock);
  }

  async list(): Promise<HostProfile[]> {
    return this.storage.list<HostProfile>(HOST_PROFILES_COLLECTION);
  }

  async get(id: string): Promise<HostProfile | null> {
    return this.storage.get<HostProfile>(HOST_PROFILES_COLLECTION, id);
  }

  /**
   * Creates a new profile (when `draft.id` is omitted or unknown) or
   * updates an existing one in place, preserving `createdAt`,
   * `lastConnectedAt`, and `lastConnectionKind` across updates.
   * `password`, if provided, is written to `SecureStorage` under the
   * resulting profile's id; omitting it leaves any existing secret
   * untouched.
   */
  async save(draft: HostProfileDraft, options: { password?: string } = {}): Promise<HostProfile> {
    const existing = draft.id ? await this.get(draft.id) : null;
    const now = this.clock.now();
    const profile: HostProfile = {
      id: existing?.id ?? draft.id ?? this.createId(),
      label: draft.label,
      ...(draft.direct !== undefined
        ? { direct: draft.direct }
        : existing?.direct !== undefined
          ? { direct: existing.direct }
          : {}),
      ...(draft.relay !== undefined
        ? { relay: draft.relay }
        : existing?.relay !== undefined
          ? { relay: existing.relay }
          : {}),
      preferDirect: draft.preferDirect ?? existing?.preferDirect ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastConnectedAt: existing?.lastConnectedAt ?? null,
      lastConnectionKind: existing?.lastConnectionKind ?? null,
    };
    await this.storage.put(HOST_PROFILES_COLLECTION, profile.id, profile);
    if (options.password !== undefined) {
      await this.setPassword(profile.id, options.password);
    }
    return profile;
  }

  /** Deletes the profile and its stored password, if any. */
  async remove(id: string): Promise<void> {
    await this.storage.delete(HOST_PROFILES_COLLECTION, id);
    await this.clearPassword(id);
  }

  async getPassword(id: string): Promise<string | null> {
    return this.secrets.getSecret(secretKeyForHostPassword(id));
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.secrets.setSecret(secretKeyForHostPassword(id), password);
  }

  async clearPassword(id: string): Promise<void> {
    await this.secrets.removeSecret(secretKeyForHostPassword(id));
  }

  /** Updates `lastConnectedAt`/`lastConnectionKind` after a successful connection. Returns `null` if the profile no longer exists. */
  async recordConnectionOutcome(id: string, kind: HostConnectionKind): Promise<HostProfile | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: HostProfile = {
      ...existing,
      lastConnectedAt: this.clock.now(),
      lastConnectionKind: kind,
      updatedAt: this.clock.now(),
    };
    await this.storage.put(HOST_PROFILES_COLLECTION, id, updated);
    return updated;
  }
}
