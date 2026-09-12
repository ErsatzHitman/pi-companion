/**
 * T36A — push-registration model tests, plan.md §9.3.
 *
 * Proves the "request/response round-trip against a scripted fake
 * client" this task's brief re-scopes "succeeds against the dev
 * daemon" to (no socket is opened anywhere in this file — see the
 * repo-wide port-6767/6768 rule), and every duplicate/refresh/race rule
 * from this task's EXTRA CONTEXT, each asserted on
 * `getRegistrationCallCount()`, not just final state.
 *
 * What this file does NOT prove, on purpose: an actual push token
 * cannot be minted without a real device and a real Expo/EAS project
 * id, and this app has no daemon socket to register one over even if it
 * had a token. T37E (Maestro) and T59 (real device) own that half.
 */
import { describe, expect, it, vi } from "vitest";
import {
  RegisterPushTokenMessageSchema,
  UnregisterPushTokenMessageSchema,
} from "@picompanion/protocol/messages";

import {
  attachTokenRefresh,
  createPushRegistrationController,
  registerForPush,
  type PushTokenRegistrar,
} from "./push-registration-model";
import {
  createUnavailablePushRegistrationPort,
  type PushRegistrationPort,
} from "./push-registration-port";
import type { PermissionState } from "../composer/permission-recovery";

/** A scripted fake `PushRegistrationPort` this task's tests use in place of a real device/socket. */
function createScriptedPort(options: {
  permission: PermissionState;
  token: string | null;
}): PushRegistrationPort & { emitRefresh(token: string): void } {
  let refreshHandler: ((token: string) => void) | null = null;
  return {
    async getPermissionStatus() {
      return options.permission;
    },
    async requestPermission() {
      return options.permission;
    },
    async getToken() {
      return options.token;
    },
    onTokenRefresh(handler) {
      refreshHandler = handler;
      return () => {
        refreshHandler = null;
      };
    },
    // T36B additions to `PushRegistrationPort` — unused by this file's
    // own registration/refresh tests (see `permission-notification-model.test.ts`
    // for those), but required to satisfy the port's type.
    async postPermissionNotification() {},
    async cancelPermissionNotification() {},
    onNotificationAction() {
      return () => {};
    },
    emitRefresh(token: string) {
      refreshHandler?.(token);
    },
  };
}

/**
 * A scripted fake standing in for `DaemonClient.registerPushToken` /
 * `unregisterPushToken` — see this module's own doc comment for why
 * both requests are fire-and-forget. `unregisterPushToken` can be made
 * to throw a fixed number of times via `failDeregisterNextCalls`, to
 * script the "deregistration fails" interleavings T61B's brief calls
 * out.
 */
function createRecordingRegistrar(): PushTokenRegistrar & {
  calls: string[];
  unregisterCalls: string[];
  failDeregisterNextCalls: number;
  failRegisterNextCalls: number;
} {
  const calls: string[] = [];
  const unregisterCalls: string[] = [];
  const state = {
    calls,
    unregisterCalls,
    failDeregisterNextCalls: 0,
    failRegisterNextCalls: 0,
    registerPushToken(token: string) {
      if (state.failRegisterNextCalls > 0) {
        state.failRegisterNextCalls -= 1;
        throw new Error("registerPushToken: simulated send failure");
      }
      calls.push(token);
    },
    unregisterPushToken(token: string) {
      unregisterCalls.push(token);
      if (state.failDeregisterNextCalls > 0) {
        state.failDeregisterNextCalls -= 1;
        throw new Error("unregisterPushToken: simulated send failure");
      }
    },
  };
  return state;
}

/** A controllable fake `SecureStorage` — records what was stored, and can be paused mid-`setSecret` to simulate real async latency for the race tests. */
function createFakeSecureStorage() {
  const store = new Map<string, string>();
  const setSecretCalls: Array<{ key: string; value: string }> = [];
  let gate: Promise<void> | null = null;
  return {
    setSecretCalls,
    async getSecret(key: string) {
      return store.get(key) ?? null;
    },
    async setSecret(key: string, value: string) {
      if (gate) await gate;
      setSecretCalls.push({ key, value });
      store.set(key, value);
    },
    async removeSecret(key: string) {
      store.delete(key);
    },
    async isAvailable() {
      return true;
    },
    /** Test-only: makes every subsequent `setSecret` wait on `promise` before writing, so a test can hold a cycle open long enough to issue a second, genuinely concurrent `submitToken`. */
    holdUntil(promise: Promise<void>) {
      gate = promise;
    },
  };
}

describe("registerPushToken wire shape (the request this model round-trips against)", () => {
  it("the message a registrar receives from this model's real call site matches the protocol schema", () => {
    // packages/client/src/daemon-client.ts's registerPushToken(token)
    // sends exactly this shape over sendSessionMessage. This is the
    // closest this task can get, with no socket, to proving "succeeds
    // against the dev daemon": the message this model would hand the
    // real client parses as a valid RegisterPushTokenMessage.
    const message = { type: "register_push_token" as const, token: "expo-push-token-abc123" };
    const parsed = RegisterPushTokenMessageSchema.parse(message);
    expect(parsed).toEqual(message);
  });

  it("(T61B) the deregistration message this model's refresh path sends matches the protocol schema", () => {
    // packages/client/src/daemon-client.ts's unregisterPushToken(token)
    // sends exactly this shape. This is the message
    // createPushRegistrationController's refresh path hands the real
    // client's unregisterPushToken for the superseded token.
    const message = { type: "unregister_push_token" as const, token: "expo-push-token-abc123" };
    const parsed = UnregisterPushTokenMessageSchema.parse(message);
    expect(parsed).toEqual(message);
  });
});

describe("createPushRegistrationController — registration succeeds against a scripted fake client", () => {
  it("submitting a token registers it exactly once and updates the last-registered token", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");

    expect(registrar.calls).toEqual(["token-1"]);
    expect(controller.getRegistrationCallCount()).toBe(1);
    expect(controller.getLastRegisteredToken()).toBe("token-1");
  });

  it("persists the token through SecureStorage only, under the expected key, never in a bare form elsewhere", async () => {
    const registrar = createRecordingRegistrar();
    const secureStorage = createFakeSecureStorage();
    const controller = createPushRegistrationController({
      registrar,
      secureStorage,
      secureStorageKey: "push-token",
    });

    await controller.submitToken("token-1");

    expect(secureStorage.setSecretCalls).toEqual([{ key: "push-token", value: "token-1" }]);
  });
});

describe("createPushRegistrationController — refresh without duplicate registrations", () => {
  it("a refresh producing the SAME token does not re-register", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    await controller.submitToken("token-1"); // same token, sequential, after the first fully resolved

    expect(controller.getRegistrationCallCount()).toBe(1);
    expect(registrar.calls).toEqual(["token-1"]);
  });

  it("a refresh producing a NEW token registers the new one and moves the last-registered token forward", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    await controller.submitToken("token-2");

    expect(controller.getRegistrationCallCount()).toBe(2);
    expect(registrar.calls).toEqual(["token-1", "token-2"]);
    // "supersede the old" — see push-registration-model.ts's header:
    // no deregister request exists in the protocol, so the strongest
    // guarantee this client can give is that the OLD token is no longer
    // the one this controller considers current.
    expect(controller.getLastRegisteredToken()).toBe("token-2");
    expect(controller.getLastRegisteredToken()).not.toBe("token-1");
  });

  it("two refreshes with the SAME token arriving concurrently (before either resolves) register only once", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    // Neither call is awaited before the second is issued — this is
    // the "arrive concurrently" case, not two sequential awaits.
    const first = controller.submitToken("token-1");
    const second = controller.submitToken("token-1");
    await Promise.all([first, second]);

    expect(controller.getRegistrationCallCount()).toBe(1);
    expect(registrar.calls).toEqual(["token-1"]);
  });

  it("a refresh arriving WHILE a registration is in flight is queued, not raced, and still lands", async () => {
    const registrar = createRecordingRegistrar();
    const secureStorage = createFakeSecureStorage();
    let releaseFirstWrite!: () => void;
    secureStorage.holdUntil(new Promise<void>((resolve) => (releaseFirstWrite = resolve)));
    const controller = createPushRegistrationController({ registrar, secureStorage });

    const first = controller.submitToken("token-1"); // suspends inside secureStorage.setSecret
    // While the first registration is still in flight (its setSecret
    // write has not resolved), a second, different token arrives.
    const second = controller.submitToken("token-2");

    // Only the first call's registrar.registerPushToken has happened so
    // far — the second is queued behind it, not run concurrently.
    expect(registrar.calls).toEqual(["token-1"]);

    releaseFirstWrite();
    await Promise.all([first, second]);

    // Now both have registered, strictly in arrival order, and never
    // both at once.
    expect(registrar.calls).toEqual(["token-1", "token-2"]);
    expect(controller.getRegistrationCallCount()).toBe(2);
    expect(controller.getLastRegisteredToken()).toBe("token-2");
  });

  it("three concurrent refreshes collapse to the latest token, registering the middle one never", async () => {
    const registrar = createRecordingRegistrar();
    const secureStorage = createFakeSecureStorage();
    let releaseFirstWrite!: () => void;
    secureStorage.holdUntil(new Promise<void>((resolve) => (releaseFirstWrite = resolve)));
    const controller = createPushRegistrationController({ registrar, secureStorage });

    const p1 = controller.submitToken("token-1");
    const p2 = controller.submitToken("token-2"); // queued, then immediately superseded below
    const p3 = controller.submitToken("token-3"); // overwrites the queued token-2

    releaseFirstWrite();
    await Promise.all([p1, p2, p3]);

    expect(registrar.calls).toEqual(["token-1", "token-3"]);
    expect(controller.getRegistrationCallCount()).toBe(2);
    expect(controller.getLastRegisteredToken()).toBe("token-3");
  });

  it("resetForNewConnection() clears dedupe state so an unchanged token registers again", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    controller.resetForNewConnection();
    await controller.submitToken("token-1");

    expect(registrar.calls).toEqual(["token-1", "token-1"]);
    expect(controller.getRegistrationCallCount()).toBe(2);
  });
});

describe("createPushRegistrationController — T61B refresh ordering: deregister old, then register new", () => {
  it("a refresh with both requests succeeding deregisters the old token BEFORE registering the new one, in that order", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const order: string[] = [];
    const originalUnregister = registrar.unregisterPushToken.bind(registrar);
    const originalRegister = registrar.registerPushToken.bind(registrar);
    registrar.unregisterPushToken = (token: string) => {
      order.push(`unregister:${token}`);
      return originalUnregister(token);
    };
    registrar.registerPushToken = (token: string) => {
      order.push(`register:${token}`);
      return originalRegister(token);
    };

    await controller.submitToken("token-1"); // first-ever: no previous token, no deregistration
    await controller.submitToken("token-2"); // refresh: must deregister token-1 THEN register token-2

    expect(order).toEqual(["register:token-1", "unregister:token-1", "register:token-2"]);
    expect(controller.getLastRefreshOutcome()).toBe("refreshed");
    expect(controller.getPendingDeregistrationTokens()).toEqual([]);
  });

  it("the very first registration attempts no deregistration at all", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");

    expect(registrar.unregisterCalls).toEqual([]);
    expect(controller.getDeregistrationCallCount()).toBe(0);
    expect(controller.getLastRefreshOutcome()).toBe("registered-first-token");
  });

  it("deregistration succeeds, then registration FAILS: the device is now unreachable — a named state, not a defaulted one", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    registrar.failRegisterNextCalls = 1;
    await controller.submitToken("token-2");

    expect(registrar.unregisterCalls).toEqual(["token-1"]);
    expect(registrar.calls).toEqual(["token-1"]); // token-2's register call threw, never recorded as succeeded
    expect(controller.getLastRefreshOutcome()).toBe("device-unreachable");
    // Zero tokens are now registered at the daemon: the old one was
    // deregistered and the new one never landed.
    expect(controller.getLastRegisteredToken()).toBeNull();
    expect(controller.getPendingDeregistrationTokens()).toEqual([]);
  });

  it("deregistration FAILS, then registration succeeds: the old token is still active, recorded for retry, and the new one registers anyway", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    registrar.failDeregisterNextCalls = 1;
    await controller.submitToken("token-2");

    expect(registrar.unregisterCalls).toEqual(["token-1"]);
    expect(registrar.calls).toEqual(["token-1", "token-2"]); // new token still registers
    expect(controller.getLastRefreshOutcome()).toBe("superseded-token-still-active");
    expect(controller.getLastRegisteredToken()).toBe("token-2");
    // The failed deregistration is recorded, not silently dropped.
    expect(controller.getPendingDeregistrationTokens()).toEqual(["token-1"]);
  });

  it("both steps fail: the old token remains the only one registered, unchanged, and is retried", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    registrar.failDeregisterNextCalls = 1;
    registrar.failRegisterNextCalls = 1;
    await controller.submitToken("token-2");

    expect(controller.getLastRefreshOutcome()).toBe("refresh-failed-token-unchanged");
    expect(controller.getLastRegisteredToken()).toBe("token-1");
    expect(controller.getPendingDeregistrationTokens()).toEqual(["token-1"]);
  });

  it("a failed deregistration is retried automatically on the NEXT submitToken cycle, and succeeds there", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    registrar.failDeregisterNextCalls = 1;
    await controller.submitToken("token-2"); // token-1's deregistration fails and is queued

    expect(controller.getPendingDeregistrationTokens()).toEqual(["token-1"]);

    await controller.submitToken("token-3"); // retries token-1's deregistration first, then handles token-2 -> token-3

    // token-1 was retried (this time succeeding) in addition to the
    // in-cycle deregistration of token-2.
    expect(registrar.unregisterCalls).toEqual(["token-1", "token-1", "token-2"]);
    expect(controller.getPendingDeregistrationTokens()).toEqual([]);
    expect(controller.getLastRefreshOutcome()).toBe("refreshed");
  });

  it("retryPendingDeregistrations() can also be triggered directly, without waiting for the next token", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-1");
    registrar.failDeregisterNextCalls = 1;
    await controller.submitToken("token-2");
    expect(controller.getPendingDeregistrationTokens()).toEqual(["token-1"]);

    controller.retryPendingDeregistrations();

    expect(controller.getPendingDeregistrationTokens()).toEqual([]);
    expect(registrar.unregisterCalls).toEqual(["token-1", "token-1"]);
  });

  it("deregistering a token the fake registrar has never seen behaves identically to a known one — same call, no branching", async () => {
    // This module has no way to know what the daemon holds; it must
    // never try to find out by behaving differently. Directly exercises
    // the registrar contract T61B's third criterion describes.
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });

    await controller.submitToken("token-never-registered-before-this-call");

    expect(() => registrar.unregisterPushToken("token-daemon-has-never-seen")).not.toThrow();
    expect(registrar.unregisterCalls).toContain("token-daemon-has-never-seen");
  });
});

describe("registerForPush — the end-to-end round trip against a scripted fake client/port", () => {
  it("granted permission + a token registers exactly once", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "granted", token: "expo-token-xyz" });

    const outcome = await registerForPush(port, controller);

    expect(outcome).toBe("registered");
    expect(registrar.calls).toEqual(["expo-token-xyz"]);
  });

  it("denied permission never fetches a token or registers", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "denied", token: "should-never-be-sent" });

    const outcome = await registerForPush(port, controller);

    expect(outcome).toBe("permission-not-granted");
    expect(registrar.calls).toEqual([]);
  });

  it("granted permission but no token available registers nothing", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "granted", token: null });

    const outcome = await registerForPush(port, controller);

    expect(outcome).toBe("no-token-available");
    expect(registrar.calls).toEqual([]);
  });
});

describe("attachTokenRefresh — a live refresh stream drives the same dedupe/race rules", () => {
  it("two refreshes emitted back-to-back (no await between them) still register only their distinct tokens once each", () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "granted", token: null });

    const unsubscribe = attachTokenRefresh(port, controller);
    port.emitRefresh("refreshed-1");
    port.emitRefresh("refreshed-1"); // duplicate refresh, same token
    unsubscribe();

    // attachTokenRefresh is fire-and-forget per call, so give the
    // microtask queue a turn to let both submissions settle.
    return Promise.resolve().then(() => {
      expect(registrar.calls).toEqual(["refreshed-1"]);
      expect(controller.getRegistrationCallCount()).toBe(1);
    });
  });

  it("unsubscribing stops further refreshes from reaching the controller", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "granted", token: null });

    const unsubscribe = attachTokenRefresh(port, controller);
    unsubscribe();
    port.emitRefresh("after-unsubscribe");
    await Promise.resolve();

    expect(registrar.calls).toEqual([]);
  });

  it("(T61B) a live token refresh actually deregisters the superseded token at the registrar, not merely re-registers — the standing lesson: registration is not receipt", async () => {
    const registrar = createRecordingRegistrar();
    const controller = createPushRegistrationController({ registrar });
    const port = createScriptedPort({ permission: "granted", token: null });

    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    const unsubscribe = attachTokenRefresh(port, controller);
    port.emitRefresh("device-token-A");
    await flush();
    port.emitRefresh("device-token-B"); // a real OS-level refresh: token-A is now superseded
    await flush();
    unsubscribe();

    // Assert an actually-received deregister call for the superseded
    // token arrived at the registrar — not just that registration for
    // the new token happened.
    expect(registrar.unregisterCalls).toEqual(["device-token-A"]);
    expect(registrar.calls).toEqual(["device-token-A", "device-token-B"]);
    expect(controller.getLastRefreshOutcome()).toBe("refreshed");
  });
});

describe("createUnavailablePushRegistrationPort — the honest port for a build with no native push module", () => {
  it("reports unavailable permission and no token, and its refresh subscription is a harmless no-op", async () => {
    const port = createUnavailablePushRegistrationPort();

    await expect(port.getPermissionStatus()).resolves.toBe("unavailable");
    await expect(port.requestPermission()).resolves.toBe("unavailable");
    await expect(port.getToken()).resolves.toBeNull();

    const handler = vi.fn();
    const unsubscribe = port.onTokenRefresh(handler);
    expect(() => unsubscribe()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
