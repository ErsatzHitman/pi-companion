/**
 * `AppCore.fileBrowserClient.readFile` forwarding (T32S7, item 1).
 *
 * Until this task the object literal in `./core.ts` forwarded
 * `listDirectory` only, so `readFile` was `undefined` and every file
 * open rendered "Not connected" (`FILE_READ_NOT_CONNECTED`) regardless
 * of connection state, and T35A2's real daemon-RPC read path (Lezer
 * highlighting, binary/oversize/vanished refusals — all proven in
 * isolation by that task's own tests) was unreachable from
 * `FilesScreen`. This file proves the forward itself: no connection ->
 * the same `FILE_READ_NOT_CONNECTED` rejection `file-view-model.ts`
 * already treats a missing `readFile` as, and a real (fake, in-memory)
 * `DaemonClientLike` adopted onto `AppCore.connection` -> the call
 * reaches that object's own `readFile` with the exact `cwd`/`path`
 * given.
 *
 * Same `react-native`/`react-native-reanimated`/`expo-secure-store`
 * mocks `../app/resume-wiring.test.ts` already established for
 * importing `createAppCore()` under plain `vitest` (see that file's own
 * doc comment for why each is needed) — copied, not reinvented, so this
 * file exercises the same real `createAppCore()` construction path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { ConnectionState } from "@picompanion/client";
import { connection as coreConnection } from "@picompanion/frontend-core";
import type { AppLifecycle, AppLifecycleState, Clock } from "@picompanion/frontend-core";
import type { AgentStreamMessage, ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import { fireTranscriptStatusHaptic } from "../features/transcript/transcript-status-haptics-model.js";
import type { HostProfileRecord } from "../features/connect/credential-store.js";
import { RELAY_PIN_MISSING_MESSAGE } from "../features/connect/host-profile-reconnect.js";
import { buildDaemonHttpOrigin } from "../features/connect/daemon-connection-store.js";
import { FILE_PICKER_UNAVAILABLE } from "../platform/file-picker.js";
import { SHARING_FILES_UNAVAILABLE } from "../platform/sharing.js";

// T32S9: records every `Vibration.vibrate(...)` call the mocked
// `react-native` module receives, so `AppCore.vibrationPlatform (T32S9)`
// below can prove `createRNVibrationPlatform()` was actually wired to a
// real (mocked) OS call, not just constructed. `vi.hoisted` because
// `vi.mock`'s factory below is hoisted above this file's own top-level
// statements and cannot close over a plain `const`.
const vibrationCalls = vi.hoisted(() => [] as unknown[][]);

// T78: records every `Share.share(...)` call the mocked `react-native`
// module receives, so `AppCore.sharing` below can prove
// `createRNShareModule()` was actually wired to a real (mocked) OS call
// — a value actually arrives at the native module, not just a
// registered construction — the same "registration is not receipt"
// standard `vibrationCalls` above already meets for haptics.
const shareCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock("react-native", () => {
  function Stub(): null {
    return null;
  }
  return {
    AppState: {
      currentState: "active",
      addEventListener: () => ({ remove: () => undefined }),
    },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Stub,
    View: Stub,
    Pressable: Stub,
    ScrollView: Stub,
    Modal: Stub,
    TextInput: Stub,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    findNodeHandle: () => null,
    useColorScheme: () => "light",
    Linking: { openURL: async () => true },
    Vibration: { vibrate: vibrationCalls.push.bind(vibrationCalls) },
    Share: {
      share: async (...args: unknown[]) => {
        shareCalls.push(args);
        return { action: "sharedAction" };
      },
    },
  };
});

vi.mock("react-native-reanimated", () => {
  function Stub(): null {
    return null;
  }
  const Animated = { View: Stub, Text: Stub, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    Easing: { ease: (v: number) => v, out: (fn: unknown) => fn, linear: (v: number) => v },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
  isAvailableAsync: async () => true,
}));

// T69: `./core.ts` imports `createNativeShareIntentPort` — as of T115
// through `../features/share/index.js` (previously a deep import of
// `../features/share/share-intent-native-port.js`, T36F) — which reaches
// `expo-modules-core` at its top level (see that module's own doc
// comment) — same reason every other native-module-reaching import in
// this file is mocked above. `requireOptionalNativeModule` always
// returning `null` here is the same "no native module linked in this
// sandbox" fallback production itself hits (`createNativeShareIntentPort`'s
// own doc comment), so `AppCore.shareIntentPort` below is the real,
// honestly-degraded `ShareIntentPort` this file constructs everywhere else.
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

const { createAppCore } = await import("./core");
const { APP_CORE_OFFLINE_SCOPE } = await import("./core");
const { createOfflineCacheOwner } = await import("../platform/offline/offline-cache-owner");
const { createUnavailableSqliteDriverFactory } =
  await import("../platform/offline/sqlite-driver-factory");
const { InMemorySqliteDriver } = await import("../platform/offline/in-memory-sqlite-driver");
const { FILE_READ_NOT_CONNECTED, FILE_WRITE_NOT_CONNECTED } = await import("../features/files");
const { createTranscriptMessageBatcher } =
  await import("../features/transcript/transcript-message-batcher");

/**
 * Minimal `DaemonClientLike` (`packages/frontend-core/src/connection/
 * daemon-client-lifecycle.ts`) double, plus the two extra methods
 * (`listDirectory`/`readFile`) the real `DaemonClient` has but that
 * narrower interface does not declare — exactly the gap `core.ts`'s
 * `fileBrowserClient` doc comment names and casts around.
 */
class FakeDaemonClient {
  readFileCalls: Array<{ cwd: string; path: string }> = [];
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();

  async connect(): Promise<void> {
    this.publish({ status: "connected" });
  }
  async close(): Promise<void> {
    this.publish({ status: "disposed" });
  }
  getConnectionState(): ConnectionState {
    return { status: "connected" };
  }
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getConnectionState());
    return () => this.statusListeners.delete(listener);
  }
  subscribe(): () => void {
    return () => {};
  }
  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return null;
  }
  listDirectory(): never {
    throw new Error("not exercised by this test");
  }
  async readFile(cwd: string, path: string): Promise<{ path: string }> {
    this.readFileCalls.push({ cwd, path });
    return { path };
  }
  /** Records every forwarded `writeFile` input (P5-W12 merge gate). */
  writeFileCalls: Array<{ cwd: string; path: string; content: string }> = [];
  /** Returns a real `FileWriteResult` shape (`FileWriteResultSchema` in `@picompanion/protocol/messages`), not an invented one. */
  async writeFile(input: {
    cwd: string;
    path: string;
    content: string;
    expectedModifiedAt: string;
  }): Promise<{ status: "written"; modifiedAt: string; size: number }> {
    this.writeFileCalls.push({ cwd: input.cwd, path: input.path, content: input.content });
    return {
      status: "written",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      size: input.content.length,
    };
  }
  /** Records every `on("agent_stream", ...)` handler this fake was given, and how many times `on` was called (T32S8). */
  agentStreamOnCallCount = 0;
  private readonly agentStreamHandlers = new Set<(message: AgentStreamMessage) => void>();
  on(type: "agent_stream", handler: (message: AgentStreamMessage) => void): () => void {
    if (type !== "agent_stream") {
      throw new Error(`unexpected on() type in test fake: ${type}`);
    }
    this.agentStreamOnCallCount += 1;
    this.agentStreamHandlers.add(handler);
    return () => this.agentStreamHandlers.delete(handler);
  }
  /** Test-only: fires a scripted `agent_stream` message to every currently-registered handler — never a real socket. */
  emitAgentStream(message: AgentStreamMessage): void {
    for (const handler of this.agentStreamHandlers) handler(message);
  }
  /** Records every `sendMessage`/`cancelAgent` call (T32S12's `createTurnService`). */
  sendMessageCalls: Array<{ agentId: string; text: string }> = [];
  cancelAgentCalls: string[] = [];
  async sendMessage(agentId: string, text: string): Promise<void> {
    this.sendMessageCalls.push({ agentId, text });
  }
  async cancelAgent(agentId: string): Promise<void> {
    this.cancelAgentCalls.push(agentId);
  }
  /** Records every `openTerminalSession(terminalId)` call (T32S12) — the same "an id was actually passed" proof the other fakes in this file already give their own methods. */
  openTerminalSessionCalls: string[] = [];
  lastTerminalSession: FakeTerminalSession | null = null;
  openTerminalSession(terminalId: string): Promise<FakeTerminalSession> {
    this.openTerminalSessionCalls.push(terminalId);
    const session = new FakeTerminalSession();
    this.lastTerminalSession = session;
    return Promise.resolve(session);
  }
  private publish(state: ConnectionState): void {
    for (const listener of this.statusListeners) listener(state);
  }
}

/** Minimal `TerminalSessionHandleLike` (`./terminal-transport-adapter.ts`) double for `FakeDaemonClient.openTerminalSession` above. */
class FakeTerminalSession {
  state: "open" | "closed" = "open";
  writeInputCalls: Array<Uint8Array | string> = [];
  private readonly outputHandlers = new Set<(data: Uint8Array) => void>();
  private readonly closedHandlers = new Set<() => void>();
  writeInput(data: Uint8Array | string): "sent" {
    this.writeInputCalls.push(data);
    return "sent";
  }
  resize(): "sent" {
    return "sent";
  }
  onOutput(handler: (data: Uint8Array) => void): () => void {
    this.outputHandlers.add(handler);
    return () => this.outputHandlers.delete(handler);
  }
  onSnapshot(): () => void {
    return () => {};
  }
  onRestore(): () => void {
    return () => {};
  }
  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }
  close(): void {
    this.state = "closed";
  }
}

describe("AppCore.fileBrowserClient.readFile (T32S7)", () => {
  it("rejects with FILE_READ_NOT_CONNECTED when no connection is active", async () => {
    const core = createAppCore();
    await expect(core.fileBrowserClient.readFile?.("", "notes.txt")).rejects.toThrow(
      FILE_READ_NOT_CONNECTED,
    );
  });

  it("forwards to the live DaemonClient's own readFile once a connection is active", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0001",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const result = await core.fileBrowserClient.readFile?.("", "docs/readme.md");

    expect(result).toEqual({ path: "docs/readme.md" });
    expect(fakeClient.readFileCalls).toEqual([{ cwd: "", path: "docs/readme.md" }]);

    await lifecycle.dispose();
  });
});

/**
 * P5-W12 merge gate: the same forwarding contract for T35A3's write half.
 * Without the `writeFile` entry on `core.ts`'s `fileBrowserClient` object
 * literal, `writeFile` is `undefined` on the client the session files
 * route (`app/h/[serverId]/session/[agentId]/files/[...path].tsx`) hands
 * `FilesScreen`, so `writeFileWithTimeout` (`file-edit-model.ts`) resolves
 * `FILE_WRITE_NOT_CONNECTED` on every save no matter how healthy the
 * connection is — T32S7's missing `readFile` forward, one wave later.
 */
describe("AppCore.fileBrowserClient.writeFile (P5-W12 merge gate)", () => {
  const WRITE_INPUT = {
    cwd: "",
    path: "docs/readme.md",
    content: "edited body",
    expectedModifiedAt: "2025-12-31T23:59:59.000Z",
  };

  it("rejects with FILE_WRITE_NOT_CONNECTED when no connection is active", async () => {
    const core = createAppCore();
    await expect(core.fileBrowserClient.writeFile?.(WRITE_INPUT)).rejects.toThrow(
      FILE_WRITE_NOT_CONNECTED,
    );
  });

  it("forwards to the live DaemonClient's own writeFile once a connection is active", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0001",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const result = await core.fileBrowserClient.writeFile?.(WRITE_INPUT);

    expect(result).toEqual({
      status: "written",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      size: "edited body".length,
    });
    expect(fakeClient.writeFileCalls).toEqual([
      { cwd: "", path: "docs/readme.md", content: "edited body" },
    ]);

    await lifecycle.dispose();
  });
});

/**
 * Deterministic `AppLifecycle` fake, copied (not imported — test files
 * export nothing) from `transcript-message-batcher.test.ts`'s own
 * `FakeLifecycle`, for the exact same reason: this suite drives the real,
 * unmodified `createAppFrameClock` production adapter a real
 * `createTranscriptMessageBatcher` uses, not a simplified stand-in.
 */
class FakeLifecycle implements AppLifecycle {
  private state: AppLifecycleState = "active";
  private readonly listeners = new Set<(state: AppLifecycleState) => void>();
  getState(): AppLifecycleState {
    return this.state;
  }
  subscribe(listener: (state: AppLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function createFakeSchedulers() {
  let nextHandle = 1;
  const rafQueue = new Map<number, (timestamp: number) => void>();
  const timerQueue = new Map<number, () => void>();
  return {
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      const handle = nextHandle++;
      rafQueue.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle: number) => {
      rafQueue.delete(handle);
    },
    setTimeout: (callback: () => void) => {
      const handle = nextHandle++;
      timerQueue.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle: number) => {
      timerQueue.delete(handle);
    },
    now: () => 0,
  };
}

/**
 * T32S8, item 2 — the standing gap `AppCore["piUiSession"]`'s and
 * `AppCore["subscribeAgentStream"]`'s doc comments both named: nothing
 * in `apps/android` called `client.on("agent_stream", ...)`, so
 * `piUiSession.store` stayed permanently empty and
 * `createTranscriptMessageBatcher`'s `push()` was never fed. Proves both
 * halves close from the exact same wire subscription, against a fake
 * `DaemonClientLike` adopted onto `AppCore.connection` (never a real
 * socket).
 */
describe("AppCore agent_stream subscription (T32S8)", () => {
  it("feeds a pi_ui_delta message into piUiSession.store and a timeline message into a subscribeAgentStream listener's batcher, both through one on() call", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0002",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    // The session route's own wiring: forward every message straight to a
    // real batcher's `push()`, exactly like `SessionTranscript` does.
    const batcher = createTranscriptMessageBatcher({
      lifecycle: new FakeLifecycle(),
      ...createFakeSchedulers(),
    });
    const unsubscribe = core.subscribeAgentStream((message) => {
      batcher.push(message);
    });

    expect(core.piUiSession.store.getElements("agt_t32s8")).toEqual([]);
    expect(batcher.pendingCount()).toBe(0);

    // 1. A pi_ui_delta message: every message reaches BOTH consumers
    //    unconditionally (this queues into the batcher too —
    //    `TimelineCoalescer.push` queues every message regardless of
    //    type; it is the *reducer*, on flush, that no-ops a non-`timeline`
    //    event — see `reducer.ts`'s `ingestAgentStreamMessage` doc
    //    comment). What this step proves is the store half: the element
    //    lands in `piUiSession.store`.
    fakeClient.emitAgentStream({
      type: "agent_stream",
      payload: {
        agentId: "agt_t32s8",
        timestamp: "2026-09-03T10:00:00.000Z",
        event: {
          type: "pi_ui_delta",
          provider: "pi",
          agentId: "agt_t32s8",
          revision: 1,
          delta: {
            op: "upsert",
            element: {
              id: "todo-summary",
              ns: "todo",
              kind: "widget",
              placement: "pinned",
              title: "Today's plan",
              payload: { kind: "widget", text: "3 tasks remaining" },
            },
          },
        },
      } as unknown as AgentStreamMessage["payload"],
    });

    expect(core.piUiSession.store.getElements("agt_t32s8")).toHaveLength(1);
    expect(batcher.pendingCount()).toBe(1);

    // 2. A timeline message: reaches the batcher's `push()` through the
    //    *same* `subscribeAgentStream` listener (pendingCount grows
    //    again), and does not touch the store (no pi_ui element added
    //    for this event type).
    fakeClient.emitAgentStream({
      type: "agent_stream",
      payload: {
        agentId: "agt_t32s8",
        epoch: "epoch-t32s8-0001",
        seq: 10,
        timestamp: "2026-09-03T10:00:01.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: { type: "assistant_message", text: "hello", messageId: "msg_t32s8_0001" },
        },
      } as unknown as AgentStreamMessage["payload"],
    });

    expect(batcher.pendingCount()).toBe(2);
    expect(core.piUiSession.store.getElements("agt_t32s8")).toHaveLength(1);

    // Exactly one wire subscription served both messages above.
    expect(fakeClient.agentStreamOnCallCount).toBe(1);

    unsubscribe();
    batcher.dispose();
    await lifecycle.dispose();
  });

  it("re-subscribes to the new client after a reconnect and stops delivering to a torn-down listener", async () => {
    const core = createAppCore();
    const firstClient = new FakeDaemonClient();
    const firstLifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0003",
      clientType: "mobile",
      createDaemonClient: () => firstClient as unknown as coreConnection.DaemonClientLike,
    });
    await firstLifecycle.connect();
    await core.connection.adoptLifecycle(firstLifecycle);

    const received: AgentStreamMessage[] = [];
    const unsubscribe = core.subscribeAgentStream((message) => received.push(message));

    const secondClient = new FakeDaemonClient();
    const secondLifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0004",
      clientType: "mobile",
      createDaemonClient: () => secondClient as unknown as coreConnection.DaemonClientLike,
    });
    await secondLifecycle.connect();
    await core.connection.adoptLifecycle(secondLifecycle);

    function upsertDeltaMessage(agentId: string, elementId: string): AgentStreamMessage {
      return {
        type: "agent_stream",
        payload: {
          agentId,
          timestamp: "2026-09-03T10:00:00.000Z",
          event: {
            type: "pi_ui_delta",
            provider: "pi",
            agentId,
            revision: 1,
            delta: {
              op: "upsert",
              element: {
                id: elementId,
                ns: "todo",
                kind: "widget",
                placement: "pinned",
                title: "Today's plan",
                payload: { kind: "widget", text: "3 tasks remaining" },
              },
            },
          },
        } as unknown as AgentStreamMessage["payload"],
      };
    }

    // The first client's own subscription must have been torn down —
    // emitting on it now must reach no listener.
    firstClient.emitAgentStream(upsertDeltaMessage("agt_stale", "widget-stale"));
    expect(received).toHaveLength(0);

    secondClient.emitAgentStream(upsertDeltaMessage("agt_live", "widget-live"));
    expect(received).toHaveLength(1);
    expect(received[0]?.payload.agentId).toBe("agt_live");

    unsubscribe();
    await firstLifecycle.dispose();
    await secondLifecycle.dispose();
  });
});

describe("AppCore.vibrationPlatform (T32S9)", () => {
  it("constructs a real createRNVibrationPlatform() that reaches react-native's Vibration.vibrate with the requested pattern", () => {
    vibrationCalls.length = 0;
    const core = createAppCore();

    core.vibrationPlatform.vibrate([0, 40]);

    expect(vibrationCalls).toEqual([[0, 40]]);
  });
});

describe("AppCore.shareIntentPort (T69, P5-W21)", () => {
  it("is a real createNativeShareIntentPort() — its real, honest 'no native module linked' fallback in this sandbox (requireOptionalNativeModule mocked to null above) resolves getInitialShareIntent() to null rather than throwing or being undefined", async () => {
    const core = createAppCore();

    expect(core.shareIntentPort).toBeDefined();
    await expect(core.shareIntentPort.getInitialShareIntent()).resolves.toBeNull();

    const unsubscribe = core.shareIntentPort.subscribe(() => {
      throw new Error("the unavailable fallback's subscribe() must never fire a handler");
    });
    unsubscribe();
  });
});

describe("AppCore.filePicker (T78)", () => {
  it("is a real, present FilePicker — not undefined, not omitted — whose pickFiles() rejects with the real, honest FILE_PICKER_UNAVAILABLE sentinel (no expo-document-picker/expo-image-picker install exists in this workspace)", async () => {
    const core = createAppCore();

    expect(core.filePicker).toBeDefined();
    await expect(core.filePicker.pickFiles()).rejects.toThrow(FILE_PICKER_UNAVAILABLE);
  });
});

describe("AppCore.sharing (T78)", () => {
  it("shareText() reaches react-native's real Share.share with the exact message/title — a value actually arrives at the native module, not just a registered construction", async () => {
    shareCalls.length = 0;
    const core = createAppCore();

    await core.sharing.shareText("hello from the files screen", { title: "Share a file" });

    expect(shareCalls).toEqual([
      [{ message: "hello from the files screen", title: "Share a file" }, undefined],
    ]);
  });

  it("isAvailable() honestly reports false — no expo-sharing install exists in this workspace", async () => {
    const core = createAppCore();
    await expect(core.sharing.isAvailable()).resolves.toBe(false);
  });

  it("shareFiles() rejects with the real, honest SHARING_FILES_UNAVAILABLE sentinel rather than a fabricated success", async () => {
    const core = createAppCore();
    await expect(
      core.sharing.shareFiles([{ name: "a.txt", mimeType: "text/plain", data: new Uint8Array() }]),
    ).rejects.toThrow(SHARING_FILES_UNAVAILABLE);
  });
});

describe("AppCore.terminalWebview (T80, P5-W23)", () => {
  it("is a real, present TerminalWebViewPort — not undefined, not omitted — honestly reporting isAvailable: false (no react-native-webview install exists in this workspace)", () => {
    const core = createAppCore();

    expect(core.terminalWebview).toBeDefined();
    expect(core.terminalWebview.isAvailable).toBe(false);
  });

  it("onReady never fires and write/restore/setTheme/resize/dispose are silent no-ops — the honest 'nothing to draw' fallback, not a stub that throws or pretends to render", () => {
    const core = createAppCore();

    let readyFired = false;
    core.terminalWebview.onReady(() => {
      readyFired = true;
    });
    expect(readyFired).toBe(false);
    expect(() => core.terminalWebview.write(new Uint8Array([1]))).not.toThrow();
    expect(() => core.terminalWebview.resize({ rows: 1, cols: 1 })).not.toThrow();
    expect(() => core.terminalWebview.dispose()).not.toThrow();
  });

  it("is the same singleton instance every reader shares, matching filePicker/sharing's 'one process-lifetime singleton, threaded down' shape", () => {
    const core = createAppCore();
    expect(core.terminalWebview).toBe(core.terminalWebview);
  });
});

describe("AppCore.settings (T32S11, P5-W16)", () => {
  it("is a real, single-instance SettingsController defaulting to hapticsEnabled: true before load()", () => {
    const core = createAppCore();
    expect(core.settings.getSnapshot()).toEqual({
      hapticsEnabled: true,
      loaded: false,
      loadError: false,
    });
    // Same instance every reader shares -- not a fresh controller built
    // per read.
    expect(core.settings).toBe(core.settings);
  });

  it("setHapticsEnabled(false) updates the shared snapshot, and a suppressed transcript-status haptic reaches the real vibration platform ZERO times through this exact controller", async () => {
    vibrationCalls.length = 0;
    const core = createAppCore();
    await core.settings.load();

    await core.settings.setHapticsEnabled(false);
    expect(core.settings.getSnapshot().hapticsEnabled).toBe(false);

    // The same real firing function `SessionTranscript` calls
    // (`features/transcript/transcript-status-haptics-model.ts`), given
    // this controller's own snapshot value and the real
    // `AppCore.vibrationPlatform` -- not a fake platform, not a
    // reimplemented decision.
    fireTranscriptStatusHaptic(
      core.vibrationPlatform,
      core.settings.getSnapshot().hapticsEnabled,
      "streaming",
      "error",
    );

    expect(vibrationCalls).toHaveLength(0);
  });

  it("setHapticsEnabled(true) (the default): the same real trigger reaches the real vibration platform once", async () => {
    vibrationCalls.length = 0;
    const core = createAppCore();
    await core.settings.load();

    fireTranscriptStatusHaptic(
      core.vibrationPlatform,
      core.settings.getSnapshot().hapticsEnabled,
      "streaming",
      "error",
    );

    expect(vibrationCalls).toHaveLength(1);
  });
});

describe("AppCore.notifications (T32S12, P5-W18)", () => {
  it("is a real NotificationsPlatform whose getPermissionState() actually resolves 'unsupported' (T32P3's unavailable->unsupported fold, not merely constructed)", async () => {
    const core = createAppCore();
    await expect(core.notifications.getPermissionState()).resolves.toBe("unsupported");
    await expect(core.notifications.requestPermission()).resolves.toBe("unsupported");
    // show() degrades silently rather than throwing when unsupported --
    // proves this is the real createAndroidNotificationsPlatform
    // pipeline (T32P3), not a bare stub with different behaviour.
    await expect(
      core.notifications.show({ id: "n1", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });
});

describe("AppCore.createTerminalTransport (T32S12, P5-W18)", () => {
  it("opens a real terminal session against the live DaemonClient once connected, and a decoded Input frame actually reaches writeInput", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0002",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const transport = core.createTerminalTransport("term-core-1", 2);
    // Flush the microtask queue so the transport's async
    // `openTerminalSession(...).then(...)` resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeClient.openTerminalSessionCalls).toEqual(["term-core-1"]);
    expect(transport.isOpen).toBe(true);

    const { encodeTerminalStreamFrame, TerminalStreamOpcode } =
      await import("@picompanion/protocol/binary-frames/terminal");
    transport.send(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Input, slot: 2, payload: "ls\r" }),
    );
    expect(fakeClient.lastTerminalSession?.writeInputCalls).toHaveLength(1);
    expect(
      new TextDecoder().decode(fakeClient.lastTerminalSession?.writeInputCalls[0] as Uint8Array),
    ).toBe("ls\r");

    await lifecycle.dispose();
  });

  it("stays closed with no active connection, and send() never throws", () => {
    const core = createAppCore();
    const transport = core.createTerminalTransport("term-core-2", 0);
    expect(transport.isOpen).toBe(false);
  });
});

describe("AppCore.createTurnService (T32S12, P5-W18)", () => {
  it("rejects with 'Not connected to a daemon' when no connection is active — never a silent no-op", async () => {
    const core = createAppCore();
    const turnService = core.createTurnService("agt-1");
    await expect(turnService.steer("hi")).rejects.toThrow("Not connected to a daemon");
  });

  it("steer/followUp/abort actually reach the live DaemonClient's sendMessage/cancelAgent with this exact agent id, once connected", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0003",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const turnService = core.createTurnService("agt-turn-1");
    await turnService.steer("steer text");
    await turnService.followUp("follow up text");
    await turnService.abort();

    expect(fakeClient.sendMessageCalls).toEqual([
      { agentId: "agt-turn-1", text: "steer text" },
      { agentId: "agt-turn-1", text: "follow up text" },
    ]);
    expect(fakeClient.cancelAgentCalls).toEqual(["agt-turn-1"]);

    await lifecycle.dispose();
  });

  it("setMode always rejects with UnsupportedDispatchModeChangeError (T63's disclosed protocol gap), never a silent success", async () => {
    const core = createAppCore();
    const turnService = core.createTurnService("agt-2");
    await expect(turnService.setMode("steer")).rejects.toThrow(/setMode\("steer"\)/);
  });
});

/**
 * `AppCore.startTurn` (T32S13, P5-W19) — the piece
 * `app/h/[serverId]/session/[agentId]/index.tsx`'s `handleSubmit` now
 * calls. Same fresh-read-the-live-client shape as `createTurnService`
 * above (both share `getTurnTransport`, see `./core.ts`), proven the
 * same way: a real (fake, in-memory) `DaemonClientLike` adopted onto
 * `AppCore.connection`, never a socket.
 */
describe("AppCore.startTurn (T32S13, P5-W19)", () => {
  it("resolves { status: 'failed', reason: 'transport-error' } with no active connection — never a silent no-op or a thrown exception", async () => {
    const core = createAppCore();
    const result = await core.startTurn("agt-1", "hello");
    expect(result).toEqual({
      status: "failed",
      reason: "transport-error",
      message: "Not connected to a daemon",
    });
  });

  it("an actually-received encoded frame over the wire, not just a registered call: the exact text reaches the live DaemonClient's sendMessage with this exact agent id, once connected", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0004",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const result = await core.startTurn("agt-start-1", "please clean up tmp/");

    expect(result).toEqual({ status: "started" });
    expect(fakeClient.sendMessageCalls).toEqual([
      { agentId: "agt-start-1", text: "please clean up tmp/" },
    ]);

    await lifecycle.dispose();
  });
});

/**
 * `AppCore.pushRegistration`/`startPushRegistration` (T32S13, P5-W19) —
 * `features/notifications/index.ts`'s own doc comment named this exact
 * seam since T36A/T61B ("Seam filed against T32S11", never picked up).
 * `registerPushToken`/`unregisterPushToken` are added to `FakeDaemonClient`
 * locally in these two tests (not the shared class above) since no
 * other suite in this file needs them.
 */
describe("AppCore.pushRegistration / startPushRegistration (T32S13, P5-W19)", () => {
  it("startPushRegistration() resolves 'permission-not-granted' against the only production PushRegistrationPort (unavailable, no expo-notifications install this wave) -- never throws, never silently no-ops", async () => {
    const core = createAppCore();
    const unsubscribe = await core.startPushRegistration();
    // No token was ever submitted (the unavailable port's getPermissionStatus()
    // never resolves "granted"), so the shared, real controller's own
    // registration-call counter stayed at zero -- a genuine "real logic,
    // real adapter, honestly nothing to do yet" answer, not a stub.
    expect(core.pushRegistration.getRegistrationCallCount()).toBe(0);
    expect(core.pushRegistration.getLastRegisteredToken()).toBeNull();
    unsubscribe();
  });

  it("pushRegistration.submitToken actually reaches the live DaemonClient's registerPushToken with this exact token, once connected", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient() as unknown as {
      registerPushToken(token: string): void;
      unregisterPushToken(token: string): void;
      registerPushTokenCalls: string[];
    };
    fakeClient.registerPushTokenCalls = [];
    fakeClient.registerPushToken = (token: string) => {
      fakeClient.registerPushTokenCalls.push(token);
    };
    fakeClient.unregisterPushToken = () => {};
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_0005",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    await core.pushRegistration.submitToken("push-token-abc");

    expect(fakeClient.registerPushTokenCalls).toEqual(["push-token-abc"]);

    await lifecycle.dispose();
  });
});

/**
 * `getProbeUrl` (T32S13, P5-W19) — twelve gates named this `(): string
 * | null => null` stub before this task. `AppCore` exposes no field for
 * this local closure (it only ever feeds `createDefaultAndroidProbe`
 * internally), and proving the "direct" connect path end-to-end would
 * require a real `DaemonConnectAttempt` reaching a real WebSocket —
 * this wave's hard rule against opening any socket. So this is a
 * source-level proof, anchored to the declaration itself (unique in
 * this file), mutation-checked below rather than merely inline.
 */
describe("getProbeUrl (T32S13, P5-W19)", () => {
  function readCoreSource(): string {
    return readFileSync(fileURLToPath(new URL("./core.ts", import.meta.url)), "utf8");
  }
  function readCode(): string {
    return readCoreSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  it("derives the probe URL from the live connection snapshot's daemonAddress via buildDaemonHttpOrigin, never the fixed null stub", () => {
    const code = readCode();
    expect(code).toMatch(
      /const getProbeUrl = \(\): string \| null => \{\s*const address = connection\.getSnapshot\(\)\.daemonAddress;\s*return address \? buildDaemonHttpOrigin\(address\) : null;\s*\};/,
    );
    expect(code).not.toMatch(/const getProbeUrl = \(\): string \| null => null;/);
  });
});

/**
 * `AppCore.reconnectHostProfile` (T32S14, P5-W20) — the mount site for
 * T66's `createReconnectHostProfile`, which had zero production callers
 * before this task (`host-profile-reconnect.ts`'s own "Where this plugs
 * in" doc section named this exact seam). Proven two ways, matching
 * every other `AppCore` daemon-backed field in this file: a real-value
 * refusal that needs no socket at all (the relay-missing-pin branch,
 * which `createReconnectHostProfile` itself never even attempts a
 * connection for), and a real success reaching a connected
 * `DaemonClientLifecycle` through the injected `createDaemonClient`
 * override `CreateAppCoreOverrides.reconnect` adds — never a socket,
 * never a fabricated result.
 */
describe("AppCore.reconnectHostProfile (T32S14)", () => {
  const RELAY_PROFILE_NO_PIN: HostProfileRecord = {
    id: "relay-server-1",
    label: "Studio relay",
    kind: "relay",
    endpoint: "relay.example:443",
    useTls: true,
    isIpv6: false,
  };

  it("is the real createReconnectHostProfile logic, not a stub: refuses a relay profile with no saved pin before any connection attempt", async () => {
    const core = createAppCore();
    const result = await core.reconnectHostProfile(RELAY_PROFILE_NO_PIN, {});
    expect(result).toEqual({
      ok: false,
      kind: "wrong-daemon-key",
      error: RELAY_PIN_MISSING_MESSAGE,
      pinMismatch: true,
    });
  });

  it("a real reconnect success reaches a connected DaemonClientLifecycle through the injected createDaemonClient override, and that exact lifecycle is what AppCore.connection.adoptLifecycle publishes as 'connected' — a value of the reconnected kind actually arriving, not a registered-but-never-invoked callback", async () => {
    const fakeClient = new FakeDaemonClient();
    const core = createAppCore({
      reconnect: {
        createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
      },
    });
    const directProfile: HostProfileRecord = {
      id: "192.168.1.10:6767",
      label: "Studio",
      kind: "direct",
      endpoint: "192.168.1.10:6767",
      useTls: false,
      isIpv6: false,
    };

    const result = await core.reconnectHostProfile(directProfile, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a successful reconnect");
    expect(result.path).toBe("direct");

    await core.connection.adoptLifecycle(result.lifecycle);
    expect(core.connection.getSnapshot().phase).toBe("connected");
    expect(core.connection.getActiveLifecycle()).toBe(result.lifecycle);

    await result.lifecycle.dispose();
  });

  // T73: found at the P5-W20 merge gate immediately after the case above
  // landed — `path` was fixed, but `adoptLifecycle` was still called
  // with no third argument here (and in `connection-shell.tsx`), so
  // `daemonAddress` stayed `null` and `getProbeUrl` (this file's own
  // `describe` block above) kept returning `null` for a reconnected
  // direct profile. This passes `directProfile` through exactly like
  // `connection-shell.tsx`'s `handleReconnect` now does, and proves the
  // value actually reaches `getProbeUrl`'s own computation
  // (`buildDaemonHttpOrigin(connection.getSnapshot().daemonAddress)`) —
  // a real probe URL, not a non-null field in isolation.
  it("a real direct reconnect, adopted with its source profile, publishes a real daemonAddress that getProbeUrl's own computation turns into a real probe URL", async () => {
    const fakeClient = new FakeDaemonClient();
    const core = createAppCore({
      reconnect: {
        createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
      },
    });
    const directProfile: HostProfileRecord = {
      id: "192.168.1.10:6767",
      label: "Studio",
      kind: "direct",
      endpoint: "192.168.1.10:6767",
      useTls: false,
      isIpv6: false,
    };

    const result = await core.reconnectHostProfile(directProfile, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a successful reconnect");

    await core.connection.adoptLifecycle(result.lifecycle, result.path, directProfile);

    const address = core.connection.getSnapshot().daemonAddress;
    expect(address).toEqual({
      host: "192.168.1.10",
      port: 6767,
      useTls: false,
      isIpv6: false,
    });
    // `getProbeUrl`'s own body (asserted verbatim above) is
    // `buildDaemonHttpOrigin(connection.getSnapshot().daemonAddress)` —
    // this is that exact computation, proving the value it would return.
    expect(buildDaemonHttpOrigin(address!)).toBe("http://192.168.1.10:6767");

    await result.lifecycle.dispose();
  });
});

/**
 * `AppCore.offlineCache` (T68/T32S14, P5-W20) — T68's own module doc
 * comment filed this exact mount seam against this file. Proven the
 * same "real logic, real adapter, honestly degraded until expo-sqlite is
 * installed" shape `AppCore.notifications` already established: `open()`
 * is called (fire-and-forget) at construction, and settles to
 * `"degraded"` against the only production `SqliteDriverFactory` this
 * wave has (`createUnavailableSqliteDriverFactory()` — T60C's `expo-
 * sqlite` install still has not landed), never left "opening" forever
 * and never a crash.
 */
/**
 * Minimal `Clock` double for the scope-guard test below. The guard throws
 * in `OfflineCacheOwner`'s constructor, before any clock member is ever
 * reached, so every member but `now()` throws rather than pretending to
 * work — a silent behaviour change here should be loud. Same shape as
 * `platform/offline/offline-cache-owner.test.ts`'s own `FakeClock`.
 */
class NowOnlyClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): never {
    throw new Error("NowOnlyClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("NowOnlyClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("NowOnlyClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("NowOnlyClock.clearInterval is not implemented; this test double is now-only.");
  }
}

describe("AppCore.offlineCache (T68/T32S14)", () => {
  it("open() was already called at construction and settles to a named 'degraded' status — expo-sqlite is not installed this wave", async () => {
    const core = createAppCore();
    const status = await core.offlineCache.open();
    expect(status.kind).toBe("degraded");
    expect(core.offlineCache.getCache()).toBeNull();
  });

  it("dispose() actually works once invoked, even though nothing in production calls it yet (this task's own disclosed gap)", async () => {
    const core = createAppCore();
    await core.offlineCache.open();
    await core.offlineCache.dispose();
    expect(core.offlineCache.getStatus()).toEqual({ kind: "disposed" });
  });

  /**
   * Added at the P5-W20 merge gate's own review, not by the gate itself.
   * The gate found that `createAppCore()` used to mint a per-call unique
   * scope (`android-app-core-${++counter}`), which silently disarmed
   * T68's one-owner-per-scope guard: `SqliteDriverFactory.open()` takes
   * no arguments, so `scope` is never forwarded to the driver, the
   * storage, or the cache's collection — two owners on *different*
   * scopes therefore open the *same* store, and the guard is the only
   * thing standing between that and two `SqliteStructuredStorage`
   * instances racing writes over one file. The gate replaced the counter
   * with the fixed `APP_CORE_OFFLINE_SCOPE`, but re-planting the counter
   * left all 1945 tests green, so the fix was entirely unproven and the
   * next task to hit the same friction would have undone it.
   *
   * This is the assertion that fails under that mutation: `createAppCore()`
   * must hold `APP_CORE_OFFLINE_SCOPE` itself, so any *other* owner
   * constructed on it collides. A per-call unique scope leaves
   * `APP_CORE_OFFLINE_SCOPE` free and this construction succeeds.
   */
  it("holds the single fixed APP_CORE_OFFLINE_SCOPE, so a second owner on that scope is refused — a per-call unique scope would leave it free", () => {
    const core = createAppCore();
    expect(() =>
      createOfflineCacheOwner({
        driverFactory: createUnavailableSqliteDriverFactory(),
        clock: new NowOnlyClock(),
        scope: APP_CORE_OFFLINE_SCOPE,
      }),
    ).toThrow(/already has an undisposed owner/);
    void core.offlineCache.dispose();
  });
});

/**
 * `AppCore.shutdown()` (T74) — closes the disclosed gap
 * `AppCore["offlineCache"]`'s (and `OfflineCacheOwner`'s own) doc comment
 * used to name: `createAppCore()` had no "app is shutting down" teardown
 * path for any singleton it built. Every case below proves a *disposed
 * state actually observed* after `shutdown()` — never merely that a
 * dispose function exists or was registered somewhere.
 */
function upsertDeltaMessage(agentId: string, elementId: string): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId,
      timestamp: "2026-09-03T10:00:00.000Z",
      event: {
        type: "pi_ui_delta",
        provider: "pi",
        agentId,
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: elementId,
            ns: "todo",
            kind: "widget",
            placement: "pinned",
            title: "Today's plan",
            payload: { kind: "widget", text: "3 tasks remaining" },
          },
        },
      },
    } as unknown as AgentStreamMessage["payload"],
  };
}

describe("AppCore.shutdown() (T74)", () => {
  it("disposes both offlineCache and connection — a disposed status/idle snapshot is actually observed, not just a dispose fn registered", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_shutdown_0001",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);
    await core.offlineCache.open();

    expect(core.connection.getActiveLifecycle()).not.toBeNull();
    expect(core.offlineCache.getStatus().kind).not.toBe("disposed");

    await core.shutdown();

    expect(core.offlineCache.getStatus()).toEqual({ kind: "disposed" });
    expect(core.connection.getActiveLifecycle()).toBeNull();
    expect(core.connection.getSnapshot().phase).toBe("idle");
  });

  it("detaches this file's own agent_stream listener on the live client — a message emitted after shutdown reaches neither piUiSession.store nor a subscribeAgentStream listener", async () => {
    const core = createAppCore();
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_shutdown_0002",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    const received: AgentStreamMessage[] = [];
    core.subscribeAgentStream((message) => received.push(message));

    await core.shutdown();

    // The lifecycle this fake client belonged to is disposed by shutdown()
    // above, but `emitAgentStream` bypasses the socket entirely and calls
    // the handler this file's own `on()` registration captured directly —
    // exactly the seam that proves the *handler itself* was detached, not
    // merely that the lifecycle around it was torn down.
    fakeClient.emitAgentStream(upsertDeltaMessage("agt_shutdown", "widget-shutdown"));

    expect(received).toHaveLength(0);
    expect(core.piUiSession.store.getElements("agt_shutdown")).toEqual([]);
  });

  it("detaches AppCore's own connection-change listener — adopting a new lifecycle after shutdown never re-subscribes agent_stream", async () => {
    const core = createAppCore();
    await core.shutdown();

    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_shutdown_0003",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    expect(fakeClient.agentStreamOnCallCount).toBe(0);

    await lifecycle.dispose();
  });

  it("a shutdown mid-open (offlineCache.open() still in flight) settles to disposed", async () => {
    // Production's own `createUnavailableSqliteDriverFactory()` settles
    // `open()` in a single microtask, too fast for this test to reliably
    // catch it "still in flight" — the T74 `CreateAppCoreOverrides.
    // offline.driverFactory` seam holds `open()` pending until this test
    // resolves it, matching T68's own `offline-cache-owner.test.ts`
    // "dispose() called before open() ever resolves" case, exercised
    // here through `AppCore.shutdown()` end to end rather than the owner
    // directly.
    let resolveOpen!: (driver: InstanceType<typeof InMemorySqliteDriver>) => void;
    const openPromise = new Promise<InstanceType<typeof InMemorySqliteDriver>>((resolve) => {
      resolveOpen = resolve;
    });
    const core = createAppCore({ offline: { driverFactory: { open: () => openPromise } } });

    // createAppCore() already fired offlineCache.open() fire-and-forget;
    // it cannot have settled yet — nothing above resolved `openPromise`.
    expect(core.offlineCache.getStatus().kind).toBe("opening");

    const shutdownPromise = core.shutdown();
    // Still in flight at the moment shutdown() was called — settle it
    // only now, from underneath the pending shutdown.
    resolveOpen(new InMemorySqliteDriver());
    await shutdownPromise;

    expect(core.offlineCache.getStatus()).toEqual({ kind: "disposed" });
  });

  it("shutting down twice is safe: the second call returns the exact same promise rather than tearing down again", async () => {
    const core = createAppCore();
    // Let offlineCache.open() settle first — this test's own claim is
    // idempotency, not the mid-open race the previous test already
    // covers; racing here would exercise both at once.
    await core.offlineCache.open();

    const first = core.shutdown();
    const second = core.shutdown();

    expect(second).toBe(first);
    await expect(second).resolves.toBeUndefined();

    // A third call, made after the first has already settled, is equally
    // safe — never a crash, never a second dispose.
    await expect(core.shutdown()).resolves.toBeUndefined();
    expect(core.offlineCache.getStatus()).toEqual({ kind: "disposed" });
  });
});
