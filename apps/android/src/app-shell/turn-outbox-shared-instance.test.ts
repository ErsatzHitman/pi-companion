/**
 * T121: proves the composer/recovered-turn-banner `OutboxController`
 * instance split is closed — the exact gap `./core.ts`'s `turnOutbox`
 * field doc comment (T76), `../app/h/[serverId]/session/[agentId]/
 * index.tsx`'s doc comment (T95), and `../features/transcript/
 * recovered-turn-banner.tsx`'s doc comment (T106) each used to disclose,
 * pointing at "T106's report for the exact wiring... and who owns it".
 * No task owned it until this one.
 *
 * A dedicated file, not an addition to `./core.test.ts`, for the same
 * reason `./turn-outbox-recovery.test.ts` (T76) is one (see that file's
 * own doc comment): several other P6-W8 tasks are concurrently,
 * uncommittedly editing `core.test.ts`. This drives the same real,
 * unmocked `createAppCore()` construction path that file does, over the
 * same real `InMemorySqliteDriver`/`SqliteStructuredStorage`/
 * `OutboxController` pipeline, through the same react-native/expo mock
 * set `core.test.ts` and `turn-outbox-recovery.test.ts` both already
 * establish (copied, not reinvented — see either file's own doc comment
 * for why each mock exists).
 *
 * The acceptance criterion this file exists for: "one OutboxController
 * instance serves both the composer and the recovered-turn banner,
 * proven by a value arriving at a counting fake through the real
 * mount". This suite proves it directly against the real, unmocked
 * `AppCore.turnOutbox` (an `InMemorySqliteDriver`-backed `driverFactory`
 * so the owner reaches `"ready"` rather than production's honest
 * `"degraded"` — see `./core.ts`'s `turnOutbox` doc comment for why
 * production stays `"degraded"` until `expo-sqlite` is installed):
 *
 * 1. `core.turnOutbox.getOutbox()` called twice — standing in for
 *    `SessionTranscript`'s call and `SessionRoute`'s call, the two
 *    independent call sites `../app/h/[serverId]/session/[agentId]/
 *    index.tsx` actually makes (proven by source text in that route's
 *    own `.test.ts`) — returns the exact same object reference, never
 *    two.
 * 2. A composer-style send (`enqueue`/`markSending`/`markFailed`,
 *    `Composer.tsx`'s own `sendWithOutbox` shape) lands an entry
 *    `"awaiting-confirmation"` on that one instance.
 * 3. A banner-style resend — `../features/transcript/recovered-turn-
 *    model.ts`'s real, unmocked `confirmRecoveredTurn`, never a
 *    hand-rolled stand-in for it — called against the SECOND
 *    `getOutbox()` call's return value resolves that exact entry back
 *    to `pending`: a real value (the entry's own id) arriving at the
 *    second call site's instance, not a reference-equality check alone.
 * 4. `vi.spyOn` wraps that one real, unmocked instance's `enqueue`/
 *    `confirmResend` to prove each was called exactly once — the
 *    "counting fake" the acceptance criterion names, counting calls on
 *    the real controller rather than a fake pretending to be it (the
 *    real thing is reachable here, so this repository's "no fake
 *    pretending to be it" rule applies).
 * 5. A THIRD, genuinely separate `OutboxController` — the exact
 *    pre-T121 bug shape (`Composer`'s own private default instance,
 *    over its own separate in-memory storage) — cannot resolve the
 *    entry the shared instance enqueued: `confirmResend` returns `null`
 *    against it, proving what the shared `getOutbox()` wiring actually
 *    prevents, not just what it does.
 */
import { describe, expect, it, vi } from "vitest";

import { composer as coreComposer, type Clock } from "@picompanion/frontend-core";

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
const { createInMemoryStructuredStorage } =
  await import("../features/composer/in-memory-outbox-runtime.js");
const { confirmRecoveredTurn } = await import("../features/transcript/recovered-turn-model.js");

/** Now-only `Clock` double — matches `./turn-outbox-recovery.test.ts`'s own `FakeClock` (copied, not imported: test files are not library code). */
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

describe("T121: one OutboxController instance serves both the composer and the recovered-turn banner", () => {
  it("core.turnOutbox.getOutbox() returns the identical instance on every call, and a composer-style enqueue is resolvable by a banner-style confirmRecoveredTurn call against that same instance", async () => {
    const driver = new InMemorySqliteDriver();
    const core = createAppCore({
      turnOutbox: {
        scope: "t121-shared-instance-proof",
        driverFactory: { open: () => Promise.resolve(driver) },
      },
    });

    const status = await core.turnOutbox.open();
    expect(status).toEqual({ kind: "ready" });

    // Two independent `getOutbox()` calls — standing in for
    // `SessionTranscript`'s and `SessionRoute`'s own separate
    // `useAppCore()` reads at the production mount — return the exact
    // same object, never two separate instances.
    const outboxForComposer = core.turnOutbox.getOutbox();
    const outboxForBanner = core.turnOutbox.getOutbox();
    expect(outboxForComposer).not.toBeNull();
    expect(outboxForBanner).toBe(outboxForComposer);

    // The "counting fake" the acceptance criterion names: spies wrapping
    // the real, unmocked instance (never a hand-rolled fake standing in
    // for it — the real thing is reachable here).
    const enqueueSpy = vi.spyOn(outboxForComposer!, "enqueue");
    const confirmSpy = vi.spyOn(outboxForBanner!, "confirmResend");

    // 1. Composer-style send: `Composer.tsx`'s own `sendWithOutbox`
    //    enqueues, marks sending, and — on a failed send whose
    //    idempotency was never verified — marks the entry
    //    "awaiting-confirmation" via `markFailed`'s default.
    const entry = await outboxForComposer!.enqueue({
      sessionId: "agt_t121_shared",
      kind: "prompt",
      payload: { text: "does this reach the shared outbox?", attachments: [] },
    });
    expect(entry.status).toBe("pending");
    await outboxForComposer!.markSending(entry.id);
    const failed = await outboxForComposer!.markFailed(entry.id, "simulated network drop");
    expect(failed?.status).toBe("awaiting-confirmation");

    // 2. Banner-style resend, against the OTHER `getOutbox()` call's
    //    return value: real, unmocked `confirmRecoveredTurn` from
    //    `../features/transcript/recovered-turn-model.ts` — the exact
    //    function `RecoveredTurnBanner`'s "Resend" button calls.
    const confirmed = await confirmRecoveredTurn(outboxForBanner!, {
      id: entry.id,
      sessionId: "agt_t121_shared",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    });

    // THE VALUE: the composer-enqueued entry really was found and
    // resolved back to "pending" through the second call site's
    // instance — not a non-null field, not a reference check alone.
    expect(confirmed).toBe(true);
    const resolved = await outboxForComposer!.load(entry.id);
    expect(resolved?.status).toBe("pending");

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    await core.turnOutbox.dispose();
  });

  it("a SEPARATE OutboxController instance — the exact pre-T121 bug shape (Composer's own private default, over its own separate storage) — cannot resolve an entry the shared instance enqueued", async () => {
    const driver = new InMemorySqliteDriver();
    const core = createAppCore({
      turnOutbox: {
        scope: "t121-separate-instance-proof",
        driverFactory: { open: () => Promise.resolve(driver) },
      },
    });
    await core.turnOutbox.open();
    const sharedOutbox = core.turnOutbox.getOutbox()!;

    const entry = await sharedOutbox.enqueue({
      sessionId: "agt_t121_separate",
      kind: "prompt",
      payload: { text: "enqueued on the shared instance", attachments: [] },
    });
    await sharedOutbox.markSending(entry.id);
    await sharedOutbox.markFailed(entry.id, "simulated network drop");

    // `Composer`'s own default when no `outbox` prop is supplied
    // (`ComposerProps.outbox`'s doc comment, `in-memory-outbox-runtime.ts`):
    // a private `OutboxController` over its own in-memory storage — this
    // IS the pre-T121 split, reconstructed here only to prove it would
    // fail, never as production code.
    const separateOutbox = new coreComposer.OutboxController(
      createInMemoryStructuredStorage(),
      new FakeClock(2_000),
    );

    const confirmedAgainstSeparateInstance = await confirmRecoveredTurn(separateOutbox, {
      id: entry.id,
      sessionId: "agt_t121_separate",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    });

    // Proves the failure mode the shared `getOutbox()` wiring prevents:
    // a genuinely separate instance never even sees the entry.
    expect(confirmedAgainstSeparateInstance).toBe(false);

    // The shared instance itself still resolves it correctly.
    const confirmedAgainstSharedInstance = await confirmRecoveredTurn(sharedOutbox, {
      id: entry.id,
      sessionId: "agt_t121_separate",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    });
    expect(confirmedAgainstSharedInstance).toBe(true);

    await core.turnOutbox.dispose();
  });
});
