import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createPushNotificationSender } from "./notifications.js";
import { PushService } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";

/**
 * T61 — integration proof that a superseded/deregistered push token
 * actually stops receiving, and that a push token is never written to a
 * log in the clear. See the contract doc comment on
 * `RegisterPushTokenMessageSchema` / `UnregisterPushTokenMessageSchema`
 * in packages/protocol/src/messages.ts.
 */

interface CapturedLog {
  fields: Record<string, unknown>;
  message: string;
}

function createCapturingLogger(): { logger: pino.Logger; errors: CapturedLog[] } {
  const errors: CapturedLog[] = [];
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (fields: Record<string, unknown>, message: string) => {
      errors.push({ fields, message });
    },
  };
  return { logger: logger as unknown as pino.Logger, errors };
}

function tempTokenPath(): { tokenPath: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-push-service-"));
  return {
    tokenPath: path.join(home, "push-tokens.json"),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

describe("push token lifecycle end-to-end (T61)", () => {
  let cleanup: () => void;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cleanup = () => {};
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  test("a deregistered token is never included in the next push fan-out", async () => {
    const { tokenPath, cleanup: rm } = tempTokenPath();
    cleanup = rm;
    const { logger } = createCapturingLogger();
    const tokenStore = new PushTokenStore(logger, tokenPath);

    tokenStore.addToken("ExponentPushToken[device-A-old]", "device-a");
    tokenStore.addToken("ExponentPushToken[device-B]", "device-b");

    // Simulate the same effect `unregister_push_token` produces through
    // Session.handleUnregisterPushToken (see
    // session-push-token-registration.test.ts for the wire-level proof of
    // that wiring) — call the store directly here so this test is about
    // the send path, not the dispatch path.
    tokenStore.removeToken("ExponentPushToken[device-A-old]");

    const sentBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
      } as Response;
    }) as typeof fetch;

    const sender = createPushNotificationSender(logger, tokenStore);
    await sender.send({ title: "Hi", body: "there" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [message] = sentBodies[0] as Array<{ to: string }>;
    expect((sentBodies[0] as Array<{ to: string }>).map((m) => m.to)).toEqual([
      "ExponentPushToken[device-B]",
    ]);
    expect(message.to).not.toBe("ExponentPushToken[device-A-old]");
  });

  test("deregistering a token that was never registered does not disturb delivery to real tokens", async () => {
    const { tokenPath, cleanup: rm } = tempTokenPath();
    cleanup = rm;
    const { logger } = createCapturingLogger();
    const tokenStore = new PushTokenStore(logger, tokenPath);

    tokenStore.addToken("ExponentPushToken[real-device]", "device-real");
    // Named no-op: removing something never registered must not throw,
    // must not remove the real token, and must not error.
    expect(() => tokenStore.removeToken("ExponentPushToken[phantom]")).not.toThrow();

    const sentBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ data: [{ status: "ok", id: "t" }] }) } as Response;
    }) as typeof fetch;

    const sender = createPushNotificationSender(logger, tokenStore);
    await sender.send({ title: "Hi", body: "there" });

    expect((sentBodies[0] as Array<{ to: string }>).map((m) => m.to)).toEqual([
      "ExponentPushToken[real-device]",
    ]);
  });

  test("a failed-push log never contains the raw token value, only its length", async () => {
    const { logger, errors } = createCapturingLogger();
    const secretToken = "ExponentPushToken[super-secret-device-identifier]";

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              status: "error",
              message: "not registered",
              details: { error: "DeviceNotRegistered" },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const { tokenPath, cleanup: rm } = tempTokenPath();
    cleanup = rm;
    const tokenStore = new PushTokenStore(logger, tokenPath);
    tokenStore.addToken(secretToken, "device-secret");

    const pushService = new PushService(logger, tokenStore);
    await pushService.sendPush([secretToken], { title: "Hi", body: "there" });

    expect(errors.length).toBeGreaterThan(0);
    for (const entry of errors) {
      const serialized = JSON.stringify(entry.fields);
      expect(serialized).not.toContain(secretToken);
      expect(serialized).not.toContain("super-secret-device-identifier");
    }
    // The length is still logged — useful for debugging, not sensitive.
    expect(errors[0]?.fields.tokenLength).toBe(secretToken.length);

    // A DeviceNotRegistered response is also expected to self-heal the
    // store (pre-existing behavior, re-asserted here as part of the same
    // end-to-end lifecycle this task is proving).
    expect(tokenStore.getAllTokens()).toEqual([]);
  });
});
