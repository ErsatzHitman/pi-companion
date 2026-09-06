import type { SettingsClient } from "./settings-client.js";

/**
 * In-memory `SettingsClient` test double, mirroring
 * `composer/test-doubles.ts`'s `FakeAgentTurnClient` convention: records
 * every call so tests can assert on it, and — critically for this
 * feature's "not by local state changing" round-trip criterion — keeps
 * its own internal, authoritative state that `get*` reads back, entirely
 * independent of whatever value a caller optimistically expects. A test
 * that mutates production code to skip the `set*` call (or to skip the
 * post-set `get*` re-fetch) sees this fake's internal state fail to
 * change, exactly like a real daemon would.
 */
export class FakeSettingsClient implements SettingsClient {
  private autoCompactionEnabled: boolean;
  private autoRetryEnabled: boolean;

  readonly setAutoCompactionCalls: Array<{ agentId: string; enabled: boolean }> = [];
  readonly getAutoCompactionCalls: string[] = [];
  readonly setAutoRetryCalls: Array<{ agentId: string; enabled: boolean }> = [];
  readonly getAutoRetryCalls: string[] = [];

  constructor(initial?: { autoCompactionEnabled?: boolean; autoRetryEnabled?: boolean }) {
    this.autoCompactionEnabled = initial?.autoCompactionEnabled ?? true;
    this.autoRetryEnabled = initial?.autoRetryEnabled ?? true;
  }

  async getAutoCompaction(agentId: string): Promise<boolean> {
    this.getAutoCompactionCalls.push(agentId);
    return this.autoCompactionEnabled;
  }

  async setAutoCompaction(agentId: string, enabled: boolean): Promise<void> {
    this.setAutoCompactionCalls.push({ agentId, enabled });
    this.autoCompactionEnabled = enabled;
  }

  async getAutoRetry(agentId: string): Promise<boolean> {
    this.getAutoRetryCalls.push(agentId);
    return this.autoRetryEnabled;
  }

  async setAutoRetry(agentId: string, enabled: boolean): Promise<void> {
    this.setAutoRetryCalls.push({ agentId, enabled });
    this.autoRetryEnabled = enabled;
  }
}

/** A `SettingsClient` that omits every method — the "wired client that cannot do this" shape a real `DaemonClient` has today. */
export class UnsupportedSettingsClient implements SettingsClient {}
