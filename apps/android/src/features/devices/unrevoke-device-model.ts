/**
 * Device un-revocation model (device-unrevoke — the undo half of
 * `revoke-device-model.ts`'s T42A2 revocation, plan.md §9.3 devices
 * surface). RN-free, like every other model in this directory: no live
 * daemon, socket, or device required to test any of it.
 * `DevicesScreen.tsx` only renders what this module computes; the wire
 * call itself goes through `TrustedDevicesClient.unrevokeTrustedDevice`
 * (declared on `trusted-devices-model.ts`'s shared client interface,
 * matching `packages/client/src/daemon-client.ts`'s real
 * `unrevokeTrustedDevice(clientId, options?)`, which sends
 * `trusted_device.unrevoke.request` and resolves the matching
 * `trusted_device.unrevoke.response` payload).
 *
 * ## Why revocation needs remembering here at all
 *
 * The daemon has no list-revoked wire message — `trusted_device.list`
 * only ever returns currently-trusted devices, and a revoked device's
 * entry is cleaned up at revoke time — so after a revoke the app cannot
 * ask the daemon "which devices are revoked". This module therefore keeps
 * a session-local `revokedClientIds` list: `DevicesScreen.tsx` appends to
 * it (`rememberRevokedDevice`) on every successful revoke and renders it
 * as its "Recently revoked" section, and a successful un-revoke removes
 * the entry again (`completeUnrevokeDevice`). The honest limitation,
 * stated rather than hidden: the list starts empty on every app launch.
 * Un-revoking a device revoked in a previous session needs its `clientId`
 * re-established some other way — there is still no wire to list one.
 *
 * ## No confirmation dialog (deliberately unlike revocation)
 *
 * Revocation closes sockets, stops pushes, and durably denylists the
 * device, so `revoke-device-model.ts` requires an explicit dialog
 * confirmation before `performRevokeDevice` is reachable. Un-revoking only
 * lifts the denylist entry — it disconnects nobody and delivers nothing —
 * so a single tap reaches `performUnrevokeDevice` by way of
 * `beginUnrevokeDevice` (which exists only to mark the row pending and to
 * refuse a second concurrent attempt, never to open a dialog).
 *
 * ## Never a secret on screen
 *
 * `trusted_device.unrevoke.response` carries only `requestId`/`clientId`/
 * `success`/`error` (`packages/client/src/daemon-client.ts`'s
 * `unrevokeTrustedDevice` return type) — no password, key, or token, so
 * there is nothing to redact here either; see `trusted-devices-model.ts`'s
 * "Never a secret on screen" section for the sibling case.
 *
 * ## Degrading, never throwing
 *
 * `performUnrevokeDevice` never throws, mirroring `performRevokeDevice`.
 * A client missing `unrevokeTrustedDevice` resolves to `"unavailable"`.
 * `DevicesScreen.tsx` additionally never offers the "Un-revoke"
 * affordance at all when the client lacks the method (`canUnrevoke`), so
 * this branch is a defence-in-depth fallback, not the primary gate —
 * matching this app's established "omit the affordance rather than render
 * it broken" convention.
 */
import type { TrustedDevicesClient } from "./trusted-devices-model.js";

export type UnrevokeDevicePhase = "idle" | "unrevoking";

export interface UnrevokeDeviceError {
  readonly clientId: string;
  readonly message: string;
}

export interface UnrevokeDeviceState {
  readonly phase: UnrevokeDevicePhase;
  /** The `clientId` currently being un-revoked, or `null` once settled. */
  readonly pendingClientId: string | null;
  /** The most recent un-revoke failure, if any — kept until the next `beginUnrevokeDevice` begins. */
  readonly error: UnrevokeDeviceError | null;
  /**
   * `clientId`s this session has revoked and not yet un-revoked — what
   * `DevicesScreen.tsx` renders as its "Recently revoked" section. There
   * is no list-revoked wire message, so this is the only source of rows
   * that section can show; see this module's header for why it starts
   * empty on every launch.
   */
  readonly revokedClientIds: readonly string[];
}

export const IDLE_UNREVOKE_DEVICE_STATE: UnrevokeDeviceState = {
  phase: "idle",
  pendingClientId: null,
  error: null,
  revokedClientIds: [],
};

/**
 * Remembers `clientId` as revoked in-session. A no-op (identity-preserving)
 * for a blank `clientId` or one already remembered — revoking the same
 * device twice must not duplicate its row.
 */
export function rememberRevokedDevice(
  state: UnrevokeDeviceState,
  clientId: string,
): UnrevokeDeviceState {
  const trimmed = clientId.trim();
  if (!trimmed || state.revokedClientIds.includes(trimmed)) return state;
  return { ...state, revokedClientIds: [...state.revokedClientIds, trimmed] };
}

/**
 * Forgets `clientId` without calling the daemon — for callers that learn
 * out-of-band that an entry is stale. A no-op (identity-preserving) when
 * the `clientId` is not remembered. Successful un-revokes go through
 * `completeUnrevokeDevice` instead, which forgets AND clears the pending
 * marker together.
 */
export function forgetRevokedDevice(
  state: UnrevokeDeviceState,
  clientId: string,
): UnrevokeDeviceState {
  if (!state.revokedClientIds.includes(clientId)) return state;
  return {
    ...state,
    revokedClientIds: state.revokedClientIds.filter((entry) => entry !== clientId),
  };
}

export interface BeginUnrevokeResult {
  readonly state: UnrevokeDeviceState;
  /**
   * `null` when there is nothing to un-revoke (a blank `clientId`) or when
   * another un-revoke is already pending — callers must not call
   * `performUnrevokeDevice` in either case.
   */
  readonly clientId: string | null;
}

/**
 * Marks `clientId` as pending and clears any prior error. Only one
 * un-revoke runs at a time: while `state.phase` is `"unrevoking"` every
 * further attempt reports a `null` `clientId` until the pending one
 * settles via `completeUnrevokeDevice`/`failUnrevokeDevice`.
 */
export function beginUnrevokeDevice(
  state: UnrevokeDeviceState,
  clientId: string,
): BeginUnrevokeResult {
  const trimmed = clientId.trim();
  if (!trimmed || state.phase !== "idle") return { state, clientId: null };
  return {
    state: {
      ...state,
      phase: "unrevoking",
      pendingClientId: trimmed,
      error: null,
    },
    clientId: trimmed,
  };
}

/**
 * Clears the pending marker AND forgets `clientId` — it is no longer
 * revoked, so its "Recently revoked" row must go away. A no-op if `state`
 * is no longer pending for `clientId` — guards a stale response from a
 * superseded attempt.
 */
export function completeUnrevokeDevice(
  state: UnrevokeDeviceState,
  clientId: string,
): UnrevokeDeviceState {
  if (state.pendingClientId !== clientId) return state;
  return {
    ...state,
    phase: "idle",
    pendingClientId: null,
    revokedClientIds: state.revokedClientIds.filter((entry) => entry !== clientId),
  };
}

/**
 * Clears the pending marker and records a named, device-scoped error. The
 * `clientId` stays remembered — it is still revoked, so its row (and its
 * retry) must stay present.
 */
export function failUnrevokeDevice(
  state: UnrevokeDeviceState,
  clientId: string,
  message: string,
): UnrevokeDeviceState {
  if (state.pendingClientId !== clientId) return state;
  return { ...state, phase: "idle", pendingClientId: null, error: { clientId, message } };
}

export interface UnrevokeDeviceOutcome {
  readonly status: "unavailable" | "success" | "error";
  /** Non-null only when `status === "error"`. */
  readonly error: string | null;
}

function explainUnrevokeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Un-revokes `clientId` against `client`. Never throws — see this module's
 * header "Degrading, never throwing" section for the exact mapping from
 * client shape/outcome to `UnrevokeDeviceOutcome.status`. A daemon-level
 * denial (e.g. "Invalid clientId" —
 * `packages/server/src/server/websocket-server.ts`'s
 * `handleTrustedDeviceUnrevokeRequest`) surfaces as `status: "error"` with
 * that response's own `error` message, identically to a rejected/thrown
 * call — callers don't need to tell the two apart to render a truthful
 * failure.
 */
export async function performUnrevokeDevice(
  client: TrustedDevicesClient | null | undefined,
  clientId: string,
): Promise<UnrevokeDeviceOutcome> {
  if (!client?.unrevokeTrustedDevice) {
    return { status: "unavailable", error: null };
  }
  try {
    const result = await client.unrevokeTrustedDevice(clientId);
    if (result.success) {
      return { status: "success", error: null };
    }
    return { status: "error", error: result.error ?? "Couldn't un-revoke this device." };
  } catch (error) {
    return { status: "error", error: explainUnrevokeFailure(error) };
  }
}
