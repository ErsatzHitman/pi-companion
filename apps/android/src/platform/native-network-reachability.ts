import type {
  NetworkConnectionKind,
  NetworkReachability,
  NetworkStatus,
} from "@picompanion/frontend-core";

/**
 * Real, kind-reporting `NetworkReachability` for Android — T32P1.
 *
 * `./network-reachability.ts`'s `PollingNetworkReachability` (T32S3) was
 * an honestly-disclosed stopgap: with no connectivity library installed,
 * it could only ever probe a URL over HTTP and report `online`/`offline`
 * — `kind` stayed `"unknown"`/`"none"` forever, so
 * `../app-shell/resume-signals.ts`'s `"network-path-change"` rule (a
 * Wi-Fi -> cellular handoff, which keeps a socket open but bound to a
 * dead interface) could never fire. This module closes that gap the way
 * that doc comment said it would have to be closed: with real interface
 * metadata, which only a connectivity library — not an HTTP probe — can
 * supply.
 *
 * `@react-native-community/netinfo` is the obvious source for that
 * metadata, and is **not installed** in this workspace (`CLAUDE.md`
 * forbids `npm install` here; six agents share this worktree). So this
 * module never imports it. Instead it declares `NetInfoModule` — a
 * small port shaped exactly like netinfo's default export (`.fetch()`
 * and `.addEventListener()`, both already returning the `type`/
 * `isConnected`/`isInternetReachable` shape captured in `NetInfoState`
 * below) — and takes one as a constructor dependency. Every rule here is
 * therefore real and provable in plain `vitest` against a scripted fake
 * `NetInfoModule` (see `native-network-reachability.test.ts`), with zero
 * `react-native` import anywhere in this file.
 *
 * **The only remaining step, outside this task's grant, is:**
 *
 *     npm install --workspace=@picompanion/android @react-native-community/netinfo@11.4.1
 *
 * (`11.4.1` because `expo/bundledNativeModules.json` pins it — installing
 * a different version risks a native-module mismatch against the Expo
 * SDK this app targets) — followed by one import at the construction
 * site: `import NetInfo from "@react-native-community/netinfo"` in
 * `../app-shell/core.ts`, then `createNativeNetworkReachability(NetInfo)`
 * in place of `createPollingNetworkReachability(...)`. `NetInfo`'s real
 * default export already structurally satisfies `NetInfoModule` — no
 * wrapper needed at the call site beyond the import itself. That edit is
 * `../app-shell/core.ts`, which this task does not touch (T32S4's grant,
 * concurrently edited this wave) — see this task's final report for why
 * the construction site's shape needs to change and has not yet.
 *
 * Until that install + wiring lands, nothing in `apps/android`
 * constructs this class in production; `../app-shell/core.ts` still
 * builds `PollingNetworkReachability`, which `./network-reachability.ts`
 * keeps intact (untouched by this task) so that file's own build keeps
 * working. **No path kind this module reports has been observed on a
 * real device or emulator** — that proof is T37E/T59's, not this one's.
 */

/**
 * Mirrors `@react-native-community/netinfo`'s `NetInfoStateType` union
 * (v11). Anything the mapping below doesn't have a dedicated
 * `NetworkConnectionKind` for (`bluetooth`, `wimax`, `vpn`, `other`)
 * reports `"unknown"` — `NetworkStatus`'s `kind` has no richer bucket for
 * them, and inventing one here would go beyond what
 * `resume-signals.ts`'s `"network-path-change"` rule (a *change* in
 * `kind` while online) needs: it only needs `kind` to actually change
 * when the underlying interface does, which mapping to `"unknown"`
 * still lets it do (wifi -> vpn still trips the rule; vpn -> other does
 * not, same as two genuinely-unknown interfaces looking alike today).
 */
export type NetInfoStateType =
  | "none"
  | "unknown"
  | "cellular"
  | "wifi"
  | "bluetooth"
  | "ethernet"
  | "wimax"
  | "vpn"
  | "other";

/**
 * The subset of netinfo's `NetInfoState` this adapter reads. Real
 * `NetInfoState` carries a `details` union keyed on `type` too; this
 * adapter has no use for it, so it isn't part of the port.
 */
export interface NetInfoState {
  type: NetInfoStateType;
  /** `null` on some platforms while the OS is still determining this. */
  isConnected: boolean | null;
  /**
   * `null` while the OS has not yet finished an active reachability
   * check (common right after a network change), `undefined` if the
   * platform never reports it at all. Both are treated as "trust
   * `isConnected`" below — see `mapNetInfoStateToNetworkStatus`.
   */
  isInternetReachable?: boolean | null;
}

/**
 * Shaped exactly like `@react-native-community/netinfo`'s default
 * export: `NetInfo.fetch()` and `NetInfo.addEventListener()`. Per that
 * library's documented contract, `addEventListener` invokes `listener`
 * once immediately with the current state and again on every
 * subsequent change — this adapter relies on that immediate call rather
 * than issuing its own redundant `fetch()` on `subscribe()`.
 */
export interface NetInfoModule {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (state: NetInfoState) => void): () => void;
}

const KIND_BY_NETINFO_TYPE: Readonly<Record<NetInfoStateType, NetworkConnectionKind>> = {
  wifi: "wifi",
  cellular: "cellular",
  ethernet: "ethernet",
  none: "none",
  unknown: "unknown",
  bluetooth: "unknown",
  wimax: "unknown",
  vpn: "unknown",
  other: "unknown",
};

/**
 * Pure mapping from one netinfo reading to this app's `NetworkStatus`.
 * Exported on its own so it is testable independent of the class below,
 * and so a future caller with its own netinfo wiring (a test harness,
 * `apps/web` if it ever wants a Capacitor/native shell) can reuse it.
 *
 * Rules:
 * - `type === "none"` always reports `{ online: false, kind: "none" }`,
 *   regardless of `isConnected` — matches netinfo's own contract that
 *   `type` is `"none"` exactly when there is no active interface at all.
 * - Otherwise `kind` comes straight from `KIND_BY_NETINFO_TYPE`.
 * - `online` is `isConnected === true` — `null`/`false` both mean "not
 *   confirmed online", treated conservatively as offline — **and**
 *   `isInternetReachable !== false`: a device attached to Wi-Fi behind a
 *   captive portal is not actually online even though `isConnected` is
 *   `true`. `isInternetReachable` of `null`/`undefined` (not yet known)
 *   does not itself veto `isConnected`.
 */
export function mapNetInfoStateToNetworkStatus(state: NetInfoState): NetworkStatus {
  if (state.type === "none") {
    return { online: false, kind: "none" };
  }
  const kind = KIND_BY_NETINFO_TYPE[state.type] ?? "unknown";
  const online = state.isConnected === true && state.isInternetReachable !== false;
  return { online, kind };
}

/**
 * `NetworkReachability` backed by an injected `NetInfoModule`. Reports a
 * real `kind` (see the module doc comment above for why this exists and
 * what still has to happen to reach production), event-driven rather
 * than polled: no interval, no probe URL, no HTTP call of its own — the
 * native module already knows the interface state instantly.
 */
export class NativeNetworkReachability implements NetworkReachability {
  private readonly nativeModule: NetInfoModule;
  /**
   * Dedup baseline for the *current* native subscription only — reset to
   * `null` whenever the last listener leaves (see `subscribe()`'s
   * returned unsubscribe below), so a later resubscribe's immediate
   * delivery always reaches its listener even if the reading is
   * unchanged from what an earlier, now-gone listener last saw.
   * Deliberately not shared with `getStatus()`, which has no dedup
   * concept of its own — it is a plain read, not a subscription.
   */
  private lastPublished: NetworkStatus | null = null;
  private readonly listeners = new Set<(status: NetworkStatus) => void>();
  private unsubscribeNative: (() => void) | null = null;

  constructor(nativeModule: NetInfoModule) {
    this.nativeModule = nativeModule;
  }

  async getStatus(): Promise<NetworkStatus> {
    return mapNetInfoStateToNetworkStatus(await this.nativeModule.fetch());
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);
    if (wasEmpty) {
      this.unsubscribeNative = this.nativeModule.addEventListener((state) => {
        this.publish(mapNetInfoStateToNetworkStatus(state));
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unsubscribeNative?.();
        this.unsubscribeNative = null;
        this.lastPublished = null;
      }
    };
  }

  /** Number of active subscribers; test-only visibility into whether the native subscription is live. */
  subscriberCount(): number {
    return this.listeners.size;
  }

  private publish(next: NetworkStatus): void {
    const previous = this.lastPublished;
    if (previous !== null && previous.online === next.online && previous.kind === next.kind) {
      return;
    }
    this.lastPublished = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

export function createNativeNetworkReachability(
  nativeModule: NetInfoModule,
): NativeNetworkReachability {
  return new NativeNetworkReachability(nativeModule);
}
