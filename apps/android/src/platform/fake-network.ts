import type { NetworkReachability, NetworkStatus } from "@picompanion/frontend-core";

/**
 * Fake, in-memory `NetworkReachability` — a T16-era production stand-in,
 * now a test double only.
 *
 * Originally built so the Phase 1 connected/disconnected shell had
 * something implementing the real `NetworkReachability` interface before
 * `frontend-core`'s `connection/` domain existed. That production role
 * is gone as of T32S3/T32P1: `../app-shell/core.ts` now constructs a real
 * adapter (`PollingNetworkReachability`, moving to
 * `./native-network-reachability.ts`'s `NativeNetworkReachability` once
 * `@react-native-community/netinfo` is installed — see that module's doc
 * comment), so nothing on the production path builds this class anymore.
 *
 * Kept — not deleted — because `../app-shell/resume-signals.test.ts`
 * (T32S4's grant this wave) still imports it as a simple, hand-drivable
 * `NetworkStatus` source (`setStatus()`) for exercising
 * `attachResumeSignals()`'s churn rules without a scripted probe/netinfo
 * fake. That is its only live importer; if that test is ever rewritten
 * to stop needing it, this file should be deleted along with it.
 */
export class FakeNetworkReachability implements NetworkReachability {
  private status: NetworkStatus;
  private readonly listeners = new Set<(status: NetworkStatus) => void>();

  constructor(initialStatus: NetworkStatus = { online: true, kind: "wifi" }) {
    this.status = initialStatus;
  }

  async getStatus(): Promise<NetworkStatus> {
    return this.status;
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test/demo-only: simulates a connectivity change. */
  setStatus(status: NetworkStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
