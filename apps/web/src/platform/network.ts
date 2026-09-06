import type {
  NetworkConnectionKind,
  NetworkReachability,
  NetworkStatus,
} from "@picompanion/frontend-core";

/** Minimal shape of the non-standard Network Information API, when present. */
interface NetworkInformationLike {
  type?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function connectionKind(): NetworkConnectionKind {
  if (!window.navigator.onLine) return "none";
  const connection = (window.navigator as { connection?: NetworkInformationLike }).connection;
  switch (connection?.type) {
    case "wifi":
      return "wifi";
    case "cellular":
      return "cellular";
    case "ethernet":
      return "ethernet";
    default:
      return "unknown";
  }
}

/** `NetworkReachability` backed by `navigator.onLine` (plan.md §7.3). */
export function createBrowserNetworkReachability(): NetworkReachability {
  const status = (): NetworkStatus => ({ online: window.navigator.onLine, kind: connectionKind() });

  return {
    async getStatus() {
      return status();
    },
    subscribe(listener) {
      const handler = () => listener(status());
      window.addEventListener("online", handler);
      window.addEventListener("offline", handler);
      const connection = (window.navigator as { connection?: NetworkInformationLike }).connection;
      connection?.addEventListener?.("change", handler);
      return () => {
        window.removeEventListener("online", handler);
        window.removeEventListener("offline", handler);
        connection?.removeEventListener?.("change", handler);
      };
    },
  };
}
