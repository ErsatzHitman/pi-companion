/**
 * Push-registration model (T36A, plan.md §9.3; refresh ordering T61B).
 *
 * RN-free core for "register for push and handle token refresh
 * without duplicate registrations". Every native concern — reading the
 * OS permission, minting/refreshing a token — is behind
 * `push-registration-port.ts`'s `PushRegistrationPort`; this module
 * only ever sees plain strings and a `PushTokenRegistrar` (the shape of
 * `@picompanion/client`'s `DaemonClient.registerPushToken`/
 * `unregisterPushToken`), so it is unit-testable with no device, no
 * emulator, and no socket.
 *
 * ## The requests this proves against
 *
 * `packages/protocol/src/messages.ts`'s `RegisterPushTokenMessageSchema`
 * (`{ type: "register_push_token", token: string }`) and, since T61,
 * `UnregisterPushTokenMessageSchema` (`{ type: "unregister_push_token",
 * token: string }`) are the two push-registration requests in the wire
 * protocol. `packages/client/src/daemon-client.ts`'s
 * `registerPushToken(token)` / `unregisterPushToken(token)` (T61B) are
 * their client methods — both fire-and-forget sends with no response
 * message and no request id (`sendSessionMessage`, not `sendRequest`).
 *
 * T61's server-side doc comment on `RegisterPushTokenMessageSchema`
 * (`packages/protocol`) is explicit that registration is **purely
 * additive** — `PushTokenStore.addToken` (`packages/server`) never
 * removes anything, so a device that only ever sends new tokens on
 * refresh accumulates every token it has ever held, forever. The only
 * way to make a superseded token stop receiving is to send
 * `unregister_push_token` for it — which is exactly what this module's
 * refresh path (`submitToken`, and `attachTokenRefresh` below) now
 * does, in order, before registering the new one.
 *
 * ## Refresh ordering (T61B)
 *
 * When `submitToken(newToken)` is called and a *different* token was
 * previously registered, the controller:
 *
 *   1. Sends `unregisterPushToken(previousToken)`.
 *   2. Sends `registerPushToken(newToken)`.
 *
 * in that order — never the reverse, and never concurrently — because
 * both are fire-and-forget with no ack, so this is the only way to
 * bound the window in which *both* tokens are simultaneously live at
 * the daemon to "however long step 2 takes", rather than leaving it
 * open indefinitely.
 *
 * Both steps are `try`/`catch`-guarded (a synchronous throw is the only
 * failure signal `sendSessionMessage` can give — see
 * `DaemonClient.unregisterPushToken`'s doc comment), so every
 * interleaving has a **named** `PushTokenRefreshOutcome`, never a
 * defaulted one:
 *
 *  - `"refreshed"` — the old token was deregistered and the new one
 *    registered. The happy path.
 *  - `"device-unreachable"` — the old token was deregistered but the
 *    new one FAILED to register: this device now has **zero** tokens
 *    registered at the daemon until the next successful `submitToken`.
 *    `getLastRegisteredToken()` becomes `null` in this outcome.
 *  - `"superseded-token-still-active"` — deregistering the old token
 *    FAILED but the new one registered anyway: both tokens are live at
 *    the daemon. The failed token is recorded in an internal pending
 *    set and retried automatically at the start of the *next*
 *    `submitToken` cycle (`retryPendingDeregistrations`, also callable
 *    directly by a caller — e.g. on reconnect).
 *  - `"refresh-failed-token-unchanged"` — both steps failed: the old
 *    token remains the only one registered, unchanged; the failed
 *    deregistration is retried the same way.
 *  - `"registered-first-token"` / `"initial-registration-failed"` —
 *    no previous token existed (first-ever registration), so no
 *    deregistration was attempted at all.
 *
 * `getLastRefreshOutcome()` exposes the most recently completed cycle's
 * outcome for callers/tests that need it.
 *
 * ## The concurrency rules this proves (`push-registration-model.test.ts`)
 *
 *  - Submitting the same token twice, sequentially, registers once and
 *    attempts no deregistration (it is a no-op duplicate, not a
 *    refresh).
 *  - Submitting a new token deregisters the old one, then registers the
 *    new one, and moves `getLastRegisteredToken()` forward.
 *  - Two submissions that race (called back-to-back, before either has
 *    resolved) never both call the registrar: the second is queued
 *    behind the first's in-flight cycle, not run concurrently with it.
 *  - A submission arriving while a registration is already in flight is
 *    queued, not raced; only the *latest* queued token survives if more
 *    than one arrives before the in-flight cycle drains (a real token
 *    stream only ever has one current value, so collapsing to the
 *    latest loses nothing).
 *  - `getRegistrationCallCount()` / `getDeregistrationCallCount()` (not
 *    just final state) are what the tests assert, per this task's
 *    brief: "Assert the registration call count, not just the final
 *    state."
 *  - A failed deregistration never blocks or fails the accompanying
 *    registration, and is retried automatically on the next cycle.
 *  - Deregistering a token the daemon never held is, from this module's
 *    side, indistinguishable from deregistering one it did: the same
 *    fire-and-forget call is made either way, with no branching on
 *    prior knowledge the client does not have (see
 *    `packages/client/src/push-token.test.ts` for the wire-shape half
 *    of this proof, and `UnregisterPushTokenMessageSchema`'s doc
 *    comment in `packages/protocol` for the server-side guarantee this
 *    relies on).
 */
import type { SecureStorage } from "@picompanion/frontend-core";
import type { PermissionState } from "../composer/permission-recovery.js";

/**
 * The narrow shape this module needs from a daemon client — exactly
 * `DaemonClient.registerPushToken`/`unregisterPushToken`'s signatures
 * (`packages/client/src/daemon-client.ts`), kept as a separate type so
 * this module never needs to import the full client (or anything that
 * would drag React Native into a `vitest` run — see this repo's
 * standing VITEST LIMITATION note) just to call these two methods on
 * it.
 */
export interface PushTokenRegistrar {
  registerPushToken(token: string): void;
  /**
   * Mirrors `DaemonClient.unregisterPushToken` (T61B). Fire-and-forget,
   * exactly like `registerPushToken` — may throw synchronously (e.g.
   * the daemon connection is down) when the underlying send cannot
   * happen; the controller below treats that throw as a named
   * `PushTokenRefreshOutcome`, never lets it escape `submitToken`, and
   * queues the token for a retry — see this module's header.
   */
  unregisterPushToken(token: string): void;
}

export interface PushRegistrationControllerDeps {
  registrar: PushTokenRegistrar;
  /**
   * A push token is a credential-shaped value (T36A brief). When
   * provided, the controller persists the last-registered token here —
   * never in plain key-value storage — exactly as
   * `../connect/credential-store.ts` persists daemon passwords and
   * relay keys. Optional: a caller with nowhere durable to put it (or
   * that only wants in-process dedupe for this process's lifetime) may
   * omit it.
   */
  secureStorage?: SecureStorage;
  /** Key under which the token is stored. Defaults to a fixed, non-secret key name; the *value* stored there is what must never leak, not this key. */
  secureStorageKey?: string;
}

/**
 * Named outcome of one `submitToken` cycle that had a previous token to
 * consider (a true refresh) or not (the first-ever registration). See
 * this module's header "Refresh ordering (T61B)" section for exactly
 * what each value means and what state follows it.
 */
export type PushTokenRefreshOutcome =
  | "registered-first-token"
  | "initial-registration-failed"
  | "refreshed"
  | "device-unreachable"
  | "superseded-token-still-active"
  | "refresh-failed-token-unchanged";

export interface PushRegistrationController {
  /**
   * Submits a token — an initial registration or a refresh. Resolves
   * once this token (or whatever superseded it before this call's turn
   * came up) has either been processed or recognised as a no-op
   * duplicate. Never throws on a duplicate; never rejects on a race —
   * see this module's header for the exact rules this method enforces.
   * When a different token was previously registered, this deregisters
   * it before registering the new one — see "Refresh ordering (T61B)".
   */
  submitToken(token: string): Promise<void>;
  /**
   * Forgets the last-registered token without contacting the registrar.
   * Intended for a caller that reconnects to the daemon and cannot
   * assume a previous registration survived the disconnect — the next
   * `submitToken`, even with an unchanged token, will register again
   * (and will NOT attempt to deregister the forgotten token, since this
   * method does not contact the registrar at all).
   * Not wired to any connection-state signal by this module itself; see
   * this task's report for the seam this leaves for whichever task
   * owns daemon connection-state transitions.
   */
  resetForNewConnection(): void;
  /**
   * Retries every deregistration that previously failed
   * (`"superseded-token-still-active"` / `"refresh-failed-token-unchanged"`
   * outcomes). Called automatically at the start of every `submitToken`
   * cycle; also exposed directly so a caller with its own retry signal
   * (e.g. "the daemon connection just came back") can trigger it
   * without waiting for the next token to arrive. Never throws — a
   * still-failing retry simply stays pending for the next attempt.
   */
  retryPendingDeregistrations(): void;
  /** The most recently registered token, or `null` before any registration, or after a `"device-unreachable"` outcome. Never logged or exposed by this module in any other form. */
  getLastRegisteredToken(): string | null;
  /** Total number of times `registrar.registerPushToken` has actually been called — the count the "no duplicate registrations" tests assert. */
  getRegistrationCallCount(): number;
  /** Total number of times `registrar.unregisterPushToken` has actually been called, including retries — the deregistration-side counterpart to {@link getRegistrationCallCount}. */
  getDeregistrationCallCount(): number;
  /** The `PushTokenRefreshOutcome` of the most recently completed `submitToken` cycle, or `null` before any cycle has completed. */
  getLastRefreshOutcome(): PushTokenRefreshOutcome | null;
  /** Tokens whose deregistration failed and have not yet been retried successfully. Exposed for tests/diagnostics only — never logged (a token is a credential-shaped value; see this module's `secureStorage` doc comment). */
  getPendingDeregistrationTokens(): readonly string[];
}

const DEFAULT_SECURE_STORAGE_KEY = "push-token";

export function createPushRegistrationController(
  deps: PushRegistrationControllerDeps,
): PushRegistrationController {
  const { registrar, secureStorage } = deps;
  const secureStorageKey = deps.secureStorageKey ?? DEFAULT_SECURE_STORAGE_KEY;

  let lastRegisteredToken: string | null = null;
  let busy = false;
  /** The most recent token to arrive while a cycle was in flight. `undefined` means nothing is queued — distinct from a token value, so an empty-string token (never realistic, but never assumed away) still queues correctly. */
  let queuedToken: string | undefined;
  let registrationCallCount = 0;
  let deregistrationCallCount = 0;
  let lastRefreshOutcome: PushTokenRefreshOutcome | null = null;
  /** Tokens whose deregistration failed and still need a retry. A `Set` so a repeatedly-failing token is never queued twice. */
  const pendingDeregistrations = new Set<string>();

  /**
   * Attempts to deregister `token`. Never throws — a failure is
   * recorded into `pendingDeregistrations` for a later retry rather
   * than propagated, since a deregistration failure must never block
   * or fail the registration that follows it (see this module's header).
   */
  function tryDeregister(token: string): boolean {
    deregistrationCallCount += 1;
    try {
      registrar.unregisterPushToken(token);
      pendingDeregistrations.delete(token);
      return true;
    } catch {
      pendingDeregistrations.add(token);
      return false;
    }
  }

  function retryPendingDeregistrations(): void {
    // Snapshot first: tryDeregister mutates pendingDeregistrations, and
    // iterating a Set while deleting from it mid-iteration is well
    // defined in JS, but a snapshot keeps this obviously correct
    // regardless of iteration-order guarantees.
    for (const token of Array.from(pendingDeregistrations)) {
      tryDeregister(token);
    }
  }

  /**
   * Runs one refresh cycle for `newToken` given whatever
   * `previousToken` was registered before it (`null` for the
   * first-ever registration). Implements the "deregister old, then
   * register new, in that order" contract and returns the named
   * outcome — see this module's header "Refresh ordering (T61B)"
   * section for what each outcome means.
   */
  async function performCycle(
    previousToken: string | null,
    newToken: string,
  ): Promise<PushTokenRefreshOutcome> {
    const deregisterSucceeded = previousToken === null ? null : tryDeregister(previousToken);

    registrationCallCount += 1;
    let registerSucceeded = true;
    try {
      registrar.registerPushToken(newToken);
    } catch {
      registerSucceeded = false;
    }

    if (registerSucceeded && secureStorage) {
      // Never persisted anywhere but SecureStorage — see this module's
      // and `PushRegistrationControllerDeps.secureStorage`'s doc
      // comments. Also the one guaranteed async yield point in this
      // loop, which is what lets a synchronously-issued concurrent
      // `submitToken` call observe `busy === true` before this cycle
      // finishes — see `drain`'s comment below.
      await secureStorage.setSecret(secureStorageKey, newToken);
    } else {
      // Either no secure storage was supplied, or registration failed
      // (nothing to persist). Still yield once, so this method's
      // concurrency guarantee does not silently depend on whether a
      // caller happened to pass `secureStorage` — the "two concurrent
      // submissions never both register" test exercises the
      // no-secureStorage path specifically to cover this.
      await Promise.resolve();
    }

    if (registerSucceeded) {
      lastRegisteredToken = newToken;
    } else if (deregisterSucceeded === true) {
      // The old token is gone and the new one failed to register: this
      // device now has zero tokens registered until the next
      // successful submitToken — a named, surfaced state, not silently
      // dropped.
      lastRegisteredToken = null;
    }
    // else: registration failed and deregistration either failed or
    // was never attempted — lastRegisteredToken (previousToken, or
    // null on the very first attempt) is unchanged.

    if (previousToken === null) {
      return registerSucceeded ? "registered-first-token" : "initial-registration-failed";
    }
    if (registerSucceeded) {
      return deregisterSucceeded === true ? "refreshed" : "superseded-token-still-active";
    }
    return deregisterSucceeded === true ? "device-unreachable" : "refresh-failed-token-unchanged";
  }

  async function drain(startToken: string): Promise<void> {
    let current: string | undefined = startToken;
    while (current !== undefined) {
      if (current !== lastRegisteredToken) {
        const previous = lastRegisteredToken;
        lastRefreshOutcome = await performCycle(previous, current);
      }
      // Re-check *after* awaiting: a concurrent `submitToken` call that
      // arrived while `performCycle` was suspended above queued itself
      // into `queuedToken`, and only the latest such arrival survives.
      current = queuedToken;
      queuedToken = undefined;
    }
  }

  /**
   * Tracks the currently-running (or most recently finished) drain
   * cycle, so a call that arrives while one is in flight can `queue`
   * its token *and* still return a promise that resolves only once that
   * token has actually been handled — not the moment it was queued.
   */
  let cyclePromise: Promise<void> = Promise.resolve();

  async function submitToken(token: string): Promise<void> {
    if (busy) {
      queuedToken = token;
      return cyclePromise;
    }
    busy = true;
    // Every fresh cycle gets a chance to clear out anything a previous
    // cycle failed to deregister — see this module's header.
    retryPendingDeregistrations();
    cyclePromise = (async () => {
      try {
        await drain(token);
      } finally {
        busy = false;
      }
    })();
    return cyclePromise;
  }

  return {
    submitToken,
    resetForNewConnection() {
      lastRegisteredToken = null;
    },
    retryPendingDeregistrations,
    getLastRegisteredToken() {
      return lastRegisteredToken;
    },
    getRegistrationCallCount() {
      return registrationCallCount;
    },
    getDeregistrationCallCount() {
      return deregistrationCallCount;
    },
    getLastRefreshOutcome() {
      return lastRefreshOutcome;
    },
    getPendingDeregistrationTokens() {
      return Array.from(pendingDeregistrations);
    },
  };
}

/** Outcome of one {@link registerForPush} attempt — never throws; every native/permission gap is a named outcome instead. */
export type PushRegistrationOutcome =
  | "registered"
  | "permission-not-granted"
  | "no-token-available";

/**
 * Reads the current permission (never prompts — see
 * `../composer/permission-recovery.ts`'s `resolvePermission`, which
 * this module deliberately does not call here: prompting for
 * notification permission belongs at a user-initiated moment a future
 * screen owns, not at registration time), and when already `"granted"`,
 * fetches a token and submits it to `controller`.
 *
 * This is the end-to-end shape "registration succeeds against the dev
 * daemon" is re-scoped to in this task's brief: with `port` and
 * `controller.submitToken`'s `registrar` both scripted fakes, this
 * function's outcome and `registrar`'s recorded calls are the full
 * proof this task can give without a socket.
 */
export async function registerForPush(
  port: { getPermissionStatus(): Promise<PermissionState>; getToken(): Promise<string | null> },
  controller: PushRegistrationController,
): Promise<PushRegistrationOutcome> {
  const status = await port.getPermissionStatus();
  if (status !== "granted") {
    return "permission-not-granted";
  }
  const token = await port.getToken();
  if (token === null) {
    return "no-token-available";
  }
  await controller.submitToken(token);
  return "registered";
}

/**
 * Wires a `PushRegistrationPort`'s refresh stream to `controller`,
 * fire-and-forget per refresh (a caller that needs to know when a
 * given refresh has landed should call `controller.submitToken`
 * directly instead of going through this helper). Returns the port's
 * own unsubscribe function unchanged.
 *
 * Each refresh goes through `controller.submitToken`, which — per this
 * module's header — deregisters whatever token was previously
 * registered before registering the new one, so a device that keeps
 * refreshing its token never accumulates stale entries at the daemon.
 */
export function attachTokenRefresh(
  port: { onTokenRefresh(handler: (token: string) => void): () => void },
  controller: PushRegistrationController,
): () => void {
  return port.onTokenRefresh((token) => {
    void controller.submitToken(token);
  });
}
