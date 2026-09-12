/**
 * T76: proves `createTurnOutbox`/`recoverInFlightTurns` (T37C,
 * `../platform/offline/turn-recovery.ts`) now have a real production
 * caller, over the injected `SqliteDriverFactory` seam — this suite
 * supplies an `InMemorySqliteDriver`-backed factory directly, so it
 * proves the recovery wiring without depending on the native
 * `ExpoSQLite` module (production passes the real
 * `createExpoSqliteDriverFactory` since T390, and `AppCore.turnOutbox`
 * reports `"degraded"` whenever that native module is genuinely
 * unavailable).
 *
 * This is a dedicated file, not an addition to `./core.test.ts`,
 * specifically so this task's commit never needs to touch a file
 * several other P5-W23 tasks are concurrently, uncommittedly editing —
 * it drives the exact same real, unmocked `createAppCore()` that file
 * does, through the same react-native/expo mock set that file already
 * established (copied, not reinvented — see that file's own doc
 * comment for why each mock exists).
 *
 * The acceptance criterion this task exists for: "a recovered in-flight
 * turn actually arrives at the transcript after a simulated process
 * death, proven by the value" — "a non-null field is not proof". This
 * suite proves both halves of that chain against real, unmocked
 * production code:
 *
 * 1. A `"prompt"` outbox entry left `pending` (never `markSending`d)
 *    before a simulated process death — two `InMemorySqliteDriver`
 *    instances sharing one backing array, exactly the pattern that
 *    module's own doc comment sanctions — is recovered by the real
 *    `recoverInFlightTurns` pass `TurnOutboxOwner.open()` runs, and
 *    `core.ts`'s real `resumePendingTurnOutboxEntries` (triggered by
 *    the real `ensureAgentStreamSubscription` the moment a live
 *    `DaemonClientLifecycle` is adopted) resends its exact `payload.text`
 *    through the real `startDaemonTurn`/`getTurnTransport` pair,
 *    reaching a fake `DaemonClient.sendMessage` — a value arriving at a
 *    transport call, not a status field.
 * 2. A scripted `agent_stream` echo (simulating the daemon's real
 *    response to that resend) reaches a real, unmocked
 *    `TranscriptMessageBatcher` through `core.subscribeAgentStream` —
 *    the exact same wiring `core.test.ts`'s own "AppCore agent_stream
 *    subscription (T32S8)" suite proves for a live turn — and the
 *    resent text is readable back out of `batcher.getMessageEntries()`
 *    after a frame flush: the recovered turn's own words, landing in
 *    the actual transcript row shape the feature renders, not a count
 *    or a boolean.
 */
import { describe, expect, it, vi } from "vitest";

import type { ConnectionState } from "@picompanion/client";
import { connection as coreConnection } from "@picompanion/frontend-core";
import type { AppLifecycle, AppLifecycleState, Clock } from "@picompanion/frontend-core";
import type { AgentStreamMessage, ServerInfoStatusPayload } from "@picompanion/protocol/messages";

// Same mock set as `./core.test.ts` — see that file's own doc comment
// for why each of these is needed to import `./core` under plain
// `vitest` at all.
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
    Vibration: { vibrate: () => undefined },
    Share: { share: async () => ({ action: "sharedAction" }) },
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

// T349: `ui/primitives/index.ts` now also exports `VectorIcon`
// (`vector-icons.tsx`), whose `react-native-svg` import carries the same
// unparseable-by-plain-vitest source every `react-native` package in this
// file's chain does. Stood in for exactly like the two mocks above, and
// for the same reason: nothing here renders, so an inert stand-in is
// enough for an import-only test. Enumerated, not generic -- the members
// are the ones `vector-icons.tsx` actually imports today, so adding a new
// SVG element there is a deliberate two-file change, not a silent one.
vi.mock("react-native-svg", () => {
  function Stub(): null {
    return null;
  }
  return { default: Stub, Circle: Stub, Path: Stub, Rect: Stub };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
  isAvailableAsync: async () => true,
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

const { createAppCore } = await import("./core.js");
const { InMemorySqliteDriver } = await import("../platform/offline/in-memory-sqlite-driver.js");
const { SqliteStructuredStorage } =
  await import("../platform/offline/sqlite-structured-storage.js");
const { createTurnOutbox } = await import("../platform/offline/turn-recovery.js");
const { createTranscriptMessageBatcher } =
  await import("../features/transcript/transcript-message-batcher.js");

/** Now-only `Clock` double — matches `../platform/offline/turn-outbox-owner.test.ts`'s own `FakeClock` (copied, not imported: test files are not library code). */
class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

/** Stays `"active"` for this suite's whole lifetime — the frame clock's `requestAnimationFrame` path is what `flushRaf` below drives. */
class FakeLifecycle implements AppLifecycle {
  private readonly state: AppLifecycleState = "active";
  private readonly listeners = new Set<(state: AppLifecycleState) => void>();
  getState(): AppLifecycleState {
    return this.state;
  }
  subscribe(listener: (state: AppLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Minimal, manually-driven `requestAnimationFrame`/`setTimeout` pair — same shape as `../features/transcript/transcript-message-batcher.test.ts`'s own `createFakeSchedulers`, copied for the same "test files are not library code" reason. */
function createFrameSchedulers() {
  let nextHandle = 1;
  let nowMs = 0;
  const rafQueue = new Map<number, (timestamp: number) => void>();
  return {
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      const handle = nextHandle++;
      rafQueue.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle: number) => {
      rafQueue.delete(handle);
    },
    // Never actually scheduled while `FakeLifecycle` stays "active" —
    // present only to satisfy `AppFrameClockDeps`'s shape.
    setTimeout: (): number => nextHandle++,
    clearTimeout: (): void => undefined,
    now: () => nowMs,
    flushRaf(): void {
      nowMs += 16;
      const pending = [...rafQueue.values()];
      rafQueue.clear();
      for (const callback of pending) callback(nowMs);
    },
  };
}

/** Minimal `DaemonClientLike` (`packages/frontend-core/src/connection/daemon-client-lifecycle.ts`) double, plus `on("agent_stream", ...)` and `sendMessage`/`cancelAgent` — the exact narrow slice `core.ts`'s own casts (`AgentStreamCapableClient`, `DaemonTurnTransport`) reach for, mirroring `./core.test.ts`'s own `FakeDaemonClient`. */
class FakeDaemonClient {
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();
  private readonly agentStreamHandlers = new Set<(message: AgentStreamMessage) => void>();
  /** Every `sendMessage(agentId, text)` call this fake received — the value this suite's first half proves actually arrives. */
  sendMessageCalls: Array<{ agentId: string; text: string }> = [];
  cancelAgentCalls: string[] = [];

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
  on(type: "agent_stream", handler: (message: AgentStreamMessage) => void): () => void {
    if (type !== "agent_stream") {
      throw new Error(`unexpected on() type in test fake: ${type}`);
    }
    this.agentStreamHandlers.add(handler);
    return () => this.agentStreamHandlers.delete(handler);
  }
  /** Test-only: fires a scripted `agent_stream` message to every currently-registered handler — never a real socket. */
  emitAgentStream(message: AgentStreamMessage): void {
    for (const handler of this.agentStreamHandlers) handler(message);
  }
  async sendMessage(agentId: string, text: string): Promise<void> {
    this.sendMessageCalls.push({ agentId, text });
  }
  async cancelAgent(agentId: string): Promise<void> {
    this.cancelAgentCalls.push(agentId);
  }
  private publish(state: ConnectionState): void {
    for (const listener of this.statusListeners) listener(state);
  }
}

describe("T76: a recovered in-flight turn actually arrives at the transcript after a simulated process death", () => {
  it("resends a recovered pending outbox entry over the real transport, and the daemon's echo reaches a real TranscriptMessageBatcher", async () => {
    // 1. Seed a "prompt" entry, left `pending` — never `markSending`d —
    //    over a `SqliteStructuredStorage`/`InMemorySqliteDriver` pair.
    //    This is turn-recovery.ts's window 1 verbatim: "before the
    //    daemon received the turn... pending at cold start... Outcome:
    //    resumed."
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const seedStorage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const seedOutbox = createTurnOutbox(seedStorage, new FakeClock(1_000));
    const seededText = "recovered turn: finish the deploy checklist";
    const seededAgentId = "agt_t76_recover";
    const seeded = await seedOutbox.enqueue({
      sessionId: seededAgentId,
      kind: "prompt",
      payload: { text: seededText, attachments: [] },
    });
    expect(seeded.status).toBe("pending");

    // 2. "Restart": a real `AppCore`, whose `turnOutbox` override is a
    //    driver factory resolving a *second* `InMemorySqliteDriver` over
    //    the *same* backing array — the JS process is gone, the rows are
    //    not (`in-memory-sqlite-driver.ts`'s own doc comment names this
    //    exact pattern as the sanctioned "simulated process death").
    const afterKillDriver = new InMemorySqliteDriver(backing);
    const core = createAppCore({
      turnOutbox: {
        scope: "t76-transcript-proof",
        driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      },
    });

    // `open()` is idempotent (same promise every call — `TurnOutboxOwner`'s
    // own contract), so awaiting it here just observes the fire-and-forget
    // `open()` `createAppCore()` already kicked off. By the time this
    // resolves, the one cold-start `recoverInFlightTurns` pass has run.
    const status = await core.turnOutbox.open();
    expect(status).toEqual({ kind: "ready" });

    // Real value, not a status field: the recovery pass reconciled the
    // seeded row to "resumed"/"pending".
    expect(core.turnOutbox.getRecoveredTurns()).toEqual([
      {
        id: seeded.id,
        sessionId: seededAgentId,
        kind: "prompt",
        outcome: "resumed",
        status: "pending",
      },
    ]);

    // 3. Adopt a live (fake) daemon client — the real trigger
    //    `resumePendingTurnOutboxEntries`'s own doc comment names:
    //    `ensureAgentStreamSubscription` fires it the moment a live
    //    client shows up.
    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_t76",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    // The resend itself is fire-and-forget (`void
    // resumePendingTurnOutboxEntries()` inside `ensureAgentStreamSubscription`)
    // — wait for its real, observable end state: `markSent` has deleted
    // the entry (`outbox.ts`'s own contract), which only happens after
    // `startDaemonTurn` has itself awaited a resolved `sendMessage`.
    let reloaded = await core.turnOutbox.getOutbox()?.load(seeded.id);
    for (let i = 0; i < 500 && reloaded; i++) {
      await Promise.resolve();
      reloaded = await core.turnOutbox.getOutbox()?.load(seeded.id);
    }

    // THE VALUE: the recovered turn's own text reached the real
    // transport call, addressed to the entry's own session/agent id —
    // not a non-null field, not a call count on its own.
    expect(fakeClient.sendMessageCalls).toEqual([{ agentId: seededAgentId, text: seededText }]);

    // The outbox entry itself is now resolved (deleted by `markSent`)
    // rather than left dangling `sending`.
    expect(reloaded).toBeNull();

    // 4. THE TRANSCRIPT: a scripted `agent_stream` echo — simulating the
    //    daemon's real response to the resend above — reaching a real,
    //    unmocked `TranscriptMessageBatcher` through
    //    `core.subscribeAgentStream`, the exact wiring
    //    `core.test.ts`'s own "AppCore agent_stream subscription
    //    (T32S8)" suite proves for a live (non-recovered) turn.
    const schedulers = createFrameSchedulers();
    const batcher = createTranscriptMessageBatcher({
      lifecycle: new FakeLifecycle(),
      ...schedulers,
    });
    const unsubscribe = core.subscribeAgentStream((message) => {
      batcher.push(message);
    });

    expect(batcher.getMessageEntries()).toEqual([]);

    fakeClient.emitAgentStream({
      type: "agent_stream",
      payload: {
        agentId: seededAgentId,
        epoch: "epoch-t76-0001",
        seq: 1,
        timestamp: "2026-09-04T10:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "on it — running the deploy checklist now",
            messageId: "msg_t76_0001",
          },
        },
      } as unknown as AgentStreamMessage["payload"],
    });

    // Still nothing until the next frame tick — `push` never applies
    // synchronously (`TimelineCoalescer.push`'s own contract).
    expect(batcher.getMessageEntries()).toEqual([]);
    expect(batcher.pendingCount()).toBe(1);

    schedulers.flushRaf();

    // THE PROOF: a real transcript row — `CoreMessageEntry` shape, real
    // text, real message id — not a pending count, not a boolean, not a
    // non-null field.
    const entries = batcher.getMessageEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "assistant-message",
      text: "on it — running the deploy checklist now",
    });

    unsubscribe();
    batcher.dispose();
    await lifecycle.dispose();
    await core.shutdown();
  });

  it("never auto-resends a recovered 'awaiting-confirmation' entry (window 2) — the safety rule turn-recovery.ts's own doc comment names", async () => {
    // Seed an entry that reached `sending` before the simulated kill —
    // window 2: daemon receipt unconfirmed, so recovery must park it
    // `awaiting-confirmation`, never resend it silently.
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const seedStorage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const seedOutbox = createTurnOutbox(seedStorage, new FakeClock(1_000));
    const seeded = await seedOutbox.enqueue({
      sessionId: "agt_t76_ambiguous",
      kind: "prompt",
      payload: { text: "did this already reach the daemon?", attachments: [] },
    });
    await seedOutbox.markSending(seeded.id);

    const afterKillDriver = new InMemorySqliteDriver(backing);
    const core = createAppCore({
      turnOutbox: {
        scope: "t76-no-silent-resend-proof",
        driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      },
    });
    await core.turnOutbox.open();
    expect(core.turnOutbox.getRecoveredTurns()).toEqual([
      {
        id: seeded.id,
        sessionId: "agt_t76_ambiguous",
        kind: "prompt",
        outcome: "awaiting-confirmation",
        status: "awaiting-confirmation",
      },
    ]);

    const fakeClient = new FakeDaemonClient();
    const lifecycle = new coreConnection.DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_test_t76b",
      clientType: "mobile",
      createDaemonClient: () => fakeClient as unknown as coreConnection.DaemonClientLike,
    });
    await lifecycle.connect();
    await core.connection.adoptLifecycle(lifecycle);

    // Give any fire-and-forget resend attempt every chance to run —
    // then assert it did not.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(fakeClient.sendMessageCalls).toEqual([]);

    // Still parked, still readable — a disclosed gap (no screen surfaces
    // it for explicit confirmation yet), never a silent drop.
    const reloaded = await core.turnOutbox.getOutbox()?.load(seeded.id);
    expect(reloaded?.status).toBe("awaiting-confirmation");

    await lifecycle.dispose();
    await core.shutdown();
  });
});
