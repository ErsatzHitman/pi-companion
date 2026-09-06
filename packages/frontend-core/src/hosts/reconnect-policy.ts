/**
 * Reconnect and relay-switch policy — plan.md §7.1/§12.1, T19B.
 *
 * `@picompanion/client`'s `DaemonClient` already retries the *same* URL
 * on its own (`DaemonClientConfig.reconnect`). What it cannot decide is
 * when a run of failures on one connection kind (direct or relay) means
 * `HostController` should stop retrying that kind and switch to the
 * profile's other configured kind instead — that policy decision is
 * this module's entire job, and it is kept a pure, transport-free
 * decision function (no timers, no I/O) so it is trivial to unit test
 * deterministically: given a sequence of recorded failures, what delay
 * should the next attempt wait, and has this kind failed enough times in
 * a row that `HostController` should try the alternate kind next?
 *
 * `HostController` owns actually scheduling the delay (via the injected
 * `Clock`, never a raw timer) and actually switching kinds.
 */
import type { HostConnectionKind } from "./types.js";

export interface ReconnectPolicyConfig {
  /** Delay before the first retry. Defaults to 1000ms. */
  baseDelayMs?: number;
  /** Ceiling the exponential backoff never exceeds. Defaults to 30000ms. */
  maxDelayMs?: number;
  /**
   * Consecutive failures on one connection kind before
   * `ReconnectPolicy` recommends switching to the profile's other
   * configured kind. Defaults to 3.
   */
  maxAttemptsPerKind?: number;
}

export interface ReconnectDecision {
  /** 1-based count of consecutive failures on `kind`, including the one just recorded. */
  attempt: number;
  /** How long `HostController` should wait before the next attempt, in milliseconds. */
  delayMs: number;
  /** `true` once `attempt` has reached `maxAttemptsPerKind`: `HostController` should try the profile's other configured kind next, if it has one. */
  shouldSwitchKind: boolean;
}

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS_PER_KIND = 3;

/**
 * Pure exponential-backoff + relay-switch decision policy, keyed per
 * connection kind so a run of direct failures and a run of relay
 * failures never share (or reset) each other's attempt counts.
 */
export class ReconnectPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttemptsPerKind: number;
  private readonly attemptsByKind = new Map<HostConnectionKind, number>();

  constructor(config: ReconnectPolicyConfig = {}) {
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.maxAttemptsPerKind = config.maxAttemptsPerKind ?? DEFAULT_MAX_ATTEMPTS_PER_KIND;
  }

  /** Records one more consecutive failure on `kind` and returns the decision for the next attempt. */
  recordFailure(kind: HostConnectionKind): ReconnectDecision {
    const attempt = (this.attemptsByKind.get(kind) ?? 0) + 1;
    this.attemptsByKind.set(kind, attempt);
    const delayMs = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    return {
      attempt,
      delayMs,
      shouldSwitchKind: attempt >= this.maxAttemptsPerKind,
    };
  }

  /** Resets `kind`'s consecutive-failure count, e.g. after a successful connect. */
  recordSuccess(kind: HostConnectionKind): void {
    this.attemptsByKind.delete(kind);
  }

  getAttemptCount(kind: HostConnectionKind): number {
    return this.attemptsByKind.get(kind) ?? 0;
  }

  /** Resets every kind's attempt count, e.g. when the user manually reconnects. */
  reset(): void {
    this.attemptsByKind.clear();
  }
}
