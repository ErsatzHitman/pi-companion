import type { NetworkReachability, NetworkStatus } from "@picompanion/frontend-core";

/**
 * Real (not fake) `NetworkReachability` for Android — T32S3, item (5).
 *
 * **T32P1 update:** this module's `kind`-reporting gap (see "Disclosed
 * limits" below) is now closed by `./native-network-reachability.ts`'s
 * `NativeNetworkReachability`, which reports a real `kind` from an
 * injected `@react-native-community/netinfo`-shaped port instead of
 * probing a URL. This file is kept, unmodified in its exported
 * behaviour, only because `../app-shell/core.ts` still constructs
 * `PollingNetworkReachability` in production (T32S4's grant this wave,
 * concurrently edited — this task does not touch it); once that
 * construction site switches to `createNativeNetworkReachability`, this
 * module's `PollingNetworkReachability`/`createDefaultAndroidProbe`
 * exports have no production caller left and should be deleted rather
 * than carried forward as a second, weaker adapter. See T32P1's report
 * for the exact install command and construction-site change this
 * still needs.
 *
 * `AppCore.network` (`../app-shell/core.ts`) was `FakeNetworkReachability`
 * (`./fake-network.ts`), an always-online in-memory stand-in, on the
 * *resume* path: `AppCore.attachResumeSignals` (`../app-shell/resume-signals.ts`)
 * feeds `AppCore.network`'s status into a live `connection.ResumeController`
 * so a genuine offline -> online transition or a Wi-Fi -> cellular path
 * switch (see `resume-signals.ts`'s "Notice a path switch" note) triggers
 * a reconcile — a fake that never changes can never raise either signal.
 *
 * The obvious real adapter is `@react-native-community/netinfo`, which
 * is not a dependency of `apps/android` and which this task may not add
 * (`../../../CLAUDE.md`: no `npm install`). Lacking any RN-core
 * connectivity API (unlike the web platform's `navigator.onLine`, RN
 * ships none), this module instead does what mobile OSes themselves have
 * always done before a native connectivity API existed: periodically
 * probes reachability with a real network call and raises subscribers on
 * a change, via an **injected** probe function — the two-part answer the
 * task brief calls out ("ship the adapter behind the `NetworkReachability`
 * interface with an injected probe so it is real and testable without
 * the native module").
 *
 * `PollingNetworkReachability` itself takes no platform import at all
 * (schedulers are injected, exactly like `../platform/frame-clock.ts`),
 * so it is fully exercised under this workspace's plain `vitest` setup
 * with fake timers and a scripted probe — see `network-reachability.test.ts`.
 * `createDefaultAndroidProbe` below is the one piece that reaches a real
 * `fetch`, and is what an on-device run (T37/T59) would actually invoke.
 *
 * **Disclosed limits — read before trusting this as device-accurate:**
 * - It can only ever report `online`/`offline` from whether one HTTP
 *   call to `getProbeUrl()`'s current value succeeds — never a real
 *   `kind` (`"wifi"` vs `"cellular"` vs `"ethernet"`). Every observed
 *   status reports `kind: "unknown"` (online) or `"none"` (offline).
 *   `resume-signals.ts`'s `"network-path-change"` rule — a `kind` change
 *   while `online` stays `true`, e.g. Wi-Fi handing off to cellular —
 *   can therefore **never fire** from this adapter; only real interface
 *   metadata (netinfo) can tell wifi from cellular. `"network-online"`
 *   (offline -> online) works for real, since that only needs the probe
 *   call itself to start succeeding again.
 * - `getProbeUrl()` (constructor dep) supplies the host to probe — this
 *   module has no opinion on what that host is, deliberately: probing an
 *   arbitrary third-party host (e.g. a public captive-portal-check
 *   endpoint) is a product/privacy decision this task should not make
 *   unilaterally. `../app-shell/core.ts` wires `getProbeUrl` to the active
 *   daemon connection's own host when one is known, and to `null`
 *   (nothing to probe) otherwise — see that module's doc comment for
 *   the one remaining piece (outside this task's grant) that makes a
 *   host actually reach it in production.
 * - While `getProbeUrl()` returns `null`, this adapter reports
 *   `{ online: true, kind: "unknown" }` and never changes it — an
 *   honestly-labeled "no signal yet" default (RN's typical assumption
 *   until told otherwise), not a claim of having verified anything.
 */
export type NetworkReachabilityProbe = () => Promise<boolean>;

export interface PollingNetworkReachabilityDeps {
  /** Performs one real reachability check, resolving `true` (reachable) or `false`. Never expected to throw — a thrown/rejected probe is treated as `false`. */
  probe: NetworkReachabilityProbe;
  /** Milliseconds between polls while at least one subscriber is attached. Defaults to 15s. */
  intervalMs?: number;
  /** Injected so tests never depend on real timers — mirrors `../platform/frame-clock.ts`'s `AppFrameSchedulers`. Defaults to the real globals. */
  setInterval?: (callback: () => void, delayMs: number) => number;
  clearInterval?: (handle: number) => void;
}

const DEFAULT_INTERVAL_MS = 15_000;
const UNKNOWN_ONLINE_STATUS: NetworkStatus = { online: true, kind: "unknown" };

/**
 * Polls an injected probe on an interval and publishes `NetworkStatus`
 * changes to subscribers — polling starts on the first `subscribe()`
 * call and stops once the last one unsubscribes, so an unmounted screen
 * leaves nothing running.
 */
export class PollingNetworkReachability implements NetworkReachability {
  private readonly probe: NetworkReachabilityProbe;
  private readonly intervalMs: number;
  private readonly scheduleInterval: (callback: () => void, delayMs: number) => number;
  private readonly cancelInterval: (handle: number) => void;
  private status: NetworkStatus = UNKNOWN_ONLINE_STATUS;
  private readonly listeners = new Set<(status: NetworkStatus) => void>();
  private timerHandle: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(deps: PollingNetworkReachabilityDeps) {
    this.probe = deps.probe;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.scheduleInterval =
      deps.setInterval ??
      ((callback, delayMs) => setInterval(callback, delayMs) as unknown as number);
    this.cancelInterval = deps.clearInterval ?? ((handle) => clearInterval(handle));
  }

  async getStatus(): Promise<NetworkStatus> {
    return this.status;
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);
    if (wasEmpty) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  /** Runs the probe once, immediately, and publishes if the result changed the known status. Test/DI seam so a caller does not have to wait `intervalMs` for the first real reading. */
  async check(): Promise<NetworkStatus> {
    await this.runProbe();
    return this.status;
  }

  /** Number of active subscribers; test-only visibility into whether polling is running. */
  subscriberCount(): number {
    return this.listeners.size;
  }

  private start(): void {
    if (this.timerHandle !== null) return;
    void this.runProbe();
    this.timerHandle = this.scheduleInterval(() => {
      void this.runProbe();
    }, this.intervalMs);
  }

  private stop(): void {
    if (this.timerHandle !== null) {
      this.cancelInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async runProbe(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = (async () => {
      let online: boolean;
      try {
        online = await this.probe();
      } catch {
        online = false;
      }
      const next: NetworkStatus = { online, kind: online ? "unknown" : "none" };
      if (next.online !== this.status.online || next.kind !== this.status.kind) {
        this.status = next;
        for (const listener of this.listeners) {
          listener(next);
        }
      }
    })();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}

export function createPollingNetworkReachability(
  deps: PollingNetworkReachabilityDeps,
): PollingNetworkReachability {
  return new PollingNetworkReachability(deps);
}

/**
 * The real, `fetch`-based probe `../app-shell/core.ts` wires in production.
 * `getProbeUrl()` is read fresh on every probe call (not captured once)
 * so it reflects whatever host is current when the poll fires. Returns
 * `true` unconditionally while `getProbeUrl()` is `null` — see this
 * module's doc comment's "no signal yet" note; this function does not
 * decide what counts as a probe target, only how to probe one once
 * given.
 */
export function createDefaultAndroidProbe(
  getProbeUrl: () => string | null,
): NetworkReachabilityProbe {
  return async () => {
    const url = getProbeUrl();
    if (!url) {
      return true;
    }
    try {
      const response = await fetch(url, { method: "HEAD" });
      return response.ok || response.status === 405; // 405: HEAD not allowed, but the host answered.
    } catch {
      return false;
    }
  };
}
