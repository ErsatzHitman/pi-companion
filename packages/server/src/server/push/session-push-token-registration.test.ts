import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { Session, type SessionOptions } from "../session.js";
import {
  asAgentManager,
  asAgentStorage,
  asChatService,
  asCheckoutDiffManager,
  asDaemonConfigStore,
  asDownloadTokenStore,
  asGitHubService,
  asLoopService,
  asScheduleService,
  asWorkspaceGitService,
  createProviderSnapshotManagerStub,
} from "../test-utils/session-stubs.js";
import { PushTokenStore } from "./token-store.js";

/**
 * T61 — proves the wiring, not just the store in isolation: a real
 * `Session`, built the same way `websocket-server.ts` builds one, routes
 * `register_push_token` / `unregister_push_token` inbound messages
 * (through the actual `public handleMessage` entrypoint and the real
 * `dispatchMiscMessage` switch — no internals poked directly) into a
 * real `PushTokenStore`.
 */

class EmptyProjectRegistry {
  async list() {
    return [];
  }
  async get() {
    return null;
  }
  async upsert() {}
  async archive() {}
  async remove() {}
  async initialize() {}
  async existsOnDisk() {
    return false;
  }
}

class EmptyWorkspaceRegistry {
  get() {
    return null;
  }
  list() {
    return [];
  }
}

function createSessionWithRealPushTokenStore(pushTokenStore: PushTokenStore): Session {
  return new Session({
    clientId: "push-token-test-client",
    scopes: ["*"],
    onMessage: () => {},
    logger: pino({ level: "silent" }),
    downloadTokenStore: asDownloadTokenStore(),
    pushTokenStore,
    paseoHome: "/tmp/paseo-home",
    agentManager: asAgentManager({ subscribe: () => () => {} }),
    agentStorage: asAgentStorage({}),
    projectRegistry: new EmptyProjectRegistry() as unknown as SessionOptions["projectRegistry"],
    workspaceRegistry:
      new EmptyWorkspaceRegistry() as unknown as SessionOptions["workspaceRegistry"],
    chatService: asChatService(),
    scheduleService: asScheduleService(),
    loopService: asLoopService(),
    checkoutDiffManager: asCheckoutDiffManager({}),
    github: asGitHubService({}),
    workspaceGitService: asWorkspaceGitService({}),
    daemonConfigStore: asDaemonConfigStore({
      get: () => ({ mcp: { injectIntoAgents: false }, providers: {} }),
      onChange: () => () => {},
    }),
    stt: null,
    tts: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    terminalManager: null,
  });
}

describe("Session push-token wiring (T61)", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  function newStore(): PushTokenStore {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-session-push-"));
    cleanup = () => rmSync(home, { recursive: true, force: true });
    return new PushTokenStore(pino({ level: "silent" }), path.join(home, "push-tokens.json"));
  }

  test("a register_push_token message dispatched through Session.handleMessage adds the token to the real store", async () => {
    const store = newStore();
    const session = createSessionWithRealPushTokenStore(store);

    await session.handleMessage({
      type: "register_push_token",
      token: "ExponentPushToken[wired-device]",
    });

    expect(store.getAllTokens()).toEqual(["ExponentPushToken[wired-device]"]);
  });

  test("an unregister_push_token message dispatched through Session.handleMessage removes exactly that token from the real store", async () => {
    const store = newStore();
    // Both attributed to this session's own clientId (T299 scopes
    // unregister to the connection's own tokens) — see
    // "removeToken with a clientId only removes that client's own copy"
    // in token-store.test.ts for the cross-client case.
    store.addToken("ExponentPushToken[keep]", "push-token-test-client");
    store.addToken("ExponentPushToken[remove-me]", "push-token-test-client");
    const session = createSessionWithRealPushTokenStore(store);

    await session.handleMessage({
      type: "unregister_push_token",
      token: "ExponentPushToken[remove-me]",
    });

    expect(store.getAllTokens()).toEqual(["ExponentPushToken[keep]"]);
  });

  test("unregistering a token the store never held, via the real message path, is a no-op and emits no error to the client", async () => {
    const store = newStore();
    store.addToken("ExponentPushToken[keep]", "push-token-test-client-2");
    const outbound: unknown[] = [];
    const session = new Session({
      clientId: "push-token-test-client-2",
      scopes: ["*"],
      onMessage: (msg) => outbound.push(msg),
      logger: pino({ level: "silent" }),
      downloadTokenStore: asDownloadTokenStore(),
      pushTokenStore: store,
      paseoHome: "/tmp/paseo-home",
      agentManager: asAgentManager({ subscribe: () => () => {} }),
      agentStorage: asAgentStorage({}),
      projectRegistry: new EmptyProjectRegistry() as unknown as SessionOptions["projectRegistry"],
      workspaceRegistry:
        new EmptyWorkspaceRegistry() as unknown as SessionOptions["workspaceRegistry"],
      chatService: asChatService(),
      scheduleService: asScheduleService(),
      loopService: asLoopService(),
      checkoutDiffManager: asCheckoutDiffManager({}),
      github: asGitHubService({}),
      workspaceGitService: asWorkspaceGitService({}),
      daemonConfigStore: asDaemonConfigStore({
        get: () => ({ mcp: { injectIntoAgents: false }, providers: {} }),
        onChange: () => () => {},
      }),
      stt: null,
      tts: null,
      providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      terminalManager: null,
    });

    await session.handleMessage({
      type: "unregister_push_token",
      token: "ExponentPushToken[never-registered]",
    });

    // No error message went back to the client — a wire-visible error
    // reply here would be exactly the side channel that could leak
    // "that token existed / didn't" to whoever sent it.
    expect(outbound).toEqual([]);
    expect(store.getAllTokens()).toEqual(["ExponentPushToken[keep]"]);
  });
});
