/**
 * Network reachability interface (plan.md §7.3).
 *
 * Used by connection probing and reconnect policy to decide when to
 * retry. This is reachability only; the actual daemon transport lives in
 * `@picompanion/client`, not here.
 */
export type NetworkConnectionKind = "wifi" | "cellular" | "ethernet" | "unknown" | "none";

export interface NetworkStatus {
  online: boolean;
  kind: NetworkConnectionKind;
}

export interface NetworkReachability {
  getStatus(): Promise<NetworkStatus>;
  /** Subscribes to status changes; returns an unsubscribe function. */
  subscribe(listener: (status: NetworkStatus) => void): () => void;
}
