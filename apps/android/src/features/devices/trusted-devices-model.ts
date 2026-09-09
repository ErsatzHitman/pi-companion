/**
 * Trusted-devices model (T42A1, plan.md §9.3 devices surface).
 *
 * RN-free core for "list the daemon's trusted devices, and describe each
 * one without exposing a secret" — no live daemon, socket, or device
 * required to test any of it. `DevicesScreen.tsx` only renders what this
 * module (and `device-push-status-model.ts`, for this device's own push
 * state) computes.
 *
 * ## The request this proves against
 *
 * `packages/protocol/src/messages.ts`'s `TrustedDeviceListRequestSchema`
 * (`{ type: "trusted_device.list.request", requestId }`) and its response
 * `TrustedDeviceListResponseSchema` (`{ type: "trusted_device.list.response",
 * payload: { requestId, devices: [{ clientId, appVersion, lastSeenAt,
 * connected }] } }`) are the wire shape this module reads.
 * `packages/client/src/daemon-client.ts`'s real `listTrustedDevices(options?)`
 * is the one production caller `TrustedDevicesClient` below is a
 * structural subset of — read directly rather than re-declared here, so a
 * real `DaemonClient` instance satisfies it as-is (width subtyping),
 * exactly like `../composer/slash-command-model.ts`'s narrow
 * `listCommands?` client shape.
 *
 * `revokeTrustedDevice` is deliberately NOT part of this module — T42A2
 * owns device revocation and this file's job stops at listing. See
 * `DevicesScreen.tsx`'s doc comment for the exact seam T42A2 should add.
 *
 * ## Never a secret on screen
 *
 * The wire payload above carries only `clientId`/`appVersion`/`lastSeenAt`/
 * `connected` — no password, key, token, or PIN ever appears in a
 * `trusted_device.list.response`, so there is nothing to redact the way
 * `../diagnostics/diagnostics-export.ts` redacts a daemon endpoint's
 * password. `summarizeTrustedDevice` below is still an explicit
 * ALLOW-LIST projection off `TrustedDeviceRecord` — it destructures
 * exactly those four fields and nothing else — so a future server
 * response that starts carrying a fifth (secret-shaped) field can never
 * reach this feature's rendered output just because it rode along on the
 * same object. `trusted-devices-model.test.ts`'s "never surfaces a field
 * outside the allow-list" case proves this directly, by attaching a
 * hostile extra field to a fixture record and asserting it never appears
 * in the summary.
 *
 * ## Degrading, never throwing (the "omits a method" acceptance box)
 *
 * `fetchTrustedDevices` never throws. A client missing `listTrustedDevices`
 * entirely (an older client build, a fake in a test, or a narrower
 * interface than the real `DaemonClient`) resolves to `"unavailable"` — an
 * empty list, not an error — mirroring every other optional-capability
 * seam in this app (`onQueueUpdate`, `abort`, `../composer/slash-command-
 * model.ts`'s `listCommands`). A client that HAS the method but whose call
 * rejects (no daemon connection, a wire error) resolves to `"error"` with
 * the caught message — also never a throw past this function.
 */

export interface TrustedDeviceRecord {
  readonly clientId: string;
  readonly appVersion: string | null;
  readonly lastSeenAt: string;
  readonly connected: boolean;
}

export interface TrustedDeviceListResult {
  readonly requestId: string;
  readonly devices: readonly TrustedDeviceRecord[];
}

/**
 * Structural subset of `DaemonClient.listTrustedDevices`
 * (`packages/client/src/daemon-client.ts`). Optional so a client build
 * (or test fake) that omits it entirely is still a valid
 * `TrustedDevicesClient` — see this module's header "Degrading, never
 * throwing" section.
 */
export interface TrustedDevicesClient {
  listTrustedDevices?(options?: { requestId?: string }): Promise<TrustedDeviceListResult>;
}

export type TrustedDevicesLoadStatus = "loading" | "loaded" | "error" | "unavailable";

export interface TrustedDevicesSnapshot {
  readonly status: TrustedDevicesLoadStatus;
  readonly devices: readonly TrustedDeviceRecord[];
  /** The caught failure's message; `null` unless `status === "error"`. */
  readonly error: string | null;
}

export const LOADING_TRUSTED_DEVICES_SNAPSHOT: TrustedDevicesSnapshot = {
  status: "loading",
  devices: [],
  error: null,
};

function explainFetchFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetches the trusted-device list from `client`. Never throws — see this
 * module's header "Degrading, never throwing" section for the exact
 * mapping from client shape/outcome to `TrustedDevicesSnapshot.status`.
 */
export async function fetchTrustedDevices(
  client: TrustedDevicesClient | null | undefined,
): Promise<TrustedDevicesSnapshot> {
  if (!client?.listTrustedDevices) {
    return { status: "unavailable", devices: [], error: null };
  }
  try {
    const result = await client.listTrustedDevices();
    return { status: "loaded", devices: result.devices, error: null };
  } catch (error) {
    return { status: "error", devices: [], error: explainFetchFailure(error) };
  }
}

export interface TrustedDeviceRowSummary {
  readonly clientId: string;
  readonly isThisDevice: boolean;
  readonly appVersionLabel: string;
  readonly lastSeenLabel: string;
  readonly connected: boolean;
}

/**
 * ALLOW-LIST projection off a raw `TrustedDeviceRecord` — see this
 * module's header "Never a secret on screen" section. Reads exactly
 * `clientId`/`appVersion`/`lastSeenAt`/`connected` off `device` and
 * nothing else, regardless of what other fields `device` might carry.
 */
export function summarizeTrustedDevice(
  device: TrustedDeviceRecord,
  options: { thisClientId: string; now?: Date },
): TrustedDeviceRowSummary {
  return {
    clientId: device.clientId,
    isThisDevice: device.clientId === options.thisClientId,
    appVersionLabel: device.appVersion ?? "Unknown version",
    lastSeenLabel: formatLastSeen(device.lastSeenAt, options.now ?? new Date()),
    connected: device.connected,
  };
}

/**
 * Display order only — this device first, then connected devices, then
 * most-recently-seen first. `TrustedDevicesSnapshot.devices` itself is
 * left in whatever order the daemon returned it; nothing upstream of the
 * screen depends on this function's output order.
 */
export function sortTrustedDevices(
  devices: readonly TrustedDeviceRecord[],
  thisClientId: string,
): readonly TrustedDeviceRecord[] {
  return [...devices].sort((a, b) => {
    if (a.clientId === thisClientId && b.clientId !== thisClientId) return -1;
    if (b.clientId === thisClientId && a.clientId !== thisClientId) return 1;
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });
}

/**
 * Coarse, second-granularity relative time. Deliberately not a live
 * clock — this is a list row read once per render, not a ticking
 * countdown. An unparseable `lastSeenAt` (should never happen against a
 * real daemon, but this function never throws on it) renders as
 * `"Unknown"` rather than `"NaNm ago"` or a crash.
 */
export function formatLastSeen(lastSeenAt: string, now: Date = new Date()): string {
  const parsedMs = new Date(lastSeenAt).getTime();
  if (Number.isNaN(parsedMs)) {
    return "Unknown";
  }
  const diffMs = now.getTime() - parsedMs;
  if (diffMs < 60_000) {
    // Also covers a small negative diff (clock skew) — never "in the
    // future by 2s", just "Just now".
    return "Just now";
  }
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return new Date(lastSeenAt).toLocaleDateString();
}
