/**
 * In-memory `StructuredStorage`/`SecureStorage`/`NetworkReachability`
 * test doubles shared by `hosts/`'s own unit tests. Test-only
 * scaffolding, not exported from `hosts/index.ts`.
 */
import type { StructuredStorage, StructuredStorageListOptions } from "../../platform/storage.js";
import type { SecureStorage } from "../../platform/secure-storage.js";
import type { NetworkReachability, NetworkStatus } from "../../platform/network.js";

export class InMemoryStructuredStorage implements StructuredStorage {
  private readonly collections = new Map<string, Map<string, unknown>>();

  private collection(name: string): Map<string, unknown> {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    return (this.collection(collection).get(id) as T | undefined) ?? null;
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.collection(collection).set(id, value);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id);
  }

  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    let values = [...this.collection(collection).entries()];
    if (options?.idPrefix !== undefined) {
      const prefix = options.idPrefix;
      values = values.filter(([id]) => id.startsWith(prefix));
    }
    if (options?.limit !== undefined) {
      values = values.slice(0, options.limit);
    }
    return values.map(([, value]) => value as T);
  }

  async clear(collection: string): Promise<void> {
    this.collections.delete(collection);
  }
}

export class InMemorySecureStorage implements SecureStorage {
  private readonly secrets = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async removeSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

export class FakeNetworkReachability implements NetworkReachability {
  private status: NetworkStatus = { online: true, kind: "unknown" };
  private readonly listeners = new Set<(status: NetworkStatus) => void>();

  async getStatus(): Promise<NetworkStatus> {
    return this.status;
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setOnline(online: boolean): void {
    this.status = { online, kind: online ? "unknown" : "none" };
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
