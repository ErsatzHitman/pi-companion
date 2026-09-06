/**
 * Connection probing — plan.md §7.1/§12.1, T19B.
 *
 * `ConnectionProber` decides which of a `HostProfile`'s configured
 * connection targets (`resolveConnectionTargets` in `connection-url.ts`)
 * is reachable right now, trying them in that deterministic
 * direct-preferred order and stopping at the first success — this
 * task's "probing prefers direct and falls back to relay deterministically"
 * acceptance criterion.
 *
 * Probing itself (actually opening a socket and observing whether it
 * connects) is unavoidably platform I/O, so it is never done here.
 * Callers inject a `HostProbeTransport`: a function that resolves when
 * `url` is reachable and rejects when it is not. `apps/web` backs this
 * with a throwaway `WebSocket`; `apps/android` with its RN/Expo
 * transport; tests back it with a fake. This module owns only the
 * ordering, the per-attempt timeout (enforced via the injected `Clock`,
 * never a raw timer), and the resulting attempt log.
 */
import type { Clock, TimerHandle } from "../platform/clock.js";
import { resolveConnectionTargets } from "./connection-url.js";
import type { HostConnectionKind, HostProfile } from "./types.js";

export type HostProbeOutcome = "reachable" | "unreachable" | "timed-out";

export interface HostProbeAttempt {
  kind: HostConnectionKind;
  url: string;
  outcome: HostProbeOutcome;
  durationMs: number;
  error?: string;
}

export interface HostProbeSelection {
  /** The first reachable kind, in direct-preferred/relay-fallback order, or `null` if none of the configured targets answered. */
  selectedKind: HostConnectionKind | null;
  selectedUrl: string | null;
  /** Every attempt made, in the order they were tried, including ones after the eventual winner never happens (probing stops at the first success). */
  attempts: HostProbeAttempt[];
}

/** Resolves once `url` is confirmed reachable; rejects (with a descriptive error) once it is confirmed unreachable. Never itself times out — timeout is `ConnectionProber`'s job. */
export type HostProbeTransport = (url: string) => Promise<void>;

export interface ConnectionProberConfig {
  clock: Clock;
  probe: HostProbeTransport;
  /** Per-attempt timeout. Defaults to 4000ms. */
  timeoutMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 4000;

interface RaceResult {
  outcome: HostProbeOutcome;
  error?: string;
}

function raceWithTimeout(
  attempt: Promise<void>,
  timeoutMs: number,
  clock: Clock,
): Promise<RaceResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutHandle: TimerHandle | null = clock.setTimeout(() => {
      timeoutHandle = null;
      if (settled) return;
      settled = true;
      resolve({ outcome: "timed-out" });
    }, timeoutMs);

    attempt.then(
      () => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clock.clearTimeout(timeoutHandle);
        resolve({ outcome: "reachable" });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clock.clearTimeout(timeoutHandle);
        resolve({
          outcome: "unreachable",
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  });
}

export class ConnectionProber {
  private readonly clock: Clock;
  private readonly probe: HostProbeTransport;
  private readonly timeoutMs: number;

  constructor(config: ConnectionProberConfig) {
    this.clock = config.clock;
    this.probe = config.probe;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  /**
   * Tries `profile`'s configured targets in direct-preferred/relay-fallback
   * order (or relay-preferred when `profile.preferDirect` is false),
   * stopping at the first reachable one. Never throws: a profile with no
   * reachable target resolves with `selectedKind: null` and every
   * attempt's outcome recorded.
   */
  async selectConnection(profile: HostProfile): Promise<HostProbeSelection> {
    const targets = resolveConnectionTargets(profile);
    const attempts: HostProbeAttempt[] = [];

    for (const target of targets) {
      const startedAt = this.clock.now();
      const result = await raceWithTimeout(this.probe(target.url), this.timeoutMs, this.clock);
      const durationMs = this.clock.now() - startedAt;
      attempts.push({
        kind: target.kind,
        url: target.url,
        outcome: result.outcome,
        durationMs,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
      if (result.outcome === "reachable") {
        return { selectedKind: target.kind, selectedUrl: target.url, attempts };
      }
    }

    return { selectedKind: null, selectedUrl: null, attempts };
  }
}
