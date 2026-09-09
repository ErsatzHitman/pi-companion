/**
 * Device-revocation model (T42A2, plan.md §9.3 devices surface — see
 * `docs/issues-from-plan.md`'s T42A2 acceptance boxes). RN-free, like
 * every other model in this directory: no live daemon, socket, or device
 * required to test any of it. `DevicesScreen.tsx` only renders what this
 * module computes; the wire call itself goes through
 * `TrustedDevicesClient.revokeTrustedDevice` (declared on
 * `trusted-devices-model.ts`'s shared client interface, matching
 * `packages/client/src/daemon-client.ts`'s real
 * `revokeTrustedDevice(clientId, options?)`).
 *
 * ## Why there is no separate `onRevoke` prop
 *
 * T42A1's `DevicesScreen.tsx` doc comment sketched this seam as a new
 * `onRevoke?: (clientId: string) => void` prop threaded in from the
 * route. This module takes a different, narrower path instead:
 * `DevicesScreen` already receives `getClient: () => TrustedDevicesClient
 * | null` for listing, and the real production client passed through
 * that accessor already has `revokeTrustedDevice` at runtime — only the
 * TypeScript shape didn't declare it before this task. Declaring it on
 * `TrustedDevicesClient` (a single, one-line addition in
 * `trusted-devices-model.ts`) makes revocation reachable through the
 * exact same accessor listing already uses, with no new prop, no new
 * route-file wiring, and no second way for a caller to hand the screen a
 * client. `apps/android/src/app/h/[serverId]/devices.tsx` needed zero
 * changes for this reason.
 *
 * ## Confirmation, never a single tap (the "confirmed explicitly" box)
 *
 * Mirrors `../sessions/sessions-model.ts`'s delete-confirmation shape
 * exactly: `RevokeDeviceState.target` is set by `requestRevokeDevice` and
 * is what the screen's `Dialog` renders against; nothing calls
 * `performRevokeDevice` until `beginConfirmedRevokeDevice` has moved that
 * target into `pendingClientId`. `dismissRevokeRequest` takes no client
 * and no clientId — it cannot call the daemon even in principle, so a
 * dismissed dialog structurally cannot revoke anything.
 * `DevicesScreen.test.ts` pins the wiring (`Dialog`'s `onClose` calls
 * `handleDismissRevoke`, never `handleConfirmRevoke`) as a source
 * contract, the same way it pins everything else react-native can't be
 * rendered under this workspace's vitest setup to prove directly (this
 * repo's `CLAUDE.md` "RN-in-vitest limitation" note).
 *
 * ## Never a secret on screen
 *
 * `trusted_device.revoke.response` carries only `requestId`/`clientId`/
 * `success`/`error` (`packages/client/src/daemon-client.ts`'s
 * `revokeTrustedDevice` return type) — no password, key, or token, so
 * there is nothing to redact here either; see `trusted-devices-model.ts`'s
 * "Never a secret on screen" section for the sibling case.
 *
 * ## Degrading, never throwing (the "omits a method" acceptance box)
 *
 * `performRevokeDevice` never throws, mirroring `fetchTrustedDevices`.
 * A client missing `revokeTrustedDevice` resolves to `"unavailable"`.
 * `DevicesScreen.tsx` additionally never offers the "Revoke" affordance
 * at all when the client lacks the method (`canRevoke`), so this branch
 * is a defence-in-depth fallback, not the primary gate — matching this
 * app's established "omit the affordance rather than render it broken"
 * convention.
 *
 * ## One disclosed gap this module cannot close (read before assuming revocation is complete)
 *
 * The acceptance box below is a genuine gap in the DAEMON
 * (`packages/server`), not in this client module, and this task's `Owns`
 * grant forbids editing `packages/server` — so it is named here, by file
 * and function, rather than built around.
 *
 * CORRECTED (T299): this section used to also carry a box for
 * **"Revoking a device stops its notifications" — not true today**,
 * describing `packages/server/src/server/push/token-store.ts`'s
 * `PushTokenStore` as a flat `Set<string>` with no `clientId`
 * association, and `handleTrustedDeviceRevokeRequest` as never touching
 * it. T299 closed that: `PushTokenStore` now persists `{ clientId, token
 * }` pairs, `session.ts`'s `handleRegisterPushToken`/
 * `handleUnregisterPushToken` pass the connection's own `clientId`, and
 * `handleTrustedDeviceRevokeRequest` calls the new
 * `PushTokenStore.removeTokensForClient(clientId)` alongside
 * `cleanupConnection` — proven at the daemon layer by
 * `websocket-server.trusted-device-revoke.test.ts` and
 * `token-store.test.ts` (both `packages/server`). One residual is
 * disclosed there rather than fixed: a token persisted before T299 has
 * no recorded `clientId` and is grandfathered, so revoking a device
 * whose only token predates that daemon version does not stop it until
 * that device registers a fresh token. This client module still cannot
 * prove any of this itself — `revoke-device-model.test.ts`'s round-trip
 * case proves a revoked device disappears from a subsequent
 * `listTrustedDevices` call, never that its push notifications stopped,
 * which no fake in this workspace can honestly simulate without a real
 * daemon — but the claim this header made about the daemon's OWN
 * behaviour is no longer the true one, so it is corrected rather than
 * left standing.
 *
 * **"A revoked device cannot silently re-register" — not true today.**
 * Trust here is a single shared daemon password
 * (`packages/server/src/server/websocket-server.ts`'s
 * `isBearerTokenValid` check, run once per socket before any `hello` is
 * read), never a per-device secret. `handleHello` accepts a `hello` from
 * ANY `clientId` once that shared password has checked out and simply
 * calls `this.externalSessionsByKey.set(clientId, connection)` — there
 * is no persisted denylist of revoked `clientId`s consulted anywhere in
 * that path. Revoking a device you're still holding the daemon password
 * for and letting it reconnect (even under the same `clientId`) makes it
 * reappear in `trusted_device.list.response` as if nothing happened,
 * because nothing durable recorded that it had been revoked. The seam
 * that would close this: a persisted revoked-`clientId` store (the same
 * disk-persisted-`Set` shape `PushTokenStore` above already
 * establishes), written to by `handleTrustedDeviceRevokeRequest` on a
 * successful revoke, and consulted by `handleHello` before it creates or
 * resumes a `TrustedSessionConnection` for that `clientId` — rejecting
 * (or requiring an explicit fresh pairing to clear) a `hello` from a
 * revoked `clientId`. Nothing in this client package can enforce that;
 * it is a `packages/server` change, filed here by name rather than
 * pretended away.
 */
import type { TrustedDeviceRowSummary, TrustedDevicesClient } from "./trusted-devices-model.js";

export type RevokeDevicePhase = "idle" | "revoking";

export interface RevokeDeviceError {
  readonly clientId: string;
  readonly message: string;
}

export interface RevokeDeviceState {
  /**
   * The device a confirmation dialog is currently open for, or `null`
   * when it's closed. Set by `requestRevokeDevice`; cleared by
   * `dismissRevokeRequest` (no revoke happens) or by
   * `beginConfirmedRevokeDevice` (a revoke now begins) — see this
   * module's "Confirmation, never a single tap" section.
   */
  readonly target: TrustedDeviceRowSummary | null;
  readonly phase: RevokeDevicePhase;
  /** The `clientId` currently being revoked, or `null` once settled. */
  readonly pendingClientId: string | null;
  /** The most recent revoke failure, if any — kept until the next `requestRevokeDevice` (for this or any other device) begins. */
  readonly error: RevokeDeviceError | null;
}

export const IDLE_REVOKE_DEVICE_STATE: RevokeDeviceState = {
  target: null,
  phase: "idle",
  pendingClientId: null,
  error: null,
};

/** Opens the revoke-confirmation dialog for `target`. No client call happens here. */
export function requestRevokeDevice(
  state: RevokeDeviceState,
  target: TrustedDeviceRowSummary,
): RevokeDeviceState {
  return { ...state, target, error: null };
}

/**
 * Closes the dialog without revoking anything. Takes no client and no
 * clientId, so — structurally, not merely by convention — it cannot call
 * `performRevokeDevice`. The device named by `state.target` is left
 * exactly as it was.
 */
export function dismissRevokeRequest(state: RevokeDeviceState): RevokeDeviceState {
  if (!state.target) return state;
  return { ...state, target: null };
}

export interface BeginConfirmedRevokeResult {
  readonly state: RevokeDeviceState;
  /** `null` when there was nothing to confirm (`state.target` was already `null`) — callers must not call `performRevokeDevice` in that case. */
  readonly clientId: string | null;
}

/**
 * Moves the confirmed `target` into `pendingClientId` and clears the
 * dialog. `performRevokeDevice` must never be reachable except by way of
 * `requestRevokeDevice` (to open the dialog) and this function (to
 * confirm it) first.
 */
export function beginConfirmedRevokeDevice(state: RevokeDeviceState): BeginConfirmedRevokeResult {
  if (!state.target) return { state, clientId: null };
  const clientId = state.target.clientId;
  return {
    state: { ...state, target: null, phase: "revoking", pendingClientId: clientId, error: null },
    clientId,
  };
}

/** Clears the pending marker once a revoke for `clientId` resolves. A no-op if `state` is no longer pending for `clientId` — guards a stale response from a superseded attempt. */
export function completeRevokeDevice(
  state: RevokeDeviceState,
  clientId: string,
): RevokeDeviceState {
  if (state.pendingClientId !== clientId) return state;
  return { ...state, phase: "idle", pendingClientId: null };
}

/** Clears the pending marker and records a named, device-scoped error. The list itself is untouched here — only the caller's own `refresh()` (via `useTrustedDevices`), called on success, ever changes what's shown. */
export function failRevokeDevice(
  state: RevokeDeviceState,
  clientId: string,
  message: string,
): RevokeDeviceState {
  if (state.pendingClientId !== clientId) return state;
  return { ...state, phase: "idle", pendingClientId: null, error: { clientId, message } };
}

export interface RevokeDeviceOutcome {
  readonly status: "unavailable" | "success" | "error";
  /** Non-null only when `status === "error"`. */
  readonly error: string | null;
}

function explainRevokeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Revokes `clientId` against `client`. Never throws — see this module's
 * header "Degrading, never throwing" section for the exact mapping from
 * client shape/outcome to `RevokeDeviceOutcome.status`. A daemon-level
 * denial (e.g. "Cannot revoke current device", "Device not found" —
 * `packages/server/src/server/websocket-server.ts`'s
 * `handleTrustedDeviceRevokeRequest`) surfaces as `status: "error"` with
 * that response's own `error` message, identically to a rejected/thrown
 * call — callers don't need to tell the two apart to render a truthful
 * failure.
 */
export async function performRevokeDevice(
  client: TrustedDevicesClient | null | undefined,
  clientId: string,
): Promise<RevokeDeviceOutcome> {
  if (!client?.revokeTrustedDevice) {
    return { status: "unavailable", error: null };
  }
  try {
    const result = await client.revokeTrustedDevice(clientId);
    if (result.success) {
      return { status: "success", error: null };
    }
    return { status: "error", error: result.error ?? "Couldn't revoke this device." };
  } catch (error) {
    return { status: "error", error: explainRevokeFailure(error) };
  }
}
